import { BrowserWindow, type IpcMain, type App } from "electron";
import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";

const TABLE = "warehouse_local_state";
const STORE_KEY = "main";
let database: any = null;
let databasePromise: Promise<any> | null = null;
let registered = false;

function databasePath(app: App) {
    return path.join(app.getPath("userData"), "data", "aypi.db");
}

function persistDatabase(app: App) {
    if (!database) return;
    const target = databasePath(app);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, Buffer.from(database.export()));
    try {
        fs.renameSync(temporary, target);
    } catch {
        fs.copyFileSync(temporary, target);
        fs.unlinkSync(temporary);
    }
}

async function getDatabase(app: App) {
    if (database) return database;
    if (!databasePromise) {
        databasePromise = (async () => {
            const SqlJs = await initSqlJs({
                locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
            });
            const target = databasePath(app);
            database = fs.existsSync(target)
                ? new SqlJs.Database(fs.readFileSync(target))
                : new SqlJs.Database();
            database.exec(`
                CREATE TABLE IF NOT EXISTS ${TABLE} (
                    store_key TEXT PRIMARY KEY,
                    revision INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
            `);
            persistDatabase(app);
            return database;
        })().finally(() => { databasePromise = null; });
    }
    return databasePromise;
}

async function loadSnapshot(app: App) {
    const db = await getDatabase(app);
    const rows = db.exec(
        `SELECT revision, updated_at, payload_json FROM ${TABLE} WHERE store_key = ?`,
        [STORE_KEY],
    );
    const row = rows?.[0]?.values?.[0];
    if (!row) return { inventory: [], movements: [], revision: 0, updatedAt: "", updatedBy: "" };
    let payload: any = {};
    try {
        payload = JSON.parse(String(row[2] || "{}"));
    } catch {
        payload = {};
    }
    return {
        inventory: Array.isArray(payload.inventory) ? payload.inventory : [],
        movements: Array.isArray(payload.movements) ? payload.movements : [],
        revision: Number(row[0]) || 0,
        updatedAt: String(row[1] || ""),
        updatedBy: "Database locale AyPi",
    };
}

async function saveSnapshot(app: App, payload: any) {
    const db = await getDatabase(app);
    const current = await loadSnapshot(app);
    const baseRevision = Number(payload?.baseRevision);
    if (!Number.isInteger(baseRevision) || baseRevision !== current.revision) {
        throw new Error(`Revisione magazzino non valida: attesa ${current.revision}.`);
    }
    const revision = current.revision + 1;
    const updatedAt = new Date().toISOString();
    const state = {
        inventory: Array.isArray(payload?.inventory) ? payload.inventory : [],
        movements: Array.isArray(payload?.movements) ? payload.movements : [],
    };
    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
        db.run(`
            INSERT INTO ${TABLE} (store_key, revision, updated_at, payload_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(store_key) DO UPDATE SET
                revision = excluded.revision,
                updated_at = excluded.updated_at,
                payload_json = excluded.payload_json
        `, [STORE_KEY, revision, updatedAt, JSON.stringify(state)]);
        db.exec("COMMIT;");
        persistDatabase(app);
    } catch (error) {
        try { db.exec("ROLLBACK;"); } catch { /* ignore */ }
        throw error;
    }
    return { ...state, revision, updatedAt, updatedBy: "Database locale AyPi" };
}

export function registerWarehouseInventoryIpc(ipcMain: IpcMain, app: App) {
    if (registered) return;
    registered = true;
    ipcMain.handle("warehouse-inventory-local-load", () => loadSnapshot(app));
    ipcMain.handle("warehouse-inventory-local-save", (_event, payload) => saveSnapshot(app, payload));
    ipcMain.handle("warehouse-inventory-focus-window", (event) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window || window.isDestroyed()) return false;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        window.webContents.focus();
        return window.isFocused();
    });
    app.on("before-quit", () => {
        try { persistDatabase(app); } catch { /* a previous atomic save remains valid */ }
    });
}
