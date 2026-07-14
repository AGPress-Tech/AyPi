import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
import {
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

type TicketHistoryEntry = {
    at: string;
    event: string;
    actor: string;
    fromStatus: string;
    toStatus: string;
    note: string;
};

type Ticket = {
    id: string;
    requester: {
        name: string;
        surname: string;
        email: string;
        department: string;
    };
    issueType: string;
    area: string;
    priority: string;
    description: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    resolvedAt: string;
    closedAt: string;
    lastStatusChangeAt: string;
    createdByKey: string;
    history: TicketHistoryEntry[];
};

export type TicketStore = {
    version: number;
    tickets: Ticket[];
};

type TicketCategories = {
    version: number;
    issueTypes: string[];
    areas: string[];
};

const TS_TICKETS_TABLE = "ts_tickets";
const TS_CATEGORIES_TABLE = "ts_categories";
const DB_RELATIVE_PATH = path.join("General", "data", "aypi.db");
function ensureTicketBackup(prefix = "auto", limit = 30) {
    return prefix === "auto"
        ? ensureAgpressDailyBackup(prefix, limit)
        : createAgpressBackup(prefix, limit);
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

function ensureTicketSupportSqliteSchema() {
    const database = getSqliteDatabase();
    database.exec(`
        CREATE TABLE IF NOT EXISTS ${TS_TICKETS_TABLE} (
            id TEXT PRIMARY KEY,
            year_key TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${TS_TICKETS_TABLE}_year
            ON ${TS_TICKETS_TABLE}(year_key);

        CREATE TABLE IF NOT EXISTS ${TS_CATEGORIES_TABLE} (
            store_key TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL
        );
    `);
    database.run(
        `INSERT OR IGNORE INTO ${TS_CATEGORIES_TABLE} (store_key, payload_json)
         VALUES (?, ?)`,
        [
            "categories",
            serializeJson({
                version: 1,
                issueTypes: ["Software", "Hardware", "Accessi", "Altro"],
                areas: ["Produzione", "Uffici", "Magazzino", "IT"],
            }),
        ],
    );
}

function getYearFromTicket(ticket: Partial<Ticket>) {
    const createdAt = String(ticket?.createdAt || "").trim();
    const parsed = createdAt ? new Date(createdAt) : null;
    if (parsed && Number.isFinite(parsed.getTime())) {
        return String(parsed.getFullYear());
    }
    return String(new Date().getFullYear());
}

function normalizeTicket(input: any): Ticket {
    const ticket = input && typeof input === "object" ? input : {};
    const history = Array.isArray(ticket.history) ? ticket.history : [];
    return {
        id: String(ticket.id || "").trim(),
        requester: {
            name: String(ticket.requester?.name || "").trim(),
            surname: String(ticket.requester?.surname || "").trim(),
            email: String(ticket.requester?.email || "").trim(),
            department: String(ticket.requester?.department || "").trim(),
        },
        issueType: String(ticket.issueType || "").trim(),
        area: String(ticket.area || "").trim(),
        priority: String(ticket.priority || "Media").trim(),
        description: String(ticket.description || "").trim(),
        status: String(ticket.status || "Da prendere in carico").trim(),
        createdAt: String(ticket.createdAt || "").trim(),
        updatedAt: String(ticket.updatedAt || "").trim(),
        resolvedAt: ticket.resolvedAt ? String(ticket.resolvedAt).trim() : "",
        closedAt: ticket.closedAt ? String(ticket.closedAt).trim() : "",
        lastStatusChangeAt: ticket.lastStatusChangeAt
            ? String(ticket.lastStatusChangeAt).trim()
            : "",
        createdByKey: String(ticket.createdByKey || "").trim(),
        history: history
            .filter((item: any) => item && typeof item === "object")
            .map((item: any) => ({
                at: String(item.at || "").trim(),
                event: String(item.event || "").trim(),
                actor: String(item.actor || "").trim(),
                fromStatus: String(item.fromStatus || "").trim(),
                toStatus: String(item.toStatus || "").trim(),
                note: String(item.note || "").trim(),
            })),
    };
}

function saveTicketStoreToSqlite(store: TicketStore) {
    const normalizedTickets = Array.isArray(store?.tickets)
        ? store.tickets.map(normalizeTicket)
        : [];
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${TS_TICKETS_TABLE}`);
        const statement = database.prepare(`
            INSERT INTO ${TS_TICKETS_TABLE} (
                id,
                year_key,
                created_at,
                updated_at,
                payload_json
            ) VALUES (?, ?, ?, ?, ?)
        `);
        normalizedTickets.forEach((ticket, index) => {
            const id = String(ticket.id || "").trim() || `ticket_${index}`;
            statement.run([
                id,
                getYearFromTicket(ticket),
                ticket.createdAt || null,
                ticket.updatedAt || null,
                serializeJson({ ...ticket, id }),
            ]);
        });
        statement.free();
    });
}

function loadTicketStoreFromSqlite(): TicketStore {
    const database = getSqliteDatabase();
    const rows = database.exec(`
        SELECT payload_json
        FROM ${TS_TICKETS_TABLE}
        ORDER BY year_key ASC, COALESCE(created_at, updated_at, id) ASC, id ASC
    `);
    const tickets = (rows?.[0]?.values || [])
        .map((row: unknown[]) => normalizeTicket(parseJson(row?.[0], {})))
        .filter((ticket: Ticket) => !!ticket.id);
    return {
        version: 1,
        tickets,
    };
}

function saveTicketCategoriesToSqlite(payload: TicketCategories) {
    const normalized = {
        version: 1,
        issueTypes: Array.isArray(payload?.issueTypes) ? payload.issueTypes : [],
        areas: Array.isArray(payload?.areas) ? payload.areas : [],
    };
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${TS_CATEGORIES_TABLE}`);
        database.run(
            `INSERT INTO ${TS_CATEGORIES_TABLE} (store_key, payload_json) VALUES (?, ?)`,
            ["categories", serializeJson(normalized)],
        );
    });
    return normalized;
}

