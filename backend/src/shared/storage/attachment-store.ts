import crypto from "crypto";
import fs from "fs";
import path from "path";
import { writeAttachmentData } from "./upload-store";

export type AttachmentMeta = {
    id: string;
    originalName: string;
    storedName: string;
    mimeType: string;
    size: number;
    createdAt: string;
    rotation: number;
};

type NewAttachment = {
    dataBase64?: unknown;
    fileName?: unknown;
    mimeType?: unknown;
    size?: unknown;
    rotation?: unknown;
};

function normalizeRotation(value: unknown) {
    const rotation = Math.round(Number(value) || 0);
    return ((rotation % 360) + 360) % 360;
}

function sanitizeFileName(value: unknown) {
    return String(value || "")
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
}

function getAttachmentExtension(fileName: string, mimeType: string) {
    const extension = path.extname(fileName.trim()).toLowerCase();
    if (extension) return extension;
    if (mimeType === "image/jpeg") return ".jpg";
    if (mimeType === "image/webp") return ".webp";
    if (mimeType === "image/gif") return ".gif";
    return ".png";
}

export function createAttachmentStore(directory: string) {
    function resolvePath(storedName: string) {
        return path.join(directory, sanitizeFileName(storedName));
    }

    function normalize(items: unknown): AttachmentMeta[] {
        if (!Array.isArray(items)) return [];
        return items
            .map((item) => ({
                id: String(item?.id || "").trim(),
                originalName: String(item?.originalName || "").trim(),
                storedName: String(item?.storedName || "").trim(),
                mimeType: String(item?.mimeType || "").trim(),
                size: Number(item?.size || 0) || 0,
                createdAt: String(item?.createdAt || "").trim(),
                rotation: normalizeRotation(item?.rotation),
            }))
            .filter((item) => item.id && item.storedName);
    }

    function saveNew(items: NewAttachment[]): AttachmentMeta[] {
        if (!Array.isArray(items) || !items.length) return [];
        fs.mkdirSync(directory, { recursive: true });
        return items
            .map((item) => {
                const base64 = String(item?.dataBase64 || "").trim();
                if (!base64) return null;
                const id: string = crypto.randomUUID();
                const originalName =
                    String(item?.fileName || "immagine").trim() || "immagine";
                const mimeType =
                    String(item?.mimeType || "").trim() || "image/png";
                const extension = getAttachmentExtension(
                    originalName,
                    mimeType,
                );
                const storedName = `${id}${extension}`;
                const size = writeAttachmentData(base64, resolvePath(storedName));
                return {
                    id,
                    originalName,
                    storedName,
                    mimeType,
                    size,
                    createdAt: new Date().toISOString(),
                    rotation: normalizeRotation(item?.rotation),
                };
            })
            .filter((item): item is AttachmentMeta => item !== null);
    }

    function copy(items: unknown): AttachmentMeta[] {
        const attachments = normalize(items);
        if (!attachments.length) return [];
        fs.mkdirSync(directory, { recursive: true });
        return attachments
            .map((item) => {
                const sourcePath = resolvePath(item.storedName);
                if (!fs.existsSync(sourcePath)) return null;
                const id: string = crypto.randomUUID();
                const storedName = `${id}${path.extname(item.storedName)}`;
                fs.copyFileSync(sourcePath, resolvePath(storedName));
                return {
                    ...item,
                    id,
                    storedName,
                    createdAt: new Date().toISOString(),
                };
            })
            .filter((item): item is AttachmentMeta => item !== null);
    }

    function remove(items: unknown) {
        normalize(items).forEach((item) => {
            const filePath = resolvePath(item.storedName);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        });
    }

    return {
        copy,
        normalize,
        remove,
        resolvePath,
        saveNew,
    };
}
