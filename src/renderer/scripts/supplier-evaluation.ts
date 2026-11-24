import Chart from "chart.js/auto";
import type { AnalysisContext } from "../../main/modules/analysis-navigation-model";
import { analysisHtmlLegend } from "../modules/analysis-html-legend";
import {
    continueTableOnScroll,
    appendTableHtml,
} from "../modules/table-scroll-loader";
import {
    supplierPerformanceChart,
    supplierPerformanceSources,
} from "../modules/supplier-performance-charts";
import { buildSupplierIdentities } from "../../../backend/src/modules/supplier-evaluation/identity";
import { color } from "chart.js/helpers";
import { installAnalysisWorkspace } from "../modules/analysis-workspace";
import { analysisSelectionHighlight } from "../modules/analysis-selection-highlight";
import { mergeAreaSelection } from "../modules/analysis-chart-area-selection";
import { analysisYearPicker } from "../modules/analysis-year-picker";
import { bindSortingHeaders, updateSortingBar } from "../modules/table-sorting";
import {
    sortByCriteria,
    SortCriterion,
} from "../../main/modules/analysis-sorting";
import { emptyWorkspace } from "../../main/modules/analysis-ui-model";
import {
    dimensions,
    supplierSummary,
    SupplierSettings,
} from "../../../backend/src/modules/supplier-evaluation/model";
Chart.register(analysisSelectionHighlight, analysisHtmlLegend);
const ipc = require("electron").ipcRenderer,
    $ = <T extends HTMLElement = HTMLElement>(id: string) =>
        document.getElementById(id) as T;
const esc = (v: any) =>
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
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const num = (v: any, digits = 0) =>
    v == null
        ? "—"
        : new Intl.NumberFormat("it-IT", {
              maximumFractionDigits: digits,
          }).format(Number(v));
const date = (v: any) =>
    v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—";
const contains = (a: any, b: any) =>
    String(a ?? "")
        .toLocaleLowerCase("it")
        .includes(String(b ?? "").toLocaleLowerCase("it"));
const today = () =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
const names = {
    punctuality: "Puntualità",
    condition: "Stato merce",
    conformity: "Conformità",
};
type Rule = { field: string; op: string; value: string; to?: string };
type Filters = {
    suppliers: string[];
    level: string;
    from: string;
    to: string;
    text: string;
    years: string[];
    punctuality: string;
    condition: string;
    conformity: string;
    ddt: string;
    author: string;
    attachments: string;
    mapping: string;
    rules: Rule[];
};
const emptyFilters = (): Filters => ({
    suppliers: [],
    level: "",
    from: "",
    to: "",
    text: "",
    years: [],
    punctuality: "",
    condition: "",
    conformity: "",
    ddt: "",
    author: "",
    attachments: "",
    mapping: "",
    rules: [],
});
let snapshot: any = {
        suppliers: [],
        profiles: [],
        records: [],
        attachments: [],
    },
    settings: SupplierSettings,
    view = "dashboard",
    actor = "",
    filters = emptyFilters(),
    sort: SortCriterion[] = [{ key: "date", direction: "desc" }],
    limit = 250;
const emptySelection = (): Record<string, string[]> => ({
    suppliers: [],
    months: [],
    years: [],
    punctuality: [],
    condition: [],
    conformity: [],
    causes: [],
});
let preferences: any = {
        workspace: emptyWorkspace(),
        supplierWorkspace: emptyWorkspace(),
        filterPresets: [],
        columns: {},
    },
    selection = emptySelection();
let analysisSupplierId = "",
    workspaceIsSupplier = false,
    generalFilters = filters,
    detailFilters = emptyFilters(),
    generalSelection = selection,
    detailSelection = emptySelection();
const isSupplierAnalysis = () => view === "supplier-analysis";
let identities = buildSupplierIdentities([]);
function refreshIdentities() {
    identities = buildSupplierIdentities(snapshot.suppliers);
    for (const p of snapshot.profiles) {
        const group = p.erpCode
            ? identities.byId.get("erp:" + p.erpCode)
            : null;
        if (group) identities.byId.set(p.id, group);
    }
    if (analysisSupplierId && identities.byId.has(analysisSupplierId))
        analysisSupplierId = identities.byId.get(analysisSupplierId).id;
}
const supplierGroup = (id: string) => identities.byId.get(id);
const groupSelected = (ids: string[], groupId: string) =>
    !ids.length || ids.some((id) => supplierGroup(id)?.id === groupId);
const analysisRows = (rows: any[]) =>
    rows.map((r) => ({
        ...r,
        supplierId: r.analysisSupplierId || r.supplierId,
    }));
let charts: Chart[] = [],
    workspace: ReturnType<typeof installAnalysisWorkspace> | null = null,
    editing: any = null,
    editKind = "",
    newAttachments: any[] = [],
    retainedAttachments: string[] = [],
    detailId = "",
    importToken = "",
    busy = false,
    staged: SupplierSettings | null = null;
type Col = { key: string; label: string; type?: string };
const recordColumns: Col[] = [
    { key: "date", label: "Data", type: "date" },
    { key: "ddt", label: "DDT" },
    { key: "code", label: "Codice fornitore" },
    { key: "name", label: "Fornitore" },
    { key: "levelName", label: "Criticità assegnata" },
    { key: "punctualityLabel", label: "Puntualità" },
    { key: "conditionLabel", label: "Stato merce" },
    { key: "conformityLabel", label: "Conformità" },
    { key: "notes", label: "Note" },
    { key: "attachmentCount", label: "Allegati", type: "number" },
    { key: "createdBy", label: "Inserito da" },
    { key: "updatedBy", label: "Modificato da" },
    { key: "extra", label: "Campo aggiuntivo storico" },
    { key: "id", label: "ID" },
];
const supplierColumns: Col[] = [
    { key: "code", label: "Codice" },
    { key: "name", label: "Fornitore" },
    { key: "levelName", label: "Criticità assegnata" },
    { key: "evaluations", label: "Valutazioni", type: "number" },
    {
        key: "punctualityBad",
        label: "Ritardi / esiti segnalati",
        type: "number",
    },
    { key: "conditionBad", label: "Problemi stato merce", type: "number" },
    {
        key: "conformityBad",
        label: "Non conformità / esiti segnalati",
        type: "number",
    },
    { key: "adverse", label: "Valutazioni con segnalazioni", type: "number" },
    { key: "adverseRate", label: "Incidenza segnalazioni %", type: "number" },
    { key: "causes", label: "Cause della segnalazione critica" },
    { key: "lastDate", label: "Ultima valutazione", type: "date" },
    { key: "mappingLabel", label: "Collegamento gestionale" },
    { key: "notes", label: "Note classificazione" },
];
const completeSupplierColumns = (): Col[] => [
    ...supplierColumns,
    { key: "taxId", label: "Partita IVA" },
    { key: "fiscalCode", label: "Codice fiscale" },
    { key: "disabledLabel", label: "Disabilitato nel gestionale" },
    ...dimensions.flatMap((d) =>
        settings.options[d].flatMap((v) => [
            {
                key: "grade:" + v.id,
                label: names[d] + " / " + v.name,
                type: "number",
            },
            {
                key: "rate:" + v.id,
                label: names[d] + " / " + v.name + " %",
                type: "number",
            },
        ]),
    ),
];
const columns = () => {
    if (!["suppliers", "critical"].includes(view)) return recordColumns;
    const all = completeSupplierColumns();
    if (view === "critical") {
        const cause = all.find((c) => c.key === "causes")!;
        return [
            ...all.slice(0, 3),
            cause,
            ...all.slice(3).filter((c) => c !== cause),
        ];
    }
    return all;
};
const label = (dimension: string, id: string) =>
    settings.options[dimension]?.find((v) => v.id === id)?.name ||
    (id ? "Esito storico da verificare" : "Non valutato");
const supplier = (id: string) => snapshot.suppliers.find((s) => s.id === id);
const levelName = (id: string) =>
    settings.levels.find((l) => l.id === id)?.name || "Da classificare";
