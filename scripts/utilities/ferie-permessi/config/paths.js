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
const CALENDAR_DIR = path.join(BASE_DIR, "AyPi Calendar");
const GENERAL_DIR = path.join(BASE_DIR, "General");
const GANTT_DIR = path.join(BASE_DIR, "AyPi Gantt");

const LEGACY_DATA_PATH = path.join(BASE_DIR, "ferie-permessi.json");
const LEGACY_REQUESTS_PATH = path.join(BASE_DIR, "ferie-permessi-requests.json");
const LEGACY_HOLIDAYS_PATH = path.join(BASE_DIR, "ferie-permessi-holidays.json");
const LEGACY_BALANCES_PATH = path.join(BASE_DIR, "ferie-permessi-balances.json");
const LEGACY_CLOSURES_PATH = path.join(BASE_DIR, "ferie-permessi-closures.json");
const LEGACY_ASSIGNEES_PATH = path.join(BASE_DIR, "amministrazione-assignees.json");
const LEGACY_ADMINS_PATH = path.join(BASE_DIR, "ferie-permessi-admins.json");
const LEGACY_CONFIG_PATH = path.join(BASE_DIR, "config-calendar.json");
const LEGACY_OTP_MAIL_SERVER_PATH = path.join(BASE_DIR, "otp-mail.json");

const DATA_PATH = path.join(CALENDAR_DIR, "ferie-permessi.json");
const REQUESTS_PATH = path.join(CALENDAR_DIR, "ferie-permessi-requests.json");
const HOLIDAYS_PATH = path.join(CALENDAR_DIR, "ferie-permessi-holidays.json");
const BALANCES_PATH = path.join(CALENDAR_DIR, "ferie-permessi-balances.json");
const CLOSURES_PATH = path.join(CALENDAR_DIR, "ferie-permessi-closures.json");
const ASSIGNEES_PATH = path.join(GENERAL_DIR, "amministrazione-assignees.json");
const ADMINS_PATH = path.join(GENERAL_DIR, "ferie-permessi-admins.json");
const CONFIG_PATH = path.join(CALENDAR_DIR, "config-calendar.json");
const OTP_MAIL_SERVER_PATH = path.join(GENERAL_DIR, "otp-mail.json");
const OTP_MAIL_LOCAL_PATH = path.join(__dirname, "..", "..", "..", "..", "config", "otp-mail.json");

module.exports = {
    BASE_DIR,
    CALENDAR_DIR,
    GENERAL_DIR,
    GANTT_DIR,
    DATA_PATH,
    REQUESTS_PATH,
    HOLIDAYS_PATH,
    BALANCES_PATH,
    CLOSURES_PATH,
    ASSIGNEES_PATH,
    ADMINS_PATH,
    CONFIG_PATH,
    OTP_MAIL_SERVER_PATH,
    LEGACY_DATA_PATH,
    LEGACY_REQUESTS_PATH,
    LEGACY_HOLIDAYS_PATH,
    LEGACY_BALANCES_PATH,
    LEGACY_CLOSURES_PATH,
    LEGACY_ASSIGNEES_PATH,
    LEGACY_ADMINS_PATH,
    LEGACY_CONFIG_PATH,
    LEGACY_OTP_MAIL_SERVER_PATH,
    OTP_MAIL_LOCAL_PATH,
};
