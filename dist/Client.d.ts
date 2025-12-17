import { Pool, PoolClient } from "pg";
import SQL from "sql-template";
import { PresetOption } from "@zwa73/utils";
declare const ExecuteFileOpt: import("@zwa73/utils").Preset<{
    /**使用缓存 默认 true */
    cache: boolean;
    /**若没有后缀则自动添加.sql后缀 默认 true */
    autoSuffix: boolean;
    /**文件编码 默认utf-8 */
    encode: BufferEncoding;
}, {
    readonly cache: true;
    readonly autoSuffix: true;
    readonly encode: "utf-8";
}>;
export declare class DBClient<T extends PoolClient | Pool = PoolClient | Pool> {
    _client: T;
    constructor(_client: T);
    /**查询
     * 查询失败时将会抛异并打印查询文本/变量
     */
    query(text: string, values?: any[]): Promise<import("pg").QueryResult<any>>;
    release: T extends PoolClient ? T['release'] : never;
    /**用模板字符串查询 */
    sql(...args: Parameters<typeof SQL>): Promise<import("pg").QueryResult<any>>;
    /**依据路径执行sql文件中的语句
     * @param filepath sql文件路径 可省略.sql
     */
    runFile(filepath: string, opt?: PresetOption<typeof ExecuteFileOpt>): Promise<import("pg").QueryResult<any>>;
}
export {};
