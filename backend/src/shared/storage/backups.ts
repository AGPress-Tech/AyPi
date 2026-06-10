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
};

type CreateDailyDirectoryBackupOptions = CreateDirectoryBackupOptions;

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

export function listBackups(backupRootDir: string) {
    if (!fs.existsSync(backupRootDir)) return [];
    return fs
        .readdirSync(backupRootDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
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
            };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneOldBackups(backupRootDir: string, limit = 30) {
    if (limit <= 0) return;
    listBackups(backupRootDir)
        .slice(limit)
        .forEach((entry) => {
            fs.rmSync(path.join(backupRootDir, entry.name), {
                recursive: true,
                force: true,
            });
        });
}

function allocateBackupDir(backupRootDir: string, prefix: string) {
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
    const limit = Number.isFinite(options.limit) ? Number(options.limit) : 30;
    if (!fs.existsSync(options.sourceDir)) return null;
    const targetDir = allocateBackupDir(options.backupRootDir, options.prefix);
    copyDirectory(options.sourceDir, targetDir, {
        exclude: options.exclude,
    });
    pruneOldBackups(options.backupRootDir, limit);
    return {
        name: path.basename(targetDir),
        path: targetDir,
    };
}

export function createDailyDirectoryBackup(
    options: CreateDailyDirectoryBackupOptions,
) {
    const dayToken = formatBackupDay(new Date());
    const backupPrefix = `${options.prefix}-${dayToken}_`;
    const existing = listBackups(options.backupRootDir).find((entry) =>
        String(entry.name || "").startsWith(backupPrefix),
    );
    if (existing) {
        return {
            name: existing.name,
            path: path.join(options.backupRootDir, existing.name),
            skipped: true,
        };
    }
    return createDirectoryBackup(options);
}

export function createFileBackup(options: CreateFileBackupOptions) {
    const limit = Number.isFinite(options.limit) ? Number(options.limit) : 30;
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
    return path.join(backupRootDir, String(name || "").trim());
}
