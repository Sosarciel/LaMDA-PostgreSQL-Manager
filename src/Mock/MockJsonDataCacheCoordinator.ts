import type { DBJsonDataStruct } from "../JsonDataStruct";
import { DBJsonDataCacheCoordinator, DBOperation } from "../CacheCoordinator";
import { SmartCache } from "@zwa73/utils";
import { PostgreSQLMockTool } from "./PostgreSQLMockTool";

const { MOCK_TABLE_NAME, MOCK_ID_FIELD } = PostgreSQLMockTool;

/**缓存键类型 */
export type MockJsonCacheKey = `${typeof MOCK_TABLE_NAME}=${typeof MOCK_ID_FIELD}:${string}`;

/**缓存类型集 */
export type MockJsonCacheTypeSet = {
    key: MockJsonCacheKey;
    struct: DBJsonDataStruct<{}>;
    notify: DBOperation<typeof MOCK_TABLE_NAME, DBJsonDataStruct<{}>>;
};

/**模拟JSON数据缓存协调器单例 */
export const jsonCache = new SmartCache<MockJsonCacheKey, DBJsonDataStruct<{}>>({ ttl: 600_000 });
export const MockJsonDataCacheCoordinator = new DBJsonDataCacheCoordinator<MockJsonCacheTypeSet>({
    option: {
        table: {
            [MOCK_TABLE_NAME]: {
                getKey: (row: DBJsonDataStruct<{}>) => {
                    return `${MOCK_TABLE_NAME}=${MOCK_ID_FIELD}:${(row.data as any)[MOCK_ID_FIELD] as string}`;
                },
                unwarp: (row: DBJsonDataStruct<{}>) => {
                    return Promise.resolve(row);
                }
            }
        }
    },
    cache: jsonCache
});