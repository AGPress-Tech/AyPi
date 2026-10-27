import fs from "fs";
import { randomUUID } from "crypto";
import initSqlJs from "sql.js";
import { backendConfig } from "../../config";
import { logger } from "../logging/logger";
import { ensureFolderFor } from "../storage/json-files";

type SqlJsDatabase = any;

let sqliteModule: any = null;
let database: SqlJsDatabase | null = null;
let transactionDepth = 0;

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
    const temporaryPath = `${dbPath}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
        const data = Buffer.from(getMesSqliteDatabase().export());
        // sql.js reopens its connection on export; restore connection pragmas.
        getMesSqliteDatabase().exec("PRAGMA foreign_keys = ON;");
        descriptor = fs.openSync(temporaryPath, "wx");
        fs.writeFileSync(descriptor, data);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.renameSync(temporaryPath, dbPath);
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
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
    const depth = transactionDepth;
    const savepoint = `mes_nested_${depth}`;
    if (!depth && !fs.existsSync(backendConfig.mesDatabase.path)) persistMesSqliteDatabase();
    db.exec(depth ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE TRANSACTION;");
    transactionDepth++;
    let committed = false;
    try {
        const result = run(db);
        db.exec(depth ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT;");
        committed = true;
        if (!depth) persistMesSqliteDatabase();
        return result;
    } catch (error) {
        if (!depth && committed) {
            // A failed atomic replacement leaves the last durable snapshot intact.
            // Restore it so subsequent reads cannot report an unsaved success.
            db.close();
            database = new sqliteModule.Database(fs.readFileSync(backendConfig.mesDatabase.path));
            database.exec("PRAGMA foreign_keys = ON;");
            throw error;
        }
        try {
            db.exec(depth ? `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint};` : "ROLLBACK;");
        } catch {
            // Ignore rollback failures and preserve the original error.
        }
        throw error;
    } finally {
        transactionDepth--;
    }
}
