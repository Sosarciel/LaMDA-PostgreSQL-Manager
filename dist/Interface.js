"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DBOption = void 0;
const utils_1 = require("@zwa73/utils");
exports.DBOption = (0, utils_1.preset)()({
    encoding: "gbk",
    backupDir: undefined,
    backupMaxCount: 10,
    backupInterval: 1000 * 60 * 60,
    user: 'postgres',
    database: 'postgres',
    host: 'localhost',
    max: 10,
    idleTimeoutMillis: 30000,
});
