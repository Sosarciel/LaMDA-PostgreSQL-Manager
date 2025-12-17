export declare class UtilDB {
    /**将js的 Date对象 转为pgsql所用的 带时区时间戳文本 */
    static toPgTimestampZ(date?: Date): string;
    /**将pgsql所用的 带时区时间戳文 转为js Date对象 */
    static fromPgTimestampZ(value: string): Date;
}
