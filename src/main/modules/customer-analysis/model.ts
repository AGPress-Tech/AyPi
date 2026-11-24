import {
    articleOrders,
    firstArticleDates,
    orderMeasures,
    articleInactivity,
} from "./articles";
export type DocumentKind = "order" | "offer";
export const CUSTOMER_SELECTION_DIMENSIONS = [
    "article",
    "month",
    "year",
    "status",
    "kind",
    "deliveryMonth",
    "inactivity",
] as const;
export type CustomerSelection = Record<
    (typeof CUSTOMER_SELECTION_DIMENSIONS)[number],
    string[]
>;
export const emptyCustomerSelection = (): CustomerSelection => ({
    article: [],
    month: [],
    year: [],
    status: [],
    kind: [],
    deliveryMonth: [],
    inactivity: [],
});
export function validateCustomerSelection(input: unknown): CustomerSelection {
    const clean = emptyCustomerSelection();
    if (input === undefined) return clean;
    if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some(
            (k) => !CUSTOMER_SELECTION_DIMENSIONS.includes(k as any),
        )
    )
        throw Error("Selezioni grafici non valide.");
    for (const key of CUSTOMER_SELECTION_DIMENSIONS) {
        const list = (input as any)[key] ?? [];
        if (
            !Array.isArray(list) ||
            list.length > 240 ||
            list.some(
                (v) => typeof v !== "string" || !v.length || v.length > 200,
            )
        )
            throw Error("Selezione grafico non valida.");
        clean[key] = [...new Set(list)] as string[];
    }
    if (
        clean.kind.some((v) => !["order", "offer"].includes(v)) ||
        clean.year.some((v) => !/^\d{4}$/.test(v)) ||
        [...clean.month, ...clean.deliveryMonth].some(
            (v) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(v),
        )
    )
        throw Error("Periodo o tipo documento non valido.");
    return clean;
}
export function toggleCustomerSelection(
    selection: CustomerSelection,
    dimension: keyof CustomerSelection,
    key: string,
    multiple = false,
): CustomerSelection {
    const current = selection[dimension],
        next = multiple
            ? current.includes(key)
                ? current.filter((v) => v !== key)
                : [...current, key]
            : current.length === 1 && current[0] === key
              ? []
              : [key];
    return validateCustomerSelection({ ...selection, [dimension]: next });
}
export type CustomerRow = {
    kind: DocumentKind;
    documentId: string;
    documentNo: string;
    documentDate: string | null;
    deliveryDate: string | null;
    customerCode: string;
    customerName: string;
    article: string;
    description: string;
    line: number;
    unit: string;
    currency: string;
    quantity: number | null;
    deliveredQuantity: number | null;
    residual: number | null;
    unitPrice: number | null;
    netPrice: number | null;
    delivered: boolean | null;
    cancelled: boolean | null;
    createdDate: string | null;
    lineCreatedDate: string | null;
    confirmedDeliveryDate: string | null;
    validityDate: string | null;
    netAmount: number | null;
    headerDelivered: boolean | null;
    headerCancelled: boolean | null;
};
export const STATUS_LABELS = {
    all: "Tutti gli stati",
    open: "Da consegnare",
    partial: "Parzialmente consegnato",
    delivered: "Consegnato",
    cancelled: "Annullato",
    overdue: "Consegna scaduta",
};
export type CustomerFilters = {
    selection?: CustomerSelection;
    kind: "all" | DocumentKind;
    from: string;
    to: string;
    deliveryFrom: string;
    deliveryTo: string;
    years: string[];
    article: string;
    articleExact: boolean;
    search: string;
    stateBucket: string;
    status: keyof typeof STATUS_LABELS;
    unit: string;
    currency: string;
    includeCancelled: boolean;
    minQuantity: string;
    maxQuantity: string;
    minPrice: string;
    maxPrice: string;
    minResidual: string;
    maxResidual: string;
};
export const defaultCustomerFilters = (): CustomerFilters => ({
    selection: emptyCustomerSelection(),
    kind: "all",
    from: "",
    to: "",
    deliveryFrom: "",
    deliveryTo: "",
    years: [],
    article: "",
    articleExact: false,
    search: "",
    stateBucket: "",
    status: "all",
    unit: "",
    currency: "",
    includeCancelled: false,
    minQuantity: "",
    maxQuantity: "",
    minPrice: "",
    maxPrice: "",
    minResidual: "",
    maxResidual: "",
});
const number = (v: unknown): number | null =>
    v === null || v === undefined || v === ""
        ? null
        : Number.isFinite(Number(v))
          ? Number(v)
          : null;
