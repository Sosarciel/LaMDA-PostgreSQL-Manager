import { JObject, JToken, UtilFunc } from '@zwa73/utils';
import crypto from 'crypto';



export class UtilDB{
    /**将js的 Date对象 转为pgsql所用的 带时区时间戳文本 */
    static toPgTimestampZ(date = new Date()) {
        const pad = (n: number) => String(n).padStart(2, '0');
        const offset = -date.getTimezoneOffset();
        const sign = offset >= 0 ? '+' : '-';
        const hours = pad(Math.floor(Math.abs(offset) / 60));
        const minutes = pad(Math.abs(offset) % 60);

        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T`+
            `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`+
            `${sign}${hours}:${minutes}`;
    }
    /**将pgsql所用的 带时区时间戳文 转为js Date对象 */
    static fromPgTimestampZ(value:string){
        return new Date(value);
    }
    /**等价于 pgsql中 stable_jsonb_hash(obj) 的稳定hash算法 */
    static stableHash(token:JToken){
        const canonicalStr = UtilFunc.stringifyJToken(token, {
            stable: true,
            compress: false, // 禁用压缩特殊字符
            space: null // 禁用格式化空格
        });

        return crypto.createHash('md5').update(canonicalStr).digest('hex');
    }
    /**等价于 jsonb_merge_and_clean 的assign策略
     * @param base   - 源对象
     * @param target - 合并对象
     */
    static mergeAndClean<B extends JObject,T extends JObject>(base:B, target:T):B&T{
        const result = {...base} as JObject;
        //清洗原数据
        for (const key of Object.keys(result))
            if (result[key] == null) delete result[key];
        //合并新数据
        for (const key of Object.keys(target)) {
            const val = target[key];
            // undefined时忽略
            if (val === undefined)
                continue;

            // null 为删除
            if (val === null) {
                delete result[key];
                continue;
            }
            // 其他：新增或覆盖
            result[key] = val;
        }
        return result as B&T;
    }
    /**递归清理数据中的 undefined 值
     * JSON.stringify 行为：
     * - 对象中的 undefined：key 被删除
     * - 数组中的 undefined：转为 null
     * @param data - 要清理的数据
     */
    static cleanUndefined(data: unknown): void {
        if (data === null || typeof data !== 'object') return;

        if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) {
                if (data[i] === undefined) {
                    data[i] = null;
                } else if (typeof data[i] === 'object' && data[i] !== null) {
                    this.cleanUndefined(data[i]);
                }
            }
        } else {
            const obj = data as Record<string, unknown>;
            for (const key of Object.keys(obj)) {
                if (obj[key] === undefined) {
                    delete obj[key];
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    this.cleanUndefined(obj[key]);
                }
            }
        }
    }
}