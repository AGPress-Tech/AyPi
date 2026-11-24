import fs from "fs";
import path from "path";

type CopyDirectoryOptions = {
    exclude?: (name: string, fullPath: string) => boolean;
};

type CreateDirectoryBackupOptions = {
    sourceDir: string;
    backupRootDir: string;
    prefix: string;
    limit?: number;
    exclude?: (name: string, fullPath: string) => boolean;
    prepare?: (targetDir: string) => void;
    protected?: boolean;
};

type CreateDailyDirectoryBackupOptions = CreateDirectoryBackupOptions & {
    earliestHour?: number;
};

type CreateFileBackupOptions = {
    sourceFile: string;
    backupRootDir: string;
    prefix: string;
    limit?: number;
    backupFileName?: string;
};

export function ensureDir(dirPath: string) {
    fs.mkdirSync(dirPath, { recursive: true });
}

export function copyDirectory(
    sourceDir: string,
    targetDir: string,
    options: CopyDirectoryOptions = {},
) {
    ensureDir(targetDir);
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    entries.forEach((entry) => {
        const srcPath = path.join(sourceDir, entry.name);
        const dstPath = path.join(targetDir, entry.name);
        if (options.exclude?.(entry.name, srcPath)) return;
        if (entry.isSymbolicLink())
            throw Error("Collegamenti non consentiti nelle copie di backup.");
        if (entry.isDirectory()) {
            copyDirectory(srcPath, dstPath, options);
            return;
        }
        if (entry.isFile()) {
            ensureDir(path.dirname(dstPath));
            fs.copyFileSync(srcPath, dstPath);
        }
    });
}

export function replaceDirectoryContents(sourceDir: string, targetDir: string) {
    ensureDir(targetDir);
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    entries.forEach((entry) => {
        fs.rmSync(path.join(targetDir, entry.name), {
            recursive: true,
            force: true,
        });
    });
    copyDirectory(sourceDir, targetDir);
}

