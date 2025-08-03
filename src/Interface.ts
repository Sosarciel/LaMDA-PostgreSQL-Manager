import { PartialOption } from "@zwa73/utils";




export type DBPartialOption = PartialOption<DBOption,typeof DBDefOption>;

export type DBOption = {
    /**数据库实例所在位置/目录 */
    path            : string;
    /**备份存放目录 */
    backupDir       : string;
    /**输出所用编码 默认gbk*/
    encoding        : string;
    /**自动备份的留存数量 默认 10 */
    backupMaxCount  : number;
    /**自动备份的间隔时间 默认 1小时 */
    backupInterval  : number;

    //pool
    /**数据库实例端口 */
    port    : number;
    /**数据库实例用户名 默认 postgres */
    user    : string;
    /**数据库实例目标数据库 默认 postgres */
    database: string;
    /**数据库实例地址 默认 localhost */
    host    : string;
    /**最大连接数 默认 10 */
    max     : number;
    /**闲置连接存活时间 默认30秒 */
    idleTimeoutMillis: number;
}



export const DBDefOption = {
    encoding       : "gbl",
    backupMaxCount : 10,
    backupInterval : 1000 * 60 * 60,

    user              : 'postgres' ,
    database          : 'postgres' ,
    host              : 'localhost',
    max               : 10         ,
    idleTimeoutMillis : 30000      ,
}