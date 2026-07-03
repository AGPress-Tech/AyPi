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
const CALENDAR_ACCESS_CONFIG_PATH = path.join(
    backendConfig.modules.feriePermessi.calendarDir,
    "config-calendar.json",
);
const LEGACY_CALENDAR_ACCESS_CONFIG_PATH = path.join(
    backendConfig.modules.feriePermessi.baseDir,
    "config-calendar.json",
);
const OTP_MAIL_PATH = path.join(
    backendConfig.modules.feriePermessi.generalDir,
    "data",
    "otp-mail.json",
);
const LEGACY_OTP_MAIL_PATHS = [
    path.join(backendConfig.modules.feriePermessi.baseDir, "otp-mail.json"),
    path.join(backendConfig.modules.feriePermessi.generalDir, "otp-mail.json"),
];
const SHARED_ADMINS_TABLE = "shared_admins";
const SHARED_ASSIGNEES_TABLE = "shared_assignees";
const SHARED_SETTINGS_TABLE = "shared_settings";
const SHARED_SETTING_ACCESS_CONFIG = "calendar_access_config";
const SHARED_SETTING_OTP_MAIL = "otp_mail";

export type SharedAccessConfig = {
    version: number;
    operations: {
        create: Record<string, boolean>;
        pending: {
            access: boolean;
            approve: boolean;
            reject: boolean;
        };
        editApproved: boolean;
        deleteApproved: boolean;
        filters: Record<string, boolean>;
        manageAccess: boolean;
        daysAccess: boolean;
        export: boolean;
    };
};

export type SharedOtpMailConfig = {
    host: string;
    user: string;
    pass: string;
    port?: number;
    secure?: boolean;
    from?: string;
};

const DEFAULT_ACCESS_CONFIG: SharedAccessConfig = {
    version: 1,
    operations: {
        create: {
            ferie: false,
            permesso: false,
            straordinari: false,
            mutua: true,
            speciale: true,
            retribuito: true,
        },
        pending: {
            access: true,
            approve: true,
            reject: true,
        },
        editApproved: true,
        deleteApproved: true,
        filters: {
            ferie: false,
            permesso: false,
            straordinari: true,
            mutua: true,
            speciale: true,
            retribuito: true,
        },
        manageAccess: true,
        daysAccess: true,
        export: true,
    },
};
function ensureGeneralBackup() {
    return ensureAgpressDailyBackup("auto", 30);
}

