import { logger } from "../../shared/logging/logger";
import {
    buildContext,
    diffCollections,
    type ActionContext,
} from "../../shared/logging/audit";
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
import { sendConfiguredMail } from "../shared/service";

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

export function runTicketBackup(context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("createBackup", () => {
        const result = createTicketBackup();
        logger.info("Ticket backup created", {
            ...meta,
            event: "ticket_backup_created",
            module: "ticket",
            category: "backup",
            restored: result?.name || "",
            outcome: "success",
        });
        return result;
    });
}

export function runTicketRestore(name: string, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("restoreBackup", () => {
        const result = restoreTicketBackup(name);
        logger.info("Ticket backup restored", {
            ...meta,
            event: "ticket_backup_restored",
            module: "ticket",
            category: "backup",
            restored: result?.restored || name,
            outcome: "success",
        });
        return result;
    });
}

export function saveStore(payload: TicketStore, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("saveStore", () => {
        const before = loadTicketStore();
        const after = saveTicketStore(payload);
        const diff = diffCollections({
            before: before.tickets,
            after: after.tickets,
            entityLabel: "Ticket",
            keyOf: (item) => String(item?.id || "").trim(),
            fieldLabels: {
                status: "Stato",
                issueType: "Tipo problema",
                area: "Area",
                priority: "Priorita",
                description: "Descrizione",
                updatedAt: "Aggiornato il",
                resolvedAt: "Risolto il",
                closedAt: "Chiuso il",
            },
        });
        logger.info("Ticket store saved", {
            ...meta,
            event: "ticket_store_saved",
            module: "ticket",
            category: "data",
            beforeCount: before.tickets.length,
            afterCount: after.tickets.length,
            added: diff.added,
            removed: diff.removed,
            updated: diff.updated,
            changes: diff.changes,
            changeSummary: diff.changeSummary,
        });
        return after;
    });
}

export function saveCategories(
    payload: { version: number; issueTypes: string[]; areas: string[] },
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("saveCategories", () => {
        const before = loadTicketCategories();
        const after = saveTicketCategories(payload);
        const issueTypeDiff = diffCollections({
            before: before.issueTypes || [],
            after: after.issueTypes || [],
            entityLabel: "Tipo ticket",
            keyOf: (item) => String(item || "").trim(),
        });
        const areaDiff = diffCollections({
            before: before.areas || [],
            after: after.areas || [],
            entityLabel: "Area ticket",
            keyOf: (item) => String(item || "").trim(),
        });
        const changes = [...issueTypeDiff.changes, ...areaDiff.changes];
        logger.info("Ticket categories saved", {
            ...meta,
            event: "ticket_categories_saved",
            module: "ticket",
            category: "data",
            beforeIssueTypes: (before.issueTypes || []).length,
            afterIssueTypes: (after.issueTypes || []).length,
            beforeAreas: (before.areas || []).length,
            afterAreas: (after.areas || []).length,
            changes,
            changeSummary:
                issueTypeDiff.changeSummary || areaDiff.changeSummary || "",
        });
        return after;
    });
}

export async function sendTicketMail(
    payload: { to: string; subject: string; text: string },
    context?: ActionContext,
) {
    await sendConfiguredMail(payload, context);
    logger.info("Ticket mail sent", {
        ...buildContext(context),
        event: "ticket_mail_sent",
        module: "ticket",
        category: "mail",
        to: String(payload?.to || "").trim(),
        subject: String(payload?.subject || "").trim(),
    });
}
