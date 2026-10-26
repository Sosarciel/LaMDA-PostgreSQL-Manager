import { EventSystem, MPromise, PromiseFlight } from "@zwa73/js-utils";
import type { PoolClient } from "pg";
import { DBManager } from "./Manager";
import { SLogger } from "@zwa73/utils";

/**退避等待 定时器 unref 不阻止进程退出 */
const wait = (ms: number) => new Promise<void>(resolve => {
    setTimeout(resolve, ms).unref();
});
/**重连退避基础间隔 毫秒 */
const RETRY_BASE_MS = 1000;
/**重连退避间隔上限 毫秒 */
const RETRY_MAX_MS = 60_000;

/**数据库操作通知
 * @template T 表单id
 * @template R 移除复杂内容的行快照
 * @template D 全量行数据
 */
export type DBOperation<T extends string,R> =
    | { op:'insert'; table:T; new:R;}        // 存在对应键则更新数据
    | { op:'update'; table:T; new:R; old:R;} // 存在对应键则更新数据
    | { op:'delete'; table:T; old:R;}        // 删除对应键
    | { op:'set'   ; table:T; new:R;}        // 存在对应键则更新数据, 不存在者插入数据并触发提升

export class DBNotifyCoordinator<
    NOTIFY extends DBOperation<string,unknown>,
    SELF = unknown
