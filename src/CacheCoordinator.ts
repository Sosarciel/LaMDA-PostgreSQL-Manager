import { AwaitInited, EventSystem, JObject, MPromise, NeedInit, PromiseFlight, SmartCache } from "@zwa73/js-utils";
import type { PoolClient } from "pg";
import { DBManager } from "./Manager";
import { assertType, ivk, match, SLogger } from "@zwa73/utils";
import { DBJsonDataStruct } from "./JsonDataStruct";
import { UtilDB } from "./UtilDB";

/**退避等待 定时器 unref 不阻止进程退出 */
const wait = (ms: number) => new Promise<void>(resolve => {
    setTimeout(resolve, ms).unref();
});
/**重连退避基础间隔 毫秒 */
const RETRY_BASE_MS = 1000;
/**重连退避间隔上限 毫秒 */
const RETRY_MAX_MS = 60_000;

type CacheEntry =
    | {key:string,struct:object}
    | {key:string,struct:object,notify:DBOperation<string,unknown>};

type ExtStruct<T extends CacheEntry,K extends CacheEntry['key']> = Extract<T,{key:K}>['struct'];
type ExtNotify<T extends CacheEntry> = Extract<T,{notify:unknown}>['notify'];

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

/**数据库缓存协调器
 * 用于连接pgsql的operation频道, 接受一个OP类型的操作通知
 * @template SET - 基于 CacheType 的联合类型 如  { key:`a-${string}`; data:A; } | { key:`b-${string}`;  data:B; }
 * @template OP - 数据库操作通知集, 必须在pgsql设置对应格式的notification, 并使用subscribeNotify订阅对应频道
 * @example ```typescript
 * type DBOperationNotify =
 *     | DBOperation<'message'       , MessageDbRow>
 *     | DBOperation<'conversation'  , ConversationDbRow>
 *     | DBOperation<'participation' , ParticipationDbRow>
 *     | DBOperation<'user_data'     , UserDataDbRow>;
 * type UserDataKey = `user_data=user_id:${string}`;
 * type MessageKey  = `message=message_id:${string}`;
 * type ConvKey     = `conversation=conversation_id:${string}`;
 * type PartKey     = `participation=char_id:${string}-thread_id:${string}`;
 * type ChoiceKey   = `choice_list=conversation_id:${string}-parent_message_id:${string}`;
 * type CacheTypeSet =
 *     | { key:UserDataKey; data:UserDataDbRow; }
 *     | { key:MessageKey;  data:MessageDbRow; }
 *     | { key:ConvKey;     data:ConversationDbRow; }
 *     | { key:PartKey;     data:ParticipationDbRow; }
 *     | { key:ChoiceKey;   data:MessageDbRow[]; }
 * const DBCache = new DBCacheCoordinator<CacheTypeSet, DBOperationNotify>({
 *     handler: (cache,op)=>{...},
 *     cache: new SmartCache<CacheTypeSet['key'],CacheTypeSet['data']>,
 * });
 * ```
 * @example ```sql
 * -- 操作通知触发器样例
 * CREATE OR REPLACE FUNCTION func__common__after_delete_or_insert_or_update()
 * RETURNS trigger
 * LANGUAGE plpgsql AS $$
 * BEGIN
 *     PERFORM pg_notify('operation', json_strip_nulls(json_build_object(
 *         'op', LOWER(TG_OP),
 *         'table', TG_TABLE_NAME,
 *         'old', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD) ELSE NULL END,
 *         'new', CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN row_to_json(NEW) ELSE NULL END
 *     ))::text);
 *     RETURN NULL;
 * END;
 * $$;
 * ```
 */
export class DBCacheCoordinator<
    SET extends CacheEntry
