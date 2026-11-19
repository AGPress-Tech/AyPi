import {
    calibrationSystemForm,
    systemPointRow,
    readSystemPoints,
    updateSystemDefinition,
    systemReadingsMarkup,
    readSystemReadings,
    updateSystemResults,
} from "../modules/calibration-system-editor";
import {
    calibrationRules,
    categoryCalibrationSystem,
} from "../../../backend/src/modules/measurement-instruments/calibration-system";
import Chart from "chart.js/auto";
import { color } from "chart.js/helpers";
import { installAnalysisWorkspace } from "../modules/analysis-workspace";
import { analysisSelectionHighlight } from "../modules/analysis-selection-highlight";
import { analysisHtmlLegend } from "../modules/analysis-html-legend";
import { mergeAreaSelection } from "../modules/analysis-chart-area-selection";
import { continueTableOnScroll } from "../modules/table-scroll-loader";
import { bindSortingHeaders, updateSortingBar } from "../modules/table-sorting";
import {
    sortByCriteria,
    SortCriterion,
} from "../../main/modules/analysis-sorting";
import { emptyWorkspace } from "../../main/modules/analysis-ui-model";
import {
    modes,
    usages,
    outcomes,
    states,
    schedule,
    todayInRome,
} from "../../../backend/src/modules/measurement-instruments/model";
Chart.register(analysisSelectionHighlight, analysisHtmlLegend);
const ipc = require("electron").ipcRenderer;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
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
const num = (v: any, digits = 1) =>
    v == null
        ? "—"
        : new Intl.NumberFormat("it-IT", {
              maximumFractionDigits: digits,
          }).format(v);
const date = (v: any) =>
    v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—";
type Rule = {
    field: string;
    op: string;
    value: string;
    to?: string;
};
type Filters = {
    departments: string[];
    machines: string[];
    kind: string;
    from: string;
    to: string;
    text: string;
    rules: Rule[];
};
const emptyFilters = (): Filters => ({
    departments: [],
    machines: [],
    kind: "",
    from: "",
    to: "",
    text: "",
    rules: [],
});
const viewContexts = new Map<string, any>();
let editingSystem: any = null,
    editingSystemTolerance: number | null = null,
    editingSystemUnit = "",
    useCurrentSystem = false,
    editingInstrumentId = "",
    editingInstrumentRevision = 0;
let snapshot: any = {
        systems: [],
        instruments: [],
        calibrations: [],
        schedule: [],
        attachments: [],
        issues: [],
        today: "",
    },
    actor = "",
    view = "dashboard",
    filters = emptyFilters(),
    preferences: any = {
        workspace: emptyWorkspace(),
        analysisWorkspace: emptyWorkspace(),
        filterPresets: [],
        columns: {},
    },
    groups: Record<string, string[]> = {},
    busy = false,
    sort: SortCriterion[] = [{ key: "code", direction: "asc" }],
    limit = 200,
    selection: Record<string, string[]> = {},
    charts: Chart[] = [],
    workspace: ReturnType<typeof installAnalysisWorkspace> | null = null,
    editKind = "instrument",
    editEntity: any = null,
    editAttachments: any[] = [],
    editReturn: HTMLElement | null = null,
    detailId = "",
    analysisId = "",
    pointKey = "",
    importToken = "",
    editorOriginal = "",
    notice = 30,
    analysisAudit: any[] = [];
type Col = [string, string, string];
const instrumentColumns: Col[] = [
    ["code", "Codice", "text"],
    ["description", "Descrizione", "text"],
    ["category", "Categoria", "text"],
    ["location", "Ubicazione", "text"],
    ["modeLabel", "Taratura", "text"],
    ["usageLabel", "Utilizzo", "text"],
    ["stateLabel", "Stato", "text"],
    ["lastDate", "Ultima taratura", "date"],
    ["dueDate", "Scadenza", "date"],
    ["frequencyMonths", "Frequenza (mesi)", "number"],
    ["serial", "Matricola", "text"],
    ["model", "Modello", "text"],
    ["measurementRange", "Campo strumento", "text"],
    ["useRange", "Campo in uso", "text"],
    ["resolution", "Sensibilità", "text"],
    ["tolerance", "Tolleranza storica (testo)", "text"],
    ["calibrationSystemName", "Sistema di taratura", "text"],
    ["calibrationTolerance", "Tolleranza ammessa ±", "number"],
    ["calibrationUnit", "Unità tolleranza", "text"],
    ["method", "Metodo / campioni", "text"],
    ["responsible", "Responsabile", "text"],
    ["suitabilityLabel", "Idoneità dichiarata", "text"],
    ["nstReviewLabel", "Verifica NST", "text"],
    ["nstReason", "Motivazione NST", "text"],
    ["nstDate", "Data classificazione NST", "date"],
    ["nstReviewMonths", "Revisione NST (mesi)", "number"],
    ["reviewDate", "Prossima revisione NST", "date"],
    ["notes", "Note", "text"],
    ["updatedBy", "Modificato da", "text"],
];
const calibrationColumns: Col[] = [
    ["date", "Data", "date"],
    ["code", "Strumento", "text"],
    ["description", "Descrizione", "text"],
    ["category", "Categoria", "text"],
    ["location", "Ubicazione", "text"],
    ["outcomeLabel", "Esito", "text"],
    ["provider", "Laboratorio / operatore", "text"],
    ["certificate", "Certificato", "text"],
    ["modeLabel", "Taratura", "text"],
    ["method", "Metodo", "text"],
    ["reference", "Campioni / riferimenti", "text"],
    ["cost", "Costo", "number"],
    ["currency", "Valuta", "text"],
    ["sourceLabel", "Fonte", "text"],
    ["attachmentCount", "Allegati", "number"],
    ["notes", "Note", "text"],
    ["createdBy", "Inserito da", "text"],
    ["updatedBy", "Modificato da", "text"],
];
const systemColumns: Col[] = [
    ["category", "Categoria strumenti", "text"],
    ["name", "Nome sistema", "text"],
    ["ruleLabel", "Criterio di idoneità", "text"],
    ["groupCount", "Gruppi", "number"],
    ["pointCount", "Punti", "number"],
    ["repetitions", "Rilevazioni per punto", "number"],
    ["tolerance", "Tolleranza predefinita ±", "number"],
    ["unit", "Unità", "text"],
    ["activeLabel", "Stato", "text"],
    ["description", "Procedura", "text"],
    ["revision", "Revisione", "number"],
];
const columns = () =>
    view === "systems"
        ? systemColumns
        : view === "calibrations"
          ? calibrationColumns
          : instrumentColumns;
const instrument = (id: string) =>
    snapshot.instruments.find((i) => i.id === id);
const attachments = (kind: string, id: string) =>
    snapshot.attachments.filter(
        (a) => a.ownerKind === kind && a.ownerId === id,
    );
const api = async (op: string, rest: any = {}) => {
    const r = await ipc.invoke("measurement-api", { op, ...rest });
    if (!r.ok) throw Error(r.error || "Operazione non riuscita.");
    return r;
};
const message = (value = "", error = false) => {
    $("status").textContent = value;
    $("status").classList.toggle("error", error);
};
async function work(fn: () => Promise<any>) {
    if (busy) return;
    busy = true;
    document.body.dataset.busy = "1";
    $("workspace").setAttribute("aria-busy", "true");
    const buttons = [
        ...document.querySelectorAll<HTMLButtonElement>(
            "#headerActions button,#importAccess",
        ),
    ].filter((b) => !b.disabled && b.id !== "close");
    buttons.forEach((b) => (b.disabled = true));
    try {
        await fn();
    } catch (e) {
        message((e as Error).message, true);
    } finally {
        busy = false;
        delete document.body.dataset.busy;
        $("workspace").setAttribute("aria-busy", "false");
        buttons.forEach((b) => (b.disabled = false));
    }
}
function rowMatchesRules(r: any) {
    const by = new Map<string, Rule[]>();
    for (const rule of filters.rules) {
        if (!rule.value && !rule.to && rule.op !== "empty") continue;
        by.set(rule.field, [...(by.get(rule.field) || []), rule]);
    }
    return [...by].every(([key, rules]) =>
        rules.some((rule) => {
            const raw = r[key],
                a = String(raw ?? "").toLocaleLowerCase("it"),
                b = rule.value.toLocaleLowerCase("it");
            return rule.op === "empty"
                ? raw == null || raw === ""
                : rule.op === "range"
                  ? raw != null &&
                    (typeof raw === "number"
                        ? (!b || raw >= Number(b)) &&
                          (!rule.to || raw <= Number(rule.to))
                        : (!b || a >= b) && (!rule.to || a <= rule.to))
                  : rule.op === "exact"
                    ? a === b
                    : rule.op === "prefix"
                      ? a.startsWith(b)
                      : rule.op === "gte"
                        ? raw != null &&
                          (typeof raw === "number" ? raw >= Number(b) : a >= b)
                        : rule.op === "lte"
                          ? raw != null &&
                            (typeof raw === "number"
                                ? raw <= Number(b)
                                : a <= b)
                          : rule.op === "not"
                            ? !a.includes(b)
                            : a.includes(b);
        }),
    );
}
function commonMatches(i: any) {
    return (
        (!filters.departments.length ||
            filters.departments.includes(i.location)) &&
        (!filters.machines.length ||
            filters.machines.includes(i.instrumentId || i.id)) &&
        (!filters.kind || (i.currentMode || i.mode) === filters.kind) &&
        (!filters.text ||
            [
                i.code,
                i.description,
                i.serial,
                i.model,
                i.category,
                i.location,
                i.notes,
                i.nstReason,
                i.certificate,
                i.provider,
            ].some((v) =>
                String(v || "")
                    .toLocaleLowerCase("it")
                    .includes(filters.text.toLocaleLowerCase("it")),
            )) &&
        (view !== "analysis" ||
            !analysisId ||
            i.instrumentId === analysisId ||
            i.id === analysisId)
    );
}
function enrichedRecords() {
    return snapshot.calibrations.map((r) => {
        const i = snapshot.schedule.find((i) => i.id === r.instrumentId) || {};
        return {
            ...i,
            ...r,
            currentMode: i.mode,
            code: i.code || r.instrumentId,
            description: i.description || "",
            location: i.location || "",
            category: i.category || "",
            modeLabel: modes[r.mode] || "Storico NST",
            outcomeLabel: outcomes[r.outcome],
            month: r.date.slice(0, 7),
            year: r.date.slice(0, 4),
            sourceLabel: r.baseline
                ? "Ultima data Access"
                : "Registrazione AyPi",
            attachmentCount: attachments("calibration", r.id).length,
        };
    });
}
const recordTime = (r: any) =>
    (!filters.from || r.date >= filters.from) &&
    (!filters.to || r.date <= filters.to);
