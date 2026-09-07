import fs from "fs";
type Request = (pathname: string, options?: any) => Promise<any>;
const BLOCK_CHARS = 1024 * 1024; // Divisible by four: every block is valid Base64.
const MAX_BYTES = 1024 * 1024 * 1024;

/** Keep attachment bytes out of the final JSON, without mutating the caller's draft. */
export async function withUploadedAttachments<T>(body: unknown, request: Request, save: (body: unknown) => Promise<T>): Promise<T> {
    const tokens: string[] = [];
    async function visit(value: any): Promise<any> {
        if (!value || typeof value !== "object") return value;
        if (Array.isArray(value)) {
            const result = [];
            for (const item of value) result.push(await visit(item));
            return result;
        }
        if (Object.getPrototypeOf(value) !== Object.prototype) return value;
        const result: any = {};
        if (typeof value.dataFilePath === "string" && value.dataFilePath) {
            const file = await fs.promises.open(value.dataFilePath, "r");
            try {
                const stat = await file.stat();
                if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error(`L'allegato ${value.fileName || "selezionato"} non è un file valido o supera 1 GiB.`);
                const { token } = await request("/api/uploads", { method: "POST", body: {} });
                tokens.push(token);
                const buffer = Buffer.alloc(768 * 1024);
                let offset = 0;
                while (offset < stat.size) {
                    const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
                    if (!bytesRead) throw new Error("Il file allegato è cambiato durante il caricamento. Riprovare.");
                    const data = buffer.subarray(0, bytesRead).toString("base64");
                    for (let attempt = 0; ; attempt++) {
                        try {
                            await request(`/api/uploads/${token}`, { method: "PUT", body: { offset, data } });
                            break;
                        } catch (error) { if (attempt >= 2) throw error; }
                    }
                    offset += bytesRead;
                }
                const after = await file.stat();
                if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("Il file allegato è cambiato durante il caricamento. Riprovare.");
                const { reference } = await request(`/api/uploads/${token}/complete`, { method: "POST", body: { size: offset } });
                result.dataBase64 = reference;
                if (Object.prototype.hasOwnProperty.call(value, "size")) result.size = offset;
            } finally { await file.close(); }
        }
        for (const [key, entry] of Object.entries(value)) {
            if (key === "dataFilePath" || (result.dataBase64 && (key === "dataBase64" || key === "size"))) continue;
            if (key !== "dataBase64" || typeof entry !== "string" || !entry || entry.startsWith("aypi-upload:")) {
                result[key] = await visit(entry);
                continue;
            }
            const size = Math.floor(entry.length / 4) * 3 - (entry.endsWith("==") ? 2 : entry.endsWith("=") ? 1 : 0);
            if (size > MAX_BYTES) throw new Error(`L'allegato ${value.fileName || "selezionato"} supera il limite di 1 GiB per file.`);
            const { token } = await request("/api/uploads", { method: "POST", body: {} });
            tokens.push(token);
            let offset = 0;
            for (let start = 0; start < entry.length; start += BLOCK_CHARS) {
                const data = entry.slice(start, start + BLOCK_CHARS);
                let response: any;
                for (let attempt = 0; ; attempt++) {
                    try {
                        response = await request(`/api/uploads/${token}`, { method: "PUT", body: { offset, data } });
                        break;
                    } catch (error) { if (attempt >= 2) throw error; }
                }
                offset = response.size;
            }
            const { reference } = await request(`/api/uploads/${token}/complete`, { method: "POST", body: { size } });
            result[key] = reference;
        }
        return result;
    }
    try { return await save(await visit(body)); }
    finally {
        await Promise.allSettled(tokens.map((token) => request(`/api/uploads/${token}`, { method: "DELETE", timeoutMs: 5000 })));
    }
}
