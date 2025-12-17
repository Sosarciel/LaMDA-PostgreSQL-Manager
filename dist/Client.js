"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DBClient = void 0;
const sql_template_1 = __importDefault(require("sql-template"));
const pathe_1 = __importDefault(require("pathe"));
const utils_1 = require("@zwa73/utils");
const fs_1 = __importDefault(require("fs"));
const Manager_1 = require("./Manager");
const ExecuteFileOpt = (0, utils_1.preset)()({
    cache: true,
    autoSuffix: true,
    encode: 'utf-8',
});
const ExecuteFileCache = {};
class DBClient {
    _client;
    constructor(_client) {
        this._client = _client;
    }
    /**查询
     * 查询失败时将会抛异并打印查询文本/变量
     */
    async query(text, values) {
        const debugMode = Manager_1.DBManager.debugMode;
        let flag = "";
        if (debugMode) {
            const valuestxt = values == undefined ? "" :
                `\nvalues:${values.map(v => (typeof v == "object" ? utils_1.UtilFunc.stringifyJToken(v, { compress: true, space: 2 }) : v))}`;
            flag = `Client.query:${text}${valuestxt}`;
            utils_1.SLogger.time(flag);
        }
        try {
            return await (values != undefined
                ? this._client.query(text, values)
                : this._client.query(text));
        }
        catch (err) {
            utils_1.SLogger.warn("Client.query失败, text:", text, "values:", values);
            throw err;
        }
        finally {
            if (debugMode)
                utils_1.SLogger.timeEnd(flag);
        }
    }
    release = ((...args) => this._client.release.apply(this._client, args));
    /**用模板字符串查询 */
    async sql(...args) {
        const { text, values } = (0, sql_template_1.default)(...args);
        return await this.query(text, values);
    }
    /**依据路径执行sql文件中的语句
     * @param filepath sql文件路径 可省略.sql
     */
    async runFile(filepath, opt) {
        const fixedOpt = ExecuteFileOpt.assign(opt);
        const { encode, autoSuffix, cache } = fixedOpt;
        const fixedPath = (pathe_1.default.extname(filepath) !== ".sql" && autoSuffix)
            ? `${filepath}.sql` : filepath;
        if (cache && ExecuteFileCache[fixedPath])
            return await this.query(ExecuteFileCache[fixedPath]);
        const text = await fs_1.default.promises.readFile(fixedPath, encode);
        ExecuteFileCache[fixedPath] = text;
        return await this.query(text);
    }
}
exports.DBClient = DBClient;
