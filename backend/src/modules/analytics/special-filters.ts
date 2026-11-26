import {
    SpecialColumn, SpecialCondition, SpecialFilter,
    validateSpecialFilters, specialFilterMatcher,
} from "./special-filter-model";

export type SqlSpecialFilter = SpecialFilter;
// Preference storage checks the bounded AST; each module validates its actual
// field catalog before evaluating a saved filter.
export function validateStoredSpecialFilters(input: unknown): SpecialFilter[] {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > 12) throw Error("Filtri speciali non validi.");
    let count = 0;
    function node(value: any, depth: number): SpecialCondition {
        if (!value || typeof value !== "object" || ++count > 100) throw Error("Troppe condizioni.");
        if ("join" in value) {
            if (depth > 3 || !["all", "any"].includes(value.join) || !Array.isArray(value.conditions) || !value.conditions.length || value.conditions.length > 30) throw Error("Gruppo filtro non valido.");
            return { join: value.join, conditions: value.conditions.map((v: unknown) => node(v, depth + 1)) };
        }
        if (typeof value.field !== "string" || !/^[\w:]{1,100}$/.test(value.field) || !["contains", "not", "prefix", "suffix", "exact", "different", "range", "gt", "gte", "lt", "lte", "empty", "present"].includes(value.op) || typeof value.value !== "string" || value.value.length > 256 || (value.to !== undefined && (typeof value.to !== "string" || value.to.length > 256))) throw Error("Condizione filtro non valida.");
        return { field: value.field, op: value.op, value: value.value, ...(value.to === undefined ? {} : { to: value.to }) };
    }
    return input.map(value => {
        if (!value || typeof value.name !== "string" || !value.name.trim() || value.name.length > 60 || (value.exclude !== undefined && typeof value.exclude !== "boolean") || (value.enabled !== undefined && typeof value.enabled !== "boolean")) throw Error("Filtro speciale non valido.");
        const condition = node(value.condition, 1);
        if (!("join" in condition)) throw Error("Gruppo filtro mancante.");
        return { name: value.name.trim(), condition, ...(value.exclude ? { exclude: true } : {}), ...(value.enabled === false ? { enabled: false } : {}) };
    });
}
const numeric = new Set(["line", "orderId", "offerId", "netWeight", "grossWeight", "quantity", "deliveredQuantity", "residual", "unitPrice", "netPrice", "netAmount"]);
function columns(keys: readonly string[]): SpecialColumn[] {
    return keys.map(key => ({ key, label: key, kind: /Date$/.test(key) ? "date" : ["delivered", "cancelled"].includes(key) ? "boolean" : numeric.has(key) ? "number" : "text" }));
}
export function validateSqlSpecialFilters(input: unknown, allowed: readonly string[]) {
    return validateSpecialFilters(input, columns(allowed));
}
export function specialRecordMatcher(input: unknown, fields: { key: string; kind: string }[]) {
    return specialFilterMatcher(input as SpecialFilter[], fields.map(c => ({ ...c, label: c.key })));
}
export function specialFilterSql(
    input: unknown, allowed: readonly string[] | readonly SpecialColumn[],
    bind: (value: unknown, type: "text" | "number" | "date" | "int") => string,
    dateOnly = false,
) {
    const catalog = allowed.map(value => typeof value === "string" ? columns([value])[0] : value);
    const fields = new Map(catalog.map(c => [c.key, c]));
    const invert = (sql: string) => `CASE WHEN ${sql} THEN 1 ELSE 0 END=0`;
    function condition(node: SpecialCondition): string {
        if ("join" in node) return "(" + node.conditions.map(condition).join(node.join === "all" ? " AND " : " OR ") + ")";
        const field = fields.get(node.field)!;
        // Identifiers come exclusively from the server's column allowlist.
        const column = dateOnly && field.kind === "date" ? `CONVERT(date,[${field.key}])` : `[${field.key}]`, text = field.kind === "text";
        const missing = text ? `(${column} IS NULL OR LTRIM(RTRIM(${column}))='')` : `${column} IS NULL`;
        if (node.op === "empty") return missing;
        if (node.op === "present") return invert(missing);
        const value = (raw: string) => bind(field.kind === "number" || field.kind === "boolean" ? Number(raw) : raw, field.kind === "boolean" ? "int" : field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text");
        let sql: string;
        if (["contains", "not", "prefix", "suffix"].includes(node.op)) {
            const escaped = node.value.replace(/[\[\]%_\\]/g, "\\$&");
            const pattern = (node.op === "prefix" ? "" : "%") + escaped + (node.op === "suffix" ? "" : "%");
            sql = `${column} LIKE ${bind(pattern, "text")} ESCAPE '\\'`;
        } else if (node.op === "range") {
            const edges = [];
            if (node.value) edges.push(`${column}>=${value(node.value)}`);
            if (node.to) edges.push(`${column}<=${value(node.to)}`);
            sql = "(" + edges.join(" AND ") + ")";
        } else {
            const operator = ({ exact: "=", different: "=", gt: ">", gte: ">=", lt: "<", lte: "<=" })[node.op];
            sql = `${column}${operator}${value(node.value)}`;
        }
        return ["not", "different"].includes(node.op) ? invert(sql) : sql;
    }
    return validateSpecialFilters(input, catalog)
        .filter(filter => filter.enabled !== false)
        .map(filter => filter.exclude ? invert(condition(filter.condition)) : condition(filter.condition));
}