> extends EventSystem<{[K in NOTIFY['table']]:(arg:{
    coordinator: unknown extends SELF ? DBNotifyCoordinator<NOTIFY> : SELF,
    notify:Extract<NOTIFY,{table:K}>
})=>MPromise<void>}&{
    /**任何通知 */
    onNotify:(arg:{
        coordinator:unknown extends SELF ? DBNotifyCoordinator<NOTIFY> : SELF,
        notify:NOTIFY
    })=>MPromise<void>;
    /**开始重连之前 */
    onReconnect:(arg:{
        coordinator:unknown extends SELF ? DBNotifyCoordinator<NOTIFY> : SELF,
    })=>MPromise<void>;
    /**开始链接之前 */
    onConnect:(arg:{
        coordinator:unknown extends SELF ? DBNotifyCoordinator<NOTIFY> : SELF,
    })=>MPromise<void>;
}>{
    protected notifyClient: PoolClient | undefined;
    /**使缓存协调器订阅数据库的操作通知频道
     * 连接失败与运行中断线共用同一套重试逻辑, 并按指数退避重连
     * @param mgr           - 数据库管理器
     * @param targetChannel - 订阅目标频道
     */
    async subscribeNotify(mgr: DBManager, targetChannel: string) {
        /**连续重连次数, 连接成功后清零 */
        let retryCount = 0;
        /**重连单飞去重器, 同一频道并发只保留一条重连链 */
        const flight = new PromiseFlight();

        /**摘除当前连接并清理监听器, 避免重连时泄漏
         * 以 release(true) 销毁而非归还连接池: 该链接带有 LISTEN 状态与自定义监听器, 不可复用
         */
        const detach = () => {
            const cur = this.notifyClient;
            if (cur == undefined) return;
            this.notifyClient = undefined;
            try {
                cur.removeAllListeners();
                cur.release(true);
            } catch {}
        };

        // 释放上一个 subscribeNotify 订阅的链接, 避免重复订阅时泄漏
        detach();

        /**安排下一次重连 指数退避且不超过上限
         * 并发调用已被 flight 按频道去重, 复用同一条重连链
         */
        const scheduleRetry = async () => {
            if (mgr.exiting || mgr.stoping) return detach();
            // 释放上一个链接, 避免重连时泄漏
            detach();

            const delay = Math.min(RETRY_BASE_MS * 2 ** retryCount, RETRY_MAX_MS);
            retryCount++;
            SLogger.warn(`DBNotifyCoordinator.subscribeNotify ${delay}ms 后重连`);

            //在下一个 setup 前 detach 必定完成
            await wait(delay);
            //不等待 setup 完成: 尽快交还 flight 的频道key, 使后续重连排程不被本链占位阻塞
            void setup();
        };

        const setup = async () => {
            if (mgr.exiting || mgr.stoping) return detach();
            //先让出一个宏任务位再发起连接
            //setup 可能由 flight 的 task 直接调起, 此时该频道的key仍被持有; 若连接在微任务内立刻失败,
            //下方 catch 中的 flight.run 会撞上自己的占位而静默返回, 重连链就此断掉不会再重试
            //宏任务必定排在 microtask 队列清空之后, 让出后key已释放, catch 中的重排必定生效
            await wait(100);
            await (this.invokeEvent as any)('onConnect',{coordinator:this});
            // 清空当前缓存 —— **只在重连时做**
            // #region
            // 断线期间的通知已经丢了，缓存里那些条目**无法再被更新**，
            // 留着就是脏数据；重连后清空让它们按需重建，这是 `clean()` 的本意。
            //
            // ⚠️ **首次订阅不能清**（实测踩到，2026-10-18）
            // `setup()` 在**第一次**挂上 `LISTEN` 之前也要等这 100ms。
            // 若此时无条件 `clean()`，就把「注入协调器之后、LISTEN 建立之前」
            // 这段时间里老老实实写进缓存的条目**整个抹掉**。
            // 更糟的是它没有任何痕迹：随后收到通知走 `update` 分支，
            // 而 `tryUpdateCache` 开头就 `if (cacheData == null) return;`
            // —— 静默什么都不做，表现为「缓存里查不到」。
            //
            // 判据用 `retryCount`：它在连接成功后清零，故 `> 0` 恰好表示
            // 「这是 `scheduleRetry` 排出来的重连」，而非首次订阅。
            // #endregion
            if (retryCount > 0) {
                SLogger.warn(`DBNotifyCoordinator.subscribeNotify 重连成功前清空缓存(重连次数:${retryCount})`);
                await (this.invokeEvent as any)('onReconnect',{coordinator:this});
            }

            try {
                const cur = await mgr._pool.connect();
                this.notifyClient = cur;
                await cur.query(`LISTEN ${targetChannel};`);

                // 建立期间可能已开始关停, 此链接作废
                if (mgr.exiting || mgr.stoping) return detach();

                // 连接成功 重置退避次数
                retryCount = 0;

                // 处理通知
                cur.on('notification', async msg => {
                    const { channel, payload } = msg;
                    if (channel !== targetChannel || payload == undefined) return;
                    try {
                        const notify = JSON.parse(payload) as NOTIFY;
                        await this.proc(notify);
                    } catch (err) {
                        SLogger.error(`DBNotifyCoordinator.subscribeNotify 处理通知失败`, err);
                    }
                });

                // 监听错误和结束, 触发重连
                // 用 once 而非 on: 触发即自动摘除, error 与 end 连发时不会重复排程
                cur.once('error', err => {
                    SLogger.error(`DBNotifyCoordinator.subscribeNotify listener错误, 开始重连`, err);
                    void flight.run(targetChannel, scheduleRetry);
                });
                cur.once('end', () => {
                    SLogger.warn(`DBNotifyCoordinator.subscribeNotify listener断开, 开始重连`);
                    void flight.run(targetChannel, scheduleRetry);
                });

            } catch (err) {
                // 连接失败与断线走同一重试路径, 不向外冒泡
                // 若在此处抛出, 将成为无人接管的 rejection 并触发进程级的 fail-fast 退出
                SLogger.warn(`DBNotifyCoordinator.subscribeNotify 订阅失败, 稍后重试`, err);
                void flight.run(targetChannel, scheduleRetry);
            }
        };

        // **不要给这个 id 赋值**（指挥官定, 实测踩到 2026-10-19）
        // #region
        // `EventSystem` 以 id 为键, 同 id 注册会**覆盖**而非追加。
        // 曾用 `db-cache-subscribe-notify-${targetChannel}` —— 只按频道区分,
        // 于是**同一个频道上的两个 coordinator 实例**仍会撞 id:
        // 后注册者把先注册者的 detach 顶掉, 前者的 `notifyClient` 永不归还,
        // `pool.end()` 就一直等这条被借出的连接, 表现为 `manager.stop()` 挂死
        // （实测: 两个 mock 协调器同听 'operation', stop 卡满 30s 超时）。
        //
        // 省略 id 时 `registerEvent` 会自动填 `JsFunc.genUUID()`,
        // 每个实例一个唯一标识, 从根上消除冲突。
        // 该 id 无需被外部按名引用, 因此不必也不应写死。
        // #endregion
        mgr.registerEvent('onstop', {
            handler: detach
        });

        await setup();
    }
    /**处理通知 */
    async proc(notify:NOTIFY):Promise<void>{
        await (this.invokeEvent as any)(notify.table ,({ coordinator:this,  notify }));
        await (this.invokeEvent as any)('onNotify'   ,({ coordinator:this,  notify }));
        return
    }
}