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
