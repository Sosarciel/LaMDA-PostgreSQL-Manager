import { EventSystem, MPromise, NeedInit, SmartCache } from "@zwa73/js-utils";
import { DBManager } from "./Manager";
import { ivk, match, SLogger } from "@zwa73/utils";
import { DBJsonDataStruct } from "./JsonDataStruct";

type CacheEntry =
    | {key:string,struct:any}
    | {key:string,struct:any,notify:DBOperation<string,unknown>};

type ExtData<T extends CacheEntry,K extends CacheEntry['key']> = Extract<T,{key:K}>['struct'];
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
                const notify = JSON.parse(payload) as ExtNotify<SET>;
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
    table:{[K in ExtNotify<SET>['table']]?:{
        /**获取缓存键 */
        getKey:(row:LastRow<Extract<SET,{notify:{table:K}}>['notify']>)=>MPromise<Extract<SET,{notify:{table:K}}>['key']>,
        /**解包通知为行数据 */
        unwarp:(row:LastRow<Extract<SET,{notify:{table:K}}>['notify']>)=>MPromise<Extract<SET,{notify:{table:K}}>['struct']>,
    }},
}


type JsonCacheEntry =
    | {key:string,struct:DBJsonDataStruct<unknown>}
    | {key:string,struct:DBJsonDataStruct<unknown>,notify:DBOperation<string,DBJsonDataStruct<unknown>>};

/**针对单列json数据的缓存协调器 */
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
        this.inited = ivk(async ()=>{
            for(const table in this.option.table){
                // 修复：必须注册为泛型表名
                const tableName = table as ExtNotify<SET>['table'];
                this.registerEvent(table,{
                    handler:async ({notify})=>{
                        const fixedOpt = this.option.table[tableName];
                        if (!fixedOpt) return;

                        const lastRow = ('new' in notify) ? notify.new : notify.old;
                        const key = await fixedOpt.getKey(lastRow as any);

                        await this.procEvent(key, notify);
                    }
                })
            }
        });
    }
    override async proc(notify: ExtNotify<SET>): Promise<void> {
        const fixedOpt = (this.option.table)[notify.table as keyof DBJsonDataCacheCoordinatorOption<SET>['table']];
        if(fixedOpt==undefined){
            SLogger.warn(`DBJsonDataCacheCoordinator.proc 错误 未配置表单${notify.table}`);
            return;
        }

        //过滤重复data_hash
        const lastRow = ('new' in notify) ? notify.new : notify.old;
        const cacheData = this.cache.peek(await fixedOpt.getKey(lastRow)) as any as DBJsonDataStruct<unknown>|undefined
        if( cacheData?.data.data_hash!=null &&
            cacheData?.data.data_hash == lastRow.data.data_hash
        ) return;

        await (this.invokeEvent as any)(notify.table ,({ coordinator:this, notify }));
        await (this.invokeEvent as any)('onNotify'   ,({ coordinator:this, notify }));
        return;
    }
    async procEvent<K extends SET['key']>(
        key:K,notify: Extract<SET,{op:string,key:K,notify:any}>['notify']
    ): Promise<void> {
        const fixedOpt = (this.option.table)[notify.table as keyof DBJsonDataCacheCoordinatorOption<SET>['table']];
        if(fixedOpt==undefined){
            SLogger.warn(`DBJsonDataCacheCoordinator.procEvent 错误 未配置表单${notify.table}`);
            return;
        }

        //尝试提取新数据
        const newdata = await match(notify.op,{
            // delete 无需unwarp全量数据 直接返回
            delete:()=>void this.cache.remove(key),
            // 若为快照, 不主动拉取新数据维护 直接返回
            insert:()=>fixedOpt?.unwarp(notify) ?? this.cache.remove(key),
            update:()=>fixedOpt?.unwarp(notify) ?? this.cache.remove(key),
            set   :async ()=>{
                const unwarpedData = await fixedOpt?.unwarp(notify);
                //尝试解构快照数据
                if(unwarpedData==undefined){
                    SLogger.warn(`DialogStore 缓存 commonProc 失败 key:${key} opera:`,notify);
                    return;
                }
                return unwarpedData;
            },
        });
        if(newdata==undefined) return;

        // insert update delete 为数据库直接通知
        // set 为手动同步 实际上不会拉取数据
        match(notify.op,{
            //如果直接得到数据则维护
            insert:()=>this.tryUpdateCache(key,newdata),
            update:()=>this.tryUpdateCache(key,newdata),
            //如果缓存存在则更新,不存在则设置新缓存
            set   :()=>this.cache.has(key)
                ? this.tryUpdateCache(key,newdata,true)
                : this.cache.set(key,newdata),
        });
    }
    async tryUpdateCache<K extends SET['key']>(
        key:K,newdata:Extract<SET,{op:string,key:K,notify:any}>['struct'],isSet=false
    ){
        const cacheData = this.cache.peek(key) as any as Extract<SET,{op:string,key:K,notify:any}>['struct']|undefined;
        if(cacheData==undefined) return;

        if(isSet){
            // 手动set下null为删除 undefined为忽略
            // 删除被显式设置null的字段
            for (const key of Object.keys(cacheData.data)) {
                if ((newdata.data as any)[key] === null)
                    delete (cacheData.data as any)[key];
            }
        }else{
            // 其他通知为全量数据
            // 删除未出现在新数据中的字段
            for (const key of Object.keys(cacheData.data)) {
                if (!(key in newdata.data))
                    delete (cacheData.data as any)[key];
            }
        }

        //修正data排除null与undefiend
        const fixedData = Object.fromEntries(Object
            .entries(newdata.data).filter(([k, v]) => v != null));

        //完整合并
        Object.assign(cacheData.data,fixedData);
    };
}
