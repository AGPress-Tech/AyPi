import type { ServerResponse } from "http";
import { HttpError, isHttpError } from "./errors";

export function sendJson(
    response: ServerResponse,
    statusCode: number,
    payload: unknown,
) {
    const body = JSON.stringify(payload, null, 2);
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
    });
    response.end(body);
}

export function sendNoContent(response: ServerResponse, statusCode = 204) {
    response.writeHead(statusCode);
    response.end();
}

export function sendError(response: ServerResponse, error: unknown) {
    if (isHttpError(error)) {
        sendJson(response, error.statusCode, {
            error: error.message,
            code: error.code,
            details: error.details,
        });
        return;
    }
    const normalized =
        error instanceof Error
            ? new HttpError(500, error.message, { code: "INTERNAL_ERROR" })
            : new HttpError(500, "Internal Server Error", {
                  code: "INTERNAL_ERROR",
                  details: String(error),
              });
    sendJson(response, normalized.statusCode, {
        error: normalized.message,
        code: normalized.code,
        details: normalized.details,
    });
}
