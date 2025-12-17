import { Pool } from "pg";
import { DBOption } from "./Interface";
export declare class DBInstance {
    private option;
    private cp;
    _pool: Pool;
    private constructor();
    static start(option: DBOption): Promise<DBInstance>;
    stop(): Promise<unknown>;
}