const rowRecord = (record: any) => {
    const s = supplier(record.supplierId) || {},
        group = supplierGroup(record.supplierId);
    return {
        ...record,
        analysisSupplierId: group?.id || record.supplierId,
        code: s.code || "",
        name: s.name || record.supplierName || "Da verificare",
        criticality: s.criticality || "",
        levelName: levelName(s.criticality),
        mappingLabel: s.legacy ? "Da collegare" : "Gestionale",
        legacy: !!s.legacy,
        month: record.date?.slice(0, 7) || "",
        attachmentCount: snapshot.attachments.filter(
            (a) => a.recordId === record.id,
        ).length,
        ...Object.fromEntries(
            dimensions.map((d) => [d + "Label", label(d, record[d])]),
        ),
    };
};
function message(text = "", error = false) {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
}
async function api(op: string, extra: any = {}) {
    const r = await ipc.invoke("supplier-evaluation-api", { op, ...extra });
    if (!r.ok) throw Error(r.error || "Operazione non riuscita.");
    return r;
}
async function savePreferences() {
    await api("preferences-save", { value: preferences });
}
function ruleMatch(row: any) {
    const grouped = new Map<string, Rule[]>();
    for (const r of filters.rules) {
        if (!(r.field in row) || (!r.value && !r.to && r.op !== "empty"))
            continue;
        grouped.set(r.field, [...(grouped.get(r.field) || []), r]);
    }
    return [...grouped].every(([key, rules]) =>
        rules.some((r) => {
            const a = row[key],
                value = String(a ?? "").toLocaleLowerCase("it"),
                b = r.value.toLocaleLowerCase("it");
            if (r.op === "empty") return a == null || a === "";
            if (r.op === "exact") return value === b;
            if (r.op === "not") return !value.includes(b);
            if (r.op === "prefix") return value.startsWith(b);
            const cmp = (v: string) =>
                typeof a === "number"
                    ? a - Number(v.replace(",", "."))
                    : value.localeCompare(v.toLocaleLowerCase("it"), "it", {
                          numeric: true,
                      });
            if (r.op === "range")
                return (
                    a != null &&
                    (!b || cmp(r.value) >= 0) &&
                    (!r.to || cmp(r.to) <= 0)
                );
            if (r.op === "gte") return a != null && cmp(r.value) >= 0;
            if (r.op === "lte") return a != null && cmp(r.value) <= 0;
            return value.includes(b);
        }),
    );
}
function manualRows() {
    return snapshot.records
        .map(rowRecord)
        .filter(
            (r) =>
                (isSupplierAnalysis()
                    ? r.analysisSupplierId === analysisSupplierId
                    : groupSelected(filters.suppliers, r.analysisSupplierId)) &&
                (!filters.level ||
                    (filters.level === "__unassigned__"
                        ? !r.criticality
                        : r.criticality === filters.level)) &&
                (!filters.from || (r.date && r.date >= filters.from)) &&
                (!filters.to || (r.date && r.date <= filters.to)) &&
                (!filters.years.length ||
                    filters.years.includes(r.date?.slice(0, 4))) &&
                dimensions.every(
                    (d) =>
                        !filters[d] ||
                        (filters[d] === "__missing__"
                            ? !r[d]
                            : r[d] === filters[d]),
                ) &&
                contains(r.ddt, filters.ddt) &&
                contains(r.createdBy, filters.author) &&
                (!filters.attachments ||
                    (filters.attachments === "with"
                        ? r.attachmentCount > 0
                        : r.attachmentCount === 0)) &&
                (!filters.mapping ||
                    (filters.mapping === "legacy" ? r.legacy : !r.legacy)) &&
                (!filters.text ||
                    [
                        r.code,
                        r.name,
                        r.ddt,
                        r.date,
                        r.notes,
                        r.extra,
                        ...dimensions.map((d) => r[d + "Label"]),
                    ].some((v) => contains(v, filters.text))) &&
                ruleMatch(r),
        );
}
function selected(row: any) {
    return Object.entries(selection).every(
        ([dimension, keys]) =>
            !keys.length ||
            (dimension === "causes"
                ? keys.some((id) => {
                      const rule = settings.rules.find((r) => r.id === id);
                      return rule && rule.options.includes(row[rule.dimension]);
                  })
                : dimension === "suppliers"
                  ? groupSelected(keys, row.analysisSupplierId)
                  : keys.includes(
                        dimension === "months"
                            ? row.month
                            : dimension === "years"
                              ? String(row.date || "").slice(0, 4)
                              : row[dimension] || "__missing__",
                    )),
    );
}
const selectedRows = () => manualRows().filter(selected);
function kpiRows() {
    const rows = selectedRows();
    if (!["suppliers", "critical"].includes(view)) return rows;
    const ids = new Set(currentRows().map((s) => s.id));
    return rows.filter((r) => ids.has(r.analysisSupplierId));
}
const hasSelection = () => Object.values(selection).some((v) => v.length);
const adverse = (row: any) =>
    settings.rules.some(
        (rule) => rule.active && rule.options.includes(row[rule.dimension]),
    );
function summaryRows() {
    const records = selectedRows(),
        ids = new Set(records.map((r) => r.analysisSupplierId));
    const source = identities.groups.filter(
        (s) =>
            groupSelected(filters.suppliers, s.id) &&
            (!filters.level ||
                (filters.level === "__unassigned__"
                    ? !s.criticalities.length
                    : s.criticalities.includes(filters.level))) &&
            (!filters.mapping ||
                (filters.mapping === "legacy" ? s.hasLegacy : s.hasLinked)) &&
            (!filters.text ||
                ids.has(s.id) ||
                contains(
                    s.name + " " + s.code + " " + s.notes,
                    filters.text,
                )) &&
            (!hasSelection() || ids.has(s.id)),
    );
    return supplierSummary(source, analysisRows(records), settings)
        .map((s) => ({
            ...s,
            levelName: s.criticalities.length
                ? s.criticalities.map(levelName).join(" / ")
                : levelName(""),
            mappingLabel: s.legacy ? "Da collegare" : "Gestionale",
            disabledLabel: s.disabled ? "Sì" : "No",
            ...Object.fromEntries(
                dimensions.flatMap((d) => {
                    const eligible = records.filter(
                        (r) => r.analysisSupplierId === s.id && r[d],
                    );
                    return settings.options[d].flatMap((v) => {
                        const count = eligible.filter(
                            (r) => r[d] === v.id,
                        ).length;
                        return [
                            ["grade:" + v.id, count],
                            [
                                "rate:" + v.id,
                                eligible.length
                                    ? (count / eligible.length) * 100
                                    : null,
                            ],
                        ];
                    });
                }),
            ),
        }))
        .filter(ruleMatch);
}
function currentRows() {
    return ["suppliers", "critical"].includes(view)
        ? summaryRows().filter((s) => view !== "critical" || s.critical)
        : selectedRows();
}
function kpis(rows: any[]) {
    const rated = (dimension: string) => rows.filter((r) => r[dimension]),
        good = (dimension: string) => {
            const options = settings.options[dimension],
                best = Math.min(...options.map((o) => o.rank)),
                ids = options.filter((o) => o.rank === best).map((o) => o.id),
                eligible = rated(dimension);
            return eligible.length
                ? (eligible.filter((r) => ids.includes(r[dimension])).length /
                      eligible.length) *
                      100
                : null;
        };
    const punctuality = good("punctuality"),
        conformity = good("conformity"),
        condition = good("condition"),
        rates = [punctuality, conformity, condition].filter(
            (value): value is number => value != null,
        ),
        overall = rates.length
            ? rates.reduce((sum, value) => sum + value, 0) / rates.length
            : null,
        percent = (value: number | null) =>
            value == null ? "—" : num(value, 1) + "%";
    const critical = supplierSummary(
        identities.groups,
        analysisRows(rows),
        settings,
    ).filter((s) => s.critical).length;
    return [
        ["Valutazioni", num(rows.length)],
        [
            "Fornitori valutati",
            num(new Set(rows.map((r) => r.analysisSupplierId)).size),
        ],
        ["Fornitori critici", num(critical)],
        ["Puntualità", percent(punctuality)],
        ["Conformità", percent(conformity)],
        ["Stato merce", percent(condition)],
        ["Rating generale", percent(overall)],
    ];
}
const kpiHtml = (rows: any[]) =>
    kpis(rows)
        .map(
            ([title, value]) =>
                `<div class="supplier-kpi"><span>${title}</span><strong>${value}</strong></div>`,
        )
        .join("");
