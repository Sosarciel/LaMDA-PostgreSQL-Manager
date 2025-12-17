import { DeepReadonly, JObject } from "@zwa73/js-utils";
/**jsonb表标准行 */
export type DBJsonDataStruct<T> = DeepReadonly<{
    /**由数据库托管, 插入时忽略此字段, 且可能为空, 查询时必定存在 */
    order_id?: number;
    data: T & {
        /**pgsql的带时区文本时间戳 */
        created_at?: string;
        /**pgsql的带时区文本时间戳 */
        updated_at?: string;
    };
}>;
/**jsonb表标准实体 */
export declare class DBJsonDataEntity<T extends DBJsonDataStruct<any>, PK extends keyof T['data']> {
    protected ref: T;
    constructor(ref: T);
    /**保存为JObject */
    toJSON(): JObject;
    /**获取一个字段的快照, 并且在表层排除null */
    getField(fd: keyof T['data']): any;
    /**判断数据是否有更新 */
    checkData(data: Partial<Omit<T['data'], PK>>): T | undefined;
}
