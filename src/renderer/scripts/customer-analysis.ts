import Chart from "chart.js/auto";
import {
    analysisChartControls,
    setChartExpanded,
} from "../modules/analysis-chart-controls";
import { analysisSelectionHighlight } from "../modules/analysis-selection-highlight";
import { installAnalysisLinks } from "../modules/analysis-links";
import {
    contextFromAnalysisElement,
    loadDocumentLinks,
    toggleDocumentLinks,
} from "../modules/document-links";
import type { AnalysisContext } from "../../main/modules/analysis-navigation-model";
import {
    CustomerRow,
    CustomerFilters,
    CustomerChart,
    CustomerPreferences,
    defaultCustomerFilters,
    defaultCustomerCharts,
    emptyCustomerPreferences,
    normalizeCustomerRows,
    validateCustomerFilters,
    validateCustomerPreferences,
    filterCustomerRows,
    customerStats,
    documentKey,
    rowStatus,
    estimatedValue,
    backlogValue,
    customerChartData,
    CHART_DIMENSIONS,
    CHART_METRICS,
    STATUS_LABELS,
    CustomerSelection,
    emptyCustomerSelection,
    toggleCustomerSelection,
    CUSTOMER_SELECTION_DIMENSIONS,
} from "../../main/modules/customer-analysis/model";
import {
    SortCriterion,
    sortByCriteria,
} from "../../main/modules/analysis-sorting";
import { bindSortingHeaders, updateSortingBar } from "../modules/table-sorting";

const ipc = require("electron").ipcRenderer;
const $ = (id: string) => document.getElementById(id)!;
const input = (id: string) => $(id) as HTMLInputElement;
const select = (id: string) => $(id) as HTMLSelectElement;
const esc = (v: unknown) =>
    String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c]!,
    );
const num = (v: number | null | undefined, digits = 2) =>
    v == null
        ? "—"
        : new Intl.NumberFormat("it-IT", {
              maximumFractionDigits: digits,
          }).format(v);
const date = (v: string | null | undefined) =>
    v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "—";
