import { AnyFunc, DeepReadonly, JObject } from "@zwa73/js-utils";
import { UtilFunc } from "@zwa73/utils";


/**jsonb表标准行 */
export type DBJsonDataStruct<T> = DeepReadonly<{
    /**由数据库托管, 插入时忽略此字段, 且可能为空, 查询时必定存在 */
    order_id?: number;
    data: T&{
        /**pgsql的带时区文本时间戳 */
        created_at?:string;
        /**pgsql的带时区文本时间戳 */
        updated_at?:string;
    };
}>;


/**jsonb表标准实体 */
export class DBJsonDataEntity<
    T extends DBJsonDataStruct<any>,
    PK extends keyof T['data']
>{
    constructor(protected ref:T){}
    /**保存为JObject */
    toJSON(): JObject {
        return UtilFunc.deepClone(this.ref);
    }
    /**获取一个字段的快照, 并且在表层排除null */
    getField(fd:keyof T['data']){
        return this.ref.data[fd] ?? undefined;
    }
    /**判断数据是否有更新 */
    checkData(data:Partial<Omit<T['data'],PK>>):T|undefined {
        const newRow = {
            order_id:this.ref.order_id,
            data:Object.assign({},this.ref.data,data),
        } as T;
        if(UtilFunc.structEqual(this.ref.data,newRow.data)) return;
        return newRow;
    }
}