const chartSources = {
    "supplier-months": "months",
    "supplier-ranking": "suppliers",
    "supplier-punctuality": "punctuality",
    "supplier-condition": "condition",
    "supplier-conformity": "conformity",
    "supplier-causes": "causes",
};
const generalSources = Object.entries(chartSources).map(([id, key]) => ({
    id,
    title:
        key === "months"
            ? "Storico mensile"
            : key === "suppliers"
              ? "Fornitori"
              : key === "causes"
                ? "Cause segnalazione"
                : names[key],
}));
function chartGroups(source: string, base: any[], limit = 20) {
    let groups: { key: string; name: string; rows: any[] }[] = [];
    if (source === "suppliers")
        groups = [...new Set<string>(base.map((r) => r.analysisSupplierId))]
            .map((id) => ({
                key: id,
                name: supplierGroup(id)?.name || id,
                rows: base.filter((r) => r.analysisSupplierId === id),
            }))
            .sort(
                (a, b) =>
                    b.rows.filter(adverse).length -
                        a.rows.filter(adverse).length ||
                    b.rows.length - a.rows.length,
            );
    else if (source === "months")
        groups = [...new Set<string>(base.map((r) => r.month).filter(Boolean))]
            .sort()
            .map((key) => ({
                key,
                name: key,
                rows: base.filter((r) => r.month === key),
            }));
    else if (source === "causes")
        groups = settings.rules
            .filter((r) => r.active)
            .map((rule) => ({
                key: rule.id,
                name: rule.name,
                rows: base.filter((r) =>
                    rule.options.includes(r[rule.dimension]),
                ),
            }));
    else
        groups = [
            ...settings.options[source].map((option) => ({
                key: option.id,
                name: option.name,
                rows: base.filter((r) => r[source] === option.id),
            })),
            ...(base.some((r) => !r[source])
                ? [
                      {
                          key: "__missing__",
                          name: "Non valutato",
                          rows: base.filter((r) => !r[source]),
                      },
                  ]
                : []),
        ];
    return source === "suppliers" ? groups.slice(0, limit) : groups;
}
function choose(source: string, key: string, multiple: boolean) {
    selection[source] = mergeAreaSelection(selection[source], [key], multiple);
    render();
}
function chartConfig(
    source: string,
    kind: any = "bar",
    metric = "evaluations",
    limit = 20,
): any {
    if (source.startsWith("vendor-"))
        return supplierPerformanceChart(source, kind, metric, limit, {
            rows: manualRows(),
            settings,
            selected,
            active: hasSelection(),
            accent: getComputedStyle(document.body)
                .getPropertyValue("--ops-accent")
                .trim(),
            pick: (values, multiple) => {
                for (const [key, keys] of Object.entries(values))
                    selection[key] = mergeAreaSelection(
                        selection[key] || [],
                        keys,
                        multiple,
                    );
                render();
            },
        });
    source = chartSources[source] || source;
    const base = manualRows(),
        groups = chartGroups(source, base, limit),
        active = hasSelection(),
        measure = (rows: any[]) =>
            metric === "adverse"
                ? rows.filter(adverse).length
                : metric === "rate"
                  ? rows.length
                      ? (rows.filter(adverse).length / rows.length) * 100
                      : 0
                  : rows.length;
    const palette = groups.map((g, i) =>
        source === "punctuality" ||
        source === "condition" ||
        source === "conformity"
            ? ["#21988b", "#d3a145", "#c46170", "#718397"][
                  Math.min(
                      3,
                      Math.max(
                          0,
                          (settings.options[source].find((o) => o.id === g.key)
                              ?.rank || 4) - 1,
                      ),
                  )
              ]
            : [
                  getComputedStyle(document.body)
                      .getPropertyValue("--ops-accent")
                      .trim(),
                  "#438f89",
                  "#7e8da4",
                  "#ca9d49",
                  "#8c78b5",
              ][i % 5],
    );
    const data = groups.map((g) => measure(g.rows)),
        highlight = groups.map((g) => measure(g.rows.filter(selected))),
        labels = groups.map((g) =>
            source === "suppliers" && g.name.length > 38
                ? g.name.slice(0, 37) + "…"
                : g.name,
        ),
        accent = getComputedStyle(document.body)
            .getPropertyValue("--ops-accent")
            .trim();
    return {
        type: kind,
        data: {
            labels,
            datasets: [
                {
                    label:
                        metric === "adverse"
                            ? "Valutazioni con segnalazioni"
                            : metric === "rate"
                              ? "Incidenza segnalazioni %"
                              : "Valutazioni",
                    data,
                    borderWidth: kind === "line" ? 2 : 1,
                    borderColor: kind === "line" ? accent : palette,
                    backgroundColor: active
                        ? palette.map((c) => color(c).alpha(0.22).rgbString())
                        : palette,
                    highlightValues: active ? highlight : undefined,
                    highlightColors: palette,
                    tension: 0.12,
                    pointRadius: 3,
                    maxBarThickness: 28,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            devicePixelRatio: Math.max(2, window.devicePixelRatio || 1),
            indexAxis: source === "suppliers" && kind === "bar" ? "y" : "x",
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (items) =>
                            groups[items[0]?.dataIndex]?.name || "",
                    },
                },
                legend: {
                    display: kind === "doughnut",
                    position: "bottom",
                    labels: { boxWidth: 10, font: { size: 10 } },
                },
            },
            scales:
                kind === "doughnut"
                    ? {}
                    : {
                          x: { ticks: { font: { size: 10 }, maxRotation: 0 } },
                          y: {
                              beginAtZero: true,
                              ticks: { font: { size: 10 }, precision: 0 },
                          },
                      },
            onClick: (event, elements) => {
                const hit = elements[0];
                if (hit)
                    choose(
                        source,
                        groups[hit.index].key,
                        !!(event.native?.ctrlKey || event.native?.metaKey),
                    );
            },
            onAreaSelect: (indices: number[], multiple: boolean) => {
                selection[source] = mergeAreaSelection(
                    selection[source],
                    indices.map((i) => groups[i].key),
                    multiple,
                );
                render();
            },
        },
    };
}
function renderCharts() {
    for (const chart of charts) chart.destroy();
    charts = [];
    const definitions = isSupplierAnalysis()
        ? [
              [
                  "vendor-distribution",
                  "vendor-distribution",
                  "bar",
                  "evaluations",
              ],
              ["vendor-volume", "vendor-volume", "line", "evaluations"],
              ["vendor-quality", "vendor-quality", "line", "rate"],
              ["vendor-issues", "vendor-issues", "line", "adverse"],
              ["vendor-annual", "vendor-annual", "bar", "evaluations"],
              ["vendor-causes", "vendor-causes", "bar", "evaluations"],
          ]
        : [
              ["supplier-months", "months", "line", "evaluations"],
              ["supplier-ranking", "suppliers", "bar", "adverse"],
              [
                  "supplier-punctuality",
                  "punctuality",
                  "doughnut",
                  "evaluations",
              ],
              ["supplier-condition", "condition", "doughnut", "evaluations"],
              ["supplier-conformity", "conformity", "doughnut", "evaluations"],
              ["supplier-causes", "causes", "bar", "evaluations"],
          ];
    for (const [id, source, kind, metric] of definitions)
        charts.push(
            new Chart(
                $<HTMLCanvasElement>(id),
                chartConfig(
                    source,
                    kind,
                    metric,
                    isSupplierAnalysis() ? 0 : 20,
                ),
            ),
        );
    workspace?.sync();
}
let selectorIdentities: typeof identities | null = null;
function renderAnalysisHeader() {
    const group = supplierGroup(analysisSupplierId);
    for (const id of ["supplierAnalysisTitle", "supplierAnalysisCodes"]) {
        $(id).dataset.relatedSuppliers = JSON.stringify(
            supplierNavigationCodes(analysisSupplierId),
        );
        $(id).dataset.relatedSupplierId = analysisSupplierId;
    }
    $("supplierAnalysisTitle").textContent =
        group?.name || "Fornitore non disponibile";
    $("supplierAnalysisCodes").textContent = group?.code
        ? "Codici: " + group.code
        : "Storico Access";
    if (selectorIdentities !== identities) {
        $("analysisSupplierPicker").innerHTML = identities.groups
            .map(
                (g) =>
                    `<option value="${esc(g.id)}">${esc((g.code ? g.code + " / " : "") + g.name)}</option>`,
            )
            .join("");
        selectorIdentities = identities;
    }
    $<HTMLSelectElement>("analysisSupplierPicker").value = analysisSupplierId;
}

