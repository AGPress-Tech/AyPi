import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
import {
    readJsonFile,
    writeJsonFileAtomic,
} from "../../shared/storage/json-files";
import { logger } from "../../shared/logging/logger";
import {
    createDailyDirectoryBackup,
    createDirectoryBackup,
    listBackups,
    replaceDirectoryContents,
    resolveBackupDir,
} from "../../shared/storage/backups";
import type { FpPayload, RequestLike } from "./types";
import type { AssigneesPayload } from "./types";

const REQUESTS_SHARD_REGEX = /^requests-(\d{4}|undated)\.json$/i;
const FERIE_BACKUP_ROOT_DIR = path.join(
    path.dirname(backendConfig.modules.feriePermessi.baseDir),
    "AyPi Backups",
);

function getPaths() {
    const { calendarDir } = backendConfig.modules.feriePermessi;
    return {
        requestsShardsDir: path.join(calendarDir, "Calendar Years"),
        requestsPath: path.join(calendarDir, "ferie-permessi-requests.json"),
        holidaysPath: path.join(calendarDir, "ferie-permessi-holidays.json"),
        balancesPath: path.join(calendarDir, "ferie-permessi-balances.json"),
        closuresPath: path.join(calendarDir, "ferie-permessi-closures.json"),
        assigneesPath: path.join(
            backendConfig.modules.feriePermessi.generalDir,
            "amministrazione-assignees.json",
        ),
    };
}

function normalizeRequestsData(value: unknown): RequestLike[] {
    if (Array.isArray(value)) return value as RequestLike[];
    if (
        value &&
        typeof value === "object" &&
        "requests" in value &&
        Array.isArray((value as { requests?: unknown }).requests)
    ) {
        return (value as { requests: RequestLike[] }).requests;
    }
    return [];
}

function readRequestsFromShards(directory: string) {
    if (!fs.existsSync(directory)) return null;
    const files = fs
        .readdirSync(directory)
        .filter((name) => REQUESTS_SHARD_REGEX.test(name))
        .sort();
    if (!files.length) return null;

    const requests: RequestLike[] = [];
    for (const name of files) {
        const filePath = path.join(directory, name);
        const rows = normalizeRequestsData(readJsonFile(filePath, []));
        for (const row of rows) requests.push(row);
    }
    return requests;
}

function toShardKey(request: RequestLike) {
    const candidates = [
        request?.start,
        request?.end,
        request?.createdAt,
        request?.updatedAt,
    ];
    for (const value of candidates) {
        if (typeof value !== "string" || !value.trim()) continue;
        const direct = /^(\d{4})/.exec(value.trim());
        if (direct) return direct[1];
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return String(parsed.getFullYear());
    }
    return "undated";
}

function writeRequestsData(requests: RequestLike[]) {
    const { requestsShardsDir } = getPaths();
    const buckets = new Map<string, RequestLike[]>();

    for (const request of requests) {
        const key = toShardKey(request);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)?.push(request);
    }

    fs.mkdirSync(requestsShardsDir, { recursive: true });
    const expected = new Set<string>();

    for (const [key, items] of buckets.entries()) {
        const name = `requests-${key}.json`;
        expected.add(name);
        writeJsonFileAtomic(path.join(requestsShardsDir, name), items);
    }

    if (!fs.existsSync(requestsShardsDir)) return;
    const existing = fs.readdirSync(requestsShardsDir);
    for (const name of existing) {
        if (!REQUESTS_SHARD_REGEX.test(name)) continue;
        if (expected.has(name)) continue;
        const fullPath = path.join(requestsShardsDir, name);
        logger.info("File delete", {
            event: "file_delete",
            category: "storage",
            module: "calendar",
            filePath: fullPath,
        });
        fs.unlinkSync(fullPath);
    }
}

export function loadFpPayload(): FpPayload {
    const paths = getPaths();
    const requests =
        readRequestsFromShards(paths.requestsShardsDir) ||
        normalizeRequestsData(readJsonFile(paths.requestsPath, []));

    return {
        requests,
        balances: readJsonFile(paths.balancesPath, {}),
        holidays: readJsonFile(paths.holidaysPath, []),
        closures: readJsonFile(paths.closuresPath, []),
    };
}

