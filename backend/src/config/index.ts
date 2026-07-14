import path from "path";

const DEV_BASE_DIR = "C:\\Users\\admin\\Desktop\\AyPi\\AGPRESS";
const SERVER_GENERAL_DIR = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General";

function getEnvNumber(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function getEnvString(name: string, fallback: string) {
    const value = process.env[name];
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

const isDevProfile = (process.env.AYPI_BACKEND_PROFILE || "").trim() === "dev";
const defaultHost = isDevProfile ? "127.0.0.1" : "192.168.1.240";
const defaultGeneralDir = isDevProfile
    ? path.join(DEV_BASE_DIR, "General")
    : SERVER_GENERAL_DIR;
const feriePermessiGeneralDir = getEnvString(
    "AYPI_FP_GENERAL_DIR",
    defaultGeneralDir,
);
const feriePermessiBaseDir = path.dirname(feriePermessiGeneralDir);
const purchasingDir = getEnvString(
    "AYPI_PM_DIR",
    path.join(feriePermessiBaseDir, "AyPi Purchasing"),
);
const ticketDir = getEnvString(
    "AYPI_TS_DIR",
    path.join(feriePermessiBaseDir, "AyPi Ticket"),
);
const transferAttrezzaggioDir = getEnvString(
    "AYPI_TRANSFER_DIR",
    path.join(feriePermessiBaseDir, "Schede Attrezzaggio", "Transfer"),
);
const haasAttrezzaggioDir = getEnvString(
    "AYPI_HAAS_DIR",
    path.join(feriePermessiBaseDir, "Schede Attrezzaggio", "HAAS"),
);
const backendLogDir = getEnvString(
    "AYPI_LOG_DIR",
    path.join(feriePermessiGeneralDir, "log"),
);
const databasePath = getEnvString(
    "AYPI_DB_PATH",
    path.join(feriePermessiGeneralDir, "data", "aypi.db"),
);

export const backendConfig = {
    profile: isDevProfile ? "dev" : "server",
    host: getEnvString("AYPI_BACKEND_HOST", defaultHost),
    port: getEnvNumber("AYPI_BACKEND_PORT", 3000),
    advertisedHost: getEnvString(
        "AYPI_BACKEND_ADVERTISED_HOST",
        getEnvString("AYPI_BACKEND_HOST", defaultHost),
    ),
    logging: {
        dir: backendLogDir,
    },
    database: {
        path: databasePath,
    },
    modules: {
        feriePermessi: {
            baseDir: feriePermessiBaseDir,
            generalDir: feriePermessiGeneralDir,
        },
        productManager: {
            dir: purchasingDir,
        },
        ticketSupport: {
            dir: ticketDir,
        },
        transferAttrezzaggio: {
            dir: transferAttrezzaggioDir,
        },
        haasAttrezzaggio: {
            dir: haasAttrezzaggioDir,
        },
    },
};
