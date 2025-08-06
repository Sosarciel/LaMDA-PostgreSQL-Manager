import path from 'pathe';
import { PartialOption, PromiseQueue, SLogger, throwError, UtilFT, UtilFunc } from "@zwa73/utils";
import fs from 'fs';
import { Pool, PoolClient } from 'pg';
import { DBInstance } from './Instance';
import { DBOption, DBDefOption, DBPartialOption } from './Interface';

type ExecuteFilePartialOpt = PartialOption<ExecuteFileOpt,typeof ExecuteFileDefOpt>;
type ExecuteFileOpt = {
    /**使用缓存 默认 true */
    cache     : boolean;
    /**若没有后缀则自动添加.sql后缀 默认 true */
    autosuffix: boolean;
    /**文件编码 默认utf-8 */
    encode    : BufferEncoding;
    /**指定使用某个连接 */
    client   ?: PoolClient|Pool;
}
const ExecuteFileDefOpt = {
    cache:true,
    autosuffix:true,
    encode:'utf-8',
}

export class DBManager{
    private timer?:NodeJS.Timeout;
    private instance!:DBInstance;
    pool!:Pool;

    static async create(partialOption:DBPartialOption){
        const fixedOption   = Object.assign({},DBDefOption,partialOption);

        const manager = new DBManager(fixedOption);
        manager.instance = await DBInstance.start(fixedOption);

        //#region 处理退出逻辑
        const handleExit = (code:number)=>async () => {
            try{
                await manager.instance.stop();
                SLogger.info('数据库关闭成功');
            }catch(err){
                SLogger.fatal('数据库关闭失败:', err);
            }
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

        manager.pool = manager.instance.pool;
        manager.autoSave();
        return manager;
    }
    private constructor(private option:DBOption){}
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

                await UtilFunc.exec(`pg_basebackup -D ${backupPath} -Ft -Xs -U postgres -p ${this.option.port}`);
                SLogger.info('数据库备份成功:', backupPath);
            } catch (err) {
                SLogger.error('数据库备份失败:', err);
            }

        }, backupInterval);
    }
    /**在事物内执行query */
    async transaction(func:(client:PoolClient)=>Promise<void>){
        const pool = this.pool;
        const client = await pool.connect();
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

    static executeFileCache:Record<string,string> = {};
    /**依据路径执行sql文件中的语句
     * @param filepath sql文件路径 可省略.sql
     */
    async executeFile(filepath:string,opt?:ExecuteFilePartialOpt){
        const fixedOpt = Object.assign({},ExecuteFileDefOpt,opt??{});
        const {encode,autosuffix,cache,client} = fixedOpt;

        const fixedPath = (path.extname(filepath) !== ".sql" && autosuffix)
            ? `${filepath}.sql` : filepath;

        const fixedClient = client ? client : this.pool;

        if(cache && DBManager.executeFileCache[fixedPath])
            return await fixedClient.query(DBManager.executeFileCache[fixedPath]);

        const text = await fs.promises.readFile(fixedPath,encode);
        DBManager.executeFileCache[fixedPath] = text;
        return await fixedClient.query(text);
    }
}