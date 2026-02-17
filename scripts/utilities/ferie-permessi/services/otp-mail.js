const fs = require("fs");

const {
    OTP_MAIL_SERVER_PATH,
    LEGACY_OTP_MAIL_SERVER_PATH,
    OTP_MAIL_LOCAL_PATH,
} = require("../config/paths");

let nodemailer;
let nodemailerError = null;
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

function loadMailConfig() {
    const configPath = [OTP_MAIL_SERVER_PATH, LEGACY_OTP_MAIL_SERVER_PATH, OTP_MAIL_LOCAL_PATH]
        .find((item) => item && fs.existsSync(item));
    if (!configPath || !fs.existsSync(configPath)) {
        throw new Error(`Config mail non trovata. Percorsi verificati: ${OTP_MAIL_SERVER_PATH}, ${LEGACY_OTP_MAIL_SERVER_PATH}, ${OTP_MAIL_LOCAL_PATH}`);
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
        return parsed;
    } catch (err) {
        console.error("Errore lettura config mail:", err);
        throw err;
    }
}

function normalizeMailConfig(payload) {
    if (!payload || typeof payload !== "object") {
        throw new Error("Config mail non valida.");
    }
    const host = String(payload.host || "").trim();
    const user = String(payload.user || "").trim();
    const pass = String(payload.pass || "").trim();
    const from = String(payload.from || "").trim();
    const portRaw = payload.port;
    const port = portRaw !== undefined && portRaw !== null && String(portRaw).trim() !== ""
        ? Number(portRaw)
        : undefined;
    const secure = !!payload.secure;

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

function saveMailConfig(payload, destinationPath = OTP_MAIL_SERVER_PATH) {
    const config = normalizeMailConfig(payload);
    const targets = [destinationPath, LEGACY_OTP_MAIL_SERVER_PATH]
        .filter((item) => typeof item === "string" && item.trim());
    targets.forEach((targetPath) => {
        const dir = require("path").dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), "utf8");
    });
    return { config, path: destinationPath };
}

async function sendTestEmail(payload, to) {
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

async function sendOtpEmail(admin, code) {
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

module.exports = {
    isMailerAvailable,
    getMailerError,
    loadMailConfig,
    saveMailConfig,
    sendTestEmail,
    sendOtpEmail,
};