function baseRecords() {
    return enrichedRecords().filter(
        (r) =>
            commonMatches(r) &&
            recordTime(r) &&
            rowMatchesRules(r) &&
            (view !== "nst" || r.currentMode === "nst"),
    );
}
function baseInstruments() {
    const recordOwners =
        view === "calibrations"
            ? new Set(baseRecords().map((r) => r.instrumentId))
            : null;
    return snapshot.schedule.filter(
        (i) =>
            commonMatches(i) &&
            (recordOwners ? recordOwners.has(i.id) : rowMatchesRules(i)) &&
            (view !== "nst" || i.mode === "nst"),
    );
}
const eventDimensions = ["month", "year", "outcome", "provider"];
function selectedRecord(r: any) {
    if (r.baseline && eventDimensions.some((key) => selection[key]?.length))
        return false;
    return Object.entries(selection).every(
        ([key, values]) =>
            !values.length ||
            values.includes(
                String(
                    key === "instrument"
                        ? r.instrumentId
                        : key === "mode"
                          ? r.currentMode || r.mode
                          : key === "dueMonth"
                            ? r.dueDate?.slice(0, 7)
                            : (r[key] ?? ""),
                ),
            ),
    );
}
function selectedInstrument(i: any) {
    return Object.entries(selection).every(([key, values]) => {
        if (!values.length) return true;
        if (eventDimensions.includes(key))
            return baseRecords().some(
                (r) => r.instrumentId === i.id && selectedRecord(r),
            );
        return values.includes(
            String(
                key === "instrument"
                    ? i.id
                    : key === "dueMonth"
                      ? i.dueDate?.slice(0, 7)
                      : (i[key] ?? ""),
            ),
        );
    });
}
const selectedInstruments = () => baseInstruments().filter(selectedInstrument);
const selectedRecords = () => baseRecords().filter(selectedRecord);
function currentRows() {
    if (view === "systems")
        return (snapshot.systems || [])
            .map((s) => ({
                ...s,
                ruleLabel: calibrationRules[s.rule],
                groupCount: new Set(s.points.map((p) => p.group)).size,
                pointCount: s.points.length,
                activeLabel: s.active ? "Attivo" : "Disattivato",
            }))
            .filter(
                (s) =>
                    (!filters.text ||
                        (s.name + " " + s.description)
                            .toLocaleLowerCase("it")
                            .includes(filters.text.toLocaleLowerCase("it"))) &&
                    rowMatchesRules(s),
            );
    return view === "calibrations" ? selectedRecords() : selectedInstruments();
}
const percent = (n: number, d: number) => (d ? num((n / d) * 100) + "%" : "—");
function kpis() {
    const rows = selectedInstruments(),
        eligible = rows.filter((i) => i.mode !== "nst" && i.usage === "in_use"),
        records = selectedRecords().filter((r) => !r.baseline),
        fit = records.filter((r) => r.outcome === "fit"),
        known = records.filter((r) => ["fit", "unfit"].includes(r.outcome));
    $("kpis").innerHTML = [
        ["Strumenti", num(rows.length)],
        ["In uso", num(rows.filter((i) => i.usage === "in_use").length)],
        [
            "Tarature scadute",
            num(rows.filter((i) => i.state === "overdue").length),
        ],
        [
            "In scadenza",
            num(
                rows.filter((i) => ["today", "upcoming"].includes(i.state))
                    .length,
            ),
        ],
        ["NST", num(rows.filter((i) => i.mode === "nst").length)],
        [
            "Regolari",
            percent(
                eligible.filter((i) =>
                    ["valid", "upcoming", "today"].includes(i.state),
                ).length,
                eligible.length,
            ),
        ],
        ["Tarature idonee", percent(fit.length, known.length)],
    ]
        .map(
            ([title, value]) =>
                `<div class="maintenance-kpi"><span>${title}</span><strong>${value}</strong></div>`,
        )
        .join("");
}
function selectOptions(values: any, value = "", blank = "Tutti") {
    return (
        `<option value="">${esc(blank)}</option>` +
        Object.entries(values)
            .map(
                ([key, label]) =>
                    `<option value="${esc(key)}" ${key === value ? "selected" : ""}>${esc(label)}</option>`,
            )
            .join("")
    );
}
function filterControls() {
    $("locationsPicker").innerHTML = [
        ...new Set<string>(snapshot.instruments.map((i) => i.location)),
    ]
        .sort()
        .map(
            (v) =>
                `<label><input type="checkbox" data-location="${esc(v)}" ${filters.departments.includes(v) ? "checked" : ""}>${esc(v)}</label>`,
        )
        .join("");
    $("instrumentsPicker").innerHTML =
        '<input type="search" id="instrumentSearch" aria-label="Cerca strumento" placeholder="Cerca strumento">' +
        snapshot.instruments
            .filter(
                (i) =>
                    !filters.departments.length ||
                    filters.departments.includes(i.location),
            )
            .sort((a, b) =>
                a.code.localeCompare(b.code, "it", { numeric: true }),
            )
            .map(
                (i) =>
                    `<label><input type="checkbox" data-instrument="${esc(i.id)}" ${filters.machines.includes(i.id) ? "checked" : ""}>${esc(i.code)} · ${esc(i.description)}</label>`,
            )
            .join("");
    $("locationSummary").textContent = filters.departments.length
        ? num(filters.departments.length)
        : "Tutte";
    $("instrumentSummary").textContent = filters.machines.length
        ? num(filters.machines.length)
        : "Tutti";
    $<HTMLSelectElement>("modeFilter").value = filters.kind;
    $<HTMLInputElement>("textFilter").value = filters.text;
    const fields: Col[] =
        view === "systems"
            ? [
                  ["name", "Nome sistema", "text"],
                  ["ruleLabel", "Criterio", "text"],
                  ["activeLabel", "Stato", "text"],
              ]
            : view === "calibrations"
              ? [
                    ["provider", "Laboratorio / operatore", "text"],
                    ["certificate", "Certificato", "text"],
                    ["outcomeLabel", "Esito", "text"],
                    ["sourceLabel", "Fonte", "text"],
                ]
              : [
                    ["category", "Categoria", "text"],
                    ["usageLabel", "Utilizzo", "text"],
                    ["stateLabel", "Stato", "text"],
                    ["responsible", "Responsabile", "text"],
                    ["serial", "Matricola", "text"],
                    ["dueDate", "Scadenza", "date"],
                    ...(view === "nst"
                        ? ([
                              ["nstReviewLabel", "Verifica NST", "text"],
                              ["nstReason", "Motivazione NST", "text"],
                              ["reviewDate", "Revisione NST", "date"],
                          ] as Col[])
                        : []),
                ];
    $("standardFilters").innerHTML =
        `<label class="maintenance-filter-field">Tarature dal<input id="dateFrom" type="date" value="${filters.from}"></label><label class="maintenance-filter-field">Tarature al<input id="dateTo" type="date" value="${filters.to}"></label>` +
        fields
            .map(([field, label, type]) => {
                const rule = filters.rules.find((r) => r.field === field) || {
                    value: "",
                    to: "",
                };
                return `<label class="maintenance-filter-field" data-standard="${field}" data-type="${type}"><span>${label}</span><input type="${type}" data-standard-value value="${esc(rule.value)}" placeholder="Contiene…">${type === "date" ? `<input type="date" data-standard-to value="${esc(rule.to)}" aria-label="${label} al">` : ""}</label>`;
            })
            .join("");
    const standard = new Set(fields.map((c) => c[0]));
    $("advancedRules").innerHTML = filters.rules
        .filter((r) => !standard.has(r.field))
        .map(ruleHtml)
        .join("");
    $("filterPreset").innerHTML =
        '<option value="">Preset filtri</option>' +
        preferences.filterPresets
            .map((p, i) => `<option value="${i}">${esc(p.name)}</option>`)
            .join("");
}
function ruleHtml(r: Rule, index: number) {
    return `<div class="maintenance-rule" data-rule="${index}"><select data-field aria-label="Campo">${columns()
        .map(
            ([key, label]) =>
                `<option value="${key}" ${r.field === key ? "selected" : ""}>${esc(label)}</option>`,
        )
        .join(
            "",
        )}</select><select data-op aria-label="Confronto">${Object.entries({
        contains: "Contiene",
        exact: "Uguale a",
        prefix: "Inizia con",
        range: "Da / a",
        gte: "Maggiore o uguale",
        lte: "Minore o uguale",
        not: "Non contiene",
        empty: "Mancante",
    })
        .map(
            ([key, label]) =>
                `<option value="${key}" ${r.op === key ? "selected" : ""}>${label}</option>`,
        )
        .join(
            "",
        )}</select><input data-value aria-label="Valore" value="${esc(r.value)}"><input data-to aria-label="Valore finale" value="${esc(r.to)}"><button data-remove-rule aria-label="Rimuovi condizione">×</button></div>`;
}
function readFilters() {
    filters.from = $<HTMLInputElement>("dateFrom").value;
    filters.to = $<HTMLInputElement>("dateTo").value;
    if (filters.from && filters.to && filters.from > filters.to)
        throw Error("Intervallo date invertito.");
    filters.rules = [
        ...$("standardFilters").querySelectorAll<HTMLElement>(
            "[data-standard]",
        ),
    ]
        .map((el) => ({
            field: el.dataset.standard!,
            op: el.dataset.type === "date" ? "range" : "contains",
            value: el.querySelector<HTMLInputElement>("[data-standard-value]")!
                .value,
            to:
                el.querySelector<HTMLInputElement>("[data-standard-to]")
                    ?.value || "",
        }))
        .concat(
            [
                ...$("advancedRules").querySelectorAll<HTMLElement>(
                    "[data-rule]",
                ),
            ].map((el) => ({
                field: el.querySelector<HTMLSelectElement>("[data-field]")!
                    .value,
                op: el.querySelector<HTMLSelectElement>("[data-op]")!.value,
                value: el.querySelector<HTMLInputElement>("[data-value]")!
                    .value,
                to: el.querySelector<HTMLInputElement>("[data-to]")!.value,
            })),
        )
        .filter((r) => r.value || r.to || r.op === "empty");
    for (const r of filters.rules)
        if (
            r.op === "range" &&
            r.value &&
            r.to &&
            (columns().find((c) => c[0] === r.field)?.[2] === "number"
                ? Number(r.value) > Number(r.to)
                : r.value > r.to)
        )
            throw Error("Intervallo filtro invertito.");
}
async function savePreferences() {
    await api("preferences-save", { value: preferences });
}
function valueHtml(r: any, key: string, type: string) {
    if (key === "stateLabel")
        return `<span class="measurement-badge" data-state="${esc(r.state)}">${esc(r[key])}</span>`;
    return esc(
        type === "date"
            ? date(r[key])
            : type === "number"
              ? num(r[key])
              : r[key] || "—",
    );
}
function renderTable() {
    const rows = sortByCriteria(currentRows(), sort, (r, k) => r[k]),
        available = columns(),
        keys =
            preferences.columns[view] ||
            (view === "nst"
                ? [
                      "code",
                      "description",
                      "location",
                      "usageLabel",
                      "nstReviewLabel",
                      "nstReason",
                      "nstDate",
                      "reviewDate",
                  ]
                : available.slice(0, 9).map((c) => c[0])),
        cols = available.filter((c) => keys.includes(c[0])),
        table = $<HTMLTableElement>("measurementTable"),
        kind =
            view === "systems"
                ? "system"
                : view === "calibrations"
                  ? "calibration"
                  : "instrument";
    $("tableTitle").textContent =
        {
            instruments: "Anagrafica strumenti",
            calibrations: "Registro tarature e riferimenti storici",
            nst: "Strumenti NST e revisioni",
            systems: "Sistemi di taratura",
        }[view] || "";
    $("newEntity").textContent =
        view === "systems"
            ? "+ Sistema di taratura"
            : view === "calibrations"
              ? "+ Taratura"
              : view === "nst"
                ? "+ Strumento NST"
                : "+ Strumento";
    $("columnPicker").innerHTML = available
        .map(
            ([key, label]) =>
                `<label><input type="checkbox" data-column="${key}" ${keys.includes(key) ? "checked" : ""}>${esc(label)}</label>`,
        )
        .join("");
    table.tHead!.innerHTML =
        "<tr>" +
        cols
            .map(
                ([, label, type]) =>
                    `<th class="${type === "number" ? "numeric" : ""}">${esc(label)}</th>`,
            )
            .join("") +
        "</tr>";
    const markup = (data: any[]) =>
        data
            .map(
                (r) =>
                    `<tr data-id="${esc(r.id)}" data-kind="${kind}" tabindex="0">${cols.map(([key, , type], index) => `<td class="${type === "number" ? "numeric" : ""}">${index === 0 ? `<button class="measurement-link" data-open="${esc(r.id)}" data-kind="${kind}">${valueHtml(r, key, type)}</button>` : valueHtml(r, key, type)}</td>`).join("")}</tr>`,
            )
            .join("");
    table.tBodies[0].innerHTML =
        markup(rows.slice(0, limit)) ||
        `<tr><td colspan="${cols.length}">Nessun risultato.</td></tr>`;
    const labels = cols.map(([key, label]) => ({ key, label })),
        resort = (next: SortCriterion[]) => {
            sort = next;
            renderTable();
        };
    bindSortingHeaders(table, labels, sort, resort);
    updateSortingBar(table, labels, sort, resort);
    $("tableCount").textContent =
        `${num(Math.min(limit, rows.length))} di ${num(rows.length)} righe`;
    continueTableOnScroll({
        table,
        total: rows.length,
        initial: Math.min(limit, rows.length),
        append: (from, to) =>
            table.tBodies[0].insertAdjacentHTML(
                "beforeend",
                markup(rows.slice(from, to)),
            ),
        progress: (count, total) => {
            limit = count;
            $("tableCount").textContent =
                `${num(count)} di ${num(total)} righe`;
        },
    });
}
function dueRows() {
    return selectedInstruments().filter(
        (i) =>
            [
                "overdue",
                "today",
                "upcoming",
                "missing",
                "requalification",
                "frequency",
                "unfit",
            ].includes(i.state) ||
            (i.mode === "nst" &&
                i.usage === "in_use" &&
                i.nstReviewMonths &&
                (!i.reviewDate ||
                    (i.reviewDays != null && i.reviewDays <= notice))),
    );
}
function renderDue() {
    const rows = dueRows(),
        locations = [...new Set<string>(rows.map((i) => i.location))].sort();
    $("dueGroups").innerHTML =
        locations
            .map(
                (location) =>
                    `<details><summary>${esc(location)} · ${num(rows.filter((i) => i.location === location).length)} da gestire</summary><div class="table-scroll"><table><thead><tr><th>Strumento</th><th>Descrizione</th><th>Stato</th><th>Ultima taratura</th><th>Scadenza / revisione</th><th>Giorni</th><th>Azioni</th></tr></thead><tbody>${rows
                        .filter((i) => i.location === location)
                        .sort(
                            (a, b) =>
                                (a.daysRemaining ?? -9999) -
                                (b.daysRemaining ?? -9999),
                        )
                        .map(
                            (i) =>
                                `<tr><td><button class="measurement-link" data-detail="${esc(i.id)}">${esc(i.code)}</button></td><td>${esc(i.description)}</td><td>${i.mode === "nst" ? esc(i.nstReviewLabel) : esc(i.stateLabel)}</td><td>${date(i.lastDate)}</td><td>${date(i.mode === "nst" ? i.reviewDate : i.dueDate)}</td><td class="numeric">${num(i.mode === "nst" ? i.reviewDays : i.daysRemaining)}</td><td><button ${i.mode === "nst" ? `data-nst="${esc(i.id)}"` : `data-calibrate="${esc(i.id)}"`}>${i.mode === "nst" ? "Rivedi NST" : "Registra taratura"}</button></td></tr>`,
                        )
                        .join("")}</tbody></table></div></details>`,
            )
            .join("") ||
        "<p>Nessuna taratura o revisione da gestire con i filtri correnti.</p>";
}
const sources = [
    {
        id: "measurement-states",
        title: "Stato attuale del parco strumenti",
        dimension: "state",
        inventory: true,
        type: "doughnut",
    },
    {
        id: "measurement-categories",
        title: "Strumenti per categoria",
        dimension: "category",
        inventory: true,
        type: "bar",
    },
    {
        id: "measurement-locations",
        title: "Strumenti per ubicazione",
        dimension: "location",
        inventory: true,
        type: "bar",
    },
    {
        id: "measurement-modes",
        title: "Regimi di taratura e NST",
        dimension: "mode",
        inventory: true,
        type: "doughnut",
    },
    {
        id: "measurement-expiry",
        title: "Calendario delle scadenze di taratura",
        dimension: "dueMonth",
        inventory: true,
        type: "bar",
    },
    {
        id: "measurement-months",
        title: "Tarature nel tempo per esito",
        dimension: "month",
        inventory: false,
        type: "line",
    },
    {
        id: "measurement-outcomes",
        title: "Esiti delle tarature registrate",
        dimension: "outcome",
        inventory: false,
        type: "doughnut",
    },
    {
        id: "measurement-rate",
        title: "Percentuale di tarature idonee nel tempo",
        dimension: "month",
        inventory: false,
        type: "line",
    },
    {
        id: "measurement-annual",
        title: "Confronto annuale delle tarature",
        dimension: "year",
        inventory: false,
        type: "bar",
    },
    {
        id: "measurement-nst-locations",
        title: "NST per ubicazione",
        dimension: "location",
        inventory: true,
        type: "bar",
    },
    {
        id: "measurement-providers",
        title: "Attività per laboratorio / operatore",
        dimension: "provider",
        inventory: false,
        type: "bar",
    },
    {
        id: "measurement-drift",
        title: "Trend dello scostamento per punto",
        dimension: "drift",
        inventory: false,
        type: "line",
    },
];
const dashboardSourceIds = [
    "measurement-states",
    "measurement-categories",
    "measurement-locations",
    "measurement-modes",
    "measurement-nst-locations",
];
const activeSources = () =>
    sources.filter((source) =>
        view === "analysis"
            ? [
                  "measurement-months",
                  "measurement-outcomes",
                  "measurement-providers",
                  "measurement-rate",
                  "measurement-annual",
                  "measurement-drift",
              ].includes(source.id)
            : dashboardSourceIds.includes(source.id),
    );
