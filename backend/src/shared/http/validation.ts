import Ajv from "ajv";
import { badRequest } from "./errors";

const ajv = new Ajv({
    allErrors: true,
});

export function createSchemaValidator<T>(schema: Record<string, unknown>) {
    const validate = ajv.compile(schema);
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
