import { logger } from "../../shared/logging/logger";
import {
    buildChangeSummary,
    buildContext,
    diffCollections,
    type ActionContext,
} from "../../shared/logging/audit";
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

function summarizeAdmin(admin: SharedAdminEntry | null | undefined) {
    return {
        name: String(admin?.name || "").trim(),
        email: String(admin?.email || "").trim(),
        phone: String(admin?.phone || "").trim(),
        accessCalendar:
            typeof admin?.accessCalendar === "boolean" ? admin.accessCalendar : true,
        accessPurchasing:
            typeof admin?.accessPurchasing === "boolean"
                ? admin.accessPurchasing
                : true,
        hasPassword:
            !!String(admin?.passwordHash || "").trim() ||
            !!String(admin?.password || "").trim(),
    };
}

function summarizeAssigneeEntries(payload: {
    groups?: Record<string, string[]>;
    emails?: Record<string, string>;
}) {
    const groups = payload?.groups && typeof payload.groups === "object" ? payload.groups : {};
    const emails = payload?.emails && typeof payload.emails === "object" ? payload.emails : {};
    return Object.keys(groups)
        .flatMap((department) =>
            (Array.isArray(groups[department]) ? groups[department] : []).map((name) => {
                const normalizedName = String(name || "").trim();
                const key = `${department}|${normalizedName}`;
                return {
                    key,
                    name: normalizedName,
                    department: String(department || "").trim(),
                    email: String(emails[key] || "").trim(),
                };
            }),
        )
        .filter((item) => item.name);
}

export function saveAdmins(admins: SharedAdminEntry[], context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("saveAdmins", async () => {
        const beforeAdmins = loadAdminCredentials().map(summarizeAdmin);
        await saveAdminCredentials(admins);
        const afterAdmins = loadAdminCredentials().map(summarizeAdmin);
        const diff = diffCollections({
            before: beforeAdmins,
            after: afterAdmins,
            entityLabel: "Admin",
            keyOf: (item) => String(item?.name || "").trim(),
            fieldLabels: {
                email: "Email",
                phone: "Telefono",
                accessCalendar: "Accesso Calendar",
                accessPurchasing: "Accesso Purchasing",
            },
        });
        logger.info("Shared save admins", {
            ...meta,
            event: "shared_save_admins",
            module: "shared",
            category: "data",
            beforeCount: beforeAdmins.length,
            afterCount: afterAdmins.length,
            added: diff.added,
            removed: diff.removed,
            updated: diff.updated,
            changes: diff.changes,
            changeSummary: diff.changeSummary,
        });
        return loadAdminCredentials();
    });
}

export function saveAssignees(
    payload: {
        groups?: Record<string, string[]>;
        emails?: Record<string, string>;
    },
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("saveAssignees", async () => {
        const before = loadAssigneeOptions();
        const beforeEntries = summarizeAssigneeEntries(before);
        await saveAssigneeOptions(payload);
        const after = loadAssigneeOptions();
        const afterEntries = summarizeAssigneeEntries(after);
        const diff = diffCollections({
            before: beforeEntries,
            after: afterEntries,
            entityLabel: "Assegnatario",
            keyOf: (item) => String(item?.key || "").trim(),
            fieldLabels: {
                department: "Reparto",
                email: "Email",
            },
        });
        logger.info("Shared save assignees", {
            ...meta,
            event: "shared_save_assignees",
            module: "shared",
            category: "data",
            beforeDepartments: Object.keys(before.groups || {}).length,
            afterDepartments: Object.keys(after.groups || {}).length,
            beforeEntries: beforeEntries.length,
            afterEntries: afterEntries.length,
            added: diff.added,
            removed: diff.removed,
            updated: diff.updated,
            changes: diff.changes,
            changeSummary: diff.changeSummary,
        });
        return after;
    });
}

export function verifyAdmin(
    password: string,
    targetName?: string | null,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("verifyAdmin", async () => {
        const admin = await verifyAdminPassword(password, targetName);
        logger.info("Shared verify admin", {
            ...meta,
            event: "shared_verify_admin",
            module: "shared",
            category: "auth",
            targetName: String(targetName || "").trim(),
            outcome: admin ? "success" : "failure",
        });
        return admin;
    });
}
