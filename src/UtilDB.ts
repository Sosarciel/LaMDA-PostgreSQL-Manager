import { JToken, UtilFunc } from '@zwa73/utils';
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
}