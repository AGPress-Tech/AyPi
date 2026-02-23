// @ts-nocheck
require("../../../shared/dev-guards");
import path from "path";
import { NETWORK_PATHS } from "../../../../../main/config/paths";

const ROOT_DIR = path.dirname(NETWORK_PATHS.feriePermessiData);
const LEGACY_BASE_DIR = path.join(ROOT_DIR, "Product Manager");
const PURCHASING_DIR = path.join(ROOT_DIR, "AyPi Purchasing");
const BASE_DIR = PURCHASING_DIR;

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
const LEGACY_PRODUCTS_DIR = path.join(LEGACY_BASE_DIR, "products");
const LEGACY_PRODUCTS_DIR_ALT = path.join(LEGACY_BASE_DIR, "Products");
const REQUESTS_SHARDS_DIR = path.join(PURCHASING_DIR, "requests");
const INTERVENTIONS_SHARDS_DIR = path.join(PURCHASING_DIR, "interventions");

const LEGACY_REQUESTS_PATH = path.join(LEGACY_BASE_DIR, "requests.json");
const LEGACY_INTERVENTIONS_PATH = path.join(
    LEGACY_BASE_DIR,
    "interventions.json",
);
const LEGACY_CATALOG_PATH = path.join(LEGACY_BASE_DIR, "catalog.json");
const LEGACY_CATEGORIES_PATH = path.join(LEGACY_BASE_DIR, "categories.json");
const LEGACY_INTERVENTION_TYPES_PATH = path.join(
    LEGACY_BASE_DIR,
    "intervention-types.json",
);
const LEGACY_UNITS_PATH = path.join(LEGACY_BASE_DIR, "units.json");
const LEGACY_SETTINGS_PATH = path.join(LEGACY_BASE_DIR, "settings.json");
const LEGACY_SESSION_PATH = path.join(LEGACY_BASE_DIR, "session.json");

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    ROOT_DIR,
    BASE_DIR,
    LEGACY_BASE_DIR,
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
    LEGACY_PRODUCTS_DIR,
    LEGACY_PRODUCTS_DIR_ALT,
    REQUESTS_SHARDS_DIR,
    INTERVENTIONS_SHARDS_DIR,
    LEGACY_REQUESTS_PATH,
    LEGACY_INTERVENTIONS_PATH,
    LEGACY_CATALOG_PATH,
    LEGACY_CATEGORIES_PATH,
    LEGACY_INTERVENTION_TYPES_PATH,
    LEGACY_UNITS_PATH,
    LEGACY_SETTINGS_PATH,
    LEGACY_SESSION_PATH,
};


