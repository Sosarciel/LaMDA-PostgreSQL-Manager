"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DBJsonDataEntity = void 0;
const utils_1 = require("@zwa73/utils");
/**jsonb表标准实体 */
class DBJsonDataEntity {
    ref;
    constructor(ref) {
        this.ref = ref;
    }
    /**保存为JObject */
    toJSON() {
        return utils_1.UtilFunc.deepClone(this.ref);
    }
    /**获取一个字段的快照, 并且在表层排除null */
    getField(fd) {
        return this.ref.data[fd] ?? undefined;
    }
    /**判断数据是否有更新 */
    checkData(data) {
        const newRow = {
            order_id: this.ref.order_id,
            data: Object.assign({}, this.ref.data, data),
        };
        if (utils_1.UtilFunc.structEqual(this.ref.data, newRow.data))
            return;
        return newRow;
    }
}
exports.DBJsonDataEntity = DBJsonDataEntity;
