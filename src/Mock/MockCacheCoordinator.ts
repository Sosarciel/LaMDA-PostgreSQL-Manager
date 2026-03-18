import type { DBJsonDataStruct } from "../JsonDataStruct";
import { DBCacheCoordinator, DBOperation } from "../CacheCoordinator";
import { SmartCache, match, extractOutcome } from "@zwa73/utils";
import { PostgreSQLMockTool } from "./PostgreSQLMockTool";

const { MOCK_TABLE_NAME, MOCK_ID_FIELD } = PostgreSQLMockTool;

/**缓存键类型 */
export type MockCacheKey = `${typeof MOCK_TABLE_NAME}=${typeof MOCK_ID_FIELD}:${string}`;

/**缓存类型集 */
export type MockCacheTypeSet = {
    key: MockCacheKey;
    struct: DBJsonDataStruct<{}>;
    notify: DBOperation<typeof MOCK_TABLE_NAME, DBJsonDataStruct<{}>>;
};

/**尝试更新缓存数据 */
const tryUpdateCache = <T extends DBJsonDataStruct<{}>>(cache: SmartCache<MockCacheKey, DBJsonDataStruct<{}>>, key: MockCacheKey, row: T) => {
    const cacheData = cache.peek(key) as any as T;
    if (cacheData == null) return;

    // 删除旧字段中未出现在新数据中的字段
    for (const k of Object.keys(cacheData.data)) {
        if (!(k in row.data))
            delete (cacheData.data as any)[k];
    }
    Object.assign(cacheData.data, row.data);
};

/**通用处理 */
const commonProc = (cache: SmartCache<MockCacheKey, DBJsonDataStruct<{}>>, key: MockCacheKey, opera: DBOperation<string, DBJsonDataStruct<{}>>) => {
    const outcome = extractOutcome(opera, 'op');
    match(outcome, {
        insert: ({ result }) => tryUpdateCache(cache, key, result.new),
        update: ({ result }) => tryUpdateCache(cache, key, result.new),
        delete: ({ result }) => cache.remove(key),
        set: ({ result }) => cache.has(key)
            ? tryUpdateCache(cache, key, result.new)
            : cache.set(key, result.new),
    });
    return outcome;
};

/**创建缓存键
 * @param id 唯一标识值
 * @returns 缓存键
 */
export const createCacheKey = (id: string): MockCacheKey => {
    return `${MOCK_TABLE_NAME}=${MOCK_ID_FIELD}:${id}`;
};

/**模拟缓存协调器单例 */
export const cache = new SmartCache<MockCacheKey, DBJsonDataStruct<{}>>({ ttl: 600_000 });
export const MockCacheCoordinator = new DBCacheCoordinator<MockCacheTypeSet>({ cache });

// 注册表事件处理器
MockCacheCoordinator.registerEvent(MOCK_TABLE_NAME, {
    id: MOCK_TABLE_NAME,
    handler: ({ notify }) => {
        const lastRow = ('new' in notify) ? notify.new : notify.old;
        const key = createCacheKey((lastRow.data as any)[MOCK_ID_FIELD] as string);
        commonProc(cache, key, notify);
    }
});