function renderChips() {
    const chips = Object.entries(selection).flatMap(([source, keys]) =>
        keys.map((key) => ({
            source,
            key,
            name:
                source === "suppliers"
                    ? supplierGroup(key)?.name
                    : source === "months" || source === "years"
                      ? key
                      : source === "causes"
                        ? settings.rules.find((r) => r.id === key)?.name
                        : label(source, key),
        })),
    );
    $("selectionChips").innerHTML = chips
        .map(
            (c) =>
                `<button class="supplier-chip" data-selection-source="${c.source}" data-selection-key="${esc(c.key)}">${esc(c.name || c.key)} ×</button>`,
        )
        .join("");
}
function visibleColumns() {
    const all = columns(),
        ids =
            preferences.columns[view] ||
            all.slice(0, view === "records" ? 11 : 12).map((c) => c.key);
    return all.filter((c) => ids.includes(c.key));
}
function supplierNavigationCodes(id: string) {
    const group = supplierGroup(id),
        ids = group?.memberIds || [id];
    return [
        ...new Set<string>(
            snapshot.suppliers
                .filter((s) => ids.includes(s.id) && !s.legacy && s.code)
                .map((s) => String(s.code)),
        ),
    ];
}
function recordNavigationCodes(row: any) {
    const s = supplier(row.supplierId);
    return s && !s.legacy && s.code ? [String(s.code)] : [];
}
function tableHtml(rows: any[], cols: Col[]) {
    return `<thead><tr>${cols.map((c) => `<th class="${c.type === "number" ? "numeric" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${
        rows
            .map(
                (r) =>
                    `<tr data-row-id="${esc(r.id)}" class="${r.critical ? "supplier-critical" : ""}">${cols
                        .map((c, i) => {
                            const value = r[c.key],
                                display =
                                    c.type === "date"
                                        ? date(value)
                                        : c.type === "number"
                                          ? num(
                                                value,
                                                c.key === "adverseRate" ||
                                                    c.key.startsWith("rate:")
                                                    ? 2
                                                    : 0,
                                            )
                                          : value || "—";
                            return `<td data-column="${c.key}" ${["code", "name"].includes(c.key) ? `data-related-suppliers="${esc(JSON.stringify(view === "records" ? recordNavigationCodes(r) : supplierNavigationCodes(r.id)))}"` : ""} class="${c.type === "number" ? "numeric" : ""} ${c.key === "causes" ? "supplier-cause-list" : ""}" title="${esc(display)}">${(view === "records" && c.key === "date") || (view !== "records" && c.key === "name") ? `<button class="supplier-link" data-open-row="${esc(r.id)}">${esc(display)}</button>` : esc(display)}</td>`;
                        })
                        .join("")}</tr>`,
            )
            .join("") ||
        `<tr><td colspan="${cols.length}" class="empty">Nessun risultato.</td></tr>`
    }</tbody>`;
}
function renderTable() {
    const all = currentRows(),
        rows = sortByCriteria(all, sort, (r, key) => r[key]),
        cols = visibleColumns(),
        table = $<HTMLTableElement>("supplierTable");
    $("tableTitle").textContent =
        view === "records"
            ? "Valutazioni dei DDT"
            : view === "critical"
              ? "Fornitori con segnalazioni critiche"
              : "Anagrafica e valutazione fornitori";
    table.innerHTML = tableHtml(rows.slice(0, limit), cols);
    const change = (next: SortCriterion[]) => {
        sort = next;
        limit = 250;
        renderTable();
    };
    bindSortingHeaders(table, cols, sort, change);
    updateSortingBar(table, columns(), sort, change);
    $("tableCount").textContent =
        `${num(Math.min(limit, rows.length))} di ${num(rows.length)}`;
    continueTableOnScroll({
        table,
        total: rows.length,
        initial: Math.min(limit, rows.length),
        append: (from, to) =>
            appendTableHtml(table, tableHtml(rows.slice(from, to), cols)),
        progress: (count, total) => {
            limit = count;
            $("tableCount").textContent = `${num(count)} di ${num(total)}`;
        },
    });
    $("columnPicker").innerHTML = columns()
        .map(
            (c) =>
                `<label><input type="checkbox" data-column="${c.key}" ${cols.some((v) => v.key === c.key) ? "checked" : ""}>${esc(c.label)}</label>`,
        )
        .join("");
}
function render() {
    if (!settings) return;
    for (const [id, section] of Object.entries({
        dashboard: "dashboard",
        supplierAnalysis: "supplier-analysis",
        tablePanel: "table",
        settingsPanel: "settings",
        infoPanel: "info",
    }))
        $(id).hidden =
            section === "table"
                ? !["records", "suppliers", "critical"].includes(view)
                : section !== view;
    $("filters").hidden = ["settings", "info"].includes(view);
    $("supplierPicker").parentElement!.hidden = isSupplierAnalysis();
    $("kpis").hidden = ["settings", "info"].includes(view);
    if (!$("kpis").hidden) $("kpis").innerHTML = kpiHtml(kpiRows());
    document
        .querySelectorAll<HTMLButtonElement>("[data-view]")
        .forEach((button) => {
            button.classList.toggle("active", button.dataset.view === view);
            if (button.dataset.view === "supplier-analysis")
                button.disabled = !analysisSupplierId;
        });
    renderChips();
    if (view === "dashboard" || isSupplierAnalysis()) {
        if (isSupplierAnalysis()) renderAnalysisHeader();
        renderCharts();
    }
    if (["records", "suppliers", "critical"].includes(view)) renderTable();
    if (view === "info") renderInfo();
}

function ruleHtml(rule: Rule, index: number) {
    return `<div class="supplier-custom-rule" data-rule="${index}"><select data-rule-field aria-label="Campo">${columns()
        .map(
            (c) =>
                `<option value="${c.key}" ${rule.field === c.key ? "selected" : ""}>${esc(c.label)}</option>`,
        )
        .join("")}</select><select data-rule-op aria-label="Confronto">${[
        ["contains", "Contiene"],
        ["exact", "Uguale a"],
        ["prefix", "Inizia con"],
        ["not", "Non contiene"],
        ["range", "Da / a"],
        ["gte", "Maggiore o uguale"],
        ["lte", "Minore o uguale"],
        ["empty", "Mancante"],
    ]
        .map(
            ([key, title]) =>
                `<option value="${key}" ${key === rule.op ? "selected" : ""}>${title}</option>`,
        )
        .join(
            "",
        )}</select><input data-rule-value value="${esc(rule.value)}" aria-label="Valore" ${rule.op === "empty" ? "hidden" : ""}><input data-rule-to value="${esc(rule.to)}" aria-label="Valore finale" ${rule.op !== "range" ? "hidden" : ""}><button data-remove-rule="${index}" aria-label="Rimuovi condizione">×</button></div>`;
}
function readRules(): Rule[] {
    return [
        ...$("customRules").querySelectorAll<HTMLElement>("[data-rule]"),
    ].map((row) => ({
        field: row.querySelector<HTMLSelectElement>("[data-rule-field]")!.value,
        op: row.querySelector<HTMLSelectElement>("[data-rule-op]")!.value,
        value: row.querySelector<HTMLInputElement>("[data-rule-value]")!.value,
        to: row.querySelector<HTMLInputElement>("[data-rule-to]")!.value,
    }));
}
function filterControls() {
    $("supplierSummary").textContent = filters.suppliers.length
        ? String(filters.suppliers.length)
        : "Tutti";
    $("supplierPicker").innerHTML =
        '<input id="supplierSearch" type="search" placeholder="Codice o ragione sociale" aria-label="Cerca fornitore">' +
        snapshot.suppliers
            .map(
                (s) =>
                    `<label><input type="checkbox" data-filter-supplier="${esc(s.id)}" ${filters.suppliers.includes(s.id) ? "checked" : ""}><span>${esc(s.code ? s.code + " · " : "")}${esc(s.name)}</span></label>`,
            )
            .join("");
    $<HTMLSelectElement>("levelFilter").innerHTML =
        '<option value="">Tutte</option><option value="__unassigned__">Da classificare</option>' +
        settings.levels
            .map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`)
            .join("");
    $<HTMLSelectElement>("levelFilter").value = filters.level;
    for (const d of dimensions) {
        $<HTMLSelectElement>(d + "Filter").innerHTML =
            '<option value="">Tutti</option>' +
            settings.options[d]
                .map(
                    (v) =>
                        `<option value="${esc(v.id)}">${esc(v.name)}</option>`,
                )
                .join("") +
            '<option value="__missing__">Non valutato</option>';
        $<HTMLSelectElement>(d + "Filter").value = filters[d];
    }
    for (const [id, key] of [
        ["dateFrom", "from"],
        ["dateTo", "to"],
        ["textFilter", "text"],
        ["ddtFilter", "ddt"],
        ["authorFilter", "author"],
        ["attachmentsFilter", "attachments"],
        ["mappingFilter", "mapping"],
    ])
        $<HTMLInputElement>(id).value = filters[key];
    const years = [
        ...new Set<string>(
            snapshot.records.map((r) => r.date?.slice(0, 4)).filter(Boolean),
        ),
    ].sort();
    $("yearOptions").innerHTML = analysisYearPicker(years, filters.years);
    $("customRules").innerHTML = filters.rules.map(ruleHtml).join("");
    $("filterPreset").innerHTML =
        '<option value="">Preset filtri</option>' +
        preferences.filterPresets
            .map((p, i) => `<option value="${i}">${esc(p.name)}</option>`)
            .join("");
}
function updateSimpleFilters() {
    filters.level = $<HTMLSelectElement>("levelFilter").value;
    for (const d of dimensions)
        filters[d] = $<HTMLSelectElement>(d + "Filter").value;
    for (const [id, key] of [
        ["dateFrom", "from"],
        ["dateTo", "to"],
        ["textFilter", "text"],
        ["ddtFilter", "ddt"],
        ["authorFilter", "author"],
        ["attachmentsFilter", "attachments"],
        ["mappingFilter", "mapping"],
    ])
        filters[key] = $<HTMLInputElement>(id).value;
    if (filters.from && filters.to && filters.from > filters.to) {
        message("Intervallo date invertito.", true);
        return;
    }
    limit = 250;
    render();
    message(snapshot.erpError || "");
}
function hydrateFilters(value: any) {
    const result = emptyFilters();
    if (!value || typeof value !== "object") return result;
    for (const key of Object.keys(result)) {
        if (key === "rules") {
            result.rules = Array.isArray(value.rules)
                ? value.rules
                      .filter(
                          (r) =>
                              r &&
                              typeof r.field === "string" &&
                              typeof r.op === "string" &&
                              typeof r.value === "string",
                      )
                      .slice(0, 30)
                : [];
        } else if (Array.isArray(result[key]))
            result[key] = Array.isArray(value[key])
                ? value[key]
                      .filter((v) => typeof v === "string")
                      .slice(0, 10000)
                : [];
        else if (typeof value[key] === "string")
            result[key] = value[key].slice(0, 1000);
    }
    return result;
}
async function load(refresh = false) {
    const result = await api("snapshot", { refresh });
    snapshot = result;
    refreshIdentities();
    settings = result.settings;
    filterControls();
    render();
    message(result.erpError || "");
}
async function withBusy(fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    $<HTMLButtonElement>("saveEntity").disabled = true;
    try {
        await fn();
    } catch (error) {
        message((error as Error).message, true);
        if ($<HTMLDialogElement>("editDialog").open)
            $("editError").textContent = (error as Error).message;
    } finally {
        busy = false;
        $<HTMLButtonElement>("saveEntity").disabled = false;
    }
}
function recordById(id: string) {
    return snapshot.records.find((r) => r.id === id);
}
function optionHtml(d: string, current: string) {
    return (
        '<option value="">Non valutato</option>' +
        settings.options[d]
            .filter((v) => v.active || v.id === current)
            .map(
                (v) =>
                    `<option value="${esc(v.id)}" ${v.id === current ? "selected" : ""}>${esc(v.name)}</option>`,
            )
            .join("")
    );
}
function attachmentList() {
    const list = $("recordAttachments");
    if (!list) return;
    list.innerHTML = [
        ...retainedAttachments.map((id) => ({
            id,
            name:
                snapshot.attachments.find((a) => a.id === id)?.name ||
                "Allegato",
            new: false,
        })),
        ...newAttachments.map((a, i) => ({
            id: String(i),
            name: a.name,
            new: true,
        })),
    ]
        .map(
            (a) =>
                `<div class="supplier-attachments">${a.new ? `<span>${esc(a.name)}</span>` : `<button type="button" data-open-attachment="${esc(a.id)}">${esc(a.name)}</button>`}<button type="button" data-remove-attachment="${esc(a.id)}" data-attachment-new="${a.new ? "1" : "0"}" aria-label="Rimuovi allegato">×</button></div>`,
        )
        .join("");
}
function openEditor(kind: string, entity?: any) {
    editKind = kind;
    editing = entity || null;
    newAttachments = [];
    $("editError").textContent = "";
    const dialog = $<HTMLDialogElement>("editDialog");
    if (kind === "record") {
        const r = entity || {},
            eligible = snapshot.suppliers.filter(
                (s) => !s.legacy || s.id === r.supplierId,
            );
        retainedAttachments = snapshot.attachments
            .filter((a) => a.recordId === r.id)
            .map((a) => a.id);
        $("editTitle").textContent = r.id
            ? "Modifica valutazione DDT"
            : "Nuova valutazione DDT";
        $("editFields").innerHTML =
            `<label class="full">Cerca fornitore<input type="search" id="editSupplierSearch" placeholder="Filtra per codice o ragione sociale"></label><label class="full">Fornitore<select name="supplierId" required><option value="">Seleziona un fornitore del gestionale</option>${eligible.map((s) => `<option value="${esc(s.id)}" ${s.id === r.supplierId ? "selected" : ""}>${esc(s.code ? s.code + " · " : "")}${esc(s.name)}${s.disabled ? " · Disabilitato" : ""}${s.legacy ? " · Storico da collegare" : ""}</option>`).join("")}</select></label><label>Data<input name="date" type="date" value="${esc(r.date || today())}" required></label><label>Numero DDT<input name="ddt" maxlength="255" value="${esc(r.ddt)}"></label>${dimensions.map((d) => `<label>${names[d]}<select name="${d}">${optionHtml(d, r[d] || "")}</select></label>`).join("")}<label class="full">Note<textarea name="notes" maxlength="20000">${esc(r.notes)}</textarea></label>${r.extra ? `<label class="full">Campo aggiuntivo storico<input name="extra" value="${esc(r.extra)}"></label>` : ""}<div class="full"><div id="recordAttachments"></div><button id="addAttachments" type="button">+ Allegati</button></div>`;
        attachmentList();
    } else {
        const s = entity;
        $("editTitle").textContent = "Classificazione · " + s.name;
        $("editFields").innerHTML =
            `<label>Codice gestionale<input value="${esc(s.code || "Storico Access")}" disabled></label><label>Criticità assegnata<select name="criticality"><option value="">Da classificare</option>${settings.levels
                .filter((l) => l.active || l.id === s.criticality)
                .map(
                    (l) =>
                        `<option value="${esc(l.id)}" ${s.criticality === l.id ? "selected" : ""}>${esc(l.name)}</option>`,
                )
                .join(
                    "",
                )}</select></label>${s.legacy || s.id.startsWith("legacy:") ? '<label class="full">Cerca nel gestionale<input id="editErpSearch" type="search" placeholder="Codice o ragione sociale"></label>' : ""}<label class="full">Collegamento all’anagrafica gestionale<select name="erpCode" ${s.legacy || s.id.startsWith("legacy:") ? "" : "disabled"}><option value="">Non collegato</option>${snapshot.suppliers
                .filter((v) => !v.legacy)
                .map(
                    (v) =>
                        `<option value="${esc(v.code)}" ${v.code === s.erpCode ? "selected" : ""}>${esc(v.code + " · " + v.name)}</option>`,
                )
                .join(
                    "",
                )}</select></label><label class="full">Note classificazione<textarea name="notes">${esc(s.notes)}</textarea></label>`;
    }
    dialog.showModal();
}
function closeEditor() {
    $<HTMLDialogElement>("editDialog").close();
}
async function deleteRecord(id: string) {
    const row = recordById(id);
    if (!row) return;
    const dialog = $<HTMLDialogElement>("confirmDialog");
    dialog.returnValue = "cancel";
    dialog.showModal();
    const answer = await new Promise<string>((resolve) =>
        dialog.addEventListener("close", () => resolve(dialog.returnValue), {
            once: true,
        }),
    );
    if (answer === "delete")
        await withBusy(async () => {
            await api("delete-record", {
                entity: { id, revision: row.revision },
            });
            await load();
            message("Valutazione eliminata.");
        });
}
function showSupplier(id: string) {
    const s = supplierGroup(id);
    if (!s) return;
    detailId = id;
    $("detailTitle").dataset.relatedSuppliers = JSON.stringify(
        supplierNavigationCodes(id),
    );
    $("detailTitle").dataset.relatedSupplierId = id;
    const records = selectedRows().filter((r) => r.analysisSupplierId === s.id),
        summary = supplierSummary([s], analysisRows(records), settings)[0];
    $("detailTitle").textContent = (s.code ? s.code + " · " : "") + s.name;
    $("detailMetrics").innerHTML = kpiHtml(records);
    $("detailCauses").innerHTML = summary.causeDetails
        .map(
            (c) =>
                `<div class="supplier-cause-detail"><strong>${esc(c.name)}</strong><span>${num(c.count)} / ${num(c.total)} · ${c.rate == null ? "—" : num(c.rate, 1) + "%"} · ${c.critical ? "Soglia raggiunta" : "Sotto soglia"}</span></div>`,
        )
        .join("");
    const cols = recordColumns.filter(
        (c) =>
            !["code", "name", "levelName", "id", "updatedBy"].includes(c.key),
    );
    $<HTMLTableElement>("detailTable").innerHTML =
        `<thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${
            records
                .sort((a, b) => String(b.date).localeCompare(a.date))
                .map(
                    (r) =>
                        `<tr data-detail-record="${esc(r.id)}">${cols.map((c) => `<td class="${c.type === "number" ? "numeric" : ""}">${c.key === "date" ? `<button class="supplier-link" data-edit-record="${esc(r.id)}">${esc(date(r.date))}</button>` : esc(c.type === "number" ? num(r[c.key]) : r[c.key] || "—")}</td>`).join("")}</tr>`,
                )
                .join("") ||
            `<tr><td colspan="${cols.length}">Nessuna valutazione nei filtri.</td></tr>`
        }</tbody>`;
    $<HTMLDialogElement>("supplierDetail").showModal();
}
function changeView(next: string) {
    if (workspace?.isSaving()) {
        message("Attendi il salvataggio dei grafici.");
        return false;
    }
    if (view === "settings" && next !== "settings" && settingsDirty()) {
        message(
            "Salva oppure ricarica la configurazione prima di cambiare sezione.",
            true,
        );
        return false;
    }
    if (next === "supplier-analysis" && !analysisSupplierId) return false;
    workspace?.closeFocus();
    const before = isSupplierAnalysis(),
        after = next === "supplier-analysis",
        different = before !== after;
    if (different) {
        if (before) {
            detailFilters = filters;
            detailSelection = selection;
            filters = generalFilters;
            selection = generalSelection;
        } else {
            generalFilters = filters;
            generalSelection = selection;
            filters = detailFilters;
            selection = detailSelection;
        }
    }
    const sameScope =
        ["suppliers", "critical"].includes(view) ===
        ["suppliers", "critical"].includes(next);
    view = next;
    limit = 250;
    sort =
        view === "records"
            ? [{ key: "date", direction: "desc" }]
            : [
                  {
                      key: view === "critical" ? "adverse" : "name",
                      direction: view === "critical" ? "desc" : "asc",
                  },
              ];
    if (!different && !sameScope) filters.rules = [];
    if (view === "settings") {
        staged = clone(settings);
        renderSettings();
    }
    filterControls();
    render();
    if (different) {
        workspaceIsSupplier = after;
        workspace?.replacePreferences(
            preferences[after ? "supplierWorkspace" : "workspace"] ||
                emptyWorkspace(),
        );
    }
    message(snapshot.erpError || "");
    return true;
}
function analyzeSupplier(id: string) {
    const group = supplierGroup(id);
    if (!group || workspace?.isSaving()) return;
    if (view === "settings" && settingsDirty()) {
        message("Salva o ricarica la configurazione.", true);
        return;
    }
    const changed = analysisSupplierId !== group.id;
    analysisSupplierId = group.id;
    if (changed) {
        detailSelection = emptySelection();
        if (isSupplierAnalysis()) selection = detailSelection;
        else
            detailFilters = {
                ...clone(filters),
                suppliers: [],
                text: "",
                rules: [],
            };
    }
    changeView("supplier-analysis");
}

