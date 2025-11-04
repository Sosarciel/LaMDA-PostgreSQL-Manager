import { DeepReadonly } from "@zwa73/js-utils";


/**jsonb表标准行 */
export type DBJsonDataStruct<T> = DeepReadonly<{
    /**由数据库托管, 插入时忽略此字段, 且可能为空, 查询时必定存在 */
    order_id?: number;
    data: T&{
        /**pgsql的带时区文本时间戳 */
        created_at?:string;
        /**pgsql的带时区文本时间戳 */
        updated_at?:string;
    };
}>;