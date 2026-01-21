const fs = require("fs");

const { OTP_MAIL_SERVER_PATH, OTP_MAIL_LOCAL_PATH } = require("../config/paths");

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
    const configPath = fs.existsSync(OTP_MAIL_SERVER_PATH) ? OTP_MAIL_SERVER_PATH : OTP_MAIL_LOCAL_PATH;
    if (!fs.existsSync(configPath)) {
        throw new Error(`Config mail non trovata. Percorsi verificati: ${OTP_MAIL_SERVER_PATH}, ${OTP_MAIL_LOCAL_PATH}`);
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
    sendOtpEmail,
};
