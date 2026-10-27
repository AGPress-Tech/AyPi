import fs from "fs";
import initSqlJs from "sql.js";
import { backendConfig } from "../../config";
import { logger } from "../logging/logger";
import { ensureFolderFor, replaceFileAtomic } from "../storage/json-files";

type SqlJsDatabase = any;

let sqliteModule: any = null;
let database: SqlJsDatabase | null = null;

export async function initializeMesSqliteDatabase() {
    if (database) return database;
    sqliteModule = await initSqlJs({
        locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
    });
    const dbPath = backendConfig.mesDatabase.path;
    ensureFolderFor(dbPath);
    const existingFile = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
    database = existingFile
        ? new sqliteModule.Database(existingFile)
        : new sqliteModule.Database();
    database.exec("PRAGMA foreign_keys = ON;");
    logger.info("MES SQLite archive initialized", {
        event: "mes_sqlite_initialized",
        category: "storage",
        module: "mes",
        dbPath,
        existed: !!existingFile,
    });
    return database;
}

export function getMesSqliteDatabase() {
    if (!database) throw new Error("MES SQLite database not initialized");
    return database;
}

export function persistMesSqliteDatabase() {
    const dbPath = backendConfig.mesDatabase.path;
    ensureFolderFor(dbPath);
    replaceFileAtomic(dbPath, Buffer.from(getMesSqliteDatabase().export()));
}

export function closeMesSqliteDatabase() {
    if (!database) return;
    persistMesSqliteDatabase();
    database.close();
    database = null;
    sqliteModule = null;
}

export function runMesSqliteTransaction<T>(run: (db: SqlJsDatabase) => T): T {
    const db = getMesSqliteDatabase();
    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
        const result = run(db);
        db.exec("COMMIT;");
        persistMesSqliteDatabase();
        return result;
    } catch (error) {
        try {
            db.exec("ROLLBACK;");
        } catch {
            // Ignore rollback failures and preserve the original error.
        }
        throw error;
    }
}
