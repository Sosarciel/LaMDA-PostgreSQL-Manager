import { EventSystem, MPromise, SmartCache } from "@zwa73/js-utils";
import { DBManager } from "./Manager";
import { SLogger } from "@zwa73/utils";
import { DBJsonDataStruct } from "./JsonDataStruct";

type CacheEntry =
    | {key:string,data:any}
    | {key:string,data:any,notify:DBOperation<string,unknown>};

type ExtData<T extends CacheEntry,K extends CacheEntry['key']> = Extract<T,{key:K}>['data'];
type ExtOP<T extends CacheEntry> = Extract<T,{notify:unknown}>['notify'];
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
> extends EventSystem<{[K in ExtOP<SET>['table']]:(arg:{
    coordinator:DBCacheCoordinator<SET>,
    op:Extract<ExtOP<SET>,{table:K}>
})=>MPromise<void>}&{
    onNotify:(arg:{
        coordinator:DBCacheCoordinator<SET>,
        op:ExtOP<SET>
    })=>MPromise<void>;
}>{
    cache:SmartCache<SET['key'],SET['data']>;
    constructor(arg:{ cache:SmartCache<SET['key'],SET['data']> }){
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
                const notify = JSON.parse(payload) as ExtOP<SET>;
                this.proc(notify);
            });
            // 监听错误和结束，触发重连
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
    getCache<K extends SET['key']>(key:K):ExtData<SET,K>|undefined{
        return this.cache.get(key) as any;
    }
    /**设置缓存 */
    setCache<K extends SET['key']>(key:K,value:ExtData<SET,K>):void{
        this.cache.set(key,value as any);
    }
    /**检视缓存, 不触发提升 */
    peekCache<K extends SET['key']>(key:K):ExtData<SET,K>|undefined{
        return this.cache.peek(key) as any;
    }
    /**移除缓存 */
    removeCache<K extends SET['key']>(key:K):void{
        this.cache.remove(key);
    }
    /**处理通知 */
    async proc(op:ExtOP<SET>):Promise<void>{
        await (this.invokeEvent as any)(op.table  ,({ coordinator:this, op }));
        await (this.invokeEvent as any)('onNotify',({ coordinator:this, op }));
        return
    }
    /**尝试获取缓存, 如果不存在则以func的结果设置缓存, 返回undefined时不做处理
     * @param key  - 缓存键
     * @param func - 缓存不存在时执行的函数
     * @returns 缓存数据
     */
    async getOrSetCache<K extends SET['key'], R extends ExtData<SET,K>|undefined>(key:K,func:()=>MPromise<R>):Promise<R>{
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
    setCacheIfNotExist<K extends SET['key'], R extends ExtData<SET,K>|undefined>(key:K,value:R):void{
        if(this.hasCache(key)) return;
        this.setCache(key,value);
    }
    /**检查缓存是否存在 */
    hasCache<K extends SET['key']>(key:K){
        return this.cache.has(key);
    }
}


type LastRow<T extends DBOperation<string,any>> = Extract<T,{new:any}>['new']|Extract<T,{old:any}>['old'];
export type DBJsonDataCacheCoordinatorOption<SET extends CacheEntry>= {
    table:{[K in ExtOP<SET>['table']]?:{
        getKey:(row:LastRow<Extract<SET,{notify:{table:K}}>['notify']>)=>Extract<SET,{notify:{table:K}}>['key']
    }},
}


type JsonCacheEntry =
    | {key:string,data:DBJsonDataStruct<unknown>}
    | {key:string,data:DBJsonDataStruct<unknown>,notify:DBOperation<string,DBJsonDataStruct<unknown>>};

/**针对单列json数据的缓存协调器 */
export class DBJsonDataCacheCoordinator<
SET extends JsonCacheEntry,
OPT extends DBJsonDataCacheCoordinatorOption<SET>,
> extends DBCacheCoordinator<SET>{
    option:OPT;
    constructor(arg:{
        option:OPT,
        cache:SmartCache<SET['key'],SET['data']>
    }){
        super(arg);
        this.option = arg.option;
    }
    override async proc(op: ExtOP<SET>): Promise<void> {
        const fixedOpt = (this.option.table as any)[op.table];
        if(fixedOpt==undefined){
            SLogger.warn(`DBJsonDataCacheCoordinator.proc 错误 未配置表单${op.table}`);
            return;
        }
        const lastRow = ('new' in op) ? op.new : op.old;
        const cacheData = this.cache.peek(fixedOpt.getKey(lastRow)) as any as DBJsonDataStruct<unknown>|undefined
        if(cacheData?.data.data_hash == lastRow.data.data_hash) return;

        await (this.invokeEvent as any)(op.table  ,({ coordinator:this, op }));
        await (this.invokeEvent as any)('onNotify',({ coordinator:this, op }));
        return;
    }
}