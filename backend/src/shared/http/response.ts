import type { ServerResponse } from "http";

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
