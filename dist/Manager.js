"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DBManager = void 0;
const pathe_1 = __importDefault(require("pathe"));
const utils_1 = require("@zwa73/utils");
const fs_1 = __importDefault(require("fs"));
const Instance_1 = require("./Instance");
const Interface_1 = require("./Interface");
const Client_1 = require("./Client");
const Constant_1 = require("./Constant");
class DBManager extends utils_1.EventSystem {
    option;
    timer;
    /**pgsql实例 */
    instance;
    /**连接池 */
    _pool;
    /**通过连接池创建的自动客户端 */
    client;
    /**是否打印查询流程 */
    static debugMode = false;
    /**正在关闭 */
    stoping = false;
    /**正在关闭 */
    exiting = false;
    /**设置开启debug模式, 打印所有query时间 */
    static setDebugMode(stat = true) {
        DBManager.debugMode = stat;
    }
    /**创建一个DBManager 并创建常用函数 */
    static async create(partialOption) {
        const fixedOption = Interface_1.DBOption.assign(partialOption);
        const manager = new DBManager(fixedOption);
        manager.instance = await Instance_1.DBInstance.start(fixedOption);
        //#region 处理退出逻辑
        const handleExit = (code) => async () => {
            if (manager.exiting)
                return;
            manager.exiting = true;
            await manager.stop();
            process.exit(code);
        };
        process.on('SIGTERM', handleExit(0));
        process.on('SIGINT', handleExit(0));
        process.on('uncaughtException', async (err) => {
            utils_1.SLogger.fatal('未捕获的异常:', err);
            await handleExit(1)();
        });
        process.on('unhandledRejection', async (reason, promise) => {
            utils_1.SLogger.fatal('未捕获的拒绝:', reason);
            await handleExit(1)();
        });
        //#endregion
        manager._pool = manager.instance._pool;
        manager.client = new Client_1.DBClient(manager._pool);
        manager.autoSave();
        await DBManager.initFunction(manager.client);
        return manager;
    }
    constructor(option) {
        super();
        this.option = option;
    }
    /**初始化基础函数 */
    static async initFunction(client) {
        await client.runFile(pathe_1.default.join(Constant_1.SQL_DIR, "init_function"));
    }
    /**获取一个链接 */
    async connect() {
        return new Client_1.DBClient(await this._pool.connect());
    }
    /**开启自动备份 */
    autoSave() {
        const { backupDir, backupInterval, backupMaxCount } = this.option;
        if (backupDir == undefined ||
            backupInterval < 60_000 ||
            backupMaxCount < 1)
            return;
        this.timer = setInterval(async () => {
            utils_1.SLogger.info("开始自动备份数据库");
            const now = new Date();
            const offsetMs = now.getTimezoneOffset() * 60000; // 获取本地时区偏移（分钟）并转换为毫秒
            const timestamp = new Date(now.getTime() - offsetMs) // 调整为本地时间
                .toISOString()
                .replace(/\.\d+Z$/, '')
                .replace(/:/g, "_");
            const backupPath = pathe_1.default.join(backupDir, `pgsql-${timestamp}`);
            await utils_1.UtilFT.ensurePathExists(backupDir, { dir: true });
            try {
                // 获取现有备份文件列表
                const files = await fs_1.default.promises.readdir(backupDir, { withFileTypes: true });
                const backupFiles = files
                    .filter(file => file.isDirectory())
                    .filter(file => /^pgsql-/.test(file.name))
                    .map(file => {
                    return {
                        filepath: pathe_1.default.join(backupDir, file.name),
                        timestamp: new Date(file.name
                            .replace(/^pgsql-/, '')
                            .replace(/_/g, ':')).getTime(),
                    };
                });
                // 删除最旧的备份文件
                if (backupFiles.length >= backupMaxCount) {
                    const oldestBackup = backupFiles.sort((a, b) => a.timestamp - b.timestamp)[0].filepath;
                    await fs_1.default.promises.rm(oldestBackup, { recursive: true });
                }
                await utils_1.UtilFunc.exec(`pg_basebackup -D ${backupPath} -Ft -Xs -U postgres -p ${this.option.port} --compress=gzip`);
                utils_1.SLogger.info('数据库备份成功:', backupPath);
            }
            catch (err) {
                utils_1.SLogger.error('数据库备份失败:', err);
            }
        }, backupInterval);
    }
    /**在事物内执行query */
    async transaction(func) {
        const client = await this.connect();
        let pid = '';
        try {
            const result = await client.query('SELECT pg_backend_pid();');
            pid = String(result.rows[0].pg_backend_pid);
        }
        catch (err) {
            client.release();
            utils_1.SLogger.error(err);
            (0, utils_1.throwError)("DBAccesser.transaction获取pid失败", 'error');
        }
        const flag = `transaction_${pid}`;
        await utils_1.PromiseQueue.enqueue(flag, async () => {
            await client.query("BEGIN;");
            try {
                await func(client);
                await client.query("COMMIT;");
            }
            catch (err) {
                await client.query("ROLLBACK;");
                utils_1.SLogger.error(err);
                (0, utils_1.throwError)("DBAccesser.transaction失败", 'error');
            }
            finally {
                client.release();
            }
        });
    }
    /**关闭数据库 */
    async stop() {
        if (this.stoping)
            return;
        this.stoping = true;
        if (this.timer)
            clearInterval(this.timer);
        try {
            await this.invokeEvent('onstop');
            await this.instance.stop();
            utils_1.SLogger.info('数据库关闭成功');
        }
        catch (err) {
            utils_1.SLogger.fatal('数据库关闭失败:', err);
        }
    }
}
exports.DBManager = DBManager;
