export type SpecialColumn = { key: string; label: string; kind: string };
export type SpecialRule = { field: string; op: string; value: string; to?: string };
export type SpecialGroup = { join: "all" | "any"; conditions: SpecialCondition[] };
export type SpecialCondition = SpecialRule | SpecialGroup;
export type SpecialFilter = { name: string; condition: SpecialGroup; exclude?: boolean; enabled?: boolean };
export const SPECIAL_OPERATORS = {
    contains: "Contiene", not: "Non contiene", prefix: "Inizia con", suffix: "Finisce con",
    exact: "Uguale a", different: "Diverso da", range: "Tra / da / a",
    gt: "Maggiore di", gte: "Maggiore o uguale", lt: "Minore di", lte: "Minore o uguale",
    empty: "Mancante / vuoto", present: "Presente / non vuoto",
};
export function specialOperators(kind: string) {
    return kind === "number" || kind === "money" || kind === "date"
        ? ["exact", "different", "range", "gt", "gte", "lt", "lte", "empty", "present"]
        : kind === "boolean" ? ["exact", "different", "empty", "present"]
        : ["contains", "not", "prefix", "suffix", "exact", "different", "range", "empty", "present"];
}
export function validateSpecialFilters(input: unknown, columns: readonly SpecialColumn[]): SpecialFilter[] {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > 12) throw Error("Massimo 12 filtri speciali.");
    const fields = new Map(columns.map(c => [c.key, { ...c, kind: c.kind === "money" ? "number" : c.kind }]));
    let count = 0;
    function condition(source: any, depth: number): SpecialCondition {
        if (!source || typeof source !== "object" || Array.isArray(source) || ++count > 100)
            throw Error("Massimo 100 condizioni complessive nei filtri speciali.");
        if ("join" in source) {
            if (depth > 3 || !["all", "any"].includes(source.join) || !Array.isArray(source.conditions) || !source.conditions.length || source.conditions.length > 30)
                throw Error("Completa il gruppo: scegli E / O e almeno una condizione (massimo tre livelli).");
            return { join: source.join, conditions: source.conditions.map((c: unknown) => condition(c, depth + 1)) };
        }
        const column = fields.get(source.field);
        if (!column || !specialOperators(column.kind).includes(source.op) || typeof source.value !== "string" || source.value.length > 256 ||
            (source.to !== undefined && (typeof source.to !== "string" || source.to.length > 256)))
            throw Error("Campo o confronto del filtro speciale non valido.");
        const value = source.value.trim(), to = source.to?.trim() || "";
        if (!["empty", "present"].includes(source.op)) {
            if (!value && !(source.op === "range" && to)) throw Error(`Completa il valore di ${column.label}.`);
            for (const edge of [value, source.op === "range" ? to : ""]) {
                if (!edge) continue;
                if (column.kind === "number" && (!Number.isFinite(Number(edge)) || Math.abs(Number(edge)) > 1e14)) throw Error(`Numero non valido: ${column.label}.`);
                if (column.kind === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(edge) || !Number.isFinite(Date.parse(edge)) || new Date(edge).toISOString().slice(0, 10) !== edge)) throw Error(`Data non valida: ${column.label}.`);
                if (column.kind === "boolean" && !["0", "1"].includes(edge)) throw Error(`Scegli Sì o No: ${column.label}.`);
            }
            if (source.op === "range" && value && to && (column.kind === "number" ? Number(value) > Number(to) : value > to)) throw Error(`Intervallo invertito: ${column.label}.`);
        }
        return { field: column.key, op: source.op, value: ["empty", "present"].includes(source.op) ? "" : value, ...(source.op === "range" && to ? { to } : {}) };
    }
    return input.map(source => {
        if (!source || typeof source.name !== "string" || !source.name.trim() || source.name.length > 60 ||
            (source.exclude !== undefined && typeof source.exclude !== "boolean") || (source.enabled !== undefined && typeof source.enabled !== "boolean"))
            throw Error("Nome o modalità del filtro speciale non validi.");
        const group = condition(source.condition, 1);
        if (!("join" in group)) throw Error("Il filtro speciale deve contenere un gruppo di condizioni.");
        return { name: source.name.trim(), condition: group, ...(source.exclude ? { exclude: true } : {}), ...(source.enabled === false ? { enabled: false } : {}) };
    });
}
export function specialFilterMatcher(input: unknown, columns: readonly SpecialColumn[]) {
    const filters = validateSpecialFilters(input, columns), fields = new Map(columns.map(c => [c.key, { ...c, kind: c.kind === "money" ? "number" : c.kind }]));
    const text = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("it");
    function matches(row: Record<string, any>, condition: SpecialCondition): boolean {
        if ("join" in condition) return condition.join === "all" ? condition.conditions.every(c => matches(row, c)) : condition.conditions.some(c => matches(row, c));
        const rule: SpecialRule = condition;
        const raw = row[condition.field], kind = fields.get(condition.field)!.kind;
        const values = Array.isArray(raw) ? raw : [raw];
        const absent = (value: unknown) => value == null || (typeof value === "string" && !value.trim());
        if (condition.op === "empty") return values.every(absent);
        if (condition.op === "present") return values.some(value => !absent(value));
        function positive(value: unknown, op: string): boolean {
            const missing = value === null || value === undefined || (typeof value === "string" && !value.trim());
            if (op === "empty") return missing;
            if (op === "present") return !missing;
            if (missing) return false;
            const convert = (v: unknown) => kind === "number" ? Number(v) : kind === "boolean" ? (v === true || v === 1 || v === "1" ? 1 : 0) : kind === "date" ? (v instanceof Date ? Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : "" : String(v).slice(0, 10)) : text(v);
            const a = convert(value), b = convert(rule.value), to = convert(rule.to);
            if (kind === "number" && !Number.isFinite(a)) return false;
            if (kind === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(String(a)) || !Number.isFinite(Date.parse(String(a))))) return false;
            if (op === "exact") return a === b;
            if (op === "range") return (!rule.value || a >= b) && (!rule.to || a <= to);
            if (op === "gt") return a > b;
            if (op === "gte") return a >= b;
            if (op === "lt") return a < b;
            if (op === "lte") return a <= b;
            if (op === "prefix") return text(a).startsWith(text(b));
            if (op === "suffix") return text(a).endsWith(text(b));
            return text(a).includes(text(b));
        }
        const op = condition.op === "not" ? "contains" : condition.op === "different" ? "exact" : condition.op;
        const result = values.some(value => positive(value, op));
        return ["not", "different"].includes(condition.op) ? !result : result;
    }
    return (row: Record<string, any>) => filters.every(filter => filter.enabled === false || (filter.exclude ? !matches(row, filter.condition) : matches(row, filter.condition)));
}
