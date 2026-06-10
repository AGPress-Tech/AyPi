import { createOperationQueue } from "../../shared/ops/queue";
import {
    createTicketBackup,
    loadTicketCategories,
    loadTicketStore,
    listTicketBackups,
    restoreTicketBackup,
    saveTicketCategories,
    saveTicketStore,
    type TicketStore,
} from "./repository";

const enqueue = createOperationQueue("ticket-support");

export function getTicketStore() {
    return loadTicketStore();
}

export function getTicketCategories() {
    return loadTicketCategories();
}

export function getTicketBackups() {
    return listTicketBackups();
}

export function runTicketBackup() {
    return enqueue("createBackup", () => createTicketBackup());
}

export function runTicketRestore(name: string) {
    return enqueue("restoreBackup", () => restoreTicketBackup(name));
}

export function saveStore(payload: TicketStore) {
    return enqueue("saveStore", () => saveTicketStore(payload));
}

export function saveCategories(payload: { version: number; issueTypes: string[]; areas: string[] }) {
    return enqueue("saveCategories", () => saveTicketCategories(payload));
}
