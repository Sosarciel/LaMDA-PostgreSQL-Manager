import { AwaitInited, JObject, MPromise, NeedInit, SmartCache } from "@zwa73/js-utils";
import { assertType, ivk, match, SLogger } from "@zwa73/utils";
import { DBJsonDataStruct } from "./JsonDataStruct";
import { UtilDB } from "./UtilDB";
import { DBNotifyCoordinator, DBOperation } from "./NotifyCoordinator";


/**缓存条目 */
type CacheEntry =
    | {key:string,struct:object}
    | {key:string,struct:object,notify:DBOperation<string,unknown>};

/**从CacheEntry提取struct */
type ExtStruct<T extends CacheEntry,K extends CacheEntry['key']> = Extract<T,{key:K}>['struct'];
/**从CacheEntry提取notify */
type ExtNotify<T extends CacheEntry> = Extract<T,{notify:unknown}>['notify'];



/**数据库缓存协调器
 * 用于连接pgsql的operation频道, 接受一个OP类型的操作通知
 * @template SET - 基于 CacheType 的联合类型 如  { key:`a-${string}`; data:A; } | { key:`b-${string}`;  data:B; }
 * @template OP - 数据库操作通知集, 必须在pgsql设置对应格式的notification, 并使用subscribeNotify订阅对应频道
 * #region
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
 * #endregion
 */
export class DBCacheCoordinator<
    SET extends CacheEntry,
    SELF = unknown
> extends DBNotifyCoordinator<
    ExtNotify<SET>,
    unknown extends SELF ? DBCacheCoordinator<SET> : SELF