export function saveFpPayload(payload: FpPayload) {
    createDailyDirectoryBackup({
        sourceDir: backendConfig.modules.feriePermessi.calendarDir,
        backupRootDir: FERIE_BACKUP_ROOT_DIR,
        prefix: "auto-calendar",
        limit: 30,
    });
    const paths = getPaths();
    writeRequestsData(payload.requests || []);
    writeJsonFileAtomic(paths.holidaysPath, payload.holidays || []);
    writeJsonFileAtomic(paths.balancesPath, payload.balances || {});
    writeJsonFileAtomic(paths.closuresPath, payload.closures || []);
}

function normalizeAssigneesPayload(parsed: unknown): AssigneesPayload {
    if (Array.isArray(parsed)) {
        const names = parsed.map((name) => String(name));
        return { groups: { Altro: names }, options: names, emails: {} };
    }
    if (parsed && typeof parsed === "object") {
        const rawGroups =
            (parsed as { groups?: unknown }).groups &&
            typeof (parsed as { groups?: unknown }).groups === "object"
                ? (parsed as { groups: Record<string, unknown> }).groups
                : (parsed as Record<string, unknown>);
        const rawEmails =
            (parsed as { emails?: unknown }).emails &&
            typeof (parsed as { emails?: unknown }).emails === "object"
                ? (parsed as { emails: Record<string, unknown> }).emails
                : {};
        const groups: Record<string, string[]> = {};
        const emails: Record<string, string> = {};
        Object.keys(rawGroups).forEach((key) => {
            const values = Array.isArray(rawGroups[key]) ? rawGroups[key] : [];
            groups[key] = values
                .map((entry) =>
                    typeof entry === "string"
                        ? entry.trim()
                        : entry && typeof entry === "object"
                          ? String((entry as { name?: string }).name || "").trim()
                          : "",
                )
                .filter(Boolean);
        });
        Object.keys(rawEmails).forEach((key) => {
            const value = rawEmails[key];
            if (typeof value === "string" && value.trim()) {
                emails[key] = value.trim();
            }
        });
        return { groups, options: Object.values(groups).flat(), emails };
    }
    return { groups: {}, options: [], emails: {} };
}

export function loadAssignees(): AssigneesPayload {
    const paths = getPaths();
    return normalizeAssigneesPayload(readJsonFile(paths.assigneesPath, {}));
}

function shouldExcludeFerieBackupEntry(name: string) {
    return /^backup /i.test(name) || /^aypi backups$/i.test(name);
}

export function listFeriePermessiBackups() {
    return listBackups(FERIE_BACKUP_ROOT_DIR);
}

export function createFeriePermessiBackup(mode: "calendar" | "full" = "full") {
    const isFull = mode === "full";
    return createDirectoryBackup({
        sourceDir: isFull
            ? backendConfig.modules.feriePermessi.baseDir
            : backendConfig.modules.feriePermessi.calendarDir,
        backupRootDir: FERIE_BACKUP_ROOT_DIR,
        prefix: isFull ? "manual-full" : "manual-calendar",
        limit: 30,
        exclude: isFull
            ? (name) => shouldExcludeFerieBackupEntry(name)
            : undefined,
    });
}

export function restoreFeriePermessiBackup(
    name: string,
    mode: "calendar" | "full" = "calendar",
) {
    const sourceDir = resolveBackupDir(FERIE_BACKUP_ROOT_DIR, name);
    if (!fs.existsSync(sourceDir)) {
        throw new Error("Backup not found");
    }
    if (mode === "full") {
        if (!fs.existsSync(path.join(sourceDir, "AyPi Calendar"))) {
            throw new Error("Il backup selezionato non contiene un AGPRESS completo");
        }
        replaceDirectoryContents(
            sourceDir,
            backendConfig.modules.feriePermessi.baseDir,
        );
        return { ok: true, restored: name, mode };
    }
    const calendarBackupDir = fs.existsSync(path.join(sourceDir, "AyPi Calendar"))
        ? path.join(sourceDir, "AyPi Calendar")
        : sourceDir;
    if (!fs.existsSync(calendarBackupDir)) {
        throw new Error("Nel backup selezionato non esiste la cartella 'AyPi Calendar'");
    }
    replaceDirectoryContents(
        calendarBackupDir,
        backendConfig.modules.feriePermessi.calendarDir,
    );
    return { ok: true, restored: name, mode };
}
