// @ts-nocheck
require("./dev-guards");
import { ipcRenderer } from "electron";
import http from "http";
import https from "https";

let backendRootUrlCache = "";

function resolveBackendRootUrl() {
    if (backendRootUrlCache) return backendRootUrlCache;
    const envUrl =
        process.env.AYPI_BACKEND_URL ||
        process.env.AYPI_FP_BACKEND_URL ||
        "";
    if (envUrl) {
        backendRootUrlCache = String(envUrl)
            .replace(/\/api\/ferie-permessi\/?$/i, "")
            .replace(/\/+$/, "");
        return backendRootUrlCache;
    }
    try {
        const value = ipcRenderer.sendSync("fp-get-backend-base-url");
        backendRootUrlCache = String(value || "")
            .replace(/\/api\/ferie-permessi\/?$/i, "")
            .replace(/\/+$/, "");
    } catch (err) {
        backendRootUrlCache = "http://192.168.1.240:3000";
    }
    return backendRootUrlCache;
}

function requestBackend(pathname: string, options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    responseType?: "json" | "text" | "buffer";
}) {
    const rootUrl = resolveBackendRootUrl();
    const url = new URL(pathname, `${rootUrl}/`);
    const transport = url.protocol === "https:" ? https : http;
    const method = String(options?.method || "GET").toUpperCase();
    const responseType = options?.responseType || "json";
    const headers = {
        "Content-Type": "application/json",
        "x-aypi-client": "electron-renderer",
        ...(options?.headers || {}),
    };
    const hasBody = Object.prototype.hasOwnProperty.call(options || {}, "body");
    const body = hasBody ? JSON.stringify(options?.body ?? {}) : "";

    return new Promise((resolve, reject) => {
        const req = transport.request(
            url,
            {
                method,
                headers: hasBody
                    ? {
                          ...headers,
                          "Content-Length": Buffer.byteLength(body).toString(),
                      }
                    : headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
                res.on("end", () => {
                    const rawBuffer = Buffer.concat(chunks);
                    const rawText = rawBuffer.toString("utf8");
                    const statusCode = res.statusCode || 0;
                    let parsed: any = rawText;
                    if (responseType === "buffer") {
                        parsed = rawBuffer;
                    } else if (responseType === "json") {
                        try {
                            parsed = rawText ? JSON.parse(rawText) : null;
                        } catch {
                            parsed = null;
                        }
                    }
                    if (statusCode >= 200 && statusCode < 300) {
                        resolve(parsed);
                        return;
                    }
                    reject(
                        new Error(
                            `Backend ${method} ${url.pathname} failed (${statusCode}): ${
                                parsed?.error || rawText || "Errore sconosciuto"
                            }`,
                        ),
                    );
                });
            },
        );
        req.on("error", reject);
        if (hasBody) req.write(body);
        req.end();
    });
}

export { resolveBackendRootUrl, requestBackend };

if (
    typeof module !== "undefined" &&
    module.exports &&
    !(globalThis as any).__aypiBundled
) {
    module.exports = {
        resolveBackendRootUrl,
        requestBackend,
    };
}
