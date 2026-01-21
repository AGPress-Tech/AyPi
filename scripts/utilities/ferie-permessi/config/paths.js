const path = require("path");

const DATA_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\ferie-permessi.json";
const ASSIGNEES_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-assignees.json";
const ADMINS_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\ferie-permessi-admins.json";
const OTP_MAIL_SERVER_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\otp-mail.json";
const OTP_MAIL_LOCAL_PATH = path.join(__dirname, "..", "..", "..", "..", "config", "otp-mail.json");

module.exports = {
    DATA_PATH,
    ASSIGNEES_PATH,
    ADMINS_PATH,
    OTP_MAIL_SERVER_PATH,
    OTP_MAIL_LOCAL_PATH,
};
