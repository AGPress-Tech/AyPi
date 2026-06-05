import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
import { ensureFolderFor, readJsonFile, writeJsonFileAtomic } from "../../shared/storage/json-files";
import { loadAssigneeOptions } from "../shared/repository";

const PURCHASING_DIR = backendConfig.modules.productManager.dir;
const CATALOG_PATH = path.join(PURCHASING_DIR, "catalog.json");
const CATEGORIES_PATH = path.join(PURCHASING_DIR, "categories.json");
const INTERVENTION_TYPES_PATH = path.join(PURCHASING_DIR, "intervention-types.json");
const PRODUCTS_DIR = path.join(PURCHASING_DIR, "products");
const REQUESTS_SHARDS_DIR = path.join(PURCHASING_DIR, "requests");
const INTERVENTIONS_SHARDS_DIR = path.join(PURCHASING_DIR, "interventions");
const PURCHASING_BACKUP_ROOT_DIR = path.join(
    path.dirname(PURCHASING_DIR),
    "Backup AyPi Purchasing",
);

function ensureProductManagerDir() {
    fs.mkdirSync(PURCHASING_DIR, { recursive: true });
    fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
    fs.mkdirSync(REQUESTS_SHARDS_DIR, { recursive: true });
    fs.mkdirSync(INTERVENTIONS_SHARDS_DIR, { recursive: true });
}

const REQUESTS_SHARD_REGEX = /^requests-(\d{4}|undated)\.json$/i;
const INTERVENTIONS_SHARD_REGEX = /^interventions-(\d{4}|undated)\.json$/i;

function getYearKey(request: any) {
    const value = String(request?.createdAt || request?.updatedAt || "").trim();
    if (!value) return "undated";
    const direct = /^(\d{4})/.exec(value);
    if (direct) return direct[1];
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return String(date.getFullYear());
    return "undated";
}

function listShardFiles(dirPath: string, regex: RegExp) {
    if (!fs.existsSync(dirPath)) return [];
    return fs
        .readdirSync(dirPath)
        .filter((name) => regex.test(name))
        .sort()
        .map((name) => path.join(dirPath, name));
}

function readShardCollection(dirPath: string, regex: RegExp) {
    ensureProductManagerDir();
    const out: any[] = [];
    listShardFiles(dirPath, regex).forEach((filePath) => {
        const parsed = readJsonFile<any>(filePath, []);
        if (Array.isArray(parsed)) {
            parsed.forEach((item) => out.push(item));
            return;
        }
        if (parsed && Array.isArray(parsed.items)) {
            parsed.items.forEach((item: any) => out.push(item));
        }
    });
    return out;
}

function writeShardCollection(dirPath: string, prefix: string, regex: RegExp, payload: any[]) {
    ensureProductManagerDir();
    const buckets = payload.reduce<Record<string, any[]>>((acc, item) => {
        const year = getYearKey(item);
        if (!acc[year]) acc[year] = [];
        acc[year].push(item);
        return acc;
    }, {});
    const expected = new Set<string>();
    Object.keys(buckets).forEach((year) => {
        const fileName = `${prefix}-${year}.json`;
        expected.add(fileName.toLowerCase());
        writeJsonFileAtomic(path.join(dirPath, fileName), buckets[year]);
    });
    listShardFiles(dirPath, regex).forEach((filePath) => {
        const name = path.basename(filePath).toLowerCase();
        if (expected.has(name)) return;
        fs.unlinkSync(filePath);
    });
}

export function loadProductManagerBootstrap() {
    ensureProductManagerDir();
    return {
        requests: readShardCollection(REQUESTS_SHARDS_DIR, REQUESTS_SHARD_REGEX),
        interventions: readShardCollection(
            INTERVENTIONS_SHARDS_DIR,
            INTERVENTIONS_SHARD_REGEX,
        ),
        catalog: readJsonFile(CATALOG_PATH, [] as any[]),
        categories: readJsonFile(CATEGORIES_PATH, [] as any[]),
        interventionTypes: readJsonFile(INTERVENTION_TYPES_PATH, [] as any[]),
        assignees: loadAssigneeOptions(),
    };
}

export function saveProductManagerRequests(payload: any[]) {
    writeShardCollection(
        REQUESTS_SHARDS_DIR,
        "requests",
        REQUESTS_SHARD_REGEX,
        Array.isArray(payload) ? payload : [],
    );
    return readShardCollection(REQUESTS_SHARDS_DIR, REQUESTS_SHARD_REGEX);
}

