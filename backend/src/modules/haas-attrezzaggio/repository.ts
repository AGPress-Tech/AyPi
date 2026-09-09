import crypto from "crypto";
import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
import { logger } from "../../shared/logging/logger";
import { ensureAgpressDailyBackup } from "../../shared/storage/agpress-backups";
import { createAttachmentStore } from "../../shared/storage/attachment-store";
import {
    getSqliteDatabase,
    runSqliteTransaction,
} from "../../shared/db/sqlite";
import {
    parseJson,
    serializeJson,
} from "../../shared/storage/json-codec";

const HAAS_DIR = backendConfig.modules.haasAttrezzaggio.dir;
const HAAS_ATTACHMENTS_DIR = path.join(HAAS_DIR, "_attachments");
const HAAS_ITEMS_TABLE = "haas_items";
const attachments = createAttachmentStore(HAAS_ATTACHMENTS_DIR);
const normalizeAttachmentMeta = attachments.normalize;
const resolveAttachmentPath = attachments.resolvePath;
const saveNewAttachments = attachments.saveNew;
const deleteAttachmentFiles = attachments.remove;
let haasSchemaReady = false;

function ensureHaasBackup() {
    return ensureAgpressDailyBackup("auto", 30);
}

function ensureHaasSqliteSchema() {
    if (haasSchemaReady) return;
    const database = getSqliteDatabase();
    const tableExists = Boolean(database.exec(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        [HAAS_ITEMS_TABLE],
    )?.[0]?.values?.length);
    const columns = tableExists
        ? database.exec(`PRAGMA table_info(${HAAS_ITEMS_TABLE})`)?.[0]?.values || []
        : [];
    const recordIdColumn = columns.find((row: unknown[]) => row?.[1] === "record_id");
    const requiresMigration = tableExists && Number(recordIdColumn?.[5] || 0) === 0;
    let safetyCopy = "";

    if (requiresMigration && fs.existsSync(backendConfig.database.path)) {
        safetyCopy = `${backendConfig.database.path}.pre-haas-unique-record-id.bak`;
        if (!fs.existsSync(safetyCopy)) {
            fs.copyFileSync(backendConfig.database.path, safetyCopy, fs.constants.COPYFILE_EXCL);
        }
    }

    try {
        runSqliteTransaction((transaction) => {
            if (!tableExists) {
                transaction.exec(`
                    CREATE TABLE ${HAAS_ITEMS_TABLE} (
                        record_id TEXT PRIMARY KEY NOT NULL,
                        code TEXT NOT NULL,
                        codice_articolo TEXT,
                        numero_programma TEXT,
                        macchina TEXT,
                        metodo TEXT,
                        updated_at TEXT,
                        payload_json TEXT NOT NULL
                    )
                `);
            } else if (requiresMigration) {
                const recordIdSelect = recordIdColumn ? "record_id" : "NULL";
                const rows = transaction.exec(`
                    SELECT ${recordIdSelect}, code, codice_articolo, numero_programma,
                           macchina, metodo, updated_at, payload_json
                    FROM ${HAAS_ITEMS_TABLE}
                `)?.[0]?.values || [];
                transaction.exec(`DROP TABLE IF EXISTS haas_items_with_unique_ids`);
                transaction.exec(`
                    CREATE TABLE haas_items_with_unique_ids (
                        record_id TEXT PRIMARY KEY NOT NULL,
                        code TEXT NOT NULL,
                        codice_articolo TEXT,
                        numero_programma TEXT,
                        macchina TEXT,
                        metodo TEXT,
                        updated_at TEXT,
                        payload_json TEXT NOT NULL
                    )
                `);
                const insert = transaction.prepare(`
                    INSERT INTO haas_items_with_unique_ids (
                        record_id, code, codice_articolo, numero_programma,
                        macchina, metodo, updated_at, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);
                const usedIds = new Set<string>();
                rows.forEach((row: unknown[]) => {
                    let recordId = crypto.randomUUID();
                    while (usedIds.has(recordId)) recordId = crypto.randomUUID();
                    usedIds.add(recordId);
                    const payload: any = parseJson(row?.[7], {});
                    insert.run([
                        recordId,
                        String(row?.[1] || "").trim(),
                        row?.[2] || null,
                        row?.[3] || null,
                        row?.[4] || null,
                        row?.[5] || null,
                        row?.[6] || null,
                        serializeJson({ ...payload, recordId }),
                    ]);
                });
                insert.free();
                transaction.exec(`DROP TABLE ${HAAS_ITEMS_TABLE}`);
                transaction.exec(`ALTER TABLE haas_items_with_unique_ids RENAME TO ${HAAS_ITEMS_TABLE}`);
            }
            transaction.exec(`
                CREATE INDEX IF NOT EXISTS idx_${HAAS_ITEMS_TABLE}_codice_articolo
                    ON ${HAAS_ITEMS_TABLE}(codice_articolo);
                CREATE INDEX IF NOT EXISTS idx_${HAAS_ITEMS_TABLE}_updated_at
                    ON ${HAAS_ITEMS_TABLE}(updated_at);
            `);
        });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.error("Migrazione ID schede HAAS annullata", {
            event: "haas_record_ids_migration_failed",
            module: "attrezzaggio",
            category: "storage",
            safetyCopy,
            detail,
        });
        throw new Error(`Migrazione ID schede HAAS annullata. Copia di sicurezza: ${safetyCopy || "non necessaria"}. Dettaglio: ${detail}`);
    }
    haasSchemaReady = true;
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
        recordId: String(item.recordId || raw?.recordId || "").trim(),
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

function saveHaasItemsToSqlite(items: any[]) {
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${HAAS_ITEMS_TABLE}`);
        const statement = database.prepare(`
            INSERT INTO ${HAAS_ITEMS_TABLE} (
                record_id,
                code,
                codice_articolo,
                numero_programma,
                macchina,
                metodo,
                updated_at,
                payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        (Array.isArray(items) ? items : []).forEach((item) => {
            const normalized = normalizeHaasItem(item);
            if (!normalized.code) return;
            statement.run([
                normalized.recordId,
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
        SELECT record_id, payload_json
        FROM ${HAAS_ITEMS_TABLE}
        ORDER BY COALESCE(updated_at, code) DESC, code ASC
    `);
    return (rows?.[0]?.values || []).map((row: unknown[]) => {
        const item = normalizeHaasItem({ ...parseJson(row?.[1], {}), recordId: row?.[0] });
        return {
            ...item,
            utensiliCount: Array.isArray(item.utensili) ? item.utensili.length : 0,
            attachmentsCount: Array.isArray(item.attachments)
                ? item.attachments.length
                : 0,
        };
    });
}

function loadHaasItemFromSqlite(identifier: string) {
    const database = getSqliteDatabase();
    const rows = database.exec(
        `SELECT record_id, payload_json FROM ${HAAS_ITEMS_TABLE}
         WHERE record_id = ? OR code = ?
         ORDER BY CASE WHEN record_id = ? THEN 0 ELSE 1 END
         LIMIT 1`,
        Array(3).fill(String(identifier || "").trim()),
    );
    const row = rows?.[0]?.values?.[0];
    const raw = row?.[1];
    if (!raw) return null;
    return normalizeHaasItem({ ...parseJson(raw, {}), recordId: row?.[0] });
}

export function initializeHaasSqliteStore() {
    ensureHaasSqliteSchema();
}

export function listHaasItems() {
    ensureHaasSqliteSchema();
    return loadHaasItemsFromSqlite();
}

export function loadHaasItem(code: string) {
    ensureHaasSqliteSchema();
    return loadHaasItemFromSqlite(code);
}

export function saveHaasItem(payload: any) {
    ensureHaasSqliteSchema();
    ensureHaasBackup();
    const normalized = normalizeHaasItem(payload);
    const previousCode = String(payload?.previousCode || "").trim();
    const current = previousCode
        ? normalized.recordId
            ? loadHaasItem(normalized.recordId)
            : loadHaasItem(previousCode)
        : null;
    const retainedAttachments = normalizeAttachmentMeta(normalized.attachments);
    const retainedIds = new Set(retainedAttachments.map((item) => item.id));
    const previousAttachments = normalizeAttachmentMeta(current?.attachments);
    const removedAttachments = previousAttachments.filter(
        (item) => !retainedIds.has(item.id),
    );
    const addedAttachments = saveNewAttachments(normalized.newAttachments);
    const now = new Date().toISOString();
    let recordId = current?.recordId || normalized.recordId || crypto.randomUUID();
    while (!current && loadHaasItem(recordId)) recordId = crypto.randomUUID();
    const next = {
        ...normalized,
        recordId,
        attachments: [...retainedAttachments, ...addedAttachments],
        newAttachments: [],
        createdAt: normalized.createdAt || current?.createdAt || now,
        updatedAt: now,
    };

    const items = loadHaasItemsFromSqlite().map((item) => normalizeHaasItem(item));
    const filtered = items.filter((item) => item.recordId !== next.recordId);
    filtered.push(next);
    saveHaasItemsToSqlite(filtered);
    return next;
}

export function deleteHaasItem(code: string) {
    ensureHaasSqliteSchema();
    const current = loadHaasItem(code);
    if (!current) return false;
    const items = loadHaasItemsFromSqlite()
        .map((item) => normalizeHaasItem(item))
        .filter((item) => item.recordId !== current.recordId);
    saveHaasItemsToSqlite(items);
    deleteAttachmentFiles(current?.attachments);
    return true;
}

export function resolveHaasAttachmentPath(storedName: string) {
    return resolveAttachmentPath(storedName);
}