function cleanupLegacySharedFiles() {
    [
        ADMINS_PATH,
        LEGACY_ADMINS_PATH,
        ASSIGNEES_PATH,
        LEGACY_ASSIGNEES_PATH,
        CALENDAR_ACCESS_CONFIG_PATH,
        LEGACY_CALENDAR_ACCESS_CONFIG_PATH,
        OTP_MAIL_PATH,
        ...LEGACY_OTP_MAIL_PATHS,
    ].forEach((targetPath) => {
        if (!targetPath || !fs.existsSync(targetPath)) return;
        try {
            fs.unlinkSync(targetPath);
        } catch {
            // ignore cleanup failures
        }
    });
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
        CREATE TABLE IF NOT EXISTS ${SHARED_SETTINGS_TABLE} (
            store_key TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL
        );
    `);
}

function toBool(value: unknown, fallback: boolean) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const trimmed = value.trim().toLowerCase();
        if (
            trimmed === "true" ||
            trimmed === "1" ||
            trimmed === "on" ||
            trimmed === "si"
        ) {
            return true;
        }
        if (
            trimmed === "false" ||
            trimmed === "0" ||
            trimmed === "off" ||
            trimmed === "no"
        ) {
            return false;
        }
    }
    return fallback;
}

export function normalizeAccessConfig(raw: unknown): SharedAccessConfig {
    const base: SharedAccessConfig = JSON.parse(
        JSON.stringify(DEFAULT_ACCESS_CONFIG),
    );
    const src =
        raw && typeof raw === "object" ? (raw as Partial<SharedAccessConfig>) : {};
    const ops =
        src.operations && typeof src.operations === "object"
            ? (src.operations as SharedAccessConfig["operations"])
            : ({} as SharedAccessConfig["operations"]);
    const create = (
        ops.create && typeof ops.create === "object" ? ops.create : {}
    ) as SharedAccessConfig["operations"]["create"];
    const pending = (
        ops.pending && typeof ops.pending === "object" ? ops.pending : {}
    ) as SharedAccessConfig["operations"]["pending"];
    const filters = (
        ops.filters && typeof ops.filters === "object" ? ops.filters : {}
    ) as SharedAccessConfig["operations"]["filters"];

    base.operations.create.ferie = toBool(
        create.ferie,
        base.operations.create.ferie,
    );
    base.operations.create.permesso = toBool(
        create.permesso,
        base.operations.create.permesso,
    );
    base.operations.create.straordinari = toBool(
        create.straordinari,
        base.operations.create.straordinari,
    );
    base.operations.create.mutua = toBool(
        create.mutua,
        base.operations.create.mutua,
    );
    base.operations.create.speciale = toBool(
        create.speciale,
        base.operations.create.speciale,
    );
    base.operations.create.retribuito = toBool(
        create.retribuito,
        base.operations.create.retribuito,
    );
    base.operations.pending.access = toBool(
        pending.access,
        base.operations.pending.access,
    );
    base.operations.pending.approve = toBool(
        pending.approve,
        base.operations.pending.approve,
    );
    base.operations.pending.reject = toBool(
        pending.reject,
        base.operations.pending.reject,
    );
    base.operations.editApproved = toBool(
        ops.editApproved,
        base.operations.editApproved,
    );
    base.operations.deleteApproved = toBool(
        ops.deleteApproved,
        base.operations.deleteApproved,
    );
    base.operations.filters.ferie = toBool(
        filters.ferie,
        base.operations.filters.ferie,
    );
    base.operations.filters.permesso = toBool(
        filters.permesso,
        base.operations.filters.permesso,
    );
    base.operations.filters.straordinari = toBool(
        filters.straordinari,
        base.operations.filters.straordinari,
    );
    base.operations.filters.mutua = toBool(
        filters.mutua,
        base.operations.filters.mutua,
    );
    base.operations.filters.speciale = toBool(
        filters.speciale,
        base.operations.filters.speciale,
    );
    base.operations.filters.retribuito = toBool(
        filters.retribuito,
        base.operations.filters.retribuito,
    );
    base.operations.manageAccess = toBool(
        ops.manageAccess,
        base.operations.manageAccess,
    );
    base.operations.daysAccess = toBool(
        ops.daysAccess,
        base.operations.daysAccess,
    );
    base.operations.export = toBool(ops.export, base.operations.export);
    return base;
}

export function normalizeOtpMailConfig(payload: unknown): SharedOtpMailConfig {
    if (!payload || typeof payload !== "object") {
        throw new Error("Config mail non valida.");
    }
    const obj = payload as Record<string, unknown>;
    const host = String(obj.host || "").trim();
    const user = String(obj.user || "").trim();
    const pass = String(obj.pass || "").trim();
    const from = String(obj.from || "").trim();
    const portRaw = obj.port;
    const port =
        portRaw !== undefined &&
        portRaw !== null &&
        String(portRaw).trim() !== ""
            ? Number(portRaw)
            : undefined;
    const secure = !!obj.secure;
    if (!host || !user || !pass) {
        throw new Error("Compila host, user e password del servizio email.");
    }
    if (port !== undefined && (!Number.isFinite(port) || port <= 0)) {
        throw new Error("Porta non valida.");
    }
    return {
        host,
        user,
        pass,
        port: port !== undefined ? port : undefined,
        secure,
        from: from || undefined,
    };
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
    const normalizedTargetName = String(targetName || "")
        .trim()
        .toLowerCase();
    for (const admin of admins) {
        if (
            normalizedTargetName &&
            String(admin.name || "").trim().toLowerCase() !== normalizedTargetName
        ) {
            continue;
        }
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

function loadSharedSettingFromSqlite<T>(storeKey: string, fallback: T): T {
    const database = getSqliteDatabase();
    const rows = database.exec(
        `
        SELECT payload_json
        FROM ${SHARED_SETTINGS_TABLE}
        WHERE store_key = ?
    `,
        [storeKey],
    );
    return parseJson(rows?.[0]?.values?.[0]?.[0], fallback);
}

function saveSharedSettingToSqlite(storeKey: string, payload: unknown) {
    runSqliteTransaction((database) => {
        database.run(
            `
            INSERT INTO ${SHARED_SETTINGS_TABLE} (store_key, payload_json)
            VALUES (?, ?)
            ON CONFLICT(store_key) DO UPDATE SET payload_json = excluded.payload_json
        `,
            [storeKey, serializeJson(payload)],
        );
    });
}

function hasSharedSettingSqliteData(storeKey: string) {
    return (
        execScalarNumber(
            `SELECT COUNT(*) FROM ${SHARED_SETTINGS_TABLE} WHERE store_key = ?`,
            [storeKey],
        ) > 0
    );
}

function loadLegacyCalendarAccessConfig(): SharedAccessConfig {
    const candidates = [
        CALENDAR_ACCESS_CONFIG_PATH,
        LEGACY_CALENDAR_ACCESS_CONFIG_PATH,
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
            return normalizeAccessConfig(readJsonFile(candidate, null));
        } catch {
            // continue
        }
    }
    return normalizeAccessConfig(null);
}

function loadLegacyOtpMailConfig(): SharedOtpMailConfig | null {
    const candidates = [OTP_MAIL_PATH, ...LEGACY_OTP_MAIL_PATHS].filter(Boolean);
    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        try {
            return normalizeOtpMailConfig(readJsonFile(candidate, null));
        } catch {
            // continue
        }
    }
    return null;
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

export function loadCalendarAccessConfig(): SharedAccessConfig {
    ensureSharedSqliteSchema();
    if (!hasSharedSettingSqliteData(SHARED_SETTING_ACCESS_CONFIG)) {
        const legacy = loadLegacyCalendarAccessConfig();
        saveSharedSettingToSqlite(SHARED_SETTING_ACCESS_CONFIG, legacy);
        return legacy;
    }
    return normalizeAccessConfig(
        loadSharedSettingFromSqlite(
            SHARED_SETTING_ACCESS_CONFIG,
            DEFAULT_ACCESS_CONFIG,
        ),
    );
}

export async function saveCalendarAccessConfig(config: unknown) {
    ensureGeneralBackup();
    const normalized = normalizeAccessConfig(config);
    saveSharedSettingToSqlite(SHARED_SETTING_ACCESS_CONFIG, normalized);
    cleanupLegacySharedFiles();
    return normalized;
}

export function loadOtpMailConfig(): SharedOtpMailConfig | null {
    ensureSharedSqliteSchema();
    if (!hasSharedSettingSqliteData(SHARED_SETTING_OTP_MAIL)) {
        const legacy = loadLegacyOtpMailConfig();
        if (legacy) {
            saveSharedSettingToSqlite(SHARED_SETTING_OTP_MAIL, legacy);
            return legacy;
        }
        return null;
    }
    const payload = loadSharedSettingFromSqlite<SharedOtpMailConfig | null>(
        SHARED_SETTING_OTP_MAIL,
        null,
    );
    return payload ? normalizeOtpMailConfig(payload) : null;
}

export async function saveOtpMailConfig(config: unknown) {
    ensureGeneralBackup();
    const normalized = normalizeOtpMailConfig(config);
    saveSharedSettingToSqlite(SHARED_SETTING_OTP_MAIL, normalized);
    cleanupLegacySharedFiles();
    return normalized;
}

export function initializeSharedSqliteStore() {
    ensureSharedSqliteSchema();
    if (!hasSharedAdminsSqliteData()) {
        saveAdminCredentialsToSqlite(loadLegacyAdminCredentials());
    }
    if (!hasSharedAssigneesSqliteData()) {
        saveAssigneeOptionsToSqlite(loadLegacyAssigneeOptions());
    }
    if (!hasSharedSettingSqliteData(SHARED_SETTING_ACCESS_CONFIG)) {
        saveSharedSettingToSqlite(
            SHARED_SETTING_ACCESS_CONFIG,
            loadLegacyCalendarAccessConfig(),
        );
    }
    if (!hasSharedSettingSqliteData(SHARED_SETTING_OTP_MAIL)) {
        const otpMail = loadLegacyOtpMailConfig();
        if (otpMail) {
            saveSharedSettingToSqlite(SHARED_SETTING_OTP_MAIL, otpMail);
        }
    }
    cleanupLegacySharedFiles();
}