function renderInfo() {
    const i = snapshot.importInfo;
    $("importInfo").innerHTML =
        `<p>Codici fornitore nel gestionale: <b>${num(snapshot.suppliers.filter((s) => !s.legacy).length)}</b> · Storici da collegare: <b>${num(snapshot.suppliers.filter((s) => s.legacy).length)}</b> · Valutazioni archiviate: <b>${num(snapshot.records.length)}</b></p>${i ? `<p>Ultimo confronto: ${esc(date(i.readAt))}. Nuove valutazioni: ${num(i.records)}, classificazioni: ${num(i.profiles)}, allegati: ${num(i.attachments)}.</p>${i.issues?.length ? `<details><summary>Dati da verificare (${i.issues.length})</summary><ul>${i.issues.map((issue) => `<li>${esc(issue)}</li>`).join("")}</ul></details>` : ""}` : "<p>Archivio pronto per registrare nuove valutazioni. Nessun confronto Access eseguito.</p>"}${snapshot.erpError ? `<p>${esc(snapshot.erpError)}</p>` : ""}<details><summary>Collegamenti delle anagrafiche storiche</summary><div class="table-scroll"><table><thead><tr><th>Nome Access</th><th>Codice gestionale</th><th>Collegamento</th></tr></thead><tbody>${snapshot.profiles
            .filter((p) => p.id.startsWith("legacy:"))
            .map(
                (p) =>
                    `<tr><td>${esc(p.name)}</td><td>${esc(p.erpCode || "Non collegato")}</td><td><button data-legacy-profile="${esc(p.id)}">Collega / modifica</button></td></tr>`,
            )
            .join("")}</tbody></table></div></details>`;
}
function readSettings(): SupplierSettings {
    const ratings = (key: string) =>
        [
            ...$("catalogSettings").querySelectorAll<HTMLElement>(
                `[data-catalog="${key}"] [data-option-id]`,
            ),
        ].map((row) => ({
            id: row.dataset.optionId!,
            name: row.querySelector<HTMLInputElement>("[data-name]")!.value,
            rank: Number(
                row.querySelector<HTMLInputElement>("[data-rank]")!.value,
            ),
            active: row.querySelector<HTMLInputElement>("[data-active]")!
                .checked,
        }));
    const rules = [
        ...$("criticalRules").querySelectorAll<HTMLElement>(
            "[data-critical-rule]",
        ),
    ].map((row) => ({
        id: row.dataset.criticalRule!,
        name: row.querySelector<HTMLInputElement>("[data-rule-name]")!.value,
        dimension: row.querySelector<HTMLSelectElement>("[data-dimension]")!
            .value as any,
        options: [
            ...row.querySelectorAll<HTMLInputElement>("[data-option]:checked"),
        ].map((i) => i.dataset.option!),
        mode: row.querySelector<HTMLSelectElement>("[data-mode]")!.value as any,
        count: Number(
            row.querySelector<HTMLInputElement>("[data-count]")!.value,
        ),
        rate: Number(row.querySelector<HTMLInputElement>("[data-rate]")!.value),
        minSample: Number(
            row.querySelector<HTMLInputElement>("[data-sample]")!.value,
        ),
        active: row.querySelector<HTMLInputElement>("[data-rule-active]")!
            .checked,
    }));
    return {
        revision: staged!.revision,
        levels: ratings("levels"),
        options: Object.fromEntries(
            dimensions.map((d) => [d, ratings(d)]),
        ) as any,
        rules,
    };
}
function settingsDirty() {
    const original = {
        revision: settings.revision,
        levels: settings.levels,
        options: settings.options,
        rules: settings.rules,
    };
    return JSON.stringify(readSettings()) !== JSON.stringify(original);
}
function renderSettings() {
    if (!staged) staged = clone(settings);
    const data = staged;
    $("catalogSettings").innerHTML =
        '<div class="supplier-catalog-grid">' +
        [
            { id: "levels", title: "Livelli di criticità assegnata" },
            ...dimensions.map((d) => ({ id: d, title: names[d] })),
        ]
            .map(
                (group) =>
                    `<article class="panel" data-catalog="${group.id}"><h3>${group.title}</h3><table><thead><tr><th>Nome</th><th>Ordine</th><th>Attivo</th></tr></thead><tbody>${(group.id === "levels" ? data.levels : data.options[group.id]).map((v) => `<tr data-option-id="${esc(v.id)}"><td><input data-name type="text" value="${esc(v.name)}" maxlength="100" aria-label="Nome voce"></td><td><input data-rank type="number" min="1" max="1000" value="${v.rank}" aria-label="Ordine"></td><td><input data-active type="checkbox" ${v.active ? "checked" : ""} aria-label="Voce attiva"></td></tr>`).join("")}</tbody></table><button data-add-catalog="${group.id}">+ Voce</button></article>`,
            )
            .join("") +
        "</div>";
    $("criticalRules").innerHTML = data.rules
        .map(
            (r) =>
                `<article class="supplier-critical-rule" data-critical-rule="${esc(r.id)}"><label>Tipologia / causa<input data-rule-name value="${esc(r.name)}" maxlength="150"></label><label>Dimensione<select data-dimension>${dimensions.map((d) => `<option value="${d}" ${r.dimension === d ? "selected" : ""}>${names[d]}</option>`).join("")}</select></label><label>Criterio<select data-mode>${[
                    ["count", "Conteggio"],
                    ["rate", "Percentuale"],
                    ["either", "Uno dei due"],
                ]
                    .map(
                        ([id, name]) =>
                            `<option value="${id}" ${r.mode === id ? "selected" : ""}>${name}</option>`,
                    )
                    .join(
                        "",
                    )}</select></label><label>Soglia conteggio<input data-count type="number" min="1" value="${r.count}"></label><label>Soglia %<input data-rate type="number" min="0" max="100" step="0.1" value="${r.rate}"></label><label>Campione minimo %<input data-sample type="number" min="1" value="${r.minSample}"></label><button data-remove-critical-rule="${esc(r.id)}" aria-label="Rimuovi tipologia">×</button><div class="rule-options"><label><input data-rule-active type="checkbox" ${r.active ? "checked" : ""}> Attiva</label><span>Esiti da conteggiare:</span>${data.options[r.dimension].map((v) => `<label><input data-option="${esc(v.id)}" type="checkbox" ${r.options.includes(v.id) ? "checked" : ""}>${esc(v.name)}</label>`).join("")}</div></article>`,
        )
        .join("");
}
async function employees() {
    try {
        const result = await ipc.invoke("supplier-evaluation-employees");
        if (!result.ok) throw Error(result.error);
        const groups = result.groups;
        $("loginDepartment").innerHTML = Object.keys(groups)
            .map((g) => `<option>${esc(g)}</option>`)
            .join("");
        const fill = () => {
            $("loginEmployee").innerHTML =
                '<option value="">Seleziona dipendente</option>' +
                (groups[$<HTMLSelectElement>("loginDepartment").value] || [])
                    .map((n) => `<option>${esc(n)}</option>`)
                    .join("");
        };
        $("loginDepartment").onchange = fill;
        fill();
        $("loginError").textContent = "";
    } catch (error) {
        $("loginError").textContent = (error as Error).message;
    }
}
$("loginForm").onsubmit = async (event) => {
    event.preventDefault();
    $<HTMLButtonElement>("loginSubmit").disabled = true;
    try {
        const result = await ipc.invoke(
            "supplier-evaluation-login",
            $<HTMLSelectElement>("loginEmployee").value,
        );
        if (!result.ok) throw Error(result.error);
        actor = result.actor;
        snapshot = result;
        refreshIdentities();
        settings = result.settings;
        const saved = await api("preferences-get");
        preferences = {
            ...preferences,
            ...saved.preferences,
            workspace: saved.preferences?.workspace || emptyWorkspace(),
            supplierWorkspace:
                saved.preferences?.supplierWorkspace || emptyWorkspace(),
        };
        if (!Array.isArray(preferences.filterPresets))
            preferences.filterPresets = [];
        $("workspace").hidden = false;
        $<HTMLDialogElement>("loginDialog").close();
        for (const id of ["newRecord", "export", "refresh", "operator"])
            $<HTMLButtonElement>(id).disabled = false;
        $("operator").textContent = actor;
        filterControls();
        render();
        workspace = installAnalysisWorkspace({
            key: "supplier-evaluation",
            actions: $("headerActions"),
            container: () =>
                (isSupplierAnalysis()
                    ? $("supplierAnalysisCharts")
                    : $("dashboard")
                ).querySelector<HTMLElement>(".supplier-chart-grid")!,
            scope: () =>
                isSupplierAnalysis()
                    ? $("supplierAnalysisCharts")
                    : $("dashboard"),
            sources: () =>
                isSupplierAnalysis()
                    ? supplierPerformanceSources
                    : generalSources,
            metrics: [
                { id: "evaluations", title: "Valutazioni" },
                { id: "adverse", title: "Valutazioni con segnalazioni" },
                { id: "rate", title: "Incidenza segnalazioni %" },
            ],
            reset: () => {
                for (const key of Object.keys(selection)) selection[key] = [];
                render();
            },
            build: (spec) =>
                chartConfig(spec.source, spec.kind, spec.metric, spec.limit),
            revision: () =>
                JSON.stringify([
                    view,
                    analysisSupplierId,
                    filters,
                    selection,
                    snapshot.records.map((r) => [r.id, r.revision]),
                    snapshot.profiles.map((p) => [p.id, p.revision]),
                    settings.revision,
                ]),
            persistence: {
                load: async () => ({
                    ok: true,
                    preferences: preferences.workspace,
                }),
                save: async (value) => {
                    preferences[
                        workspaceIsSupplier ? "supplierWorkspace" : "workspace"
                    ] = value;
                    await savePreferences();
                    return { ok: true, preferences: value };
                },
            },
        });
        workspace.sync();
        message(snapshot.erpError || "");
        applySupplierNavigation();
    } catch (error) {
        $("loginError").textContent = (error as Error).message;
    } finally {
        $<HTMLButtonElement>("loginSubmit").disabled = false;
    }
};
$("loginRetry").onclick = () => void employees();
$("loginClose").onclick = $("close").onclick = () =>
    ipc.send("supplier-evaluation-close");
