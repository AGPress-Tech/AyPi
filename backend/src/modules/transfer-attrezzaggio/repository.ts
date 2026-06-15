import fs from "fs";
import path from "path";
import crypto from "crypto";
import { backendConfig } from "../../config";
import { ensureFolderFor, readJsonFile, writeJsonFileAtomic } from "../../shared/storage/json-files";
import { ensureAgpressDailyBackup } from "../../shared/storage/agpress-backups";

const TRANSFER_DIR = backendConfig.modules.transferAttrezzaggio.dir;
const TRANSFER_ATTACHMENTS_DIR = path.join(TRANSFER_DIR, "_attachments");

function ensureTransferBackup() {
    return ensureAgpressDailyBackup("auto", 30);
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

function normalizeAttachmentMeta(items: any[]) {
    return Array.isArray(items)
        ? items
              .map((item) => ({
                  id: String(item?.id || "").trim(),
                  originalName: String(item?.originalName || "").trim(),
                  storedName: String(item?.storedName || "").trim(),
                  mimeType: String(item?.mimeType || "").trim(),
                  size: Number(item?.size || 0) || 0,
                  createdAt: String(item?.createdAt || "").trim(),
              }))
              .filter((item) => item.id && item.storedName)
        : [];
}

function getAttachmentExtension(fileName: string, mimeType: string) {
    const ext = path.extname(String(fileName || "").trim()).toLowerCase();
    if (ext) return ext;
    if (mimeType === "image/jpeg") return ".jpg";
    if (mimeType === "image/webp") return ".webp";
    if (mimeType === "image/gif") return ".gif";
    return ".png";
}

function resolveAttachmentPath(storedName: string) {
    return path.join(TRANSFER_ATTACHMENTS_DIR, sanitizeFileName(storedName));
}

function saveNewAttachments(items: any[]) {
    if (!Array.isArray(items) || !items.length) return [];
    fs.mkdirSync(TRANSFER_ATTACHMENTS_DIR, { recursive: true });
    return items
        .map((item) => {
            const base64 = String(item?.dataBase64 || "").trim();
            if (!base64) return null;
            const id = crypto.randomUUID();
            const originalName = String(item?.fileName || "immagine").trim() || "immagine";
            const mimeType = String(item?.mimeType || "").trim() || "image/png";
            const extension = getAttachmentExtension(originalName, mimeType);
            const storedName = `${id}${extension}`;
            const filePath = resolveAttachmentPath(storedName);
            fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
            return {
                id,
                originalName,
                storedName,
                mimeType,
                size: Number(item?.size || 0) || 0,
                createdAt: new Date().toISOString(),
            };
        })
        .filter(Boolean);
}

function deleteAttachmentFiles(items: any[]) {
    normalizeAttachmentMeta(items).forEach((item) => {
        const filePath = resolveAttachmentPath(item.storedName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    });
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
        metodoVariante: String(item.metodoVariante || item.metodo || "").trim(),
        lavorazione: String(item.lavorazione || "").trim(),
        cicloLavorazione: String(item.cicloLavorazione || "").trim(),
        spessori: String(item.spessori || "").trim(),
        vitiRondelle: String(item.vitiRondelle || "").trim(),
        spine: String(item.spine || "").trim(),
        programmaRobot: String(item.programmaRobot || "").trim(),
        mani: String(item.mani || "").trim(),
        morsetti: String(item.morsetti || "").trim(),
        note: String(item.note || "").trim(),
        attachments: normalizeAttachmentMeta(item.attachments),
        newAttachments: Array.isArray(item.newAttachments) ? item.newAttachments : [],
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
                attachmentsCount: Array.isArray(item.attachments) ? item.attachments.length : 0,
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
    const previousCode = String(payload?.previousCode || "").trim();
    const current = normalized.code ? loadTransferItem(normalized.code) : null;
    const retainedAttachments = normalizeAttachmentMeta(normalized.attachments);
    const retainedIds = new Set(retainedAttachments.map((item) => item.id));
    const previousAttachments = normalizeAttachmentMeta(current?.attachments);
    const removedAttachments = previousAttachments.filter(
        (item) => !retainedIds.has(item.id),
    );
    const addedAttachments = saveNewAttachments(normalized.newAttachments);
    const now = new Date().toISOString();
    const next = {
        ...normalized,
        attachments: [...retainedAttachments, ...addedAttachments],
        newAttachments: [],
        createdAt: normalized.createdAt || now,
        updatedAt: now,
    };
    const filePath = resolveTransferFilePath(next.code);
    ensureFolderFor(filePath);
    ensureTransferBackup();
    writeJsonFileAtomic(filePath, next);
    if (previousCode && previousCode !== next.code) {
        const previousPath = resolveTransferFilePath(previousCode);
        if (fs.existsSync(previousPath)) {
            fs.unlinkSync(previousPath);
        }
    }
    deleteAttachmentFiles(removedAttachments);
    return next;
}

export function deleteTransferItem(code: string) {
    const filePath = resolveTransferFilePath(code);
    if (!fs.existsSync(filePath)) return false;
    const current = loadTransferItem(code);
    ensureTransferBackup();
    fs.unlinkSync(filePath);
    deleteAttachmentFiles(current?.attachments);
    return true;
}

export function resolveTransferAttachmentPath(storedName: string) {
    return resolveAttachmentPath(storedName);
}
