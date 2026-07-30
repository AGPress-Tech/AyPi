import fs from "fs";
import path from "path";
import crypto from "crypto";

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

function isRetryableFileError(error: unknown) {
    const code = String((error as NodeJS.ErrnoException)?.code || "");
    return ["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"].includes(code);
}

function waitSync(milliseconds: number) {
    if (milliseconds <= 0) return;
    const signal = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(signal, 0, 0, milliseconds);
}

export function replaceFileAtomic(
    filePath: string,
    value: string | NodeJS.ArrayBufferView,
) {
    ensureFolderFor(filePath);
    const tempPath =
        `${filePath}.${process.pid}.${Date.now()}.` +
        `${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tempPath, value);
    let lastError: unknown = null;
    try {
        for (const delay of [0, 20, 60, 140, 300]) {
            waitSync(delay);
            try {
                fs.renameSync(tempPath, filePath);
                return;
            } catch (error) {
                lastError = error;
                if (!isRetryableFileError(error)) throw error;
            }

            // Windows can temporarily deny replacing an existing destination
            // even though writing to it is allowed. copyFile keeps the old
            // file in place until the new bytes are available and avoids the
            // remove-then-rename data-loss window.
            try {
                fs.copyFileSync(tempPath, filePath);
                fs.unlinkSync(tempPath);
                return;
            } catch (error) {
                lastError = error;
                if (!isRetryableFileError(error)) throw error;
            }
        }

        // Last-resort write for file scanners that keep blocking rename/copy.
        // The in-memory SQLite/JSON state remains authoritative, so a later
        // transaction will retry persistence if this also fails.
        try {
            fs.writeFileSync(filePath, value);
            fs.unlinkSync(tempPath);
            return;
        } catch (error) {
            lastError = error;
        }
        throw lastError;
    } finally {
        try {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        } catch {
            // A stale uniquely named temp is harmless and ignored by Git.
        }
    }
}

export function writeJsonFileAtomic(filePath: string, value: unknown) {
    replaceFileAtomic(filePath, JSON.stringify(value, null, 2));
}