function dashboardWorkspace(value: any) {
    const copy = JSON.parse(JSON.stringify(value || emptyWorkspace()));
    const cleanLayout = (layout: any) => {
        layout.charts = layout.charts.filter((chart) =>
            dashboardSourceIds.includes(chart.source),
        );
        const allowed = new Set([
            ...dashboardSourceIds,
            ...layout.charts.map((chart) => chart.id),
        ]);
        layout.hidden = layout.hidden.filter((id) => allowed.has(id));
        return layout;
    };
    copy.layout = cleanLayout(copy.layout);
    copy.presets = copy.presets.map((preset) => ({
        ...preset,
        layout: cleanLayout(preset.layout),
    }));
    return copy;
}
function renderNextCalibrations() {
    const old = document.getElementById("nextCalibrationsPanel");
    if (view !== "dashboard") {
        old?.remove();
        return;
    }
    const rows = selectedInstruments()
        .filter(
            (i) =>
                i.mode !== "nst" &&
                i.usage === "in_use" &&
                i.dueDate >= snapshot.today &&
                ["valid", "upcoming", "today"].includes(i.state),
        )
        .sort(
            (a, b) =>
                a.dueDate.localeCompare(b.dueDate) ||
                a.code.localeCompare(b.code, "it", { numeric: true }),
        )
        .slice(0, 10);
    const panel = old || document.createElement("article");
    panel.id = "nextCalibrationsPanel";
    panel.className = "panel measurement-next-calibrations";
    panel.innerHTML = `<div class="panel-head"><h2>Prossime 10 tarature</h2></div><div class="table-scroll" tabindex="0" aria-label="Prossime dieci tarature"><table><thead><tr><th>Strumento</th><th>Data prevista</th></tr></thead><tbody>${rows.map((i) => `<tr data-instrument-id="${esc(i.id)}" data-due-date="${esc(i.dueDate)}"><td><button class="measurement-link" data-detail="${esc(i.id)}">${esc(i.code)} · ${esc(i.description)}</button></td><td>${date(i.dueDate)}</td></tr>`).join("") || '<tr><td colspan="2">Nessuna taratura futura con i filtri correnti.</td></tr>'}</tbody></table></div>`;
    const host = $("dashboard"),
        custom = host.querySelector(":scope > .workspace-custom-grid");
    host.insertBefore(panel, custom);
}
function chartSelect(dimension: string, keys: string[], multiple: boolean) {
    selection[dimension] = mergeAreaSelection(
        selection[dimension] || [],
        keys,
        multiple,
    );
    render();
}
function monthSequence(start: string, end: string) {
    const result: string[] = [];
    let cursor = start;
    while (cursor && cursor <= end && result.length < 1200) {
        result.push(cursor);
        const [y, m] = cursor.split("-").map(Number);
        cursor = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    }
    return result;
}
function chartConfig(id: string, type: any, cap = 240): any {
    const source = sources.find((s) => s.id === id) || sources[0],
        dimension = source.dimension;
    if (dimension === "drift") return driftConfig(type);
    let base: any[] = source.inventory
        ? baseInstruments()
        : baseRecords().filter((r) => !r.baseline);
    const key = (r: any) =>
        String(
            dimension === "dueMonth"
                ? r.dueDate?.slice(0, 7) || ""
                : r[dimension] || "__missing__",
        );
    if (id === "measurement-nst-locations")
        base = base.filter((i) => i.mode === "nst");
    if (dimension === "dueMonth")
        base = base.filter(
            (i) => i.mode !== "nst" && i.usage === "in_use" && i.dueDate,
        );
    let keys = [...new Set<string>(base.map(key))].filter(Boolean);
    if (["month", "dueMonth"].includes(dimension)) {
        keys.sort();
        if (keys.length)
            keys = monthSequence(
                filters.from && dimension === "month"
                    ? filters.from.slice(0, 7)
                    : keys[0],
                filters.to && dimension === "month"
                    ? filters.to.slice(0, 7)
                    : keys[keys.length - 1],
            ).slice(-cap);
    } else if (dimension === "year") keys.sort();
    else
        keys.sort(
            (a, b) =>
                base.filter((r) => key(r) === b).length -
                    base.filter((r) => key(r) === a).length ||
                a.localeCompare(b, "it"),
        );
    keys = keys.slice(0, cap);
    const label = (v: string) =>
        v === "__missing__"
            ? "Non indicato"
            : dimension === "state"
              ? states[v]
              : dimension === "mode"
                ? modes[v]
                : dimension === "outcome"
                  ? outcomes[v]
                  : ["month", "dueMonth"].includes(dimension)
                    ? v.split("-").reverse().join("/")
                    : v;
    const active = Object.values(selection).some((v) => v.length),
        ink =
            getComputedStyle(document.body)
                .getPropertyValue("--ops-accent")
                .trim() || "#168eea",
        pick = source.inventory ? selectedInstrument : selectedRecord;
    const count = (k: string, selected = false, outcome?: string) =>
        base.filter(
            (r) =>
                key(r) === k &&
                (!selected || pick(r)) &&
                (!outcome || r.outcome === outcome),
        ).length;
    const outcomeColors = {
        fit: "#21988b",
        unfit: "#c46170",
        review: "#d3a145",
        unknown: "#718397",
    };
    const stateColors = {
        valid: "#21988b",
        upcoming: "#d3a145",
        today: "#d3a145",
        overdue: "#c46170",
        unfit: "#c46170",
        nst: "#718397",
        inactive: "#9aa7b4",
        missing: "#8c78b5",
        frequency: "#ca9d49",
        requalification: "#c46170",
    };
    const chartPalette = [ink, "#438f89", "#7e8da4", "#ca9d49", "#8c78b5"];
    const itemColors: string[] = keys.map((key, index) =>
        dimension === "state"
            ? stateColors[key] || "#718397"
            : dimension === "outcome"
              ? outcomeColors[key] || "#718397"
              : chartPalette[index % chartPalette.length],
    );
    const datasets =
        ["month", "year"].includes(dimension) && type !== "doughnut"
            ? Object.entries(outcomes).map(([outcome, title]) => {
                  const seriesColor: string = outcomeColors[outcome];
                  return {
                      label: title,
                      data: keys.map((k) => count(k, false, outcome)),
                      backgroundColor: active
                          ? color(seriesColor).alpha(0.22).rgbString()
                          : seriesColor,
                      borderColor: seriesColor,
                      borderWidth: type === "line" ? 2 : 1,
                      highlightColor: seriesColor,
                      highlightValues: active
                          ? keys.map((k) => count(k, true, outcome))
                          : undefined,
                      tension: 0.12,
                      pointRadius: 3,
                      maxBarThickness: 28,
                  };
              })
            : [
                  {
                      label: source.inventory ? "Strumenti" : "Tarature",
                      data: keys.map((k) => count(k)),
                      backgroundColor: active
                          ? itemColors.map((c) =>
                                color(c).alpha(0.22).rgbString(),
                            )
                          : itemColors,
                      borderColor: type === "line" ? ink : itemColors,
                      borderWidth: type === "line" ? 2 : 1,
                      highlightValues: active
                          ? keys.map((k) => count(k, true))
                          : undefined,
                      highlightColors: itemColors,
                      highlightColor: ink,
                      tension: 0.12,
                      pointRadius: 3,
                      maxBarThickness: 28,
                  },
              ];
    const area = (indices: number[], multiple: boolean) =>
        chartSelect(
            dimension,
            indices.map((index) => keys[index]).filter(Boolean),
            multiple,
        );
    if (id === "measurement-rate") {
        const rate = (k: string, onlySelected = false) => {
            const sample = base.filter(
                (r) =>
                    key(r) === k &&
                    (!onlySelected || pick(r)) &&
                    ["fit", "unfit"].includes(r.outcome),
            );
            return sample.length
                ? (sample.filter((r) => r.outcome === "fit").length /
                      sample.length) *
                      100
                : null;
        };
        return {
            type: type === "doughnut" ? "line" : type,
            data: {
                labels: keys.map(label),
                datasets: [
                    {
                        label: "Contesto (%)",
                        data: keys.map((k) => rate(k)),
                        borderColor: ink,
                        backgroundColor: ink,
                        spanGaps: false,
                    },
                    ...(active
                        ? [
                              {
                                  label: "Selezione (%)",
                                  data: keys.map((k) => rate(k, true)),
                                  borderColor: "#218e82",
                                  backgroundColor: "#218e82",
                                  spanGaps: false,
                              },
                          ]
                        : []),
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                devicePixelRatio: Math.max(2, devicePixelRatio),
                plugins: { legend: { display: true } },
                scales: {
                    y: {
                        min: 0,
                        max: 100,
                        ticks: { callback: (v: any) => v + "%" },
                    },
                },
                onClick: (event: any, elements: any[]) => {
                    if (elements.length)
                        area(
                            [elements[0].index],
                            !!(event.native?.ctrlKey || event.native?.metaKey),
                        );
                },
                onAreaSelect: area,
            },
        };
    }
    const horizontal =
        type === "bar" &&
        ["category", "location", "provider"].includes(dimension);
    return {
        type,
        data: {
            labels: keys.map((k) => {
                const title = label(k);
                return horizontal && title.length > 38
                    ? title.slice(0, 37) + "\u2026"
                    : title;
            }),
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            devicePixelRatio: Math.max(2, devicePixelRatio),
            indexAxis: horizontal ? "y" : "x",
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (items: any[]) =>
                            label(keys[items[0]?.dataIndex] || ""),
                    },
                },
                legend: {
                    display:
                        type === "doughnut" ||
                        ["month", "year"].includes(dimension),
                    labels: { color: "#253a4a", font: { size: 13 } },
                },
            },
            ...(type !== "doughnut"
                ? {
                      scales: {
                          x: {
                              ticks: {
                                  font: { size: 10 },
                                  ...(horizontal ? { precision: 0 } : {}),
                              },
                              ...(horizontal ? { beginAtZero: true } : {}),
                          },
                          y: {
                              ticks: {
                                  font: { size: 10 },
                                  ...(!horizontal ? { precision: 0 } : {}),
                              },
                              ...(!horizontal ? { beginAtZero: true } : {}),
                          },
                      },
                  }
                : {}),
            onClick: (event: any, elements: any[]) => {
                if (elements.length)
                    area(
                        [elements[0].index],
                        !!(event.native?.ctrlKey || event.native?.metaKey),
                    );
            },
            onAreaSelect: area,
        },
    };
}
function driftConfig(type: any) {
    const [point, unit, nominal] = pointKey.split("\u001f"),
        rows = baseRecords()
            .filter(
                (r) =>
                    !r.baseline &&
                    r.measurements?.some(
                        (m) =>
                            m.label === point &&
                            m.unit === unit &&
                            String(m.nominal ?? "") === nominal &&
                            m.deviation != null,
                    ),
            )
            .sort(
                (a, b) =>
                    a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
            )
            .slice(-240),
        measures = rows.map((r) =>
            r.measurements.find(
                (m) =>
                    m.label === point &&
                    m.unit === unit &&
                    String(m.nominal ?? "") === nominal,
            ),
        );
    return {
        type: type === "doughnut" ? "line" : type,
        data: {
            labels: rows.map((r) => date(r.date)),
            datasets: [
                {
                    label: `Scostamento (${unit || "unità non indicata"})`,
                    data: measures.map((m) => m.deviation),
                    borderColor: "#168eea",
                    backgroundColor: "#168eea",
                    tension: 0.1,
                },
                {
                    label: "Tolleranza superiore",
                    data: measures.map((m) => m.tolerance),
                    borderColor: "#b74b3c",
                    backgroundColor: "#b74b3c",
                    borderDash: [5, 5],
                    pointRadius: 0,
                },
                {
                    label: "Tolleranza inferiore",
                    data: measures.map((m) =>
                        m.tolerance == null ? null : -m.tolerance,
                    ),
                    borderColor: "#b74b3c",
                    backgroundColor: "#b74b3c",
                    borderDash: [5, 5],
                    pointRadius: 0,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            devicePixelRatio: Math.max(2, devicePixelRatio),
            plugins: { legend: { display: true } },
            onClick: (_event: any, elements: any[]) => {
                if (elements.length)
                    openEditor("calibration", rows[elements[0].index]);
            },
        },
    };
}
const legendStates = new Map<string, any>();
function destroyCharts() {
    for (const chart of charts) {
        legendStates.set(chart.canvas.id, {
            datasets: Object.fromEntries(
                chart.data.datasets.map((dataset, i) => [
                    dataset.label,
                    chart.isDatasetVisible(i),
                ]),
            ),
            data: Object.fromEntries(
                (chart.data.labels || []).map((label, i) => [
                    String(label),
                    chart.getDataVisibility(i),
                ]),
            ),
        });
        chart.destroy();
    }
    charts = [];
}
function renderCharts() {
    destroyCharts();
    const shown = activeSources();
    const host = $("dashboard");
    for (const source of sources) {
        let panel = document
            .getElementById(source.id)
            ?.closest<HTMLElement>(".panel");
        if (!shown.includes(source)) {
            panel?.remove();
            continue;
        }
        if (!panel) {
            panel = document.createElement("article");
            panel.className = "panel chart-panel";
            panel.innerHTML = `<div class="panel-head"><h2>${source.title}</h2></div><div class="chart-viewport"><canvas id="${source.id}"></canvas></div>`;
            host.append(panel);
        }
        panel.hidden = false;
        const chart = new Chart(
            $<HTMLCanvasElement>(source.id),
            chartConfig(source.id, source.type),
        );
        const old = legendStates.get(source.id);
        if (old) {
            chart.data.datasets.forEach((dataset, i) => {
                if (old.datasets[dataset.label] != null)
                    chart.setDatasetVisibility(i, old.datasets[dataset.label]);
            });
            (chart.data.labels || []).forEach((label, i) => {
                if (old.data[String(label)] === false)
                    chart.toggleDataVisibility(i);
            });
            chart.update("none");
        }
        charts.push(chart);
    }
    renderNextCalibrations();
    workspace?.sync();
}
function initWorkspace() {
    workspace = installAnalysisWorkspace({
        key: "measurement-instruments",
        actions: $("headerActions"),
        container: () => $("dashboard"),
        scope: () => $("dashboard"),
        sources: () => activeSources().map(({ id, title }) => ({ id, title })),
        reset: () => {
            selection = {};
            render();
        },
        revision: () =>
            JSON.stringify({
                filters,
                selection,
                view,
                analysisId,
                pointKey,
                updated: snapshot.instruments.map((i) => i.revision),
                records: snapshot.calibrations.map((r) => r.revision),
            }),
        build: (spec) =>
            activeSources().some((source) => source.id === spec.source)
                ? chartConfig(spec.source, spec.kind, spec.limit)
                : null,
        persistence: {
            load: async () => ({
                ok: true,
                preferences:
                    preferences[
                        view === "analysis" ? "analysisWorkspace" : "workspace"
                    ] || emptyWorkspace(),
            }),
            save: async (value) => {
                preferences[
                    view === "analysis" ? "analysisWorkspace" : "workspace"
                ] = value;
                await savePreferences();
                return { ok: true, preferences: value };
            },
        },
    });
}
function render() {
    snapshot.schedule = schedule(
        snapshot.instruments,
        snapshot.calibrations,
        snapshot.today,
        notice,
    ).map((i) => ({
        ...i,
        calibrationSystemName:
            (snapshot.systems || []).find((s) => s.id === i.calibrationSystemId)
                ?.name || "Nessuno",
    }));
    const graph = ["dashboard", "analysis"].includes(view),
        table = ["instruments", "calibrations", "nst", "systems"].includes(
            view,
        );
    $("dashboard").hidden = !graph;
    $("tablePanel").hidden = !table;
    $("duePanel").hidden = view !== "due";
    $("analysisHead").hidden = view !== "analysis";
    $("infoPanel").hidden = view !== "info";
    $("filters").hidden = view === "info";
    $("kpis").hidden = ["info", "systems"].includes(view);
    $("locationsPicker").closest<HTMLElement>("details")!.hidden =
        view === "systems";
    $("instrumentsPicker").closest<HTMLElement>("details")!.hidden =
        view === "systems";
    $("modeFilter").hidden = view === "systems";
    for (const id of ["dateFrom", "dateTo"])
        $(id)
            ?.closest<HTMLElement>("label")
            ?.toggleAttribute("hidden", view === "systems");
    document
        .querySelectorAll<HTMLElement>("[data-view]")
        .forEach((button) =>
            button.classList.toggle("active", button.dataset.view === view),
        );
    $("dueBadge").textContent = String(
        snapshot.schedule.filter(
            (i) =>
                [
                    "overdue",
                    "today",
                    "unfit",
                    "missing",
                    "requalification",
                    "frequency",
                ].includes(i.state) ||
                i.reviewOverdue ||
                (i.mode === "nst" &&
                    i.usage === "in_use" &&
                    i.nstReviewMonths &&
                    !i.reviewDate),
        ).length || "",
    );
    $("selectionSummary").textContent = Object.values(selection).some(
        (v) => v.length,
    )
        ? "· Selezione grafici attiva"
        : "";
    $<HTMLButtonElement>("newRecord").disabled = !snapshot.instruments.some(
        (i) => i.mode !== "nst" && i.usage !== "retired",
    );
    if (!["info", "systems"].includes(view)) kpis();
    if (table) renderTable();
    if (view === "due") renderDue();
    if (graph) renderCharts();
    if (view === "info") {
        const info = snapshot.importInfo;
        $("importInfo").textContent = info
            ? `Fonte: ${info.source}. Ultima lettura: ${date(info.readAt)}. Strumenti: ${num(snapshot.instruments.length)}.`
            : "Archivio pronto. Importare Access oppure inserire gli strumenti.";
        $("issues").innerHTML =
            "<h3>Verifiche dell’importazione</h3>" +
            ((snapshot.issues || [])
                .map((i) => `<p>${esc(i.code)}: ${esc(i.reason)}</p>`)
                .join("") || "<p>Nessuna anomalia segnalata.</p>");
    }
}
function analysisControls() {
    const select = $<HTMLSelectElement>("analysisInstrument");
    select.innerHTML = snapshot.instruments
        .map(
            (i) =>
                `<option value="${esc(i.id)}">${esc(i.code)} · ${esc(i.description)}</option>`,
        )
        .join("");
    if (!instrument(analysisId)) analysisId = snapshot.instruments[0]?.id || "";
    select.value = analysisId;
    const points = [
        ...new Set<string>(
            snapshot.calibrations
                .filter((r) => r.instrumentId === analysisId)
                .flatMap((r) =>
                    (r.measurements || []).map(
                        (m) =>
                            m.label +
                            "\u001f" +
                            m.unit +
                            "\u001f" +
                            String(m.nominal ?? ""),
                    ),
                ),
        ),
    ];
    if (!points.includes(pointKey)) pointKey = points[0] || "";
    $("analysisPoint").innerHTML =
        points
            .map(
                (key) =>
                    `<option value="${esc(key)}" ${key === pointKey ? "selected" : ""}>${esc(key.split("\u001f").join(" / "))}</option>`,
            )
            .join("") || '<option value="">Nessuna misura registrata</option>';
    $<HTMLButtonElement>("analysisNew").disabled =
        !instrument(analysisId) ||
        instrument(analysisId).mode === "nst" ||
        instrument(analysisId).usage === "retired";
}
function changeView(next: string) {
    if (workspace?.isSaving()) {
        message("Attendere il salvataggio dei grafici.");
        return;
    }
    const previous = view;
    viewContexts.set(view, {
        filters: JSON.parse(JSON.stringify(filters)),
        selection: JSON.parse(JSON.stringify(selection)),
        sort,
        limit,
    });
    view = next;
    const context = viewContexts.get(next);
    filters = context
        ? JSON.parse(JSON.stringify(context.filters))
        : {
              ...emptyFilters(),
              departments: [...filters.departments],
              machines: [...filters.machines],
              kind: filters.kind,
          };
    selection = context ? JSON.parse(JSON.stringify(context.selection)) : {};
    sort = context?.sort || [
        {
            key:
                view === "systems"
                    ? "name"
                    : view === "calibrations"
                      ? "date"
                      : "code",
            direction: view === "calibrations" ? "desc" : "asc",
        },
    ];
    limit = context?.limit || 200;
    filterControls();
    analysisControls();
    render();
    if (["dashboard", "analysis"].includes(next) && previous !== next)
        workspace?.replacePreferences(
            preferences[
                next === "analysis" ? "analysisWorkspace" : "workspace"
            ] || emptyWorkspace(),
        );
}
async function load() {
    const r = await api("snapshot");
    snapshot = r;
    analysisControls();
    filterControls();
    render();
}
const input = (
    name: string,
    label: string,
    value: any = "",
    type = "text",
    required = false,
    wide = false,
) =>
    `<label class="${wide ? "measurement-wide" : ""}">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${type === "number" ? 'step="any"' : ""}></label>`;
const textarea = (name: string, label: string, value: any = "") =>
    `<label class="measurement-wide">${label}<textarea name="${name}">${esc(value)}</textarea></label>`;
const selectField = (name: string, label: string, options: any, value: any) =>
    `<label>${label}<select name="${name}">${Object.entries(options)
        .map(
            ([key, title]) =>
                `<option value="${esc(key)}" ${key === value ? "selected" : ""}>${esc(title)}</option>`,
        )
        .join("")}</select></label>`;
function instrumentForm(v: any) {
    const deadline =
        v.mode === "nst"
            ? ""
            : snapshot.schedule.find((i) => i.id === v.id)?.dueDate ||
              v.initialDueDate ||
              "";
    return (
        input("code", "Codice interno", v.code, "text", true) +
        input("description", "Descrizione", v.description, "text", true) +
        input("serial", "Matricola", v.serial) +
        input("category", "Categoria", v.category, "text", true) +
        input("location", "Ubicazione", v.location, "text", true) +
        input("model", "Modello / marca", v.model) +
        input(
            "measurementRange",
            "Campo di misura strumento",
            v.measurementRange,
        ) +
        input("useRange", "Campo di misura in uso", v.useRange) +
        input("resolution", "Sensibilità / risoluzione", v.resolution) +
        input("tolerance", "Tolleranza: note / testo storico", v.tolerance) +
        input("responsible", "Responsabile", v.responsible) +
        selectField(
            "suitability",
            "Idoneità dichiarata",
            outcomes,
            v.suitability || "unknown",
        ) +
        selectField("mode", "Regime di taratura", modes, v.mode || "internal") +
        selectField("usage", "Stato utilizzo", usages, v.usage || "in_use") +
        input(
            "frequencyMonths",
            "Frequenza taratura (mesi)",
            v.frequencyMonths,
            "number",
        ) +
        input("initialDueDate", "Scadenza taratura", deadline, "date") +
        `<label>Sistema della categoria<input id="instrumentCategorySystem" readonly value="${esc(categoryCalibrationSystem(snapshot.systems || [], v.category)?.name || "Nessun sistema attivo per la categoria")}"></label>` +
        input(
            "calibrationTolerance",
            "Tolleranza ammessa per idoneità ±",
            v.calibrationTolerance,
            "number",
        ) +
        input(
            "calibrationUnit",
            "Unità della tolleranza (es. mm)",
            v.calibrationUnit,
        ) +
        textarea("method", "Metodo: note libere / testo storico", v.method) +
        textarea(
            "nstReason",
            "Motivazione NST e limitazioni d’uso (facoltative)",
            v.nstVerified === false && v.legacy ? "" : v.nstReason,
        ) +
        input(
            "nstDate",
            "Data classificazione / revisione NST (facoltativa)",
            v.nstDate,
            "date",
        ) +
        input(
            "nstReviewMonths",
            "Revisione NST ogni (mesi, facoltativa)",
            v.nstReviewMonths,
            "number",
        ) +
        textarea(
            "changeReason",
            "Motivazione della modifica del regime",
            v.changeReason || "",
        ) +
        textarea("notes", "Note", v.notes)
    );
}
function measureRow(m: any = {}) {
    return `<tr data-measure>${["label", "unit", "nominal", "measured", "tolerance", "uncertainty"].map((key, index) => `<td><input data-m="${key}" aria-label="${["Punto di misura", "Unità", "Nominale", "Misurato", "Tolleranza simmetrica", "Incertezza"][index]}" ${index > 1 ? 'type="number" step="any"' : ""} value="${esc(m[key])}" ${key === "label" ? "required" : ""}></td>`).join("")}<td data-deviation>${num(m.deviation, 6)}</td><td data-pass>${m.pass == null ? "—" : m.pass ? "Sì" : "No"}</td><td><button type="button" data-remove-measure aria-label="Rimuovi punto">×</button></td></tr>`;
}
function calibrationForm(v: any) {
    if (v.baseline)
        return (
            '<p class="measurement-wide">Riferimento storico Access: soltanto ultima data nota, senza esito o misure. Per una nuova taratura usare Registra taratura.</p>' +
            input("date", "Ultima data storica", v.date, "date", true) +
            textarea("notes", "Note sul riferimento storico", v.notes)
        );
    const owner = instrument(v.instrumentId);
    return (
        `<label>Strumento<select name="instrumentId" required ${v.id ? "disabled" : ""}>${snapshot.instruments
            .filter(
                (i) =>
                    i.id === v.instrumentId ||
                    (i.mode !== "nst" && i.usage !== "retired"),
            )
            .map(
                (i) =>
                    `<option value="${esc(i.id)}" ${i.id === v.instrumentId ? "selected" : ""}>${esc(i.code)} · ${esc(i.description)}</option>`,
            )
            .join("")}</select></label>` +
        input("date", "Data taratura", v.date || snapshot.today, "date", true) +
        selectField(
            "mode",
            "Taratura eseguita",
            { internal: "Interna", external: "Esterna" },
            v.mode || owner?.mode || "internal",
        ) +
        systemSelector(v) +
        selectField(
            "outcome",
            "Giudizio complessivo",
            outcomes,
            v.outcome || "review",
        ) +
        input("provider", "Laboratorio / operatore", v.provider) +
        input("certificate", "Numero certificato / rapporto", v.certificate) +
        input("cost", "Costo", v.cost, "number") +
        input("currency", "Valuta (es. EUR)", v.currency || "EUR") +
        `<section id="systemReadings" class="measurement-wide" hidden></section><section id="freeMeasurements" class="measurement-wide"><div class="measurement-row"><h3>Punti di misura</h3><button type="button" id="addMeasure">+ Punto</button><button type="button" id="copyMeasures">Riprendi punti precedenti</button></div><div class="measurement-measures"><table><thead><tr>${["Punto", "Unità", "Nominale", "Misurato", "Tolleranza ±", "Incertezza", "Scostamento", "In tolleranza", ""].map((title) => `<th>${title}</th>`).join("")}</tr></thead><tbody id="measureRows">${(v.measurements || []).map(measureRow).join("")}</tbody></table></div></section>` +
        textarea("method", "Metodo impiegato", v.method || "") +
        textarea(
            "reference",
            "Campioni di riferimento e certificati",
            v.reference,
        ) +
        textarea("notes", "Note e decisione di idoneità", v.notes)
    );
}
function systemSelector(v: any) {
    const category = instrument(v.instrumentId)?.category || "",
        system = editingSystem;
    return `<label>${v.systemSnapshot ? "Sistema archiviato nel rapporto" : "Sistema della categoria"}<input id="categoryCalibrationSystemDisplay" readonly value="${esc(system ? system.name + " · revisione " + system.revision : "Nessun sistema attivo per " + category)}"><input type="hidden" name="systemId" id="calibrationSystem" value="${esc(v.systemId || "")}"></label><div class="measurement-row"><button type="button" id="reloadCalibrationSystem">Ricarica sistema della categoria</button></div>`;
}

function mountSystemReadings(measurements: any[] = []) {
    $("editDialog").classList.toggle("system-editor-open", !!editingSystem);
    $("systemReadings").hidden = !editingSystem;
    $("freeMeasurements").hidden = !!editingSystem;
    const outcome =
        $("editFields").querySelector<HTMLSelectElement>("[name=outcome]")!;
    outcome.disabled = !!editingSystem;
    $<HTMLButtonElement>("reloadCalibrationSystem").disabled =
        !editingInstrumentId;
    if (editingSystem) {
        $("systemReadings").innerHTML = systemReadingsMarkup(
            editingSystem,
            measurements,
        );
        if (editingSystemTolerance != null)
            $("systemReadings").insertAdjacentHTML(
                "afterbegin",
                `<p class="system-instrument-tolerance">Tolleranza strumento: ± ${num(editingSystemTolerance, 6)} ${esc(editingSystemUnit)}</p>`,
            );
        const evaluated = updateSystemResults(
            $("systemReadings"),
            editingSystem,
            editingSystemTolerance,
            editingSystemUnit,
        );
        outcome.value = evaluated.outcome;
    } else $("systemReadings").innerHTML = "";
}
function hasEnteredReadings() {
    return editingSystem
        ? readSystemReadings($("systemReadings")).some((r) =>
              r.readings.some((v) => v != null),
          )
        : [
              ...$("editFields").querySelectorAll<HTMLInputElement>(
                  "[data-m=measured]",
              ),
          ].some((el) => el.value !== "");
}
async function changeCalibrationSystem(refresh = false) {
    if (
        hasEnteredReadings() &&
        !(await confirmAction(
            "Ricarica sistema della categoria",
            "Le rilevazioni attuali saranno svuotate. Caricare il sistema attuale della categoria?",
            "Carica sistema",
        ))
    )
        return;
    if (refresh) {
        try {
            snapshot = await api("snapshot");
        } catch (e) {
            $("editError").textContent = (e as Error).message;
            return;
        }
    }
    const owner = instrument(
            (
                $("editFields").querySelector(
                    "[name=instrumentId]",
                ) as HTMLSelectElement
            ).value,
        ),
        system = categoryCalibrationSystem(
            snapshot.systems || [],
            owner?.category,
        );
    if (!system) {
        $("editError").textContent =
            "Definire un sistema attivo per la categoria " +
            (owner?.category || "dello strumento") +
            " nella sezione Sistemi di taratura.";
        return;
    }
    editingSystem = system;
    useCurrentSystem = true;
    editingSystemTolerance = owner.calibrationTolerance ?? null;
    editingSystemUnit = owner.calibrationUnit || "";
    editingInstrumentRevision = owner.revision;
    $<HTMLInputElement>("calibrationSystem").value = system.id;
    $<HTMLInputElement>("categoryCalibrationSystemDisplay").value =
        system.name + " · revisione " + system.revision;
    $("measureRows").innerHTML = "";
    mountSystemReadings();
}

async function changeCalibrationInstrument() {
    const select = $("editFields").querySelector<HTMLSelectElement>(
        "[name=instrumentId]",
    )!;
    if (
        hasEnteredReadings() &&
        !(await confirmAction(
            "Cambia strumento",
            "Le rilevazioni attuali saranno svuotate. Cambiare strumento?",
            "Cambia strumento",
        ))
    ) {
        select.value = editingInstrumentId;
        return;
    }
    const owner = instrument(select.value);
    editingInstrumentId = select.value;
    ($("editFields").querySelector("[name=mode]") as HTMLSelectElement).value =
        owner.mode;
    editingSystem =
        categoryCalibrationSystem(snapshot.systems || [], owner.category) ||
        null;
    editingSystemTolerance = owner.calibrationTolerance ?? null;
    editingSystemUnit = owner.calibrationUnit || "";
    editingInstrumentRevision = owner.revision;
    useCurrentSystem = true;
    $<HTMLInputElement>("calibrationSystem").value = editingSystem?.id || "";
    $<HTMLInputElement>("categoryCalibrationSystemDisplay").value =
        editingSystem
            ? editingSystem.name + " · revisione " + editingSystem.revision
            : "Nessun sistema attivo per " + owner.category;
    $("measureRows").innerHTML = "";
    mountSystemReadings();
}
function showAttachments() {
    const host = $("editAttachments");
    if (host)
        host.innerHTML = editAttachments
            .map(
                (a, index) =>
                    `<div class="measurement-row">${a.id ? `<button type="button" data-attachment="${esc(a.id)}">${esc(a.name)}</button>` : `<span>${esc(a.name)}</span>`}<span>${a.path ? "Collegamento di rete" : "Archiviato in AyPi"}</span><button type="button" data-remove-attachment="${index}" aria-label="Rimuovi allegato">×</button></div>`,
            )
            .join("");
}
function formValue() {
    const result: any = {};
    for (const el of $("editFields").querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("[name]"))
        result[el.name] =
            el instanceof HTMLInputElement && el.type === "number"
                ? el.value === ""
                    ? null
                    : Number(el.value)
                : el.value;
    if (editKind === "calibration")
        result.measurements = Array.from(
            document.querySelectorAll<HTMLElement>(
                "#measureRows [data-measure]",
            ),
        ).map((row) =>
            Object.fromEntries(
                Array.from(
                    row.querySelectorAll<HTMLInputElement>("[data-m]"),
                ).map((el) => [
                    el.dataset.m!,
                    el.type === "number"
                        ? el.value === ""
                            ? null
                            : Number(el.value)
                        : el.value,
                ]),
            ),
        );
    if (editKind === "system") {
        result.points = readSystemPoints($("editFields"));
        result.active = result.active !== "false";
        result.strict = result.strict === "true";
    }
    if (editKind === "calibration" && editingSystem) {
        result.systemRevision = editingSystem.revision;
        result.instrumentRevision = editingInstrumentRevision;
        result.useCurrentSystem = useCurrentSystem;
        result.systemReadings = readSystemReadings($("systemReadings"));
        result.measurements = [];
    }
    return result;
}
function editorSignature() {
    return JSON.stringify({
        fields: formValue(),
        attachments: editAttachments,
    });
}
function openEditor(kind: string, entity: any = null, preset: any = {}) {
    if (!actor) return;
    editReturn = document.activeElement as HTMLElement;
    editKind = kind;
    editEntity = entity ? JSON.parse(JSON.stringify(entity)) : null;
    const v = { ...(entity || {}), ...preset };
    editingSystem = null;
    useCurrentSystem = false;
    if (kind === "calibration" && !v.baseline) {
        if (!v.instrumentId)
            v.instrumentId = snapshot.instruments.find(
                (i) => i.mode !== "nst" && i.usage !== "retired",
            )?.id;
        editingInstrumentId = v.instrumentId;
        const owner = instrument(v.instrumentId);
        editingInstrumentRevision = owner?.revision || 0;
        const systemId = entity
            ? entity.systemId || ""
            : categoryCalibrationSystem(snapshot.systems || [], owner?.category)
                  ?.id || "";
        editingSystem =
            entity?.systemSnapshot ||
            (snapshot.systems || []).find(
                (s) => s.id === systemId && s.active,
            ) ||
            null;
        editingSystemTolerance = entity?.systemSnapshot
            ? entity.systemTolerance
            : (owner?.calibrationTolerance ?? null);
        editingSystemUnit = entity?.systemSnapshot
            ? entity.systemToleranceUnit
            : owner?.calibrationUnit || "";
        v.systemId = systemId;
    }
    editAttachments = entity
        ? attachments(kind, entity.id).map((a) => ({ ...a }))
        : [];
    if ($<HTMLDialogElement>("detailDialog").open)
        $<HTMLDialogElement>("detailDialog").close();
    $("editDialog").classList.toggle(
        "system-editor-open",
        kind === "system" || !!editingSystem,
    );
    $("editTitle").textContent =
        (entity ? "Modifica " : "Nuovo ") +
        (kind === "system"
            ? "sistema di taratura"
            : kind === "instrument"
              ? "strumento"
              : "rapporto di taratura");
    $("editFields").innerHTML =
        (kind === "system"
            ? calibrationSystemForm(v, [
                  ...new Set<string>(
                      [
                          ...snapshot.instruments.map((i) => i.category),
                          ...(snapshot.systems || []).map((s) => s.category),
                      ].filter(Boolean),
                  ),
              ])
            : kind === "instrument"
              ? instrumentForm(v)
              : calibrationForm(v)) +
        `<section class="measurement-wide"><div class="measurement-row"><h3>Certificati e documenti</h3><button type="button" id="addAttachments">+ Allegati</button></div><div id="editAttachments"></div></section>`;
    if (kind === "instrument") {
        for (const name of ["category", "location"]) {
            const el = $("editFields").querySelector<HTMLInputElement>(
                `[name=${name}]`,
            )!;
            el.setAttribute("list", name + "List");
            el.insertAdjacentHTML(
                "afterend",
                `<datalist id="${name}List">${[...new Set([...snapshot.instruments.map((i) => i[name]), ...(name === "category" ? (snapshot.systems || []).map((s) => s.category).filter(Boolean) : [])])].map((value) => `<option value="${esc(value)}"></option>`).join("")}</datalist>`,
            );
        }
        updateNstFields();
    }
    if (kind === "system") {
        $("editFields")
            .querySelector("#editAttachments")
            ?.closest("section")
            ?.remove();
        updateSystemDefinition($("editFields"));
    }
    if (kind === "calibration" && !v.baseline)
        mountSystemReadings(v.measurements || []);
    $("editError").textContent = "";
    $("deleteEntity").hidden = !entity;
    showAttachments();
    editorOriginal = editorSignature();
    $<HTMLDialogElement>("editDialog").showModal();
}
function updateNstFields() {
    const field = <
        T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    >(
        name: string,
    ) => $("editFields").querySelector<T>(`[name=${name}]`)!;
    const mode = field<HTMLSelectElement>("mode").value,
        isNst = mode === "nst",
        reviewMonths = field<HTMLInputElement>("nstReviewMonths");
    for (const name of ["nstReason", "nstDate", "nstReviewMonths"]) {
        const el = field<HTMLInputElement | HTMLTextAreaElement>(name);
        el.closest<HTMLElement>("label")!.hidden = !isNst;
        el.required = isNst && name === "nstDate" && !!reviewMonths.value;
    }
    const frequency = field<HTMLInputElement>("frequencyMonths"),
        deadline = field<HTMLInputElement>("initialDueDate");
    frequency.disabled = isNst;
    frequency.required = !isNst;
    deadline.closest<HTMLElement>("label")!.hidden = isNst;
    deadline.disabled = isNst;
    deadline.required = !isNst;
    deadline.readOnly = false;
    if (isNst) deadline.value = "";
    else {
        const preview = schedule(
            [
                {
                    ...(editEntity || {}),
                    id: editEntity?.id || "__new__",
                    mode,
                    frequencyMonths: frequency.value
                        ? Number(frequency.value)
                        : null,
                    initialDueDate: deadline.value,
                    requalifiedAt:
                        editEntity?.mode === "nst"
                            ? new Date().toISOString()
                            : editEntity?.requalifiedAt,
                },
            ],
            snapshot.calibrations,
            snapshot.today,
        )[0];
        if (preview.dueDateSource === "calculated") {
            deadline.value = preview.dueDate;
            deadline.readOnly = true;
        } else if (!deadline.value) deadline.value = preview.dueDate;
    }
    field<HTMLInputElement>("calibrationUnit").required =
        field<HTMLInputElement>("calibrationTolerance").value !== "";
    const reason = field<HTMLTextAreaElement>("changeReason");
    reason.required = !!editEntity && editEntity.mode !== mode && !isNst;
    reason.closest<HTMLElement>("label")!.hidden = !reason.required;
}

async function confirmAction(title: string, body: string, action: string) {
    const d = $<HTMLDialogElement>("confirmDialog");
    $("confirmTitle").textContent = title;
    d.querySelector("p")!.textContent = body;
    const button = d.querySelector<HTMLButtonElement>("[value=delete]")!;
    button.textContent = action;
    d.returnValue = "cancel";
    d.showModal();
    return new Promise<boolean>((resolve) =>
        d.addEventListener("close", () => resolve(d.returnValue === "delete"), {
            once: true,
        }),
    );
}
async function closeEditor() {
    if (busy) return false;
    if (
        editorSignature() !== editorOriginal &&
        !(await confirmAction(
            "Modifiche non salvate",
            "Chiudere la scheda e perdere le modifiche?",
            "Scarta modifiche",
        ))
    )
        return false;
    $<HTMLDialogElement>("editDialog").close();
    editReturn?.focus();
    return true;
}
async function deleteEntity(kind: string, entity: any) {
    if (
        !(await confirmAction(
            "Elimina scheda",
            "Eliminare la scheda? Lo storico delle operazioni conserverà la modifica.",
            "Elimina",
        ))
    )
        return;
    await work(async () => {
        await api("delete", { kind, entity });
        $<HTMLDialogElement>("editDialog").close();
        await load();
    });
}
function classifyNst(id: string) {
    const i = instrument(id);
    if (i)
        openEditor("instrument", i, {
            mode: "nst",
            nstDate: i.nstDate || "",
            nstReason: i.mode === "nst" ? i.nstReason : "",
            changeReason: "",
        });
}
function facts(i: any) {
    return `<dl class="measurement-facts">${instrumentColumns.map(([key, label, type]) => `<div><dt>${label}</dt><dd>${valueHtml(i, key, type)}</dd></div>`).join("")}</dl>`;
}
function reportMeasurementDetails(r: any) {
    if (!r.measurements?.length) return "—";
    return `<details><summary>${r.measurements.length} punti${r.systemSnapshot ? " · " + esc(r.systemSnapshot.name) + " · rev. " + r.systemSnapshot.revision : ""}</summary><div class="table-scroll"><table><thead><tr>${["Punto", "Unità", "Nominale", "Rilevazioni", "Media / misurato", "Delta", "s", "Media - k·s", "Media + k·s", "Ammesso inf.", "Ammesso sup.", "Tolleranza ±", "Incertezza", "Esito"].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${r.measurements.map((m) => `<tr><td>${esc(m.label)}</td><td>${esc(m.unit)}</td><td>${num(m.nominal, 6)}</td><td>${m.readings ? m.readings.map((v) => (v == null ? "—" : typeof v === "number" ? num(v, 6) : v === "ok" ? "OK" : "Non OK")).join(" ; ") : "—"}</td>${["measured", "deviation", "standardDeviation", "lower", "upper", "acceptanceLower", "acceptanceUpper", "tolerance", "uncertainty"].map((key) => `<td class="numeric">${num(m[key], 6)}</td>`).join("")}<td>${m.pass == null ? "Da completare" : m.pass ? "ID" : "NID"}</td></tr>`).join("")}</tbody></table></div>${r.systemSnapshot ? `<p>${esc(calibrationRules[r.systemSnapshot.rule])} · Tolleranza strumento archiviata: ${num(r.systemTolerance, 6)} ${esc(r.systemToleranceUnit)}.</p><p>${esc(r.systemSnapshot.description)}</p>` : ""}</details>`;
}
function recordTable(records: any[]) {
    return `<div class="table-scroll"><table><thead><tr><th>Data</th><th>Regime</th><th>Esito</th><th>Laboratorio / operatore</th><th>Certificato</th><th>Fonte</th><th>Misure</th><th>Documenti</th></tr></thead><tbody>${
        records
            .sort((a, b) => b.date.localeCompare(a.date))
            .map(
                (r) =>
                    `<tr><td><button class="measurement-link" data-edit-calibration="${esc(r.id)}">${date(r.date)}</button></td><td>${esc(modes[r.mode] || "NST storico")}</td><td>${esc(outcomes[r.outcome])}</td><td>${esc(r.provider || "—")}</td><td>${esc(r.certificate || "—")}</td><td>${r.baseline ? "Ultima data Access" : "AyPi"}</td><td>${reportMeasurementDetails(r)}</td><td>${
                        attachments("calibration", r.id)
                            .map(
                                (a) =>
                                    `<button data-attachment="${esc(a.id)}">${esc(a.name)}</button>`,
                            )
                            .join(" ") || "—"
                    }</td></tr>`,
            )
            .join("") ||
        '<tr><td colspan="8">Nessuna taratura registrata.</td></tr>'
    }</tbody></table></div>`;
}

async function openDetail(id: string) {
    detailId = id;
    const i = snapshot.schedule.find((i) => i.id === id);
    if (!i) return;
    $("detailNst").textContent =
        i.mode === "nst" ? "Rivedi classificazione NST" : "Classifica NST";
    $("detailTitle").textContent = i.code + " · " + i.description;
    $("detailBody").innerHTML =
        facts(i) +
        "<h3>Tarature e misure</h3>" +
        recordTable(
            snapshot.calibrations.filter((r) => r.instrumentId === id),
        ) +
        `<h3>Documenti dello strumento</h3>${
            attachments("instrument", id)
                .map(
                    (a) =>
                        `<button data-attachment="${esc(a.id)}">${esc(a.name)}</button>`,
                )
                .join(" ") || "<p>Nessun documento.</p>"
        }${i.legacy ? `<h3>Riferimenti originali Access</h3><p>Ultima data originale: ${date(i.legacy.lastDate)} · Idoneità originale: ${esc(i.legacy.suitability || "Non dichiarata")} · Frequenza originale: ${num(i.legacy.frequencyYears)} anni · Prossima data originale: ${date(i.legacy.nextDate)}.</p>` : ""}<h3>Storico delle operazioni</h3><div id="detailAudit">Caricamento…</div>`;
    $<HTMLButtonElement>("detailCalibrate").disabled =
        i.mode === "nst" || i.usage === "retired";
    $<HTMLDialogElement>("detailDialog").showModal();
    try {
        const { audit } = await api("audit", { id });
        if (detailId !== id) return;
        analysisAudit = audit;
        $("detailAudit").innerHTML =
            `<div class="table-scroll"><table><thead><tr><th>Data</th><th>Operatore</th><th>Azione</th><th>Scheda</th><th>Variazioni</th></tr></thead><tbody>${audit
                .map((a) => {
                    const keys = Object.keys(a.after).filter(
                        (key) =>
                            ![
                                "id",
                                "revision",
                                "createdAt",
                                "updatedAt",
                                "updatedBy",
                                "createdBy",
                            ].includes(key) &&
                            JSON.stringify(a.before?.[key]) !==
                                JSON.stringify(a.after[key]),
                    );
                    return `<tr><td>${esc(new Date(a.at).toLocaleString("it-IT"))}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${a.kind === "instrument" ? "Strumento" : "Taratura"}</td><td><details><summary>${keys.length} campi</summary>${keys.map((key) => `<p><b>${esc(instrumentColumns.find((c) => c[0] === key)?.[1] || key)}</b>: ${esc(typeof a.before?.[key] === "object" ? JSON.stringify(a.before[key]) : (a.before?.[key] ?? "—"))} → ${esc(typeof a.after[key] === "object" ? JSON.stringify(a.after[key]) : a.after[key])}</p>`).join("")}</details></td></tr>`;
                })
                .join("")}</tbody></table></div>`;
    } catch (e) {
        $("detailAudit").textContent = (e as Error).message;
    }
}
async function employees() {
    try {
        const r = await ipc.invoke("measurement-employees");
        if (!r.ok) throw Error(r.error || "Elenco dipendenti non disponibile.");
        groups = r.groups;
        $("loginDepartment").innerHTML = Object.keys(groups)
            .map((group) => `<option>${esc(group)}</option>`)
            .join("");
        loginEmployees();
        $("loginError").textContent = "";
    } catch (e) {
        $("loginError").textContent = (e as Error).message;
    }
}
function loginEmployees() {
    $("loginEmployee").innerHTML =
        '<option value="">Seleziona dipendente</option>' +
        (groups[$<HTMLSelectElement>("loginDepartment").value] || [])
            .map((name) => `<option>${esc(name)}</option>`)
            .join("");
}
$("loginDepartment").onchange = loginEmployees;
$("loginRetry").onclick = () => void employees();
$("loginForm").onsubmit = (event) => {
    event.preventDefault();
    void work(async () => {
        try {
            const r = await ipc.invoke(
                "measurement-login",
                $<HTMLSelectElement>("loginEmployee").value,
            );
            if (!r.ok) throw Error(r.error);
            snapshot = r;
            actor = r.actor;
            preferences = (await api("preferences-get")).preferences || {
                workspace: emptyWorkspace(),
                analysisWorkspace: emptyWorkspace(),
                filterPresets: [],
                columns: {},
            };
            preferences.workspace = dashboardWorkspace(preferences.workspace);
            for (const id of ["newRecord", "export", "refresh", "operator"])
                $<HTMLButtonElement>(id).disabled = false;
            $("operator").textContent = actor;
            $<HTMLDialogElement>("loginDialog").close();
            $("workspace").hidden = false;
            view = "dashboard";
            filters = emptyFilters();
            selection = {};
            viewContexts.clear();
            analysisControls();
            filterControls();
            if (!workspace) initWorkspace();
            else workspace.replacePreferences(preferences.workspace);
            render();
        } catch (e) {
            $("loginError").textContent = (e as Error).message;
        }
    });
};
$("loginClose").onclick = $("close").onclick = () => {
    void (async () => {
        if ($<HTMLDialogElement>("editDialog").open && !(await closeEditor()))
            return;
        ipc.send("measurement-close");
    })();
};
$("operator").onclick = () => {
    void work(async () => {
        if ($<HTMLDialogElement>("editDialog").open) return;
        workspace?.closeFocus();
        ipc.send("measurement-logout");
        actor = "";
        $("workspace").hidden = true;
        $<HTMLDialogElement>("loginDialog").showModal();
        await employees();
    });
};
document
    .querySelectorAll<HTMLElement>("[data-view]")
    .forEach(
        (button) => (button.onclick = () => changeView(button.dataset.view!)),
    );
$("refresh").onclick = () => void work(load);
$("newRecord").onclick = () =>
    openEditor("calibration", null, {
        instrumentId: view === "analysis" ? analysisId : filters.machines[0],
    });
$("newEntity").onclick = () =>
    openEditor(
        view === "systems"
            ? "system"
            : view === "calibrations"
              ? "calibration"
              : "instrument",
        null,
        view === "nst" ? { mode: "nst" } : {},
    );
$("resetFilters").onclick = () => {
    filters = emptyFilters();
    selection = {};
    filterControls();
    render();
};
$("modeFilter").onchange = () => {
    filters.kind = $<HTMLSelectElement>("modeFilter").value;
    render();
};
$("textFilter").oninput = () => {
    filters.text = $<HTMLInputElement>("textFilter").value;
    render();
};
$("locationsPicker").onchange = () => {
    filters.departments = [
        ...$("locationsPicker").querySelectorAll<HTMLInputElement>(
            "input:checked",
        ),
    ].map((el) => el.dataset.location!);
    filterControls();
    render();
};
$("instrumentsPicker").onchange = () => {
    filters.machines = [
        ...$("instrumentsPicker").querySelectorAll<HTMLInputElement>(
            "input:checked",
        ),
    ].map((el) => el.dataset.instrument!);
    $("instrumentSummary").textContent = filters.machines.length
        ? num(filters.machines.length)
        : "Tutti";
    render();
};
$("instrumentsPicker").oninput = (event) => {
    const target = event.target as HTMLInputElement;
    if (target.id === "instrumentSearch")
        for (const label of $(
            "instrumentsPicker",
        ).querySelectorAll<HTMLElement>("label"))
            label.hidden = !label.textContent
                ?.toLocaleLowerCase("it")
                .includes(target.value.toLocaleLowerCase("it"));
};
$("addRule").onclick = () => {
    $("advancedRules").insertAdjacentHTML(
        "beforeend",
        ruleHtml(
            { field: columns()[0][0], op: "contains", value: "" },
            Date.now(),
        ),
    );
};
$("advancedRules").onclick = (event) =>
    (event.target as HTMLElement)
        .closest("[data-remove-rule]")
        ?.closest("[data-rule]")
        ?.remove();
$("applyRules").onclick = () =>
    void work(async () => {
        readFilters();
        $<HTMLDetailsElement>("advancedFilters").open = false;
        render();
    });
document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    for (const el of document.querySelectorAll<HTMLDetailsElement>(
        "#filters details[open],#columns[open]",
    ))
        if (!el.contains(target)) el.open = false;
});
$("saveFilterPreset").onclick = () =>
    void work(async () => {
        readFilters();
        const name = $<HTMLInputElement>("filterPresetName").value.trim();
        if (!name) throw Error("Indicare un nome per il preset.");
        const next = JSON.parse(JSON.stringify(preferences)),
            index = next.filterPresets.findIndex(
                (p) =>
                    p.name.toLocaleLowerCase("it") ===
                    name.toLocaleLowerCase("it"),
            ),
            preset = {
                name,
                view,
                filters: JSON.parse(JSON.stringify(filters)),
            };
        if (index >= 0) next.filterPresets[index] = preset;
        else next.filterPresets.push(preset);
        await api("preferences-save", { value: next });
        preferences = next;
        filterControls();
    });
