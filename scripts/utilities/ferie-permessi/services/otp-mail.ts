require("../../../shared/dev-guards");
import fs from "fs";

import {
    OTP_MAIL_SERVER_PATH,
    LEGACY_OTP_MAIL_SERVER_PATH,
    OTP_MAIL_LOCAL_PATH,
} from "../config/paths";

type MailConfig = {
    host: string;
    user: string;
    pass: string;
    port?: number;
    secure?: boolean;
    from?: string;
};

type AdminLike = {
    email?: string;
};

let nodemailer: any;
let nodemailerError: unknown = null;
try {
    nodemailer = require("nodemailer");
} catch (err) {
    nodemailerError = err;
    console.error("Modulo 'nodemailer' non disponibile:", err);
}

function isMailerAvailable() {
    return !!nodemailer;
}

function getMailerError() {
    return nodemailerError;
}

function loadMailConfig(): MailConfig {
    const configPath = [
        OTP_MAIL_SERVER_PATH,
        LEGACY_OTP_MAIL_SERVER_PATH,
        OTP_MAIL_LOCAL_PATH,
    ].find((item) => item && fs.existsSync(item));
    if (!configPath || !fs.existsSync(configPath)) {
        throw new Error(
            `Config mail non trovata. Percorsi verificati: ${OTP_MAIL_SERVER_PATH}, ${LEGACY_OTP_MAIL_SERVER_PATH}, ${OTP_MAIL_LOCAL_PATH}`,
        );
    }
    try {
        let raw = fs.readFileSync(configPath, "utf8");
        if (raw.charCodeAt(0) === 0xfeff) {
            raw = raw.slice(1);
        }
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.host || !parsed.user || !parsed.pass) {
            throw new Error(`Config mail incompleta in ${configPath}.`);
        }
        return parsed as MailConfig;
    } catch (err) {
        console.error("Errore lettura config mail:", err);
        throw err;
    }
}

function normalizeMailConfig(payload: unknown): MailConfig {
    if (!payload || typeof payload !== "object") {
        throw new Error("Config mail non valida.");
    }
    const obj = payload as Record<string, unknown>;
    const host = String(obj.host || "").trim();
    const user = String(obj.user || "").trim();
    const pass = String(obj.pass || "").trim();
    const from = String(obj.from || "").trim();
    const portRaw = obj.port;
    const port =
        portRaw !== undefined &&
        portRaw !== null &&
        String(portRaw).trim() !== ""
            ? Number(portRaw)
            : undefined;
    const secure = !!obj.secure;

    if (!host || !user || !pass) {
        throw new Error("Compila host, user e password del servizio email.");
    }
    if (port !== undefined && (!Number.isFinite(port) || port <= 0)) {
        throw new Error("Porta non valida.");
    }

    return {
        host,
        user,
        pass,
        port: port !== undefined ? port : undefined,
        secure,
        from: from || undefined,
    };
}

function saveMailConfig(payload: unknown, destinationPath = OTP_MAIL_SERVER_PATH) {
    const config = normalizeMailConfig(payload);
    const targets = [destinationPath];
    if (
        LEGACY_OTP_MAIL_SERVER_PATH &&
        fs.existsSync(LEGACY_OTP_MAIL_SERVER_PATH)
    ) {
        targets.push(LEGACY_OTP_MAIL_SERVER_PATH);
    }
    const filteredTargets = targets.filter(
        (item) => typeof item === "string" && item.trim(),
    );
    filteredTargets.forEach((targetPath) => {
        const dir = require("path").dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), "utf8");
    });
    return { config, path: destinationPath };
}

async function sendTestEmail(payload: unknown, to: string) {
    if (!nodemailer) {
        throw new Error("Modulo 'nodemailer' non disponibile.");
    }
    const config = normalizeMailConfig(payload);
    const recipient = String(to || "").trim();
    if (!recipient) {
        throw new Error("Inserisci l'email di prova.");
    }
    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port || 587,
        secure: !!config.secure,
        auth: {
            user: config.user,
            pass: config.pass,
        },
    });
    const from = config.from || config.user;
    await transporter.sendMail({
        from,
        to: recipient,
        subject: "Test configurazione mailing AyPi Calendar",
        text: "Test invio email completato con successo.",
    });
}

async function sendOtpEmail(admin: AdminLike, code: string) {
    if (!nodemailer) {
        throw new Error("Modulo 'nodemailer' non disponibile.");
    }
    const config = loadMailConfig();
    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port || 587,
        secure: !!config.secure,
        auth: {
            user: config.user,
            pass: config.pass,
        },
    });
    const from = config.from || config.user;
    await transporter.sendMail({
        from,
        to: admin.email,
        subject: "OTP recupero password",
        text: `Il tuo codice OTP e': ${code}\nValido per 5 minuti.`,
    });
}

export {
    isMailerAvailable,
    getMailerError,
    loadMailConfig,
    saveMailConfig,
    sendTestEmail,
    sendOtpEmail,
};

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
        isMailerAvailable,
        getMailerError,
        loadMailConfig,
        saveMailConfig,
        sendTestEmail,
        sendOtpEmail,
    };
}


