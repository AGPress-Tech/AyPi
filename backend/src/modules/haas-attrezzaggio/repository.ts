import fs from "fs";
import path from "path";
import crypto from "crypto";
import { backendConfig } from "../../config";
import {
    readJsonFile,
} from "../../shared/storage/json-files";
import { ensureAgpressDailyBackup } from "../../shared/storage/agpress-backups";
import {
    getSqliteDatabase,
    runSqliteTransaction,
} from "../../shared/db/sqlite";

const HAAS_DIR = backendConfig.modules.haasAttrezzaggio.dir;
const HAAS_ATTACHMENTS_DIR = path.join(HAAS_DIR, "_attachments");
const HAAS_ITEMS_TABLE = "haas_items";

function ensureHaasBackup() {
    return ensureAgpressDailyBackup("auto", 30);
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

function ensureHaasSqliteSchema() {
    const database = getSqliteDatabase();
    database.exec(`
        CREATE TABLE IF NOT EXISTS ${HAAS_ITEMS_TABLE} (
            code TEXT PRIMARY KEY,
            codice_articolo TEXT,
            numero_programma TEXT,
            macchina TEXT,
            metodo TEXT,
            updated_at TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${HAAS_ITEMS_TABLE}_codice_articolo
            ON ${HAAS_ITEMS_TABLE}(codice_articolo);
        CREATE INDEX IF NOT EXISTS idx_${HAAS_ITEMS_TABLE}_updated_at
            ON ${HAAS_ITEMS_TABLE}(updated_at);
    `);
}

function sanitizeFileName(value: string) {
    return String(value || "")
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
}

function resolveHaasFilePath(code: string) {
    const safeName = sanitizeFileName(code);
    return path.join(HAAS_DIR, `${safeName}.json`);
}

function cleanupLegacyHaasJsonFiles() {
    if (!fs.existsSync(HAAS_DIR)) return;
    fs.readdirSync(HAAS_DIR)
        .filter((name) => name.toLowerCase().endsWith(".json"))
        .forEach((name) => {
            try {
                fs.unlinkSync(path.join(HAAS_DIR, name));
            } catch {
                // ignore cleanup failures
            }
        });
}

function normalizeAttachmentMeta(items: any[]) {
    return Array.isArray(items)
        ? items
              .map((item) => ({
                  id: String(item?.id || "").trim(),
                  originalName: String(item?.originalName || "").trim(),
                  storedName: String(item?.storedName || "").trim(),
                  mimeType: String(item?.mimeType || "").trim(),
                  size: Number(item?.size || 0) || 0,
                  createdAt: String(item?.createdAt || "").trim(),
              }))
              .filter((item) => item.id && item.storedName)
        : [];
}

function getAttachmentExtension(fileName: string, mimeType: string) {
    const ext = path.extname(String(fileName || "").trim()).toLowerCase();
    if (ext) return ext;
    if (mimeType === "image/jpeg") return ".jpg";
    if (mimeType === "image/webp") return ".webp";
    if (mimeType === "image/gif") return ".gif";
    return ".png";
}

function resolveAttachmentPath(storedName: string) {
    return path.join(HAAS_ATTACHMENTS_DIR, sanitizeFileName(storedName));
}

function saveNewAttachments(items: any[]) {
    if (!Array.isArray(items) || !items.length) return [];
    fs.mkdirSync(HAAS_ATTACHMENTS_DIR, { recursive: true });
    return items
        .map((item) => {
            const base64 = String(item?.dataBase64 || "").trim();
            if (!base64) return null;
            const id = crypto.randomUUID();
            const originalName =
                String(item?.fileName || "immagine").trim() || "immagine";
            const mimeType = String(item?.mimeType || "").trim() || "image/png";
            const extension = getAttachmentExtension(originalName, mimeType);
            const storedName = `${id}${extension}`;
            const filePath = resolveAttachmentPath(storedName);
            fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
            return {
                id,
                originalName,
                storedName,
                mimeType,
                size: Number(item?.size || 0) || 0,
                createdAt: new Date().toISOString(),
            };
        })
        .filter(Boolean);
}

function deleteAttachmentFiles(items: any[]) {
    normalizeAttachmentMeta(items).forEach((item) => {
        const filePath = resolveAttachmentPath(item.storedName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    });
}

function normalizeUtensiliRows(rows: any[]) {
    return Array.isArray(rows)
        ? rows.map((item) => ({
              t: String(item?.t || "").trim(),
              ciclo: String(item?.ciclo || "").trim(),
              mandrinoCodice: String(item?.mandrinoCodice || "").trim(),
              mandrinoRiduz: String(item?.mandrinoRiduz || "").trim(),
              mandrinoLunghezza: String(item?.mandrinoLunghezza || "").trim(),
              codiceUtensile: String(item?.codiceUtensile || "").trim(),
              locazione: String(item?.locazione || "").trim(),
              sporgenzaUtensile: String(item?.sporgenzaUtensile || "").trim(),
              diametroGambo: String(item?.diametroGambo || "").trim(),
          }))
        : [];
}

export function normalizeHaasItem(raw: any) {
    const item =
        raw?.item && typeof raw.item === "object"
            ? raw.item
            : raw?.data && typeof raw.data === "object"
              ? raw.data
              : raw && typeof raw === "object"
                ? raw
                : {};
    return {
        code: String(item.code || raw?.code || "").trim(),
        codiceArticolo: String(item.codiceArticolo || "").trim(),
        denominazioneArticolo: String(item.denominazioneArticolo || "").trim(),
        numeroProgramma: String(item.numeroProgramma || "").trim(),
        macchina: String(item.macchina || "").trim(),
        metodo: String(item.metodo || "").trim(),
        cicloLavoro: String(item.cicloLavoro || "").trim(),
        note: String(item.note || "").trim(),
        attachments: normalizeAttachmentMeta(item.attachments),
        newAttachments: Array.isArray(item.newAttachments) ? item.newAttachments : [],
        utensili: normalizeUtensiliRows(item.utensili),
        updatedAt: String(item.updatedAt || raw?.updatedAt || "").trim(),
        createdAt: String(item.createdAt || raw?.createdAt || "").trim(),
    };
}

function loadLegacyHaasItems() {
    if (!fs.existsSync(HAAS_DIR)) {
        fs.mkdirSync(HAAS_DIR, { recursive: true });
        return [];
    }
    return fs
        .readdirSync(HAAS_DIR)
        .filter((name) => name.toLowerCase().endsWith(".json"))
        .map((name) => {
            const filePath = path.join(HAAS_DIR, name);
            const stat = fs.statSync(filePath);
            const parsed = readJsonFile(filePath, {});
            const item = normalizeHaasItem(parsed);
            const code = item.code || path.basename(name, ".json");
            return {
                ...item,
                code,
                utensiliCount: Array.isArray(item.utensili) ? item.utensili.length : 0,
                attachmentsCount: Array.isArray(item.attachments)
                    ? item.attachments.length
                    : 0,
                updatedAt: item.updatedAt || stat.mtime.toISOString(),
            };
        })
        .sort((a, b) =>
            String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
        );
}

function loadLegacyHaasItem(code: string) {
    const filePath = resolveHaasFilePath(code);
    if (!fs.existsSync(filePath)) return null;
    return normalizeHaasItem(readJsonFile(filePath, {}));
}

function hasHaasSqliteData() {
    return execScalarNumber(`SELECT COUNT(*) FROM ${HAAS_ITEMS_TABLE}`) > 0;
}

function saveHaasItemsToSqlite(items: any[]) {
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${HAAS_ITEMS_TABLE}`);
        const statement = database.prepare(`
            INSERT INTO ${HAAS_ITEMS_TABLE} (
                code,
                codice_articolo,
                numero_programma,
                macchina,
                metodo,
                updated_at,
                payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        (Array.isArray(items) ? items : []).forEach((item) => {
            const normalized = normalizeHaasItem(item);
            if (!normalized.code) return;
            statement.run([
                normalized.code,
                normalized.codiceArticolo || null,
                normalized.numeroProgramma || null,
                normalized.macchina || null,
                normalized.metodo || null,
                normalized.updatedAt || null,
                serializeJson(normalized),
            ]);
        });
        statement.free();
    });
}

function loadHaasItemsFromSqlite() {
    const database = getSqliteDatabase();
    const rows = database.exec(`
        SELECT payload_json
        FROM ${HAAS_ITEMS_TABLE}
        ORDER BY COALESCE(updated_at, code) DESC, code ASC
    `);
    return (rows?.[0]?.values || []).map((row: unknown[]) => {
        const item = normalizeHaasItem(parseJson(row?.[0], {}));
        return {
            ...item,
            utensiliCount: Array.isArray(item.utensili) ? item.utensili.length : 0,
            attachmentsCount: Array.isArray(item.attachments)
                ? item.attachments.length
                : 0,
        };
    });
}

function loadHaasItemFromSqlite(code: string) {
    const database = getSqliteDatabase();
    const rows = database.exec(
        `SELECT payload_json FROM ${HAAS_ITEMS_TABLE} WHERE code = ?`,
        [String(code || "").trim()],
    );
    const raw = rows?.[0]?.values?.[0]?.[0];
    if (!raw) return null;
    return normalizeHaasItem(parseJson(raw, {}));
}

export function initializeHaasSqliteStore() {
    ensureHaasSqliteSchema();
    if (!hasHaasSqliteData()) {
        saveHaasItemsToSqlite(loadLegacyHaasItems());
    }
    cleanupLegacyHaasJsonFiles();
}

export function listHaasItems() {
    ensureHaasSqliteSchema();
    if (!hasHaasSqliteData()) {
        const legacy = loadLegacyHaasItems();
        saveHaasItemsToSqlite(legacy);
        cleanupLegacyHaasJsonFiles();
        return legacy;
    }
    return loadHaasItemsFromSqlite();
}

export function loadHaasItem(code: string) {
    ensureHaasSqliteSchema();
    if (!hasHaasSqliteData()) {
        const legacy = loadLegacyHaasItem(code);
        if (legacy) {
            saveHaasItemsToSqlite(loadLegacyHaasItems());
            cleanupLegacyHaasJsonFiles();
        }
        return legacy;
    }
    return loadHaasItemFromSqlite(code);
}

export function saveHaasItem(payload: any) {
    ensureHaasSqliteSchema();
    ensureHaasBackup();
    const normalized = normalizeHaasItem(payload);
    const previousCode = String(payload?.previousCode || "").trim();
    const current =
        (normalized.code ? loadHaasItem(normalized.code) : null) ||
        (previousCode && previousCode !== normalized.code
            ? loadHaasItem(previousCode)
            : null);
    const retainedAttachments = normalizeAttachmentMeta(normalized.attachments);
    const retainedIds = new Set(retainedAttachments.map((item) => item.id));
    const previousAttachments = normalizeAttachmentMeta(current?.attachments);
    const removedAttachments = previousAttachments.filter(
        (item) => !retainedIds.has(item.id),
    );
    const addedAttachments = saveNewAttachments(normalized.newAttachments);
    const now = new Date().toISOString();
    const next = {
        ...normalized,
        attachments: [...retainedAttachments, ...addedAttachments],
        newAttachments: [],
        createdAt: normalized.createdAt || current?.createdAt || now,
        updatedAt: now,
    };

    const items = hasHaasSqliteData()
        ? loadHaasItemsFromSqlite().map((item) => normalizeHaasItem(item))
        : loadLegacyHaasItems().map((item) => normalizeHaasItem(item));
    const filtered = items.filter(
        (item) => item.code !== next.code && (!previousCode || item.code !== previousCode),
    );
    filtered.push(next);
    saveHaasItemsToSqlite(filtered);
    cleanupLegacyHaasJsonFiles();
    return next;
}

export function deleteHaasItem(code: string) {
    ensureHaasSqliteSchema();
    const current = loadHaasItem(code);
    if (!current) return false;
    if (hasHaasSqliteData()) {
        const items = loadHaasItemsFromSqlite()
            .map((item) => normalizeHaasItem(item))
            .filter((item) => item.code !== code);
        saveHaasItemsToSqlite(items);
    }
    deleteAttachmentFiles(current?.attachments);
    cleanupLegacyHaasJsonFiles();
    return true;
}

export function resolveHaasAttachmentPath(storedName: string) {
    return resolveAttachmentPath(storedName);
}