function formatBackupTimestamp(date: Date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

function formatBackupDay(date: Date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

export const ORDINARY_BACKUP_LIMIT = 3;
export const PROTECTED_BACKUP_MARKER = "AYPI_BACKUP_PROTECTED.json";
export function isProtectedBackup(root: string, name: string) {
    return (
        /^(?:safety-|protected-|pre-restore-)/i.test(name) ||
        fs.existsSync(
            path.join(resolveBackupDir(root, name), PROTECTED_BACKUP_MARKER),
        )
    );
}
export function listBackups(backupRootDir: string) {
    if (!fs.existsSync(backupRootDir)) return [];
    return fs
        .readdirSync(backupRootDir, { withFileTypes: true })
        .filter(
            (entry) =>
                entry.isDirectory() &&
                !entry.isSymbolicLink() &&
                !entry.name.startsWith(".pending-") &&
                !fs.existsSync(
                    path.join(backupRootDir, entry.name, ".incomplete"),
                ),
        )
        .map((entry) => {
            const fullPath = path.join(backupRootDir, entry.name);
            let mtimeMs = 0;
            try {
                mtimeMs = fs.statSync(fullPath).mtimeMs || 0;
            } catch {
                mtimeMs = 0;
            }
            return {
                name: entry.name,
                mtimeMs,
                protected: isProtectedBackup(backupRootDir, entry.name),
            };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function pruneOldBackups(
    backupRootDir: string,
    _limit = ORDINARY_BACKUP_LIMIT,
) {
    listBackups(backupRootDir)
        .filter(
            (entry) => !entry.protected && /^(?:auto|manual)-/.test(entry.name),
        )
        .slice(ORDINARY_BACKUP_LIMIT)
        .forEach((entry) => {
            fs.rmSync(resolveBackupDir(backupRootDir, entry.name), {
                recursive: true,
                force: true,
            });
        });
}

function allocateBackupDir(backupRootDir: string, prefix: string) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(prefix))
        throw Error("Prefisso backup non valido.");
    ensureDir(backupRootDir);
    const stamp = formatBackupTimestamp(new Date());
    let targetDir = path.join(backupRootDir, `${prefix}-${stamp}`);
    let suffix = 1;
    while (fs.existsSync(targetDir)) {
        suffix += 1;
        targetDir = path.join(backupRootDir, `${prefix}-${stamp}-${suffix}`);
    }
    ensureDir(targetDir);
    return targetDir;
}

export function createDirectoryBackup(options: CreateDirectoryBackupOptions) {
    const limit = ORDINARY_BACKUP_LIMIT;
    if (!fs.existsSync(options.sourceDir)) return null;
    if (
        path.resolve(options.backupRootDir) ===
            path.resolve(options.sourceDir) ||
        path
            .resolve(options.backupRootDir)
            .startsWith(path.resolve(options.sourceDir) + path.sep)
    )
        throw Error(
            "La cartella backup deve essere esterna ai dati da copiare.",
        );
    const targetDir = allocateBackupDir(options.backupRootDir, options.prefix);
    if (options.protected)
        fs.writeFileSync(
            path.join(targetDir, PROTECTED_BACKUP_MARKER),
            JSON.stringify({
                protected: true,
                createdAt: new Date().toISOString(),
                retention: "manual-only",
            }),
        );
    // Incomplete copies cannot be offered as a successful backup.
    fs.writeFileSync(path.join(targetDir, ".incomplete"), "Backup in corso");
    try {
        copyDirectory(options.sourceDir, targetDir, {
            exclude: options.exclude,
        });
        options.prepare?.(targetDir);
        fs.unlinkSync(path.join(targetDir, ".incomplete"));
    } catch (error) {
        // A failed ordinary copy is not a backup. Protected partial copies stay
        // on the server for manual inspection and are never removed here.
        if (!options.protected) {
            try {
                fs.rmSync(targetDir, { recursive: true, force: true });
            } catch {}
        }
        throw error;
    }
    if (!options.protected) pruneOldBackups(options.backupRootDir, limit);
    return {
        name: path.basename(targetDir),
        path: targetDir,
    };
}

export function createDailyDirectoryBackup(
    options: CreateDailyDirectoryBackupOptions,
) {
    const now = new Date();
    const earliestHour = Number.isFinite(options.earliestHour)
        ? Number(options.earliestHour)
        : 0;
    if (now.getHours() < earliestHour) {
        return {
            skipped: true,
            reason: "before-earliest-hour",
        };
    }
    const dayToken = formatBackupDay(now);
    const backupPrefix = `${options.prefix}-${dayToken}_`;
    const existing = listBackups(options.backupRootDir).find((entry) =>
        String(entry.name || "").startsWith(backupPrefix),
    );
    if (existing) {
        pruneOldBackups(options.backupRootDir);
        return {
            name: existing.name,
            path: path.join(options.backupRootDir, existing.name),
            skipped: true,
        };
    }
    return createDirectoryBackup(options);
}

export function createFileBackup(options: CreateFileBackupOptions) {
    const limit = ORDINARY_BACKUP_LIMIT;
    if (!fs.existsSync(options.sourceFile)) return null;
    const targetDir = allocateBackupDir(options.backupRootDir, options.prefix);
    const fileName =
        options.backupFileName || path.basename(options.sourceFile);
    const targetFile = path.join(targetDir, fileName);
    ensureDir(path.dirname(targetFile));
    fs.copyFileSync(options.sourceFile, targetFile);
    pruneOldBackups(options.backupRootDir, limit);
    return {
        name: path.basename(targetDir),
        path: targetDir,
    };
}

export function resolveBackupDir(backupRootDir: string, name: string) {
    const value = String(name || "");
    if (
        !value ||
        value !== value.trim() ||
        value === "." ||
        value === ".." ||
        /[\\/:\x00]/.test(value)
    )
        throw Error("Nome backup non valido.");
    const root = path.resolve(backupRootDir),
        resolved = path.resolve(root, value);
    if (path.dirname(resolved) !== root)
        throw Error("Backup fuori dalla cartella prevista.");
    if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink())
        throw Error("Collegamento backup non consentito.");
    return resolved;
}
