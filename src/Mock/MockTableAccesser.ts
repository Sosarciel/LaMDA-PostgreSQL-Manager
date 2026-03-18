import type { DBClient } from "../Client";
import type { DBManager } from "../Manager";
import type { DBJsonDataStruct } from "../JsonDataStruct";
import { SLogger, throwError } from "@zwa73/utils";
import { MockCache } from "./MockCache";

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
    private tableName: string;
    private idField: string;
    private cache: MockCache<T>;

    /**构造函数
     * @param manager 数据库管理器
     * @param tableName 表名
     * @param idField 唯一标识字段名
     */
    constructor(manager: DBManager, tableName: string, idField: string) {
        this.manager = manager;
        this.tableName = tableName;
        this.idField = idField;
        this.cache = new MockCache<T>();
    }

    /**生成缓存键
     * @param id 唯一标识值
     * @returns 缓存键
     */
    private getCacheKey(id: string): string {
        return `${this.tableName}=${this.idField}:${id}`;
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
        const cacheKey = this.getCacheKey((data.data as any)[this.idField] as string);
        const client = opt?.client || this.manager.client;

        try {
            await client.query(`SELECT set_${this.tableName}('${JSON.stringify(data.data)}');`);
            // 立即通知缓存
            this.cache.proc(cacheKey, { op: 'set', table: this.tableName, new: data });
        } catch (e) {
            SLogger.error(e);
            throwError(`${this.tableName} 插入或更新失败`, 'error');
        }
    }

    /**获取数据
     * @param id 唯一标识值
     * @param opt 选项
     * @returns 数据
     */
    async getData(id: string, opt?: MockAccessOpt): Promise<T | undefined> {
        const cacheKey = this.getCacheKey(id);
        return await this.cache.getOrSetCache(cacheKey, async () => {
            const client = opt?.client || this.manager.client;

            try {
                const result = await client.query(`
                    SELECT * FROM ${this.tableName}
                    WHERE data->>'${this.idField}' = '${id}';
                `);
                if (result.rowCount === 0) return;
                return result.rows[0] as T;
            } catch (e) {
                SLogger.warn(`${this.tableName} 获取数据失败`, e);
                return;
            }
        });
    }

    /**删除数据
     * @param id 唯一标识值
     * @param opt 选项
     */
    async deleteData(id: string, opt?: MockAccessOpt): Promise<void> {
        const cacheKey = this.getCacheKey(id);
        const client = opt?.client || this.manager.client;

        try {
            await client.query(`
                DELETE FROM ${this.tableName}
                WHERE data->>'${this.idField}' = '${id}';
            `);
            // 立即通知缓存
            this.cache.proc(cacheKey, { op: 'delete', table: this.tableName, old: { data: { [this.idField]: id } } as T });
        } catch (e) {
            SLogger.error(e);
            throwError(`${this.tableName} 删除失败`, 'error');
        }
    }

    /**清除缓存 */
    clearCache(): void {
        this.cache.clear();
    }

    /**获取缓存大小
     * @returns 缓存大小
     */
    getCacheSize(): number {
        return this.cache.size();
    }
}