$("deleteFilterPreset").onclick = () =>
    void work(async () => {
        const value = $<HTMLSelectElement>("filterPreset").value;
        if (!value) return;
        const next = JSON.parse(JSON.stringify(preferences));
        next.filterPresets.splice(Number(value), 1);
        await api("preferences-save", { value: next });
        preferences = next;
        filterControls();
    });
$("filterPreset").onchange = () => {
    const value = $<HTMLSelectElement>("filterPreset").value;
    if (!value) return;
    const preset = preferences.filterPresets[Number(value)];
    changeView(preset.view);
    filters = JSON.parse(JSON.stringify(preset.filters));
    filterControls();
    render();
};
$("columnPicker").onchange = () =>
    void work(async () => {
        const keys = [
            ...$("columnPicker").querySelectorAll<HTMLInputElement>(
                "input:checked",
            ),
        ].map((el) => el.dataset.column!);
        if (!keys.length) {
            renderTable();
            throw Error("Mantenere almeno una colonna.");
        }
        preferences.columns[view] = keys;
        renderTable();
        await savePreferences();
    });
$("measurementTable").onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-open]",
    );
    if (!button) return;
    if (button.dataset.kind === "instrument")
        void openDetail(button.dataset.open!);
    else
        openEditor(
            button.dataset.kind!,
            (button.dataset.kind === "system"
                ? snapshot.systems
                : snapshot.calibrations
            ).find((r) => r.id === button.dataset.open),
        );
};
$("measurementTable").oncontextmenu = (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(
        "tr[data-id]",
    );
    if (row) {
        event.preventDefault();
        void ipc.invoke("measurement-row-menu", {
            kind: row.dataset.kind,
            id: row.dataset.id,
        });
    }
};
$("measurementTable").onkeydown = (event) => {
    if (event.key === "Enter" && event.target instanceof HTMLTableRowElement)
        (event.target.querySelector("[data-open]") as HTMLElement)?.click();
};
ipc.on("measurement-row-action", (_event: any, p: any) => {
    const entity = snapshot[
        p.kind === "instrument"
            ? "instruments"
            : p.kind === "system"
              ? "systems"
              : "calibrations"
    ].find((r) => r.id === p.id);
    if (!entity) return;
    if (p.action === "detail")
        p.kind === "instrument"
            ? void openDetail(p.id)
            : openEditor(p.kind, entity);
    if (p.action === "edit") openEditor(p.kind, entity);
    if (p.action === "delete") void deleteEntity(p.kind, entity);
    if (p.action === "nst") classifyNst(p.id);
    if (p.action === "calibrate")
        openEditor("calibration", null, { instrumentId: p.id });
});
$("noticeDays").onchange = () => {
    notice = Number($<HTMLSelectElement>("noticeDays").value);
    render();
};
$("analysisInstrument").onchange = () => {
    analysisId = $<HTMLSelectElement>("analysisInstrument").value;
    selection = {};
    analysisControls();
    render();
};
$("analysisPoint").onchange = () => {
    pointKey = $<HTMLSelectElement>("analysisPoint").value;
    render();
};
$("analysisDetail").onclick = () => void openDetail(analysisId);
$("analysisNew").onclick = () =>
    openEditor("calibration", null, { instrumentId: analysisId });
