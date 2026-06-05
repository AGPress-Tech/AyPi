import type { IncomingMessage } from "http";

export async function readJsonBody<T = unknown>(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (!chunks.length) return null as T | null;
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return null as T | null;
    return JSON.parse(raw) as T;
}