$<HTMLDialogElement>("loginDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    ipc.send("supplier-evaluation-close");
});
$("operator").onclick = () => {
    ipc.send("supplier-evaluation-logout");
    location.reload();
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-view]",
))
    button.onclick = () => {
        changeView(button.dataset.view!);
    };
$("analysisSupplierPicker").onchange = () =>
    analyzeSupplier($<HTMLSelectElement>("analysisSupplierPicker").value);
$("analysisBack").onclick = () => changeView("dashboard");
$("analysisLedger").onclick = () => showSupplier(analysisSupplierId);
$("refresh").onclick = () =>
    void withBusy(async () => {
        if (view === "settings" && settingsDirty())
            throw Error(
                "Salva o ricarica la configurazione prima di aggiornare.",
            );
        await load(true);
    });
$("newRecord").onclick = () => {
    if (!snapshot.erpAvailable) {
        message(
            "Aggiorna l’elenco del gestionale prima di inserire nuove valutazioni.",
            true,
        );
        return;
    }
    openEditor("record");
};
$("supplierPicker").addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "supplierSearch")
        $("supplierPicker")
            .querySelectorAll<HTMLElement>("label")
            .forEach(
                (label) =>
                    (label.hidden = !contains(label.textContent, input.value)),
            );
});
$("supplierPicker").addEventListener("change", () => {
    filters.suppliers = [
        ...$("supplierPicker").querySelectorAll<HTMLInputElement>(
            "[data-filter-supplier]:checked",
        ),
    ].map((i) => i.dataset.filterSupplier!);
    $("supplierSummary").textContent = filters.suppliers.length
        ? String(filters.suppliers.length)
        : "Tutti";
    limit = 250;
    render();
});
for (const id of [
    "levelFilter",
    "dateFrom",
    "dateTo",
    "punctualityFilter",
    "conditionFilter",
    "conformityFilter",
    "attachmentsFilter",
    "mappingFilter",
])
    $(id).addEventListener("change", updateSimpleFilters);
