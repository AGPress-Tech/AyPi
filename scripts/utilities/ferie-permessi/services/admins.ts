require("../../../shared/dev-guards");
import fs from "fs";

import { ADMINS_PATH, LEGACY_ADMINS_PATH } from "../config/paths";
import { APPROVAL_PASSWORD } from "../config/constants";
import {
    hashPassword,
    verifyPasswordHash,
    isHashingAvailable,
} from "../config/security";
import { showDialog } from "./dialogs";
import { ensureFolderFor } from "./storage";

type AdminEntry = {
    name: string;
    password?: string;
    passwordHash?: string;
    email?: string;
    phone?: string;
};

type VerifyResult = { admin: AdminEntry; admins: AdminEntry[] };

function loadAdminCredentials(): AdminEntry[] {
    const parseAdminsFromPath = (targetPath: string) => {
        const raw = fs.readFileSync(targetPath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed
                .filter(
                    (item) =>
                        item &&
                        item.name &&
                        (item.password || item.passwordHash),
                )
                .map((item): AdminEntry => ({
                    name: String(item.name),
                    password: item.password ? String(item.password) : undefined,
                    passwordHash: item.passwordHash
                        ? String(item.passwordHash)
                        : undefined,
                    email: item.email ? String(item.email) : "",
                    phone: item.phone ? String(item.phone) : "",
                }));
        }
        if (parsed && Array.isArray(parsed.admins)) {
            return parsed.admins
                .filter(
                    (item) =>
                        item &&
                        item.name &&
                        (item.password || item.passwordHash),
                )
                .map((item): AdminEntry => ({
                    name: String(item.name),
                    password: item.password ? String(item.password) : undefined,
                    passwordHash: item.passwordHash
                        ? String(item.passwordHash)
                        : undefined,
                    email: item.email ? String(item.email) : "",
                    phone: item.phone ? String(item.phone) : "",
                }));
        }
        if (parsed && typeof parsed === "object") {
            return Object.entries(parsed)
                .filter(([name, password]) => name && password)
                .map(([name, password]) => {
                    const value = String(password);
                    return value.startsWith("$argon2")
                        ? ({
                              name: String(name),
                              passwordHash: value,
                              email: "",
                              phone: "",
                          } as AdminEntry)
                        : ({
                              name: String(name),
                              password: value,
                              email: "",
                              phone: "",
                          } as AdminEntry);
                });
        }
        return [];
    };

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
        return [{ name: "Admin", password: APPROVAL_PASSWORD }];
    } catch (err) {
        console.error("Errore caricamento admins:", err);
        return [{ name: "Admin", password: APPROVAL_PASSWORD }];
    }
}

function saveAdminCredentials(admins: AdminEntry[]) {
    try {
        const payload = admins.map((admin) => ({
            name: admin.name,
            passwordHash: admin.passwordHash,
            password: admin.passwordHash ? undefined : admin.password,
            email: admin.email || "",
            phone: admin.phone || "",
        }));
        const targets = [ADMINS_PATH];
        if (LEGACY_ADMINS_PATH && fs.existsSync(LEGACY_ADMINS_PATH)) {
            targets.push(LEGACY_ADMINS_PATH);
        }
        targets.forEach((targetPath) => {
            ensureFolderFor(targetPath);
            fs.writeFileSync(
                targetPath,
                JSON.stringify({ admins: payload }, null, 2),
                "utf8",
            );
        });
    } catch (err) {
        console.error("Errore salvataggio admins:", err);
        const { UI_TEXTS } = require("../utils/ui-texts");
        showDialog(
            "warning",
            UI_TEXTS.adminsSaveFailure,
            err instanceof Error ? err.message : String(err),
        );
    }
}

async function verifyAdminPassword(password: string, targetName?: string | null): Promise<VerifyResult | null> {
    if (!password) return null;
    const admins = loadAdminCredentials();
    for (const admin of admins) {
        if (targetName && admin.name !== targetName) continue;
        if (admin.passwordHash) {
            try {
                const ok = await verifyPasswordHash(
                    admin.passwordHash,
                    password,
                );
                if (ok) {
                    try {
                        const nextHash = await hashPassword(password);
                        if (nextHash && nextHash !== admin.passwordHash) {
                            admin.passwordHash = nextHash;
                            saveAdminCredentials(admins);
                        }
                    } catch (rehashErr) {
                        console.error("Errore rehash password:", rehashErr);
                    }
                    return { admin, admins };
                }
            } catch (err) {
                console.error("Errore verifica argon2:", err);
            }
        } else if (admin.password && admin.password === password) {
            if (isHashingAvailable()) {
                try {
                    const hash = await hashPassword(password);
                    admin.passwordHash = hash;
                    delete admin.password;
                    saveAdminCredentials(admins);
                } catch (err) {
                    console.error("Errore hashing argon2:", err);
                }
            }
            return { admin, admins };
        }
    }
    return null;
}

function findAdminByName(name: string, adminCache?: AdminEntry[] | null) {
    if (!name) return null;
    const lower = name.trim().toLowerCase();
    const admins =
        Array.isArray(adminCache) && adminCache.length
            ? adminCache
            : loadAdminCredentials();
    return (
        admins.find((admin) => admin.name.trim().toLowerCase() === lower) ||
        null
    );
}

function isValidEmail(value: string) {
    if (!value) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value: string) {
    if (!value) return false;
    const trimmed = value.trim();
    if (!trimmed.startsWith("+39")) return false;
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 11 && digits.length <= 13;
}

export {
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword,
    findAdminByName,
    isValidEmail,
    isValidPhone,
};

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
        loadAdminCredentials,
        saveAdminCredentials,
        verifyAdminPassword,
        findAdminByName,
        isValidEmail,
        isValidPhone,
    };
}


