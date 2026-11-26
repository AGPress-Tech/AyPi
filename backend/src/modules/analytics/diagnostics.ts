import type { IncomingMessage, ServerResponse } from "http";
import { getRequestId } from "../../shared/http/context";
import { logger } from "../../shared/logging/logger";
import { sendJson } from "../../shared/http/response";

/** Keep driver diagnostics on the server, without SQL text, bindings or credentials. */
export function sendAnalyticsUnavailable(
    request: IncomingMessage,
    response: ServerResponse,
    error: unknown,
    payload: { error: string },
) {
    const failure = error as { code?: unknown; number?: unknown; originalError?: { info?: { number?: unknown } } } | null;
    const rawCode = typeof failure?.code === "string" ? failure.code : "";
    const code = /^(?:E[A-Z_]{2,40}|ANALYTICS_[A-Z_]{1,40})$/.test(rawCode)
        ? rawCode : "ANALYTICS_QUERY_FAILED";
    const number = failure?.number ?? failure?.originalError?.info?.number;
    const message = error instanceof Error ? error.message : "";
    const reason = code === "ANALYTICS_NOT_CONFIGURED" ? "configuration_missing"
        : code === "ANALYTICS_DECRYPT_FAILED" ? "configuration_decryption"
        : code === "ANALYTICS_CONFIG_INVALID" ? "configuration_invalid"
        : code === "ELOGIN" ? "sql_authentication"
        : ["ESOCKET", "ECONNCLOSED", "ECONNRESET", "ENOTOPEN", "EINSTLOOKUP", "ETIMEOUT"].includes(code) ? "sql_connection"
        : message.startsWith("Altre ") ? "capacity"
        : message.startsWith("Oltre 100.000") ? "row_limit" : "sql_query";
    logger.warn("Analytics request unavailable", {
        event: "analytics_request_unavailable",
        category: "http",
        module: "core",
        requestId: getRequestId(request),
        method: request.method,
        url: (request.url || "").split("?")[0],
        statusCode: 503,
        code,
        reason,
        ...(Number.isInteger(number) ? { sqlNumber: number } : {}),
    });
    sendJson(response, 503, payload);
}
