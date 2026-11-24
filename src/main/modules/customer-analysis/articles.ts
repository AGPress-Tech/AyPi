import type { CustomerRow, CustomerFilters } from "./model";

export function articleForecastBounds(
    request: { from?: string; to?: string },
    filters: CustomerFilters,
) {
    const selected = filters.selection?.year ?? [],
        manual = filters.years;
    const years = [
        ...new Set(
            manual.length && selected.length
                ? manual.filter((y) => selected.includes(y))
                : [...manual, ...selected],
        ),
    ].sort();
    const from = [
        request.from,
        filters.from,
        years.length ? `${years[0]}-01-01` : "",
    ]
        .filter(Boolean)
        .sort()
        .at(-1);
    const to = [
        request.to,
        filters.to,
        years.length ? `${years.at(-1)}-12-31` : "",
    ]
        .filter(Boolean)
        .sort()[0];
    return {
        from,
        to,
        unavailable:
            !!filters.selection?.month.length ||
            !!(manual.length && selected.length && !years.length) ||
            !!(years.length && years.length !== +years.at(-1)! - +years[0] + 1),
    };
}

// Commercial history only: an order date is never a production date.
export const articleOrders = (rows: readonly CustomerRow[]) =>
    rows.filter(
        (r) =>
            r.kind === "order" &&
            !r.cancelled &&
            !r.headerCancelled &&
            !!r.article,
    );
const group = <T>(rows: readonly T[], key: (r: T) => string) => {
    const result = new Map<string, T[]>();
    for (const r of rows) {
        const k = key(r),
            list = result.get(k) ?? [];
        list.push(r);
        result.set(k, list);
    }
    return result;
};
const key = (r: CustomerRow) => JSON.stringify([r.article, r.unit, r.currency]);
const amount = (r: CustomerRow) =>
    r.netAmount ??
    (r.quantity !== null && r.netPrice !== null
        ? r.quantity * r.netPrice
        : null);
const sum = (
    rows: readonly CustomerRow[],
    fn: (r: CustomerRow) => number | null,
) => {
    const values = rows.map(fn).filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
};
export const percentChange = (
    current: number | null,
    previous: number | null,
) =>
    current === null || previous === null || previous === 0
        ? null
        : (current / previous - 1) * 100;
