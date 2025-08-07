import { Pool } from "pg";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { sleep, SLogger } from "@zwa73/utils";
import * as iconv from "iconv-lite";
import { DBOption } from "./Interface";


const kword = [
    "语句", "上下文", "位置",
    "错误", "异常", "失败", "注意",
    "提示", "SQL状态", "列",
    "字段", "类型", "权限",
    "拒绝", "角色", "编码",
    "字符集", "文件", "路径",
    "函数", "调用"
];
const decode = (data:Buffer,def:string)=>{
    const utf8 = iconv.decode(data, 'utf-8');
    return kword.some(v=>utf8.includes(v))
        ? utf8 : iconv.decode(data, def);
}

export class DBInstance{
    _pool:Pool;

    private constructor(private option:DBOption,private cp:ChildProcessWithoutNullStreams){
        const {user,port,max,host,idleTimeoutMillis} = option;
        this._pool = new Pool({
            user,port,max,host,
            idleTimeoutMillis ,
        });
        this._pool.on('connect', client =>{
            client.on('notice', msg=>
                SLogger.info(`PostgreSQL NOTICE: ${msg.message}`));
        });
    };
    static async start (option:DBOption):Promise<DBInstance>{
        const pgProcess = spawn("pg_ctl", ["start", "-D", option.path, "-o", `"-p ${option.port}"`]);
        pgProcess.stdout.on("data", data => {
            const output = decode(data, option.encoding);
            SLogger.info(`PostgreSQL ${output}`);
        });

        pgProcess.stderr.on("data", data => {
            const output = decode(data, option.encoding);
            SLogger.error(`PostgreSQL ${output}`);
        });

        pgProcess.on("close", code => {
            SLogger.info(`PostgreSQL close code:${code}`);
        });

        await sleep(2000);
        const dbp = new DBInstance(option,pgProcess);

        return new Promise(async resolve=>{
            while (true) {
                try {
                    const client = await dbp._pool.connect();
                    await client.query("SELECT 1");
                    client.release();
                    SLogger.info("✅ PostgreSQL 已启动!");
                    resolve(dbp);
                    break;
                } catch (error) {
                    SLogger.info("⏳ PostgreSQL 未启动，重试中...");
                    await sleep(1000);
                }
            }
        });
    };
    async stop() {
        SLogger.info("正在安全关闭 PostgreSQL...");
        const closeProcess = spawn("pg_ctl", ["stop", "-D", this.option.path]);
        return new Promise(resolve=>{
            closeProcess.stdout.on("data", data => {
                const output = decode(data, this.option.encoding);// 转换 GBK 为 UTF-8
                SLogger.info(`ClosePostgreSQL ${output}`);
            });

            closeProcess.stderr.on("data", data => {
                const output = decode(data, this.option.encoding);
                SLogger.error(`ClosePostgreSQL ${output}`);
            });

            closeProcess.on("close", (code) => {
                SLogger.info(`ClosePostgreSQL close code:${code}`);
                this.cp.kill('SIGTERM');
                closeProcess.kill('SIGTERM');
                resolve(true);
            });
        });
    }
}