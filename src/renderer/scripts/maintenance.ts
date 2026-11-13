import {analysisYearPicker} from '../modules/analysis-year-picker';
import Chart from "chart.js/auto";
import { installAnalysisWorkspace } from "../modules/analysis-workspace";
import { mergeAreaSelection } from "../modules/analysis-chart-area-selection";
import { bindSortingHeaders, updateSortingBar } from "../modules/table-sorting";
import {
    sortByCriteria,
    SortCriterion,
} from "../../main/modules/analysis-sorting";
import { emptyWorkspace } from "../../main/modules/analysis-ui-model";
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
const num = (v: any) =>
    new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(
        Number(v),
    );
const date = (v: any) =>
    v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—";
type Rule = { field: string; op: string; value: string; to?: string };
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
let snapshot: any = {
        machines: [],
        plans: [],
        records: [],
        due: [],
        attachments: [],
        issues: [],
        today: "",
    },
    actor = "",
    view = "dashboard",
    filters = emptyFilters(),
    preferences: any = {
        workspace: emptyWorkspace(),
        filterPresets: [],
        columns: {},
    },
    limit = 250,
    sort: SortCriterion[] = [{key:"machineCode", direction:"asc"}],
    groups: Record<string, string[]> = {},
    busy = false,
    editKind = "",
    editEntity: any = null,
    editAttachments: any[] = [],
    returnFocus: HTMLElement | null = null;
let selection: Record<string, string[]> = {
        machine: [],
        month: [],
        department: [],
        kind: [],
    },
    charts: Chart[] = [],
    workspace: ReturnType<typeof installAnalysisWorkspace> | null = null,
    tableRows: any[] = [];
const fields: Record<string, [string, string, string][]> = {
    records: [
        ["date", "Data", "date"],
        ["kindLabel", "Tipo", "text"],
        ["machineCode", "Macchina", "text"],
        ["department", "Reparto", "text"],
        ["description", "Manutenzione / intervento", "text"],
        ["notes", "Note", "text"],
        ["createdBy", "Inserito da", "text"],
        ["updatedBy", "Modificato da", "text"],
        ["attachmentCount", "Numero allegati", "number"],
        ["attachmentNames", "Nomi allegati", "text"],
        ["id", "ID", "text"],
        ["createdAt", "Inserimento", "date"],
        ["updatedAt", "Ultima modifica", "date"],
    ],
    machines: [
        ["code", "Codice", "text"],
        ["department", "Reparto", "text"],
        ["description", "Identificativo macchina", "text"],
        ["year", "Anno", "number"],
        ["responsible", "Responsabile", "text"],
        ["serial", "Matricola", "text"],
        ["robotSerial", "Matricola robot/forno", "text"],
        ["islandSerial", "Matricola isola robotizzata", "text"],
        ["equipmentLabel", "Tipi attrezzatura", "text"],
        ["conformity", "Conformità", "text"],
        ["robotConformity", "Conformità robot", "text"],
        ["activeLabel", "Attiva", "text"],
    ],
    plans: [
        ["machineCode", "Macchina", "text"],
        ["department", "Reparto", "text"],
        ["description", "Manutenzione prevista", "text"],
        ["frequencyMonths", "Frequenza (mesi)", "number"],
        ["lastDate", "Ultima esecuzione", "date"],
        ["activeLabel", "Attiva", "text"],
        ["id", "ID", "text"],
    ],
    due: [
        ["machineCode", "Macchina", "text"],
        ["department", "Reparto", "text"],
        ["description", "Manutenzione", "text"],
        ["lastDate", "Ultima esecuzione", "date"],
        ["dueDate", "Scadenza", "date"],
        ["daysOverdue", "Giorni di ritardo", "number"],
    ],
};
const columns = () =>
    fields[view === "dashboard" ? "records" : view] || fields.records;
const api = async (op: string, rest: any = {}) => {
    const r = await ipc.invoke("maintenance-api", { op, ...rest });
    if (!r.ok) throw Error(r.error || "Operazione non riuscita.");
    return r;
};
const message = (text = "", error = false) => {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
};
const machine = (id: string) => snapshot.machines.find((m) => m.id === id);
const plan = (id: string) => snapshot.plans.find((p) => p.id === id);
function enrich(row: any) {
    const m = machine(row.machineId),
        attachments = snapshot.attachments.filter((a) => a.recordId === row.id);
    return {
        ...row,
        machineCode: m?.code || row.machineId || "",
        department: m?.department || row.department || "",
        month: row.date?.slice(0, 7) || "",
        kindLabel:
            row.kind === "ordinary"
                ? "Ordinaria"
                : row.kind === "extraordinary"
                  ? "Straordinaria"
                  : "",
        equipmentLabel: row.equipmentTypes?.join(" · ") || "",
        activeLabel: row.active === false ? "No" : "Sì",
        attachmentCount: attachments.length,
        attachmentNames: attachments.map((a) => a.name).join(" · "),
    };
}
function matches(row: any, temporal = true) {
    const dept = row.department || "",
        id = row.machineId || row.id;
    if (
        (filters.departments.length && !filters.departments.includes(dept)) ||
        (filters.machines.length && !filters.machines.includes(id))
    )
        return false;
    if (
        temporal &&
        ((filters.kind && row.kind !== filters.kind) ||
            (filters.from && (!row.date || row.date < filters.from)) ||
            (filters.to && (!row.date || row.date > filters.to)))
    )
        return false;
    if (
        filters.text &&
        !Object.values(row).some((v) =>
            String(v ?? "")
                .toLocaleLowerCase("it")
                .includes(filters.text.toLocaleLowerCase("it")),
        )
    )
        return false;
    const rules = new Map<string, Rule[]>();
    for (const r of filters.rules) {
        if (!r.value && !r.to && r.op !== "empty") continue;
        rules.set(r.field, [...(rules.get(r.field) || []), r]);
    }
    return [...rules].every(([key, rs]) =>
        rs.some((r) => {
            const raw = row[key],
                a = (
                    columns().find((c) => c[0] === key)?.[2] === "date"
                        ? String(raw ?? "").slice(0, 10)
                        : String(raw ?? "")
                ).toLocaleLowerCase("it"),
                b = r.value.toLocaleLowerCase("it");
            return r.op === "empty"
                ? raw == null || raw === ""
                : r.op === "range"
                  ? raw != null &&
                    (typeof raw === "number"
                        ? (!b || raw >= Number(b)) &&
                          (!r.to || raw <= Number(r.to))
                        : (!b || a.slice(0, 10) >= b) &&
                          (!r.to || a.slice(0, 10) <= r.to))
                  : r.op === "exact"
                    ? a === b
                    : r.op === "prefix"
                      ? a.startsWith(b)
                      : r.op === "not"
                        ? !a.includes(b)
                        : r.op === "gte"
                          ? raw != null &&
                            (typeof raw === "number"
                                ? raw >= Number(r.value)
                                : a >= b)
                          : r.op === "lte"
                            ? raw != null &&
                              (typeof raw === "number"
                                  ? raw <= Number(r.value)
                                  : a <= b)
                            : a.includes(b);
        }),
    );
}
const selected = (r: any) =>
    Object.entries(selection).every(
        ([k, values]) =>
            !values.length ||
            values.includes(String(k === "machine" ? r.machineId : r[k])),
    );
