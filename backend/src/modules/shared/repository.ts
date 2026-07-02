import fs from "fs";
import crypto from "crypto";
import path from "path";
import { argon2id, argon2Verify } from "hash-wasm";
import { backendConfig } from "../../config";
import { readJsonFile } from "../../shared/storage/json-files";
import { ensureAgpressDailyBackup } from "../../shared/storage/agpress-backups";
import { getSqliteDatabase, runSqliteTransaction } from "../../shared/db/sqlite";

export type SharedAdminEntry = {
    name: string;
    password?: string;
    passwordHash?: string;
    email?: string;
    phone?: string;
    accessCalendar?: boolean;
    accessPurchasing?: boolean;
};

export type SharedAssigneesPayload = {
    groups: Record<string, string[]>;
    emails: Record<string, string>;
    options: string[];
};

const APPROVAL_PASSWORD = "AGPress";
const ADMINS_PATH = path.join(
    backendConfig.modules.feriePermessi.generalDir,
    "ferie-permessi-admins.json",
);
const LEGACY_ADMINS_PATH = path.join(
    backendConfig.modules.feriePermessi.baseDir,
    "ferie-permessi-admins.json",
);
const ASSIGNEES_PATH = path.join(
    backendConfig.modules.feriePermessi.generalDir,
    "amministrazione-assignees.json",
);
const LEGACY_ASSIGNEES_PATH = path.join(
    backendConfig.modules.feriePermessi.baseDir,
    "amministrazione-assignees.json",
);
const SHARED_ADMINS_TABLE = "shared_admins";
const SHARED_ASSIGNEES_TABLE = "shared_assignees";
function ensureGeneralBackup() {
    return ensureAgpressDailyBackup("auto", 30);
}

function cleanupLegacySharedFiles() {
    [ADMINS_PATH, LEGACY_ADMINS_PATH, ASSIGNEES_PATH, LEGACY_ASSIGNEES_PATH].forEach(
        (targetPath) => {
            if (!targetPath || !fs.existsSync(targetPath)) return;
            try {
                fs.unlinkSync(targetPath);
            } catch {
                // ignore cleanup failures
            }
        },
    );
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
    return Number(result[0]?.values?.[0]?.[0]) || 0;
}

function ensureSharedSqliteSchema() {
    const database = getSqliteDatabase();
    database.exec(`
        CREATE TABLE IF NOT EXISTS ${SHARED_ADMINS_TABLE} (
            name TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${SHARED_ASSIGNEES_TABLE} (
            store_key TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL
        );
    `);
}

function parseAdminsFromPath(targetPath: string): SharedAdminEntry[] {
    const raw = fs.readFileSync(targetPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
        return parsed
            .filter((item) => item && item.name && (item.password || item.passwordHash))
            .map(normalizeAdminEntry);
    }
    if (parsed && Array.isArray(parsed.admins)) {
        return parsed.admins
            .filter((item) => item && item.name && (item.password || item.passwordHash))
            .map(normalizeAdminEntry);
    }
    if (parsed && typeof parsed === "object") {
        return Object.entries(parsed)
            .filter(([name, password]) => name && password)
            .map(([name, password]) => {
                const value = String(password || "");
                return value.startsWith("$argon2")
                    ? normalizeAdminEntry({
                          name,
                          passwordHash: value,
                      })
                    : normalizeAdminEntry({
                          name,
                          password: value,
                      });
            });
    }
    return [];
}

function normalizeAdminEntry(item: any): SharedAdminEntry {
    return {
        name: String(item?.name || "").trim(),
        password: item?.password ? String(item.password) : undefined,
        passwordHash: item?.passwordHash ? String(item.passwordHash) : undefined,
        email: item?.email ? String(item.email) : "",
        phone: item?.phone ? String(item.phone) : "",
        accessCalendar:
            typeof item?.accessCalendar === "boolean" ? item.accessCalendar : true,
        accessPurchasing:
            typeof item?.accessPurchasing === "boolean" ? item.accessPurchasing : true,
    };
}

