import path from 'pathe';
import { EventSystem, MPromise, PromiseQueue, SLogger, throwError, UtilFT, UtilFunc } from "@zwa73/utils";
import fs from 'fs';
import { Pool, PoolClient } from 'pg';
import { DBInstance } from './Instance';
import { DBOption, DBPartialOption } from './Interface';
import { DBClient } from './Client';
import { SQL_DIR } from './Constant';

export class DBManager extends EventSystem<{
    'onstop':()=>MPromise<void>;
}>{
    private timer?:NodeJS.Timeout;
    /**pgsql实例 */
    private instance!:DBInstance;
    /**连接池 */
    readonly _pool!:Pool;
    /**通过连接池创建的自动客户端 */
    readonly client!:DBClient<Pool>;
    /**是否打印查询流程 */
    static debugMode = false;
    /**正在关闭 */
    private stoping = false;
    /**正在关闭 */
    private exiting = false;

    /**设置开启debug模式, 打印所有query时间 */
    static setDebugMode(stat:boolean = true){
        DBManager.debugMode = stat;
    }

    /**创建一个DBManager 并创建常用函数 */
    static async create(partialOption:DBPartialOption){
        const fixedOption   = DBOption.assign(partialOption);

        const manager = new DBManager(fixedOption);
        manager.instance = await DBInstance.start(fixedOption);

        //#region 处理退出逻辑
        const handleExit = (code:number)=>async () => {
            if(manager.exiting) return;
            manager.exiting = true;
            await manager.stop();
            process.exit(code);
        };
        process.on('SIGTERM', handleExit(0));
        process.on('SIGINT', handleExit(0));
        process.on('uncaughtException', async (err) => {
            SLogger.fatal('未捕获的异常:', err);
            await handleExit(1)();
        });
        process.on('unhandledRejection', async (reason, promise) => {
            SLogger.fatal('未捕获的拒绝:', reason);
            await handleExit(1)();
        });
        //#endregion

        (manager as any)._pool  = manager.instance._pool;
        (manager as any).client = new DBClient(manager._pool);
        manager.autoSave();
        await DBManager.initFunction(manager.client);
        return manager;
    }

    private constructor(private option:DBOption){super()}

    /**初始化基础函数 */
    static async initFunction(client: DBClient){
        await client.runFile(path.join(SQL_DIR,"init_function"));
    }

    /**获取一个链接 */
    async connect(){
        return new DBClient(await this._pool.connect());
    }

    /**开启自动备份 */
    autoSave(){
        const {backupDir,backupInterval,backupMaxCount} = this.option;
        if( backupDir == undefined   ||
            backupInterval < 60_000  ||
            backupMaxCount < 1
        ) return;

        this.timer = setInterval(async ()=>{
            SLogger.info("开始自动备份数据库");
            const now = new Date();
            const offsetMs = now.getTimezoneOffset() * 60000; // 获取本地时区偏移（分钟）并转换为毫秒
            const timestamp = new Date(now.getTime() - offsetMs)// 调整为本地时间
                .toISOString()
                .replace(/\.\d+Z$/,'')
                .replace(/:/g,"_");
            const backupPath = path.join(backupDir, `pgsql-${timestamp}`);
            await UtilFT.ensurePathExists(backupDir,{dir:true});

            try {
                // 获取现有备份文件列表
                const files = await fs.promises.readdir(backupDir,{withFileTypes:true});
                const backupFiles = files
                    .filter(file => file.isDirectory())
                    .filter(file => /^pgsql-/.test(file.name))
                    .map(file=>{
                        return {
                            filepath:path.join(backupDir, file.name),
                            timestamp:new Date(file.name
                                .replace(/^pgsql-/, '')
                                .replace(/_/g, ':')).getTime(),
                        };
                    });

                // 删除最旧的备份文件
                if (backupFiles.length >= backupMaxCount) {
                    const oldestBackup = backupFiles.sort((a,b)=>a.timestamp-b.timestamp)[0].filepath;
                    await fs.promises.rm(oldestBackup,{recursive:true});
                }

                await UtilFunc.exec(`pg_basebackup -D ${backupPath} -Ft -Xs -U postgres -p ${this.option.port} --compress=gzip`);
                SLogger.info('数据库备份成功:', backupPath);
            } catch (err) {
                SLogger.error('数据库备份失败:', err);
            }

        }, backupInterval);
    }

    /**在事物内执行query */
    async transaction(func:(client:DBClient<PoolClient>)=>Promise<void>){
        const client = await this.connect();
        let pid = '';
        try{
            const result = await client.query('SELECT pg_backend_pid();');
            pid = String(result.rows[0].pg_backend_pid);
        } catch(err){
            client.release();
            SLogger.error(err);
            throwError("DBAccesser.transaction获取pid失败",'error');
        }
        const flag = `transaction_${pid}`;
        await PromiseQueue.enqueue(flag,async ()=>{
            await client.query("BEGIN;");
            try{
                await func(client);
                await client.query("COMMIT;");
            }catch(err){
                await client.query("ROLLBACK;");
                SLogger.error(err);
                throwError("DBAccesser.transaction失败",'error');
            }finally{
                client.release();
            }
        });
    }

    /**关闭数据库 */
    async stop(){
        if(this.stoping) return;
        this.stoping = true;
        if(this.timer) clearInterval(this.timer);
        try{
            await this.invokeEvent('onstop');
            await this.instance.stop();
            SLogger.info('数据库关闭成功');
        }catch(err){
            SLogger.fatal('数据库关闭失败:', err);
        }
    }
}