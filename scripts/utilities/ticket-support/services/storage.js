const fs = require("fs");
const path = require("path");
const { TICKET_DIR, LEGACY_TICKET_DIR, LEGACY_DATA_PATH, DATA_PATH } = require("../config/paths");

const EMPTY_STORE = {
    version: 1,
    tickets: [],
};

function ensureFolderFor(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function ensureTickerDir() {
    try {
        if (!fs.existsSync(TICKET_DIR)) {
            fs.mkdirSync(TICKET_DIR, { recursive: true });
        }
        return true;
    } catch (err) {
        console.error("[ticket-support] impossibile creare cartella ticket:", TICKET_DIR, err);
        return false;
    }
}

function getYearFromTicket(ticket) {
    const createdAt = String(ticket?.createdAt || "").trim();
    const parsed = createdAt ? new Date(createdAt) : null;
    if (parsed && Number.isFinite(parsed.getTime())) {
        return String(parsed.getFullYear());
    }
    return String(new Date().getFullYear());
}

function getYearFilePath(year) {
    const safeYear = String(year || "").trim();
    return path.join(TICKET_DIR, `ticket-${safeYear}.json`);
}

function readTicketsFromFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed?.tickets) ? parsed.tickets : [];
        return list.map(normalizeTicket);
    } catch (err) {
        console.error("[ticket-support] errore lettura file:", filePath, err);
        return [];
    }
}

function listYearFiles(directory = TICKET_DIR) {
    if (!directory || !fs.existsSync(directory)) return [];
    try {
        return fs.readdirSync(directory)
            .filter((name) => /^ticket-\d{4}\.json$/i.test(name))
            .map((name) => path.join(directory, name));
    } catch (err) {
        console.error("[ticket-support] errore lettura cartella ticket:", err);
        return [];
    }
}

function loadFromYearFiles() {
    const primaryFiles = listYearFiles(TICKET_DIR);
    const files = primaryFiles.length ? primaryFiles : listYearFiles(LEGACY_TICKET_DIR);
    if (!files.length) return [];
    const tickets = [];
    files.forEach((filePath) => {
        tickets.push(...readTicketsFromFile(filePath));
    });
    return tickets;
}

function loadFromLegacyFile() {
    try {
        if (!fs.existsSync(LEGACY_DATA_PATH)) return [];
        const raw = fs.readFileSync(LEGACY_DATA_PATH, "utf8");
        const parsed = JSON.parse(raw);
        const tickets = Array.isArray(parsed?.tickets) ? parsed.tickets.map(normalizeTicket) : [];
        return tickets;
    } catch (err) {
        console.error("[ticket-support] errore lettura legacy store:", err);
        return [];
    }
}

function normalizeTicket(input) {
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
        lastStatusChangeAt: ticket.lastStatusChangeAt ? String(ticket.lastStatusChangeAt).trim() : "",
        createdByKey: String(ticket.createdByKey || "").trim(),
        history: history
            .filter((item) => item && typeof item === "object")
            .map((item) => ({
                at: String(item.at || "").trim(),
                event: String(item.event || "").trim(),
                actor: String(item.actor || "").trim(),
                fromStatus: String(item.fromStatus || "").trim(),
                toStatus: String(item.toStatus || "").trim(),
                note: String(item.note || "").trim(),
            })),
    };
}

function loadStore() {
    try {
        const tickerDirReady = ensureTickerDir();

        const yearTickets = tickerDirReady ? loadFromYearFiles() : [];
        if (yearTickets.length) {
            return {
                version: 1,
                tickets: yearTickets,
            };
        }

        const legacyTickets = loadFromLegacyFile();
        if (legacyTickets.length) {
            // Migrazione automatica da file unico legacy a file annuali.
            saveStore({ version: 1, tickets: legacyTickets });
            return { version: 1, tickets: legacyTickets };
        }

        return { ...EMPTY_STORE, tickets: [] };
    } catch (err) {
        console.error("[ticket-support] errore lettura store:", err);
        return { ...EMPTY_STORE, tickets: [] };
    }
}

function saveStore(store) {
    const normalizedTickets = Array.isArray(store?.tickets) ? store.tickets.map(normalizeTicket) : [];
    const tickerDirReady = ensureTickerDir();

    if (!tickerDirReady) {
        // Fallback: mantiene operatività su file unico se la cartella annuale non è scrivibile.
        const fallbackPayload = { version: 1, tickets: normalizedTickets };
        try {
            ensureFolderFor(LEGACY_DATA_PATH);
            fs.writeFileSync(LEGACY_DATA_PATH, JSON.stringify(fallbackPayload, null, 2), "utf8");
        } catch (err) {
            console.error("[ticket-support] fallback legacy non riuscito:", LEGACY_DATA_PATH, err);
        }
        return fallbackPayload;
    }

    const byYear = normalizedTickets.reduce((acc, ticket) => {
        const year = getYearFromTicket(ticket);
        if (!acc[year]) acc[year] = [];
        acc[year].push(ticket);
        return acc;
    }, {});

    Object.keys(byYear).forEach((year) => {
        const payload = {
            version: 1,
            year: Number(year),
            tickets: byYear[year],
        };
        const filePath = getYearFilePath(year);
        ensureFolderFor(filePath);
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    });

    // Rimuove eventuali file annuali non più presenti nel payload corrente.
    const expectedNames = new Set(Object.keys(byYear).map((year) => `ticket-${year}.json`.toLowerCase()));
    listYearFiles(TICKET_DIR).forEach((filePath) => {
        const name = path.basename(filePath).toLowerCase();
        if (!expectedNames.has(name)) {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                console.error("[ticket-support] impossibile rimuovere file annuale obsoleto:", filePath, err);
            }
        }
    });

    return {
        version: 1,
        tickets: normalizedTickets,
    };
}

module.exports = {
    DATA_PATH,
    loadStore,
    saveStore,
};