const flag = (v: unknown) =>
    v == null ? null : v === true || v === 1 || v === "1";
const text = (v: unknown) => (v == null ? "" : String(v).trim());
export function normalizeCustomerRows(input: unknown): CustomerRow[] {
    if (!Array.isArray(input) || input.length > 100000)
        throw Error("Risposta del gestionale non valida o troppo estesa.");
    return input
        .filter((v) => v?.kind !== "order" || !text(v.article).startsWith("*"))
        .map((v) => {
            if (
                !v ||
                !["order", "offer"].includes(v.kind) ||
                v.documentId == null
            )
                throw Error("Documento del gestionale non valido.");
            const result: any = { kind: v.kind };
            for (const k of [
                "documentId",
                "documentNo",
                "customerCode",
                "customerName",
                "article",
                "description",
                "unit",
                "currency",
            ])
                result[k] = text(v[k]);
            for (const k of [
                "quantity",
                "deliveredQuantity",
                "residual",
                "unitPrice",
                "netPrice",
                "netAmount",
                "line",
            ])
                result[k] = number(v[k]);
            for (const k of [
                "documentDate",
                "deliveryDate",
                "createdDate",
                "lineCreatedDate",
                "confirmedDeliveryDate",
                "validityDate",
            ])
                result[k] =
                    typeof v[k] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v[k])
                        ? v[k]
                        : null;
            for (const k of [
                "delivered",
                "cancelled",
                "headerDelivered",
                "headerCancelled",
            ])
                result[k] = flag(v[k]);
            return result as CustomerRow;
        });
}
export const documentKey = (r: CustomerRow) => `${r.kind}:${r.documentId}`;
export function rowStatus(r: CustomerRow, today: string): string {
    if (r.kind === "offer") return "Offerta";
    if (r.cancelled) return "Annullato";
    if (r.delivered) return "Consegnato";
    if ((r.residual ?? 0) > 0 && r.deliveryDate && r.deliveryDate < today)
        return "Scaduto";
    if ((r.deliveredQuantity ?? 0) > 0 && (r.residual ?? 0) > 0)
        return "Parziale";
    if ((r.residual ?? 0) > 0) return "Da consegnare";
    return "Residuo zero";
}
export function filterCustomerRows(
    rows: readonly CustomerRow[],
    f: CustomerFilters,
    today: string,
) {
    const search = f.search.toLocaleLowerCase("it"),
        article = f.article.toLocaleLowerCase("it");
    const selection = f.selection ?? emptyCustomerSelection();
    const inactivity = selection.inactivity.length
        ? articleInactivity(rows, today)
        : new Map<string, string>();
    return rows.filter((r) => {
        if (f.kind !== "all" && r.kind !== f.kind) return false;
        if (
            f.status !== "cancelled" &&
            f.stateBucket !== "Annullato" &&
            !f.includeCancelled &&
            r.cancelled
        )
            return false;
        if (
            (f.from && (!r.documentDate || r.documentDate < f.from)) ||
            (f.to && (!r.documentDate || r.documentDate > f.to))
        )
            return false;
        if (
            (f.deliveryFrom &&
                (!r.deliveryDate || r.deliveryDate < f.deliveryFrom)) ||
            (f.deliveryTo && (!r.deliveryDate || r.deliveryDate > f.deliveryTo))
        )
            return false;
        if (
            f.years.length &&
            (!r.documentDate || !f.years.includes(r.documentDate.slice(0, 4)))
        )
            return false;
        if (
            (f.currency && r.currency !== f.currency) ||
            (f.unit && r.unit !== f.unit)
        )
            return false;
        if (
            article &&
            (f.articleExact
                ? r.article.toLocaleLowerCase("it") !== article
                : !`${r.article} ${r.description}`
                      .toLocaleLowerCase("it")
                      .includes(article))
        )
            return false;
        if (
            search &&
            !`${r.documentNo} ${r.article} ${r.description} ${r.documentDate ?? ""} ${r.deliveryDate ?? ""}`
                .toLocaleLowerCase("it")
                .includes(search)
        )
            return false;
        if (
            (f.minQuantity !== "" &&
                (r.quantity === null || r.quantity < Number(f.minQuantity))) ||
            (f.maxQuantity !== "" &&
                (r.quantity === null || r.quantity > Number(f.maxQuantity)))
        )
            return false;
        if (
            (f.minPrice !== "" &&
                (r.netPrice === null || r.netPrice < Number(f.minPrice))) ||
            (f.maxPrice !== "" &&
                (r.netPrice === null || r.netPrice > Number(f.maxPrice)))
        )
            return false;
        if (
            (f.minResidual !== "" &&
                (r.residual === null || r.residual < Number(f.minResidual))) ||
            (f.maxResidual !== "" &&
                (r.residual === null || r.residual > Number(f.maxResidual)))
        )
            return false;
        if (f.stateBucket && rowStatus(r, today) !== f.stateBucket)
            return false;
        const values = {
            article: r.article,
            month: r.documentDate?.slice(0, 7),
            year: r.documentDate?.slice(0, 4),
            status: rowStatus(r, today),
            kind: r.kind,
            deliveryMonth: r.deliveryDate?.slice(0, 7),
            inactivity: inactivity.get(r.article) ?? "unknown",
        };
        if (
            CUSTOMER_SELECTION_DIMENSIONS.some(
                (key) =>
                    selection[key].length &&
                    !selection[key].includes(values[key] ?? ""),
            )
        )
            return false;
        if (f.status === "all") return true;
        if (r.kind !== "order") return false;
        if (f.status === "cancelled") return r.cancelled === true;
        if (r.cancelled) return false;
        if (f.status === "delivered") return r.delivered === true;
        if (f.status === "open") return (r.residual ?? 0) > 0;
        if (f.status === "partial")
            return (r.residual ?? 0) > 0 && (r.deliveredQuantity ?? 0) > 0;
        return (
            (r.residual ?? 0) > 0 && !!r.deliveryDate && r.deliveryDate < today
        );
    });
}
export const estimatedValue = (r: CustomerRow) =>
    r.quantity !== null && r.netPrice !== null ? r.quantity * r.netPrice : null;
