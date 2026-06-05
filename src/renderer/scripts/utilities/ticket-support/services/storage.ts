require("../../../shared/dev-guards");
import { requestBackend } from "../../../shared/backend-client";

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

type TicketStore = {
    version: number;
    tickets: Ticket[];
};

const EMPTY_STORE: TicketStore = {
    version: 1,
    tickets: [],
};

let storeCache: TicketStore = { ...EMPTY_STORE, tickets: [] };

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

function normalizeStore(raw: any): TicketStore {
    const tickets = Array.isArray(raw?.tickets) ? raw.tickets.map(normalizeTicket) : [];
    return {
        version: 1,
        tickets,
    };
}

function loadStore() {
    return normalizeStore(storeCache);
}

async function hydrateStore() {
    const payload = await requestBackend("/api/ticket-support/store");
    storeCache = normalizeStore(payload);
    return loadStore();
}

function saveStore(store: TicketStore) {
    storeCache = normalizeStore(store);
    requestBackend("/api/ticket-support/store", {
        method: "PUT",
        body: storeCache,
    }).catch((err) => {
        console.error("[ticket-support] errore salvataggio store backend:", err);
    });
    return loadStore();
}

const DATA_PATH = "backend://ticket-support/store";

export { DATA_PATH, loadStore, saveStore, hydrateStore };

if (
    typeof module !== "undefined" &&
    module.exports &&
    !(globalThis as any).__aypiBundled
) {
    module.exports = {
        DATA_PATH,
        loadStore,
        saveStore,
        hydrateStore,
    };
}
