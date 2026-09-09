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

const TRANSFER_DIR = backendConfig.modules.transferAttrezzaggio.dir;
const TRANSFER_ATTACHMENTS_DIR = path.join(TRANSFER_DIR, "_attachments");
const TRANSFER_ITEMS_TABLE = "transfer_items";
const attachments = createAttachmentStore(TRANSFER_ATTACHMENTS_DIR);
const copyAttachments = attachments.copy;
const normalizeAttachmentMeta = attachments.normalize;
const resolveAttachmentPath = attachments.resolvePath;
const saveNewAttachments = attachments.saveNew;
const deleteAttachmentFiles = attachments.remove;
let transferSchemaReady = false;

function ensureTransferBackup() {
    return ensureAgpressDailyBackup("auto", 30);
}

function ensureTransferSqliteSchema() {
    if (transferSchemaReady) return;
    const database = getSqliteDatabase();
    const tableExists = Boolean(database.exec(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        [TRANSFER_ITEMS_TABLE],
    )?.[0]?.values?.length);
    const existingColumns = tableExists
        ? database.exec(`PRAGMA table_info(${TRANSFER_ITEMS_TABLE})`)?.[0]?.values || []
        : [];
    const recordIdColumn = existingColumns.find((row: unknown[]) => row?.[1] === "record_id");
    const recordIdIsPrimaryKey = Number(recordIdColumn?.[5] || 0) > 0;
    const requiresIdentityMigration = tableExists && !recordIdIsPrimaryKey;
    let safetyCopy = "";

    if (requiresIdentityMigration && fs.existsSync(backendConfig.database.path)) {
        safetyCopy = `${backendConfig.database.path}.pre-transfer-unique-record-id.bak`;
        if (!fs.existsSync(safetyCopy)) {
            fs.copyFileSync(backendConfig.database.path, safetyCopy, fs.constants.COPYFILE_EXCL);
        }
    }

    try {
        runSqliteTransaction((transaction) => {
            if (!tableExists) {
                transaction.exec(`
                CREATE TABLE ${TRANSFER_ITEMS_TABLE} (
                    record_id TEXT PRIMARY KEY NOT NULL,
                    code TEXT NOT NULL,
                    codice_articolo TEXT,
                    fase TEXT,
                    codice_macchina TEXT,
                    metodo_variante TEXT,
                    updated_at TEXT,
                    payload_json TEXT NOT NULL
                )`);
            } else if (requiresIdentityMigration) {
                const recordIdSelect = recordIdColumn ? "record_id" : "NULL";
                const rows = transaction.exec(`
                    SELECT code, ${recordIdSelect}, codice_articolo, fase,
                           codice_macchina, metodo_variante, updated_at, payload_json
                    FROM ${TRANSFER_ITEMS_TABLE}
                `)?.[0]?.values || [];
                const aliasTableExists = Boolean(transaction.exec(
                    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'transfer_item_aliases'`,
                )?.[0]?.values?.length);
                const legacyAliases = aliasTableExists
                    ? transaction.exec(
                          `SELECT alias_code, record_id FROM transfer_item_aliases`,
                      )?.[0]?.values || []
                    : [];

                transaction.exec(`DROP TABLE IF EXISTS transfer_items_with_unique_ids`);
                transaction.exec(`
                    CREATE TABLE transfer_items_with_unique_ids (
                        record_id TEXT PRIMARY KEY NOT NULL,
                        code TEXT NOT NULL,
                        codice_articolo TEXT,
                        fase TEXT,
                        codice_macchina TEXT,
                        metodo_variante TEXT,
                        updated_at TEXT,
                        payload_json TEXT NOT NULL
                    )
                `);
                const insert = transaction.prepare(`
                    INSERT INTO transfer_items_with_unique_ids (
                        record_id, code, codice_articolo, fase, codice_macchina,
                        metodo_variante, updated_at, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);
                const migratedAliases: Array<[string, string]> = [];
                const migratedRecordIds = new Set<string>();
                const migratedRecordIdByOldId = new Map<string, string>();
                rows.forEach((row: unknown[]) => {
                    let newRecordId = crypto.randomUUID();
                    while (migratedRecordIds.has(newRecordId)) {
                        newRecordId = crypto.randomUUID();
                    }
                    migratedRecordIds.add(newRecordId);
                    const oldRecordId = String(row?.[1] || "").trim();
                    const payload: any = parseJson(row?.[7], {});
                    insert.run([
                        newRecordId,
                        String(row?.[0] || "").trim(),
                        row?.[2] || null,
                        row?.[3] || null,
                        row?.[4] || null,
                        row?.[5] || null,
                        row?.[6] || null,
                        serializeJson({ ...payload, recordId: newRecordId }),
                    ]);
                    if (oldRecordId) {
                        migratedAliases.push([oldRecordId, newRecordId]);
                        migratedRecordIdByOldId.set(oldRecordId, newRecordId);
                    }
                });
                insert.free();
                transaction.exec(`DROP TABLE ${TRANSFER_ITEMS_TABLE}`);
                transaction.exec(`ALTER TABLE transfer_items_with_unique_ids RENAME TO ${TRANSFER_ITEMS_TABLE}`);
                transaction.exec(`
                    CREATE TABLE IF NOT EXISTS transfer_item_aliases (
                        alias_code TEXT PRIMARY KEY,
                        record_id TEXT NOT NULL
                    )
                `);
                transaction.run(`DELETE FROM transfer_item_aliases`);
                const aliasInsert = transaction.prepare(`
                    INSERT OR REPLACE INTO transfer_item_aliases (alias_code, record_id)
                    VALUES (?, ?)
                `);
                migratedAliases.forEach(([alias, recordId]) => aliasInsert.run([alias, recordId]));
                legacyAliases.forEach((row: unknown[]) => {
                    const alias = String(row?.[0] || "").trim();
                    const newRecordId = migratedRecordIdByOldId.get(String(row?.[1] || "").trim());
                    if (alias && newRecordId) aliasInsert.run([alias, newRecordId]);
                });
                aliasInsert.free();
            }
            transaction.exec(`
                CREATE TABLE IF NOT EXISTS transfer_item_aliases (
                    alias_code TEXT PRIMARY KEY,
                    record_id TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_transfer_item_aliases_record_id
                    ON transfer_item_aliases(record_id);
                CREATE INDEX IF NOT EXISTS idx_${TRANSFER_ITEMS_TABLE}_codice_articolo
                    ON ${TRANSFER_ITEMS_TABLE}(codice_articolo);
                CREATE INDEX IF NOT EXISTS idx_${TRANSFER_ITEMS_TABLE}_updated_at
                    ON ${TRANSFER_ITEMS_TABLE}(updated_at);
            `);
        });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        logger.error("Migrazione ID schede Transfer annullata: database ripristinato", {
            event: "transfer_record_ids_migration_failed",
            category: "storage",
            module: "transfer",
            outcome: "error",
            safetyCopy,
            detail,
        });
        throw new Error(
            `Migrazione ID schede Transfer annullata. Il backend non è stato avviato. ` +
            `Copia di sicurezza: ${safetyCopy || "non necessaria per un database nuovo"}. Dettaglio: ${detail}`,
        );
    }
    if (requiresIdentityMigration) {
        logger.info("Migrazione ID schede Transfer completata correttamente", {
            event: "transfer_record_ids_initialized",
            category: "storage",
            module: "transfer",
            safetyCopy,
        });
    }
    transferSchemaReady = true;
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
        recordId: String(item.recordId || raw?.recordId || "").trim(),
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

function saveTransferItemsToSqlite(
    items: any[],
    options?: { aliasCode?: string; recordId?: string; deletedRecordId?: string },
) {
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${TRANSFER_ITEMS_TABLE}`);
        const statement = database.prepare(`
            INSERT INTO ${TRANSFER_ITEMS_TABLE} (
                code,
                record_id,
                codice_articolo,
                fase,
                codice_macchina,
                metodo_variante,
                updated_at,
                payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        (Array.isArray(items) ? items : []).forEach((item) => {
            const normalized = normalizeTransferItem(item);
            if (!normalized.code) return;
            statement.run([
                normalized.code,
                normalized.recordId || null,
                normalized.codiceArticolo || null,
                normalized.fase || null,
                normalized.codiceMacchina || null,
                normalized.metodoVariante || null,
                normalized.updatedAt || null,
                serializeJson(normalized),
            ]);
        });
        statement.free();
        if (options?.deletedRecordId) {
            database.run(`DELETE FROM transfer_item_aliases WHERE record_id = ?`, [options.deletedRecordId]);
        }
        if (options?.recordId) {
            const currentCode = items.find((item) => item.recordId === options.recordId)?.code;
            if (currentCode) {
                database.run(`DELETE FROM transfer_item_aliases WHERE alias_code = ?`, [currentCode]);
            }
            if (options.aliasCode && options.aliasCode !== currentCode) {
                database.run(
                    `INSERT OR REPLACE INTO transfer_item_aliases (alias_code, record_id) VALUES (?, ?)`,
                    [options.aliasCode, options.recordId],
                );
            }
        }
    });
}

function loadTransferItemsFromSqlite() {
    const database = getSqliteDatabase();
    const rows = database.exec(`
        SELECT record_id, payload_json
        FROM ${TRANSFER_ITEMS_TABLE}
        ORDER BY COALESCE(updated_at, code) DESC, code ASC
    `);
    return (rows?.[0]?.values || []).map((row: unknown[]) => {
        const item = normalizeTransferItem({
            ...parseJson(row?.[1], {}),
            recordId: row?.[0],
        });
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

function loadTransferItemFromSqlite(identifier: string) {
    const database = getSqliteDatabase();
    const rows = database.exec(
        `SELECT item.record_id, item.payload_json
         FROM ${TRANSFER_ITEMS_TABLE} item
         LEFT JOIN transfer_item_aliases alias ON alias.record_id = item.record_id
         WHERE item.record_id = ? OR item.code = ? OR alias.alias_code = ?
         ORDER BY CASE
             WHEN item.record_id = ? THEN 0
             WHEN item.code = ? THEN 1
             ELSE 2
         END
         LIMIT 1`,
        Array(5).fill(String(identifier || "").trim()),
    );
    const row = rows?.[0]?.values?.[0];
    const raw = row?.[1];
    if (!raw) return null;
    return normalizeTransferItem({ ...parseJson(raw, {}), recordId: row?.[0] });
}

export function initializeTransferSqliteStore() {
    ensureTransferSqliteSchema();
}

export function listTransferItems() {
    ensureTransferSqliteSchema();
    return loadTransferItemsFromSqlite();
}

export function loadTransferItem(identifier: string) {
    ensureTransferSqliteSchema();
    return loadTransferItemFromSqlite(identifier);
}

export function saveTransferItem(payload: any) {
    ensureTransferSqliteSchema();
    ensureTransferBackup();
    const normalized = normalizeTransferItem(payload);
    const previousCode = String(payload?.previousCode || "").trim();
    const current = previousCode
        ? normalized.recordId
            ? loadTransferItem(normalized.recordId)
            : loadTransferItem(previousCode)
        : null;
    const retainedAttachments =
        !current && !previousCode
            ? copyAttachments(normalized.attachments)
            : normalizeAttachmentMeta(normalized.attachments);
    const retainedIds = new Set(retainedAttachments.map((item) => item.id));
    const previousAttachments = normalizeAttachmentMeta(current?.attachments);
    const removedAttachments = previousAttachments.filter(
        (item) => !retainedIds.has(item.id),
    );
    const addedAttachments = saveNewAttachments(normalized.newAttachments);
    const now = new Date().toISOString();
    let recordId = current?.recordId || normalized.recordId || crypto.randomUUID();
    while (!current && loadTransferItem(recordId)) {
        recordId = crypto.randomUUID();
    }
    const next = {
        ...normalized,
        recordId,
        attachments: [...retainedAttachments, ...addedAttachments],
        newAttachments: [],
        createdAt: normalized.createdAt || current?.createdAt || now,
        updatedAt: now,
    };

    const items = loadTransferItemsFromSqlite().map((item) =>
        normalizeTransferItem(item),
    );
    const filtered = items.filter((item) => item.recordId !== next.recordId);
    filtered.push(next);
    saveTransferItemsToSqlite(filtered, {
        aliasCode: previousCode,
        recordId: next.recordId,
    });
    return next;
}

export function deleteTransferItem(identifier: string) {
    ensureTransferSqliteSchema();
    const current = loadTransferItem(identifier);
    if (!current) return false;
    const items = loadTransferItemsFromSqlite()
        .map((item) => normalizeTransferItem(item))
        .filter((item) => item.recordId !== current.recordId);
    saveTransferItemsToSqlite(items, { deletedRecordId: current.recordId });
    deleteAttachmentFiles(current?.attachments);
    return true;
}

export function resolveTransferAttachmentPath(storedName: string) {
    return resolveAttachmentPath(storedName);
}
