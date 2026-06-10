import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
import { ensureFolderFor, readJsonFile, writeJsonFileAtomic } from "../../shared/storage/json-files";
import {
    createDailyDirectoryBackup,
    createDirectoryBackup,
    listBackups,
    replaceDirectoryContents,
} from "../../shared/storage/backups";

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

const TICKET_DIR = backendConfig.modules.ticketSupport.dir;
const TICKET_YEARS_DIR = path.join(TICKET_DIR, "Ticket Years");
const CATEGORIES_PATH = path.join(TICKET_DIR, "ticket-categories.json");
const TICKET_BACKUP_ROOT_DIR = path.join(path.dirname(TICKET_DIR), "Backup Ticket");

function ensureTicketDir() {
    fs.mkdirSync(TICKET_DIR, { recursive: true });
    fs.mkdirSync(TICKET_YEARS_DIR, { recursive: true });
}

function ensureTicketBackup(prefix = "auto", limit = 30) {
    return prefix === "auto"
        ? createDailyDirectoryBackup({
              sourceDir: TICKET_DIR,
              backupRootDir: TICKET_BACKUP_ROOT_DIR,
              prefix,
              limit,
          })
        : createDirectoryBackup({
              sourceDir: TICKET_DIR,
              backupRootDir: TICKET_BACKUP_ROOT_DIR,
              prefix,
              limit,
          });
}

function getYearFromTicket(ticket: Partial<Ticket>) {
    const createdAt = String(ticket?.createdAt || "").trim();
    const parsed = createdAt ? new Date(createdAt) : null;
    if (parsed && Number.isFinite(parsed.getTime())) {
        return String(parsed.getFullYear());
    }
    return String(new Date().getFullYear());
}

function getYearFilePath(year: string | number) {
    return path.join(TICKET_YEARS_DIR, `ticket-${String(year || "").trim()}.json`);
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

function listYearFiles() {
    if (!fs.existsSync(TICKET_YEARS_DIR)) return [];
    return fs
        .readdirSync(TICKET_YEARS_DIR)
        .filter((name) => /^ticket-\d{4}\.json$/i.test(name))
        .map((name) => path.join(TICKET_YEARS_DIR, name));
}

export function loadTicketStore(): TicketStore {
    ensureTicketDir();
    const tickets: Ticket[] = [];
    listYearFiles().forEach((filePath) => {
        const parsed = readJsonFile<{ tickets?: any[] }>(filePath, { tickets: [] });
        const list = Array.isArray(parsed?.tickets) ? parsed.tickets : [];
        list.forEach((item) => tickets.push(normalizeTicket(item)));
    });
    return {
        version: 1,
        tickets,
    };
}

export function saveTicketStore(store: TicketStore) {
    ensureTicketDir();
    ensureTicketBackup();
    const normalizedTickets = Array.isArray(store?.tickets)
        ? store.tickets.map(normalizeTicket)
        : [];
    const byYear = normalizedTickets.reduce<Record<string, Ticket[]>>((acc, ticket) => {
        const year = getYearFromTicket(ticket);
        if (!acc[year]) acc[year] = [];
        acc[year].push(ticket);
        return acc;
    }, {});

    Object.keys(byYear).forEach((year) => {
        writeJsonFileAtomic(getYearFilePath(year), {
            version: 1,
            year: Number(year),
            tickets: byYear[year],
        });
    });

    const expected = new Set(
        Object.keys(byYear).map((year) => `ticket-${year}.json`.toLowerCase()),
    );
    listYearFiles().forEach((filePath) => {
        const name = path.basename(filePath).toLowerCase();
        if (expected.has(name)) return;
        fs.unlinkSync(filePath);
    });

    return {
        version: 1,
        tickets: normalizedTickets,
    };
}

export function loadTicketCategories(): TicketCategories {
    ensureFolderFor(CATEGORIES_PATH);
    const fallback = {
        version: 1,
        issueTypes: ["Software", "Hardware", "Accessi", "Altro"],
        areas: ["Produzione", "Uffici", "Magazzino", "IT"],
    };
    return readJsonFile(CATEGORIES_PATH, fallback);
}

export function saveTicketCategories(payload: TicketCategories) {
    ensureTicketBackup();
    const normalized = {
        version: 1,
        issueTypes: Array.isArray(payload?.issueTypes) ? payload.issueTypes : [],
        areas: Array.isArray(payload?.areas) ? payload.areas : [],
    };
    writeJsonFileAtomic(CATEGORIES_PATH, normalized);
    return normalized;
}

export function listTicketBackups() {
    return listBackups(TICKET_BACKUP_ROOT_DIR);
}

export function createTicketBackup(limit = 10) {
    return ensureTicketBackup("manual", limit);
}

export function restoreTicketBackup(name: string) {
    const safeName = String(name || "").trim();
    if (!safeName) {
        throw new Error("Backup name missing");
    }
    const sourceDir = path.join(TICKET_BACKUP_ROOT_DIR, safeName);
    if (!fs.existsSync(sourceDir)) {
        throw new Error("Backup not found");
    }
    replaceDirectoryContents(sourceDir, TICKET_DIR);
    return {
        ok: true,
        restored: safeName,
    };
}
