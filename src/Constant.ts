import path from 'pathe';


/**项目根目录 */
export const ROOT_PATH = path.normalize(path.join(__dirname,'..'));//?
/**项目数据目录 */
export const DATA_PATH = path.join(ROOT_PATH,'data');//?
/**sql目录 */
export const SQL_DIR = path.join(ROOT_PATH,'sql');