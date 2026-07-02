import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
import {
    readJsonFile,
} from "../../shared/storage/json-files";
import { logger } from "../../shared/logging/logger";
import {
    createDirectoryBackup,
    createFileBackup,
    ensureDir,
    replaceDirectoryContents,
} from "../../shared/storage/backups";
import {
    createAgpressBackup,
    ensureAgpressDailyBackup,
    getAgpressBackupRootDir,
    listAgpressBackups,
    resolveAgpressBackupDir,
} from "../../shared/storage/agpress-backups";
import {
    getSqliteDatabase,
    runSqliteTransaction,
} from "../../shared/db/sqlite";
import { loadAssigneeOptions } from "../shared/repository";
import type { FpPayload, RequestLike } from "./types";
import type { AssigneesPayload } from "./types";

const REQUESTS_SHARD_REGEX = /^requests-(\d{4}|undated)\.json$/i;
const FERIE_BACKUP_ROOT_DIR = getAgpressBackupRootDir();
const FP_REQUESTS_TABLE = "fp_requests";
const FP_BALANCES_TABLE = "fp_balances";
const FP_HOLIDAYS_TABLE = "fp_holidays";
const FP_CLOSURES_TABLE = "fp_closures";

function getDatabasePath() {
    return backendConfig.database.path;
}

function getPaths() {
    const { calendarDir } = backendConfig.modules.feriePermessi;
    return {
        requestsShardsDir: path.join(calendarDir, "Calendar Years"),
        requestsPath: path.join(calendarDir, "ferie-permessi-requests.json"),
        holidaysPath: path.join(calendarDir, "ferie-permessi-holidays.json"),
        balancesPath: path.join(calendarDir, "ferie-permessi-balances.json"),
        closuresPath: path.join(calendarDir, "ferie-permessi-closures.json"),
        assigneesPath: path.join(
            backendConfig.modules.feriePermessi.generalDir,
            "amministrazione-assignees.json",
        ),
    };
}

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
    const firstValue = result[0]?.values?.[0]?.[0];
    return Number(firstValue) || 0;
}

function ensureFpSqliteSchema() {
    const database = getSqliteDatabase();
    database.exec(`
        CREATE TABLE IF NOT EXISTS ${FP_REQUESTS_TABLE} (
            id TEXT PRIMARY KEY,
            shard_key TEXT NOT NULL,
            start_date TEXT,
            end_date TEXT,
            created_at TEXT,
            updated_at TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_fp_requests_shard_key
            ON ${FP_REQUESTS_TABLE}(shard_key);
        CREATE INDEX IF NOT EXISTS idx_fp_requests_start_date
            ON ${FP_REQUESTS_TABLE}(start_date);

        CREATE TABLE IF NOT EXISTS ${FP_BALANCES_TABLE} (
            balance_key TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${FP_HOLIDAYS_TABLE} (
            row_id INTEGER PRIMARY KEY AUTOINCREMENT,
            sort_order INTEGER NOT NULL,
            payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${FP_CLOSURES_TABLE} (
            row_id INTEGER PRIMARY KEY AUTOINCREMENT,
            sort_order INTEGER NOT NULL,
            payload_json TEXT NOT NULL
        );
    `);
}

function normalizeRequestsData(value: unknown): RequestLike[] {
    if (Array.isArray(value)) return value as RequestLike[];
    if (
        value &&
        typeof value === "object" &&
        "requests" in value &&
        Array.isArray((value as { requests?: unknown }).requests)
    ) {
        return (value as { requests: RequestLike[] }).requests;
    }
    return [];
}

function readRequestsFromShards(directory: string) {
    if (!fs.existsSync(directory)) return null;
    const files = fs
        .readdirSync(directory)
        .filter((name) => REQUESTS_SHARD_REGEX.test(name))
        .sort();
    if (!files.length) return null;

    const requests: RequestLike[] = [];
    for (const name of files) {
        const filePath = path.join(directory, name);
        const rows = normalizeRequestsData(readJsonFile(filePath, []));
        for (const row of rows) requests.push(row);
    }
    return requests;
}

function toShardKey(request: RequestLike) {
    const candidates = [
        request?.start,
        request?.end,
        request?.createdAt,
        request?.updatedAt,
    ];
    for (const value of candidates) {
        if (typeof value !== "string" || !value.trim()) continue;
        const direct = /^(\d{4})/.exec(value.trim());
        if (direct) return direct[1];
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return String(parsed.getFullYear());
    }
    return "undated";
}

function cleanupLegacyFpFiles() {
    const paths = getPaths();
    [
        paths.requestsPath,
        paths.holidaysPath,
        paths.balancesPath,
        paths.closuresPath,
    ].forEach((targetPath) => {
        if (targetPath && fs.existsSync(targetPath)) {
            try {
                fs.unlinkSync(targetPath);
            } catch {
                // ignore cleanup failures
            }
        }
    });
    if (fs.existsSync(paths.requestsShardsDir)) {
        fs.readdirSync(paths.requestsShardsDir)
            .filter((name) => REQUESTS_SHARD_REGEX.test(name))
            .forEach((name) => {
                try {
                    fs.unlinkSync(path.join(paths.requestsShardsDir, name));
                } catch {
                    // ignore cleanup failures
                }
            });
    }
}

