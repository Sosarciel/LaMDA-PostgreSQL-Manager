import { MPromise, SmartCache } from "@zwa73/js-utils";
import { DBManager } from "./Manager";

type CacheType = {key:string,data:any};
type ExtractCacheData<T extends CacheType,K extends CacheType['key']> = Extract<T,{key:K}>['data'];

/**数据库缓存协调器
 * 用于连接pgsql的operation频道, 接受一个OP类型的操作通知
 * @template KS - 基于 CacheType 的联合类型 如  { key:`a-${string}`; data:A; } | { key:`b-${string}`;  data:B; }
 * @template OP - 数据库操作通知集, 必须在pgsql设置对应格式的notification, 并使用subscribeNotify订阅对应频道
 * @example ```typescript
 * type DBOperation<T extends string,R> =
 *     | { op:'insert'; table:T; new:R;}
 *     | { op:'update'; table:T; new:R; old:R;}
 *     | { op:'delete'; table:T; old:R;}
 *     | { op:'manual_update'; table:T; new:R; }
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
KS extends CacheType,
OP extends {table:string},
> {
    handler:(cache:DBCacheCoordinator<KS,OP>,op:OP)=>any;
    cache:SmartCache<KS['key'],KS['data']>;
    constructor(arg:{
        handler:(cache:DBCacheCoordinator<KS,OP>,op:OP)=>any,
        cache:SmartCache<KS['key'],KS['data']>
    }){
        this.handler = arg.handler;
        this.cache = arg.cache;
    }
    /**使缓存协调器订阅数据库的操作通知频道
     * @param mgr           - 数据库管理器
     * @param tarhetChannel - 订阅目标频道
     */
    async subscribeNotify(mgr:DBManager, tarhetChannel:string){
        const listener = await mgr._pool.connect();
        await listener.query(`LISTEN ${tarhetChannel};`);
        // 处理通知
        listener.on('notification', async msg => {
            const { channel, payload } = msg;
            if(channel !== tarhetChannel) return;
            if(payload == undefined ) return;
            const notify = JSON.parse(payload) as OP;
            await this.proc(notify);
        });
    }
    /**获取缓存 */
    getCache<K extends KS['key']>(key:K):ExtractCacheData<KS,K>|undefined{
        return this.cache.get(key) as any;
    }
    /**设置缓存 */
    setCache<K extends KS['key']>(key:K,value:ExtractCacheData<KS,K>):void{
        this.cache.set(key,value as any);
    }
    /**检视缓存, 不触发提升 */
    peekCache<K extends KS['key']>(key:K):ExtractCacheData<KS,K>|undefined{
        return this.cache.peek(key) as any;
    }
    /**移除缓存 */
    removeCache<K extends KS['key']>(key:K):void{
        this.cache.remove(key);
    }
    /**处理通知 */
    proc(op:OP):MPromise<void>{
        return this.handler(this,op);
    }
    /**尝试获取缓存, 如果不存在则以func的结果设置缓存, 返回undefined时不做处理
     * @param key  - 缓存键
     * @param func - 缓存不存在时执行的函数
     * @returns 缓存数据
     */
    async getOrSetCache<K extends KS['key'], R extends ExtractCacheData<KS,K>|undefined>(key:K,func:()=>MPromise<R>):Promise<R>{
        const cache = this.getCache(key);
        if(cache!=undefined) return cache;
        const result = await func();
        if(result!=undefined)
            this.setCache(key,result);
        return result;
    }
    /**检查缓存是否存在 */
    hasCache<K extends KS['key']>(key:K){
        return this.cache.has(key);
    }
}



///**数据库操作通知数据 */
//type DBOperationNotify =
//DBOperation<'message'       ,1>       |
//DBOperation<'conversation'  ,2>  |
//DBOperation<'participation' ,3> |
//DBOperation<'user_data'     ,4>;
//
//type UserDataKey = `user_data user_id:${string}`;
//type MessageKey  = `message message_id:${string}`;
//export type ConvKey     = `conversation conversation_id:${string}`;
//type PartKey     = `participation char_id:${string}-thread_id:${string}`;
//type ChoiceKey   = `choice_list conversation_id:${string}-parent_message_id:${string}`;
//
//type CacheTable = {
//    user_data:{
//        key:UserDataKey;
//        data:1;
//    },
//    message:{
//        key:MessageKey;
//        data:2;
//    },
//    conversation:{
//        key:ConvKey;
//        data:3;
//    },
//    participation:{
//        key:PartKey;
//        data:4;
//    },
//    choice_list:{
//        key:ChoiceKey;
//        data:5[];
//    }
//};
//
//
//const DBCache = new DBCacheCoordinator<CacheTable, DBOperationNotify>({
//    handler: null as any,
//    cache: null as any,
//});
//
//DBCache.getOrSetCache(`user_data user_id:123` as UserDataKey,()=>1)