$("detailClose").onclick = () => $<HTMLDialogElement>("detailDialog").close();
$("detailEdit").onclick = () => openEditor("instrument", instrument(detailId));
$("detailNst").onclick = () => classifyNst(detailId);
$("detailCalibrate").onclick = () =>
    openEditor("calibration", null, { instrumentId: detailId });
$("detailAnalyze").onclick = () => {
    $<HTMLDialogElement>("detailDialog").close();
    analysisId = detailId;
    changeView("analysis");
};
document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement,
        detail = target.closest<HTMLElement>("[data-detail]"),
        nst = target.closest<HTMLElement>("[data-nst]"),
        calibrate = target.closest<HTMLElement>("[data-calibrate]"),
        record = target.closest<HTMLElement>("[data-edit-calibration]"),
        attachment = target.closest<HTMLElement>("[data-attachment]");
    if (detail) void openDetail(detail.dataset.detail!);
    if (nst) classifyNst(nst.dataset.nst!);
    if (calibrate)
        openEditor("calibration", null, {
            instrumentId: calibrate.dataset.calibrate,
        });
    if (record)
        openEditor(
            "calibration",
            snapshot.calibrations.find(
                (r) => r.id === record.dataset.editCalibration,
            ),
        );
    if (attachment)
        void work(async () => {
            const r = await ipc.invoke(
                "measurement-open-attachment",
                attachment.dataset.attachment,
            );
            if (!r.ok) throw Error(r.error);
        });
});
$("editClose").onclick = $("editCancel").onclick = () => void closeEditor();
$<HTMLDialogElement>("editDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    void closeEditor();
});
$("deleteEntity").onclick = () => void deleteEntity(editKind, editEntity);
$("editFields").onchange = (event) => {
    const target = event.target as HTMLInputElement;
    if (
        editKind === "instrument" &&
        [
            "mode",
            "frequencyMonths",
            "nstReviewMonths",
            "calibrationTolerance",
        ].includes(target.name)
    )
        updateNstFields();
    if (editKind === "system") {
        if (target.name === "rule" && target.value === "historical")
            (
                $("editFields").querySelector(
                    "[name=strict]",
                ) as HTMLSelectElement
            ).value = "true";
        updateSystemDefinition($("editFields"));
    }
    if (editKind === "calibration" && target.name === "instrumentId")
        void changeCalibrationInstrument();
    if (editKind === "instrument" && target.name === "category")
        $<HTMLInputElement>("instrumentCategorySystem").value =
            categoryCalibrationSystem(snapshot.systems || [], target.value)
                ?.name || "Nessun sistema attivo per la categoria";
};
$("editFields").oninput = (event) => {
    const target = event.target as HTMLInputElement;
    if (
        editKind === "calibration" &&
        editingSystem &&
        target.closest("#systemReadings")
    ) {
        const evaluated = updateSystemResults(
            $("systemReadings"),
            editingSystem,
            editingSystemTolerance,
            editingSystemUnit,
        );
        (
            $("editFields").querySelector("[name=outcome]") as HTMLSelectElement
        ).value = evaluated.outcome;
        return;
    }
    const row = target.closest<HTMLElement>("[data-measure]");
    if (!row) return;
    const get = (key: string) => {
            const v = row.querySelector<HTMLInputElement>(
                `[data-m=${key}]`,
            )!.value;
            return v === "" ? null : Number(v);
        },
        a = get("nominal"),
        b = get("measured"),
        t = get("tolerance"),
        d = a != null && b != null ? b - a : null;
    row.querySelector("[data-deviation]")!.textContent = num(d, 6);
    row.querySelector("[data-pass]")!.textContent =
        d != null && t != null ? (Math.abs(d) <= t + 1e-12 ? "Sì" : "No") : "—";
};
$("editFields").onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("#addSystemPoint")) {
        $("systemPoints").insertAdjacentHTML("beforeend", systemPointRow());
        updateSystemDefinition($("editFields"));
    }
    if (target.closest("[data-remove-system-point]"))
        target.closest("[data-system-point]")?.remove();
    if (target.closest("#reloadCalibrationSystem"))
        void changeCalibrationSystem(true);
    if (target.closest("[data-remove-measure]"))
        target.closest("[data-measure]")?.remove();
    const remove = target.closest<HTMLElement>("[data-remove-attachment]");
    if (remove) {
        editAttachments.splice(Number(remove.dataset.removeAttachment), 1);
        showAttachments();
    }
    if (target.closest("#addMeasure"))
        $("measureRows").insertAdjacentHTML("beforeend", measureRow());
    if (target.closest("#copyMeasures")) {
        const id = (
                $("editFields").querySelector(
                    "[name=instrumentId]",
                ) as HTMLSelectElement
            ).value,
            previous = snapshot.calibrations
                .filter(
                    (r) =>
                        r.instrumentId === id &&
                        !r.systemId &&
                        r.measurements?.length,
                )
                .sort((a, b) => b.date.localeCompare(a.date))[0];
        if (previous)
            $("measureRows").innerHTML = previous.measurements
                .map((m) =>
                    measureRow({
                        ...m,
                        measured: null,
                        deviation: null,
                        pass: null,
                        uncertainty: null,
                    }),
                )
                .join("");
        else
            $("editError").textContent =
                "Nessun punto precedente per questo strumento.";
    }
    if (target.closest("#addAttachments"))
        void (async () => {
            const r = await ipc.invoke("measurement-pick-attachments");
            if (r.ok) {
                editAttachments.push(...r.attachments);
                showAttachments();
            } else $("editError").textContent = r.error;
        })();
};
$("editForm").onsubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    void work(async () => {
        const button = $<HTMLButtonElement>("saveEntity");
        button.disabled = true;
        try {
            await api("save", {
                kind: editKind,
                entity: {
                    ...(editEntity || {}),
                    ...formValue(),
                    id: editEntity?.id,
                    revision: editEntity?.revision || 0,
                    attachments: editAttachments,
                },
            });
            $<HTMLDialogElement>("editDialog").close();
            await load();
            editReturn?.focus();
        } catch (e) {
            $("editError").textContent = (e as Error).message;
        } finally {
            button.disabled = false;
        }
    });
};
document.addEventListener("keydown", (event) => {
    if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s" &&
        $<HTMLDialogElement>("editDialog").open
    ) {
        event.preventDefault();
        $<HTMLFormElement>("editForm").requestSubmit();
    }
});
$("export").onclick = () =>
    void work(async () => {
        const rows =
                view === "systems"
                    ? currentRows()
                    : view === "calibrations"
                      ? selectedRecords()
                      : view === "due"
                        ? dueRows()
                        : selectedInstruments(),
            r = await ipc.invoke("measurement-export", {
                view: view === "info" ? "instruments" : view,
                ids: rows.map((r) => r.id),
                recordIds: selectedRecords().map((r) => r.id),
                period: { from: filters.from, to: filters.to },
            });
        if (!r.ok) throw Error(r.error);
    });
