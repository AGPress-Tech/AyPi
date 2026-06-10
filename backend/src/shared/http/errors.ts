export class HttpError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly details?: unknown;

    constructor(
        statusCode: number,
        message: string,
        options: {
            code?: string;
            details?: unknown;
        } = {},
    ) {
        super(message);
        this.name = "HttpError";
        this.statusCode = statusCode;
        this.code = options.code || "HTTP_ERROR";
        this.details = options.details;
    }
}

export function isHttpError(error: unknown): error is HttpError {
    return error instanceof HttpError;
}

export function badRequest(message: string, details?: unknown) {
    return new HttpError(400, message, {
        code: "BAD_REQUEST",
        details,
    });
}

export function unauthorized(message = "Unauthorized", details?: unknown) {
    return new HttpError(401, message, {
        code: "UNAUTHORIZED",
        details,
    });
}

export function notFound(message = "Not found", details?: unknown) {
    return new HttpError(404, message, {
        code: "NOT_FOUND",
        details,
    });
}