function loadLegacyFpPayload(): FpPayload {
    const paths = getPaths();
    const requests =
        readRequestsFromShards(paths.requestsShardsDir) ||
        normalizeRequestsData(readJsonFile(paths.requestsPath, []));

    return {
        requests,
        balances: readJsonFile(paths.balancesPath, {}),
        holidays: readJsonFile(paths.holidaysPath, []),
        closures: readJsonFile(paths.closuresPath, []),
    };
}

function hasFpSqliteData() {
    return (
        execScalarNumber(`SELECT COUNT(*) FROM ${FP_REQUESTS_TABLE}`) > 0 ||
        execScalarNumber(`SELECT COUNT(*) FROM ${FP_BALANCES_TABLE}`) > 0 ||
        execScalarNumber(`SELECT COUNT(*) FROM ${FP_HOLIDAYS_TABLE}`) > 0 ||
        execScalarNumber(`SELECT COUNT(*) FROM ${FP_CLOSURES_TABLE}`) > 0
    );
}

function buildSqliteRequestId(request: RequestLike, index: number) {
    const base =
        String(request?.id || "").trim() ||
        `${String(request?.createdAt || request?.start || "request").trim()}-${index}`;
    return base;
}

function saveFpPayloadToSqlite(payload: FpPayload) {
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${FP_REQUESTS_TABLE}`);
        database.run(`DELETE FROM ${FP_BALANCES_TABLE}`);
        database.run(`DELETE FROM ${FP_HOLIDAYS_TABLE}`);
        database.run(`DELETE FROM ${FP_CLOSURES_TABLE}`);

        const requestStmt = database.prepare(`
            INSERT INTO ${FP_REQUESTS_TABLE} (
                id,
                shard_key,
                start_date,
                end_date,
                created_at,
                updated_at,
                payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        (payload.requests || []).forEach((request, index) => {
            const safeId = buildSqliteRequestId(request, index);
            requestStmt.run([
                safeId,
                toShardKey(request),
                request?.start || null,
                request?.end || null,
                request?.createdAt || null,
                request?.updatedAt || null,
                serializeJson({ ...request, id: safeId }),
            ]);
        });
        requestStmt.free();

        const balanceStmt = database.prepare(`
            INSERT INTO ${FP_BALANCES_TABLE} (balance_key, payload_json)
            VALUES (?, ?)
        `);
        Object.entries(payload.balances || {}).forEach(([key, entry]) => {
            balanceStmt.run([key, serializeJson(entry)]);
        });
        balanceStmt.free();

        const holidayStmt = database.prepare(`
            INSERT INTO ${FP_HOLIDAYS_TABLE} (sort_order, payload_json)
            VALUES (?, ?)
        `);
        (payload.holidays || []).forEach((entry, index) => {
            holidayStmt.run([index, serializeJson(entry)]);
        });
        holidayStmt.free();

        const closureStmt = database.prepare(`
            INSERT INTO ${FP_CLOSURES_TABLE} (sort_order, payload_json)
            VALUES (?, ?)
        `);
        (payload.closures || []).forEach((entry, index) => {
            closureStmt.run([index, serializeJson(entry)]);
        });
        closureStmt.free();
    });
}

function loadFpPayloadFromSqlite(): FpPayload {
    const database = getSqliteDatabase();
    const requestRows = database.exec(`
        SELECT payload_json
        FROM ${FP_REQUESTS_TABLE}
        ORDER BY shard_key ASC, COALESCE(start_date, created_at, updated_at, id) ASC, id ASC
    `);
    const balanceRows = database.exec(`
        SELECT balance_key, payload_json
        FROM ${FP_BALANCES_TABLE}
        ORDER BY balance_key ASC
    `);
    const holidayRows = database.exec(`
        SELECT payload_json
        FROM ${FP_HOLIDAYS_TABLE}
        ORDER BY sort_order ASC, row_id ASC
    `);
    const closureRows = database.exec(`
        SELECT payload_json
        FROM ${FP_CLOSURES_TABLE}
        ORDER BY sort_order ASC, row_id ASC
    `);

    const requests = (requestRows?.[0]?.values || [])
        .map((row: unknown[]) => parseJson<RequestLike>(row?.[0], {} as RequestLike))
        .filter((row: RequestLike) => !!row && typeof row === "object");

    const balances = Object.fromEntries(
        (balanceRows?.[0]?.values || []).map((row: unknown[]) => [
            String(row?.[0] || ""),
            parseJson(row?.[1], {}),
        ]),
    );

    const holidays = (holidayRows?.[0]?.values || []).map((row: unknown[]) =>
        parseJson(row?.[0], {}),
    );
    const closures = (closureRows?.[0]?.values || []).map((row: unknown[]) =>
        parseJson(row?.[0], {}),
    );

    return { requests, balances, holidays, closures };
}