> extends EventSystem<{[K in ExtNotify<SET>['table']]:(arg:{
    coordinator:DBCacheCoordinator<SET>,
    notify:Extract<ExtNotify<SET>,{table:K}>
})=>MPromise<void>}&{
    onNotify:(arg:{
        coordinator:DBCacheCoordinator<SET>,
        notify:ExtNotify<SET>
    })=>MPromise<void>;
}>{
    cache:SmartCache<SET['key'],SET['struct']>;
    private notifyClient: PoolClient | undefined;
    constructor(arg:{ cache:SmartCache<SET['key'],SET['struct']> }){
        super();
        this.cache = arg.cache;
    }
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
            SLogger.warn(`DBCacheCoordinator.subscribeNotify ${delay}ms 后重连`);

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
            // 清空当前缓存
            this.cache.clean();

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
                        const notify = JSON.parse(payload) as ExtNotify<SET>;
                        await this.proc(notify);
                    } catch (err) {
                        SLogger.error(`DBCacheCoordinator.subscribeNotify 处理通知失败`, err);
                    }
                });

                // 监听错误和结束, 触发重连
                // 用 once 而非 on: 触发即自动摘除, error 与 end 连发时不会重复排程
                cur.once('error', err => {
                    SLogger.error(`DBCacheCoordinator.subscribeNotify listener错误, 开始重连`, err);
                    void flight.run(targetChannel, scheduleRetry);
                });
                cur.once('end', () => {
                    SLogger.warn(`DBCacheCoordinator.subscribeNotify listener断开, 开始重连`);
                    void flight.run(targetChannel, scheduleRetry);
                });

            } catch (err) {
                // 连接失败与断线走同一重试路径, 不向外冒泡
                // 若在此处抛出, 将成为无人接管的 rejection 并触发进程级的 fail-fast 退出
                SLogger.warn(`DBCacheCoordinator.subscribeNotify 订阅失败, 稍后重试`, err);
                void flight.run(targetChannel, scheduleRetry);
            }
        };

        // 固定 id 注册一次, 重连不会重复堆积处理器
        mgr.registerEvent('onstop', {
            id: 'db-cache-subscribe-notify',
            handler: detach
        });

        await setup();
    }
    /**获取缓存 */
    getCache<K extends SET['key']>(key:K):ExtStruct<SET,K>|undefined{
        return this.cache.get(key);
    }
    /**设置缓存 */
    setCache<K extends SET['key']>(key:K,value:ExtStruct<SET,K>):void{
        this.cache.set(key,value);
    }
    /**检视缓存, 不触发提升 */
    peekCache<K extends SET['key']>(key:K):ExtStruct<SET,K>|undefined{
        return this.cache.peek(key);
    }
    /**移除缓存 */
    removeCache<K extends SET['key']>(key:K):void{
        this.cache.remove(key);
    }
    /**处理通知 */
    async proc(notify:ExtNotify<SET>):Promise<void>{
        await (this.invokeEvent as any)(notify.table ,({ coordinator:this,  notify }));
        await (this.invokeEvent as any)('onNotify'   ,({ coordinator:this,  notify }));
        return
    }
    /**尝试获取缓存, 如果不存在则以func的结果设置缓存, 返回undefined时不做处理
     * @param key  - 缓存键
     * @param func - 缓存不存在时执行的函数
     * @returns 缓存数据
     */
    async getOrSetCache<K extends SET['key'], R extends ExtStruct<SET,K>|undefined>(key:K,func:()=>MPromise<R>):Promise<R>{
        const cache = this.getCache(key);
        if(cache!=undefined) return cache as R;
        const result = await func();
        if(result!=undefined)
            this.setCache(key,result);
        return result;
    }
    /**如果键不存在则设置缓存
     * @param key   - 缓存键
     * @param value - 缓存值
     * @returns 缓存数据
     */
    setCacheIfNotExist<K extends SET['key'], R extends ExtStruct<SET,K>>(key:K,value:R):void{
        if(this.hasCache(key)) return;
        this.setCache(key,value);
    }
    /**检查缓存是否存在 */
    hasCache<K extends SET['key']>(key:K){
        return this.cache.has(key);
    }
    
    /**清理缓存资源 */
    dispose(){
        this.cache.dispose();
    }
}

type LastRow<T extends DBOperation<string,unknown>> = T extends { new: infer R } ? R : T extends { old: infer R } ? R : never;
export type DBJsonDataCacheCoordinatorOption<SET extends CacheEntry>= {
    table:{[K in ExtNotify<SET>['table']]?:{
        /**获取缓存键 */
        getKey:(row:LastRow<Extract<ExtNotify<SET>,{table:K}>>)=>MPromise<Extract<SET,{notify:{table:K}}>['key']>,
        /**解包通知为行数据
         * 如果是快照则应该在此直接从数据库拉取全量数据
         */
        unwarp:(row:LastRow<Extract<ExtNotify<SET>,{table:K}>>)=>MPromise<Extract<SET,{notify:{table:K}}>['struct']>,
        /**判断是否需要从数据库拉取全量数据 */
        isSnapshot?:(row:LastRow<Extract<ExtNotify<SET>,{table:K}>>)=>MPromise<boolean>,
        /**获取用于去重的hash */
        getHash?:(row:LastRow<Extract<ExtNotify<SET>,{table:K}>>|Extract<SET,{notify:{table:K}}>['struct'])=>MPromise<string|undefined|null>,
    }},
}


type JsonCacheEntry =
    | {key:string,struct:DBJsonDataStruct<unknown>}
    | {key:string,struct:DBJsonDataStruct<unknown>,notify:DBOperation<string,DBJsonDataStruct<unknown>>};

/**针对单列json数据的缓存协调器
 * 将会依照option以 weight=0 的事件自动处理标准行缓存
 * 需配合 DBJsonDataStruct
 */