async function cancelImport() {
    const token = importToken;
    importToken = "";
    $<HTMLDialogElement>("accessImportDialog").close();
    if (token)
        await ipc.invoke("measurement-import", { phase: "cancel", token });
}
$("importAccess").onclick = () =>
    void work(async () => {
        message("Lettura della copia Access in corso…");
        const r = await ipc.invoke("measurement-import", { phase: "preview" });
        if (!r.ok) throw Error(r.error);
        const c = r.comparison;
        importToken = c.token;
        $("accessImportSummary").textContent =
            `Da aggiungere: ${num(c.instruments)} strumenti, ${num(c.calibrations)} riferimenti all’ultima taratura. Differenze: ${num(c.differences.length)}. Anomalie: ${num(c.issues.length)}.`;
        $("accessImportDetails").innerHTML =
            `<table><thead><tr><th>Codice</th><th>Campo</th><th>AyPi</th><th>Access</th></tr></thead><tbody>${c.differences.map((d) => `<tr><td>${esc(d.code)}</td><td>${esc(instrumentColumns.find((col) => col[0] === d.field)?.[1] || d.field)}</td><td>${esc(d.existing)}</td><td>${esc(d.incoming)}</td></tr>`).join("")}${[...c.issues, ...c.skipped].map((i) => `<tr><td>${esc(i.code)}</td><td colspan="3">${esc(i.reason)}</td></tr>`).join("") || '<tr><td colspan="4">Nessuna differenza.</td></tr>'}</tbody></table>`;
        $("accessImportError").textContent = "";
        $<HTMLDialogElement>("accessImportDialog").showModal();
        message();
    });
