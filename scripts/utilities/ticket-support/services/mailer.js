const fs = require("fs");
const path = require("path");
const { NETWORK_PATHS } = require("../../../../config/paths");

let nodemailer;
let nodemailerError = null;
try {
    nodemailer = require("nodemailer");
} catch (err) {
    nodemailerError = err;
    console.error("[ticket-support] modulo nodemailer non disponibile:", err);
}

const ROOT_DIR = path.dirname(NETWORK_PATHS.feriePermessiData);
const OTP_MAIL_SERVER_PATH = path.join(ROOT_DIR, "General", "otp-mail.json");
const OTP_MAIL_LEGACY_PATH = NETWORK_PATHS.otpMailServer;
const OTP_MAIL_LOCAL_PATH = path.join(__dirname, "..", "..", "..", "..", "config", "otp-mail.json");

function isMailerAvailable() {
    return !!nodemailer;
}

function getMailerError() {
    return nodemailerError;
}

function loadMailConfig() {
    const configPath = [OTP_MAIL_SERVER_PATH, OTP_MAIL_LEGACY_PATH, OTP_MAIL_LOCAL_PATH]
        .find((item) => item && fs.existsSync(item));
    if (!configPath || !fs.existsSync(configPath)) {
        throw new Error(`Config mail non trovata. Percorsi verificati: ${OTP_MAIL_SERVER_PATH}, ${OTP_MAIL_LEGACY_PATH}, ${OTP_MAIL_LOCAL_PATH}`);
    }
    let raw = fs.readFileSync(configPath, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) {
        raw = raw.slice(1);
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.host || !parsed.user || !parsed.pass) {
        throw new Error(`Config mail incompleta in ${configPath}.`);
    }
    return parsed;
}

async function sendMail(payload) {
    if (!nodemailer) {
        throw new Error("Modulo 'nodemailer' non disponibile.");
    }
    const to = String(payload?.to || "").trim();
    const subject = String(payload?.subject || "").trim();
    const text = String(payload?.text || "").trim();
    if (!to || !subject || !text) {
        throw new Error("Email non valida: destinatario, oggetto o testo mancanti.");
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
        to,
        subject,
        text,
    });
}

module.exports = {
    isMailerAvailable,
    getMailerError,
    sendMail,
};
