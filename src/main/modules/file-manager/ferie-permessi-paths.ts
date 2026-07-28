import fs from "fs";
import log from "electron-log";

const FP_DESKTOP_BASE_DIR = "C:\\Users\\admin\\Desktop\\AyPi\\AGPRESS";
const FP_SERVER_BASE_DIR = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS";

function getDefaultFpBaseDir() {
    const fallback =
        process.env.AYPI_DEV === "1"
            ? FP_DESKTOP_BASE_DIR
            : FP_SERVER_BASE_DIR;
    log.info("[ferie-permessi] base dir di default:", fallback);
    return fallback;
}

export function resolveFpBaseDir() {
    const baseDir = getDefaultFpBaseDir();
    if (fs.existsSync(baseDir)) {
        log.info("[ferie-permessi] base dir risolta:", baseDir);
        return baseDir;
    }
    log.warn("[ferie-permessi] base dir non disponibile, uso il default");
    return getDefaultFpBaseDir();
}
