import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
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

export function ensureAgpressDailyBackup(prefix = "auto", limit = 30) {
    return createDailyDirectoryBackup({
        sourceDir: AGPRESS_ROOT_DIR,
        backupRootDir: AGPRESS_BACKUP_ROOT_DIR,
        prefix,
        limit,
    });
}

export function createAgpressBackup(prefix = "manual", limit = 30) {
    return createDirectoryBackup({
        sourceDir: AGPRESS_ROOT_DIR,
        backupRootDir: AGPRESS_BACKUP_ROOT_DIR,
        prefix,
        limit,
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