export const backlogValue = (r: CustomerRow) =>
    r.kind === "order" && r.residual !== null && r.netPrice !== null
        ? r.residual * r.netPrice
        : null;
export function customerStats(rows: readonly CustomerRow[], today: string) {
    const orders = rows.filter((r) => r.kind === "order"),
        offers = rows.filter((r) => r.kind === "offer"),
        dates = rows
            .map((r) => r.documentDate)
            .filter(Boolean)
            .sort();
    const count = (rs: readonly CustomerRow[]) =>
        new Set(rs.map(documentKey)).size;
    const units = new Map<
        string,
        {
            unit: string;
            orders: number;
            offers: number;
            delivered: number;
            residual: number;
        }
    >();
    const currencies = new Map<
        string,
        {
            currency: string;
            orders: number;
            offers: number;
            netOrders: number;
            netOffers: number;
            backlog: number;
            missing: number;
            missingAmount: number;
        }
    >();
    for (const r of rows) {
        const unit = r.unit || "U.M. assente",
            u = units.get(unit) ?? {
                unit,
                orders: 0,
                offers: 0,
                delivered: 0,
                residual: 0,
            };
        u[r.kind === "order" ? "orders" : "offers"] += r.quantity ?? 0;
        u.delivered += r.kind === "order" ? (r.deliveredQuantity ?? 0) : 0;
        u.residual += r.kind === "order" ? (r.residual ?? 0) : 0;
        units.set(unit, u);
        const currency = r.currency || "Valuta assente",
            v = currencies.get(currency) ?? {
                currency,
                orders: 0,
                offers: 0,
                netOrders: 0,
                netOffers: 0,
                backlog: 0,
                missing: 0,
                missingAmount: 0,
            };
        const amount = estimatedValue(r);
        if (amount === null) v.missing++;
        else v[r.kind === "order" ? "orders" : "offers"] += amount;
        if (r.netAmount === null) v.missingAmount++;
        else v[r.kind === "order" ? "netOrders" : "netOffers"] += r.netAmount;
        v.backlog += backlogValue(r) ?? 0;
        currencies.set(currency, v);
    }
    const open = orders.filter((r) => !r.cancelled && (r.residual ?? 0) > 0),
        overdue = open.filter(
            (r) => !!r.deliveryDate && r.deliveryDate < today,
        );
    return {
        orders: count(orders),
        offers: count(offers),
        documents: count(rows),
        articles: new Set(rows.map((r) => r.article).filter(Boolean)).size,
        lines: rows.length,
        open: count(open),
        overdue: count(overdue),
        cancelled: count(orders.filter((r) => r.cancelled)),
        delivered: count(orders.filter((r) => r.delivered && !r.cancelled)),
        first: dates[0] ?? null,
        last: dates[dates.length - 1] ?? null,
        units: [...units.values()],
        currencies: [...currencies.values()],
        missingDates: rows.filter((r) => !r.documentDate).length,
        missingPrices: rows.filter((r) => r.netPrice === null).length,
        missingDeliveries: open.filter((r) => !r.deliveryDate).length,
    };
}
export const CHART_DIMENSIONS = {
    month: "Mese",
    year: "Anno",
    article: "Articolo",
    status: "Stato riga",
    kind: "Ordini / offerte",
    deliveryMonth: "Mese consegna prevista",
    inactivity: "Anni interi di inattività",
};
export const CHART_METRICS = {
    documents: "Documenti distinti",
    lines: "Righe",
    articles: "Articoli distinti",
    quantity: "Quantità",
    delivered: "Quantità consegnata",
    residual: "Quantità residua",
    netAmount: "Imponibile righe (gestionale)",
    value: "Valore netto stimato",
    backlog: "Portafoglio residuo stimato",
    averageLot: "Quantità media per ordine",
    weightedPrice: "Prezzo netto medio ponderato",
    newArticles: "Nuovi articoli osservati",
    newArticleValue: "Valore ordini dei nuovi articoli",
};
export type CustomerChart = {
    id: string;
    title: string;
    kind: "bar" | "line" | "doughnut";
    dimension: keyof typeof CHART_DIMENSIONS;
    metric: keyof typeof CHART_METRICS;
    scope: "all" | DocumentKind;
    limit: number;
    hidden: boolean;
    cumulative: boolean;
};
export const defaultCustomerCharts = (): CustomerChart[] => [
    {
        id: "history",
        title: "Storico mensile dei documenti",
        kind: "line",
        dimension: "month",
        metric: "documents",
        scope: "all",
        limit: 36,
        hidden: false,
        cumulative: false,
    },
    {
        id: "articles",
        title: "Articoli più richiesti",
        kind: "bar",
        dimension: "article",
        metric: "quantity",
        scope: "order",
        limit: 12,
        hidden: false,
        cumulative: false,
    },
    {
        id: "states",
        title: "Stato delle righe ordine",
        kind: "doughnut",
        dimension: "status",
        metric: "lines",
        scope: "order",
        limit: 12,
        hidden: false,
        cumulative: false,
    },
    {
        id: "annual",
        title: "Confronto annuale ordini e offerte",
        kind: "bar",
        dimension: "year",
        metric: "netAmount",
        scope: "all",
        limit: 20,
        hidden: false,
        cumulative: false,
    },
];
export type ChartBucket = {
    key: string;
    label: string;
    series: string;
    value: number;
};
export function customerChartData(
    rows: readonly CustomerRow[],
    chart: CustomerChart,
    today: string,
    history: readonly CustomerRow[] = rows,
): ChartBucket[] {
    if (
        [
            "averageLot",
            "weightedPrice",
            "newArticles",
            "newArticleValue",
        ].includes(chart.metric)
    ) {
        const first = firstArticleDates(history),
            groups = new Map<
                string,
                { key: string; series: string; rows: CustomerRow[] }
            >();
        for (const r of articleOrders(rows)) {
            if (!r.documentDate || chart.scope === "offer") continue;
            if (
                ["newArticles", "newArticleValue"].includes(chart.metric) &&
                !first.get(r.article)?.startsWith(r.documentDate.slice(0, 4))
            )
                continue;
            if (
                chart.metric === "newArticles" &&
                chart.dimension === "month" &&
                first.get(r.article)?.slice(0, 7) !== r.documentDate.slice(0, 7)
            )
                continue;
            const key =
                chart.dimension === "article"
                    ? r.article
                    : chart.dimension === "year"
                      ? r.documentDate.slice(0, 4)
                      : chart.dimension === "month"
                        ? r.documentDate.slice(0, 7)
                        : chart.dimension === "deliveryMonth"
                          ? r.deliveryDate?.slice(0, 7)
                          : chart.dimension === "status"
                            ? rowStatus(r, today)
                            : "Ordini";
            if (!key) continue;
            const series =
                chart.metric === "newArticles"
                    ? "Articoli"
                    : chart.metric === "averageLot"
                      ? r.unit || "U.M. assente"
                      : `${r.currency || "Valuta assente"}${chart.metric === "weightedPrice" ? ` / ${r.unit || "U.M. assente"}` : ""}`;
            const id = JSON.stringify([key, series]),
                g = groups.get(id) ?? { key, series, rows: [] };
            g.rows.push(r);
            groups.set(id, g);
        }
        let result = [...groups.values()].flatMap((g) => {
            const m = orderMeasures(g.rows),
                value =
                    chart.metric === "newArticles"
                        ? new Set(g.rows.map((r) => r.article)).size
                        : chart.metric === "averageLot"
                          ? m.averageLot
                          : chart.metric === "weightedPrice"
                            ? m.price
                            : m.value;
            return [{ key: g.key, label: g.key, series: g.series, value }];
        });
        const temporal = ["year", "month", "deliveryMonth"].includes(
            chart.dimension,
        );
        const totals = new Map<string, number>();
        result.forEach((b) =>
            totals.set(b.key, (totals.get(b.key) ?? 0) + Math.abs(b.value)),
        );
        let keys = [...totals.keys()].sort((a, b) =>
            temporal ? a.localeCompare(b) : totals.get(b)! - totals.get(a)!,
        );
        if (temporal && chart.scope !== "offer") {
            const dates = articleOrders(rows)
                .map((r) =>
                    chart.dimension === "deliveryMonth"
                        ? r.deliveryDate
                        : r.documentDate,
                )
                .filter(Boolean)
                .sort();
            if (dates.length) {
                const start = dates[0]!,
                    end = dates.at(-1)!;
                keys = [];
                let year = +start.slice(0, 4),
                    month = +start.slice(5, 7);
                for (let i = 0; i < 12000; i++) {
                    const key =
                        chart.dimension === "year"
                            ? String(year)
                            : `${year}-${String(month).padStart(2, "0")}`;
                    if (key > end.slice(0, chart.dimension === "year" ? 4 : 7))
                        break;
                    keys.push(key);
                    if (chart.dimension === "year") year++;
                    else if (++month > 12) {
                        year++;
                        month = 1;
                    }
                }
            }
        }
        const shown = temporal
            ? keys.slice(-chart.limit)
            : keys.slice(0, chart.limit);
        const series = [
                ...new Set(
                    result.length
                        ? result.map((b) => b.series)
                        : chart.metric === "newArticles"
                          ? ["Articoli"]
                          : chart.metric === "newArticleValue"
                            ? articleOrders(rows).map(
                                  (r) => r.currency || "Valuta assente",
                              )
                            : [],
                ),
            ],
            lookup = new Map(
                result.map((b) => [JSON.stringify([b.key, b.series]), b]),
            );
        result = temporal
            ? series.flatMap((series) =>
                  shown.map(
                      (key) =>
                          lookup.get(JSON.stringify([key, series])) ?? {
                              key,
                              label: key,
                              series,
                              value: ["averageLot", "weightedPrice"].includes(
                                  chart.metric,
                              )
                                  ? null
                                  : 0,
                          },
                  ),
              )
            : result
                  .filter((b) => shown.includes(b.key))
                  .sort((a, b) => shown.indexOf(a.key) - shown.indexOf(b.key));
        if (
            chart.cumulative &&
            temporal &&
            ["newArticles", "newArticleValue"].includes(chart.metric)
        ) {
            const sums = new Map<string, number>();
            result = result.map((b) => {
                const value = (sums.get(b.series) ?? 0) + b.value;
                sums.set(b.series, value);
                return { ...b, value };
            });
        }
        return result;
    }
    if (chart.dimension === "inactivity") {
        const inactivity = articleInactivity(history, today),
            groups = new Map<string, Set<string>>();
        for (const r of articleOrders(rows)) {
            const key = inactivity.get(r.article) ?? "unknown",
                set = groups.get(key) ?? new Set<string>();
            set.add(r.article);
            groups.set(key, set);
        }
        return [...groups]
            .sort(([a], [b]) =>
                a === "unknown"
                    ? 1
                    : b === "unknown"
                      ? -1
                      : parseInt(a) - parseInt(b),
            )
            .slice(0, chart.limit)
            .map(([key, set]) => ({
                key,
                label:
                    key === "unknown"
                        ? "Data assente"
                        : key === "0"
                          ? "Meno di 1 anno"
                          : `${key} anni`,
                series: "Articoli",
                value: set.size,
            }));
    }
    const groups = new Map<
        string,
        { key: string; label: string; series: string; rows: CustomerRow[] }
    >();
    const temporal = ["month", "year", "deliveryMonth"].includes(
        chart.dimension,
    );
    for (const r of rows) {
        if (chart.scope !== "all" && r.kind !== chart.scope) continue;
        if (
            ["delivered", "residual", "backlog"].includes(chart.metric) &&
            r.kind !== "order"
        )
            continue;
        const date =
            chart.dimension === "deliveryMonth"
                ? r.deliveryDate
                : r.documentDate;
        if (chart.dimension === "deliveryMonth" && r.kind !== "order") continue;
        const key =
            chart.dimension === "article"
                ? r.article
                : chart.dimension === "status"
                  ? rowStatus(r, today)
                  : chart.dimension === "kind"
                    ? r.kind === "order"
                        ? "Ordini"
                        : "Offerte"
                    : (date?.slice(0, chart.dimension === "year" ? 4 : 7) ??
                      "Data assente");
        const label = key || "Articolo assente";
        const series = [
            r.kind === "order" ? "Ordini" : "Offerte",
            ...(["quantity", "delivered", "residual"].includes(chart.metric)
                ? [r.unit || "U.M. assente"]
                : ["netAmount", "value", "backlog"].includes(chart.metric)
                  ? [r.currency || "Valuta assente"]
                  : []),
        ].join(" · ");
        const groupId = JSON.stringify([key, series]);
        const group = groups.get(groupId) ?? { key, label, series, rows: [] };
        group.rows.push(r);
        groups.set(groupId, group);
    }
    let buckets = [...groups.values()].map((g) => {
        const value =
            chart.metric === "documents"
                ? new Set(g.rows.map(documentKey)).size
                : chart.metric === "articles"
                  ? new Set(g.rows.map((r) => r.article)).size
                  : chart.metric === "lines"
                    ? g.rows.length
                    : g.rows.reduce(
                          (sum, r) =>
                              sum +
                              ((chart.metric === "quantity"
                                  ? r.quantity
                                  : chart.metric === "delivered"
                                    ? r.deliveredQuantity
                                    : chart.metric === "residual"
                                      ? r.residual
                                      : chart.metric === "netAmount"
                                        ? r.netAmount
                                        : chart.metric === "value"
                                          ? estimatedValue(r)
                                          : backlogValue(r)) ?? 0),
                          0,
                      );
        return { key: g.key, label: g.label, series: g.series, value };
    });
    if (temporal) {
        const keys = [...new Set(buckets.map((b) => b.key))].sort();
        // Fill calendar gaps so the line does not connect non-adjacent periods as adjacent observations.
        const valid = keys.filter((k) => /^\d{4}(-\d{2})?$/.test(k));
        if (valid.length) {
            const start = valid[0],
                end = valid[valid.length - 1],
                calendar: string[] = [];
            let year = +start.slice(0, 4),
                month = chart.dimension === "year" ? 1 : +start.slice(5, 7);
            for (let i = 0; i < 12000; i++) {
                const key =
                    chart.dimension === "year"
                        ? String(year)
                        : `${year}-${String(month).padStart(2, "0")}`;
                if (key > end) break;
                calendar.push(key);
                if (chart.dimension === "year") year++;
                else if (++month > 12) {
                    month = 1;
                    year++;
                }
            }
            const shown = calendar.slice(-chart.limit),
                series = [...new Set(buckets.map((b) => b.series))],
                lookup = new Map(
                    buckets.map((b) => [JSON.stringify([b.key, b.series]), b]),
                );
            buckets = series.flatMap((series) =>
                shown.map(
                    (key) =>
                        lookup.get(JSON.stringify([key, series])) ?? {
                            key,
                            label: key,
                            series,
                            value: 0,
                        },
                ),
            );
        } else
            buckets = buckets.filter((b) =>
                keys.slice(-chart.limit).includes(b.key),
            );
    } else {
        const totals = new Map<string, number>();
        buckets.forEach((b) =>
            totals.set(b.key, (totals.get(b.key) ?? 0) + Math.abs(b.value)),
        );
        const keys = [...totals]
            .sort((a, b) => b[1] - a[1])
            .slice(0, chart.limit)
            .map(([key]) => key);
        buckets = buckets
            .filter((b) => keys.includes(b.key))
            .sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
    }
    if (chart.cumulative && temporal) {
        const sums = new Map<string, number>();
        buckets = buckets.map((b) => {
            const value = (sums.get(b.series) ?? 0) + b.value;
            sums.set(b.series, value);
            return { ...b, value };
        });
    }
    return buckets;
}
export const defaultArticleCharts = (): CustomerChart[] =>
    [
        [
            "article-inactivity",
            "Articoli per fascia di inattività",
            "articles",
            "inactivity",
            "bar",
        ],
        [
            "article-lots",
            "Dimensione media degli ordini",
            "averageLot",
            "year",
            "line",
        ],
        [
            "article-prices",
            "Prezzi netti nel tempo",
            "weightedPrice",
            "year",
            "line",
        ],
        [
            "article-new",
            "Nuovi articoli per anno",
            "newArticles",
            "year",
            "bar",
        ],
        [
            "article-contribution",
            "Contributo dei nuovi articoli",
            "newArticleValue",
            "year",
            "bar",
        ],
        [
            "article-volume",
            "Quantità ordinate per anno",
            "quantity",
            "year",
            "bar",
        ],
        [
            "article-ranking",
            "Valore per articolo",
            "netAmount",
            "article",
            "bar",
        ],
    ].map(
        ([id, title, metric, dimension, kind]) =>
            ({
                id,
                title,
                metric,
                dimension,
                kind,
                scope: "order",
                limit: 20,
                hidden: false,
                cumulative: false,
            }) as CustomerChart,
    );
