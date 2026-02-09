const path = require("path");

const BASE_DIR = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\Product Manager";

const REQUESTS_PATH = path.join(BASE_DIR, "requests.json");
const CATALOG_PATH = path.join(BASE_DIR, "catalog.json");
const CATEGORIES_PATH = path.join(BASE_DIR, "categories.json");
const UNITS_PATH = path.join(BASE_DIR, "units.json");
const SETTINGS_PATH = path.join(BASE_DIR, "settings.json");

module.exports = {
    BASE_DIR,
    REQUESTS_PATH,
    CATALOG_PATH,
    CATEGORIES_PATH,
    UNITS_PATH,
    SETTINGS_PATH,
};
