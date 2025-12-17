"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UtilDB = void 0;
class UtilDB {
    /**将js的 Date对象 转为pgsql所用的 带时区时间戳文本 */
    static toPgTimestampZ(date = new Date()) {
        const pad = (n) => String(n).padStart(2, '0');
        const offset = -date.getTimezoneOffset();
        const sign = offset >= 0 ? '+' : '-';
        const hours = pad(Math.floor(Math.abs(offset) / 60));
        const minutes = pad(Math.abs(offset) % 60);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
            `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
            `${sign}${hours}:${minutes}`;
    }
    /**将pgsql所用的 带时区时间戳文 转为js Date对象 */
    static fromPgTimestampZ(value) {
        return new Date(value);
    }
}
exports.UtilDB = UtilDB;
