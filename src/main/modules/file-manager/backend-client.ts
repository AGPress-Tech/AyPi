import http from "http";
import https from "https";
import log from "electron-log";
import { resolveFpBackendBaseUrl } from "../../config/backend";

export type BackendRequestOptions = {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
};

const BACKEND_REQUEST_TIMEOUT_MS = 10000;

export function resolveAypiBackendBaseUrl() {
    const ferieBaseUrl = resolveFpBackendBaseUrl();
    log.debug("[backend] base url:", ferieBaseUrl);
    return ferieBaseUrl.replace(/\/api\/ferie-permessi\/?$/i, "");
}

export async function requestAypiBackend(
    pathname: string,
    options?: BackendRequestOptions,
) {
    const baseUrl = resolveAypiBackendBaseUrl();
    const url = new URL(pathname, `${baseUrl}/`);
    const transport = url.protocol === "https:" ? https : http;
    const method = String(options?.method || "GET").toUpperCase();
    const headers = {
        "Content-Type": "application/json",
        "x-aypi-user":
            process.env.USERNAME || process.env.USER || "Operatore AyPi",
        "x-aypi-client": "AyPi-Electron-Main",
        ...(options?.headers || {}),
    };
    const body =
        options && Object.prototype.hasOwnProperty.call(options, "body")
            ? JSON.stringify(options.body ?? {})
            : null;
    const startedAt = Date.now();

    return new Promise<any>((resolve, reject) => {
        const req = transport.request(
            url,
            {
                method,
                headers: body
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
                    const raw = Buffer.concat(chunks).toString("utf8");
                    const statusCode = res.statusCode || 0;
                    let parsed: any = null;
                    if (raw) {
                        try {
                            parsed = JSON.parse(raw);
                        } catch {
                            parsed = raw;
                        }
                    }
                    if (statusCode >= 200 && statusCode < 300) {
                        log.debug("[backend] request completed", {
                            method,
                            pathname: url.pathname,
                            statusCode,
                            durationMs: Date.now() - startedAt,
                        });
                        resolve(parsed);
                        return;
                    }
                    reject(
                        new Error(
                            `Backend ${method} ${url.pathname} failed (${statusCode}): ${
                                parsed?.error || raw || "Errore sconosciuto"
                            }`,
                        ),
                    );
                });
            },
        );
        req.setTimeout(BACKEND_REQUEST_TIMEOUT_MS, () => {
            req.destroy(
                new Error(
                    `Backend ${method} ${url.pathname} timeout dopo ${
                        BACKEND_REQUEST_TIMEOUT_MS / 1000
                    } secondi`,
                ),
            );
        });
        req.on("error", (error) => {
            log.error("[backend] request failed", {
                method,
                pathname: url.pathname,
                durationMs: Date.now() - startedAt,
                error: error.message,
            });
            reject(error);
        });
        if (body) req.write(body);
        req.end();
    });
}
