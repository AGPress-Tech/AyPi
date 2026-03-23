// @ts-nocheck
require("../../../shared/dev-guards");
import path from "path";
import { NETWORK_PATHS } from "../../../../../main/config/paths";

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
            // fallback al percorso default
        }
    }
    return DEFAULT_BASE_DIR;
}

const BASE_DIR = resolveBaseDir();
const TICKET_DIR = path.join(BASE_DIR, "AyPi Ticket");
const TICKET_YEARS_DIR = path.join(TICKET_DIR, "Ticket Years");
const DATA_PATH = TICKET_DIR;
const CATEGORIES_PATH = path.join(TICKET_DIR, "ticket-categories.json");

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    BASE_DIR,
    TICKET_DIR,
    TICKET_YEARS_DIR,
    DATA_PATH,
    CATEGORIES_PATH,
};


