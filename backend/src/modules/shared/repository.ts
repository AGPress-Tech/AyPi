import fs from "fs";
import crypto from "crypto";
import path from "path";
import { argon2id, argon2Verify } from "hash-wasm";
import { backendConfig } from "../../config";
import { ensureFolderFor, readJsonFile, writeJsonFileAtomic } from "../../shared/storage/json-files";
import { ensureAgpressDailyBackup } from "../../shared/storage/agpress-backups";

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
function ensureGeneralBackup() {
    return ensureAgpressDailyBackup("auto", 30);
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

export function loadAdminCredentials(): SharedAdminEntry[] {
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
    const payload = {
        admins: admins.map((admin) => ({
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
        })),
    };
    const targets = [ADMINS_PATH];
    if (LEGACY_ADMINS_PATH && fs.existsSync(LEGACY_ADMINS_PATH)) {
        targets.push(LEGACY_ADMINS_PATH);
    }
    targets.forEach((targetPath) => {
        ensureFolderFor(targetPath);
        writeJsonFileAtomic(targetPath, payload);
    });
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

export function loadAssigneeOptions(): SharedAssigneesPayload {
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

export async function saveAssigneeOptions(payload: {
    groups?: Record<string, string[]>;
    emails?: Record<string, string>;
}) {
    ensureGeneralBackup();
    const normalized = {
        groups: payload?.groups && typeof payload.groups === "object" ? payload.groups : {},
        emails: payload?.emails && typeof payload.emails === "object" ? payload.emails : {},
    };
    const targets = [ASSIGNEES_PATH];
    if (LEGACY_ASSIGNEES_PATH && fs.existsSync(LEGACY_ASSIGNEES_PATH)) {
        targets.push(LEGACY_ASSIGNEES_PATH);
    }
    targets.forEach((targetPath) => {
        ensureFolderFor(targetPath);
        writeJsonFileAtomic(targetPath, normalized);
    });
}
