import type { IncomingMessage } from "http";

const REQUEST_ID_SYMBOL = Symbol.for("aypi.requestId");

export function getRequestUser(request: IncomingMessage) {
    const header = request.headers["x-aypi-user"];
    if (Array.isArray(header)) return header[0] || "unknown";
    return header || "unknown";
}

export function getRequestClient(request: IncomingMessage) {
    const header = request.headers["x-aypi-client"];
    if (Array.isArray(header)) return header[0] || "unknown";
    return header || "unknown";
}

export function getRequestRole(request: IncomingMessage) {
    const header = request.headers["x-aypi-role"];
    const value = Array.isArray(header) ? header[0] : header;
    return String(value || "guest").trim().toLowerCase();
}

export function getRequestActor(request: IncomingMessage) {
    const header = request.headers["x-aypi-actor"];
    const value = Array.isArray(header) ? header[0] : header;
    return String(value || getRequestUser(request) || "").trim();
}

export function setRequestId(request: IncomingMessage, requestId: string) {
    (request as IncomingMessage & { [REQUEST_ID_SYMBOL]?: string })[
        REQUEST_ID_SYMBOL
    ] = requestId;
}

export function getRequestId(request: IncomingMessage) {
    return (
        (request as IncomingMessage & { [REQUEST_ID_SYMBOL]?: string })[
            REQUEST_ID_SYMBOL
        ] || "unknown"
    );
}
