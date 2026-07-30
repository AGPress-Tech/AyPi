import type { IncomingMessage } from "http";
import { badRequest } from "./errors";

export async function readJsonBody<T = unknown>(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const maxBytes = 10 * 1024 * 1024;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxBytes) {
            throw badRequest("JSON body too large", {
                maxBytes,
            });
        }
        chunks.push(buffer);
    }
    if (!chunks.length) return null as T | null;
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return null as T | null;
    try {
        return JSON.parse(raw) as T;
    } catch (error) {
        throw badRequest("Invalid JSON body", {
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}