export type ArticleAnalysisSettings = {
    mode: string;
    dormancy: string;
    trend: string;
    horizon: number;
    display: "both" | "table" | "charts";
};
export const defaultArticleSettings = (): ArticleAnalysisSettings => ({
    mode: "summary",
    dormancy: "",
    trend: "",
    horizon: 3,
    display: "both",
});
function validateArticleSettings(input: any): ArticleAnalysisSettings {
    if (input === undefined) return defaultArticleSettings();
    if (
        !input ||
        ![
            "summary",
            "commercial",
            "annual",
            "orders",
            "cohorts",
            "forecast",
            "forecast-new",
        ].includes(input.mode) ||
        !["", "1", "2", "3", "4", "5", "7", "10"].includes(input.dormancy) ||
        !["", "up", "down", "stable"].includes(input.trend) ||
        !Number.isInteger(input.horizon) ||
        input.horizon < 1 ||
        input.horizon > 5
    )
        throw Error("Opzioni analisi articoli non valide.");
    if (
        input.display !== undefined &&
        !["both", "table", "charts"].includes(input.display)
    )
        throw Error("Visualizzazione articoli non valida.");
    return {
        mode: input.mode,
        dormancy: input.dormancy,
        trend: input.trend,
        horizon: input.horizon,
        display: input.display ?? "both",
    };
}
export type CustomerPreset = {
    id: string;
    name: string;
    charts: CustomerChart[];
    articleCharts?: CustomerChart[];
    articleAnalysis?: ArticleAnalysisSettings;
    filters: CustomerFilters;
    expanded: boolean;
};
export type CustomerPreferences = {
    version: 1;
    charts: CustomerChart[];
    articleCharts: CustomerChart[];
    articleAnalysis: ArticleAnalysisSettings;
    presets: CustomerPreset[];
    expanded: boolean;
};
export const emptyCustomerPreferences = (): CustomerPreferences => ({
    version: 1,
    charts: defaultCustomerCharts(),
    articleCharts: defaultArticleCharts(),
    articleAnalysis: defaultArticleSettings(),
    presets: [],
    expanded: false,
});
function validateCharts(input: any): CustomerChart[] {
    if (!Array.isArray(input) || input.length > 12)
        throw Error("Sono ammessi fino a 12 grafici.");
    const ids = new Set<string>();
    return input.map((c) => {
        if (
            !c ||
            typeof c.id !== "string" ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(c.id) ||
            ids.has(c.id) ||
            typeof c.title !== "string" ||
            !c.title.trim() ||
            c.title.length > 100 ||
            !["bar", "line", "doughnut"].includes(c.kind) ||
            !Object.prototype.hasOwnProperty.call(
                CHART_DIMENSIONS,
                c.dimension,
            ) ||
            !Object.prototype.hasOwnProperty.call(CHART_METRICS, c.metric) ||
            !["all", "order", "offer"].includes(c.scope) ||
            !Number.isInteger(c.limit) ||
            c.limit < 3 ||
            c.limit > 240 ||
            typeof c.hidden !== "boolean" ||
            typeof c.cumulative !== "boolean"
        )
            throw Error("Configurazione grafico non valida.");
        if (
            c.dimension === "inactivity" &&
            (c.metric !== "articles" || c.scope !== "order")
        )
            throw Error(
                "Le fasce di inattività contano gli articoli degli ordini.",
            );
        if (["averageLot", "weightedPrice"].includes(c.metric) && c.cumulative)
            throw Error("Le medie non possono essere cumulate.");
        ids.add(c.id);
        return {
            id: c.id,
            title: c.title.trim(),
            kind: c.kind,
            dimension: c.dimension,
            metric: c.metric,
            scope: c.scope,
            limit: c.limit,
            hidden: c.hidden,
            cumulative: c.cumulative,
        };
    });
}
export function validateCustomerFilters(input: any): CustomerFilters {
    const f = defaultCustomerFilters();
    if (!input || typeof input !== "object" || Array.isArray(input))
        throw Error("Filtri del preset non validi.");
    for (const k of [
        "from",
        "to",
        "deliveryFrom",
        "deliveryTo",
        "article",
        "search",
        "stateBucket",
        "unit",
        "currency",
        "minQuantity",
        "maxQuantity",
        "minPrice",
        "maxPrice",
        "minResidual",
        "maxResidual",
    ] as const) {
        if (typeof input[k] !== "string" || input[k].length > 200)
            throw Error("Filtro non valido.");
        f[k] = input[k];
    }
    if (
        !["all", "order", "offer"].includes(input.kind) ||
        !Object.prototype.hasOwnProperty.call(STATUS_LABELS, input.status) ||
        typeof input.includeCancelled !== "boolean" ||
        !Array.isArray(input.years) ||
        input.years.length > 200 ||
        input.years.some(
            (y: unknown) => typeof y !== "string" || !/^\d{4}$/.test(y),
        )
    )
        throw Error("Filtro non valido.");
    if (
        ![
            "",
            "Offerta",
            "Annullato",
            "Consegnato",
            "Scaduto",
            "Parziale",
            "Da consegnare",
            "Residuo zero",
        ].includes(f.stateBucket)
    )
        throw Error("Stato del grafico non valido.");
    if (typeof input.articleExact !== "boolean")
        throw Error("Corrispondenza articolo non valida.");
    for (const key of ["from", "to", "deliveryFrom", "deliveryTo"] as const)
        if (
            f[key] &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(f[key]) ||
                !Number.isFinite(Date.parse(f[key] + "T00:00:00Z")) ||
                new Date(f[key] + "T00:00:00Z").toISOString().slice(0, 10) !==
                    f[key])
        )
            throw Error("Data filtro non valida.");
    if (f.from && f.to && f.from > f.to)
        throw Error("Intervallo date non valido.");
    if (f.deliveryFrom && f.deliveryTo && f.deliveryFrom > f.deliveryTo)
        throw Error("Intervallo consegne non valido.");
    for (const key of [
        "minQuantity",
        "maxQuantity",
        "minPrice",
        "maxPrice",
        "minResidual",
        "maxResidual",
    ] as const)
        if (f[key] !== "" && !Number.isFinite(Number(f[key])))
            throw Error("Valore numerico non valido.");
    if (
        f.minQuantity !== "" &&
        f.maxQuantity !== "" &&
        Number(f.minQuantity) > Number(f.maxQuantity)
    )
        throw Error("Intervallo quantità non valido.");
    if (
        f.minPrice !== "" &&
        f.maxPrice !== "" &&
        Number(f.minPrice) > Number(f.maxPrice)
    )
        throw Error("Intervallo prezzi non valido.");
    if (
        f.minResidual !== "" &&
        f.maxResidual !== "" &&
        Number(f.minResidual) > Number(f.maxResidual)
    )
        throw Error("Intervallo residui non valido.");
    return {
        ...f,
        kind: input.kind,
        status: input.status,
        years: [...new Set(input.years)] as string[],
        includeCancelled: input.includeCancelled,
        articleExact: input.articleExact,
        selection: validateCustomerSelection(input.selection),
    };
}
export function validateCustomerPreferences(input: any): CustomerPreferences {
    if (
        !input ||
        input.version !== 1 ||
        !Array.isArray(input.presets) ||
        input.presets.length > 10 ||
        typeof input.expanded !== "boolean"
    )
        throw Error("Preset cliente non validi.");
    const ids = new Set<string>();
    const presets = input.presets.map((p: any) => {
        if (
            !p ||
            typeof p.id !== "string" ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) ||
            ids.has(p.id) ||
            typeof p.name !== "string" ||
            !p.name.trim() ||
            p.name.length > 60 ||
            typeof p.expanded !== "boolean"
        )
            throw Error("Nome o identificativo preset non valido.");
        ids.add(p.id);
        return {
            id: p.id,
            name: p.name.trim(),
            charts: validateCharts(p.charts),
            ...(p.articleCharts === undefined
                ? {}
                : { articleCharts: validateCharts(p.articleCharts) }),
            ...(p.articleAnalysis === undefined
                ? {}
                : {
                      articleAnalysis: validateArticleSettings(
                          p.articleAnalysis,
                      ),
                  }),
            filters: validateCustomerFilters(p.filters),
            expanded: p.expanded,
        };
    });
    return {
        version: 1,
        charts: validateCharts(input.charts),
        articleCharts:
            input.articleCharts === undefined
                ? defaultArticleCharts()
                : validateCharts(input.articleCharts),
        articleAnalysis: validateArticleSettings(input.articleAnalysis),
        presets,
        expanded: input.expanded,
    };
}
