import { preset, PresetFinal, PresetOption } from "@zwa73/utils";



export const DBOption = preset<{
    /**数据库实例所在位置/目录 不填入则不启动pgctl实例 默认无 */
    path           ?: string;
    /**输出所用编码 默认GBK*/
    encoding        : string;

    /**备份存放目录 默认 无 不进行备份 */
    backupDir       : string|undefined;
    /**自动备份的留存数量 默认 10 小于1时不进行备份 */
    backupMaxCount  : number;
    /**自动备份的间隔时间 毫秒 默认 1小时 小于60秒时不进行备份 */
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
}>()({
    encoding          : "gbk",
    backupDir         : undefined,
    backupMaxCount    : 10,
    backupInterval    : 1000 * 60 * 60,

    user              : 'postgres' ,
    database          : 'postgres' ,
    host              : 'localhost',
    max               : 10         ,
    idleTimeoutMillis : 30000      ,
} as const);

export type DBPartialOption = PresetOption<typeof DBOption>;
export type DBOption = PresetFinal<typeof DBOption>;
export type HasPathDBOption = DBOption&Required<Pick<DBOption,'path'>>;



/**半结构化数据行 */
export type DataRow<T extends Record<string,any>=any> = {
    order_id:number;
    data:T;
}

/**数据库操作通知数据 */
export type DBOperaNotification<R extends DataRow> = {
    /**操作类型 */
    op: 'insert' | 'update' | 'delete';
    /**表名 */
    table:string;
    /**新的行数据 */
    data:R['data'];
}
