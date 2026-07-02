import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
import { ensureFolderFor, readJsonFile } from "../../shared/storage/json-files";
import {
    copyDirectory,
    ensureDir,
    replaceDirectoryContents,
} from "../../shared/storage/backups";
import {
    backupContains,
    createAgpressBackup,
    ensureAgpressDailyBackup,
    listAgpressBackups,
    resolveAgpressBackupDir,
} from "../../shared/storage/agpress-backups";
import {
    getSqliteDatabase,
    runSqliteTransaction,
} from "../../shared/db/sqlite";
import { loadAssigneeOptions } from "../shared/repository";

const PURCHASING_DIR = backendConfig.modules.productManager.dir;
const CATALOG_PATH = path.join(PURCHASING_DIR, "catalog.json");
const CATEGORIES_PATH = path.join(PURCHASING_DIR, "categories.json");
const INTERVENTION_TYPES_PATH = path.join(PURCHASING_DIR, "intervention-types.json");
const PRODUCTS_DIR = path.join(PURCHASING_DIR, "products");
const REQUESTS_SHARDS_DIR = path.join(PURCHASING_DIR, "requests");
const INTERVENTIONS_SHARDS_DIR = path.join(PURCHASING_DIR, "interventions");
const PM_REQUESTS_TABLE = "pm_requests";
const PM_INTERVENTIONS_TABLE = "pm_interventions";
const PM_CATALOG_TABLE = "pm_catalog";
const PM_CATEGORIES_TABLE = "pm_categories";
const PM_INTERVENTION_TYPES_TABLE = "pm_intervention_types";
const DB_RELATIVE_PATH = path.join("General", "data", "aypi.db");
function ensureProductManagerDir() {
    fs.mkdirSync(PURCHASING_DIR, { recursive: true });
    fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
}

function ensureProductManagerBackup(prefix = "auto", limit = 30) {
    return prefix === "auto"
        ? ensureAgpressDailyBackup(prefix, limit)
        : createAgpressBackup(prefix, limit);
}

const REQUESTS_SHARD_REGEX = /^requests-(\d{4}|undated)\.json$/i;
const INTERVENTIONS_SHARD_REGEX = /^interventions-(\d{4}|undated)\.json$/i;

function serializeJson(value: unknown) {
    return JSON.stringify(value ?? null);
}

