import { PresetFinal, PresetOption } from "@zwa73/utils";
export declare const DBOption: import("@zwa73/utils").Preset<{
    /**数据库实例所在位置/目录 */
    path: string;
    /**输出所用编码 默认GBK*/
    encoding: string;
    /**备份存放目录 默认 无 不进行备份 */
    backupDir: string | undefined;
    /**自动备份的留存数量 默认 10 小于1时不进行备份 */
    backupMaxCount: number;
    /**自动备份的间隔时间 毫秒 默认 1小时 小于60秒时不进行备份 */
    backupInterval: number;
    /**数据库实例端口 */
    port: number;
    /**数据库实例用户名 默认 postgres */
    user: string;
    /**数据库实例目标数据库 默认 postgres */
    database: string;
    /**数据库实例地址 默认 localhost */
    host: string;
    /**最大连接数 默认 10 */
    max: number;
    /**闲置连接存活时间 默认30秒 */
    idleTimeoutMillis: number;
}, {
    readonly encoding: "gbk";
    readonly backupDir: undefined;
    readonly backupMaxCount: 10;
    readonly backupInterval: number;
    readonly user: "postgres";
    readonly database: "postgres";
    readonly host: "localhost";
    readonly max: 10;
    readonly idleTimeoutMillis: 30000;
}>;
export type DBPartialOption = PresetOption<typeof DBOption>;
export type DBOption = PresetFinal<typeof DBOption>;
/**半结构化数据行 */
export type DataRow<T extends Record<string, any> = any> = {
    order_id: number;
    data: T;
};
/**数据库操作通知数据 */
export type DBOperaNotification<R extends DataRow> = {
    /**操作类型 */
    op: 'insert' | 'update' | 'delete';
    /**表名 */
    table: string;
    /**新的行数据 */
    data: R['data'];
};
