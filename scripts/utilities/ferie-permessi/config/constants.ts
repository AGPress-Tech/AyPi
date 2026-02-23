// @ts-nocheck
require("../../../shared/dev-guards");
const APPROVAL_PASSWORD = "AGPress";
const AUTO_REFRESH_MS = 60000;
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const COLOR_STORAGE_KEY = "fpColorSettings";
const THEME_STORAGE_KEY = "fpTheme";
const GUIDE_URL = "";
const GUIDE_SEARCH_PARAM = "q";
const DEFAULT_TYPE_COLORS = {
    ferie: "#2f9e44",
    permesso: "#f08c00",
    straordinari: "#1a73e8",
    mutua: "#00acc1",
    speciale: "#9e9d24",
    retribuito: "#c2185b",
};

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    APPROVAL_PASSWORD,
    AUTO_REFRESH_MS,
    OTP_EXPIRY_MS,
    OTP_RESEND_MS,
    COLOR_STORAGE_KEY,
    THEME_STORAGE_KEY,
    GUIDE_URL,
    GUIDE_SEARCH_PARAM,
    DEFAULT_TYPE_COLORS,
};


