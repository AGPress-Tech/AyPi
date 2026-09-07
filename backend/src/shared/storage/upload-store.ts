import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { badRequest } from "../http/errors";

export const UPLOAD_PREFIX = "aypi-upload:";
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const directory = path.join(os.tmpdir(), "aypi-attachment-uploads");
const TTL = 24 * 60 * 60 * 1000;

function uploadPath(token: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)) {
        throw badRequest("Riferimento allegato non valido");
    }
    return path.join(directory, token);
}

export function cleanExpiredUploads() {
    fs.mkdirSync(directory, { recursive: true });
    for (const name of fs.readdirSync(directory)) {
        if (!/^[0-9a-f-]{36}(\.ready)?$/.test(name)) continue;
        const file = path.join(directory, name);
        try {
            if (Date.now() - fs.statSync(file).mtimeMs > TTL) fs.unlinkSync(file);
        } catch { /* Another request may have removed the temporary file. */ }
    }
}

export function createUpload() {
    fs.mkdirSync(directory, { recursive: true });
    const token = crypto.randomUUID();
    fs.writeFileSync(uploadPath(token), "", { flag: "wx" });
    return token;
}

export function appendUpload(token: string, offset: number, data: string) {
    const file = uploadPath(token);
    if (!Number.isSafeInteger(offset) || offset < 0 || typeof data !== "string" ||
        !data.length || data.length > 4 * 1024 * 1024 ||
        data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
        throw badRequest("Blocco allegato non valido");
    }
    if (!fs.existsSync(file) || fs.existsSync(`${file}.ready`)) throw badRequest("Caricamento non disponibile");
    const bytes = Buffer.from(data, "base64");
    const size = fs.statSync(file).size;
    if (offset + bytes.length > MAX_UPLOAD_BYTES) throw badRequest("Il singolo allegato supera 1 GiB");
    if (offset === size) fs.appendFileSync(file, bytes);
    else {
        // A response may be lost: accepting the same block makes retries safe.
        if (offset + bytes.length > size) throw badRequest("Ordine blocchi allegato non valido");
        const previous = Buffer.alloc(bytes.length);
        const fd = fs.openSync(file, "r");
        try { fs.readSync(fd, previous, 0, previous.length, offset); }
        finally { fs.closeSync(fd); }
        if (!previous.equals(bytes)) throw badRequest("Blocco allegato differente da quello ricevuto");
    }
    return fs.statSync(file).size;
}

export function finishUpload(token: string, size: number) {
    const file = uploadPath(token);
    if (!Number.isSafeInteger(size) || size < 0 || !fs.existsSync(file) || fs.statSync(file).size !== size) {
        throw badRequest("Caricamento allegato incompleto");
    }
    fs.writeFileSync(`${file}.ready`, "");
    return `${UPLOAD_PREFIX}${token}`;
}

export function removeUpload(token: string) {
    const file = uploadPath(token);
    fs.rmSync(`${file}.ready`, { force: true });
    fs.rmSync(file, { force: true });
}

export function writeAttachmentData(value: string, destination: string) {
    if (!value.startsWith(UPLOAD_PREFIX)) {
        const bytes = Buffer.from(value, "base64");
        fs.writeFileSync(destination, bytes);
        return bytes.length;
    }
    const file = uploadPath(value.slice(UPLOAD_PREFIX.length));
    if (!fs.existsSync(`${file}.ready`) || !fs.existsSync(file)) {
        throw badRequest("Allegato temporaneo scaduto o incompleto: ripetere il caricamento");
    }
    fs.copyFileSync(file, destination);
    return fs.statSync(destination).size;
}