const today = () =>
    new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const newId = () =>
    `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
let rows: CustomerRow[] = [],
    filtered: CustomerRow[] = [],
    loaded: {
        customer: string;
        name: string;
        queriedAt: string;
        request: any;
    } | null = null;
let customers: { code: string; name: string }[] = [],
    filters = defaultCustomerFilters(),
    preferences = emptyCustomerPreferences();
let view = "dashboard",
    busy = false,
    searching = false,
    saving = false,
    preferencesWarning = "",
    editingChart: string | null = null,
    zoomed: string | null = null,
    zoomTrigger: HTMLElement | null = null;
let searchGeneration = 0;
let initialized = false,
    pendingAnalysisContext: AnalysisContext | null = null,
    contextGeneration = 0;
const charts = new Map<string, Chart<any>>();
let chartBaseRows: CustomerRow[] = [];
const hasChartSelection = () =>
    CUSTOMER_SELECTION_DIMENSIONS.some(
        (key) => filters.selection?.[key].length,
    );
const pages: Record<string, number> = {
    documents: 0,
    lines: 0,
    articles: 0,
    history: 0,
};
const sorting: Record<string, SortCriterion[]> = {
    documents: [{ key: "documentDate", direction: "desc" }],
    lines: [{ key: "documentDate", direction: "desc" }],
    articles: [{ key: "orders", direction: "desc" }],
    history: [{ key: "year", direction: "asc" }],
};
const PAGE_SIZE = 100;
const theme = getComputedStyle(document.body),
    accent = theme.getPropertyValue("--ops-accent").trim() || "#168deb";
const palette = [
    accent,
    "#438f89",
    "#74859b",
    "#bd9c61",
    "#8c89a4",
    "#bd647c",
    "#729ca9",
    "#587486",
];
Chart.defaults.font.family = theme.fontFamily;
Chart.defaults.color =
    theme.getPropertyValue("--ops-muted").trim() || "#647587";
function status(message: string, error = false) {
    $("status").textContent = message;
    $("status").hidden = !message;
    $("status").classList.toggle("error", error);
}
function notice(message: string, error = false) {
    $("chartsMessage").textContent = message;
    $("chartsMessage").classList.toggle("error-text", error);
}
function options(values: Record<string, string>) {
    return Object.entries(values)
        .map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`)
        .join("");
}
select("state").innerHTML = options(STATUS_LABELS);
select("chartDimension").innerHTML = options(CHART_DIMENSIONS);
select("chartMetric").innerHTML = options(CHART_METRICS);
function updateBusy() {
    (input("loadCustomer") as any).disabled =
        busy || !select("customerResults").value;
    (input("refresh") as any).disabled = busy || !loaded;
    (input("export") as any).disabled = busy || !loaded;
    select("customerResults").disabled = busy;
}
function readFilters() {
    const candidate: CustomerFilters = {
        ...filters,
        kind: select("kind").value as CustomerFilters["kind"],
        from: input("from").value,
        to: input("to").value,
        article: input("article").value,
        search: input("search").value,
        status: select("state").value as CustomerFilters["status"],
        unit: select("unit").value,
        currency: select("currency").value,
        includeCancelled: input("includeCancelled").checked,
        minQuantity: input("minQuantity").value,
        maxQuantity: input("maxQuantity").value,
    };
    for (const key of [
        "deliveryFrom",
        "deliveryTo",
        "minPrice",
        "maxPrice",
        "minResidual",
        "maxResidual",
    ] as const)
        candidate[key] = input(key).value;
    candidate.articleExact = input("articleExact").checked;
    try {
        filters = validateCustomerFilters(candidate);
        return true;
    } catch (error) {
        status((error as Error).message, true);
        return false;
    }
}
function syncFilters() {
    for (const key of ["unit", "currency"] as const)
        if (
            filters[key] &&
            !Array.from(select(key).options).some(
                (o) => o.value === filters[key],
            )
        ) {
            const option = document.createElement("option");
            option.value = filters[key];
            option.textContent = filters[key] + " (non presente nella lettura)";
            select(key).append(option);
        }
    for (const key of [
        "kind",
        "from",
        "to",
        "deliveryFrom",
        "deliveryTo",
        "article",
        "search",
        "unit",
        "currency",
        "minQuantity",
        "maxQuantity",
        "minPrice",
        "maxPrice",
        "minResidual",
        "maxResidual",
    ] as const)
        input(key).value = filters[key];
    select("state").value = filters.status;
    input("includeCancelled").checked = filters.includeCancelled;
    input("articleExact").checked = filters.articleExact;
    $("yearOptions")
        .querySelectorAll<HTMLInputElement>("input[data-year]")
        .forEach(
            (el) => (el.checked = filters.years.includes(el.dataset.year!)),
        );
}
function setupFilterOptions() {
    for (const key of ["unit", "currency"] as const) {
        const values = [...new Set(rows.map((r) => r[key]))]
            .filter(Boolean)
            .sort();
        select(key).innerHTML =
            '<option value="">Tutte</option>' +
            values
                .map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)
                .join("");
    }
    const years = [
        ...new Set(
            rows.map((r) => r.documentDate?.slice(0, 4)).filter(Boolean),
        ),
    ].sort() as string[];
    $("yearOptions").innerHTML =
        '<span>Esercizi:</span><button type="button" data-years="all">Tutti</button><button type="button" data-years="last2">Ultimi 2</button>' +
        years
            .map(
                (y) =>
                    `<label><input type="checkbox" data-year="${y}">${y}</label>`,
            )
            .join("");
}
function filterChips() {
    const chips: { label: string; keys: (keyof CustomerFilters)[] }[] = [];
    if (filters.kind !== "all")
        chips.push({
            label: filters.kind === "order" ? "Solo ordini" : "Solo offerte",
            keys: ["kind"],
        });
    if (filters.from || filters.to)
        chips.push({
            label: `${date(filters.from)} → ${date(filters.to)}`,
            keys: ["from", "to"],
        });
    if (filters.deliveryFrom || filters.deliveryTo)
        chips.push({
            label: `Consegna: ${date(filters.deliveryFrom)} → ${date(filters.deliveryTo)}`,
            keys: ["deliveryFrom", "deliveryTo"],
        });
    if (filters.years.length)
        chips.push({ label: filters.years.join(", "), keys: ["years"] });
    if (filters.status !== "all")
        chips.push({ label: STATUS_LABELS[filters.status], keys: ["status"] });
    if (filters.stateBucket)
        chips.push({
            label: `Stato grafico: ${filters.stateBucket}`,
            keys: ["stateBucket"],
        });
    for (const key of ["article", "search", "unit", "currency"] as const)
        if (filters[key])
            chips.push({
                label: `${{ article: "Articolo", search: "Ricerca", unit: "U.M.", currency: "Valuta" }[key]}: ${filters[key]}`,
                keys: [key],
            });
    if (filters.minQuantity !== "" || filters.maxQuantity !== "")
        chips.push({
            label: `Quantità: ${filters.minQuantity || "—"} → ${filters.maxQuantity || "—"}`,
            keys: ["minQuantity", "maxQuantity"],
        });
    if (filters.minPrice !== "" || filters.maxPrice !== "")
        chips.push({
            label: `Prezzo netto: ${filters.minPrice || "—"} → ${filters.maxPrice || "—"}`,
            keys: ["minPrice", "maxPrice"],
        });
    if (filters.minResidual !== "" || filters.maxResidual !== "")
        chips.push({
            label: `Residuo: ${filters.minResidual || "—"} → ${filters.maxResidual || "—"}`,
            keys: ["minResidual", "maxResidual"],
        });
    if (filters.articleExact)
        chips.push({ label: "Codice articolo esatto", keys: ["articleExact"] });
    if (filters.includeCancelled)
        chips.push({ label: "Annullati inclusi", keys: ["includeCancelled"] });
    $("activeFilters").innerHTML = chips
        .map(
            (c) =>
                `<button class="selection-chip" data-clear-filter="${c.keys.join(",")}" title="Rimuovi filtro">${esc(c.label)} ×</button>`,
        )
        .join("");
    const selection = filters.selection ?? emptyCustomerSelection();
    const labels: Record<keyof CustomerSelection, string> = {
        article: "Articoli",
        month: "Mesi",
        year: "Anni",
        status: "Stati",
        kind: "Documenti",
        deliveryMonth: "Consegne",
    };
    $("activeFilters").innerHTML += CUSTOMER_SELECTION_DIMENSIONS.filter(
        (key) => selection[key].length,
    )
        .map((key) => {
            const values = selection[key].map((v) =>
                key === "kind" ? (v === "order" ? "Ordini" : "Offerte") : v,
            );
            return `<button class="selection-chip" data-clear-chart-dimension="${key}" title="${esc(values.join(", "))}">${labels[key]}: ${esc(values.slice(0, 2).join(", "))}${values.length > 2 ? " +" + (values.length - 2) : ""} ×</button>`;
        })
        .join("");
}
type Measure = { value: number; label: string };
function cleanMeasures(values: Measure[]): Measure[] {
    const known = values.filter(
        (v) =>
            !["U.M. assente", "Valuta assente"].includes(v.label) ||
            Math.abs(v.value) > 1e-9,
    );
    const nonzero = known
        .filter((v) => Math.abs(v.value) > 1e-9)
        .sort((a, b) =>
            a.label.localeCompare(b.label, "it", { numeric: true }),
        );
    return nonzero.length
        ? nonzero
        : known.length
          ? [{ value: 0, label: "" }]
          : [];
}
function measureText(values: Measure[], digits = 4) {
    return (
        values
            .map(
                (v) => `${num(v.value, digits)}${v.label ? " " + v.label : ""}`,
            )
            .join("\n") || "—"
    );
}
function measureMarkup(values: Measure[], digits = 4) {
    return values.length
        ? `<span class="measure-stack">${values.map((v) => `<span class="measure-row"><span class="measure-value">${num(v.value, digits)}</span>${v.label ? `<span class="measure-unit">${esc(v.label === "U.M. assente" ? "Senza U.M." : v.label === "Valuta assente" ? "Senza valuta" : v.label)}</span>` : ""}</span>`).join("")}</span>`
        : "—";
}
function kpis() {
    const s = customerStats(filtered, today());
    const cards = [
        {
            label: "Ordini",
            value: num(s.orders, 0),
            note: `${num(s.lines, 0)} righe selezionate complessive`,
            action: "orders",
        },
        {
            label: "Offerte",
            value: num(s.offers, 0),
            note: "Documenti distinti · non conversioni",
            action: "offers",
        },
        {
            label: "Articoli diversi",
            value: num(s.articles, 0),
            note: "Codici distinti nei filtri",
            action: "articles",
        },
        {
            label: "Ordini con residuo",
            value: num(s.open, 0),
            note: "Almeno una riga da consegnare",
            action: "open",
        },
        {
            label: "Ordini scaduti",
            value: num(s.overdue, 0),
            note: `Consegna prevista prima del ${date(today())}`,
            action: "overdue",
        },
        {
            label: "Quantità ordinate",
            value: measureText(
                cleanMeasures(
                    s.units.map((u) => ({ value: u.orders, label: u.unit })),
                ),
            ),
            note: "",
            action: "",
        },
    ];
    $("kpis").innerHTML = cards
        .map(
            (c) =>
                `<article class="kpi ${c.action ? "clickable" : "quantity-kpi"}" ${c.action ? `role="button" tabindex="0" data-kpi="${c.action}"` : ""} title="${esc(c.note)}"><small>${esc(c.label)}</small>${c.action ? `<strong>${esc(c.value)}</strong>` : `<div class="kpi-quantity">${measureMarkup(cleanMeasures(s.units.map((u) => ({ value: u.orders, label: u.unit }))))}</div>`}</article>`,
        )
        .join("");
}
function summaryTables() {
    const s = customerStats(filtered, today());
    return `<div class="customer-summary-grid"><article class="panel"><div class="panel-head"><div><h2>Quantità per unità di misura</h2><p>Quantità ordini e offerte separate · ${filters.status === "cancelled" || filters.stateBucket === "Annullato" ? "solo annullati" : filters.includeCancelled ? "annullati inclusi" : "annullati esclusi"}</p></div></div><div class="table-scroll"><table><thead><tr><th>U.M.</th><th>Ordinate</th><th>Offerte</th><th>Consegnate</th><th>Residue</th></tr></thead><tbody>${
        s.units
            .filter(
                (u) =>
                    u.unit !== "U.M. assente" ||
                    [u.orders, u.offers, u.delivered, u.residual].some(
                        (v) => Math.abs(v) > 1e-9,
                    ),
            )
            .map(
                (u) =>
                    `<tr><td>${esc(u.unit)}</td>${[u.orders, u.offers, u.delivered, u.residual].map((v) => `<td class="numeric">${num(v, 4)}</td>`).join("")}</tr>`,
            )
            .join("") ||
        '<tr><td colspan="5">Nessuna quantità nei filtri</td></tr>'
    }</tbody></table></div></article><article class="panel"><div class="panel-head"><div><h2>Imponibili e portafoglio per valuta</h2><p>Imponibile dal gestionale · portafoglio stimato · non è fatturato</p></div></div><div class="table-scroll"><table><thead><tr><th>Valuta</th><th>Imponibile ordini</th><th>Imponibile offerte</th><th>Portafoglio stimato</th><th>Senza imponibile</th></tr></thead><tbody>${
        s.currencies
            .filter(
                (v) =>
                    v.currency !== "Valuta assente" ||
                    [v.netOrders, v.netOffers, v.backlog].some(
                        (n) => Math.abs(n) > 1e-9,
                    ),
            )
            .map(
                (v) =>
                    `<tr><td>${esc(v.currency)}</td>${[v.netOrders, v.netOffers, v.backlog].map((n) => `<td class="numeric">${num(n)}</td>`).join("")}<td class="numeric">${num(v.missingAmount, 0)}</td></tr>`,
            )
            .join("") ||
        '<tr><td colspan="5">Nessun valore nei filtri</td></tr>'
    }</tbody></table></div></article></div>`;
}
function clearCharts() {
    charts.forEach((c) => c.destroy());
    charts.clear();
}
function chartPanel(c: CustomerChart) {
    return `<article class="panel chart-panel" data-chart-id="${c.id}"><div class="panel-head"><div><h2>${esc(c.title)}</h2><p>${esc(CHART_METRICS[c.metric])} · ${esc(CHART_DIMENSIONS[c.dimension])} · ${c.scope === "all" ? "ordini e offerte" : c.scope === "order" ? "ordini" : "offerte"}${c.cumulative ? " · cumulato nei periodi mostrati" : ""}</p></div><div class="panel-actions">${analysisChartControls(c.id, c.title, zoomed === c.id, ["month", "deliveryMonth"].includes(c.dimension) ? c.cumulative : undefined)}</div></div><div class="chart"><div class="chart-viewport"><canvas id="plot-${c.id}" role="img" aria-label="${esc(c.title)}"></canvas></div></div><div class="chart-footnote" id="note-${c.id}"></div></article>`;
}
function drawChart(c: CustomerChart) {
    const active = hasChartSelection(),
        temporal = ["month", "year", "deliveryMonth"].includes(c.dimension);
    const rawBuckets = customerChartData(
        chartBaseRows,
        { ...c, cumulative: false },
        today(),
    );
    const selectedRaw = customerChartData(
        filtered,
        { ...c, cumulative: false, limit: 240 },
        today(),
    );
    const bucketId = (key: string, series: string) =>
        JSON.stringify([key, series]);
    const selectedRawLookup = new Map(
        selectedRaw.map((b) => [bucketId(b.key, b.series), b.value]),
    );
    const totalRunning = new Map<string, number>(),
        selectedRunning = new Map<string, number>();
    const selectedLookup = new Map<string, number>();
    for (const b of rawBuckets) {
        let selected = selectedRawLookup.get(bucketId(b.key, b.series)) ?? 0;
        if (c.cumulative && temporal) {
            b.value += totalRunning.get(b.series) ?? 0;
            totalRunning.set(b.series, b.value);
            selected += selectedRunning.get(b.series) ?? 0;
            selectedRunning.set(b.series, selected);
        }
        selectedLookup.set(bucketId(b.key, b.series), selected);
    }
    const nonzeroSeries = new Set(
        rawBuckets
            .filter(
                (b) =>
                    Math.abs(b.value) > 1e-9 ||
                    Math.abs(
                        selectedLookup.get(bucketId(b.key, b.series)) ?? 0,
                    ) > 1e-9,
            )
            .map((b) => b.series),
    );
    const buckets = rawBuckets.filter(
            (b) => !b.series.includes("assente") || nonzeroSeries.has(b.series),
        ),
        labels = [...new Set(buckets.map((b) => b.label))],
        series = [...new Set(buckets.map((b) => b.series))];
    const negative = buckets.some(
            (b) =>
                b.value < 0 ||
                (active &&
                    (selectedLookup.get(bucketId(b.key, b.series)) ?? 0) < 0),
        ),
        kind = c.kind === "doughnut" && negative ? "bar" : c.kind;
    const horizontal = kind === "bar" && !temporal;
    const domain = buckets.reduce(
        (bounds, b) => ({
            min: Math.min(
                bounds.min,
                b.value,
                active
                    ? (selectedLookup.get(bucketId(b.key, b.series)) ?? 0)
                    : 0,
            ),
            max: Math.max(
                bounds.max,
                b.value,
                active
                    ? (selectedLookup.get(bucketId(b.key, b.series)) ?? 0)
                    : 0,
            ),
        }),
        { min: 0, max: 0 },
    );
    const lookup = new Map(
        buckets.map((b) => [JSON.stringify([b.label, b.series]), b.value]),
    );
    const datasets =
        kind === "doughnut"
            ? [
                  {
                      label: CHART_METRICS[c.metric],
                      data: buckets.map((b) => b.value),
                      backgroundColor: buckets.map(
                          (_, i) =>
                              palette[i % palette.length] +
                              (active ? "35" : ""),
                      ),
                      highlightColors: buckets.map(
                          (_, i) => palette[i % palette.length],
                      ),
                      highlightValues: active
                          ? buckets.map(
                                (b) =>
                                    selectedLookup.get(
                                        bucketId(b.key, b.series),
                                    ) ?? 0,
                            )
                          : undefined,
                      borderWidth: 2,
                      borderColor: "#fff",
                  },
              ]
            : series.flatMap((s, i) => {
                  const selected = labels.map((label) => {
                      const b = buckets.find(
                          (b) => b.label === label && b.series === s,
                      );
                      return b
                          ? (selectedLookup.get(bucketId(b.key, s)) ?? 0)
                          : 0;
                  });
                  const source = {
                      label: s,
                      sourceSeries: s,
                      data: labels.map(
                          (l) => lookup.get(JSON.stringify([l, s])) ?? 0,
                      ),
                      borderColor:
                          palette[i % palette.length] + (active ? "40" : ""),
                      backgroundColor:
                          palette[i % palette.length] +
                          (active ? "35" : kind === "line" ? "25" : ""),
                      highlightValues:
                          active && kind === "bar" ? selected : undefined,
                      highlightColor: palette[i % palette.length],
                      borderWidth: kind === "line" ? 2 : 0,
                      pointRadius: labels.length > 70 ? 1 : 3,
                      tension: 0.18,
                      fill: false,
                      borderRadius: kind === "bar" ? 3 : 0,
                      maxBarThickness: 24,
                  };
                  return kind === "line" && active
                      ? [
                            { ...source, order: 1 },
                            {
                                ...source,
                                label: s + " · selezione",
                                data: selected,
                                borderColor: palette[i % palette.length],
                                backgroundColor: palette[i % palette.length],
                                highlightSeries: true,
                                order: 0,
                            },
                        ]
                      : [source];
              });
    const chartLabels =
        kind === "doughnut"
            ? buckets.map((b) => `${b.label} · ${b.series}`)
            : labels;
    const canvas = $(`plot-${c.id}`) as HTMLCanvasElement;
    const chart = new Chart(canvas, {
        type: kind,
        data: { labels: chartLabels, datasets: datasets as any },
        plugins: [analysisSelectionHighlight],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            indexAxis: horizontal ? "y" : "x",
            interaction: { intersect: true },
            plugins: {
                legend: {
                    display:
                        kind === "doughnut"
                            ? buckets.length <= 10
                            : series.length <= 12,
                    position: "bottom",
                    labels: {
                        font: { size: 10 },
                        boxWidth: 10,
                        filter: (item) =>
                            !(datasets[item.datasetIndex] as any)
                                ?.highlightSeries,
                    },
                    onClick: (event, item) => {
                        const native = event.native as MouseEvent | null,
                            multiple = !!(native?.ctrlKey || native?.metaKey);
                        if (kind === "doughnut") {
                            const b = buckets[item.index!];
                            if (b) drillChart(c, b.key, multiple);
                        } else {
                            const dataset = datasets[item.datasetIndex!] as any;
                            drillChart(
                                { ...c, dimension: "kind" },
                                String(dataset.sourceSeries).startsWith(
                                    "Ordini",
                                )
                                    ? "order"
                                    : "offer",
                                multiple,
                            );
                        }
                    },
                },
                tooltip: {
                    backgroundColor: "#1b344b",
                    padding: 11,
                    callbacks: {
                        label: (ctx) => {
                            if (!active)
                                return `${ctx.dataset.label}: ${num(Number(ctx.raw), 4)}`;
                            const s = (ctx.dataset as any).sourceSeries,
                                b =
                                    kind === "doughnut"
                                        ? buckets[ctx.dataIndex]
                                        : buckets.find(
                                              (b) =>
                                                  b.label ===
                                                      labels[ctx.dataIndex] &&
                                                  b.series === s,
                                          );
                            return b
                                ? [
                                      b.series,
                                      `Totale: ${num(b.value, 4)}`,
                                      `Selezione: ${num(selectedLookup.get(bucketId(b.key, b.series)) ?? 0, 4)}`,
                                  ]
                                : "";
                        },
                    },
                },
            },
            ...(kind === "doughnut"
                ? { cutout: "65%" }
                : {
                      scales: {
                          x: {
                              beginAtZero: true,
                              ...(horizontal
                                  ? {
                                        suggestedMin: domain.min,
                                        suggestedMax: domain.max,
                                    }
                                  : {}),
                              ticks: {
                                  maxTicksLimit: 12,
                                  font: { size: 10 },
                                  callback: function (value) {
                                      return horizontal
                                          ? num(Number(value))
                                          : this.getLabelForValue(
                                                Number(value),
                                            ).slice(0, 25);
                                  },
                              },
                              grid: { display: horizontal },
                          },
                          y: {
                              beginAtZero: true,
                              ...(!horizontal
                                  ? {
                                        suggestedMin: domain.min,
                                        suggestedMax: domain.max,
                                    }
                                  : {}),
                              ticks: {
                                  font: { size: 10 },
                                  callback: function (value) {
                                      return horizontal
                                          ? this.getLabelForValue(
                                                Number(value),
                                            ).slice(0, 26)
                                          : num(Number(value));
                                  },
                              },
                              grid: { display: !horizontal },
                          },
                      },
                  }),
            onClick: (_event, elements) => {
                if (!elements.length) return;
                const b =
                    kind === "doughnut"
                        ? buckets[elements[0].index]
                        : buckets.find(
                              (b) => b.label === labels[elements[0].index],
                          );
                const native = _event?.native as MouseEvent | null;
                if (b)
                    drillChart(
                        c,
                        b.key,
                        !!(native?.ctrlKey || native?.metaKey),
                    );
            },
            onHover: (_event, elements) => {
                canvas.style.cursor = elements.length ? "pointer" : "default";
            },
        },
    });
    canvas.onmouseleave = () => {
        chart.setActiveElements([]);
        chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
        chart.update("none");
        canvas.style.cursor = "default";
    };
    charts.set(c.id, chart);
    const message = !buckets.length
        ? "Nessun dato nei filtri correnti."
        : negative && c.kind === "doughnut"
          ? "Valori negativi: vista a barre."
          : "";
    $(`note-${c.id}`).textContent = message;
    $(`note-${c.id}`).hidden = !message;
}
function drillChart(c: CustomerChart, key: string, multiple = false) {
    const dimension = c.dimension as keyof CustomerSelection;
    if (
        !CUSTOMER_SELECTION_DIMENSIONS.includes(dimension) ||
        (["month", "deliveryMonth"].includes(dimension) &&
            !/^\d{4}-\d{2}$/.test(key)) ||
        (dimension === "year" && !/^\d{4}$/.test(key))
    )
        return;
    if (dimension === "kind")
        key = key === "Ordini" ? "order" : key === "Offerte" ? "offer" : key;
    filters.selection = toggleCustomerSelection(
        filters.selection ?? emptyCustomerSelection(),
        dimension,
        key,
        multiple,
    );
    syncFilters();
    applyFilters();
}
function resetChartSelections() {
    filters.selection = emptyCustomerSelection();
    syncFilters();
    applyFilters();
}

