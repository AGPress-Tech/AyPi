import { logger } from "../../shared/logging/logger";
import {
    buildContext,
    diffCollections,
    type ActionContext,
} from "../../shared/logging/audit";
import { createOperationQueue } from "../../shared/ops/queue";
import {
    loadCalendarAccessConfig,
    listAdminNames,
    loadAdminCredentials,
    loadAssigneeOptions,
    loadOtpMailConfig,
    normalizeOtpMailConfig,
    saveAdminCredentials,
    saveAssigneeOptions,
    saveCalendarAccessConfig,
    saveOtpMailConfig,
    verifyAdminPassword,
    type SharedAdminEntry,
    type SharedAccessConfig,
    type SharedOtpMailConfig,
} from "./repository";
const nodemailer = require("nodemailer");

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

export function getCalendarAccessConfig() {
    return loadCalendarAccessConfig();
}

export function getOtpMailConfig() {
    return loadOtpMailConfig();
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

export function saveCalendarConfig(
    config: SharedAccessConfig,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("saveCalendarConfig", async () => {
        const before = loadCalendarAccessConfig();
        const after = await saveCalendarAccessConfig(config);
        logger.info("Shared save calendar access config", {
            ...meta,
            event: "shared_save_calendar_access_config",
            module: "shared",
            category: "config",
            before,
            after,
        });
        return after;
    });
}

export function saveSharedOtpMailConfig(
    config: SharedOtpMailConfig,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("saveOtpMailConfig", async () => {
        const before = loadOtpMailConfig();
        const after = await saveOtpMailConfig(config);
        logger.info("Shared save otp mail config", {
            ...meta,
            event: "shared_save_otp_mail_config",
            module: "shared",
            category: "config",
            beforeConfigured: !!before,
            afterConfigured: !!after,
            host: after.host,
            port: after.port || 587,
            secure: !!after.secure,
            from: after.from || "",
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

function createMailerTransport(config: SharedOtpMailConfig) {
    return nodemailer.createTransport({
        host: config.host,
        port: config.port || 587,
        secure: !!config.secure,
        auth: {
            user: config.user,
            pass: config.pass,
        },
    });
}

export async function sendOtpTestMail(
    payload: unknown,
    recipient: string,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    const config = normalizeOtpMailConfig(payload);
    const to = String(recipient || "").trim();
    if (!to) {
        throw new Error("Inserisci l'email di prova.");
    }
    const transporter = createMailerTransport(config);
    const from = config.from || config.user;
    await transporter.sendMail({
        from,
        to,
        subject: "Test configurazione mailing AyPi Calendar",
        text: "Test invio email completato con successo.",
    });
    logger.info("Shared send otp test mail", {
        ...meta,
        event: "shared_send_otp_test_mail",
        module: "shared",
        category: "mail",
        to,
        host: config.host,
    });
}

export async function sendAdminOtpMail(
    email: string,
    code: string,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    const config = loadOtpMailConfig();
    const recipient = String(email || "").trim();
    if (!config) {
        throw new Error("Config mail non trovata.");
    }
    if (!recipient) {
        throw new Error("Email admin mancante.");
    }
    if (!String(code || "").trim()) {
        throw new Error("Codice OTP mancante.");
    }
    const transporter = createMailerTransport(config);
    const from = config.from || config.user;
    await transporter.sendMail({
        from,
        to: recipient,
        subject: "OTP recupero password",
        text: `Il tuo codice OTP e': ${code}\nValido per 5 minuti.`,
    });
    logger.info("Shared send admin otp mail", {
        ...meta,
        event: "shared_send_admin_otp_mail",
        module: "shared",
        category: "mail",
        to: recipient,
    });
}
