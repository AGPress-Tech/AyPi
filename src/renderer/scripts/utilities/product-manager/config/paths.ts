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

const ROOT_DIR = resolveBaseDir();
const BASE_DIR = ROOT_DIR;
const PURCHASING_DIR = path.join(BASE_DIR, "AyPi Purchasing");

const REQUESTS_PATH = path.join(PURCHASING_DIR, "requests.json");
const INTERVENTIONS_PATH = path.join(PURCHASING_DIR, "interventions.json");
const CATALOG_PATH = path.join(PURCHASING_DIR, "catalog.json");
const CATEGORIES_PATH = path.join(PURCHASING_DIR, "categories.json");
const INTERVENTION_TYPES_PATH = path.join(
    PURCHASING_DIR,
    "intervention-types.json",
);
const UNITS_PATH = path.join(PURCHASING_DIR, "units.json");
const SETTINGS_PATH = path.join(PURCHASING_DIR, "settings.json");
const SESSION_PATH = path.join(PURCHASING_DIR, "session.json");
const PRODUCTS_DIR = path.join(PURCHASING_DIR, "products");
const REQUESTS_SHARDS_DIR = path.join(PURCHASING_DIR, "requests");
const INTERVENTIONS_SHARDS_DIR = path.join(PURCHASING_DIR, "interventions");

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    ROOT_DIR,
    BASE_DIR,
    PURCHASING_DIR,
    REQUESTS_PATH,
    INTERVENTIONS_PATH,
    CATALOG_PATH,
    CATEGORIES_PATH,
    INTERVENTION_TYPES_PATH,
    UNITS_PATH,
    SETTINGS_PATH,
    SESSION_PATH,
    PRODUCTS_DIR,
    REQUESTS_SHARDS_DIR,
    INTERVENTIONS_SHARDS_DIR,
};


