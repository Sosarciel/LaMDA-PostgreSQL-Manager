import { Pool, PoolClient, QueryConfig, QueryConfigValues, QueryResult, QueryResultRow } from "pg";
import SQL from "sql-template";
import path from 'pathe';
import { PartialOption } from "@zwa73/utils";
import fs from 'fs';

type ExecuteFilePartialOpt = PartialOption<ExecuteFileOpt,typeof ExecuteFileDefOpt>;
type ExecuteFileOpt = {
    /**使用缓存 默认 true */
    cache     : boolean;
    /**若没有后缀则自动添加.sql后缀 默认 true */
    autosuffix: boolean;
    /**文件编码 默认utf-8 */
    encode    : BufferEncoding;
}
const ExecuteFileDefOpt = {
    cache:true,
    autosuffix:true,
    encode:'utf-8',
}
const ExecuteFileCache:Record<string,string> = {};

export class DBClient<T extends PoolClient|Pool = PoolClient|Pool>{
    constructor(public _client:T){}

    query:T['query']=(...args:any)=>
        this._client.query.apply(this._client,args) as any;

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
    async call(filepath:string,opt?:ExecuteFilePartialOpt){
        const fixedOpt = Object.assign({},ExecuteFileDefOpt,opt??{});
        const {encode,autosuffix,cache} = fixedOpt;

        const fixedPath = (path.extname(filepath) !== ".sql" && autosuffix)
            ? `${filepath}.sql` : filepath;

        if(cache && ExecuteFileCache[fixedPath])
            return await this.query(ExecuteFileCache[fixedPath]);

        const text = await fs.promises.readFile(fixedPath,encode);
        ExecuteFileCache[fixedPath] = text;
        return await this.query(text);
    }
}