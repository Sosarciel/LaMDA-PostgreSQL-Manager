import { MPromise, SmartCache } from "@zwa73/js-utils";
import { DBManager } from "./Manager";

type CacheTypeSet = {key:string,data:any};
type ExtractCacheData<T extends CacheTypeSet,K extends CacheTypeSet['key']> = Extract<T,{key:K}>['data'];

/**数据库缓存协调器
 * 用于连接pgsql的operation频道, 接受一个OP类型的操作通知
 * @template KT - 缓存键->值类型表
 * @template OP - 数据库操作通知集
 * @example ```sql
-- 操作通知触发器样例
CREATE OR REPLACE FUNCTION func__common__after_delete_or_insert_or_update()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('operation', json_strip_nulls(json_build_object(
        'op', LOWER(TG_OP),
        'table', TG_TABLE_NAME,
        'old', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD) ELSE NULL END,
        'new', CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN row_to_json(NEW) ELSE NULL END
    ))::text);
    RETURN NULL;
END;
$$;
```
 */
export class DBCacheCoordinator<
KT extends CacheTypeSet,
OP extends {table:string},
> {
    handler:(cache:DBCacheCoordinator<KT,OP>,op:OP)=>any;
    cache:SmartCache<KT['key'],KT['data']>;
    constructor(arg:{
        handler:(cache:DBCacheCoordinator<KT,OP>,op:OP)=>any,
        cache:SmartCache<KT['key'],KT['data']>
    }){
        this.handler = arg.handler;
        this.cache = arg.cache;
    }
    /**使缓存协调器订阅数据库的操作通知频道 */
    async subscribeNotify(mgr:DBManager){
        const listener = await mgr._pool.connect();
        await listener.query('LISTEN operation;');
        // 处理通知
        listener.on('notification', async msg => {
            const { channel, payload } = msg;
            if(channel !== 'operation') return;
            if(payload == undefined ) return;
            const notify = JSON.parse(payload) as OP;
            await this.proc(notify);
        });
    }
    /**获取缓存 */
    getCache<K extends KT['key']>(key:K):ExtractCacheData<KT,K>|undefined{
        return this.cache.get(key) as any;
    }
    /**设置缓存 */
    setCache<K extends KT['key']>(key:K,value:ExtractCacheData<KT,K>):void{
        this.cache.set(key,value as any);
    }
    /**检视缓存, 不触发提升 */
    peekCache<K extends KT['key']>(key:K):ExtractCacheData<KT,K>|undefined{
        return this.cache.peek(key) as any;
    }
    /**移除缓存 */
    removeCache<K extends KT['key']>(key:K):void{
        this.cache.remove(key);
    }
    /**处理通知 */
    proc(op:OP):MPromise<void>{
        return this.handler(this,op);
    }
    /**尝试获取缓存, 如果不存在则以func的结果设置缓存, 返回undefined时不做处理 */
    async getOrSetCache<K extends KT['key'], R extends ExtractCacheData<KT,K>|undefined>(key:K,func:()=>MPromise<R>):Promise<R>{
        const cache = this.getCache(key);
        if(cache!=undefined) return cache;
        const result = await func();
        if(result!=undefined)
            this.setCache(key,result);
        return result;
    }
    /**检查缓存是否存在 */
    hasCache<K extends KT['key']>(key:K){
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