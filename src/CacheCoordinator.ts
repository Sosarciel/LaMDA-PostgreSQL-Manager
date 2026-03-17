import { AwaitInited, EventSystem, JObject, MPromise, NeedInit, SmartCache } from "@zwa73/js-utils";
import { DBManager } from "./Manager";
import { assertType, ivk, match, SLogger } from "@zwa73/utils";
import { DBJsonDataStruct } from "./JsonDataStruct";
import { UtilDB } from "./UtilDB";

type CacheEntry =
    | {key:string,struct:any}
    | {key:string,struct:any,notify:DBOperation<string,unknown>};

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
    constructor(arg:{ cache:SmartCache<SET['key'],SET['struct']> }){
        super();
        this.cache = arg.cache;
    }
    /**使缓存协调器订阅数据库的操作通知频道
     * @param mgr           - 数据库管理器
     * @param tarhetChannel - 订阅目标频道
     */
    async subscribeNotify(mgr:DBManager, tarhetChannel:string){
        const setupListener = async () => {
            const listener = await mgr._pool.connect();
            await listener.query(`LISTEN ${tarhetChannel};`);
            // 处理通知
            listener.on('notification', async msg => {
                const { channel, payload } = msg;
                if(channel !== tarhetChannel) return;
                if(payload == undefined ) return;
                try{
                    const notify = JSON.parse(payload) as ExtNotify<SET>;
                    await this.proc(notify);
                }catch(err){
                    SLogger.error(`DBCacheCoordinator.subscribeNotify 处理通知失败`,err);
                }
            });
            // 监听错误和结束, 触发重连
            listener.on('error', async err => {
                if(mgr.exiting || mgr.stoping) return;
                SLogger.error(`DBCacheCoordinator.subscribeNotify listener错误, 开始重连`,err);
                try { listener.release(); } catch {}
                setTimeout(setupListener, 2000); // 延迟重连
            });
            listener.on('end', async () => {
                if(mgr.exiting || mgr.stoping) return;
                SLogger.warn(`DBCacheCoordinator.subscribeNotify listener断开, 开始重连`);
                try { listener.release(); } catch {}
                setTimeout(setupListener, 2000);
            });
            mgr.registerEvent('onstop',{handler:async ()=>{
                try{
                    listener.removeAllListeners();
                    listener.release();
                }catch{}
            }})
        }
        await setupListener();
    }
    /**获取缓存 */
    getCache<K extends SET['key']>(key:K):ExtStruct<SET,K>|undefined{
        return this.cache.get(key) as any;
    }
    /**设置缓存 */
    setCache<K extends SET['key']>(key:K,value:ExtStruct<SET,K>):void{
        this.cache.set(key,value as any);
    }
    /**检视缓存, 不触发提升 */
    peekCache<K extends SET['key']>(key:K):ExtStruct<SET,K>|undefined{
        return this.cache.peek(key) as any;
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
        if(cache!=undefined) return cache;
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
    setCacheIfNotExist<K extends SET['key'], R extends ExtStruct<SET,K>|undefined>(key:K,value:R):void{
        if(this.hasCache(key)) return;
        this.setCache(key,value);
    }
    /**检查缓存是否存在 */
    hasCache<K extends SET['key']>(key:K){
        return this.cache.has(key);
    }
}

type LastRow<T extends DBOperation<string,any>> = T extends { new: infer R } ? R : T extends { old: infer R } ? R : never;
//type LastRow<T extends DBOperation<string,any>> = Extract<T,{new:any}>['new']|Extract<T,{old:any}>['old'];
export type DBJsonDataCacheCoordinatorOption<SET extends CacheEntry>= {
    table:{[K in ExtNotify<SET>['table']]?:{
        /**获取缓存键 */
        getKey:(row:LastRow<Extract<SET,{notify:{table:K}}>['notify']>)=>MPromise<Extract<SET,{notify:{table:K}}>['key']>,
        /**解包通知为行数据
         * 如果是快照则应该在此直接从数据库拉取全量数据
         */
        unwarp:(row:LastRow<Extract<SET,{notify:{table:K}}>['notify']>)=>MPromise<Extract<SET,{notify:{table:K}}>['struct']>,
        /**判断是否需要从数据库拉取全量数据 */
        isSnapshot:(row:LastRow<Extract<SET,{notify:{table:K}}>['notify']>)=>MPromise<boolean>,
    }},
}


