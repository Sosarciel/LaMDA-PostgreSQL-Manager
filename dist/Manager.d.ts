import { EventSystem, MPromise } from "@zwa73/utils";
import { Pool, PoolClient } from 'pg';
import { DBPartialOption } from './Interface';
import { DBClient } from './Client';
export declare class DBManager extends EventSystem<{
    'onstop': () => MPromise<void>;
}> {
    private option;
    private timer?;
    /**pgsql实例 */
    private instance;
    /**连接池 */
    readonly _pool: Pool;
    /**通过连接池创建的自动客户端 */
    readonly client: DBClient<Pool>;
    /**是否打印查询流程 */
    static debugMode: boolean;
    /**正在关闭 */
    private stoping;
    /**正在关闭 */
    private exiting;
    /**设置开启debug模式, 打印所有query时间 */
    static setDebugMode(stat?: boolean): void;
    /**创建一个DBManager 并创建常用函数 */
    static create(partialOption: DBPartialOption): Promise<DBManager>;
    private constructor();
    /**初始化基础函数 */
    static initFunction(client: DBClient): Promise<void>;
    /**获取一个链接 */
    connect(): Promise<DBClient<PoolClient>>;
    /**开启自动备份 */
    autoSave(): void;
    /**在事物内执行query */
    transaction(func: (client: DBClient<PoolClient>) => Promise<void>): Promise<void>;
    /**关闭数据库 */
    stop(): Promise<void>;
}
