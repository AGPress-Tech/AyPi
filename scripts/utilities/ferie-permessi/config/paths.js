const path = require("path");
const { NETWORK_PATHS } = require("../../../../config/paths");

const DATA_PATH = NETWORK_PATHS.feriePermessiData;
const REQUESTS_PATH = NETWORK_PATHS.feriePermessiRequests;
const HOLIDAYS_PATH = NETWORK_PATHS.feriePermessiHolidays;
const BALANCES_PATH = NETWORK_PATHS.feriePermessiBalances;
const ASSIGNEES_PATH = NETWORK_PATHS.amministrazioneAssignees;
const ADMINS_PATH = NETWORK_PATHS.feriePermessiAdmins;
const OTP_MAIL_SERVER_PATH = NETWORK_PATHS.otpMailServer;
const OTP_MAIL_LOCAL_PATH = path.join(__dirname, "..", "..", "..", "..", "config", "otp-mail.json");

module.exports = {
    DATA_PATH,
    REQUESTS_PATH,
    HOLIDAYS_PATH,
    BALANCES_PATH,
    ASSIGNEES_PATH,
    ADMINS_PATH,
    OTP_MAIL_SERVER_PATH,
    OTP_MAIL_LOCAL_PATH,
};
