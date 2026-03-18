import type { DBClient } from "../Client";
import type { DBManager } from "../Manager";
import type { DBJsonDataStruct } from "../JsonDataStruct";
import { DBCacheCoordinator } from "../CacheCoordinator";
import { SLogger, throwError } from "@zwa73/utils";
import { PostgreSQLMockTool } from "./PostgreSQLMockTool";
import { createCacheKey, MockCacheTypeSet } from "./MockCacheCoordinator";

const { MOCK_TABLE_NAME, MOCK_ID_FIELD } = PostgreSQLMockTool;

/**模拟表访问器选项 */
export type MockAccessOpt = {
    /**指定使用某个链接访问 */
    client?: DBClient;
};

/**模拟表访问器
 * 用于在测试环境中模拟表的增删查改操作
 */
export class MockTableAccesser<T extends DBJsonDataStruct<{}>> {
    private manager: DBManager;
    private cache: DBCacheCoordinator<MockCacheTypeSet> | null = null;

    /**构造函数
     * @param manager 数据库管理器
     */
    constructor(manager: DBManager) {
        this.manager = manager;
    }

    /**订阅数据库通知 */
    private async subscribeNotify() {
        if (!this.cache) {
            throwError("缓存协调器未注入", 'error');
        }
        try {
            await this.cache.subscribeNotify(this.manager, 'operation');
        } catch (e) {
            SLogger.warn(`订阅数据库通知失败:`, e);
        }
    }

    /**执行事务
     * @param func 事务函数
     */
    async transaction(func: (client: DBClient) => Promise<void>): Promise<void> {
        return this.manager.transaction(func);
    }

    /**插入或更新数据
     * @param data 数据
     * @param opt 选项
     */
    async insertOrUpdate(data: T, opt?: MockAccessOpt): Promise<void> {
        if (!this.cache) {
            throwError("缓存协调器未注入", 'error');
        }
        const client = opt?.client || this.manager.client;

        try {
            await client.query(`SELECT set_${MOCK_TABLE_NAME}('${JSON.stringify(data.data)}');`);
            // 通知缓存
            await this.cache.proc({ op: 'set', table: MOCK_TABLE_NAME, new: data });
        } catch (e) {
            SLogger.error(e);
            throwError(`${MOCK_TABLE_NAME} 插入或更新失败`, 'error');
        }
    }

    /**获取数据
     * @param id 唯一标识值
     * @param opt 选项
     * @returns 数据
     */
    async getData(id: string, opt?: MockAccessOpt): Promise<T | undefined> {
        if (!this.cache) {
            throwError("缓存协调器未注入", 'error');
        }
        const cacheKey = createCacheKey(id);
        return await this.cache.getOrSetCache(cacheKey, async () => {
            const client = opt?.client || this.manager.client;
            try {
                const result = await client.query(`
                    SELECT * FROM ${MOCK_TABLE_NAME}
                    WHERE data->>'${MOCK_ID_FIELD}' = '${id}';
                `);
                if (result.rowCount === 0) return;
                return result.rows[0] as T;
            } catch (e) {
                SLogger.warn(`${MOCK_TABLE_NAME} 获取数据失败`, e);
                return;
            }
        }) as T | undefined;
    }

    /**删除数据
     * @param id 唯一标识值
     * @param opt 选项
     */
    async deleteData(id: string, opt?: MockAccessOpt): Promise<void> {
        if (!this.cache) {
            throwError("缓存协调器未注入", 'error');
        }
        const client = opt?.client || this.manager.client;

        try {
            await client.query(`
                DELETE FROM ${MOCK_TABLE_NAME}
                WHERE data->>'${MOCK_ID_FIELD}' = '${id}';
            `);
            // 通知缓存
            await this.cache.proc({ op: 'delete', table: MOCK_TABLE_NAME, old: { data: { [MOCK_ID_FIELD]: id } } as unknown as T });
        } catch (e) {
            SLogger.error(e);
            throwError(`${MOCK_TABLE_NAME} 删除失败`, 'error');
        }
    }

    /**清除缓存 */
    clearCache(): void {
        if (!this.cache) {
            throwError("缓存协调器未注入", 'error');
        }
        this.cache.cache.clean();
    }

    /**检查缓存是否存在
     * @param id 唯一标识值
     * @returns 是否存在
     */
    hasCache(id: string): boolean {
        if (!this.cache) {
            throwError("缓存协调器未注入", 'error');
        }
        const cacheKey = createCacheKey(id);
        return this.cache.hasCache(cacheKey);
    }

    /**查看缓存数据
     * @param id 唯一标识值
     * @returns 缓存数据
     */
    peekCache(id: string): T | undefined {
        if (!this.cache) {
            throwError("缓存协调器未注入", 'error');
        }
        const cacheKey = createCacheKey(id);
        return this.cache.peekCache(cacheKey) as T | undefined;
    }

    /**获取缓存协调器
     * @returns 缓存协调器
     */
    getCacheCoordinator(): DBCacheCoordinator<MockCacheTypeSet> {
        if (!this.cache) {
            throwError("缓存协调器未注入", 'error');
        }
        return this.cache;
    }

    /**注入缓存协调器
     * @param cacheCoordinator 缓存协调器
     */
    injectCacheCoordinator(cacheCoordinator: DBCacheCoordinator<MockCacheTypeSet>): void {
        this.cache = cacheCoordinator;
        // 订阅数据库通知
        this.subscribeNotify();
    }

    /**获取表名
     * @returns 表名
     */
    getTableName(): string {
        return MOCK_TABLE_NAME;
    }

    /**获取唯一标识字段名
     * @returns 唯一标识字段名
     */
    getIdField(): string {
        return MOCK_ID_FIELD;
    }
}