import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";

type LogLevel = "INFO" | "WARN" | "ERROR";

type LogPayload = Record<string, unknown> | undefined;

function ensureLogDir() {
    fs.mkdirSync(backendConfig.logging.dir, { recursive: true });
}

function pad(value: number) {
    return String(value).padStart(2, "0");
}

function getDayFileName(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    return `${yyyy}-${mm}-${dd}.log`;
}

function serialize(payload?: LogPayload) {
    if (!payload || !Object.keys(payload).length) return "";
    try {
        return ` ${JSON.stringify(payload)}`;
    } catch {
        return ` ${String(payload)}`;
    }
}

function write(level: LogLevel, message: string, payload?: LogPayload) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}${serialize(payload)}`;
    ensureLogDir();
    fs.appendFileSync(
        path.join(backendConfig.logging.dir, getDayFileName()),
        `${line}\n`,
        "utf8",
    );
    if (level === "ERROR") {
        console.error(line);
    } else if (level === "WARN") {
        console.warn(line);
    } else {
        console.log(line);
    }
}

export const logger = {
    info(message: string, payload?: LogPayload) {
        write("INFO", message, payload);
    },
    warn(message: string, payload?: LogPayload) {
        write("WARN", message, payload);
    },
    error(message: string, payload?: LogPayload) {
        write("ERROR", message, payload);
    },
};