function loadLegacyAdminCredentials(): SharedAdminEntry[] {
    try {
        const candidates = [ADMINS_PATH, LEGACY_ADMINS_PATH].filter(
            (item) => item && fs.existsSync(item),
        );
        if (!candidates.length) {
            return [{ name: "Admin", password: APPROVAL_PASSWORD }];
        }
        for (const filePath of candidates) {
            const admins = parseAdminsFromPath(filePath);
            if (admins.length) return admins;
        }
    } catch {
        // ignore and fallback
    }
    return [{ name: "Admin", password: APPROVAL_PASSWORD }];
}

function saveAdminCredentialsToSqlite(admins: SharedAdminEntry[]) {
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${SHARED_ADMINS_TABLE}`);
        const statement = database.prepare(`
            INSERT INTO ${SHARED_ADMINS_TABLE} (name, payload_json)
            VALUES (?, ?)
        `);
        admins.forEach((admin) => {
            const normalized = normalizeAdminEntry(admin);
            if (!normalized.name) return;
            statement.run([normalized.name, serializeJson(normalized)]);
        });
        statement.free();
    });
}

function loadAdminCredentialsFromSqlite(): SharedAdminEntry[] {
    const database = getSqliteDatabase();
    const rows = database.exec(`
        SELECT payload_json
        FROM ${SHARED_ADMINS_TABLE}
        ORDER BY name ASC
    `);
    const admins = (rows?.[0]?.values || [])
        .map((row: unknown[]) => normalizeAdminEntry(parseJson(row?.[0], {})))
        .filter((entry: SharedAdminEntry) => !!entry.name);
    return admins.length ? admins : [{ name: "Admin", password: APPROVAL_PASSWORD }];
}

function hasSharedAdminsSqliteData() {
    return execScalarNumber(`SELECT COUNT(*) FROM ${SHARED_ADMINS_TABLE}`) > 0;
}

export function loadAdminCredentials(): SharedAdminEntry[] {
    ensureSharedSqliteSchema();
    if (!hasSharedAdminsSqliteData()) {
        const legacyAdmins = loadLegacyAdminCredentials();
        saveAdminCredentialsToSqlite(legacyAdmins);
        return legacyAdmins;
    }
    return loadAdminCredentialsFromSqlite();
}

export function listAdminNames() {
    return loadAdminCredentials()
        .map((entry) => entry.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
}

async function hashPassword(password: string) {
    const salt = crypto.randomBytes(16);
    return argon2id({
        password,
        salt,
        parallelism: 1,
        iterations: 1,
        memorySize: 1024,
        hashLength: 32,
        outputType: "encoded",
    });
}

async function verifyPasswordHash(hash: string, password: string) {
    try {
        return await argon2Verify({ password, hash });
    } catch {
        return false;
    }
}

export async function verifyAdminPassword(
    password: string,
    targetName?: string | null,
) {
    if (!password) return null;
    const admins = loadAdminCredentials();
    for (const admin of admins) {
        if (targetName && admin.name !== targetName) continue;
        if (admin.passwordHash) {
            const ok = await verifyPasswordHash(admin.passwordHash, password);
            if (ok) {
                try {
                    const nextHash = await hashPassword(password);
                    if (nextHash && nextHash !== admin.passwordHash) {
                        admin.passwordHash = nextHash;
                        await saveAdminCredentials(admins);
                    }
                } catch {
                    // ignore rehash failures
                }
                return admin;
            }
            continue;
        }
        if (admin.password && admin.password === password) {
            try {
                admin.passwordHash = await hashPassword(password);
                delete admin.password;
                await saveAdminCredentials(admins);
            } catch {
                // ignore hash upgrade failures
            }
            return admin;
        }
    }
    return null;
}

export async function saveAdminCredentials(admins: SharedAdminEntry[]) {
    ensureGeneralBackup();
    const normalizedAdmins = admins.map((admin) => ({
            name: admin.name,
            passwordHash: admin.passwordHash,
            password: admin.passwordHash ? undefined : admin.password,
            email: admin.email || "",
            phone: admin.phone || "",
            accessCalendar:
                typeof admin.accessCalendar === "boolean"
                    ? admin.accessCalendar
                    : true,
            accessPurchasing:
                typeof admin.accessPurchasing === "boolean"
                    ? admin.accessPurchasing
                    : true,
    }));
    saveAdminCredentialsToSqlite(normalizedAdmins);
    cleanupLegacySharedFiles();
}

function normalizeAssigneesPayload(parsed: any): SharedAssigneesPayload {
    if (!(parsed && typeof parsed === "object")) {
        return { groups: {}, emails: {}, options: [] };
    }
    const rawGroups =
        parsed.groups && typeof parsed.groups === "object" ? parsed.groups : parsed;
    const rawEmails =
        parsed.emails && typeof parsed.emails === "object" ? parsed.emails : {};
    const groups: Record<string, string[]> = {};
    const emails: Record<string, string> = {};
    Object.keys(rawGroups).forEach((key) => {
        const list = Array.isArray(rawGroups[key]) ? rawGroups[key] : [];
        const names: string[] = [];
        list.forEach((entry: any) => {
            if (typeof entry === "string") {
                const name = entry.trim();
                if (name) names.push(name);
                return;
            }
            if (entry && typeof entry === "object") {
                const name = String(entry.name || "").trim();
                const email = String(entry.email || "").trim();
                if (!name) return;
                names.push(name);
                if (email) emails[`${key}|${name}`] = email;
            }
        });
        groups[key] = names;
    });
    Object.keys(rawEmails).forEach((key) => {
        const value = String(rawEmails[key] || "").trim();
        if (value && !emails[key]) {
            emails[key] = value;
        }
    });
    return {
        groups,
        emails,
        options: Object.values(groups).flat(),
    };
}

function loadLegacyAssigneeOptions(): SharedAssigneesPayload {
    const candidates = [ASSIGNEES_PATH, LEGACY_ASSIGNEES_PATH].filter(Boolean);
    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
            return normalizeAssigneesPayload(readJsonFile(candidate, {}));
        } catch {
            // continue
        }
    }
    return { groups: {}, emails: {}, options: [] };
}

function saveAssigneeOptionsToSqlite(payload: {
    groups?: Record<string, string[]>;
    emails?: Record<string, string>;
}) {
    const normalized = normalizeAssigneesPayload({
        groups: payload?.groups && typeof payload.groups === "object" ? payload.groups : {},
        emails: payload?.emails && typeof payload.emails === "object" ? payload.emails : {},
    });
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${SHARED_ASSIGNEES_TABLE}`);
        database.run(
            `INSERT INTO ${SHARED_ASSIGNEES_TABLE} (store_key, payload_json) VALUES (?, ?)`,
            ["assignees", serializeJson(normalized)],
        );
    });
}