> {
    cache:SmartCache<SET['key'],SET['struct']>;
    constructor(arg:{ cache:SmartCache<SET['key'],SET['struct']> }){
        super();
        this.cache = arg.cache;
        // 监听父类的重连事件，在断线重连成功前清空缓存
        this.registerEvent('onReconnect', {
            handler: () => {
                this.cache.clean();
            }
        });
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
        unwarp:(row:LastRow<Extract<ExtNotify<SET>,{table:K}>>)=>MPromise<Extract<SET,{notify:{table:K}}>['struct']|undefined>,
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
 * @template JSONSET  - 声明需自动化处理的标准 JSON 实体表，需包含所有表单（受 JsonCacheEntry 约束）
 * @template SET      - 底层缓存池实际容纳的全量条目集，可以接受表单衍生缓存（受 CacheEntry 约束，默认与 SET 相同）
 */
export class DBJsonDataCacheCoordinator<
    JSONSET extends JsonCacheEntry,
    SET extends CacheEntry = JSONSET
> extends DBCacheCoordinator<SET, DBJsonDataCacheCoordinator<JSONSET, SET>> implements NeedInit{
    inited:Promise<void>;
    option:DBJsonDataCacheCoordinatorOption<JSONSET>;
    constructor(arg:{
        option:DBJsonDataCacheCoordinatorOption<JSONSET>,
        cache:SmartCache<SET['key'],SET['struct']>
    }){
        super(arg);
        this.option = arg.option;
        // 注册标准行缓存
        this.inited = ivk(async ()=>{
            for(const table in this.option.table){
                const tableName = table as ExtNotify<JSONSET>['table'];
                this.registerEvent(tableName,{
                    //@ts-ignore 与 proc 相同：遍历动态表名注册时，TS 无法在泛型内自动分发联合事件签名
                    handler:async ({notify})=>{
                        const fixedOpt = this.option.table[tableName];
                        if (!fixedOpt) return;

                        const lastRow = (('new' in notify) ? notify.new : notify.old) as LastRow<typeof notify>;
                        const key = await fixedOpt.getKey(lastRow);

                        await this.procStandardEvent(key, notify as Extract<ExtNotify<JSONSET>, { table: typeof tableName }>);
                    }
                })
            }
        });
    }

    @AwaitInited
    override async proc(notify: ExtNotify<SET>): Promise<void> {
        const tableName = notify.table as keyof DBJsonDataCacheCoordinatorOption<JSONSET>['table'];
        const fixedOpt = this.option.table[tableName];
        if (fixedOpt == undefined) {
            SLogger.warn(`DBJsonDataCacheCoordinator.proc 错误 未配置表单${notify.table}`);
            return;
        }

        // @ts-ignore 因为泛型函数的动态调用, TS 很难完美匹配 this.invokeEvent 的联合类型, 这里 GPU/TS 可以用 ts-ignore 豁免
        await this.invokeEvent(notify.table, { coordinator: this, notify });
        // @ts-ignore
        await this.invokeEvent('onNotify'   , { coordinator: this, notify });
    }

    /**处理标准行缓存
     * @param key - 缓存键
     * @param notify - 通知
     */
    @AwaitInited
    async procStandardEvent<K extends JSONSET['key']>(
        key: K,
        notify: Extract<ExtNotify<JSONSET>, { table: string }>
    ): Promise<void> {
        // 直接处理delete
        // delete 无需unwarp全量数据 直接返回
        if(notify.op == 'delete')
            return void this.cache.remove(key);

        const tableName = notify.table as keyof DBJsonDataCacheCoordinatorOption<JSONSET>['table'];
        const fixedOpt = this.option.table[tableName];
        if(fixedOpt == undefined){
            SLogger.warn(`DBJsonDataCacheCoordinator.procStandardEvent 错误 未配置表单${notify.table}`);
            return;
        }

        // 得出更新行
        const lastRow = notify.new as LastRow<typeof notify>;

        // 依照hash去重
        const cacheData = this.cache.peek(key);
        if (cacheData != undefined){
            const cacheHash = await fixedOpt.getHash?.(cacheData as ExtStruct<JSONSET, JSONSET['key']>);
            if(cacheHash != undefined && cacheHash == (await fixedOpt.getHash?.(lastRow)))
                return;
        }

        // created_at 缓存同步问题说明：
        // 1. setConversation 设置缓存, created_at 完全由数据库触发器生成, ts端没有 created_at
        // 2. SQL INSERT/UPDATE 触发，发送 insert/update 通知
        // 3. insert 通知快于 set 时，缓存不存在，insert 被 CachePool.has(key) 防积极水化逻辑拦截而忽略
        // 4. insert 通知后到 或下一次 update 通知到达时，由于 data_hash 去重逻辑会排除 created_at 字段计算hash，update/insert 被跳过
        // 5. 导致 created_at 永远不会同步到缓存, 同理其他被 data_hash 忽略的字段也都不可能同步到本地缓存
        // 
        // 这是预期行为：去重逻辑避免重复处理，但代价是 created_at 不会同步
        // 解决方案：需要 created_at 时使用 ignoreCache:true 从数据库获取

        // 尝试提取新数据
        const newdata = await match(notify.op, {
            // insert/update可能快于set 如果采用 tryUnwarpNotifyData ?? CachePool.remove 将会导致已有的ref.data被删除
            // 进而导致set的更新无法正确刷入旧的ref.data, 即变为先彻底删除缓存再set入新缓存, 导致活跃 Entity 的ref数据与缓存数据断链
            // 即便 insert/update 慢于set, 后续通知依然会导致活跃 Entity 断链, 故必须维护存在的缓存, 不能主动remove
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
        //断言永远不为delete
        assertType<ExtStruct<JSONSET, K>>(newdata);

        // insert update delete 为数据库直接通知
        // set 为手动同步 实际上不会拉取数据
        await match(notify.op, {
            //如果直接得到数据则维护
            insert: () => this.tryUpdateCache(key, newdata),
            update: () => this.tryUpdateCache(key, newdata),
             //如果缓存存在则更新,不存在则设置新缓存
            set: () => this.cache.has(key)
                ? this.tryUpdateCache(key, newdata)
                : this.cache.set(key, newdata),
        });
    }

    /**尝试更新某个缓存
     * @param key     - 缓存键
     * @param newdata - 新数据
     */
    async tryUpdateCache<K extends JSONSET['key']>(
        key: K,
        newdata: ExtStruct<JSONSET, K>
    ) {
        const cacheData = this.cache.peek(key);
        if (cacheData == undefined) return;

        // 因为 DBJsonDataStruct 是 DeepReadonly, 在内部执行变异时, 我们显式转为字典态进行安全操作
        const targetData = (cacheData as ExtStruct<JSONSET, K>).data as JObject;
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