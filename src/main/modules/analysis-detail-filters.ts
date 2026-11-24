export type DetailRule = { column: number; op: "contains" | "exact" | "not" | "range"; value: string; to: string };
export type DetailFilters = { search: string; rules: DetailRule[] };
const text = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("it");
export function comparable(value: string): number | null {
    const source = value.replace(/^Valore originale:\s*/i, "").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(source)) return Date.parse(source.slice(0, 10));
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(source)) return Date.parse(source.split("/").reverse().join("-"));
    const raw = source.includes(",") ? source.replace(/\./g, "").replace(",", ".") : source;
    return raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
}
export function matchesDetailFilters(values: string[], filters: DetailFilters) {
    if (filters.search && !text(values.join(" ")).includes(text(filters.search))) return false;
    return filters.rules.every(rule => {
        const value = values[rule.column] || "", needle = text(rule.value);
        if (rule.op === "range") {
            if (!rule.value && !rule.to) return true;
            const number = comparable(value), from = comparable(rule.value), to = comparable(rule.to);
            return number !== null && (!rule.value || from !== null && number >= from) && (!rule.to || to !== null && number <= to);
        }
        return rule.op === "exact" ? text(value) === needle : rule.op === "not" ? !text(value).includes(needle) : text(value).includes(needle);
    });
}