export function initializeFeriePermessiSqliteStore() {
    ensureFpSqliteSchema();
    if (!hasFpSqliteData()) {
        const legacyPayload = loadLegacyFpPayload();
        saveFpPayloadToSqlite(legacyPayload);
        logger.info("FP SQLite seeded from legacy JSON", {
            event: "fp_sqlite_seeded",
            category: "storage",
            module: "calendar",
            requests: legacyPayload.requests.length,
            balances: Object.keys(legacyPayload.balances || {}).length,
            holidays: legacyPayload.holidays.length,
            closures: legacyPayload.closures.length,
        });
    }
    cleanupLegacyFpFiles();
}

export function loadFpPayload(): FpPayload {
    ensureFpSqliteSchema();
    if (!hasFpSqliteData()) {
        const legacyPayload = loadLegacyFpPayload();
        if (
            legacyPayload.requests.length ||
            Object.keys(legacyPayload.balances || {}).length ||
            legacyPayload.holidays.length ||
            legacyPayload.closures.length
        ) {
            saveFpPayloadToSqlite(legacyPayload);
            cleanupLegacyFpFiles();
        }
        return legacyPayload;
    }
    return loadFpPayloadFromSqlite();
}

export function saveFpPayload(payload: FpPayload) {
    ensureAgpressDailyBackup("auto", 30);
    ensureFpSqliteSchema();
    saveFpPayloadToSqlite(payload);
    cleanupLegacyFpFiles();
}

function normalizeAssigneesPayload(parsed: unknown): AssigneesPayload {
    if (Array.isArray(parsed)) {
        const names = parsed.map((name) => String(name));
        return { groups: { Altro: names }, options: names, emails: {} };
    }
    if (parsed && typeof parsed === "object") {
        const rawGroups =
            (parsed as { groups?: unknown }).groups &&
            typeof (parsed as { groups?: unknown }).groups === "object"
                ? (parsed as { groups: Record<string, unknown> }).groups
                : (parsed as Record<string, unknown>);
        const rawEmails =
            (parsed as { emails?: unknown }).emails &&
            typeof (parsed as { emails?: unknown }).emails === "object"
                ? (parsed as { emails: Record<string, unknown> }).emails
                : {};
        const groups: Record<string, string[]> = {};
        const emails: Record<string, string> = {};
        Object.keys(rawGroups).forEach((key) => {
            const values = Array.isArray(rawGroups[key]) ? rawGroups[key] : [];
            groups[key] = values
                .map((entry) =>
                    typeof entry === "string"
                        ? entry.trim()
                        : entry && typeof entry === "object"
                          ? String((entry as { name?: string }).name || "").trim()
                          : "",
                )
                .filter(Boolean);
        });
        Object.keys(rawEmails).forEach((key) => {
            const value = rawEmails[key];
            if (typeof value === "string" && value.trim()) {
                emails[key] = value.trim();
            }
        });
        return { groups, options: Object.values(groups).flat(), emails };
    }
    return { groups: {}, options: [], emails: {} };
}

export function loadAssignees(): AssigneesPayload {
    const shared = loadAssigneeOptions();
    return {
        groups: shared.groups || {},
        options: Array.isArray(shared.options) ? shared.options : [],
        emails: shared.emails || {},
    };
}

export function listFeriePermessiBackups() {
    return listAgpressBackups();
}

export function createFeriePermessiBackup(mode: "calendar" | "full" = "full") {
    const isFull = mode === "full";
    if (isFull) {
        return createAgpressBackup("manual-full", 30);
    }
    return createFileBackup({
        sourceFile: getDatabasePath(),
        backupRootDir: FERIE_BACKUP_ROOT_DIR,
        prefix: "manual-calendar",
        limit: 30,
        backupFileName: path.join("General", "data", "aypi.db"),
    });
}

export function restoreFeriePermessiBackup(
    name: string,
    mode: "calendar" | "full" = "calendar",
) {
    const sourceDir = resolveAgpressBackupDir(name);
    if (!fs.existsSync(sourceDir)) {
        throw new Error("Backup not found");
    }
    if (mode === "full") {
        if (!fs.existsSync(path.join(sourceDir, "AyPi Calendar"))) {
            const dbInBackup = path.join(sourceDir, "General", "data", "aypi.db");
            if (!fs.existsSync(dbInBackup)) {
                throw new Error("Il backup selezionato non contiene un AGPRESS completo");
            }
        }
        replaceDirectoryContents(
            sourceDir,
            backendConfig.modules.feriePermessi.baseDir,
        );
        return { ok: true, restored: name, mode };
    }
    const dbInBackup = fs.existsSync(path.join(sourceDir, "General", "data", "aypi.db"))
        ? path.join(sourceDir, "General", "data", "aypi.db")
        : path.join(sourceDir, "aypi.db");
    if (!fs.existsSync(dbInBackup)) {
        throw new Error("Nel backup selezionato non esiste il database SQLite");
    }
    const dbPath = getDatabasePath();
    ensureDir(path.dirname(dbPath));
    fs.copyFileSync(dbInBackup, dbPath);
    return { ok: true, restored: name, mode };
}
