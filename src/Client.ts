import { Pool, PoolClient } from "pg";
import SQL from "sql-template";
import path from 'pathe';
import { PartialOption, SLogger, UtilFunc } from "@zwa73/utils";
import fs from 'fs';
import { DBManager } from "./Manager";

type ExecuteFilePartialOpt = PartialOption<ExecuteFileOpt,typeof ExecuteFileDefOpt>;
type ExecuteFileOpt = {
    /**使用缓存 默认 true */
    cache     : boolean;
    /**若没有后缀则自动添加.sql后缀 默认 true */
    autoSuffix: boolean;
    /**文件编码 默认utf-8 */
    encode    : BufferEncoding;
}
const ExecuteFileDefOpt = {
    cache:true,
    autoSuffix:true,
    encode:'utf-8',
}
const ExecuteFileCache:Record<string,string> = {};

export class DBClient<T extends PoolClient|Pool = PoolClient|Pool>{
    constructor(public _client:T){}

    /**查询  
     * 查询失败时将会抛异并打印查询文本/变量
     */
    async query(text:string,values?:any[]){
        const debugMode = DBManager.debugMode;
        let flag="";
        if(debugMode){
            const valuestxt = values==undefined ? "" :
                `\nvalues:${values.map(v=>(typeof v=="object" ? UtilFunc.stringifyJToken(v,{compress:true,space:2}) : v))}`;
            flag = `Client.query:${text}${valuestxt}`;
            SLogger.time(flag);
        }
        try{
            return await (values!=undefined
                ? this._client.query(text,values)
                : this._client.query(text))
        }
        catch(err){
            SLogger.warn("Client.query失败, text:", text, "values:",values);
            throw err;
        }
        finally{
            if(debugMode) SLogger.timeEnd(flag);
        }
    }

    release:T extends PoolClient ? T['release'] : never = ((...args:any)=>
        (this._client as any).release.apply(this._client,args)) as any;

    /**用模板字符串查询 */
    async sql(...args:Parameters<typeof SQL>){
        const {text,values} = SQL(...args);
        return await this.query(text,values);
    }
    /**依据路径执行sql文件中的语句
     * @param filepath sql文件路径 可省略.sql
     */
    async runFile(filepath:string,opt?:ExecuteFilePartialOpt){
        const fixedOpt = Object.assign({},ExecuteFileDefOpt,opt??{});
        const {encode,autoSuffix,cache} = fixedOpt;

        const fixedPath = (path.extname(filepath) !== ".sql" && autoSuffix)
            ? `${filepath}.sql` : filepath;

        if(cache && ExecuteFileCache[fixedPath])
            return await this.query(ExecuteFileCache[fixedPath]);

        const text = await fs.promises.readFile(fixedPath,encode);
        ExecuteFileCache[fixedPath] = text;
        return await this.query(text);
    }
}