export class DBJsonDataCacheCoordinator<
SET extends JsonCacheEntry,
> extends DBCacheCoordinator<SET> implements NeedInit{
    inited:Promise<void>;
    option:DBJsonDataCacheCoordinatorOption<SET>;
    constructor(arg:{
        option:DBJsonDataCacheCoordinatorOption<SET>,
        cache:SmartCache<SET['key'],SET['struct']>
    }){
        super(arg);
        this.option = arg.option;
        // 注册标准行缓存
        this.inited = ivk(async ()=>{
            for(const table in this.option.table){
                const tableName = table as ExtNotify<SET>['table'];
                this.registerEvent(table,{
                    handler:async ({notify})=>{
                        const fixedOpt = this.option.table[tableName];
                        if (!fixedOpt) return;

                        const lastRow = (('new' in notify) ? notify.new : notify.old) as LastRow<typeof notify>;
                        const key = await fixedOpt.getKey(lastRow);

                        await this.procStandardEvent(key, notify);
                    }
                })
            }
        });
    }

    @AwaitInited
    override async proc(notify: ExtNotify<SET>): Promise<void> {
        const tableName = notify.table as keyof DBJsonDataCacheCoordinatorOption<SET>['table'];
        const fixedOpt = this.option.table[tableName];
        if (fixedOpt == undefined) {
            SLogger.warn(`DBJsonDataCacheCoordinator.proc 错误 未配置表单${notify.table}`);
            return;
        }

        // @ts-ignore 因为泛型函数的动态调用, TS 很难完美匹配 this.invokeEvent 的联合类型, 这里可以用 ts-ignore 豁免
        await this.invokeEvent(notify.table, { coordinator: this, notify });
        // @ts-ignore
        await this.invokeEvent('onNotify'  , { coordinator: this, notify });
    }

    /**处理标准行缓存
     * @param key - 缓存键
     * @param notify - 通知
     */
    @AwaitInited
    async procStandardEvent<K extends SET['key']>(
        key: K,
        notify: Extract<ExtNotify<SET>, { table: string }>
    ): Promise<void> {
        // 直接处理delete
        if(notify.op == 'delete')
            return void this.cache.remove(key);

        const tableName = notify.table as keyof DBJsonDataCacheCoordinatorOption<SET>['table'];
        const fixedOpt = this.option.table[tableName];
        if(fixedOpt == undefined){
            SLogger.warn(`DBJsonDataCacheCoordinator.procStandardEvent 错误 未配置表单${notify.table}`);
            return;
        }

        // 得出更新行
        const lastRow = notify.new as LastRow<typeof notify>;

        // 依照hash去重
        const cacheKey = await fixedOpt.getKey(lastRow);
        const cacheData = this.cache.peek(cacheKey);
        if (cacheData != undefined){
            const cacheHash = await fixedOpt.getHash?.(cacheData);
            if(cacheHash != undefined && cacheHash == (await fixedOpt.getHash?.(lastRow)))
                return;
        }

        // 尝试提取新数据
        const newdata = await match(notify.op, {
            // insert/update可能快于set 如果采用 tryUnwarpNotifyData ?? CachePool.remove 将会导致已有的ref.data被删除
            // 进而导致set的更新无法正确刷入旧的ref.data
            insert: async () => this.cache.has(key) ? await fixedOpt.unwarp(lastRow) : undefined,
            update: async () => this.cache.has(key) ? await fixedOpt.unwarp(lastRow) : undefined,
            // 主动set一定触发完整解包
            set: async () => {
                const unwarpedData = await fixedOpt.unwarp(lastRow);
                //尝试解构快照数据
                if (unwarpedData == undefined) {
                    SLogger.warn(`DBJsonDataCacheCoordinator.procStandardEvent 缓存同步解包失败 key:${key} notify:`, notify);
                    return;
                }
                return unwarpedData;
            },
        });

        if (newdata == undefined) return;
        assertType<ExtStruct<SET, K>>(newdata);

        await match(notify.op, {
            insert: () => this.tryUpdateCache(key, newdata),
            update: () => this.tryUpdateCache(key, newdata),
            set: () => this.cache.has(key)
                ? this.tryUpdateCache(key, newdata)
                : this.cache.set(key, newdata),
        });
    }

    /**尝试更新某个缓存
     * @param key     - 缓存键
     * @param newdata - 新数据
     */
    async tryUpdateCache<K extends SET['key']>(
        key: K,
        newdata: ExtStruct<SET, K>
    ) {
        const cacheData = this.cache.peek(key);
        if (cacheData == undefined) return;

        // 因为 DBJsonDataStruct 是 DeepReadonly, 在内部执行变异时, 我们显式转为字典态进行安全操作
        const targetData = cacheData.data as JObject;
        const sourceData = newdata.data as JObject;

        // 递归清理 undefined（JSON 不支持 undefined）
        UtilDB.cleanUndefined(sourceData);

        // 删除未出现在新数据中的字段
        for (const k of Object.keys(targetData)) {
            if (!(k in sourceData)) delete targetData[k];
        }

        // 完整合并（全量替换）
        Object.assign(targetData, sourceData);
    }
}
