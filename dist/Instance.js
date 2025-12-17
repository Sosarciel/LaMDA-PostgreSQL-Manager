"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DBInstance = void 0;
const pg_1 = require("pg");
const child_process_1 = require("child_process");
const utils_1 = require("@zwa73/utils");
const iconv = __importStar(require("iconv-lite"));
const kword = [
    "语句", "上下文", "位置",
    "错误", "异常", "失败", "注意",
    "提示", "SQL状态", "列",
    "字段", "类型", "权限",
    "拒绝", "角色", "编码",
    "字符集", "文件", "路径",
    "函数", "调用",
];
const tryUtf8 = (buf) => {
    const utf8line = iconv.decode(buf, 'utf-8');
    if (kword.some(v => utf8line.includes(v)))
        return utf8line;
    // 若出现 � 或往返不等价，则视为非有效 UTF‑8
    if (utf8line.includes('\uFFFD'))
        return undefined;
    return Buffer.from(utf8line, 'utf8').equals(buf)
        ? utf8line : undefined;
};
const decode = (data, def) => {
    return splitBufferLines(data)
        .map(line => tryUtf8(line) ?? iconv.decode(line, def))
        .join('\n');
};
const splitBufferLines = (buf) => {
    const lines = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0A) { // '\n'
            let end = i;
            if (i > 0 && buf[i - 1] === 0x0D)
                end -= 1; // '\r\n'
            lines.push(buf.subarray(start, end));
            start = i + 1;
        }
    }
    if (start < buf.length)
        lines.push(buf.subarray(start)); // 剩余部分
    return lines;
};
class DBInstance {
    option;
    cp;
    _pool;
    constructor(option, cp) {
        this.option = option;
        this.cp = cp;
        const { user, port, max, host, idleTimeoutMillis } = option;
        this._pool = new pg_1.Pool({
            user, port, max, host,
            idleTimeoutMillis,
        });
        this._pool.on('connect', client => {
            client.on('notice', msg => utils_1.SLogger.info(`PostgreSQL NOTICE: ${msg.message}`));
        });
    }
    ;
    static async start(option) {
        const pgProcess = (0, child_process_1.spawn)("pg_ctl", ["start", "-D", option.path, "-o", `"-p ${option.port}"`]);
        pgProcess.stdout.on("data", data => {
            const output = decode(data, option.encoding);
            utils_1.SLogger.info(`PostgreSQL ${output}`);
        });
        pgProcess.stderr.on("data", data => {
            const output = decode(data, option.encoding);
            utils_1.SLogger.error(`PostgreSQL ${output}`);
        });
        pgProcess.on("close", code => {
            utils_1.SLogger.info(`PostgreSQL close code:${code}`);
        });
        await (0, utils_1.sleep)(2000);
        const dbp = new DBInstance(option, pgProcess);
        return new Promise(async (resolve) => {
            while (true) {
                try {
                    const client = await dbp._pool.connect();
                    await client.query("SELECT 1");
                    client.release();
                    utils_1.SLogger.info("✅ PostgreSQL 已启动!");
                    resolve(dbp);
                    break;
                }
                catch (error) {
                    utils_1.SLogger.info("⏳ PostgreSQL 未启动, 重试中...");
                    await (0, utils_1.sleep)(1000);
                }
            }
        });
    }
    ;
    async stop() {
        utils_1.SLogger.info("正在安全关闭 PostgreSQL...");
        try {
            await this._pool.end();
        }
        catch {
            utils_1.SLogger.warn("关闭连接池失败");
        }
        const closeProcess = (0, child_process_1.spawn)("pg_ctl", ["stop", "-D", this.option.path]);
        return new Promise(resolve => {
            closeProcess.stdout.on("data", data => {
                const output = decode(data, this.option.encoding); // 转换 GBK 为 UTF-8
                utils_1.SLogger.info(`ClosePostgreSQL ${output}`);
            });
            closeProcess.stderr.on("data", data => {
                const output = decode(data, this.option.encoding);
                utils_1.SLogger.error(`ClosePostgreSQL ${output}`);
            });
            closeProcess.on("close", (code) => {
                utils_1.SLogger.info(`ClosePostgreSQL close code:${code}`);
                this.cp.kill('SIGTERM');
                closeProcess.kill('SIGTERM');
                resolve(true);
            });
        });
    }
}
exports.DBInstance = DBInstance;