type Column = {
    key: string;
    label: string;
    kind?:
        | "number"
        | "money"
        | "date"
        | "bool"
        | "document"
        | "article"
        | "status"
        | "measure";
};
const rowColumns: Column[] = [
    { key: "documentNo", label: "Documento", kind: "document" },
    { key: "kindLabel", label: "Tipo" },
    { key: "documentDate", label: "Data documento", kind: "date" },
    { key: "deliveryDate", label: "Consegna prevista", kind: "date" },
    { key: "article", label: "Articolo", kind: "article" },
    { key: "description", label: "Descrizione" },
    { key: "line", label: "Riga", kind: "number" },
    { key: "status", label: "Stato riga", kind: "status" },
    { key: "active", label: "Attivo (non annullato)" },
    { key: "quantity", label: "Quantità", kind: "number" },
    { key: "unit", label: "U.M." },
    { key: "deliveredQuantity", label: "Consegnato", kind: "number" },
    { key: "residual", label: "Residuo", kind: "number" },
    { key: "unitPrice", label: "Prezzo unitario", kind: "money" },
    { key: "netPrice", label: "Prezzo netto", kind: "money" },
    { key: "value", label: "Valore netto stimato", kind: "money" },
    { key: "backlog", label: "Portafoglio stimato", kind: "money" },
    { key: "currency", label: "Valuta" },
];
rowColumns.splice(
    3,
    0,
    { key: "createdDate", label: "Inserimento documento", kind: "date" },
    { key: "lineCreatedDate", label: "Inserimento riga", kind: "date" },
);
rowColumns.push(
    {
        key: "confirmedDeliveryDate",
        label: "Consegna confermata",
        kind: "date",
    },
    { key: "validityDate", label: "Validità offerta fino al", kind: "date" },
    { key: "netAmount", label: "Imponibile riga (gestionale)", kind: "money" },
    { key: "headerDelivered", label: "Testata consegnata", kind: "bool" },
    { key: "headerCancelled", label: "Testata annullata", kind: "bool" },
);
const documentColumns: Column[] = [
    { key: "documentNo", label: "Documento", kind: "document" },
    { key: "kindLabel", label: "Tipo" },
    { key: "documentDate", label: "Data documento", kind: "date" },
    { key: "createdDate", label: "Inserimento", kind: "date" },
    { key: "firstDelivery", label: "Prima consegna", kind: "date" },
    { key: "lastDelivery", label: "Ultima consegna", kind: "date" },
    { key: "lines", label: "Righe", kind: "number" },
    { key: "articles", label: "Articoli", kind: "number" },
    { key: "status", label: "Stati delle righe" },
    { key: "quantitySummary", label: "Quantità", kind: "measure" },
    { key: "residualSummary", label: "Residuo", kind: "measure" },
    { key: "netSummary", label: "Imponibile", kind: "measure" },
    { key: "headerDelivered", label: "Testata consegnata", kind: "bool" },
    { key: "headerCancelled", label: "Testata annullata", kind: "bool" },
];
const articleColumns: Column[] = [
    { key: "article", label: "Articolo", kind: "article" },
    { key: "description", label: "Descrizione" },
    { key: "orders", label: "Ordini", kind: "number" },
    { key: "offers", label: "Offerte", kind: "number" },
    { key: "orderQuantity", label: "Quantità ordinate", kind: "measure" },
    { key: "offerQuantity", label: "Quantità offerte", kind: "measure" },
    { key: "deliveredSummary", label: "Consegnato", kind: "measure" },
    { key: "residualSummary", label: "Residuo", kind: "measure" },
    { key: "netOrdersSummary", label: "Imponibile ordini", kind: "measure" },
    { key: "netOffersSummary", label: "Imponibile offerte", kind: "measure" },
    { key: "first", label: "Primo documento", kind: "date" },
    { key: "last", label: "Ultimo documento", kind: "date" },
];
const historyColumns: Column[] = [
    { key: "year", label: "Anno" },
    { key: "orders", label: "Ordini", kind: "number" },
    { key: "ordersDelta", label: "Δ ordini", kind: "number" },
    { key: "offers", label: "Offerte", kind: "number" },
    { key: "offersDelta", label: "Δ offerte", kind: "number" },
    { key: "articles", label: "Articoli", kind: "number" },
    { key: "open", label: "Ordini con residuo", kind: "number" },
    { key: "overdue", label: "Ordini scaduti", kind: "number" },
    ...articleColumns.filter((c) =>
        [
            "orderQuantity",
            "offerQuantity",
            "netOrdersSummary",
            "netOffersSummary",
        ].includes(c.key),
    ),
];
function grouped<K>(
    source: readonly CustomerRow[],
    key: (r: CustomerRow) => K,
) {
    const groups = new Map<K, CustomerRow[]>();
    for (const r of source) {
        const k = key(r),
            g = groups.get(k) ?? [];
        g.push(r);
        groups.set(k, g);
    }
    return groups;
}
function summaryRow(rs: CustomerRow[]) {
    const s = customerStats(rs, today());
    const units = (
        field: "orders" | "offers" | "delivered" | "residual",
        kind: "order" | "offer",
    ) =>
        s[kind === "order" ? "orders" : "offers"]
            ? cleanMeasures(
                  s.units.map((u) => ({ value: u[field], label: u.unit })),
              )
            : [];
    return {
        ...s,
        orderQuantity: units("orders", "order"),
        offerQuantity: units("offers", "offer"),
        deliveredSummary: units("delivered", "order"),
        residualSummary: units("residual", "order"),
        netOrdersSummary: rs.some(
            (r) => r.kind === "order" && r.netAmount !== null,
        )
            ? cleanMeasures(
                  s.currencies.map((v) => ({
                      value: v.netOrders,
                      label: v.currency,
                  })),
              )
            : [],
        netOffersSummary: rs.some(
            (r) => r.kind === "offer" && r.netAmount !== null,
        )
            ? cleanMeasures(
                  s.currencies.map((v) => ({
                      value: v.netOffers,
                      label: v.currency,
                  })),
              )
            : [],
    };
}
function lineRows(rs: CustomerRow[]) {
    return rs.map((r) => ({
        ...r,
        key: documentKey(r),
        kindLabel: r.kind === "order" ? "Ordine" : "Offerta",
        active:
            r.kind === "offer" ? "Non disponibile" : r.cancelled ? "No" : "Sì",
        status: rowStatus(r, today()),
        value: estimatedValue(r),
        backlog: backlogValue(r),
    }));
}
function tableData() {
    if (view === "lines")
        return {
            columns: rowColumns,
            data: lineRows(filtered),
            title: "Righe articolo e consegne",
            note: "",
        };
    if (view === "documents")
        return {
            columns: documentColumns,
            data: [...grouped(filtered, documentKey)].map(([key, rs]) => {
                const s = summaryRow(rs),
                    dates = rs
                        .map((r) => r.deliveryDate)
                        .filter(Boolean)
                        .sort(),
                    cancelled = rs.filter((r) => r.cancelled).length;
                return {
                    ...s,
                    key,
                    createdDate: rs[0].createdDate,
                    headerDelivered: rs[0].headerDelivered,
                    headerCancelled: rs[0].headerCancelled,
                    documentNo: rs[0].documentNo,
                    documentDate: rs[0].documentDate,
                    kindLabel: rs[0].kind === "order" ? "Ordine" : "Offerta",
                    firstDelivery: dates[0] ?? null,
                    lastDelivery: dates.at(-1) ?? null,
                    status: [
                        ...new Set(rs.map((r) => rowStatus(r, today()))),
                    ].join(", "),
                    active:
                        rs[0].kind === "offer"
                            ? "Non disponibile"
                            : `${rs.length - cancelled} attive / ${cancelled} annullate`,
                    quantitySummary:
                        rs[0].kind === "order"
                            ? s.orderQuantity
                            : s.offerQuantity,
                    netSummary:
                        rs[0].kind === "order"
                            ? s.netOrdersSummary
                            : s.netOffersSummary,
                };
            }),
            title: "Ordini e offerte del cliente",
            note: "",
        };
    if (view === "articles")
        return {
            columns: articleColumns,
            data: [...grouped(filtered, (r) => r.article)].map(
                ([article, rs]) => ({
                    ...summaryRow(rs),
                    article,
                    description: rs[0].description,
                }),
            ),
            title: "Articoli del cliente",
            note: "",
        };
    const annual = [
        ...grouped(
            filtered,
            (r) => r.documentDate?.slice(0, 4) ?? "Data assente",
        ),
    ]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([year, rs]) => ({ year, ...summaryRow(rs) }));
    return {
        columns: historyColumns,
        data: annual.map((r, i) => ({
            ...r,
            ordersDelta: i ? r.orders - annual[i - 1].orders : null,
            offersDelta: i ? r.offers - annual[i - 1].offers : null,
        })),
        title: "Storico annuale e confronti",
        note: "Delta rispetto all’anno precedente presente in questa tabella, con gli stessi filtri correnti. Periodi parziali non sono annualizzati. La situazione consegne è quella attuale, non una fotografia storica.",
    };
}
function cell(row: any, c: Column) {
    const v = row[c.key];
    if (c.kind === "document")
        return `<button class="document-expand" data-expand-document="${esc(row.key)}" aria-expanded="false" title="${row.key?.startsWith("order:") ? "Offerte collegate" : "Ordini collegati"}">▸</button><button class="document-link" data-document="${esc(row.key)}">${esc(v || "(senza numero)")}</button>`;
    if (c.kind === "article")
        return `<button class="article-link" data-article="${esc(v)}">${esc(v || "—")}</button>`;
    if (c.kind === "measure")
        return measureMarkup(v, c.key.includes("net") ? 2 : 4);
    if (c.kind === "date") return esc(date(v));
    if (c.kind === "bool") return v == null ? "—" : v ? "Sì" : "No";
    if (c.kind === "number" || c.kind === "money")
        return num(v, c.kind === "money" ? 2 : 4);
    if (c.kind === "status")
        return `<span class="state-badge ${v === "Scaduto" ? "overdue" : v === "Consegnato" ? "delivered" : ""}">${esc(v)}</span>`;
    return esc(v ?? "—");
}
function tableMarkup(columns: Column[], data: any[], id: string) {
    return `<table id="${id}"><thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${data.map((r) => `<tr>${columns.map((c) => `<td data-analysis-field="${c.key}" class="${["number", "money", "measure"].includes(c.kind ?? "") ? "numeric" : c.key === "description" ? "description" : ""}" title="${esc(Array.isArray(r[c.key]) ? measureText(r[c.key]) : (r[c.key] ?? ""))}">${cell(r, c)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${columns.length}">Nessun risultato nei filtri selezionati</td></tr>`}</tbody></table>`;
}
function renderTable() {
    const t = tableData(),
        sorted = sortByCriteria(t.data as any[], sorting[view], (r, k) =>
            Array.isArray(r[k]) ? measureText(r[k]) : r[k],
        );
    pages[view] = Math.max(
        0,
        Math.min(pages[view], Math.ceil(sorted.length / PAGE_SIZE) - 1),
    );
    const start = pages[view] * PAGE_SIZE,
        page = sorted.slice(start, start + PAGE_SIZE);
    $("content").innerHTML =
        `<article class="panel customer-table-panel"><div class="panel-head"><div><h2 title="${esc(t.note)}">${t.title}</h2></div></div><div class="table-scroll">${tableMarkup(t.columns, page, "analysisTable")}</div><div class="pager"><span>${num(sorted.length ? start + 1 : 0, 0)}–${num(start + page.length, 0)} di ${num(sorted.length, 0)}</span><button data-page="-1" ${pages[view] === 0 ? "disabled" : ""}>← Precedenti</button><button data-page="1" ${start + PAGE_SIZE >= sorted.length ? "disabled" : ""}>Successivi →</button></div></article>`;
    const change = (next: SortCriterion[]) => {
        sorting[view] = next;
        pages[view] = 0;
        renderTable();
    };
    bindSortingHeaders(
        $("analysisTable") as HTMLTableElement,
        t.columns,
        sorting[view],
        change,
    );
    updateSortingBar(
        $("analysisTable") as HTMLTableElement,
        t.columns,
        sorting[view],
        change,
    );
}
function renderQuality() {
    const s = customerStats(filtered, today()),
        all = customerStats(rows, today());
    $("content").innerHTML =
        `<div class="quality-grid"><article class="panel"><h2>Origine della lettura</h2><p><strong>${esc(loaded!.customer)} · ${esc(loaded!.name)}</strong></p><p>Database del gestionale tramite backend AyPi, sola lettura. Tabelle ordini MA_SaleOrd / MA_SaleOrdDetails; offerte MA_CustQuotas / MA_CustQuotasDetail; anagrafica MA_CustSupp.</p><p>Lettura: ${esc(new Date(loaded!.queriedAt).toLocaleString("it-IT"))}. Periodo SQL: ${date(loaded!.request.from)} → ${date(loaded!.request.to)}. Estremi vuoti = tutto lo storico.</p><dl><dt>Righe lette</dt><dd>${num(rows.length, 0)}</dd><dt>Righe nei filtri</dt><dd>${num(filtered.length, 0)}</dd><dt>Righe senza data documento nei filtri / lette</dt><dd>${s.missingDates} / ${all.missingDates}</dd><dt>Righe senza prezzo netto nei filtri / lette</dt><dd>${s.missingPrices} / ${all.missingPrices}</dd><dt>Righe con residuo senza consegna prevista</dt><dd>${s.missingDeliveries}</dd></dl><p>Solo righe con codice articolo: note, spese e documenti privi di righe articolo non entrano nei risultati. Offerte intestate a contatti escluse. Oltre 100.000 righe la lettura richiede un periodo più ristretto e non mostra totali parziali.</p></article><article class="panel"><h2>Come leggere gli indicatori</h2><p>Ordini e offerte sono contati per tipo + ID documento; gli articoli per codice distinto. Un documento può comparire in più gruppi articolo o stato: i conteggi dei gruppi non vanno sommati.</p><p>“Attivo” significa riga e testata non annullate. “Consegnato” usa il flag della riga. Residuo = quantità meno consegnato, minimo zero; è zero per righe annullate o marcate consegnate. Un ordine può contenere righe con stati diversi.</p><p>Scaduto = riga ordine non annullata con residuo e data di consegna prevista precedente a oggi (${date(today())}). Le righe prive di data prevista non sono classificate come scadute.</p><p>Data documento = data ordine / offerta; inserimento documento e riga = TBCreated delle rispettive tabelle. Consegna prevista e confermata sono quelle della riga, con ripiego sulla testata; non rappresentano la consegna effettiva. La validità offerta proviene da ValidityEndingDate. I flag della testata sono mostrati separatamente dagli stati delle righe.</p><p>L’imponibile riga è TaxableAmount del gestionale. È distinto dal valore stimato (quantità × prezzo netto); portafoglio = residuo × prezzo netto. Non rappresentano fatturato, incassi o margine; IVA, spese e rettifiche di documento escluse. Prezzi o quantità mancanti non contribuiscono alle stime e vengono segnalati.</p><p>U.M. e valute restano separate in tabelle e serie. Quantità ordini e offerte non vengono sommate tra loro. I documenti collegati si consultano espandendo le righe o nel dettaglio documento. Non viene calcolato un tasso di conversione.</p><p>I filtri agiscono sulle righe e su tutti i pannelli. Storici e confronti usano la data documento e gli stati attuali; non ricostruiscono il portafoglio o lo stato della consegna a una data passata. I grafici temporali mostrano zero nei periodi senza documenti nella lettura.</p></article></div>`;
}
function render() {
    const focused = zoomed;
    unzoom();
    clearCharts();
    document.body.dataset.layout = preferences.expanded
        ? "expanded"
        : "compact";
    $("layoutToggle").textContent = preferences.expanded
        ? "↕ Vista compatta"
        : "↕ Vista ampia";
    $("layoutToggle").setAttribute(
        "aria-pressed",
        String(preferences.expanded),
    );
    document
        .querySelectorAll<HTMLElement>("[data-view]")
        .forEach((el) =>
            el.classList.toggle("active", el.dataset.view === view),
        );
    if (!loaded) return;
    $("filters").hidden = false;
    $("kpis").hidden = false;
    chartBaseRows = filterCustomerRows(
        rows,
        { ...filters, selection: emptyCustomerSelection() },
        today(),
    );
    filtered = filterCustomerRows(rows, filters, today());
    kpis();
    filterChips();
    const request = loaded.request;
    $("customerIdentity").textContent = loaded.customer + " · " + loaded.name;
    $("customerIdentity").title = loaded.customer + " · " + loaded.name;
    if (view === "dashboard") {
        const visible = preferences.charts.filter((c) => !c.hidden);
        $("content").innerHTML =
            `${visible.length ? `<div class="customer-chart-grid ${visible.length === 1 ? "one-panel" : ""}">${visible.map(chartPanel).join("")}</div>` : '<article class="panel empty-state">Nessun grafico visibile. Apri “Grafici e preset” per aggiungerne uno o mostrarne uno salvato.</article>'}${summaryTables()}`;
        visible.forEach(drawChart);
        const expand = focused
            ? document.querySelector<HTMLElement>(
                  `[data-expand-chart="${focused}"]`,
              )
            : null;
        if (expand) zoom(focused!, expand);
    } else if (view === "quality") renderQuality();
    else renderTable();
}
function applyFilters() {
    Object.keys(pages).forEach((k) => (pages[k] = 0));
    status("");
    render();
}
async function searchCustomers() {
    const value = input("customerSearch").value.trim(),
        generation = ++searchGeneration;
    if (value.length < 2) {
        $("customerSearchNote").textContent = "Inserisci almeno due caratteri.";
        return;
    }
    searching = true;
    (input("searchCustomers") as any).disabled = true;
    $("customerSearchNote").textContent = "Ricerca clienti nel gestionale…";
    try {
        const result = await ipc.invoke("customer-analysis-customers", {
            search: value,
        });
        if (generation !== searchGeneration) return;
        if (!result.ok) throw Error(result.error);
        customers = result.customers;
        select("customerResults").innerHTML =
            '<option value="">Seleziona un cliente</option>' +
            customers
                .map(
                    (c, i) =>
                        `<option value="${i}">${esc(c.code)} · ${esc(c.name || "Ragione sociale assente")}</option>`,
                )
                .join("");
        if (customers.length === 1) select("customerResults").value = "0";
        $("customerSearchNote").textContent = result.more
            ? "Più di 100 clienti trovati: precisa il codice o la ragione sociale."
            : customers.length
              ? ""
              : "Nessun cliente trovato.";
    } catch (error) {
        if (generation === searchGeneration) {
            $("customerSearchNote").textContent = (error as Error).message;
            status((error as Error).message, true);
        }
    } finally {
        if (generation === searchGeneration) {
            searching = false;
            (input("searchCustomers") as any).disabled = false;
            updateBusy();
        }
    }
}
async function loadCustomer(refresh = false) {
    if (busy) return;
    const customer = refresh
        ? loaded && { code: loaded.customer, name: loaded.name }
        : customers[Number(select("customerResults").value)];
    if (!customer || (!refresh && !select("customerResults").value)) return;
    const from = input("readFrom").value,
        to = input("readTo").value;
    if (from && to && from > to) {
        status("La data iniziale di lettura deve precedere la finale.", true);
        return;
    }
    const request = {
        customer: customer.code,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
    };
    busy = true;
    updateBusy();
    status(
        `Lettura di ordini e offerte per ${customer.name || customer.code}…`,
    );
    try {
        const result = await ipc.invoke("customer-analysis-load", request);
        if (!result.ok) throw Error(result.error);
        rows = normalizeCustomerRows(result.rows);
        loaded = {
            customer: customer.code,
            name: customer.name || rows[0]?.customerName || "",
            queriedAt: result.queriedAt,
            request,
        };
        if (!refresh) filters = defaultCustomerFilters();
        setupFilterOptions();
        syncFilters();
        Object.keys(pages).forEach((k) => (pages[k] = 0));
        render();
        status(
            rows.length
                ? preferencesWarning
                : `Nessuna riga articolo per il cliente nel periodo di lettura. ${preferencesWarning}`,
        );
    } catch (error) {
        status(
            `${(error as Error).message}${loaded ? " Restano visibili i dati della precedente lettura." : ""}`,
            true,
        );
    } finally {
        busy = false;
        updateBusy();
        void applyAnalysisContext();
    }
}
function openDocument(key: string) {
    const rs = rows.filter((r) => documentKey(r) === key);
    if (!rs.length) return;
    $("documentTitle").textContent =
        `${rs[0].kind === "order" ? "Ordine" : "Offerta"} ${rs[0].documentNo} · ${date(rs[0].documentDate)}`;
    $("documentNote").textContent =
        `Dettaglio completo · ${rs.length} ${rs.length === 1 ? "riga" : "righe"}`;
    $("documentNote").title =
        "Tutte le righe disponibili nella lettura, compresi gli annullati; i filtri della dashboard non si applicano al dettaglio.";
    $("documentBody").innerHTML = tableMarkup(
        rowColumns.filter((c) => c.kind !== "document"),
        lineRows(rs),
        "documentLines",
    );
    const connections = document.createElement("details");
    connections.className = "document-connections";
    const heading = document.createElement("summary");
    heading.textContent =
        rs[0].kind === "order" ? "Offerte collegate" : "Ordini collegati";
    const content = document.createElement("div");
    connections.append(heading, content);
    $("documentBody").append(connections);
    let requested = false;
    connections.addEventListener("toggle", () => {
        if (connections.open && !requested) {
            requested = true;
            void loadDocumentLinks(
                content,
                rs[0].kind,
                Number(rs[0].documentId),
            );
        }
    });
    ($("documentDialog") as HTMLDialogElement).showModal();
}
function unzoom() {
    if (!zoomed) return;
    const panel = document.querySelector<HTMLElement>(".chart-focused");
    panel?.classList.remove("chart-focused");
    panel?.removeAttribute("role");
    panel?.removeAttribute("aria-modal");
    panel?.removeAttribute("aria-label");
    const button = document.querySelector<HTMLButtonElement>(
        `[data-expand-chart="${zoomed}"]`,
    );
    if (button) setChartExpanded(button, false);
    document.body.classList.remove("chart-focus-open");
    $("chartBackdrop").hidden = true;
    charts.get(zoomed)?.resize();
    zoomed = null;
    zoomTrigger?.focus({ preventScroll: true });
    zoomTrigger = null;
}
function zoom(id: string, trigger: HTMLElement) {
    if (zoomed === id) {
        unzoom();
        return;
    }
    unzoom();
    zoomed = id;
    zoomTrigger = trigger;
    const panel = document.querySelector<HTMLElement>(
        `[data-chart-id="${id}"]`,
    )!;
    panel.classList.add("chart-focused");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute(
        "aria-label",
        panel.querySelector("h2")?.textContent || "Grafico",
    );
    document.body.classList.add("chart-focus-open");
    $("chartBackdrop").hidden = false;
    setChartExpanded(trigger, true);
    trigger.focus({ preventScroll: true });
    charts.get(id)?.resize();
}
function chartEditor() {
    $("chartVisibility").innerHTML = preferences.charts
        .map(
            (c, i) =>
                `<div class="chart-visibility-row"><label><input type="checkbox" data-visible="${c.id}" ${c.hidden ? "" : "checked"}><span>${esc(c.title)}</span></label><div><button data-move="${c.id}" data-direction="-1" ${i === 0 ? "disabled" : ""} aria-label="Sposta su ${esc(c.title)}">↑</button><button data-move="${c.id}" data-direction="1" ${i === preferences.charts.length - 1 ? "disabled" : ""} aria-label="Sposta giù ${esc(c.title)}">↓</button><button data-edit-chart="${c.id}">Modifica</button><button data-delete-chart="${c.id}">Rimuovi</button></div></div>`,
        )
        .join("");
    const selected = select("preset").value;
    select("preset").innerHTML =
        '<option value="">Scegli un preset</option>' +
        preferences.presets
            .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
            .join("");
    if (preferences.presets.some((p) => p.id === selected))
        select("preset").value = selected;
}
function editChart(id: string) {
    unzoom();
    const c = preferences.charts.find((c) => c.id === id);
    if (!c) return;
    editingChart = id;
    for (const [key, field] of [
        ["title", "chartTitle"],
        ["kind", "chartKind"],
        ["scope", "chartScope"],
        ["dimension", "chartDimension"],
        ["metric", "chartMetric"],
        ["limit", "chartLimit"],
    ] as const)
        input(field).value = String(c[key]);
    input("chartCumulative").checked = c.cumulative;
    $("chartBuilderHeading").textContent = "Modifica il grafico";
    $("submitChart").textContent = "Applica modifiche";
    $("cancelChartEdit").hidden = false;
    if (!($("chartsDialog") as HTMLDialogElement).open)
        ($("chartsDialog") as HTMLDialogElement).showModal();
    input("chartTitle").focus();
}
function cancelEdit() {
    editingChart = null;
    $("chartBuilderHeading").textContent = "Aggiungi un grafico";
    $("submitChart").textContent = "Aggiungi grafico";
    $("cancelChartEdit").hidden = true;
    ($("chartBuilder") as HTMLFormElement).reset();
}
async function persist(next: CustomerPreferences, message: string) {
    if (saving) return false;
    saving = true;
    ["saveCharts", "savePreset", "deletePreset"].forEach(
        (id) => ((input(id) as any).disabled = true),
    );
    try {
        const result = await ipc.invoke(
            "customer-analysis-preferences-save",
            validateCustomerPreferences(next),
        );
        if (!result.ok) throw Error(result.error);
        preferencesWarning = "";
        notice(message);
        return true;
    } catch (error) {
        notice((error as Error).message, true);
        return false;
    } finally {
        saving = false;
        ["saveCharts", "savePreset", "deletePreset"].forEach(
            (id) => ((input(id) as any).disabled = false),
        );
    }
}
async function exportData() {
    if (!loaded || busy || !readFilters()) return;
    busy = true;
    updateBusy();
    status(
        "Esportazione di tutte le righe nei filtri, inclusi i risultati fuori pagina…",
    );
    try {
        const result = await ipc.invoke(
            "customer-analysis-export",
            clone(filters),
        );
        if (!result.ok) throw Error(result.error);
        status(
            result.canceled
                ? "Esportazione annullata."
                : `Esportate ${num(result.count, 0)} righe con documenti, quantità, valori e storico annuale.`,
        );
    } catch (error) {
        status((error as Error).message, true);
    } finally {
        busy = false;
        updateBusy();
        void applyAnalysisContext();
    }
}
$("customerSearchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!searching) void searchCustomers();
});
input("customerSearch").addEventListener("input", () => {
    ++searchGeneration;
    searching = false;
    (input("searchCustomers") as any).disabled = false;
    customers = [];
    select("customerResults").innerHTML =
        '<option value="">Cerca e seleziona un cliente</option>';
    updateBusy();
});
select("customerResults").addEventListener("change", updateBusy);
$("loadCustomer").addEventListener("click", () => void loadCustomer());
$("refresh").addEventListener("click", () => void loadCustomer(true));
$("export").addEventListener("click", () => void exportData());
$("close").addEventListener("click", () => ipc.send("customer-analysis-close"));
document.querySelectorAll<HTMLElement>("[data-view]").forEach((el) =>
    el.addEventListener("click", () => {
        view = el.dataset.view!;
        render();
    }),
);
let filterTimer: ReturnType<typeof setTimeout> | undefined;
for (const id of [
    "kind",
    "from",
    "to",
    "deliveryFrom",
    "deliveryTo",
    "state",
    "article",
    "articleExact",
    "search",
    "unit",
    "currency",
    "minQuantity",
    "maxQuantity",
    "minPrice",
    "maxPrice",
    "minResidual",
    "maxResidual",
    "includeCancelled",
]) {
    const delayed = [
        "article",
        "search",
        "minQuantity",
        "maxQuantity",
        "minPrice",
        "maxPrice",
        "minResidual",
        "maxResidual",
    ].includes(id);
    $(id).addEventListener(delayed ? "input" : "change", () => {
        clearTimeout(filterTimer);
        if (id === "state" || id === "kind") filters.stateBucket = "";
        if (delayed)
            filterTimer = setTimeout(() => {
                if (readFilters()) applyFilters();
            }, 220);
        else if (readFilters()) applyFilters();
    });
}
$("yearOptions").addEventListener("change", () => {
    filters.years = Array.from(
        $("yearOptions").querySelectorAll<HTMLInputElement>(
            "input[data-year]:checked",
        ),
    ).map((el) => el.dataset.year!);
    applyFilters();
});
$("yearOptions").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-years]",
    );
    if (!button) return;
    const years = Array.from(
        $("yearOptions").querySelectorAll<HTMLInputElement>("input[data-year]"),
    ).map((el) => el.dataset.year!);
    filters.years = button.dataset.years === "all" ? [] : years.slice(-2);
    syncFilters();
    applyFilters();
});
$("reset").addEventListener("click", () => {
    filters = defaultCustomerFilters();
    syncFilters();
    applyFilters();
});
$("activeFilters").addEventListener("click", (event) => {
    const chartDimension = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-clear-chart-dimension]",
    )?.dataset.clearChartDimension as keyof CustomerSelection | undefined;
    if (chartDimension) {
        filters.selection = {
            ...(filters.selection ?? emptyCustomerSelection()),
            [chartDimension]: [],
        };
        applyFilters();
        return;
    }
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-clear-filter]",
    );
    if (!button) return;
    const defaults = defaultCustomerFilters();
    for (const key of button.dataset.clearFilter!.split(
        ",",
    ) as (keyof CustomerFilters)[])
        (filters as any)[key] = defaults[key];
    syncFilters();
    applyFilters();
});
function activateKpi(action: string) {
    if (!action) return;
    unzoom();
    if (action === "articles") view = "articles";
    else {
        if (filters.selection)
            filters.selection = { ...filters.selection, kind: [], status: [] };
        filters.stateBucket = "";
        filters.kind = action === "offers" ? "offer" : "order";
        filters.status =
            action === "open"
                ? "open"
                : action === "overdue"
                  ? "overdue"
                  : "all";
        view =
            action === "open" || action === "overdue" ? "lines" : "documents";
    }
    syncFilters();
    applyFilters();
}
$("kpis").addEventListener("click", (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>("[data-kpi]");
    if (el) activateKpi(el.dataset.kpi!);
});
$("kpis").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        const el = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-kpi]",
        );
        if (el) {
            event.preventDefault();
            activateKpi(el.dataset.kpi!);
        }
    }
});
$("content").addEventListener("click", (event) => {
    const expandDocument = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-expand-document]",
    );
    if (expandDocument) {
        const [kind, id] = expandDocument.dataset.expandDocument!.split(":");
        toggleDocumentLinks(
            expandDocument,
            kind as "order" | "offer",
            Number(id),
        );
        return;
    }
    const target = event.target as HTMLElement,
        doc = target.closest<HTMLElement>("[data-document]"),
        article = target.closest<HTMLElement>("[data-article]"),
        page = target.closest<HTMLElement>("[data-page]"),
        edit = target.closest<HTMLElement>("[data-edit-chart]"),
        cumulative = target.closest<HTMLElement>("[data-cumulative]"),
        reset = target.closest<HTMLElement>("[data-reset-chart]"),
        maximize = target.closest<HTMLElement>("[data-expand-chart]");
    if (doc) openDocument(doc.dataset.document!);
    else if (article) {
        filters.article = article.dataset.article!;
        filters.articleExact = true;
        view = "lines";
        syncFilters();
        applyFilters();
    } else if (page) {
        pages[view] += Number(page.dataset.page);
        renderTable();
    } else if (edit) {
        chartEditor();
        editChart(edit.dataset.editChart!);
    } else if (cumulative) {
        const chart = preferences.charts.find(
            (c) => c.id === cumulative.dataset.cumulative,
        );
        if (chart) {
            chart.cumulative = !chart.cumulative;
            render();
        }
    } else if (reset) resetChartSelections();
    else if (maximize) zoom(maximize.dataset.expandChart!, maximize);
});
$("documentBody").addEventListener("click", (event) => {
    const article = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-article]",
    );
    if (article) {
        ($("documentDialog") as HTMLDialogElement).close();
        filters.article = article.dataset.article!;
        filters.articleExact = true;
        view = "lines";
        syncFilters();
        applyFilters();
    }
});
$("chartBackdrop").addEventListener("click", unzoom);
document.addEventListener("keydown", (event) => {
    if (!zoomed || document.querySelector("dialog[open]")) return;
    if (event.key === "Escape") {
        event.preventDefault();
        unzoom();
    } else if (event.key === "Tab") {
        const controls = Array.from(
            document.querySelectorAll<HTMLElement>(
                '.chart-focused button,.chart-focused [tabindex="0"]',
            ),
        );
        const first = controls[0],
            last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    }
});
$("layoutToggle").addEventListener("click", () => {
    preferences.expanded = !preferences.expanded;
    render();
});
$("chartsMenu").addEventListener("click", () => {
    unzoom();
    chartEditor();
    notice(
        preferencesWarning ||
            "Le modifiche si applicano subito. Premi “Salva dashboard” per conservarle alla prossima apertura.",
    );
    ($("chartsDialog") as HTMLDialogElement).showModal();
});
document
    .querySelectorAll<HTMLElement>("[data-close-dialog]")
    .forEach((el) =>
        el.addEventListener("click", () => el.closest("dialog")!.close()),
    );
$("chartVisibility").addEventListener("change", (event) => {
    const el = event.target as HTMLInputElement,
        c = preferences.charts.find((c) => c.id === el.dataset.visible);
    if (c) {
        c.hidden = !el.checked;
        render();
    }
});
$("chartVisibility").addEventListener("click", (event) => {
    const target = event.target as HTMLElement,
        edit = target.closest<HTMLElement>("[data-edit-chart]"),
        remove = target.closest<HTMLElement>("[data-delete-chart]"),
        move = target.closest<HTMLElement>("[data-move]");
    if (edit) editChart(edit.dataset.editChart!);
    if (remove) {
        preferences.charts = preferences.charts.filter(
            (c) => c.id !== remove.dataset.deleteChart,
        );
        if (editingChart === remove.dataset.deleteChart) cancelEdit();
        chartEditor();
        render();
    }
    if (move) {
        const index = preferences.charts.findIndex(
                (c) => c.id === move.dataset.move,
            ),
            next = index + Number(move.dataset.direction);
        if (next >= 0 && next < preferences.charts.length) {
            [preferences.charts[index], preferences.charts[next]] = [
                preferences.charts[next],
                preferences.charts[index],
            ];
            chartEditor();
            render();
        }
    }
});
$("chartBuilder").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!editingChart && preferences.charts.length >= 12) {
        notice("Sono ammessi fino a 12 grafici.", true);
        return;
    }
    const chart: CustomerChart = {
        id: editingChart ?? newId(),
        title: input("chartTitle").value,
        kind: select("chartKind").value as CustomerChart["kind"],
        scope: select("chartScope").value as CustomerChart["scope"],
        dimension: select("chartDimension").value as CustomerChart["dimension"],
        metric: select("chartMetric").value as CustomerChart["metric"],
        limit: Number(input("chartLimit").value),
        hidden: false,
        cumulative: input("chartCumulative").checked,
    };
    const next = clone(preferences),
        index = next.charts.findIndex((c) => c.id === editingChart);
    if (index >= 0) {
        chart.hidden = next.charts[index].hidden;
        next.charts[index] = chart;
    } else next.charts.push(chart);
    try {
        preferences = validateCustomerPreferences(next);
        cancelEdit();
        chartEditor();
        render();
        notice("Grafico applicato. Salva la dashboard per conservarlo.");
    } catch (error) {
        notice((error as Error).message, true);
    }
});
$("cancelChartEdit").addEventListener("click", cancelEdit);
$("saveCharts").addEventListener(
    "click",
    () => void persist(clone(preferences), "Dashboard salvata su questo PC."),
);
$("restoreCharts").addEventListener("click", () => {
    preferences.charts = defaultCustomerCharts();
    cancelEdit();
    chartEditor();
    render();
    notice(
        "Grafici predefiniti ripristinati. Premi “Salva dashboard” per conservarli.",
    );
});
$("savePreset").addEventListener("click", async () => {
    const name = input("presetName").value.trim();
    if (!name) {
        notice("Inserisci un nome per il preset.", true);
        return;
    }
    if (preferences.presets.length >= 10) {
        notice(
            "Sono ammessi fino a 10 preset. Elimina un preset prima di aggiungerne uno.",
            true,
        );
        return;
    }
    if (loaded && !readFilters()) {
        notice("Correggi i filtri prima di salvare il preset.", true);
        return;
    }
    const next = clone(preferences),
        id = newId();
    next.presets.push({
        id,
        name,
        charts: clone(preferences.charts),
        filters: clone(filters),
        expanded: preferences.expanded,
    });
    if (await persist(next, "Preset salvato con grafici, filtri e vista.")) {
        preferences.presets = next.presets;
        chartEditor();
        select("preset").value = id;
        input("presetName").value = "";
    }
});
$("applyPreset").addEventListener("click", () => {
    const p = preferences.presets.find((p) => p.id === select("preset").value);
    if (!p) {
        notice("Seleziona un preset.", true);
        return;
    }
    preferences.charts = clone(p.charts);
    preferences.expanded = p.expanded;
    filters = clone(p.filters);
    cancelEdit();
    syncFilters();
    chartEditor();
    applyFilters();
    notice(
        "Preset caricato sul cliente corrente. Le date di lettura SQL non cambiano.",
    );
});
$("deletePreset").addEventListener("click", async () => {
    const id = select("preset").value;
    if (!id) {
        notice("Seleziona un preset.", true);
        return;
    }
    const next = clone(preferences);
    next.presets = next.presets.filter((p) => p.id !== id);
    if (await persist(next, "Preset eliminato.")) {
        preferences.presets = next.presets;
        chartEditor();
    }
});
async function initialize() {
    try {
        const result = await ipc.invoke("customer-analysis-preferences-load");
        if (!result.ok) throw Error(result.error);
        preferences = validateCustomerPreferences(result.preferences);
    } catch (error) {
        preferencesWarning = (error as Error).message;
        status(preferencesWarning, true);
    }
    render();
    chartEditor();
    initialized = true;
    void applyAnalysisContext();
}
async function applyAnalysisContext() {
    if (!initialized || busy || !pendingAnalysisContext) return;
    const context = pendingAnalysisContext,
        generation = contextGeneration;
    pendingAnalysisContext = null;
    let code = context.customerCode,
        name = context.customerName || code || "";
    if (!code && context.customerName) {
        input("customerSearch").value = context.customerName.slice(0, 128);
        await searchCustomers();
        if (generation !== contextGeneration) return;
        const matches = customers.filter(
            (c) =>
                c.name.trim().toLocaleLowerCase("it") ===
                context.customerName!.trim().toLocaleLowerCase("it"),
        );
        if (matches.length !== 1) {
            status(
                "Seleziona il cliente nei risultati per completare il collegamento.",
            );
            return;
        }
        code = matches[0].code;
        name = matches[0].name;
    }
    if (!code) {
        status("Il collegamento richiede un cliente.", true);
        return;
    }
    customers = [{ code, name }];
    select("customerResults").innerHTML =
        `<option value="0">${esc(code)} · ${esc(name)}</option>`;
    select("customerResults").value = "0";
    input("customerSearch").value = code;
    input("readFrom").value = "";
    input("readTo").value = "";
    ($("documentDialog") as HTMLDialogElement).close();
    const previous = loaded;
    await loadCustomer();
    if (generation !== contextGeneration || loaded === previous) return;
    if (context.article) {
        filters.article = context.article;
        filters.articleExact = true;
        view = "lines";
        syncFilters();
        render();
    }
    if (context.documentId && context.documentKind) {
        view = "documents";
        render();
        openDocument(context.documentKind + ":" + context.documentId);
    }
}
ipc.on("analysis-open-context", (_event: any, context: AnalysisContext) => {
    pendingAnalysisContext = context;
    contextGeneration++;
    void applyAnalysisContext();
});
installAnalysisLinks(
    (target) => {
        const linked = contextFromAnalysisElement(target);
        if (linked) return linked;
        if(!loaded)return null;
        if(target.closest('#customerIdentity'))return {customerCode:loaded.customer,customerName:loaded.name||loaded.customer};
        const article=target.closest<HTMLElement>('[data-article]')||target.closest('[data-analysis-field]')?.querySelector<HTMLElement>('[data-article]');
        if(article?.dataset.article)return {article:article.dataset.article};
        const doc=target.closest<HTMLElement>('[data-document]')||target.closest('[data-analysis-field]')?.querySelector<HTMLElement>('[data-document]');
        const row=doc?rows.find(r=>documentKey(r)===doc.dataset.document):null;
        if(row)return {documentId:String(row.documentId),documentNo:row.documentNo,documentKind:row.kind};
        return null;
    },
    (message) => status(message, true),
);
ipc.send("analysis-context-ready");
void initialize();
