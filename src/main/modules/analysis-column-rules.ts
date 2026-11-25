import { exclusion, matchesAlternatives } from "./analysis-filter-modes";
export type ColumnRule = { field: string; op: "contains" | "exact" | "prefix" | "range"; value: string; to?: string; exclude?: boolean };
export type FilterColumn = { key: string; label: string; kind: string };
export function validateColumnRules(input: unknown, columns: readonly FilterColumn[]): ColumnRule[] {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > 100) throw Error("Condizioni filtro non valide.");
    return input.map(rule => {
        const column = columns.find(c => c.key === rule?.field);
        if (!column || !["contains", "exact", "prefix", "range"].includes(rule.op) ||
            typeof rule.value !== "string" || rule.value.length > 256 ||
            (rule.to !== undefined && (typeof rule.to !== "string" || rule.to.length > 256)))
            throw Error("Condizione filtro non valida.");
        for (const value of [rule.value, rule.to]) {
            if (!value) continue;
            if (column.kind === "number" && !Number.isFinite(Number(value))) throw Error("Numero non valido.");
            if (column.kind === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw Error("Data non valida.");
        }
        if (["number", "date"].includes(column.kind) && !["exact", "range"].includes(rule.op)) throw Error("Confronto non valido.");
        if (rule.value && rule.to && (column.kind === "number" ? Number(rule.value) > Number(rule.to) : rule.value > rule.to)) throw Error("Intervallo invertito.");
        return { field: rule.field, op: rule.op, value: rule.value.trim(), ...(rule.to ? { to: rule.to.trim() } : {}), ...exclusion(rule.exclude) };
    });
}
export function matchesColumnRules(row: Record<string, any>, rules: readonly ColumnRule[], columns: readonly FilterColumn[]) {
    const groups = new Map<string, ColumnRule[]>();
    for (const rule of rules) if (rule.value || rule.to) groups.set(rule.field, [...(groups.get(rule.field) || []), rule]);
    return [...groups].every(([field, alternatives]) => matchesAlternatives(alternatives, rule => {
        const raw = row[field];
        if (raw == null) return false;
        const kind = columns.find(c => c.key === field)!.kind;
        const text = (v: unknown) => String(v ?? "").toLocaleLowerCase("it");
        const value = kind === "number" ? Number(raw) : kind === "date" ? String(raw).slice(0, 10) : text(raw);
        const from = kind === "number" ? Number(rule.value) : text(rule.value);
        const to = kind === "number" ? Number(rule.to) : text(rule.to);
        if (rule.op === "range") return (!rule.value || value >= from) && (!rule.to || value <= to);
        if (rule.op === "exact") return value === from;
        return rule.op === "prefix" ? text(value).startsWith(text(from)) : text(value).includes(text(from));
    }));
}
