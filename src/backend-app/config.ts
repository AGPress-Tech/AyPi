import fs from "fs";
import os from "os";
import path from "path";

export type BackendRuntimeConfig = {
    host: string;
    advertisedHost: string;
    port: number;
    generalDir: string;
    logDir: string;
    mesDatabasePath: string;
    forno: { enabled: boolean; autoStart?: boolean; dbPath: string; host: string; intervalMs: number };
    mobileGateway: {
        enabled: boolean;
        host: string;
        port: number;
        sessionDays: number;
    };
};

const DEFAULT_FORNO = {
    enabled: true,
    autoStart: true,
    dbPath: '',
    host: '192.168.1.165',
    intervalMs: 500,
};

const IS_DEV_PROFILE = (process.env.AYPI_BACKEND_PROFILE || "").trim() === "dev";
const DEFAULT_CONFIG: BackendRuntimeConfig = IS_DEV_PROFILE
    ? {
          host: "127.0.0.1",
          advertisedHost: "127.0.0.1",
          port: 3000,
          generalDir: "C:\\Users\\admin\\Desktop\\AyPi\\AGPRESS\\General",
          logDir: "C:\\Users\\admin\\Desktop\\AyPi\\AGPRESS\\General\\log",
          mesDatabasePath: "C:\\Users\\admin\\Desktop\\AyPi\\AGPRESS\\General\\data\\mes.db",
          forno: { ...DEFAULT_FORNO, enabled: false, autoStart: false, dbPath: 'C:\\Users\\admin\\Desktop\\AyPi\\AGPRESS\\General\\data\\forno.db' },
          mobileGateway: {
              enabled: true,
              host: "127.0.0.1",
              port: 3010,
              sessionDays: 7,
          },
      }
    : {
          host: "192.168.1.240",
          advertisedHost: "192.168.1.240",
          port: 3000,
          generalDir: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General",
          logDir: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\log",
          mesDatabasePath: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\mes.db",
          forno: { ...DEFAULT_FORNO, dbPath: '\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\forno.db' },
          mobileGateway: {
              enabled: true,
              host: "127.0.0.1",
              port: 3010,
              sessionDays: 7,
          },
      };

function getConfigCandidates() {
    const execDir = path.dirname(process.execPath);
    return [
        process.env.AYPI_BACKEND_CONFIG || "",
        path.join(process.cwd(), "aypi-backend.runtime.json"),
        path.join(execDir, "aypi-backend.runtime.json"),
    ].filter(Boolean);
}

function parseConfigFile(filePath: string) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function loadConfigFile() {
    const candidates = getConfigCandidates();
    for (const candidate of getConfigCandidates()) {
        const parsed = parseConfigFile(candidate);
        if (parsed) {
            return {
                filePath: candidate,
                payload: parsed as Record<string, unknown>,
            };
        }
    }
    return {
        filePath:
            candidates[2] ||
            candidates[1] ||
            path.join(process.cwd(), "aypi-backend.runtime.json"),
        payload: null as Record<string, unknown> | null,
    };
}

function getString(value: unknown, fallback: string) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getNumber(value: unknown, fallback: number) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function getBoolean(value: unknown, fallback: boolean) {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string" || !value.trim()) return fallback;
    return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function loadBackendRuntimeConfig() {
    const loaded = loadConfigFile();
    const payload = loaded.payload || {};
    const generalDir = getString(
        process.env.AYPI_FP_GENERAL_DIR,
        getString(payload.generalDir, DEFAULT_CONFIG.generalDir),
    );
    const rawLogDir = getString(
        process.env.AYPI_LOG_DIR,
        getString(payload.logDir, DEFAULT_CONFIG.logDir),
    );
    const mobilePayload =
        payload.mobileGateway && typeof payload.mobileGateway === "object"
            ? (payload.mobileGateway as Record<string, unknown>)
            : {};
    const fornoPayload = payload.forno && typeof payload.forno === 'object' ? payload.forno as Record<string, unknown> : {};
    const config: BackendRuntimeConfig = {
        host: getString(process.env.AYPI_BACKEND_HOST, getString(payload.host, DEFAULT_CONFIG.host)),
        advertisedHost: getString(
            process.env.AYPI_BACKEND_ADVERTISED_HOST,
            getString(payload.advertisedHost, DEFAULT_CONFIG.advertisedHost),
        ),
        port: getNumber(process.env.AYPI_BACKEND_PORT, getNumber(payload.port, DEFAULT_CONFIG.port)),
        generalDir,
        logDir: rawLogDir,
        mesDatabasePath: getString(
            process.env.AYPI_MES_DB_PATH,
            getString(payload.mesDatabasePath, path.join(generalDir, "data", "mes.db")),
        ),
        forno: {
            // Le vecchie installazioni salvavano enabled:false per default.
            // L'avvio automatico sostituisce quel flag; autoStart:false resta
            // un arresto esplicito e il profilo dev non interroga il forno.
            enabled: getBoolean(process.env.AYPI_FORNO_ENABLED, getBoolean(fornoPayload.autoStart, DEFAULT_CONFIG.forno.autoStart!)),
            autoStart: getBoolean(fornoPayload.autoStart, DEFAULT_CONFIG.forno.autoStart!),
            dbPath: getString(process.env.AYPI_FORNO_DB_PATH, getString(fornoPayload.dbPath, path.join(path.dirname(getString(process.env.AYPI_DB_PATH, path.join(generalDir, 'data', 'aypi.db'))), 'forno.db'))),
            host: getString(process.env.AYPI_FORNO_HOST, getString(fornoPayload.host, DEFAULT_FORNO.host)),
            intervalMs: getNumber(process.env.AYPI_FORNO_INTERVAL_MS, getNumber(fornoPayload.intervalMs, 500)),
        },
        mobileGateway: {
            enabled: getBoolean(
                process.env.AYPI_MOBILE_GATEWAY_ENABLED,
                getBoolean(
                    mobilePayload.enabled,
                    DEFAULT_CONFIG.mobileGateway.enabled,
                ),
            ),
            host: getString(
                process.env.AYPI_MOBILE_GATEWAY_HOST,
                getString(
                    mobilePayload.host,
                    DEFAULT_CONFIG.mobileGateway.host,
                ),
            ),
            port: getNumber(
                process.env.AYPI_MOBILE_GATEWAY_PORT,
                getNumber(
                    mobilePayload.port,
                    DEFAULT_CONFIG.mobileGateway.port,
                ),
            ),
            sessionDays: Math.max(
                1,
                Math.min(
                    30,
                    getNumber(
                        process.env.AYPI_MOBILE_SESSION_DAYS,
                        getNumber(
                            mobilePayload.sessionDays,
                            DEFAULT_CONFIG.mobileGateway.sessionDays,
                        ),
                    ),
                ),
            ),
        },
    };

    return {
        config,
        configPath: loaded.filePath,
        hasExternalConfig: !!loaded.payload,
    };
}

export function ensureBackendRuntimeConfigFile(configPath: string) {
    try {
        if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf8");
            return;
        }
    } catch {
        // ignore bootstrap config write failures
    }
}

export function getMachineSummary() {
    return {
        hostName: os.hostname(),
        platform: process.platform,
        pid: process.pid,
    };
}
