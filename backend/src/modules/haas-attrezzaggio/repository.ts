import fs from "fs";
import path from "path";
import crypto from "crypto";
import { backendConfig } from "../../config";
import {
    ensureFolderFor,
    readJsonFile,
    writeJsonFileAtomic,
} from "../../shared/storage/json-files";
import { ensureAgpressDailyBackup } from "../../shared/storage/agpress-backups";

const HAAS_DIR = backendConfig.modules.haasAttrezzaggio.dir;
const HAAS_ATTACHMENTS_DIR = path.join(HAAS_DIR, "_attachments");

function ensureHaasBackup() {
    return ensureAgpressDailyBackup("auto", 30);
}

function sanitizeFileName(value: string) {
    return String(value || "")
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
}

function resolveHaasFilePath(code: string) {
    const safeName = sanitizeFileName(code);
    return path.join(HAAS_DIR, `${safeName}.json`);
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
    return path.join(HAAS_ATTACHMENTS_DIR, sanitizeFileName(storedName));
}

function saveNewAttachments(items: any[]) {
    if (!Array.isArray(items) || !items.length) return [];
    fs.mkdirSync(HAAS_ATTACHMENTS_DIR, { recursive: true });
    return items
        .map((item) => {
            const base64 = String(item?.dataBase64 || "").trim();
            if (!base64) return null;
            const id = crypto.randomUUID();
            const originalName =
                String(item?.fileName || "immagine").trim() || "immagine";
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

function normalizeUtensiliRows(rows: any[]) {
    return Array.isArray(rows)
        ? rows.map((item) => ({
              t: String(item?.t || "").trim(),
              ciclo: String(item?.ciclo || "").trim(),
              mandrinoCodice: String(item?.mandrinoCodice || "").trim(),
              mandrinoRiduz: String(item?.mandrinoRiduz || "").trim(),
              mandrinoLunghezza: String(item?.mandrinoLunghezza || "").trim(),
              codiceUtensile: String(item?.codiceUtensile || "").trim(),
              locazione: String(item?.locazione || "").trim(),
              sporgenzaUtensile: String(item?.sporgenzaUtensile || "").trim(),
              diametroGambo: String(item?.diametroGambo || "").trim(),
          }))
        : [];
}

export function normalizeHaasItem(raw: any) {
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
        denominazioneArticolo: String(item.denominazioneArticolo || "").trim(),
        numeroProgramma: String(item.numeroProgramma || "").trim(),
        macchina: String(item.macchina || "").trim(),
        metodo: String(item.metodo || "").trim(),
        cicloLavoro: String(item.cicloLavoro || "").trim(),
        note: String(item.note || "").trim(),
        attachments: normalizeAttachmentMeta(item.attachments),
        newAttachments: Array.isArray(item.newAttachments) ? item.newAttachments : [],
        utensili: normalizeUtensiliRows(item.utensili),
        updatedAt: String(item.updatedAt || raw?.updatedAt || "").trim(),
        createdAt: String(item.createdAt || raw?.createdAt || "").trim(),
    };
}

export function listHaasItems() {
    if (!fs.existsSync(HAAS_DIR)) {
        fs.mkdirSync(HAAS_DIR, { recursive: true });
        return [];
    }
    return fs
        .readdirSync(HAAS_DIR)
        .filter((name) => name.toLowerCase().endsWith(".json"))
        .map((name) => {
            const filePath = path.join(HAAS_DIR, name);
            const stat = fs.statSync(filePath);
            const parsed = readJsonFile(filePath, {});
            const item = normalizeHaasItem(parsed);
            const code = item.code || path.basename(name, ".json");
            return {
                ...item,
                code,
                utensiliCount: Array.isArray(item.utensili) ? item.utensili.length : 0,
                attachmentsCount: Array.isArray(item.attachments)
                    ? item.attachments.length
                    : 0,
                updatedAt: item.updatedAt || stat.mtime.toISOString(),
            };
        })
        .sort((a, b) =>
            String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
        );
}

export function loadHaasItem(code: string) {
    const filePath = resolveHaasFilePath(code);
    if (!fs.existsSync(filePath)) return null;
    return normalizeHaasItem(readJsonFile(filePath, {}));
}

export function saveHaasItem(payload: any) {
    const normalized = normalizeHaasItem(payload);
    const previousCode = String(payload?.previousCode || "").trim();
    const current =
        (normalized.code ? loadHaasItem(normalized.code) : null) ||
        (previousCode && previousCode !== normalized.code
            ? loadHaasItem(previousCode)
            : null);
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
        createdAt: normalized.createdAt || current?.createdAt || now,
        updatedAt: now,
    };
    const filePath = resolveHaasFilePath(next.code);
    ensureFolderFor(filePath);
    ensureHaasBackup();
    writeJsonFileAtomic(filePath, next);
    if (previousCode && previousCode !== next.code) {
        const previousPath = resolveHaasFilePath(previousCode);
        if (fs.existsSync(previousPath)) {
            fs.unlinkSync(previousPath);
        }
    }
    deleteAttachmentFiles(removedAttachments);
    return next;
}

export function deleteHaasItem(code: string) {
    const filePath = resolveHaasFilePath(code);
    if (!fs.existsSync(filePath)) return false;
    const current = loadHaasItem(code);
    ensureHaasBackup();
    fs.unlinkSync(filePath);
    deleteAttachmentFiles(current?.attachments);
    return true;
}

export function resolveHaasAttachmentPath(storedName: string) {
    return resolveAttachmentPath(storedName);
}
