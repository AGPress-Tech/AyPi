import { color } from "chart.js/helpers";
import {
    dimensions,
    SupplierSettings,
} from "../../../backend/src/modules/supplier-evaluation/model";

type Context = {
    rows: any[];
    settings: SupplierSettings;
    selected: (row: any) => boolean;
    active: boolean;
    accent: string;
    pick: (values: Record<string, string[]>, multiple: boolean) => void;
};
const titles = {
    punctuality: "Puntualità",
    condition: "Stato merce",
    conformity: "Conformità",
};
export const supplierPerformanceSources = [
    { id: "vendor-distribution", title: "Distribuzione degli esiti" },
    { id: "vendor-volume", title: "Valutazioni nel tempo" },
    { id: "vendor-quality", title: "Anomalie per dimensione nel tempo" },
    { id: "vendor-issues", title: "Cause delle segnalazioni nel tempo" },
    { id: "vendor-annual", title: "Confronto annuale" },
    { id: "vendor-causes", title: "Cause delle segnalazioni" },
];
function periodKeys(rows: any[], annual: boolean, limit: number) {
    let keys = [
        ...new Set<string>(
            rows
                .map((r) => String(r.date || "").slice(0, annual ? 4 : 7))
                .filter(Boolean),
        ),
    ].sort();
    if (!annual && keys.length) {
        const index = (key: string) =>
                Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1,
            start = index(keys[0]),
            end = index(keys[keys.length - 1]);
        if (end - start <= 1200)
            keys = Array.from({ length: end - start + 1 }, (_, i) => {
                const n = start + i;
                return (
                    String(Math.floor(n / 12)).padStart(4, "0") +
                    "-" +
                    String((n % 12) + 1).padStart(2, "0")
                );
            });
    }
    return limit ? keys.slice(-limit) : keys;
}
/** Context totals remain visible; selections highlight their share rather than replacing them. */
export function supplierPerformanceChart(
    source: string,
    kind: string,
    metric: string,
    limit: number,
    ctx: Context,
): any {
    const { rows, settings } = ctx,
        rules = settings.rules.filter((r) => r.active),
        adverse = (r: any) =>
            rules.some((rule) => rule.options.includes(r[rule.dimension]));
    let labels: any[] = [],
        keys: string[] = [],
        series: {
            label: string;
            color: string;
            data: (number | null)[];
            highlight: (number | null)[];
        }[] = [];
    let dimensionItems: {
            dimension: string;
            id: string;
            rank: number;
            name: string;
        }[] = [],
        causeItems = rules;
    const add = (
        label: string,
        tint: string,
        groups: any[][],
        value: (part: any[], total: any[]) => number | null,
    ) =>
        series.push({
            label,
            color: tint,
            data: groups.map((g) => value(g, g)),
            highlight: groups.map((g) => value(g.filter(ctx.selected), g)),
        });
    const ratio = (count: number, total: number) =>
        total ? (count / total) * 100 : null;
    if (source === "vendor-distribution") {
        dimensionItems = dimensions.flatMap((d) =>
            settings.options[d].map((o) => ({
                dimension: d,
                id: o.id,
                rank: o.rank,
                name: o.name,
            })),
        );
        if (limit) dimensionItems = dimensionItems.slice(0, limit);
        labels = dimensionItems.map((o) => o.name);
        keys = dimensionItems.map((o) => o.id);
        const values = (selected: boolean) =>
            dimensionItems.map((o) => {
                const eligible = rows.filter((r) => r[o.dimension]),
                    part = rows.filter(
                        (r) =>
                            r[o.dimension] === o.id &&
                            (!selected || ctx.selected(r)),
                    );
                return metric === "rate"
                    ? ratio(part.length, eligible.length)
                    : metric === "adverse"
                      ? part.filter(adverse).length
                      : part.length;
            });
        series = [
            {
                label:
                    metric === "rate"
                        ? "Valutazioni per esito %"
                        : "Valutazioni per esito",
                color: ctx.accent,
                data: values(false),
                highlight: values(true),
            },
        ];
    } else if (source === "vendor-causes") {
        causeItems = limit ? rules.slice(0, limit) : rules;
        labels = causeItems.map((r) => r.name);
        keys = causeItems.map((r) => r.id);
        const values = (selected: boolean) =>
            causeItems.map((rule) => {
                const eligible = rows.filter((r) => r[rule.dimension]),
                    part = eligible.filter(
                        (r) =>
                            rule.options.includes(r[rule.dimension]) &&
                            (!selected || ctx.selected(r)),
                    );
                return metric === "rate"
                    ? ratio(part.length, eligible.length)
                    : part.length;
            });
        series = [
            {
                label: metric === "rate" ? "Incidenza causa %" : "Segnalazioni",
                color: ctx.accent,
                data: values(false),
                highlight: values(true),
            },
        ];
    } else {
        const annual = source === "vendor-annual";
        keys = periodKeys(rows, annual, limit);
        labels = keys;
        const groups = keys.map((key) =>
            rows.filter((r) => String(r.date || "").startsWith(key)),
        );
        if (source === "vendor-quality")
            dimensions.forEach((d, i) =>
                add(
                    titles[d] + (metric === "rate" ? " %" : ""),
                    [ctx.accent, "#438f89", "#bd6b78"][i],
                    groups,
                    (part, total) => {
                        const eligible = total.filter((r) => r[d]),
                            portion = part.filter((r) => r[d]),
                            bad = portion.filter((r) =>
                                rules.some(
                                    (rule) =>
                                        rule.dimension === d &&
                                        rule.options.includes(r[d]),
                                ),
                            );
                        return metric === "rate"
                            ? ratio(bad.length, eligible.length)
                            : metric === "adverse"
                              ? bad.length
                              : portion.length;
                    },
                ),
            );
        else if (source === "vendor-issues")
            rules.forEach((rule, i) =>
                add(
                    rule.name + (metric === "rate" ? " %" : ""),
                    [ctx.accent, "#438f89", "#bd6b78", "#8c78b5"][i % 4],
                    groups,
                    (part, total) => {
                        const count = part.filter((r) =>
                            rule.options.includes(r[rule.dimension]),
                        ).length;
                        return metric === "rate"
                            ? ratio(
                                  count,
                                  total.filter((r) => r[rule.dimension]).length,
                              )
                            : count;
                    },
                ),
            );
        else if (metric === "rate")
            add("Incidenza segnalazioni %", ctx.accent, groups, (part, total) =>
                ratio(part.filter(adverse).length, total.length),
            );
        else {
            if (metric !== "adverse")
                add("Valutazioni", ctx.accent, groups, (part) => part.length);
            add(
                "Con segnalazioni",
                "#bd6b78",
                groups,
                (part) => part.filter(adverse).length,
            );
        }
    }
    const palette =
        source === "vendor-distribution"
            ? dimensionItems.map(
                  (o) =>
                      ["#21988b", "#d3a145", "#c46170", "#718397"][
                          Math.min(3, Math.max(0, o.rank - 1))
                      ],
              )
            : keys.map(
                  (_, i) =>
                      [ctx.accent, "#438f89", "#bd6b78", "#8c78b5"][i % 4],
              );
    const category =
            source === "vendor-distribution" || source === "vendor-causes",
        horizontal = category && kind === "bar";
    const pick = (indices: number[], multiple: boolean, dataset?: number) => {
        if (source === "vendor-distribution") {
            const values: Record<string, string[]> = {};
            if (!multiple) for (const d of dimensions) values[d] = [];
            for (const index of indices) {
                const item = dimensionItems[index];
                if (item)
                    values[item.dimension] = [
                        ...(values[item.dimension] || []),
                        item.id,
                    ];
            }
            ctx.pick(values, multiple);
        } else if (source === "vendor-causes")
            ctx.pick(
                { causes: indices.map((i) => keys[i]).filter(Boolean) },
                multiple,
            );
        else {
            const values: Record<string, string[]> = {
                [source === "vendor-annual" ? "years" : "months"]: indices
                    .map((i) => keys[i])
                    .filter(Boolean),
            };
            if (
                source === "vendor-issues" &&
                dataset !== undefined &&
                rules[dataset]
            )
                values.causes = [rules[dataset].id];
            ctx.pick(values, multiple);
        }
    };
    return {
        type: kind,
        data: {
            labels,
            datasets: series.map((s) => ({
                label: s.label,
                data: s.data,
                borderColor: category ? palette : s.color,
                backgroundColor: category
                    ? palette.map((c) =>
                          ctx.active ? color(c).alpha(0.22).rgbString() : c,
                      )
                    : ctx.active
                      ? color(s.color).alpha(0.22).rgbString()
                      : color(s.color)
                            .alpha(kind === "line" ? 0.12 : 0.8)
                            .rgbString(),
                borderWidth: kind === "line" ? 2 : 1,
                pointRadius: 3,
                tension: 0.12,
                spanGaps: false,
                maxBarThickness: 26,
                highlightValues: ctx.active ? s.highlight : undefined,
                highlightColors: category ? palette : keys.map(() => s.color),
            })),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: Math.max(2, window.devicePixelRatio || 1),
            animation: false,
            indexAxis: horizontal ? "y" : "x",
            plugins: {
                legend: {
                    display: series.length > 1 || kind === "doughnut",
                    position: "bottom",
                    labels: { boxWidth: 10, font: { size: 10 } },
                },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const index = items[0]?.dataIndex,
                                item = dimensionItems[index];
                            return item
                                ? titles[item.dimension] + " · " + item.name
                                : labels[index] || "";
                        },
                    },
                },
            },
            scales:
                kind === "doughnut"
                    ? {}
                    : {
                          x: horizontal
                              ? {
                                    beginAtZero: true,
                                    ...(metric === "rate" ? { max: 100 } : {}),
                                    ticks: { precision: 0, font: { size: 10 } },
                                }
                              : {
                                    ticks: {
                                        font: { size: 10 },
                                        maxRotation: 0,
                                    },
                                },
                          y: horizontal
                              ? { ticks: { font: { size: 11 } } }
                              : {
                                    beginAtZero: true,
                                    ...(metric === "rate" ? { max: 100 } : {}),
                                    ticks: { precision: 0, font: { size: 10 } },
                                },
                      },
            onClick: (event, elements) => {
                const hit = elements[0];
                if (hit)
                    pick(
                        [hit.index],
                        !!(event.native?.ctrlKey || event.native?.metaKey),
                        hit.datasetIndex,
                    );
            },
            onAreaSelect: (indices: number[], multiple: boolean) =>
                pick(indices, multiple),
        },
    };
}
