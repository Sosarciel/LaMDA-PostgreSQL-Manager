"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SQL_DIR = exports.DATA_PATH = exports.ROOT_PATH = void 0;
const pathe_1 = __importDefault(require("pathe"));
/**项目根目录 */
exports.ROOT_PATH = pathe_1.default.normalize(pathe_1.default.join(__dirname, '..')); //?
/**项目数据目录 */
exports.DATA_PATH = pathe_1.default.join(exports.ROOT_PATH, 'data'); //?
/**sql目录 */
exports.SQL_DIR = pathe_1.default.join(exports.ROOT_PATH, 'sql');
