const path = require("path");

const BASE_DIR = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\Product Manager";

const REQUESTS_PATH = path.join(BASE_DIR, "requests.json");
const INTERVENTIONS_PATH = path.join(BASE_DIR, "interventions.json");
const CATALOG_PATH = path.join(BASE_DIR, "catalog.json");
const CATEGORIES_PATH = path.join(BASE_DIR, "categories.json");
const INTERVENTION_TYPES_PATH = path.join(BASE_DIR, "intervention-types.json");
const UNITS_PATH = path.join(BASE_DIR, "units.json");
const SETTINGS_PATH = path.join(BASE_DIR, "settings.json");
const SESSION_PATH = path.join(BASE_DIR, "session.json");
const PRODUCTS_DIR = path.join(BASE_DIR, "Products");

module.exports = {
    BASE_DIR,
    REQUESTS_PATH,
    INTERVENTIONS_PATH,
    CATALOG_PATH,
    CATEGORIES_PATH,
    INTERVENTION_TYPES_PATH,
    UNITS_PATH,
    SETTINGS_PATH,
    SESSION_PATH,
    PRODUCTS_DIR,
};
