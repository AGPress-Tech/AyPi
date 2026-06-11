export type ActionContext = {
    actor?: string;
    requestId?: string;
};

export type AuditChange = {
    label: string;
    before: string;
    after: string;
};

export function buildContext(context?: ActionContext) {
    return {
        actor: context?.actor || "unknown",
        requestId: context?.requestId || "unknown",
    };
}

export function toAuditValue(value: unknown) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "string") return value.trim() || "-";
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function sameAuditValue(left: unknown, right: unknown) {
    return toAuditValue(left) === toAuditValue(right);
}

export function buildChanges(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
    labels: Record<string, string>,
) {
    const rows: AuditChange[] = [];
    Object.keys(labels).forEach((key) => {
        const beforeValue = before?.[key];
        const afterValue = after?.[key];
        if (sameAuditValue(beforeValue, afterValue)) return;
        rows.push({
            label: labels[key],
            before: toAuditValue(beforeValue),
            after: toAuditValue(afterValue),
        });
    });
    return rows;
}

export function buildChangeSummary(changes: AuditChange[] | null | undefined) {
    if (!Array.isArray(changes) || !changes.length) return "";
    return changes
        .slice(0, 4)
        .map((item) => `${item.label}: ${item.before} -> ${item.after}`)
        .join("; ");
}

export function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function defaultKeyOf(item: any, index: number) {
    const candidates = [
        item?.id,
        item?.code,
        item?.catalogId,
        item?.key,
        item?.name,
        item?.title,
        item?.fileName,
        item?.email,
    ];
    for (const candidate of candidates) {
        const normalized = String(candidate || "").trim();
        if (normalized) return normalized;
    }
    return `row-${index + 1}`;
}

function isPrimitiveLike(value: unknown) {
    return (
        value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    );
}

export function diffCollections(options: {
    before: any[];
    after: any[];
    entityLabel: string;
    keyOf?: (item: any, index: number) => string;
    fieldLabels?: Record<string, string>;
    sampleLimit?: number;
}) {
    const {
        before,
        after,
        entityLabel,
        keyOf = defaultKeyOf,
        fieldLabels = {},
        sampleLimit = 24,
    } = options;
    const beforeList = Array.isArray(before) ? before : [];
    const afterList = Array.isArray(after) ? after : [];
    const beforeMap = new Map<string, any>();
    const afterMap = new Map<string, any>();

    beforeList.forEach((item, index) => {
        beforeMap.set(keyOf(item, index), item);
    });
    afterList.forEach((item, index) => {
        afterMap.set(keyOf(item, index), item);
    });

    const changes: AuditChange[] = [];
    let added = 0;
    let removed = 0;
    let updated = 0;

    for (const [key, beforeItem] of beforeMap.entries()) {
        if (!afterMap.has(key)) {
            removed += 1;
            if (changes.length < sampleLimit) {
                changes.push({
                    label: `${entityLabel} rimosso`,
                    before: key,
                    after: "-",
                });
            }
        }
        const afterItem = afterMap.get(key);
        if (afterItem && JSON.stringify(beforeItem) !== JSON.stringify(afterItem)) {
            updated += 1;
            const keys = new Set<string>([
                ...Object.keys(beforeItem || {}),
                ...Object.keys(afterItem || {}),
                ...Object.keys(fieldLabels || {}),
            ]);
            keys.forEach((fieldKey) => {
                if (changes.length >= sampleLimit) return;
                const beforeValue = beforeItem?.[fieldKey];
                const afterValue = afterItem?.[fieldKey];
                if (!isPrimitiveLike(beforeValue) || !isPrimitiveLike(afterValue)) return;
                if (sameAuditValue(beforeValue, afterValue)) return;
                changes.push({
                    label: `${entityLabel} ${key} · ${fieldLabels[fieldKey] || fieldKey}`,
                    before: toAuditValue(beforeValue),
                    after: toAuditValue(afterValue),
                });
            });
        }
    }

    for (const [key] of afterMap.entries()) {
        if (beforeMap.has(key)) continue;
        added += 1;
        if (changes.length < sampleLimit) {
            changes.push({
                label: `${entityLabel} aggiunto`,
                before: "-",
                after: key,
            });
        }
    }

    return {
        added,
        removed,
        updated,
        changes,
        changeSummary: buildChangeSummary(changes),
    };
}
