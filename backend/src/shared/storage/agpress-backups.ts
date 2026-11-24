import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
import { completeSnapshot } from "./backup-data";
import {
    createDailyDirectoryBackup,
    createDirectoryBackup,
    listBackups,
    resolveBackupDir,
} from "./backups";

const AGPRESS_ROOT_DIR = backendConfig.modules.feriePermessi.baseDir;
const AGPRESS_BACKUP_ROOT_DIR = path.join(
    path.dirname(AGPRESS_ROOT_DIR),
    "AyPi Backups",
);

export function getAgpressRootDir() {
    return AGPRESS_ROOT_DIR;
}

export function getAgpressBackupRootDir() {
    return AGPRESS_BACKUP_ROOT_DIR;
}

function excludeSnapshotFile(name: string, _fullPath: string) {
    return ["log", ".incomplete", "aypi_backup_protected.json", "aypi-backup-manifest.json"].includes(name.toLowerCase()) || name.includes(".before-restore-") || name.includes(".restore-") || /(?:\.(?:db|sqlite3?)(?:-wal|-shm|-journal)?|\.collector\.lock.*)$/i.test(name);
}
export function ensureAgpressDailyBackup(prefix = "auto", limit = 3) {
    return createDailyDirectoryBackup({
        sourceDir: AGPRESS_ROOT_DIR,
        backupRootDir: AGPRESS_BACKUP_ROOT_DIR,
        prefix,
        limit,
        earliestHour: 6,
        exclude: excludeSnapshotFile,
        prepare: target => completeSnapshot(target),
    });
}

export function createAgpressBackup(prefix = "manual", limit = 3, protectedCopy = false) {
    return createDirectoryBackup({
        sourceDir: AGPRESS_ROOT_DIR,
        backupRootDir: AGPRESS_BACKUP_ROOT_DIR,
        prefix,
        limit,
        protected: protectedCopy,
        exclude: excludeSnapshotFile,
        prepare: target => completeSnapshot(target, protectedCopy),
    });
}

export function listAgpressBackups() {
    return listBackups(AGPRESS_BACKUP_ROOT_DIR);
}

export function resolveAgpressBackupDir(name: string) {
    return resolveBackupDir(AGPRESS_BACKUP_ROOT_DIR, name);
}

export function backupContains(relativePath: string, name: string) {
    const backupDir = resolveAgpressBackupDir(name);
    return fs.existsSync(path.join(backupDir, relativePath));
}