export function orderMeasures(rows: readonly CustomerRow[]) {
    const orders = new Set(rows.map((r) => r.documentId)).size;
    const quantity = sum(rows, (r) => r.quantity),
        value = sum(rows, amount);
    const priced = rows.filter(
        (r) => r.quantity !== null && r.quantity > 0 && r.netPrice !== null,
    );
    const weight = priced.reduce((s, r) => s + r.quantity!, 0);
    return {
        orders,
        quantity,
        value,
        averageLot: quantity === null || !orders ? null : quantity / orders,
        price: weight
            ? priced.reduce((s, r) => s + r.quantity! * r.netPrice!, 0) / weight
            : null,
        missingQuantity: rows.filter((r) => r.quantity === null).length,
        missingValue: rows.filter((r) => amount(r) === null).length,
        missingPrice: rows.filter((r) => r.netPrice === null).length,
    };
}
export function firstArticleDates(history: readonly CustomerRow[]) {
    const first = new Map<string, string>();
    for (const r of articleOrders(history))
        if (
            r.documentDate &&
            (!first.has(r.article) || r.documentDate < first.get(r.article)!)
        )
            first.set(r.article, r.documentDate);
    return first;
}
export function articleInactivity(
    history: readonly CustomerRow[],
    today: string,
) {
    const last = new Map<string, string>();
    for (const r of articleOrders(history))
        if (
            r.documentDate &&
            r.documentDate <= today &&
            (!last.has(r.article) || r.documentDate > last.get(r.article)!)
        )
            last.set(r.article, r.documentDate);
    return new Map(
        [...last].map(([article, date]) => {
            const years = Math.max(
                0,
                +today.slice(0, 4) -
                    +date.slice(0, 4) -
                    (today.slice(5) < date.slice(5) ? 1 : 0),
            );
            return [article, years >= 10 ? "10+" : String(years)];
        }),
    );
}
export function articleOrderDetails(source: readonly CustomerRow[]) {
    return [
        ...group(articleOrders(source), (r) =>
            JSON.stringify([key(r), r.documentId]),
        ),
    ]
        .map(([, rs]) => ({
            ...orderMeasures(rs),
            article: rs[0].article,
            description: rs[0].description,
            unit: rs[0].unit,
            currency: rs[0].currency,
            key: `order:${rs[0].documentId}`,
            documentNo: rs[0].documentNo,
            documentDate: rs[0].documentDate,
        }))
        .sort(
            (a, b) =>
                (b.documentDate ?? "").localeCompare(a.documentDate ?? "") ||
                a.key.localeCompare(b.key),
        );
}
export function articleLifecycle(
    source: readonly CustomerRow[],
    history: readonly CustomerRow[],
    today: string,
) {
    const first = firstArticleDates(history);
    const full = group(articleOrders(history), (r) => r.article);
    return [...group(articleOrders(source), key)].map(([id, rs]) => {
        const all = (full.get(rs[0].article) ?? rs).filter(
            (r) => r.documentDate && r.documentDate <= today,
        );
        const last =
            all
                .map((r) => r.documentDate!)
                .sort()
                .at(-1) ?? null;
        const lastIds = new Set(
            all.filter((r) => r.documentDate === last).map((r) => r.documentId),
        );
        const lastOrders = all.filter((r) => lastIds.has(r.documentId));
        let inactiveYears: number | null = null;
        if (last)
            inactiveYears = Math.max(
                0,
                +today.slice(0, 4) -
                    +last.slice(0, 4) -
                    (today.slice(5) < last.slice(5) ? 1 : 0),
            );
        const m = orderMeasures(rs),
            latest = orderMeasures(lastOrders.filter((r) => key(r) === id));
        const annual = [
            ...group(
                rs.filter((r) => r.documentDate),
                (r) => r.documentDate!.slice(0, 4),
            ),
        ].sort(([a], [b]) => a.localeCompare(b));
        const lastYear = annual.at(-1),
            previous = lastYear
                ? annual.find(([y]) => +y === +lastYear[0] - 1)
                : undefined;
        const recent = lastYear ? orderMeasures(lastYear[1]) : null,
            prior = previous ? orderMeasures(previous[1]) : null;
        return {
            article: rs[0].article,
            description: rs[0].description,
            unit: rs[0].unit,
            currency: rs[0].currency,
            ...m,
            firstOrder: first.get(rs[0].article) ?? null,
            lastOrder: last,
            inactiveYears,
            lastDocuments: [
                ...new Set(lastOrders.map((r) => r.documentNo)),
            ].join(", "),
            lastOrders: lastIds.size,
            lastQuantity: latest.quantity,
            lastValue: latest.value,
            lastPrice: latest.price,
            comparisonYear: lastYear?.[0] ?? "",
            quantityChange: percentChange(
                recent?.quantity ?? null,
                prior?.quantity ?? null,
            ),
            lotChange: percentChange(
                recent?.averageLot ?? null,
                prior?.averageLot ?? null,
            ),
            priceChange: percentChange(
                recent?.price ?? null,
                prior?.price ?? null,
            ),
        };
    });
}
export function articleAnnual(
    source: readonly CustomerRow[],
    history: readonly CustomerRow[],
    today: string,
) {
    const first = firstArticleDates(history),
        currentYear = +today.slice(0, 4);
    return [
        ...group(
            articleOrders(source).filter((r) => r.documentDate),
            key,
        ),
    ].flatMap(([, rs]) => {
        const years = rs.map((r) => +r.documentDate!.slice(0, 4));
        const start = Math.min(...years),
            end = Math.max(...years);
        let previous: ReturnType<typeof orderMeasures> | null = null;
        return Array.from({ length: end - start + 1 }, (_, i) => {
            const year = String(start + i),
                entries = rs.filter((r) => r.documentDate!.startsWith(year)),
                m = orderMeasures(entries);
            const result = {
                article: rs[0].article,
                description: rs[0].description,
                unit: rs[0].unit,
                currency: rs[0].currency,
                year,
                ...m,
                quantity: entries.length ? m.quantity : 0,
                value: entries.length ? m.value : 0,
                newArticle: first.get(rs[0].article)?.startsWith(year)
                    ? "Sì"
                    : "No",
                partial: +year >= currentYear ? "Sì" : "No",
                quantityChange: percentChange(
                    entries.length ? m.quantity : 0,
                    previous?.quantity ?? null,
                ),
                lotChange: percentChange(
                    m.averageLot,
                    previous?.averageLot ?? null,
                ),
                priceChange: percentChange(m.price, previous?.price ?? null),
            };
            previous = { ...m, quantity: result.quantity, value: result.value };
            return result;
        });
    });
}
export function articleCohorts(
    source: readonly CustomerRow[],
    history: readonly CustomerRow[],
) {
    const first = firstArticleDates(history);
    return [
        ...group(
            articleOrders(source).filter((r) => r.documentDate),
            (r) => JSON.stringify([r.documentDate!.slice(0, 4), r.currency]),
        ),
    ]
        .map(([, rs]) => {
            const year = rs[0].documentDate!.slice(0, 4),
                fresh = rs.filter((r) =>
                    first.get(r.article)?.startsWith(year),
                );
            const existing = rs.filter(
                (r) => !first.get(r.article)?.startsWith(year),
            );
            const value = sum(rs, amount),
                newValue = sum(fresh, amount);
            return {
                year,
                currency: rs[0].currency,
                articles: new Set(rs.map((r) => r.article)).size,
                newArticles: new Set(fresh.map((r) => r.article)).size,
                existingArticles: new Set(existing.map((r) => r.article)).size,
                value,
                newValue: fresh.length ? newValue : 0,
                existingValue: existing.length ? sum(existing, amount) : 0,
                newShare:
                    value && newValue !== null
                        ? (newValue / value) * 100
                        : null,
                orders: new Set(fresh.map((r) => r.documentId)).size,
            };
        })
        .sort((a, b) => a.year.localeCompare(b.year));
}

