import fs from "fs";
import os from "os";
import path from "path";

export type BackendRuntimeConfig = {
    host: string;
    advertisedHost: string;
    port: number;
    calendarDir: string;
    generalDir: string;
    logDir: string;
};

const IS_DEV_PROFILE = (process.env.AYPI_BACKEND_PROFILE || "").trim() === "dev";
const DEFAULT_CONFIG: BackendRuntimeConfig = IS_DEV_PROFILE
    ? {
          host: "127.0.0.1",
          advertisedHost: "127.0.0.1",
          port: 3000,
          calendarDir: "C:\\Users\\admin\\Desktop\\AyPi\\AGPRESS\\AyPi Calendar",
          generalDir: "C:\\Users\\admin\\Desktop\\AyPi\\AGPRESS\\General",
          logDir: "C:\\Users\\admin\\Desktop\\AyPi\\AGPRESS\\General\\log",
      }
    : {
          host: "192.168.1.240",
          advertisedHost: "192.168.1.240",
          port: 3000,
          calendarDir: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\AyPi Calendar",
          generalDir: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General",
          logDir: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\log",
      };

function normalizeLegacyLogDir(logDir: string, generalDir: string, calendarDir: string) {
    const normalizedLogDir = String(logDir || "").trim().toLowerCase();
    const legacyCalendarLogDir = path.join(calendarDir, "log").trim().toLowerCase();
    if (normalizedLogDir === legacyCalendarLogDir) {
        return path.join(generalDir, "log");
    }
    return logDir;
}

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

export function loadBackendRuntimeConfig() {
    const loaded = loadConfigFile();
    const payload = loaded.payload || {};
    const calendarDir = getString(
        process.env.AYPI_FP_CALENDAR_DIR,
        getString(payload.calendarDir, DEFAULT_CONFIG.calendarDir),
    );
    const generalDir = getString(
        process.env.AYPI_FP_GENERAL_DIR,
        getString(payload.generalDir, DEFAULT_CONFIG.generalDir),
    );
    const rawLogDir = getString(
        process.env.AYPI_LOG_DIR,
        getString(payload.logDir, DEFAULT_CONFIG.logDir),
    );
    const config: BackendRuntimeConfig = {
        host: getString(process.env.AYPI_BACKEND_HOST, getString(payload.host, DEFAULT_CONFIG.host)),
        advertisedHost: getString(
            process.env.AYPI_BACKEND_ADVERTISED_HOST,
            getString(payload.advertisedHost, DEFAULT_CONFIG.advertisedHost),
        ),
        port: getNumber(process.env.AYPI_BACKEND_PORT, getNumber(payload.port, DEFAULT_CONFIG.port)),
        calendarDir,
        generalDir,
        logDir: normalizeLegacyLogDir(
            rawLogDir,
            generalDir,
            calendarDir,
        ),
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
        const parsed = parseConfigFile(configPath);
        if (!parsed) return;
        const calendarDir = getString(parsed.calendarDir, DEFAULT_CONFIG.calendarDir);
        const generalDir = getString(parsed.generalDir, DEFAULT_CONFIG.generalDir);
        const nextLogDir = normalizeLegacyLogDir(
            getString(parsed.logDir, DEFAULT_CONFIG.logDir),
            generalDir,
            calendarDir,
        );
        if (nextLogDir === parsed.logDir) return;
        fs.writeFileSync(
            configPath,
            JSON.stringify(
                {
                    ...parsed,
                    logDir: nextLogDir,
                },
                null,
                2,
            ),
            "utf8",
        );
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
