import { BrowserWindow, type IpcMain, type App } from "electron";
import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";

const TABLE = "warehouse_local_state";
const STORE_KEY = "main";
let database: any = null;
let databasePromise: Promise<any> | null = null;
let registered = false;
let movementDetailsWindow: BrowserWindow | null = null;
let movementDetailsOwner: BrowserWindow | null = null;
let movementDetailsPayload: any = null;
let warehouse3dWindow: BrowserWindow | null = null;
let warehouse3dOwner: BrowserWindow | null = null;
let warehouse3dPayload: any = null;

function focusBrowserWindow(window: BrowserWindow | null) {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.moveTop();
    window.focus();
    window.webContents.focus();
}

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
    if (!row) return { inventory: [], movements: [], unloadZone: [], revision: 0, updatedAt: "", updatedBy: "" };
    let payload: any = {};
    try {
        payload = JSON.parse(String(row[2] || "{}"));
    } catch {
        payload = {};
    }
    return {
        inventory: Array.isArray(payload.inventory) ? payload.inventory : [],
        movements: Array.isArray(payload.movements) ? payload.movements : [],
        unloadZone: Array.isArray(payload.unloadZone) ? payload.unloadZone : [],
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
        unloadZone: Array.isArray(payload?.unloadZone) ? payload.unloadZone : [],
    };
    const weighingOwners = new Map<string, string>();
    state.inventory.forEach((item: any) => {
        const pieces = Number(item?.pieceCount);
        const capacity = Number(item?.maxPieceCapacity);
        if (!Number.isInteger(pieces) || pieces < 1 || !Number.isInteger(capacity) || capacity < pieces) {
            throw new Error(`Quantità pezzi non valida per il cassone ${item?.id || "senza ID"}.`);
        }
        const weighingCode = String(item?.weighingCode || "").trim().toUpperCase();
        const owner = weighingOwners.get(weighingCode);
        if (weighingCode && owner && owner !== item.id) {
            throw new Error(`Il codice pesata ${weighingCode} è già assegnato al cassone ${owner}.`);
        }
        if (weighingCode) weighingOwners.set(weighingCode, item.id);
    });
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
        focusBrowserWindow(window);
        return window.isFocused();
    });
    ipcMain.on("open-warehouse-movement-details-window", (event, payload) => {
        const senderOwner = BrowserWindow.fromWebContents(event.sender);
        const owner = payload?.preferWarehouse3dOwner
            && warehouse3dWindow
            && !warehouse3dWindow.isDestroyed()
            ? warehouse3dWindow
            : senderOwner;
        const movement = payload?.movement || payload;
        if (!owner || owner.isDestroyed() || !movement?.id) return;
        movementDetailsOwner = owner;
        movementDetailsPayload = {
            movement,
            initialView: payload?.movement ? payload.initialView || "comparison" : "comparison",
        };
        if (movementDetailsWindow && !movementDetailsWindow.isDestroyed()) {
            movementDetailsWindow.setParentWindow(owner);
            focusBrowserWindow(movementDetailsWindow);
            movementDetailsWindow.webContents.send("warehouse-movement-details-data", movementDetailsPayload);
            return;
        }
        movementDetailsWindow = new BrowserWindow({
            width: 1500,
            height: 900,
            minWidth: 980,
            minHeight: 620,
            parent: owner,
            show: false,
            backgroundColor: "#eef2f5",
            webPreferences: { nodeIntegration: true, contextIsolation: false },
        });
        movementDetailsWindow.setMenu(null);
        movementDetailsWindow.loadFile(path.join(__dirname, "..", "..", "pages", "warehouse-movement-details.html"));
        movementDetailsWindow.once("ready-to-show", () => {
            focusBrowserWindow(movementDetailsWindow);
        });
        movementDetailsWindow.on("focus", () => movementDetailsWindow?.webContents.focus());
        movementDetailsWindow.on("closed", () => {
            movementDetailsWindow = null;
            movementDetailsPayload = null;
            focusBrowserWindow(movementDetailsOwner);
            movementDetailsOwner = null;
        });
    });
    ipcMain.on("warehouse-movement-details-ready", (event) => {
        if (!movementDetailsWindow || movementDetailsWindow.isDestroyed()
            || movementDetailsWindow.webContents !== event.sender || !movementDetailsPayload) return;
        event.sender.send("warehouse-movement-details-data", movementDetailsPayload);
    });
    ipcMain.handle("warehouse-3d-open-window", (event, payload) => {
        const owner = BrowserWindow.fromWebContents(event.sender);
        if (!owner || owner.isDestroyed()) return false;
        warehouse3dOwner = owner;
        warehouse3dPayload = payload;
        if (warehouse3dWindow && !warehouse3dWindow.isDestroyed()) {
            warehouse3dWindow.maximize();
            focusBrowserWindow(warehouse3dWindow);
            warehouse3dWindow.webContents.send("warehouse-3d-data", warehouse3dPayload);
            return true;
        }
        warehouse3dWindow = new BrowserWindow({
            width: 1600,
            height: 920,
            minWidth: 1040,
            minHeight: 680,
            parent: owner,
            show: false,
            backgroundColor: "#e9f0f5",
            webPreferences: { nodeIntegration: true, contextIsolation: false },
        });
        warehouse3dWindow.setMenu(null);
        warehouse3dWindow.loadFile(path.join(__dirname, "..", "..", "pages", "warehouse-3d.html"));
        warehouse3dWindow.once("ready-to-show", () => {
            warehouse3dWindow?.maximize();
            focusBrowserWindow(warehouse3dWindow);
        });
        warehouse3dWindow.on("close", () => {
            // Nasconde prima la superficie WebGL: il teardown del renderer non
            // deve essere visibile sopra la finestra principale durante il
            // passaggio di focus, soprattutto con una riproduzione in pausa.
            if (warehouse3dWindow && !warehouse3dWindow.isDestroyed() && warehouse3dWindow.isVisible()) {
                warehouse3dWindow.hide();
            }
        });
        warehouse3dWindow.on("closed", () => {
            const owner = warehouse3dOwner;
            warehouse3dWindow = null;
            warehouse3dOwner = null;
            setTimeout(() => {
                if (!owner || owner.isDestroyed()) return;
                if (owner.isMinimized()) owner.restore();
                if (!owner.isVisible()) owner.show();
                if (!owner.isFocused()) owner.focus();
            }, 80);
        });
        return true;
    });
    ipcMain.on("warehouse-3d-update", (event, payload) => {
        const sender = BrowserWindow.fromWebContents(event.sender);
        if (sender && !sender.isDestroyed()) warehouse3dOwner = sender;
        warehouse3dPayload = payload;
        if (warehouse3dWindow && !warehouse3dWindow.isDestroyed()) {
            warehouse3dWindow.webContents.send("warehouse-3d-data", warehouse3dPayload);
        }
    });
    ipcMain.on("warehouse-3d-movement-action", (event, payload) => {
        if (!warehouse3dWindow || warehouse3dWindow.isDestroyed()
            || warehouse3dWindow.webContents !== event.sender
            || !warehouse3dOwner || warehouse3dOwner.isDestroyed()) return;
        warehouse3dOwner.webContents.send("warehouse-3d-movement-action-request", {
            movementId: String(payload?.movementId || ""),
            view: payload?.view === "instructions" ? "instructions" : "comparison",
        });
    });
    ipcMain.on("warehouse-3d-ready", (event) => {
        if (!warehouse3dWindow || warehouse3dWindow.isDestroyed()
            || warehouse3dWindow.webContents !== event.sender || !warehouse3dPayload) return;
        event.sender.send("warehouse-3d-data", warehouse3dPayload);
    });
    ipcMain.on("warehouse-3d-select-slot", (_event, location) => {
        if (!warehouse3dOwner || warehouse3dOwner.isDestroyed()) return;
        warehouse3dOwner.webContents.send("warehouse-3d-slot-selected", String(location || ""));
    });
    app.on("before-quit", () => {
        try { persistDatabase(app); } catch { /* a previous atomic save remains valid */ }
    });
}
