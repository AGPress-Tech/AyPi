import { createOperationQueue } from "../../shared/ops/queue";
import {
    listAdminNames,
    loadAdminCredentials,
    loadAssigneeOptions,
    saveAdminCredentials,
    saveAssigneeOptions,
    verifyAdminPassword,
    type SharedAdminEntry,
} from "./repository";

const enqueue = createOperationQueue("shared");

export function getAdmins() {
    return loadAdminCredentials();
}

export function getAdminNames() {
    return listAdminNames();
}

export function getAssignees() {
    return loadAssigneeOptions();
}

export function saveAdmins(admins: SharedAdminEntry[]) {
    return enqueue("saveAdmins", () => saveAdminCredentials(admins));
}

export function saveAssignees(payload: {
    groups?: Record<string, string[]>;
    emails?: Record<string, string>;
}) {
    return enqueue("saveAssignees", () => saveAssigneeOptions(payload));
}

export function verifyAdmin(password: string, targetName?: string | null) {
    return enqueue("verifyAdmin", () => verifyAdminPassword(password, targetName));
}