function parseJson<T>(raw: unknown, fallback: T): T {
    if (typeof raw !== "string" || !raw.trim()) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

function execScalarNumber(sql: string, params: unknown[] = []) {
    const database = getSqliteDatabase();
    const result = database.exec(sql, params);
    if (!Array.isArray(result) || !result.length) return 0;
    return Number(result[0]?.values?.[0]?.[0]) || 0;
}

function ensureProductManagerSqliteSchema() {
    const database = getSqliteDatabase();
    database.exec(`
        CREATE TABLE IF NOT EXISTS ${PM_REQUESTS_TABLE} (
            row_id TEXT PRIMARY KEY,
            shard_key TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${PM_REQUESTS_TABLE}_shard
            ON ${PM_REQUESTS_TABLE}(shard_key);

        CREATE TABLE IF NOT EXISTS ${PM_INTERVENTIONS_TABLE} (
            row_id TEXT PRIMARY KEY,
            shard_key TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${PM_INTERVENTIONS_TABLE}_shard
            ON ${PM_INTERVENTIONS_TABLE}(shard_key);

        CREATE TABLE IF NOT EXISTS ${PM_CATALOG_TABLE} (
            row_id TEXT PRIMARY KEY,
            sort_order INTEGER NOT NULL,
            payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${PM_CATEGORIES_TABLE} (
            row_id TEXT PRIMARY KEY,
            sort_order INTEGER NOT NULL,
            payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${PM_INTERVENTION_TYPES_TABLE} (
            row_id TEXT PRIMARY KEY,
            sort_order INTEGER NOT NULL,
            payload_json TEXT NOT NULL
        );
    `);
}

function getYearKey(request: any) {
    const value = String(request?.createdAt || request?.updatedAt || "").trim();
    if (!value) return "undated";
    const direct = /^(\d{4})/.exec(value);
    if (direct) return direct[1];
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return String(date.getFullYear());
    return "undated";
}

function listShardFiles(dirPath: string, regex: RegExp) {
    if (!fs.existsSync(dirPath)) return [];
    return fs
        .readdirSync(dirPath)
        .filter((name) => regex.test(name))
        .sort()
        .map((name) => path.join(dirPath, name));
}

function readShardCollection(dirPath: string, regex: RegExp) {
    ensureProductManagerDir();
    const out: any[] = [];
    listShardFiles(dirPath, regex).forEach((filePath) => {
        const parsed = readJsonFile<any>(filePath, []);
        if (Array.isArray(parsed)) {
            parsed.forEach((item) => out.push(item));
            return;
        }
        if (parsed && Array.isArray(parsed.items)) {
            parsed.items.forEach((item: any) => out.push(item));
        }
    });
    return out;
}

function buildRowId(item: any, index: number, prefix: string) {
    const candidates = [
        item?.id,
        item?.code,
        item?.catalogId,
        item?.name,
        item?.createdAt,
        item?.updatedAt,
    ];
    for (const candidate of candidates) {
        const value = String(candidate || "").trim();
        if (value) return value;
    }
    return `${prefix}_${index}`;
}

function cleanupLegacyProductManagerFiles() {
    [
        CATALOG_PATH,
        CATEGORIES_PATH,
        INTERVENTION_TYPES_PATH,
    ].forEach((targetPath) => {
        if (targetPath && fs.existsSync(targetPath)) {
            try {
                fs.unlinkSync(targetPath);
            } catch {
                // ignore cleanup failures
            }
        }
    });
    [
        [REQUESTS_SHARDS_DIR, REQUESTS_SHARD_REGEX],
        [INTERVENTIONS_SHARDS_DIR, INTERVENTIONS_SHARD_REGEX],
    ].forEach(([dirPath, regex]) => {
        if (!fs.existsSync(String(dirPath))) return;
        fs.readdirSync(String(dirPath))
            .filter((name) => (regex as RegExp).test(name))
            .forEach((name) => {
                try {
                    fs.unlinkSync(path.join(String(dirPath), name));
                } catch {
                    // ignore cleanup failures
                }
            });
    });
}

function loadLegacyProductManagerBootstrap() {
    ensureProductManagerDir();
    return {
        requests: readShardCollection(REQUESTS_SHARDS_DIR, REQUESTS_SHARD_REGEX),
        interventions: readShardCollection(
            INTERVENTIONS_SHARDS_DIR,
            INTERVENTIONS_SHARD_REGEX,
        ),
        catalog: readJsonFile(CATALOG_PATH, [] as any[]),
        categories: readJsonFile(CATEGORIES_PATH, [] as any[]),
        interventionTypes: readJsonFile(INTERVENTION_TYPES_PATH, [] as any[]),
        assignees: loadAssigneeOptions(),
    };
}

function hasProductManagerSqliteData() {
    return (
        execScalarNumber(`SELECT COUNT(*) FROM ${PM_REQUESTS_TABLE}`) > 0 ||
        execScalarNumber(`SELECT COUNT(*) FROM ${PM_INTERVENTIONS_TABLE}`) > 0 ||
        execScalarNumber(`SELECT COUNT(*) FROM ${PM_CATALOG_TABLE}`) > 0 ||
        execScalarNumber(`SELECT COUNT(*) FROM ${PM_CATEGORIES_TABLE}`) > 0 ||
        execScalarNumber(`SELECT COUNT(*) FROM ${PM_INTERVENTION_TYPES_TABLE}`) > 0
    );
}

function replaceTableWithCollection(
    tableName: string,
    payload: any[],
    options: {
        prefix: string;
        shard?: boolean;
    },
) {
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${tableName}`);
        const statement = database.prepare(`
            INSERT INTO ${tableName} (
                row_id,
                ${options.shard ? "shard_key, created_at, updated_at," : "sort_order,"}
                payload_json
            ) VALUES (?, ${options.shard ? "?, ?, ?, ?" : "?, ?"})
        `);
        (Array.isArray(payload) ? payload : []).forEach((item, index) => {
            const rowId = buildRowId(item, index, options.prefix);
            if (options.shard) {
                statement.run([
                    rowId,
                    getYearKey(item),
                    item?.createdAt || null,
                    item?.updatedAt || null,
                    serializeJson({ ...item }),
                ]);
                return;
            }
            statement.run([rowId, index, serializeJson(item)]);
        });
        statement.free();
    });
}

function loadCollectionFromTable(
    tableName: string,
    options: { shard?: boolean } = {},
) {
    const database = getSqliteDatabase();
    const result = database.exec(`
        SELECT payload_json
        FROM ${tableName}
        ORDER BY ${options.shard ? "shard_key ASC, COALESCE(created_at, updated_at, row_id) ASC, row_id ASC" : "sort_order ASC, row_id ASC"}
    `);
    return (result?.[0]?.values || []).map((row: unknown[]) =>
        parseJson(row?.[0], {}),
    );
}

function saveProductManagerBootstrapToSqlite(payload: {
    requests?: any[];
    interventions?: any[];
    catalog?: any[];
    categories?: any[];
    interventionTypes?: any[];
}) {
    replaceTableWithCollection(PM_REQUESTS_TABLE, payload.requests || [], {
        prefix: "request",
        shard: true,
    });
    replaceTableWithCollection(
        PM_INTERVENTIONS_TABLE,
        payload.interventions || [],
        {
            prefix: "intervention",
            shard: true,
        },
    );
    replaceTableWithCollection(PM_CATALOG_TABLE, payload.catalog || [], {
        prefix: "catalog",
    });
    replaceTableWithCollection(PM_CATEGORIES_TABLE, payload.categories || [], {
        prefix: "category",
    });
    replaceTableWithCollection(
        PM_INTERVENTION_TYPES_TABLE,
        payload.interventionTypes || [],
        {
            prefix: "intervention_type",
        },
    );
}

function loadProductManagerBootstrapFromSqlite() {
    ensureProductManagerDir();
    return {
        requests: loadCollectionFromTable(PM_REQUESTS_TABLE, { shard: true }),
        interventions: loadCollectionFromTable(PM_INTERVENTIONS_TABLE, {
            shard: true,
        }),
        catalog: loadCollectionFromTable(PM_CATALOG_TABLE),
        categories: loadCollectionFromTable(PM_CATEGORIES_TABLE),
        interventionTypes: loadCollectionFromTable(PM_INTERVENTION_TYPES_TABLE),
        assignees: loadAssigneeOptions(),
    };
}

export function initializeProductManagerSqliteStore() {
    ensureProductManagerSqliteSchema();
    if (!hasProductManagerSqliteData()) {
        const legacyPayload = loadLegacyProductManagerBootstrap();
        saveProductManagerBootstrapToSqlite(legacyPayload);
    }
    cleanupLegacyProductManagerFiles();
}

export function loadProductManagerBootstrap() {
    ensureProductManagerSqliteSchema();
    if (!hasProductManagerSqliteData()) {
        const legacyPayload = loadLegacyProductManagerBootstrap();
        saveProductManagerBootstrapToSqlite(legacyPayload);
        cleanupLegacyProductManagerFiles();
        return legacyPayload;
    }
    return loadProductManagerBootstrapFromSqlite();
}

export function saveProductManagerRequests(payload: any[]) {
    ensureProductManagerBackup();
    ensureProductManagerSqliteSchema();
    replaceTableWithCollection(PM_REQUESTS_TABLE, Array.isArray(payload) ? payload : [], {
        prefix: "request",
        shard: true,
    });
    cleanupLegacyProductManagerFiles();
    return loadCollectionFromTable(PM_REQUESTS_TABLE, { shard: true });
}

export function saveProductManagerInterventions(payload: any[]) {
    ensureProductManagerBackup();
    ensureProductManagerSqliteSchema();
    replaceTableWithCollection(
        PM_INTERVENTIONS_TABLE,
        Array.isArray(payload) ? payload : [],
        {
            prefix: "intervention",
            shard: true,
        },
    );
    cleanupLegacyProductManagerFiles();
    return loadCollectionFromTable(PM_INTERVENTIONS_TABLE, { shard: true });
}

export function saveProductManagerCatalog(payload: any[]) {
    ensureProductManagerBackup();
    ensureProductManagerSqliteSchema();
    replaceTableWithCollection(PM_CATALOG_TABLE, Array.isArray(payload) ? payload : [], {
        prefix: "catalog",
    });
    cleanupLegacyProductManagerFiles();
    return loadCollectionFromTable(PM_CATALOG_TABLE);
}

export function saveProductManagerCategories(payload: any[]) {
    ensureProductManagerBackup();
    ensureProductManagerSqliteSchema();
    replaceTableWithCollection(
        PM_CATEGORIES_TABLE,
        Array.isArray(payload) ? payload : [],
        {
            prefix: "category",
        },
    );
    cleanupLegacyProductManagerFiles();
    return loadCollectionFromTable(PM_CATEGORIES_TABLE);
}

export function saveProductManagerInterventionTypes(payload: any[]) {
    ensureProductManagerBackup();
    ensureProductManagerSqliteSchema();
    replaceTableWithCollection(
        PM_INTERVENTION_TYPES_TABLE,
        Array.isArray(payload) ? payload : [],
        {
            prefix: "intervention_type",
        },
    );
    cleanupLegacyProductManagerFiles();
    return loadCollectionFromTable(PM_INTERVENTION_TYPES_TABLE);
}

function sanitizeImageName(value: string) {
    return String(value || "")
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ");
}

export function saveCatalogImage(payload: {
    catalogId?: string;
    fileName?: string;
    dataBase64?: string;
}) {
    ensureProductManagerDir();
    ensureProductManagerBackup();
    const catalogId = sanitizeImageName(payload?.catalogId || "");
    const originalName = sanitizeImageName(payload?.fileName || "");
    if (!catalogId || !payload?.dataBase64) {
        throw new Error("Missing image payload");
    }
    const ext = path.extname(originalName) || ".png";
    const safeName = `${catalogId}${ext}`;
    const buffer = Buffer.from(String(payload.dataBase64 || ""), "base64");
    const filePath = path.join(PRODUCTS_DIR, safeName);
    ensureFolderFor(filePath);
    fs.writeFileSync(filePath, buffer);
    return {
        imageFile: safeName,
    };
}

export function resolveCatalogImagePath(fileName: string) {
    return path.join(PRODUCTS_DIR, sanitizeImageName(fileName));
}

export function listProductManagerBackups() {
    return listAgpressBackups().filter((entry) =>
        backupContains(DB_RELATIVE_PATH, entry.name),
    );
}

export function createProductManagerBackup(limit = 10) {
    return ensureProductManagerBackup("manual-purchasing", limit);
}

export function restoreProductManagerBackup(name: string) {
    const safeName = String(name || "").trim();
    if (!safeName) {
        throw new Error("Backup name missing");
    }
    const backupDir = resolveAgpressBackupDir(safeName);
    const dbInBackup = path.join(backupDir, DB_RELATIVE_PATH);
    if (!fs.existsSync(dbInBackup)) {
        throw new Error("Backup not found");
    }
    ensureDir(path.dirname(backendConfig.database.path));
    fs.copyFileSync(dbInBackup, backendConfig.database.path);
    const productsBackupDir = path.join(backupDir, "AyPi Purchasing", "products");
    if (fs.existsSync(productsBackupDir)) {
        replaceDirectoryContents(productsBackupDir, PRODUCTS_DIR);
    }
    return {
        ok: true,
        restored: safeName,
    };
}
