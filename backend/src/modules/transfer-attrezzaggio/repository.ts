import fs from "fs";
import path from "path";
import crypto from "crypto";
import { backendConfig } from "../../config";
import { ensureAgpressDailyBackup } from "../../shared/storage/agpress-backups";
import {
    getSqliteDatabase,
    runSqliteTransaction,
} from "../../shared/db/sqlite";

const TRANSFER_DIR = backendConfig.modules.transferAttrezzaggio.dir;
const TRANSFER_ATTACHMENTS_DIR = path.join(TRANSFER_DIR, "_attachments");
const TRANSFER_ITEMS_TABLE = "transfer_items";

function ensureTransferBackup() {
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

function ensureTransferSqliteSchema() {
    const database = getSqliteDatabase();
    database.exec(`
        CREATE TABLE IF NOT EXISTS ${TRANSFER_ITEMS_TABLE} (
            code TEXT PRIMARY KEY,
            codice_articolo TEXT,
            fase TEXT,
            codice_macchina TEXT,
            metodo_variante TEXT,
            updated_at TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${TRANSFER_ITEMS_TABLE}_codice_articolo
            ON ${TRANSFER_ITEMS_TABLE}(codice_articolo);
        CREATE INDEX IF NOT EXISTS idx_${TRANSFER_ITEMS_TABLE}_updated_at
            ON ${TRANSFER_ITEMS_TABLE}(updated_at);
    `);
}

function sanitizeFileName(value: string) {
    return String(value || "")
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
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
    return path.join(TRANSFER_ATTACHMENTS_DIR, sanitizeFileName(storedName));
}

function saveNewAttachments(items: any[]) {
    if (!Array.isArray(items) || !items.length) return [];
    fs.mkdirSync(TRANSFER_ATTACHMENTS_DIR, { recursive: true });
    return items
        .map((item) => {
            const base64 = String(item?.dataBase64 || "").trim();
            if (!base64) return null;
            const id = crypto.randomUUID();
            const originalName = String(item?.fileName || "immagine").trim() || "immagine";
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

function parseCode(code: string) {
    const normalized = String(code || "").trim();
    if (!normalized) {
        return {
            codiceArticolo: "",
            fase: "",
            codiceMacchina: "",
            metodo: "",
        };
    }
    const parts = normalized.includes(" - ")
        ? normalized.split(/\s*-\s*/)
        : normalized.split("/");
    if (normalized.includes(" - ")) {
        return {
            codiceArticolo: parts[0] || "",
            fase: (parts[1] || "").replace(/^Fase:\s*/i, "").trim(),
            codiceMacchina: parts[2] || "",
            metodo: parts[3] || "",
        };
    }
    return {
        codiceArticolo: parts[0] || "",
        fase: parts[1] || "",
        codiceMacchina: parts[2] || "",
        metodo: parts[3] || "",
    };
}

function normalizeUtensiliRows(rows: any[]) {
    return Array.isArray(rows)
        ? rows.map((item) => ({
              nrUnita: String(item?.nrUnita || "").trim(),
              iso: String(item?.iso || "").trim(),
              descrizione: String(item?.descrizione || "").trim(),
              col1: String(item?.col1 || "").trim(),
              col2: String(item?.col2 || "").trim(),
              col3: String(item?.col3 || "").trim(),
              col4: String(item?.col4 || "").trim(),
              col5: String(item?.col5 || "").trim(),
              col6: String(item?.col6 || "").trim(),
              col7: String(item?.col7 || "").trim(),
              col8: String(item?.col8 || "").trim(),
              col10: String(item?.col10 || "").trim(),
              col12: String(item?.col12 || "").trim(),
              col13: String(item?.col13 || "").trim(),
              col14: String(item?.col14 || "").trim(),
          }))
        : [];
}

export function normalizeTransferItem(raw: any) {
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
        fase: String(item.fase || "").trim(),
        codiceMacchina: String(item.codiceMacchina || "").trim(),
        metodoVariante: String(item.metodoVariante || item.metodo || "").trim(),
        lavorazione: String(item.lavorazione || "").trim(),
        cicloLavorazione: String(item.cicloLavorazione || "").trim(),
        spessori: String(item.spessori || "").trim(),
        vitiRondelle: String(item.vitiRondelle || "").trim(),
        spine: String(item.spine || "").trim(),
        programmaRobot: String(item.programmaRobot || "").trim(),
        mani: String(item.mani || "").trim(),
        morsetti: String(item.morsetti || "").trim(),
        note: String(item.note || "").trim(),
        attachments: normalizeAttachmentMeta(item.attachments),
        newAttachments: Array.isArray(item.newAttachments) ? item.newAttachments : [],
        utensili: normalizeUtensiliRows(item.utensili),
        updatedAt: String(item.updatedAt || raw?.updatedAt || "").trim(),
        createdAt: String(item.createdAt || raw?.createdAt || "").trim(),
    };
}

function saveTransferItemsToSqlite(items: any[]) {
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${TRANSFER_ITEMS_TABLE}`);
        const statement = database.prepare(`
            INSERT INTO ${TRANSFER_ITEMS_TABLE} (
                code,
                codice_articolo,
                fase,
                codice_macchina,
                metodo_variante,
                updated_at,
                payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        (Array.isArray(items) ? items : []).forEach((item) => {
            const normalized = normalizeTransferItem(item);
            if (!normalized.code) return;
            statement.run([
                normalized.code,
                normalized.codiceArticolo || null,
                normalized.fase || null,
                normalized.codiceMacchina || null,
                normalized.metodoVariante || null,
                normalized.updatedAt || null,
                serializeJson(normalized),
            ]);
        });
        statement.free();
    });
}

function loadTransferItemsFromSqlite() {
    const database = getSqliteDatabase();
    const rows = database.exec(`
        SELECT payload_json
        FROM ${TRANSFER_ITEMS_TABLE}
        ORDER BY COALESCE(updated_at, code) DESC, code ASC
    `);
    return (rows?.[0]?.values || []).map((row: unknown[]) => {
        const item = normalizeTransferItem(parseJson(row?.[0], {}));
        const parts = parseCode(item.code);
        return {
            ...item,
            codiceArticolo: item.codiceArticolo || parts.codiceArticolo,
            fase: item.fase || parts.fase,
            codiceMacchina: item.codiceMacchina || parts.codiceMacchina,
            metodo: item.metodoVariante || parts.metodo,
            utensiliCount: Array.isArray(item.utensili) ? item.utensili.length : 0,
            attachmentsCount: Array.isArray(item.attachments) ? item.attachments.length : 0,
            utensiliDescrizioni: Array.isArray(item.utensili)
                ? item.utensili
                      .map((row: any) => String(row.descrizione || "").trim())
                      .filter(Boolean)
                : [],
            utensiliCol1: Array.isArray(item.utensili)
                ? item.utensili
                      .map((row: any) => String(row.col1 || "").trim())
                      .filter(Boolean)
                : [],
        };
    });
}

function loadTransferItemFromSqlite(code: string) {
    const database = getSqliteDatabase();
    const rows = database.exec(
        `SELECT payload_json FROM ${TRANSFER_ITEMS_TABLE} WHERE code = ?`,
        [String(code || "").trim()],
    );
    const raw = rows?.[0]?.values?.[0]?.[0];
    if (!raw) return null;
    return normalizeTransferItem(parseJson(raw, {}));
}

export function initializeTransferSqliteStore() {
    ensureTransferSqliteSchema();
}

export function listTransferItems() {
    ensureTransferSqliteSchema();
    return loadTransferItemsFromSqlite();
}

export function loadTransferItem(code: string) {
    ensureTransferSqliteSchema();
    return loadTransferItemFromSqlite(code);
}

export function saveTransferItem(payload: any) {
    ensureTransferSqliteSchema();
    ensureTransferBackup();
    const normalized = normalizeTransferItem(payload);
    const previousCode = String(payload?.previousCode || "").trim();
    const current = normalized.code ? loadTransferItem(normalized.code) : null;
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

    const items = loadTransferItemsFromSqlite().map((item) =>
        normalizeTransferItem(item),
    );
    const filtered = items.filter(
        (item) => item.code !== next.code && (!previousCode || item.code !== previousCode),
    );
    filtered.push(next);
    saveTransferItemsToSqlite(filtered);
    return next;
}

export function deleteTransferItem(code: string) {
    ensureTransferSqliteSchema();
    const current = loadTransferItem(code);
    if (!current) return false;
    const items = loadTransferItemsFromSqlite()
        .map((item) => normalizeTransferItem(item))
        .filter((item) => item.code !== code);
    saveTransferItemsToSqlite(items);
    deleteAttachmentFiles(current?.attachments);
    return true;
}

export function resolveTransferAttachmentPath(storedName: string) {
    return resolveAttachmentPath(storedName);
}