$("accessImportClose").onclick = $("accessImportCancel").onclick = () =>
    void cancelImport();
$<HTMLDialogElement>("accessImportDialog").addEventListener(
    "cancel",
    (event) => {
        event.preventDefault();
        void cancelImport();
    },
);
$("accessImportApply").onclick = () =>
    void work(async () => {
        const button = $<HTMLButtonElement>("accessImportApply");
        button.disabled = true;
        try {
            const r = await ipc.invoke("measurement-import", {
                phase: "apply",
                token: importToken,
            });
            if (!r.ok) throw Error(r.error);
            importToken = "";
            $<HTMLDialogElement>("accessImportDialog").close();
            await load();
        } catch (e) {
            $("accessImportError").textContent = (e as Error).message;
        } finally {
            button.disabled = false;
        }
    });
$<HTMLDialogElement>("loginDialog").showModal();
void employees();
setInterval(() => {
    if (actor && !busy && snapshot.today !== todayInRome()) void work(load);
}, 60000);
let permitUnload = false;
window.addEventListener("beforeunload", (event) => {
    if (
        !permitUnload &&
        $<HTMLDialogElement>("editDialog").open &&
        editorSignature() !== editorOriginal
    ) {
        event.returnValue = false as any;
        void confirmAction(
            "Modifiche non salvate",
            "Chiudere il modulo e perdere le modifiche?",
            "Scarta modifiche",
        ).then((ok) => {
            if (ok) {
                permitUnload = true;
                ipc.send("measurement-close");
            }
        });
    }
});
