import fs from "fs";
import os from "os";
import path from "path";
import { logger } from "../../shared/logging/logger";

type TelegramBotModule = {
    startTelegramBot: () => Promise<unknown>;
    stopTelegramBot: (reason?: string) => Promise<void>;
    getTelegramBotStatus?: () => {
        enabled?: boolean;
        running?: boolean;
    };
};

export type TelegramBotServiceStatus = {
    configured: boolean;
    running: boolean;
    error: string;
    envLoaded: boolean;
};

let botModule: TelegramBotModule | null = null;
let starting: Promise<void> | null = null;
let loadedEnvFile = "";
let lastError = "";

function parseEnvLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return null;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return null;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))
    ) {
        value = value.slice(1, -1);
    }
    return key ? { key, value } : null;
}

function getEnvCandidates() {
    const resourcesPath = String(
        (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || "",
    );
    return [
        process.env.AYPI_BOT_ENV || "",
        "C:\\Users\\Administrator\\Desktop\\AyPi\\.env",
        path.join(path.dirname(process.execPath), ".env"),
        path.join(process.cwd(), ".env"),
        resourcesPath ? path.join(resourcesPath, ".env") : "",
        path.join(os.homedir(), "Documents", "AyPiBotTG", ".env"),
        path.resolve(process.cwd(), "..", "AyPiBotTG", ".env"),
        path.join(path.dirname(process.execPath), "AyPiBotTG", ".env"),
    ].filter(Boolean);
}

function loadBotEnvironment() {
    for (const candidate of getEnvCandidates()) {
        try {
            if (!fs.existsSync(candidate)) continue;
            const raw = fs.readFileSync(candidate, "utf8");
            raw.split(/\r?\n/).forEach((line) => {
                const entry = parseEnvLine(line);
                if (!entry || process.env[entry.key] !== undefined) return;
                process.env[entry.key] = entry.value;
            });
            loadedEnvFile = candidate;
            return candidate;
        } catch (error) {
            logger.warn("Telegram bot env load failed", {
                event: "telegram_bot_env_failed",
                category: "telegram",
                module: "telegram-bot",
                filePath: candidate,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return "";
}

function resolveBotEntry() {
    const candidates = [
        path.resolve(__dirname, "../../../bot-backend/src/index.js"),
        path.resolve(process.cwd(), "bot-backend/src/index.js"),
    ];
    const entry = candidates.find((candidate) => fs.existsSync(candidate));
    if (!entry) {
        throw new Error(`Telegram bot entry non trovato (${candidates.join(" | ")})`);
    }
    return entry;
}

function loadBotModule() {
    if (botModule) return botModule;
    const entry = resolveBotEntry();
    const loaded = require(entry) as TelegramBotModule;
    if (
        !loaded ||
        typeof loaded.startTelegramBot !== "function" ||
        typeof loaded.stopTelegramBot !== "function"
    ) {
        throw new Error("Modulo Telegram bot non valido");
    }
    botModule = loaded;
    return botModule;
}

export function getTelegramBotServiceStatus(): TelegramBotServiceStatus {
    const moduleStatus = botModule?.getTelegramBotStatus?.();
    return {
        configured: !!String(process.env.BOT_TOKEN || "").trim(),
        running: !!moduleStatus?.running,
        error: lastError,
        envLoaded: !!loadedEnvFile,
    };
}

export function startTelegramBotService() {
    if (starting) return starting;
    starting = (async () => {
        loadBotEnvironment();
        if (!String(process.env.BOT_TOKEN || "").trim()) {
            lastError = "";
            logger.info("Telegram bot disabled: BOT_TOKEN not configured", {
                event: "telegram_bot_disabled",
                category: "telegram",
                module: "telegram-bot",
                envFile: loadedEnvFile,
            });
            return;
        }
        try {
            const runtime = loadBotModule();
            await runtime.startTelegramBot();
            lastError = "";
            logger.info("Telegram bot started", {
                event: "telegram_bot_started",
                category: "telegram",
                module: "telegram-bot",
                envFile: loadedEnvFile,
            });
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            logger.error("Telegram bot start failed", {
                event: "telegram_bot_start_failed",
                category: "telegram",
                module: "telegram-bot",
                envFile: loadedEnvFile,
                detail: lastError,
            });
            throw error;
        } finally {
            starting = null;
        }
    })();
    return starting;
}

export async function stopTelegramBotService() {
    if (starting) {
        await starting.catch(() => {});
    }
    if (!botModule) return;
    try {
        await botModule.stopTelegramBot("AyPi Backend shutdown");
        logger.info("Telegram bot stopped", {
            event: "telegram_bot_stopped",
            category: "telegram",
            module: "telegram-bot",
        });
    } catch (error) {
        logger.warn("Telegram bot stop failed", {
            event: "telegram_bot_stop_failed",
            category: "telegram",
            module: "telegram-bot",
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}
