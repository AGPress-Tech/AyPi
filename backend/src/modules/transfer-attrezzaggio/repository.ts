import fs from "fs";
import path from "path";
import { backendConfig } from "../../config";
import { ensureFolderFor, readJsonFile, writeJsonFileAtomic } from "../../shared/storage/json-files";
import { createDailyDirectoryBackup } from "../../shared/storage/backups";

const TRANSFER_DIR = backendConfig.modules.transferAttrezzaggio.dir;
const TRANSFER_BACKUP_ROOT_DIR = path.join(
    path.dirname(TRANSFER_DIR),
    "Backup Schede Attrezzaggio Transfer",
);

function ensureTransferBackup() {
    return createDailyDirectoryBackup({
        sourceDir: TRANSFER_DIR,
        backupRootDir: TRANSFER_BACKUP_ROOT_DIR,
        prefix: "auto",
        limit: 30,
    });
}

function sanitizeFileName(value: string) {
    return String(value || "")
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
}

function resolveTransferFilePath(code: string) {
    const safeName = sanitizeFileName(code);
    return path.join(TRANSFER_DIR, `${safeName}.json`);
}

function parseCode(code: string) {
    const normalized = String(code || "").trim();
    if (!normalized) {
        return {
            codiceArticolo: "",
            fase: "",
            codiceMacchina: "",
            metodo: "",
        };
    }
    const parts = normalized.includes(" - ")
        ? normalized.split(/\s*-\s*/)
        : normalized.split("/");
    if (normalized.includes(" - ")) {
        return {
            codiceArticolo: parts[0] || "",
            fase: (parts[1] || "").replace(/^Fase:\s*/i, "").trim(),
            codiceMacchina: parts[2] || "",
            metodo: parts[3] || "",
        };
    }
    return {
        codiceArticolo: parts[0] || "",
        fase: parts[1] || "",
        codiceMacchina: parts[2] || "",
        metodo: parts[3] || "",
    };
}

function normalizeUtensiliRows(rows: any[]) {
    return Array.isArray(rows)
        ? rows.map((item) => ({
              nrUnita: String(item?.nrUnita || "").trim(),
              iso: String(item?.iso || "").trim(),
              descrizione: String(item?.descrizione || "").trim(),
              col1: String(item?.col1 || "").trim(),
              col2: String(item?.col2 || "").trim(),
              col3: String(item?.col3 || "").trim(),
              col4: String(item?.col4 || "").trim(),
              col5: String(item?.col5 || "").trim(),
              col6: String(item?.col6 || "").trim(),
              col7: String(item?.col7 || "").trim(),
              col8: String(item?.col8 || "").trim(),
              col10: String(item?.col10 || "").trim(),
              col12: String(item?.col12 || "").trim(),
              col13: String(item?.col13 || "").trim(),
              col14: String(item?.col14 || "").trim(),
          }))
        : [];
}

export function normalizeTransferItem(raw: any) {
    const item =
        raw?.item && typeof raw.item === "object"
            ? raw.item
            : raw?.data && typeof raw.data === "object"
              ? raw.data
              : raw && typeof raw === "object"
                ? raw
                : {};
    return {
        code: String(item.code || raw?.code || "").trim(),
        codiceArticolo: String(item.codiceArticolo || "").trim(),
        fase: String(item.fase || "").trim(),
        codiceMacchina: String(item.codiceMacchina || "").trim(),
        metodoVariante: String(item.metodoVariante || "").trim(),
        lavorazione: String(item.lavorazione || "").trim(),
        cicloLavorazione: String(item.cicloLavorazione || "").trim(),
        note: String(item.note || "").trim(),
        utensili: normalizeUtensiliRows(item.utensili),
        updatedAt: String(item.updatedAt || raw?.updatedAt || "").trim(),
        createdAt: String(item.createdAt || raw?.createdAt || "").trim(),
    };
}

export function listTransferItems() {
    if (!fs.existsSync(TRANSFER_DIR)) {
        fs.mkdirSync(TRANSFER_DIR, { recursive: true });
        return [];
    }
    return fs
        .readdirSync(TRANSFER_DIR)
        .filter((name) => name.toLowerCase().endsWith(".json"))
        .map((name) => {
            const filePath = path.join(TRANSFER_DIR, name);
            const stat = fs.statSync(filePath);
            const parsed = readJsonFile(filePath, {});
            const item = normalizeTransferItem(parsed);
            const code = item.code || path.basename(name, ".json");
            const parts = parseCode(code);
            return {
                ...item,
                code,
                codiceArticolo: item.codiceArticolo || parts.codiceArticolo,
                fase: item.fase || parts.fase,
                codiceMacchina: item.codiceMacchina || parts.codiceMacchina,
                metodo: item.metodoVariante || parts.metodo,
                utensiliCount: Array.isArray(item.utensili) ? item.utensili.length : 0,
                utensiliDescrizioni: Array.isArray(item.utensili)
                    ? item.utensili
                          .map((row) => String(row.descrizione || "").trim())
                          .filter(Boolean)
                    : [],
                utensiliCol1: Array.isArray(item.utensili)
                    ? item.utensili
                          .map((row) => String(row.col1 || "").trim())
                          .filter(Boolean)
                    : [],
                updatedAt: item.updatedAt || stat.mtime.toISOString(),
            };
        })
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function loadTransferItem(code: string) {
    const filePath = resolveTransferFilePath(code);
    if (!fs.existsSync(filePath)) return null;
    return normalizeTransferItem(readJsonFile(filePath, {}));
}

export function saveTransferItem(payload: any) {
    const normalized = normalizeTransferItem(payload);
    const now = new Date().toISOString();
    const next = {
        ...normalized,
        createdAt: normalized.createdAt || now,
        updatedAt: now,
    };
    const filePath = resolveTransferFilePath(next.code);
    ensureFolderFor(filePath);
    ensureTransferBackup();
    writeJsonFileAtomic(filePath, next);
    return next;
}

export function deleteTransferItem(code: string) {
    const filePath = resolveTransferFilePath(code);
    if (!fs.existsSync(filePath)) return false;
    ensureTransferBackup();
    fs.unlinkSync(filePath);
    return true;
}
