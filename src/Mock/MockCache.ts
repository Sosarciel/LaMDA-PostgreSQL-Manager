import type { DBJsonDataStruct } from "../JsonDataStruct";
import type { DBOperation } from "../CacheCoordinator";
import { extractOutcome, match, SmartCache } from "@zwa73/utils";

/**模拟缓存
 * 用于在测试环境中模拟缓存操作和通知机制
 */
export class MockCache<T extends DBJsonDataStruct<{}>> {
    private cache: SmartCache<string, T>;

    constructor() {
        this.cache = new SmartCache<string, T>({
            ttl: 600_000
        });
    }

    /**尝试更新缓存数据
     * @param key 缓存键
     * @param row 新数据
     */
    private tryUpdateCache(key: string, row: T): void {
        const cacheData = this.cache.peek(key);
        if (cacheData == null) return;

        // 删除旧字段中未出现在新数据中的字段
        for (const key of Object.keys(cacheData.data)) {
            if (!(key in row.data)) {
                delete (cacheData.data as any)[key];
            }
        }
        Object.assign(cacheData.data, row.data);
    }

    /**处理数据库操作通知
     * @param key 缓存键
     * @param opera 数据库操作
     */
    proc(key: string, opera: DBOperation<string, T>): void {
        const outcome = extractOutcome(opera, 'op');
        match(outcome, {
            insert: ({ result }) => this.tryUpdateCache(key, result.new),
            update: ({ result }) => this.tryUpdateCache(key, result.new),
            delete: () => this.cache.remove(key),
            set: ({ result }) => this.cache.has(key)
                ? this.tryUpdateCache(key, result.new)
                : this.cache.set(key, result.new),
        });
    }

    /**获取或设置缓存
     * @param key 缓存键
     * @param fetchFn 获取数据的函数
     * @returns 缓存数据
     */
    async getOrSetCache(key: string, fetchFn: () => Promise<T | undefined>): Promise<T | undefined> {
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }

        const data = await fetchFn();
        if (data) {
            this.cache.set(key, data);
        }
        return data;
    }

    /**清除缓存 */
    clear(): void {
        this.cache.clean();
    }

    /**获取缓存大小（模拟实现）
     * @returns 缓存大小
     */
    size(): number {
        // SmartCache 没有 size 方法，这里模拟实现
        return 0;
    }
}