for (const id of ["textFilter", "ddtFilter", "authorFilter"])
    $(id).addEventListener("input", updateSimpleFilters);
$("yearOptions").addEventListener("change", () => {
    filters.years = [
        ...$("yearOptions").querySelectorAll<HTMLInputElement>(
            "[data-year]:checked",
        ),
    ].map((i) => i.dataset.year!);
    limit = 250;
    render();
});
$("yearOptions").addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-years]",
    );
    if (!button) return;
    const years = [
        ...$("yearOptions").querySelectorAll<HTMLInputElement>("[data-year]"),
    ].map((i) => i.dataset.year!);
    filters.years = button.dataset.years === "all" ? [] : years.slice(-2);
    filterControls();
    render();
});
$("resetFilters").onclick = () => {
    filters = emptyFilters();
    for (const key of Object.keys(selection)) selection[key] = [];
    limit = 250;
    filterControls();
    render();
};
$("addRule").onclick = () => {
    const rules = readRules();
    if (rules.length >= 30) {
        message("Massimo 30 condizioni.", true);
        return;
    }
    rules.push({ field: columns()[0].key, op: "contains", value: "", to: "" });
    $("customRules").innerHTML = rules.map(ruleHtml).join("");
};
$("customRules").addEventListener("change", (event) => {
    if (
        (event.target as HTMLElement).matches(
            "[data-rule-field],[data-rule-op]",
        )
    )
        $("customRules").innerHTML = readRules().map(ruleHtml).join("");
});
$("customRules").onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-remove-rule]",
    );
    if (button) {
        const rows = readRules().filter(
            (_, i) => i !== Number(button.dataset.removeRule),
        );
        $("customRules").innerHTML = rows.map(ruleHtml).join("");
    }
};
$("applyRules").onclick = () => {
    filters.rules = readRules();
    limit = 250;
    render();
};
$("saveFilterPreset").onclick = () =>
    void withBusy(async () => {
        const name = $<HTMLInputElement>("filterPresetName").value.trim();
        if (
            !name ||
            preferences.filterPresets.length >= 10 ||
            preferences.filterPresets.some(
                (p) =>
                    p.name.toLocaleLowerCase("it") ===
                    name.toLocaleLowerCase("it"),
            )
        )
            throw Error("Inserisci un nome univoco; massimo 10 preset.");
        filters.rules = readRules();
        preferences.filterPresets.push({
            name,
            filters: {
                ...clone(filters),
                view,
                analysisSupplierId: isSupplierAnalysis()
                    ? analysisSupplierId
                    : "",
            },
        });
        await savePreferences();
        filterControls();
        message("Preset salvato.");
    });
$("filterPreset").onchange = () => {
    const index = $<HTMLSelectElement>("filterPreset").value;
    if (index === "") return;
    const preset = preferences.filterPresets[Number(index)];
    if (
        preset.filters.view === "supplier-analysis" &&
        supplierGroup(preset.filters.analysisSupplierId)
    )
        analysisSupplierId = supplierGroup(
            preset.filters.analysisSupplierId,
        ).id;
    const target = [
        "dashboard",
        "supplier-analysis",
        "records",
        "suppliers",
        "critical",
    ].includes(preset.filters.view)
        ? preset.filters.view
        : view;
    if (!changeView(target)) return;
    filters = hydrateFilters(preset.filters);
    filterControls();
    render();
};
$("deleteFilterPreset").onclick = () =>
    void withBusy(async () => {
        const index = $<HTMLSelectElement>("filterPreset").value;
        if (index === "") return;
        preferences.filterPresets.splice(Number(index), 1);
        await savePreferences();
        filterControls();
    });
$("selectionChips").onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-selection-source]",
    );
    if (button) {
        selection[button.dataset.selectionSource!] = selection[
            button.dataset.selectionSource!
        ].filter((v) => v !== button.dataset.selectionKey);
        render();
    }
};
$("columnPicker").onchange = () =>
    void withBusy(async () => {
        const ids = [
            ...$("columnPicker").querySelectorAll<HTMLInputElement>(
                "[data-column]:checked",
            ),
        ].map((i) => i.dataset.column!);
        if (!ids.length) {
            renderTable();
            throw Error("Mantieni almeno una colonna.");
        }
        preferences.columns[view] = ids;
        await savePreferences();
        renderTable();
    });
