import fs from "fs";
import path from "path";
import { logger } from "../logging/logger";

export function ensureFolderFor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
    try {
        if (!fs.existsSync(filePath)) return fallback;
        const raw = fs.readFileSync(filePath, "utf8").trim();
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        return fallback;
    }
}

export function writeJsonFileAtomic(filePath: string, value: unknown) {
    ensureFolderFor(filePath);
    const tempPath = `${filePath}.tmp`;
    logger.info("File write", {
        event: "file_write",
        category: "storage",
        filePath,
    });
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tempPath, filePath);
}
