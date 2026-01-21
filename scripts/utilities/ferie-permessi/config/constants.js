const APPROVAL_PASSWORD = "AGPress";
const AUTO_REFRESH_MS = 15000;
const OTP_EXPIRY_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const COLOR_STORAGE_KEY = "fpColorSettings";
const THEME_STORAGE_KEY = "fpTheme";
const DEFAULT_TYPE_COLORS = {
    ferie: "#2f9e44",
    permesso: "#f08c00",
    straordinari: "#1a73e8",
};

module.exports = {
    APPROVAL_PASSWORD,
    AUTO_REFRESH_MS,
    OTP_EXPIRY_MS,
    OTP_RESEND_MS,
    COLOR_STORAGE_KEY,
    THEME_STORAGE_KEY,
    DEFAULT_TYPE_COLORS,
};
