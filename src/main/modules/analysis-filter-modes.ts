/** Alternatives include their union; exclusions always subtract from that union. */
export function matchesAlternatives<T extends { exclude?: boolean }>(
    rules: readonly T[], matches: (rule: T) => boolean,
): boolean {
    const included = rules.filter((rule) => !rule.exclude);
    return (!included.length || included.some(matches)) &&
        rules.filter((rule) => rule.exclude).every((rule) => !matches(rule));
}

export function exclusion(value: unknown): { exclude?: true } {
    if (value !== undefined && typeof value !== "boolean")
        throw Error("Modalità filtro non valida.");
    return value === true ? { exclude: true } : {};
}

export function recentAnalysisYears(now = new Date()): number[] {
    const year = now.getFullYear();
    return [year - 2, year - 1, year];
}

export type FilterModes = Record<string, "exclude">;
export function matchesFilter(mode: "exclude" | undefined, active: boolean, matches: unknown): boolean {
    return !active || (mode === "exclude" ? !matches : !!matches);
}
export function validateFilterModes(input: unknown, keys: readonly string[]): FilterModes {
    if (input === undefined) return {};
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.entries(input).some(([key, value]) => !keys.includes(key) || value !== "exclude"))
        throw Error("Modalità filtro non valida.");
    return { ...input } as FilterModes;
}

/** Evaluate each excluded criterion against the same source, before aggregating or exporting. */
export function filterWithModes<R, F extends { modes?: FilterModes }>(
    rows: readonly R[], filters: F, neutral: F,
    groups: Record<string, readonly string[]>, evaluate: (rows: readonly R[], filters: F) => R[],
): R[] {
    const modes = validateFilterModes(filters.modes, Object.keys(groups));
    const base = { ...filters, modes: undefined };
    const excluded: Set<R>[] = [];
    for (const key of Object.keys(modes)) {
        const criterion = { ...neutral, modes: undefined };
        let active = false;
        for (const field of groups[key]) {
            (criterion as any)[field] = (filters as any)[field];
            (base as any)[field] = (neutral as any)[field];
            const value = (filters as any)[field];
            active ||= field !== "articleExact" && value !== undefined && value !== null &&
                (Array.isArray(value) ? value.length > 0 : typeof value === "string" ? !!value.trim() : value !== false);
        }
        if (active) excluded.push(new Set(evaluate(rows, criterion)));
    }
    return evaluate(rows, base).filter(row => excluded.every(set => !set.has(row)));
}
