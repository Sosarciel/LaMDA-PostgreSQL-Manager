import path from 'pathe';
import { PromiseQueue, SLogger, throwError, UtilFT, UtilFunc } from "@zwa73/utils";
import fs from 'fs';
import { Pool, PoolClient } from 'pg';
import { DBPool } from './Pool';
import { DBOption, DBDefOption, DBPartialOption } from './Interface';


export class DBManager{
    private timer?:NodeJS.Timeout;
    private dbp!:DBPool;
    pool!:Pool;

    static async create(partialOption:DBPartialOption){
        const fixedOption   = Object.assign({},DBDefOption,partialOption);

        const manager = new DBManager(fixedOption);
        manager.dbp = await DBPool.start(fixedOption);

        const handleExit = (code:number)=>async () => {
            try{
                await manager.dbp.stop();
                SLogger.info('数据库关闭成功');
            }catch(e){
                SLogger.fatal('数据库关闭失败:', e);
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
        manager.pool = manager.dbp.pool;
        manager.autoSave();
        return manager;
    }
    private constructor(private option:DBOption){}
    autoSave(){
        const {backupDir,backupInterval,backupMaxCount} = this.option;
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
                SLogger.warn('数据库备份失败:', err);
            }

        }, backupInterval);
    }
    /**在事物内执行query */
    async transaction(func:(db:PoolClient)=>Promise<void>){
        const pool = this.pool;
        const db = await pool.connect();
        let pid = '';
        try{
            const result = await db.query('SELECT pg_backend_pid();');
            pid = String(result.rows[0].pg_backend_pid);
        } catch(e){
            db.release();
            SLogger.error(e);
            throwError("DBAccesser.transaction获取pid失败",'error');
        }
        const flag = `transaction_${pid}`;
        await PromiseQueue.enqueue(flag,async ()=>{
            await db.query("BEGIN;");
            try{
                await func(db);
                await db.query("COMMIT;");
            }catch(e){
                await db.query("ROLLBACK;");
                SLogger.error(e);
                throwError("DBAccesser.transaction失败",'error');
            }finally{
                db.release();
            }
        });
    }
}