/** Annual portfolio series; synthetic rows stay internal to the trend estimator. */
export function newArticleSeries(
    source: readonly CustomerRow[],
    history: readonly CustomerRow[],
) {
    const orders = articleOrders(source).filter((r) => r.documentDate);
    if (!orders.length) return [];
    const first = firstArticleDates(history),
        currencies = [...new Set(orders.map((r) => r.currency))];
    return [...group(orders, (r) => r.documentDate!.slice(0, 4))].flatMap(
        ([year, rs]) => {
            const fresh = rs.filter((r) =>
                first.get(r.article)?.startsWith(year),
            );
            const row = (
                article: string,
                unit: string,
                currency: string,
                quantity: number | null,
            ): CustomerRow => ({
                ...rs[0],
                article,
                description: article,
                unit,
                currency,
                quantity,
                documentId: `${article}-${year}-${currency}`,
                documentDate: `${year}-12-31`,
                netPrice: null,
                netAmount: null,
            });
            return [
                row(
                    "Nuovi articoli osservati",
                    "articoli",
                    "",
                    new Set(fresh.map((r) => r.article)).size,
                ),
                ...currencies.map((currency) => {
                    const selected = fresh.filter(
                        (r) => r.currency === currency,
                    );
                    return row(
                        "Valore ordini nuovi articoli",
                        currency || "Valuta assente",
                        currency,
                        selected.some((r) => amount(r) === null)
                            ? null
                            : (sum(selected, amount) ?? 0),
                    );
                }),
            ];
        },
    );
}
export const newArticleForecast = (
    source: readonly CustomerRow[],
    history: readonly CustomerRow[],
    today: string,
    horizon = 3,
    bounds: { from?: string; to?: string } = {},
) => articleForecast(newArticleSeries(source, history), today, horizon, bounds);

// Linear trend on at most five completed calendar years, including zero years.
// Prediction band is an empirical residual band, not a probability guarantee.
export function articleForecast(
    source: readonly CustomerRow[],
    today: string,
    horizon = 3,
    bounds: { from?: string; to?: string } = {},
) {
    const current = +today.slice(0, 4);
    return [
        ...group(
            articleOrders(source).filter(
                (r) => r.documentDate && +r.documentDate.slice(0, 4) < current,
            ),
            key,
        ),
    ].flatMap(([, rs]) => {
        let start = Math.max(
            Math.min(...rs.map((r) => +r.documentDate!.slice(0, 4))),
            current - 5,
        );
        if (bounds.from)
            start = Math.max(
                start,
                +bounds.from.slice(0, 4) +
                    (bounds.from.slice(5) === "01-01" ? 0 : 1),
            );
        const end = Math.min(
            current - 1,
            bounds.to
                ? +bounds.to.slice(0, 4) -
                      (bounds.to.slice(5) === "12-31" ? 0 : 1)
                : current - 1,
        );
        if (end - start + 1 < 3) return [];
        const samples = Array.from({ length: end - start + 1 }, (_, i) =>
            orderMeasures(
                rs.filter((r) => r.documentDate!.startsWith(String(start + i))),
            ),
        );
        if (samples.some((s) => s.missingQuantity)) return [];
        const values = samples.map((s) => s.quantity ?? 0),
            n = values.length;
        const fit = (ys: number[]) => {
            const count = ys.length,
                center = (count - 1) / 2,
                mean = ys.reduce((a, b) => a + b, 0) / count;
            const slope =
                ys.reduce((s, y, x) => s + (x - center) * (y - mean), 0) /
                ys.reduce((s, _, x) => s + (x - center) ** 2, 0);
            return {
                slope,
                predict: (x: number) => mean + slope * (x - center),
            };
        };
        const fitted = fit(values),
            error = Math.sqrt(
                values.reduce(
                    (s, y, x) => s + (y - fitted.predict(x)) ** 2,
                    0,
                ) /
                    (n - 2),
            );
        const holdout = Math.max(0, fit(values.slice(0, -1)).predict(n - 1)),
            last = values[n - 1];
        return Array.from(
            { length: Math.min(5, Math.max(1, horizon)) },
            (_, i) => {
                const year = current + i,
                    distance = year - start,
                    forecast = Math.max(0, fitted.predict(distance));
                const band =
                    1.96 *
                    error *
                    Math.sqrt(
                        1 +
                            1 / n +
                            (distance - (n - 1) / 2) ** 2 /
                                values.reduce(
                                    (s, _, x) => s + (x - (n - 1) / 2) ** 2,
                                    0,
                                ),
                    );
                return {
                    article: rs[0].article,
                    description: rs[0].description,
                    unit: rs[0].unit,
                    currency: rs[0].currency,
                    year: String(year),
                    forecast,
                    lower: Math.max(0, forecast - band),
                    upper: forecast + band,
                    samples: n,
                    training: `${start}–${end}`,
                    slope: fitted.slope,
                    backtestError: Math.abs(last - holdout),
                    backtestPercent: last
                        ? (Math.abs(last - holdout) / Math.abs(last)) * 100
                        : null,
                };
            },
        );
    });
}