const records = () => snapshot.records.map(enrich).filter((r) => matches(r));
function currentRows() {
    if (view === "machines")
        return snapshot.machines.map(enrich).filter((r) => matches(r, false));
    if (view === "plans")
        return snapshot.plans
            .map((p) => {
                const last = snapshot.records
                    .filter(
                        (r) =>
                            r.planId === p.id &&
                            r.date &&
                            r.date <= snapshot.today,
                    )
                    .map((r) => r.date)
                    .sort()
                    .pop();
                return enrich({ ...p, lastDate: last });
            })
            .filter((r) => matches(r, false));
    if (view === "due")
        return snapshot.due.map(enrich).filter((r) => matches(r, false));
    return records().filter(selected);
}
function filterControls() {
    const departments = [
        ...new Set(snapshot.machines.map((m) => m.department).filter(Boolean)),
    ].sort() as string[];
    $("departments").innerHTML = departments
        .map(
            (d) =>
                `<label><input type="checkbox" data-department="${esc(d)}" ${filters.departments.includes(d) ? "checked" : ""}>${esc(d)}</label>`,
        )
        .join("");
    $("machinesPicker").innerHTML =
        '<input type="search" id="machineSearch" placeholder="Cerca macchina" aria-label="Cerca macchina">' +
        snapshot.machines
            .filter(
                (m) =>
                    !filters.departments.length ||
                    filters.departments.includes(m.department),
            )
            .sort((a, b) =>
                a.code.localeCompare(b.code, "it", { numeric: true }),
            )
            .map(
                (m) =>
                    `<label><input type="checkbox" data-machine="${esc(m.id)}" ${filters.machines.includes(m.id) ? "checked" : ""}>${esc(m.code)} · ${esc(m.description)}</label>`,
            )
            .join("");
    $("departmentSummary").textContent = filters.departments.length
        ? String(filters.departments.length)
        : "Tutti";
    $("machineSummary").textContent = filters.machines.length
        ? String(filters.machines.length)
        : "Tutte";
    $<HTMLSelectElement>("kindFilter").value = filters.kind;
    $<HTMLInputElement>("dateFrom").value = filters.from;
    $<HTMLInputElement>("dateTo").value = filters.to;
    $<HTMLInputElement>("textFilter").value = filters.text;
    for (const id of ["kindFilter", "dateFrom", "dateTo"])
        $(id).toggleAttribute(
            "disabled",
            !["dashboard", "records"].includes(view),
        );
    renderStandardFilters();
    renderYearPicker();
    $("filterPreset").innerHTML =
        '<option value="">Preset filtri</option>' +
        preferences.filterPresets
            .map((p, i) => `<option value="${i}">${esc(p.name)}</option>`)
            .join("");
}
// Standard controls use the same rule model as custom conditions and existing presets.
function standardFields() {
    const keys = view === "machines"
        ? ["code", "description", "responsible", "year", "serial", "activeLabel"]
        : view === "plans"
          ? ["description", "frequencyMonths", "lastDate", "activeLabel"]
          : view === "due"
            ? ["description", "lastDate", "dueDate", "daysOverdue"]
            : ["description", "createdBy", "updatedBy", "notes", "attachmentCount"];
    return columns().filter(([key]) => keys.includes(key));
}
function renderStandardFilters() {
    $("standardFilterTitle").textContent = ({machines:"Scheda macchina",plans:"Programmazione",due:"Scadenze",records:"Esecuzione"}[view] || "Esecuzione");
    const custom = filters.rules.filter(r => !isYearRule(r));
    $("standardFilters").innerHTML = standardFields().map(([field, label, kind]) => {
        const op = kind === "number" || kind === "date" ? "range" : field === "activeLabel" ? "exact" : "contains";
        const index = custom.findIndex(r => r.field === field && r.op === op);
        const rule = index >= 0 ? custom.splice(index, 1)[0] : {value:"", to:""};
        const type = kind === "number" ? "number" : kind === "date" ? "date" : "text";
        const input = field === "activeLabel"
            ? `<select data-standard-value><option value="">Tutte</option>${["Sì", "No"].map(v => `<option ${rule.value === v ? "selected" : ""}>${v}</option>`).join("")}</select>`
            : `<div class="maintenance-filter-values"><input data-standard-value type="${type}" value="${esc(rule.value)}" aria-label="${esc(label)}${op === "range" ? " da" : ""}" placeholder="${op === "range" ? "Da" : "Contiene…"}">${op === "range" ? `<span>–</span><input data-standard-to type="${type}" value="${esc(rule.to)}" aria-label="${esc(label)} a" placeholder="A">` : ""}</div>`;
        return `<label class="maintenance-filter-field" data-standard-field="${field}" data-standard-op="${op}"><span>${esc(label)}</span>${input}</label>`;
    }).join("");
    $("advancedRules").innerHTML = custom.map(ruleHtml).join("");
    $<HTMLDetailsElement>("customFilters").open = custom.length > 0;
}
function readStandardRules(): Rule[] {
    return Array.from($("standardFilters").querySelectorAll<HTMLElement>("[data-standard-field]")).map(row => ({
        field:row.dataset.standardField!, op:row.dataset.standardOp!,
        value:row.querySelector<HTMLInputElement>("[data-standard-value]")!.value,
        to:row.querySelector<HTMLInputElement>("[data-standard-to]")?.value || "",
    })).filter(r => r.value || r.to);
}
function readAllRules() {
    const rules = [...yearRules(), ...readStandardRules(), ...readRules()];
    for (const r of rules) {
        if (r.op !== "range" || !r.value || !r.to) continue;
        const numeric = columns().find(c => c[0] === r.field)?.[2] === "number";
        if (numeric ? Number(r.value) > Number(r.to) : r.value > r.to)
            throw Error("Intervallo invertito nei filtri avanzati.");
    }
    if (rules.length > 30) throw Error("Massimo 30 condizioni.");
    return rules;
}
// Whole calendar-year ranges use the existing preset rule format, including older backends.
function isYearRule(rule:Rule) {
    return rule.field === 'date' && rule.op === 'range' && /^\d{4}-01-01$/.test(rule.value) && rule.to === rule.value.slice(0,4)+'-12-31';
}
const yearRules = () => filters.rules.filter(isYearRule);
function renderYearPicker() {
    const picker = $('maintenanceYears');
    picker.hidden = !['dashboard','records'].includes(view);
    const years = [...new Set<string>(snapshot.records.map(r => r.date?.slice(0,4)).filter(Boolean))].sort();
    picker.innerHTML = analysisYearPicker(years,yearRules().map(rule => rule.value.slice(0,4)));
}
function setYears(years:string[]) {
    const rules = [...filters.rules.filter(rule => !isYearRule(rule)), ...years.map(year => ({field:'date',op:'range',value:year+'-01-01',to:year+'-12-31'}))];
    if(rules.length > 30){message('Massimo 30 condizioni complessive nei filtri.',true);renderYearPicker();return;}
    filters.rules = rules;
    limit = 250;
    renderYearPicker();
    render();
}
$('maintenanceYears').addEventListener('change', () => {
    setYears([...$('maintenanceYears').querySelectorAll<HTMLInputElement>('[data-year]:checked')].map(input => input.dataset.year!));
});
$('maintenanceYears').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-years]');
    if(!button)return;
    const years = [...$('maintenanceYears').querySelectorAll<HTMLInputElement>('[data-year]')].map(input => input.dataset.year!);
    setYears(button.dataset.years === 'all' ? [] : years.slice(-2));
});
function ruleHtml(rule: Rule, index: number) {
    const kind = columns().find((c) => c[0] === rule.field)?.[2],
        type = kind === "date" ? "date" : kind === "number" ? "number" : "text";
    return `<div class="maintenance-rule" data-rule="${index}"><select data-field aria-label="Campo">${columns()
        .map(
            ([k, label]) =>
                `<option value="${k}" ${rule.field === k ? "selected" : ""}>${esc(label)}</option>`,
        )
        .join("")}</select><select data-op aria-label="Confronto">${[
        ["contains", "Contiene"],
        ["exact", "Uguale a"],
        ["prefix", "Inizia con"],
        ["range", "Da / a"],
        ["gte", "Maggiore o uguale"],
        ["lte", "Minore o uguale"],
        ["not", "Non contiene"],
        ["empty", "Mancante"],
    ]
        .map(
            ([k, label]) =>
                `<option value="${k}" ${rule.op === k ? "selected" : ""}>${label}</option>`,
        )
        .join(
            "",
        )}</select><input data-value type="${type}" value="${esc(rule.value)}" aria-label="Valore iniziale" ${rule.op === "empty" ? "hidden" : ""}><input data-to type="${type}" value="${esc(rule.to)}" aria-label="Valore finale" ${rule.op !== "range" ? "hidden" : ""}><button data-remove-rule="${index}" aria-label="Rimuovi condizione">×</button></div>`;
}
function readRules() {
    const rules = Array.from(
        $("advancedRules").querySelectorAll<HTMLElement>(".maintenance-rule"),
    ).map((row) => ({
        field: row.querySelector<HTMLSelectElement>("[data-field]")!.value,
        op: row.querySelector<HTMLSelectElement>("[data-op]")!.value,
        value: row.querySelector<HTMLInputElement>("[data-value]")!.value,
        to: row.querySelector<HTMLInputElement>("[data-to]")!.value,
    }));
    for (const r of rules) {
        const kind = columns().find((c) => c[0] === r.field)?.[2];
        if (
            r.op === "range" &&
            r.value &&
            r.to &&
            (kind === "number"
                ? Number(r.value) > Number(r.to)
                : r.value > r.to)
        )
            throw Error("Intervallo invertito nei filtri avanzati.");
    }
    return rules;
}
async function savePreferences() {
    await api("preferences-save", { value: preferences });
}
function pickColumns() {
    const available = columns();
    const keys =
        preferences.columns[view] ||
        available.slice(0, view === "machines" ? 6 : 9).map((c) => c[0]);
    return available.filter((c) => keys.includes(c[0]));
}
function renderTable() {
    tableRows = sortByCriteria(currentRows(), sort, (r, k) => r[k]);
    const cols = pickColumns(),
        table = $<HTMLTableElement>("maintenanceTable");
    $("tableTitle").textContent =
        {
            records: "Manutenzioni effettuate",
            machines: "Anagrafica macchine",
            plans: "Manutenzioni ordinarie previste",
        }[view] || "";
    $("newEntity").textContent =
        view === "machines"
            ? "+ Macchina"
            : view === "plans"
              ? "+ Manutenzione prevista"
              : "+ Manutenzione";
    $("columnPicker").innerHTML = columns()
        .map(
            ([k, label]) =>
                `<label><input type="checkbox" data-column="${k}" ${cols.some((c) => c[0] === k) ? "checked" : ""}>${esc(label)}</label>`,
        )
        .join("");
    table.querySelector("thead")!.innerHTML =
        "<tr>" +
        cols
            .map(
                (c) =>
                    `<th class="${c[2] === "number" ? "numeric" : ""}">${esc(c[1])}</th>`,
            )
            .join("") +
        "</tr>";
    const kind =
        view === "machines" ? "machine" : view === "plans" ? "plan" : "record";
    table.querySelector("tbody")!.innerHTML =
        tableRows
            .slice(0, limit)
            .map(
                (r) =>
                    `<tr data-entity-id="${esc(r.id)}" data-entity-kind="${kind}" tabindex="0">${cols.map(([k, , type], i) => `<td class="${type === "number" ? "numeric" : ""}" title="${esc(r[k])}">${i === 0 ? `<button class="maintenance-link" data-edit="${esc(r.id)}" data-kind="${kind}">${esc(type === "date" ? date(r[k]) : (r[k] ?? "—"))}</button>` : esc(type === "date" ? date(r[k]) : type === "number" && r[k] != null ? num(r[k]) : (r[k] ?? "—"))}</td>`).join("")}</tr>`,
            )
            .join("") ||
        `<tr><td colspan="${cols.length}">Nessun risultato.</td></tr>`;
    bindSortingHeaders(
        table,
        [
            ...cols.map(([key, label]) => ({ key, label })),
        ],
        sort,
        (next) => {
            sort = next.filter((s) => s.key !== "actions");
            renderTable();
        },
    );
    updateSortingBar(
        table,
        cols.map(([key, label]) => ({ key, label })),
        sort,
        (next) => {
            sort = next;
            renderTable();
        },
    );
    $("tableCount").textContent =
        `${num(Math.min(limit, tableRows.length))} di ${num(tableRows.length)} righe`;
    $("more").hidden = limit >= tableRows.length;
}
function renderDue() {
    const due = currentRows(),
        allMachines = snapshot.machines
            .filter(
                (m) =>
                    m.active !== false &&
                    (!filters.departments.length ||
                        filters.departments.includes(m.department)) &&
                    (!filters.machines.length ||
                        filters.machines.includes(m.id)),
            )
            .sort((a, b) =>
                a.code.localeCompare(b.code, "it", { numeric: true }),
            );
    const departments = [
        ...new Set(allMachines.map((m) => m.department || "Senza reparto")),
    ];
    $("dueGroups").innerHTML =
        departments
            .map(
                (d) =>
                    `<section class="maintenance-department"><h3>${esc(d)}</h3>${allMachines
                        .filter((m) => (m.department || "Senza reparto") === d)
                        .map((m) => {
                            const pending = due.filter(
                                (r) => r.machineId === m.id,
                            );
                            return `<details class="maintenance-machine-group" data-due-machine="${esc(m.id)}"><summary>${esc(m.code)} · ${esc(m.description)}<span>${pending.length ? num(pending.length) + " scadute" : "Nessuna scaduta"}</span></summary><div class="table-scroll"><table><thead><tr><th>Manutenzione</th><th>Ultima esecuzione</th><th>Scadenza</th><th>Giorni di ritardo</th><th>Azioni</th></tr></thead><tbody>${pending.map((r) => `<tr data-due-plan="${esc(r.planId)}"><td>${esc(r.description)}</td><td>${date(r.lastDate)}</td><td>${date(r.dueDate)}</td><td class="numeric">${num(r.daysOverdue)}</td><td><button data-new-plan-record="${esc(r.planId)}">Inserisci manutenzione</button></td></tr>`).join("") || '<tr><td colspan="5">Nessuna manutenzione scaduta.</td></tr>'}</tbody></table></div></details>`;
                        })
                        .join("")}</section>`,
            )
            .join("") || "<p>Nessuna macchina corrisponde ai filtri.</p>";
}
function chartSelection(
    dimension: string,
    values: string[],
    multiple: boolean,
) {
    selection[dimension] = mergeAreaSelection(
        selection[dimension],
        values,
        multiple,
    );
    render();
}
const chartSources = [
    {
        id: "maintenance-machines",
        title: "Manutenzioni per macchina",
        dimension: "machine",
    },
    {
        id: "maintenance-months",
        title: "Storico mensile degli interventi",
        dimension: "month",
    },
    {
        id: "maintenance-departments",
        title: "Interventi per reparto",
        dimension: "department",
    },
    {
        id: "maintenance-kinds",
        title: "Ordinarie e straordinarie",
        dimension: "kind",
    },
];
function chartConfig(
    sourceId: string,
    type: any,
    cap = sourceId === "maintenance-months" ? 240 : 24,
) {
    const source =
            chartSources.find((s) => s.id === sourceId) || chartSources[0],
        base = records(),
        dimension = source.dimension,
        key = (r: any) =>
            String(dimension === "machine" ? r.machineId : r[dimension]),
        all = [...new Set<string>(base.map(key))].filter(Boolean);
    if (dimension === "month" && all.length) {
        all.sort();
        const end = all[all.length - 1],
            start = all[0];
        all.length = 0;
        let cursor = start;
        while (cursor <= end && all.length < 1200) {
            all.push(cursor);
            const [year, month] = cursor.split("-").map(Number);
            cursor = new Date(Date.UTC(year, month, 1))
                .toISOString()
                .slice(0, 7);
        }
    }
    const keys =
        dimension === "month"
            ? all.slice(-cap)
            : all
                  .sort(
                      (a, b) =>
                          base.filter((r) => key(r) === b).length -
                          base.filter((r) => key(r) === a).length,
                  )
                  .slice(0, cap);
    const label = (v: string) =>
        dimension === "machine"
            ? machine(v)?.code || v
            : dimension === "kind"
              ? v === "ordinary"
                  ? "Ordinarie"
                  : "Straordinarie"
              : v;
    const active = Object.values(selection).some((v) => v.length),
        ink =
            getComputedStyle(document.body)
                .getPropertyValue("--ops-accent")
                .trim() || "#168eea",
        colors = [ink, "#438f88"];
    const datasets =
        type === "doughnut"
            ? [
                  {
                      label: "Interventi",
                      data: keys.map(
                          (k) => base.filter((r) => key(r) === k).length,
                      ),
                      backgroundColor: keys.map((_, i) =>
                          active ? colors[i % 2] + "40" : colors[i % 2],
                      ),
                      highlightValues: active
                          ? keys.map(
                                (k) =>
                                    base.filter(
                                        (r) => key(r) === k && selected(r),
                                    ).length,
                            )
                          : undefined,
                      highlightColors: keys.map((_, i) => colors[i % 2]),
                  },
              ]
            : ["ordinary", "extraordinary"].map((kind, i) => ({
                  label: kind === "ordinary" ? "Ordinarie" : "Straordinarie",
                  data: keys.map(
                      (k) =>
                          base.filter((r) => key(r) === k && r.kind === kind)
                              .length,
                  ),
                  borderColor: colors[i],
                  backgroundColor: active ? colors[i] + "40" : colors[i],
                  highlightColor: colors[i],
                  highlightValues: active
                      ? keys.map(
                            (k) =>
                                base.filter(
                                    (r) =>
                                        key(r) === k &&
                                        r.kind === kind &&
                                        selected(r),
                                ).length,
                        )
                      : undefined,
                  tension: 0.15,
                  pointRadius: 3,
              }));
    if (type === "line" && active) {
        for (const dataset of [...datasets] as any[]) {
            dataset.borderColor = dataset.highlightColor + "50";
            (datasets as any[]).push({
                ...dataset,
                label: "Selezione · " + dataset.label,
                data: dataset.highlightValues,
                borderColor: dataset.highlightColor,
                backgroundColor: dataset.highlightColor,
                highlightValues: undefined,
                highlightSeries: true,
            });
        }
    }
    return {
        type,
        data: { labels: keys.map(label), datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        filter: (item: any, data: any) =>
                            !data.datasets[item.datasetIndex]?.highlightSeries,
                    },
                },
            },
            ...(type !== "doughnut"
                ? {
                      scales: {
                          y: { beginAtZero: true, ticks: { precision: 0 } },
                      },
                  }
                : {}),
            onClick: (event: any, elements: any[]) => {
                if (elements.length)
                    chartSelection(
                        dimension,
                        [keys[elements[0].index]],
                        !!(event.native?.ctrlKey || event.native?.metaKey),
                    );
            },
            onAreaSelect: (indices: number[], multiple: boolean) =>
                chartSelection(
                    dimension,
                    indices.map((i) => keys[i]).filter(Boolean),
                    multiple,
                ),
        },
    } as any;
}
function renderCharts() {
    for (const c of charts) c.destroy();
    charts = [];
    for (const s of chartSources) {
        const canvas = $<HTMLCanvasElement>(s.id);
        charts.push(
            new Chart(
                canvas,
                chartConfig(
                    s.id,
                    s.dimension === "month"
                        ? "line"
                        : s.dimension === "kind"
                          ? "doughnut"
                          : "bar",
                ),
            ),
        );
    }
    workspace?.sync();
}
function render() {
    const subset = records().filter(selected),
        ordinary = subset.filter((r) => r.kind === "ordinary").length;
    $("kpis").innerHTML = [
        ["Ordinarie", ordinary],
        ["Straordinarie", subset.length - ordinary],
        [
            "Macchine nel perimetro",
            new Set(subset.map((r) => r.machineId)).size,
        ],
        [
            "Manutenzioni scadute",
            snapshot.due
                .filter(
                    (d) =>
                        !filters.departments.length ||
                        filters.departments.includes(
                            machine(d.machineId)?.department,
                        ),
                )
                .filter(
                    (d) =>
                        !filters.machines.length ||
                        filters.machines.includes(d.machineId),
                ).length,
        ],
    ]
        .map(
            ([label, value]) =>
                `<div><small>${label}</small><strong>${num(value)}</strong></div>`,
        )
        .join("");
    $("dueBadge").textContent = String(snapshot.due.length);
    $("selectionSummary").textContent = Object.entries(selection)
        .filter(([, v]) => v.length)
        .map(
            ([k, v]) =>
                `${{ machine: "Macchine", month: "Mesi", department: "Reparti", kind: "Tipi" }[k]}: ${v.map((x) => (k === "machine" ? machine(x)?.code || x : x)).join(", ")}`,
        )
        .join(" · ");
    $("dashboard").hidden = view !== "dashboard";
    $("tablePanel").hidden = !["records", "machines", "plans"].includes(view);
    $("duePanel").hidden = view !== "due";
    $("infoPanel").hidden = view !== "info";
    $("filters").hidden = view === "info";
    $("kpis").hidden = view === "info";
    document
        .querySelectorAll<HTMLButtonElement>("[data-view]")
        .forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    if (view === "dashboard") renderCharts();
    else if (view === "due") renderDue();
    else if (view !== "info") renderTable();
    $<HTMLButtonElement>("export").disabled = view === "info";
    if (view === "info") {
        const info = snapshot.importInfo;
        $("importInfo").textContent = info
            ? `Importato il ${date(info.importedAt)} da ${info.actor}: ${info.machines} macchine, ${info.plans} manutenzioni previste, ${info.ordinary} ordinarie, ${info.extraordinary} straordinarie, ${info.attachments} allegati. Fonte: ${info.source}`
            : "Archivio manutenzioni in attesa della migrazione automatica sul backend.";
        $("issues").innerHTML =
            `<h3>Verifiche dati (${snapshot.issues.length})</h3><ul>${snapshot.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul><p>${snapshot.plans.filter((p) => p.frequencyMonths == null).length} manutenzioni previste senza frequenza: non generano avvisi.</p>`;
    }
}
async function load() {
    if (busy) return;
    busy = true;
    $<HTMLButtonElement>("refresh").disabled = true;
    message("Aggiornamento manutenzioni…");
    try {
        snapshot = await api("snapshot");
        filterControls();
        render();
        message();
    } catch (e) {
        message((e as Error).message, true);
    } finally {
        busy = false;
        $<HTMLButtonElement>("refresh").disabled = false;
    }
}
function input(
    name: string,
    label: string,
    value: any,
    type = "text",
    required = false,
    full = false,
) {
    return `<label class="${full ? "full" : ""}">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? "required" : ""} ${type === "date" ? `max="${snapshot.today}"` : ""}></label>`;
}
function select(
    name: string,
    label: string,
    options: any[],
    value: any,
    required = false,
) {
    return `<label>${esc(label)}<select name="${name}" ${required ? "required" : ""}><option value="">Seleziona…</option>${options.map((o) => `<option value="${esc(o.id)}" ${String(value) === String(o.id) ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>`;
}
function attachmentList() {
    const host = $("editAttachments");
    if (!host) return;
    host.innerHTML = editAttachments
        .map(
            (a, i) =>
                `<div>${a.id ? `<button type="button" data-attachment="${esc(a.id)}" class="maintenance-link">${esc(a.name)}</button>` : `<span>${esc(a.name)}</span>`}<button type="button" data-remove-attachment="${i}" aria-label="Rimuovi allegato ${esc(a.name)}">×</button></div>`,
        )
        .join("");
}
function machineOptions(department = "") {
    return snapshot.machines
        .filter(
            (m) =>
                (m.active !== false || m.id === editEntity?.machineId) &&
                (!department || m.department === department),
        )
        .map((m) => ({ id: m.id, label: m.code + " · " + m.description }));
}
function planOptions(id: string) {
    return snapshot.plans
        .filter(
            (p) =>
                p.machineId === id &&
                (p.active !== false || p.id === editEntity?.planId),
        )
        .map((p) => ({ id: p.id, label: p.description }));
}
function openEditor(kind: string, entity: any = null, prefill: any = {}) {
    workspace?.closeFocus();
    returnFocus = document.activeElement as HTMLElement;
    editKind = kind;
    editEntity = entity;
    const value = { ...(entity || {}), ...prefill };
    $("editTitle").textContent =
        (entity ? "Modifica " : "Nuova ") +
        {
            machine: "macchina",
            plan: "manutenzione prevista",
            record: "manutenzione",
        }[kind];
    const departments = [
        ...new Set([
            ...snapshot.machines.map((m) => m.department),
            ...(snapshot.importInfo?.departments || []),
        ]),
    ].filter(Boolean);
    if (kind === "machine") {
        const types = [
            ...new Set([
                ...(snapshot.importInfo?.equipmentTypes || []),
                ...snapshot.machines.flatMap((m) => m.equipmentTypes || []),
            ]),
        ];
        $("editFields").innerHTML =
            input("code", "Codice interno", value.code || "", "text", true) +
            `<label>Reparto<input name="department" list="departmentOptions" value="${esc(value.department)}" required><datalist id="departmentOptions">${departments.map((d) => `<option value="${esc(d)}">`).join("")}</datalist></label>` +
            input(
                "description",
                "Identificativo macchina",
                value.description || "",
                "text",
                true,
                true,
            ) +
            input("year", "Anno di costruzione", value.year || "", "number") +
            input(
                "responsible",
                "Responsabile incaricato",
                value.responsible || "",
            ) +
            input("serial", "Matricola", value.serial || "") +
            input(
                "robotSerial",
                "Matricola robot/forno",
                value.robotSerial || "",
            ) +
            input(
                "islandSerial",
                "Matricola isola robotizzata",
                value.islandSerial || "",
            ) +
            input(
                "conformity",
                "Dichiarazione di conformità",
                value.conformity || "",
            ) +
            input(
                "robotConformity",
                "Conformità robot",
                value.robotConformity || "",
            ) +
            `<label>Tipi di attrezzatura<select name="equipmentTypes" multiple>${types.map((t) => `<option ${value.equipmentTypes?.includes(t) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
    } else {
        $("editFields").innerHTML =
            select(
                "department",
                "Reparto",
                departments.map((d) => ({ id: d, label: d })),
                machine(value.machineId)?.department || "",
            ) +
            select(
                "machineId",
                "Macchina",
                machineOptions(),
                value.machineId,
                true,
            );
        if (kind === "plan")
            $("editFields").innerHTML +=
                input(
                    "description",
                    "Manutenzione ordinaria prevista",
                    value.description || "",
                    "text",
                    true,
                    true,
                ) +
                input(
                    "frequencyMonths",
                    "Frequenza in mesi (vuoto = nessun avviso)",
                    value.frequencyMonths ?? "",
                    "number",
                );
        else {
            $("editFields").innerHTML +=
                select(
                    "kind",
                    "Tipo",
                    [
                        { id: "ordinary", label: "Ordinaria" },
                        { id: "extraordinary", label: "Straordinaria" },
                    ],
                    value.kind || "ordinary",
                    true,
                ) +
                input(
                    "date",
                    "Data di esecuzione",
                    value.date || snapshot.today,
                    "date",
                    true,
                ) +
                `<div id="ordinaryFields" class="full">${select("planId", "Manutenzione ordinaria", planOptions(value.machineId), value.planId, true)}</div><label id="extraordinaryFields" class="full">Intervento<textarea name="description">${esc(value.description)}</textarea></label><label class="full">Note<textarea name="notes">${esc(value.notes)}</textarea></label><div class="full"><button type="button" id="addAttachments">+ Allegati di rete</button><div id="editAttachments"></div></div><p class="full">Registrazione a nome di <strong>${esc(actor)}</strong></p>`;
            editAttachments = entity
                ? snapshot.attachments
                      .filter((a) => a.recordId === entity.id)
                      .map((a) => ({ ...a }))
                : [];
            attachmentList();
            recordKindVisibility();
        }
    }
    if (kind !== "record")
        $("editFields").insertAdjacentHTML(
            "beforeend",
            `<label class="check-label"><input name="active" type="checkbox" ${value.active !== false ? "checked" : ""}>${kind === "machine" ? "Macchina attiva" : "Manutenzione attiva"}</label>`,
        );
    $("editError").textContent = "";
    $("deleteEntity").hidden = !entity;
    $<HTMLButtonElement>("saveEntity").disabled = false;
    $<HTMLDialogElement>("editDialog").showModal();
}
function recordKindVisibility() {
    const ordinary =
        $("editFields").querySelector<HTMLSelectElement>("[name=kind]")
            ?.value !== "extraordinary";
    $("ordinaryFields").hidden = !ordinary;
    $("extraordinaryFields").hidden = ordinary;
    $("ordinaryFields").querySelector("select")!.required = ordinary;
    $("extraordinaryFields").querySelector("textarea")!.required = !ordinary;
}
function newOrdinary(planId: string) {
    const p = plan(planId);
    if (p)
        openEditor("record", null, {
            machineId: p.machineId,
            planId: p.id,
            kind: "ordinary",
        });
}
async function loginEmployees() {
    try {
        const r = await ipc.invoke("maintenance-employees");
        if (!r.ok) throw Error(r.error);
        groups = r.groups;
        $("loginDepartment").innerHTML = Object.keys(groups)
            .sort()
            .map((d) => `<option>${esc(d)}</option>`)
            .join("");
        employeeChoices();
        $("loginError").textContent = "";
    } catch (e) {
        $("loginError").textContent = (e as Error).message;
    }
}
function employeeChoices() {
    const names = groups[$<HTMLSelectElement>("loginDepartment").value] || [];
    $("loginEmployee").innerHTML =
        '<option value="">Seleziona dipendente</option>' +
        names.map((n) => `<option>${esc(n)}</option>`).join("");
}
$("loginDepartment").onchange = employeeChoices;
$("loginRetry").onclick = () => void loginEmployees();
$("loginClose").onclick = () => ipc.send("maintenance-close");
$("loginDialog").addEventListener("cancel", (e) => {
    e.preventDefault();
    ipc.send("maintenance-close");
});
$("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    $<HTMLButtonElement>("loginSubmit").disabled = true;
    try {
        const result = await ipc.invoke(
            "maintenance-login",
            $<HTMLSelectElement>("loginEmployee").value,
        );
        if (!result.ok) throw Error(result.error);
        actor = result.actor;
        snapshot = result;
        const pref = await api("preferences-get");
        if (pref.preferences) {
            preferences = { ...preferences, ...pref.preferences };
            if (!Array.isArray(preferences.filterPresets))
                preferences.filterPresets = [];
            if (!preferences.columns || typeof preferences.columns !== "object")
                preferences.columns = {};
        }
        $("operator").textContent = actor;
        $<HTMLDialogElement>("loginDialog").close();
        $("workspace").hidden = false;
        for (const id of ["operator", "refresh", "newRecord", "export"])
            $(id).removeAttribute("disabled");
        workspace = installAnalysisWorkspace({
            key: "maintenance",
            actions: $("headerActions"),
            container: () => $("dashboard"),
            sources: chartSources.map(({ id, title }) => ({ id, title })),
            reset: () => {
                selection = {
                    machine: [],
                    month: [],
                    department: [],
                    kind: [],
                };
                render();
            },
            build: (spec) => chartConfig(spec.source, spec.kind, spec.limit),
            revision: () => JSON.stringify([selection, filters]),
            persistence: {
                load: async () => ({
                    ok: true,
                    preferences: preferences.workspace || emptyWorkspace(),
                }),
                save: async (value) => {
                    preferences.workspace = value;
                    await savePreferences();
                    return { ok: true, preferences: value };
                },
            },
        });
        filterControls();
        if (!snapshot.machines.length) view = "info";
        render();
    } catch (e) {
        $("loginError").textContent = (e as Error).message;
    } finally {
        $<HTMLButtonElement>("loginSubmit").disabled = false;
    }
};
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(
    (b) =>
        (b.onclick = () => {
            workspace?.closeFocus();
            view = b.dataset.view!;
            limit = 250;
            sort = [{key:view === "machines" ? "code" : "machineCode", direction:"asc"}];
            filters.rules = ['dashboard','records'].includes(view) ? yearRules() : [];
            filterControls();
            render();
        }),
);
$("operator").onclick = () => {
    ipc.send("maintenance-logout");
    location.reload();
};
$("close").onclick = () => ipc.send("maintenance-close");
$("refresh").onclick = () => void load();
$("newRecord").onclick = () => openEditor("record");
$("newEntity").onclick = () =>
    openEditor(
        view === "machines" ? "machine" : view === "plans" ? "plan" : "record",
    );
$("more").onclick = () => {
    limit += 250;
    renderTable();
};
$("filters").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.closest(".advanced-filters")) return;
    if (input.dataset.department != null) {
        filters.departments = Array.from(
            $("departments").querySelectorAll<HTMLInputElement>(
                "input:checked",
            ),
        ).map((c) => c.dataset.department!);
        filters.machines = filters.machines.filter(
            (id) =>
                !filters.departments.length ||
                filters.departments.includes(machine(id)?.department),
        );
        filterControls();
    }
    if (input.dataset.machine != null)
        filters.machines = Array.from(
            $("machinesPicker").querySelectorAll<HTMLInputElement>(
                "input:checked",
            ),
        ).map((c) => c.dataset.machine!);
    filters.kind = $<HTMLSelectElement>("kindFilter").value;
    filters.from = $<HTMLInputElement>("dateFrom").value;
    filters.to = $<HTMLInputElement>("dateTo").value;
    filters.text = $<HTMLInputElement>("textFilter").value;
    if (filters.from && filters.to && filters.from > filters.to) {
        message("L’intervallo di date è invertito.", true);
        return;
    }
    limit = 250;
    render();
    message();
});
$("machinesPicker").addEventListener("input", (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id === "machineSearch")
        $("machinesPicker")
            .querySelectorAll<HTMLElement>("label")
            .forEach(
                (label) =>
                    (label.hidden = !label
                        .textContent!.toLocaleLowerCase("it")
                        .includes(input.value.toLocaleLowerCase("it"))),
            );
});
$("textFilter").addEventListener("input", () => {
    filters.text = $<HTMLInputElement>("textFilter").value;
    limit = 250;
    render();
});
$("resetFilters").onclick = () => {
    filters = emptyFilters();
    selection = { machine: [], month: [], department: [], kind: [] };
    filterControls();
    render();
    message();
};
$("addRule").onclick = () => {
    const rules = readRules();
    if (rules.length >= 30) {
        message("Massimo 30 condizioni.", true);
        return;
    }
    rules.push({ field: columns()[0][0], op: "contains", value: "", to: "" });
    $<HTMLDetailsElement>("customFilters").open = true;
    $("advancedRules").innerHTML = rules.map(ruleHtml).join("");
};
$("applyRules").onclick = () => {
    try {
        filters.rules = readAllRules();
        limit = 250;
        render();
        message();
    } catch (e) {
        message((e as Error).message, true);
    }
};
$("advancedRules").addEventListener("change", (e) => {
    const target = e.target as HTMLSelectElement;
    if (!target.matches("[data-field],[data-op]")) return;
    try {
        const rules = readRules();
        $("advancedRules").innerHTML = rules.map(ruleHtml).join("");
    } catch (error) {
        message((error as Error).message, true);
    }
});
$("advancedRules").onclick = (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-remove-rule]",
    );
    if (button) {
        const custom = readRules().filter((_, i) => i !== Number(button.dataset.removeRule));
        filters.rules = [...yearRules(), ...readStandardRules(), ...custom];
        $("advancedRules").innerHTML = custom.map(ruleHtml).join("");
        render();
    }
};
$("saveFilterPreset").onclick = async () => {
    try {
        const name = $<HTMLInputElement>("filterPresetName").value.trim();
        if (
            !name ||
            name.length > 60 ||
            preferences.filterPresets.length >= 10 ||
            preferences.filterPresets.some(
                (p) =>
                    p.name.toLocaleLowerCase("it") ===
                    name.toLocaleLowerCase("it"),
            )
        )
            throw Error("Inserisci un nome univoco; massimo dieci preset.");
        filters.rules = readAllRules();
        preferences.filterPresets.push({
            name,
            view,
            filters: JSON.parse(JSON.stringify(filters)),
        });
        await savePreferences();
        filterControls();
        message();
    } catch (e) {
        message((e as Error).message, true);
    }
};
$("filterPreset").onchange = () => {
    const value = $<HTMLSelectElement>("filterPreset").value;
    if (value === "") return;
    const p = preferences.filterPresets[Number(value)];
    filters = { ...emptyFilters(), ...p.filters };
    view = p.view;
    sort = [{key:view === "machines" ? "code" : "machineCode", direction:"asc"}];
    limit = 250;
    filterControls();
    render();
};
$("deleteFilterPreset").onclick = async () => {
    const value = $<HTMLSelectElement>("filterPreset").value;
    if (value === "") return;
    preferences.filterPresets.splice(Number(value), 1);
    try {
        await savePreferences();
        filterControls();
    } catch (e) {
        message((e as Error).message, true);
    }
};
$("columnPicker").onchange = async () => {
    const keys = Array.from(
        $("columnPicker").querySelectorAll<HTMLInputElement>("input:checked"),
    ).map((i) => i.dataset.column!);
    if (!keys.length) {
        message("Mantieni almeno una colonna visibile.", true);
        renderTable();
        return;
    }
    preferences.columns[view] = keys;
    renderTable();
    try {
        await savePreferences();
    } catch (e) {
        message((e as Error).message, true);
    }
};
document.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement,
        edit = target.closest<HTMLButtonElement>("[data-edit]"),
        add = target.closest<HTMLButtonElement>("[data-new-plan-record]"),
        attachment = target.closest<HTMLButtonElement>("[data-attachment]");
    if (edit) {
        const list =
            edit.dataset.kind === "machine"
                ? snapshot.machines
                : edit.dataset.kind === "plan"
                  ? snapshot.plans
                  : snapshot.records;
        openEditor(
            edit.dataset.kind!,
            list.find((r) => r.id === edit.dataset.edit),
        );
    }
    if (add) newOrdinary(add.dataset.newPlanRecord!);
    if (attachment) {
        const result = await ipc.invoke(
            "maintenance-open-attachment",
            attachment.dataset.attachment,
        );
        if (!result.ok) {
            if ($<HTMLDialogElement>("editDialog").open)
                $("editError").textContent = result.error;
            else message(result.error, true);
        }
    }
    if (target.dataset.removeAttachment != null) {
        editAttachments.splice(Number(target.dataset.removeAttachment), 1);
        attachmentList();
    }
    if (target.id === "addAttachments") {
        const r = await ipc.invoke("maintenance-pick-attachments");
        if (r.ok) {
            editAttachments.push(...r.attachments);
            attachmentList();
        } else
            $("editError").textContent = r.error || "Selezione non riuscita.";
    }
});
$("editFields").onchange = (e) => {
    const target = e.target as HTMLSelectElement;
    if (target.name === "department" && editKind !== "machine") {
        const select =
            $("editFields").querySelector<HTMLSelectElement>(
                "[name=machineId]",
            )!;
        select.innerHTML =
            '<option value="">Seleziona…</option>' +
            machineOptions(target.value)
                .map(
                    (o) =>
                        `<option value="${esc(o.id)}">${esc(o.label)}</option>`,
                )
                .join("");
        if (editKind === "record")
            select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (target.name === "kind") recordKindVisibility();
    if (target.name === "machineId" && editKind === "record") {
        $("ordinaryFields").innerHTML = select(
            "planId",
            "Manutenzione ordinaria",
            planOptions(target.value),
            "",
            true,
        );
        recordKindVisibility();
    }
};
const closeEditor = () => $<HTMLDialogElement>("editDialog").close();
$("editClose").onclick = closeEditor;
$("editCancel").onclick = closeEditor;
$("editDialog").addEventListener(
    "close",
    () => returnFocus?.isConnected && returnFocus.focus(),
);
$("editForm").onsubmit = async (e) => {
    e.preventDefault();
    $<HTMLButtonElement>("saveEntity").disabled = true;
    try {
        const form = new FormData($<HTMLFormElement>("editForm")),
            value: any = {
                id: editEntity?.id,
                revision: editEntity?.revision ?? 0,
            };
        for (const [key, v] of form) value[key] = String(v);
        delete value.department;
        if (editKind === "machine") {
            value.department = String(form.get("department"));
            value.year = form.get("year") ? Number(form.get("year")) : null;
            value.equipmentTypes = Array.from(
                $("editFields").querySelector<HTMLSelectElement>(
                    "[name=equipmentTypes]",
                )!.selectedOptions,
            ).map((o) => o.value);
        }
        if (editKind === "plan")
            value.frequencyMonths = form.get("frequencyMonths")
                ? Number(form.get("frequencyMonths"))
                : null;
        if (editKind !== "record") value.active = form.get("active") === "on";
        else
            value.attachments = editAttachments.map((a) =>
                a.id ? { id: a.id } : { name: a.name, path: a.path },
            );
        await api("save", { kind: editKind, entity: value });
        closeEditor();
        await load();
    } catch (e) {
        $("editError").textContent = (e as Error).message;
    } finally {
        $<HTMLButtonElement>("saveEntity").disabled = false;
    }
};
$("deleteEntity").onclick = () =>
    $<HTMLDialogElement>("confirmDialog").showModal();
$("maintenanceTable").addEventListener("contextmenu", async event => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-entity-id]");
    if (!row) return;
    event.preventDefault();
    const result = await ipc.invoke("maintenance-row-menu", {kind:row.dataset.entityKind, id:row.dataset.entityId});
    if (!result.ok) message(result.error, true);
});
ipc.on("maintenance-row-action", (_event:any, payload:any) => {
    const collection = {machine:"machines", plan:"plans", record:"records"}[payload.kind];
    const entity = collection && snapshot[collection].find((item:any) => item.id === payload.id);
    if (!entity) return;
    if (payload.action === "record" && payload.kind === "plan") return newOrdinary(entity.id);
    openEditor(payload.kind, entity);
    if (payload.action === "delete") $<HTMLDialogElement>("confirmDialog").showModal();
});
$("confirmDialog").addEventListener("close", async () => {
    if ($<HTMLDialogElement>("confirmDialog").returnValue !== "delete") return;
    try {
        await api("delete", {
            kind: editKind,
            entity: { id: editEntity.id, revision: editEntity.revision },
        });
        closeEditor();
        await load();
    } catch (e) {
        $("editError").textContent = (e as Error).message;
    }
});
$("dueGroups").addEventListener("contextmenu", async (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-due-plan]",
    );
    if (!row) return;
    e.preventDefault();
    const r = await ipc.invoke("maintenance-context-menu", row.dataset.duePlan);
    if (!r.ok) message(r.error, true);
});
ipc.on("maintenance-new-ordinary", (_e: any, payload: any) =>
    newOrdinary(payload.planId),
);
$("export").onclick = async () => {
    const target = view === "dashboard" ? "records" : view,
        rows = currentRows();
    $<HTMLButtonElement>("export").disabled = true;
    try {
        const r = await ipc.invoke("maintenance-export", {
            view: target,
            ids: rows.map((r) => r.id),
        });
        if (!r.ok) throw Error(r.error);
        if (!r.canceled) message(`${num(r.count)} righe esportate in Excel.`);
    } catch (e) {
        message((e as Error).message, true);
    } finally {
        $<HTMLButtonElement>("export").disabled = false;
    }
};
let accessComparison:any=null,accessApplying=false;
const accessKind=(kind:string)=>({machine:'Macchina',plan:'Manutenzione prevista',record:'Intervento',attachment:'Allegato'})[kind]||kind;
function accessValue(field:string,value:any){if(value==null||value==='')return '—';if(field==='machineId')return machine(value)?.code||String(value);if(field==='planId')return plan(value)?.description||String(value);if(field==='date')return date(value);return Array.isArray(value)?value.join(' · '):String(value)}
function showAccessComparison(comparison:any){
    accessComparison=comparison;
    const labels={machines:'Macchine',plans:'Manutenzioni previste',ordinary:'Ordinarie',extraordinary:'Straordinarie',attachments:'Allegati'};
    $("accessImportSummary").innerHTML=Object.entries(labels).map(([k,label])=>`<span>${label} da aggiungere: <strong>${num(comparison.added[k])}</strong></span>`).join('')+`<span>Invariate: ${num(comparison.unchanged)}</span><span>Con differenze: ${num(comparison.changed.length)}</span><span>Anomalie escluse: ${num(comparison.excludedAnomalies)}</span>`;
    const fieldLabels=Object.fromEntries(Object.values(fields).flat().map(([key,label])=>[key,label]));
    const lines=[...comparison.addedItems.map(item=>`<tr><td>Da aggiungere</td><td>${esc(accessKind(item.kind))}</td><td>${esc(item.label)}</td><td>—</td><td>Nuova voce</td><td>Assente</td></tr>`),...comparison.changed.flatMap(item=>item.fields.map(f=>`<tr><td>AyPi mantenuto</td><td>${esc(accessKind(item.kind))}</td><td>${esc(item.label)}</td><td>${esc(fieldLabels[f.field]||f.field)}</td><td>${esc(accessValue(f.field,f.access))}</td><td>${esc(accessValue(f.field,f.aypi))}</td></tr>`)),...comparison.skipped.map(item=>`<tr><td>Non importata</td><td>${esc(accessKind(item.kind))}</td><td>${esc(item.label)}</td><td colspan="3">${esc(item.reason)}</td></tr>`)];
    $("accessImportDetails").innerHTML=`<table><thead><tr><th>Esito</th><th>Tipo</th><th>Voce</th><th>Campo</th><th>Access</th><th>AyPi</th></tr></thead><tbody>${lines.join('')||'<tr><td colspan="6">Nessuna differenza: l’archivio AyPi contiene già tutte le voci valide di Access.</td></tr>'}</tbody></table>`;
    $("accessImportError").textContent='';$<HTMLButtonElement>("accessImportApply").disabled=false;$("accessImportApply").textContent=Object.values(comparison.added).some((v:any)=>v>0)?'Aggiungi mancanti':'Conferma confronto';$<HTMLDialogElement>("accessImportDialog").showModal();
}
$("importAccess").onclick=async()=>{
    if(busy)return;busy=true;$<HTMLButtonElement>("importAccess").disabled=true;message('Lettura Access e confronto con AyPi…');
    try{const result=await ipc.invoke('maintenance-import',{phase:'preview'});if(!result.ok)throw Error(result.error);showAccessComparison(result.comparison);message()}
    catch(error){message((error as Error).message,true)}finally{busy=false;$<HTMLButtonElement>("importAccess").disabled=false}
};
const closeAccessComparison=()=>{if(!accessApplying)$<HTMLDialogElement>("accessImportDialog").close()};
$("accessImportClose").onclick=closeAccessComparison;$("accessImportCancel").onclick=closeAccessComparison;
$("accessImportDialog").addEventListener('cancel',event=>{if(accessApplying)event.preventDefault()});
$("accessImportDialog").addEventListener('close',()=>{if(accessComparison){void ipc.invoke('maintenance-import',{phase:'cancel',token:accessComparison.token});accessComparison=null}$("importAccess").focus()});
$("accessImportApply").onclick=async()=>{
    if(!accessComparison||accessApplying)return;accessApplying=true;$<HTMLButtonElement>("accessImportApply").disabled=true;
    try{const result=await ipc.invoke('maintenance-import',{phase:'apply',token:accessComparison.token});if(!result.ok)throw Error(result.error);accessComparison=null;$<HTMLDialogElement>("accessImportDialog").close();await load();message(`Importazione completata: ${num(Object.values(result.report.added).reduce((a:number,b:any)=>a+Number(b),0))} voci aggiunte. Le schede già presenti sono state mantenute.`)}
    catch(error){$("accessImportError").textContent=(error as Error).message;$<HTMLButtonElement>("accessImportApply").disabled=false}finally{accessApplying=false}
};
// Refresh on return to the module; drafts are never overwritten by a background refresh.
window.addEventListener("focus", () => {
    if (actor && !$<HTMLDialogElement>("editDialog").open) void load();
});
setInterval(() => {
    if (
        actor &&
        !document.hidden &&
        !$<HTMLDialogElement>("editDialog").open &&
        !busy
    )
        void load();
}, 60000);
$<HTMLDialogElement>("loginDialog").showModal();
void loginEmployees();