$("supplierTable").onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-open-row]",
    );
    if (button) {
        if (view === "records")
            openEditor("record", recordById(button.dataset.openRow!));
        else analyzeSupplier(button.dataset.openRow!);
    }
};
$("supplierTable").addEventListener("contextmenu", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-row-id]",
    );
    if (!row) return;
    event.preventDefault();
    void ipc
        .invoke("supplier-evaluation-context", {
            id: row.dataset.rowId,
            kind: view === "records" ? "record" : "supplier",
            relatedSuppliers: JSON.parse(
                (event.target as HTMLElement).closest<HTMLElement>(
                    "[data-related-suppliers]",
                )?.dataset.relatedSuppliers || "[]",
            ),
        })
        .then((result: any) => {
            if (!result.ok)
                message(result.error || "Operazione non riuscita.", true);
        })
        .catch((error: Error) => message(error.message, true));
});
ipc.on("supplier-evaluation-action", (_event: any, p: any) => {
    if (p.kind === "record") {
        if (p.action === "delete") void deleteRecord(p.id);
        else openEditor("record", recordById(p.id));
    } else if (p.action === "analyze") analyzeSupplier(p.id);
    else openEditor("profile", supplier(p.id));
});
$("detailTable").onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-edit-record]",
    );
    if (button) openEditor("record", recordById(button.dataset.editRecord!));
};
$("detailClose").onclick = () => $<HTMLDialogElement>("supplierDetail").close();
$("detailAnalyze").onclick = () => {
    $<HTMLDialogElement>("supplierDetail").close();
    analyzeSupplier(detailId);
};
$("editClose").onclick = $("editCancel").onclick = closeEditor;
$("editForm").onsubmit = (event) => {
    event.preventDefault();
    void withBusy(async () => {
        const form = $<HTMLFormElement>("editForm"),
            value = Object.fromEntries(new FormData(form));
        if (editKind === "record")
            await api("record", {
                entity: {
                    ...editing,
                    ...value,
                    attachmentIds: retainedAttachments,
                    newAttachments,
                },
            });
        else
            await api("profile", {
                entity: {
                    id: editing.id,
                    profileId: editing.profileId,
                    revision: editing.revision,
                    criticality: value.criticality,
                    notes: value.notes,
                    erpCode:
                        form.querySelector<HTMLSelectElement>("[name=erpCode]")!
                            .value,
                },
            });
        closeEditor();
        await load();
        message("Scheda salvata.");
    });
};
$("editFields").addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "editSupplierSearch" || input.id === "editErpSearch") {
        const select = $("editFields").querySelector<HTMLSelectElement>(
            input.id === "editErpSearch"
                ? "[name=erpCode]"
                : "[name=supplierId]",
        )!;
        for (const option of select.options)
            option.hidden =
                !!option.value && !contains(option.textContent, input.value);
    }
});
$("editFields").onclick = async (event) => {
    const target = event.target as HTMLElement,
        open = target.closest<HTMLElement>("[data-open-attachment]"),
        remove = target.closest<HTMLElement>("[data-remove-attachment]");
    if (open) {
        const result = await ipc.invoke(
            "supplier-evaluation-open-attachment",
            open.dataset.openAttachment,
        );
        if (!result.ok) $("editError").textContent = result.error;
    }
    if (remove) {
        if (remove.dataset.attachmentNew === "1")
            newAttachments.splice(Number(remove.dataset.removeAttachment), 1);
        else
            retainedAttachments = retainedAttachments.filter(
                (id) => id !== remove.dataset.removeAttachment,
            );
        attachmentList();
    }
    if (target.closest("#addAttachments")) {
        const result = await ipc.invoke("supplier-evaluation-pick-attachments");
        if (result.ok) {
            newAttachments.push(...result.attachments);
            attachmentList();
        } else $("editError").textContent = result.error;
    }
};
$("catalogSettings").onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-add-catalog]",
    );
    if (!button) return;
    staged = readSettings();
    const key = button.dataset.addCatalog!,
        list = key === "levels" ? staged.levels : staged.options[key];
    list.push({
        id: key + ":" + crypto.randomUUID(),
        name: "Nuova voce",
        rank: Math.max(...list.map((v) => v.rank)) + 1,
        active: true,
    });
    renderSettings();
};
$("criticalRules").addEventListener("change", (event) => {
    const input = event.target as HTMLSelectElement;
    if (!input.matches("[data-dimension]")) return;
    const row = input.closest<HTMLElement>("[data-critical-rule]")!;
    staged = readSettings();
    const r = staged.rules.find((r) => r.id === row.dataset.criticalRule)!;
    r.options = staged.options[r.dimension]
        .filter((o) => o.rank === 3)
        .map((o) => o.id);
    if (!r.options.length) r.options = [staged.options[r.dimension][0].id];
    renderSettings();
});
$("criticalRules").onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-remove-critical-rule]",
    );
    if (button) {
        staged = readSettings();
        staged.rules = staged.rules.filter(
            (r) => r.id !== button.dataset.removeCriticalRule,
        );
        renderSettings();
    }
};
$("addCriticalRule").onclick = () => {
    staged = readSettings();
    staged.rules.push({
        id: "rule:" + crypto.randomUUID(),
        name: "Nuova tipologia",
        dimension: "punctuality",
        options: [
            staged.options.punctuality.find((v) => v.rank === 3)?.id ||
                staged.options.punctuality[0].id,
        ],
        mode: "count",
        count: 3,
        rate: 20,
        minSample: 5,
        active: true,
    });
    renderSettings();
};
$("saveSettings").onclick = () =>
    void withBusy(async () => {
        const result = await api("settings-save", { settings: readSettings() });
        settings = result.settings;
        staged = clone(settings);
        await load();
        renderSettings();
        message("Configurazione salvata.");
    });
$("resetSettings").onclick = () => {
    staged = clone(settings);
    renderSettings();
    message();
};
$("importAccess").onclick = () =>
    void withBusy(async () => {
        message("Confronto Access in corso…");
        const result = await ipc.invoke("supplier-evaluation-import", {
            phase: "preview",
        });
        if (!result.ok) throw Error(result.error);
        importToken = result.token;
        const report = result.report;
        $("importSummary").innerHTML =
            `<p>Da aggiungere: <b>${num(report.records)}</b> valutazioni, <b>${num(report.profiles)}</b> classificazioni, <b>${num(report.attachments)}</b> allegati.</p><p>${num(report.differences.length)} valutazioni già presenti con differenze: rimarranno invariate.</p>`;
        $("importDifferences").innerHTML =
            `<table><thead><tr><th>ID</th><th>DDT</th><th>Fornitore</th><th>Campo</th><th>AyPi</th><th>Access</th></tr></thead><tbody>${report.differences.flatMap((r) => (r.changes || []).map((c) => `<tr><td>${esc(r.id)}</td><td>${esc(r.ddt)}</td><td>${esc(r.supplier)}</td><td>${esc(names[c.field] || { date: "Data", ddt: "DDT", notes: "Note", extra: "Campo storico" }[c.field] || c.field)}</td><td>${esc(dimensions.includes(c.field) ? label(c.field, c.existing) : c.existing)}</td><td>${esc(dimensions.includes(c.field) ? label(c.field, c.incoming) : c.incoming)}</td></tr>`)).join("")}</tbody></table>`;
        $("importError").textContent = "";
        $<HTMLDialogElement>("importDialog").showModal();
        message();
    });
async function cancelImport() {
    await ipc.invoke("supplier-evaluation-import", {
        phase: "cancel",
        token: importToken,
    });
    importToken = "";
    $<HTMLDialogElement>("importDialog").close();
}
$("importClose").onclick = $("importCancel").onclick = () =>
    void cancelImport();
$<HTMLDialogElement>("importDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    void cancelImport();
});
$("importApply").onclick = async () => {
    $<HTMLButtonElement>("importApply").disabled = true;
    try {
        const result = await ipc.invoke("supplier-evaluation-import", {
            phase: "apply",
            token: importToken,
        });
        if (!result.ok) throw Error(result.error);
        $<HTMLDialogElement>("importDialog").close();
        await load();
        message(
            `Confronto completato: ${num(result.report.records)} valutazioni aggiunte.`,
        );
    } catch (error) {
        $("importError").textContent = (error as Error).message;
    } finally {
        $<HTMLButtonElement>("importApply").disabled = false;
    }
};
$("export").onclick = () =>
    void withBusy(async () => {
        const cols = [
                "dashboard",
                "supplier-analysis",
                "info",
                "settings",
            ].includes(view)
                ? recordColumns
                : visibleColumns(),
            rows = [
                "dashboard",
                "supplier-analysis",
                "info",
                "settings",
            ].includes(view)
                ? selectedRows()
                : sortByCriteria(currentRows(), sort, (r, k) => r[k]);
        const result = await ipc.invoke("supplier-evaluation-export", {
            columns: cols,
            rows: rows.map((r) => cols.map((c) => r[c.key] ?? null)),
        });
        if (!result.ok) throw Error(result.error);
        message(result.canceled ? "" : "Esportazione completata.");
    });
$<HTMLDialogElement>("loginDialog").showModal();
void employees();
let pendingSupplierNavigation: AnalysisContext | null = null;
function applySupplierNavigation() {
    if (!actor || !workspace || !pendingSupplierNavigation) return;
    const code = pendingSupplierNavigation.supplierCode;
    const target = snapshot.suppliers.find(
        (s) => String(s.code || "").trim() === code,
    );
    if (!target) {
        message(
            "Fornitore non presente nei dati disponibili. Aggiorna l’anagrafica e riprova.",
            true,
        );
        return;
    }
    pendingSupplierNavigation = null;
    $<HTMLDialogElement>("supplierDetail").close();
    analyzeSupplier(target.id);
}
ipc.on("analysis-open-context", (_event: any, context: AnalysisContext) => {
    pendingSupplierNavigation = context;
    applySupplierNavigation();
});
ipc.send("analysis-context-ready");

$("importInfo").onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-legacy-profile]",
    );
    if (!button) return;
    const p = snapshot.profiles.find(
        (p) => p.id === button.dataset.legacyProfile,
    );
    if (p)
        openEditor("profile", {
            ...p,
            id: p.erpCode ? "erp:" + p.erpCode : p.id,
            profileId: p.id,
            code: p.erpCode,
            legacy: true,
        });
};

document.addEventListener("contextmenu", (event) => {
    const node = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-related-supplier-id]",
    );
    if (!node) return;
    event.preventDefault();
    void ipc
        .invoke("supplier-evaluation-context", {
            id: node.dataset.relatedSupplierId,
            kind: "supplier",
            relatedSuppliers: JSON.parse(node.dataset.relatedSuppliers || "[]"),
        })
        .then((result: any) => {
            if (!result.ok)
                message(result.error || "Operazione non riuscita.", true);
        })
        .catch((e: Error) => message(e.message, true));
});
