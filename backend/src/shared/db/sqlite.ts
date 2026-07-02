import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";
import { backendConfig } from "../../config";
import { ensureFolderFor } from "../storage/json-files";
import { logger } from "../logging/logger";

type SqlJsDatabase = any;

let sqliteModule: any = null;
let database: SqlJsDatabase | null = null;

function getDatabasePath() {
    return backendConfig.database.path;
}

function loadExistingDatabaseFile(filePath: string) {
    if (!fs.existsSync(filePath)) return undefined;
    return fs.readFileSync(filePath);
}

function applyCorePragmas(db: SqlJsDatabase) {
    db.exec("PRAGMA foreign_keys = ON;");
}

export async function initializeSqliteDatabase() {
    if (database) return database;

    sqliteModule = await initSqlJs({
        locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
    });

    const dbPath = getDatabasePath();
    ensureFolderFor(dbPath);
    const existingFile = loadExistingDatabaseFile(dbPath);
    database = existingFile
        ? new sqliteModule.Database(existingFile)
        : new sqliteModule.Database();
    applyCorePragmas(database);

    logger.info("SQLite initialized", {
        event: "sqlite_initialized",
        category: "storage",
        module: "core",
        dbPath,
        existed: !!existingFile,
    });

    return database;
}

export function getSqliteDatabase() {
    if (!database) {
        throw new Error("SQLite database not initialized");
    }
    return database;
}

export function persistSqliteDatabase() {
    const db = getSqliteDatabase();
    const dbPath = getDatabasePath();
    ensureFolderFor(dbPath);
    const tempPath = `${dbPath}.tmp`;
    const buffer = Buffer.from(db.export());
    fs.writeFileSync(tempPath, buffer);
    fs.renameSync(tempPath, dbPath);
    logger.info("SQLite persisted", {
        event: "sqlite_persisted",
        category: "storage",
        module: "core",
        dbPath,
        bytes: buffer.byteLength,
    });
}

export function closeSqliteDatabase() {
    if (!database) return;
    persistSqliteDatabase();
    database.close();
    database = null;
    sqliteModule = null;
}

export function runSqliteTransaction<T>(run: (db: SqlJsDatabase) => T): T {
    const db = getSqliteDatabase();
    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
        const result = run(db);
        db.exec("COMMIT;");
        persistSqliteDatabase();
        return result;
    } catch (error) {
        try {
            db.exec("ROLLBACK;");
        } catch {
            // ignore rollback failures
        }
        throw error;
    }
}
