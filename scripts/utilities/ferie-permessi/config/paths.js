const path = require("path");
const { NETWORK_PATHS } = require("../../../../config/paths");

let ipcRenderer = null;
try {
    const electron = require("electron");
    ipcRenderer = electron && electron.ipcRenderer ? electron.ipcRenderer : null;
} catch (err) {
    ipcRenderer = null;
}

const DEFAULT_BASE_DIR = path.dirname(NETWORK_PATHS.feriePermessiData);

function resolveBaseDir() {
    if (process.env.AYPI_FP_BASE_DIR) {
        return process.env.AYPI_FP_BASE_DIR;
    }
    if (ipcRenderer && typeof ipcRenderer.sendSync === "function") {
        try {
            const base = ipcRenderer.sendSync("fp-get-base-dir");
            if (base) return base;
        } catch (err) {
            // fallback to default
        }
    }
    return DEFAULT_BASE_DIR;
}

const BASE_DIR = resolveBaseDir();
const DATA_PATH = path.join(BASE_DIR, "ferie-permessi.json");
const REQUESTS_PATH = path.join(BASE_DIR, "ferie-permessi-requests.json");
const HOLIDAYS_PATH = path.join(BASE_DIR, "ferie-permessi-holidays.json");
const BALANCES_PATH = path.join(BASE_DIR, "ferie-permessi-balances.json");
const CLOSURES_PATH = path.join(BASE_DIR, "ferie-permessi-closures.json");
const ASSIGNEES_PATH = path.join(BASE_DIR, "amministrazione-assignees.json");
const ADMINS_PATH = path.join(BASE_DIR, "ferie-permessi-admins.json");
const OTP_MAIL_SERVER_PATH = path.join(BASE_DIR, "otp-mail.json");
const OTP_MAIL_LOCAL_PATH = path.join(__dirname, "..", "..", "..", "..", "config", "otp-mail.json");

module.exports = {
    BASE_DIR,
    DATA_PATH,
    REQUESTS_PATH,
    HOLIDAYS_PATH,
    BALANCES_PATH,
    CLOSURES_PATH,
    ASSIGNEES_PATH,
    ADMINS_PATH,
    OTP_MAIL_SERVER_PATH,
    OTP_MAIL_LOCAL_PATH,
};