function loadAssigneeOptionsFromSqlite(): SharedAssigneesPayload {
    const database = getSqliteDatabase();
    const rows = database.exec(`
        SELECT payload_json
        FROM ${SHARED_ASSIGNEES_TABLE}
        WHERE store_key = 'assignees'
    `);
    const raw = rows?.[0]?.values?.[0]?.[0];
    return normalizeAssigneesPayload(parseJson(raw, {}));
}

function hasSharedAssigneesSqliteData() {
    return execScalarNumber(`SELECT COUNT(*) FROM ${SHARED_ASSIGNEES_TABLE}`) > 0;
}

export function loadAssigneeOptions(): SharedAssigneesPayload {
    ensureSharedSqliteSchema();
    if (!hasSharedAssigneesSqliteData()) {
        const legacyAssignees = loadLegacyAssigneeOptions();
        saveAssigneeOptionsToSqlite(legacyAssignees);
        return legacyAssignees;
    }
    return loadAssigneeOptionsFromSqlite();
}

export async function saveAssigneeOptions(payload: {
    groups?: Record<string, string[]>;
    emails?: Record<string, string>;
}) {
    ensureGeneralBackup();
    const normalized = {
        groups: payload?.groups && typeof payload.groups === "object" ? payload.groups : {},
        emails: payload?.emails && typeof payload.emails === "object" ? payload.emails : {},
    };
    saveAssigneeOptionsToSqlite(normalized);
    cleanupLegacySharedFiles();
}

export function initializeSharedSqliteStore() {
    ensureSharedSqliteSchema();
    if (!hasSharedAdminsSqliteData()) {
        saveAdminCredentialsToSqlite(loadLegacyAdminCredentials());
    }
    if (!hasSharedAssigneesSqliteData()) {
        saveAssigneeOptionsToSqlite(loadLegacyAssigneeOptions());
    }
    cleanupLegacySharedFiles();
}