export function saveProductManagerInterventions(payload: any[]) {
    writeShardCollection(
        INTERVENTIONS_SHARDS_DIR,
        "interventions",
        INTERVENTIONS_SHARD_REGEX,
        Array.isArray(payload) ? payload : [],
    );
    return readShardCollection(
        INTERVENTIONS_SHARDS_DIR,
        INTERVENTIONS_SHARD_REGEX,
    );
}

export function saveProductManagerCatalog(payload: any[]) {
    writeJsonFileAtomic(CATALOG_PATH, Array.isArray(payload) ? payload : []);
    return readJsonFile(CATALOG_PATH, [] as any[]);
}

export function saveProductManagerCategories(payload: any[]) {
    writeJsonFileAtomic(CATEGORIES_PATH, Array.isArray(payload) ? payload : []);
    return readJsonFile(CATEGORIES_PATH, [] as any[]);
}

export function saveProductManagerInterventionTypes(payload: any[]) {
    writeJsonFileAtomic(
        INTERVENTION_TYPES_PATH,
        Array.isArray(payload) ? payload : [],
    );
    return readJsonFile(INTERVENTION_TYPES_PATH, [] as any[]);
}

function sanitizeImageName(value: string) {
    return String(value || "")
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ");
}

export function saveCatalogImage(payload: {
    catalogId?: string;
    fileName?: string;
    dataBase64?: string;
}) {
    ensureProductManagerDir();
    const catalogId = sanitizeImageName(payload?.catalogId || "");
    const originalName = sanitizeImageName(payload?.fileName || "");
    if (!catalogId || !payload?.dataBase64) {
        throw new Error("Missing image payload");
    }
    const ext = path.extname(originalName) || ".png";
    const safeName = `${catalogId}${ext}`;
    const buffer = Buffer.from(String(payload.dataBase64 || ""), "base64");
    const filePath = path.join(PRODUCTS_DIR, safeName);
    ensureFolderFor(filePath);
    fs.writeFileSync(filePath, buffer);
    return {
        imageFile: safeName,
    };
}

export function resolveCatalogImagePath(fileName: string) {
    return path.join(PRODUCTS_DIR, sanitizeImageName(fileName));
}

function ensureDir(dirPath: string) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function copyDirectory(sourceDir: string, targetDir: string) {
    ensureDir(targetDir);
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    entries.forEach((entry) => {
        const srcPath = path.join(sourceDir, entry.name);
        const dstPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            copyDirectory(srcPath, dstPath);
            return;
        }
        if (entry.isFile()) {
            ensureDir(path.dirname(dstPath));
            fs.copyFileSync(srcPath, dstPath);
        }
    });
}

function formatBackupDate(date: Date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

export function listProductManagerBackups() {
    if (!fs.existsSync(PURCHASING_BACKUP_ROOT_DIR)) return [];
    return fs
        .readdirSync(PURCHASING_BACKUP_ROOT_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const fullPath = path.join(PURCHASING_BACKUP_ROOT_DIR, entry.name);
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

export function createProductManagerBackup(limit = 10) {
    ensureDir(PURCHASING_DIR);
    ensureDir(PURCHASING_BACKUP_ROOT_DIR);
    const dateLabel = formatBackupDate(new Date());
    let targetDir = path.join(PURCHASING_BACKUP_ROOT_DIR, dateLabel);
    let suffix = 1;
    while (fs.existsSync(targetDir)) {
        suffix += 1;
        targetDir = path.join(PURCHASING_BACKUP_ROOT_DIR, `${dateLabel}-${suffix}`);
    }
    copyDirectory(PURCHASING_DIR, targetDir);
    const backups = listProductManagerBackups();
    backups.slice(limit).forEach((entry) => {
        const fullPath = path.join(PURCHASING_BACKUP_ROOT_DIR, entry.name);
        if (fs.existsSync(fullPath)) {
            fs.rmSync(fullPath, { recursive: true, force: true });
        }
    });
    return {
        name: path.basename(targetDir),
        path: targetDir,
    };
}

export function restoreProductManagerBackup(name: string) {
    const safeName = String(name || "").trim();
    if (!safeName) {
        throw new Error("Backup name missing");
    }
    const sourceDir = path.join(PURCHASING_BACKUP_ROOT_DIR, safeName);
    if (!fs.existsSync(sourceDir)) {
        throw new Error("Backup not found");
    }
    ensureDir(PURCHASING_DIR);
    const entries = fs.readdirSync(PURCHASING_DIR, { withFileTypes: true });
    entries.forEach((entry) => {
        const targetPath = path.join(PURCHASING_DIR, entry.name);
        fs.rmSync(targetPath, { recursive: true, force: true });
    });
    copyDirectory(sourceDir, PURCHASING_DIR);
    return {
        ok: true,
        restored: safeName,
    };
}
