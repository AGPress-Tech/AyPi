import Ajv from "ajv";
import { badRequest } from "./errors";

const ajv = new Ajv({
    allErrors: true,
});

function normalizeNullableSchema(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeNullableSchema(item));
    }
    if (!value || typeof value !== "object") {
        return value;
    }

    const source = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    Object.keys(source).forEach((key) => {
        if (key === "nullable") return;
        next[key] = normalizeNullableSchema(source[key]);
    });

    if (source.nullable === true && typeof source.type === "string") {
        next.type = [source.type, "null"];
    }

    return next;
}

export function createSchemaValidator<T>(schema: Record<string, unknown>) {
    const validate = ajv.compile(normalizeNullableSchema(schema) as Record<string, unknown>);
    return (value: unknown, message = "Request body validation failed") => {
        const ok = validate(value);
        if (!ok) {
            throw badRequest(message, {
                issues: (validate.errors || []).map((entry) => ({
                    path: (entry as { dataPath?: string }).dataPath || "/",
                    message: entry.message || "Invalid value",
                    keyword: entry.keyword,
                    params: entry.params,
                })),
            });
        }
        return value as T;
    };
}