type JsonCacheEntry =
    | {key:string,struct:DBJsonDataStruct<unknown>}
    | {key:string,struct:DBJsonDataStruct<unknown>,notify:DBOperation<string,DBJsonDataStruct<unknown>>};

/**针对单列json数据的缓存协调器
 * 将会依照option以 weight=0 的事件自动处理标准行缓存
 * 需配合 DBJsonDataStruct 与 jsonb_merge_and_clean BEFORE 触发器
 * 确保sql处理data列时, 浅层合并, undefined 为忽略 null 为删除(合并后jsonb_strip_nulls), 浅层不存储null
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

                        const lastRow = ('new' in notify) ? notify.new : notify.old;
                        const key = await fixedOpt.getKey(lastRow as any);

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

        // 过滤重复 data_hash (提取 lastRow 交由 TS infer 安全推导)
        const lastRow = ('new' in notify) ? notify.new : notify.old;
        const key = await fixedOpt.getKey(lastRow as any);
        const cacheData = this.cache.peek(key);

        if (
            cacheData?.data?.data_hash != null &&
            cacheData.data.data_hash === lastRow.data?.data_hash
        ) return;

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
        notify: Extract<ExtNotify<SET>, { table: string }> // 直接传入原始 Notify, 利用内部 match 解构
    ): Promise<void> {
        const tableName = notify.table as keyof DBJsonDataCacheCoordinatorOption<SET>['table'];
        const fixedOpt = this.option.table[tableName];
        if(fixedOpt == undefined){
            SLogger.warn(`DBJsonDataCacheCoordinator.procStandardEvent 错误 未配置表单${notify.table}`);
            return;
        }

        // 尝试提取新数据
        const newdata = await match(notify.op, {
            // delete 无需unwarp全量数据 直接返回
            delete: () => void this.cache.remove(key),
            // 若为快照, 不主动拉取新数据维护 直接返回
            insert: async () => (await fixedOpt?.isSnapshot(notify as any)) ? this.cache.remove(key) : fixedOpt.unwarp(notify as any),
            update: async () => (await fixedOpt?.isSnapshot(notify as any)) ? this.cache.remove(key) : fixedOpt.unwarp(notify as any),
            // 主动set一定触发完整解包
            set: async () => {
                const unwarpedData = await fixedOpt.unwarp(notify as any);
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
        assertType<Exclude<ExtNotify<SET>,{op:'delete'}>>(notify);

        await match(notify.op, {
            insert: () => this.tryUpdateCache(key, newdata),
            update: () => this.tryUpdateCache(key, newdata),
            set: () => this.cache.has(key)
                ? this.tryUpdateCache(key, newdata, true)
                : this.cache.set(key, newdata),
        });
    }

    /**尝试更新某个缓存
     * @param key     - 缓存键
     * @param newdata - 新数据
     * @param isSet   - 是否为set操作, set操作将会在本地额外运行一次 jsonb_merge_and_clean 模拟数据库行为, 其他操作视为完全同步
     */
    async tryUpdateCache<K extends SET['key']>(
        key: K,
        newdata: ExtStruct<SET, K>,
        isSet = false
    ) {
        const cacheData = this.cache.peek(key);
        if (cacheData == undefined) return;

        // 因为 DBJsonDataStruct 是 DeepReadonly, 在内部执行变异时, 我们显式转为字典态进行安全操作
        const targetData = cacheData.data as JObject;
        const sourceData = newdata.data as JObject;

        const newData = isSet
            ? UtilDB.mergeAndClean(targetData,sourceData)
            : sourceData;

        // 删除未出现在新数据中的字段
        for (const k of Object.keys(targetData)) {
            if (!(k in newData)) delete targetData[k];
        }

        // 完整合并
        Object.assign(targetData, newData);
    }
}