function loadTicketCategoriesFromSqlite(): TicketCategories {
    const database = getSqliteDatabase();
    const rows = database.exec(`
        SELECT payload_json
        FROM ${TS_CATEGORIES_TABLE}
        WHERE store_key = 'categories'
    `);
    const fallback = {
        version: 1,
        issueTypes: ["Software", "Hardware", "Accessi", "Altro"],
        areas: ["Produzione", "Uffici", "Magazzino", "IT"],
    };
    return parseJson(rows?.[0]?.values?.[0]?.[0], fallback);
}

export function initializeTicketSupportSqliteStore() {
    ensureTicketSupportSqliteSchema();
}

export function loadTicketStore(): TicketStore {
    ensureTicketSupportSqliteSchema();
    return loadTicketStoreFromSqlite();
}

export function saveTicketStore(store: TicketStore) {
    ensureTicketBackup();
    ensureTicketSupportSqliteSchema();
    saveTicketStoreToSqlite(store);
    return loadTicketStoreFromSqlite();
}

export function loadTicketCategories(): TicketCategories {
    ensureTicketSupportSqliteSchema();
    return loadTicketCategoriesFromSqlite();
}

export function saveTicketCategories(payload: TicketCategories) {
    ensureTicketBackup();
    ensureTicketSupportSqliteSchema();
    const normalized = saveTicketCategoriesToSqlite(payload);
    return normalized;
}

export function listTicketBackups() {
    return listAgpressBackups().filter((entry) =>
        backupContains(DB_RELATIVE_PATH, entry.name),
    );
}

export function createTicketBackup(limit = 10) {
    return ensureTicketBackup("manual-ticket", limit);
}

export function restoreTicketBackup(name: string) {
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
    return {
        ok: true,
        restored: safeName,
    };
}
