import { specialFilterEditor } from "../modules/analysis-special-filter-editor";
import { recentAnalysisYears } from "../../main/modules/analysis-filter-modes";
import { ruleMode, readRuleMode } from "../modules/analysis-rule-mode";
import { continueTableOnScroll } from "../modules/table-scroll-loader";
import { bindSortingHeaders, updateSortingBar } from "../modules/table-sorting";
import { installAnalysisLinks } from "../modules/analysis-links";
import { contextFromAnalysisElement } from "../modules/document-links";
import type { AnalysisContext } from "../../main/modules/analysis-navigation-model";
import {
    COLUMNS,
    DEFAULT_COLUMNS,
    Row,
    Search,
    Preferences,
    emptySearch,
    summarize,
    summarizeSuppliers,
    SupplierSummary,
    filterRows,
    relatedOrders,
    orderPending,
    yes,
    validateSearch,
    validatePreferences,
} from "../../main/modules/bar-contracts/model";
const ipc = require("electron").ipcRenderer;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
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
const num = (v: unknown, d = 3) =>
    new Intl.NumberFormat("it-IT", { maximumFractionDigits: d }).format(
        Number(v),
    );
const initialSearch = (): ReturnType<typeof emptySearch> => ({ ...emptySearch(), rules: [{ field: "date", op: "range" as const, value: recentAnalysisYears()[0] + "-01-01", to: recentAnalysisYears()[2] + "-12-31" }] });
let contracts: Row[] = [],
    orders: Row[] = [],
    rows: Row[] = [],
    filtered: Row[] = [],
    loaded = false,
    search = initialSearch(),
    queriedAt = "";
let preferences: Preferences = {
    version: 1,
    columns: [...DEFAULT_COLUMNS],
    presets: [],
};
const setStatus = (text = "", error = false) => {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
};
const specialEditor = specialFilterEditor($("searchForm"), COLUMNS, () => { try { search = readSearch(); render(); } catch (error) { report(error); } });
function fieldInput(col: (typeof COLUMNS)[number], rule: any) {
    const numeric = col.kind === "number",
        date = col.kind === "date",
        type = date ? "date" : numeric ? "number" : "text",
        op =
            rule.op ||
            (["date", "number"].includes(col.kind) ? "range" : "contains");
    const options =
        numeric || date
            ? [
                  ["range", "Da / a"],
                  ["exact", "Uguale a"],
              ]
            : [
                  ["contains", "Contiene"],
                  ["prefix", "Inizia con"],
                  ["exact", "Uguale a"],
                  ["range", "Da / a"],
              ];
    return `<select data-op aria-label="Confronto ${esc(col.label)}">${options.map(([v, label]) => `<option value="${v}" ${op === v ? "selected" : ""}>${label}</option>`).join("")}</select><div class="${op === "range" ? "range" : ""}"><input data-value type="${type}" ${numeric ? 'step="any"' : ""} value="${esc(rule.value)}" aria-label="${esc(col.label)}${op === "range" ? " da" : ""}"><input data-to type="${type}" ${numeric ? 'step="any"' : ""} value="${esc(rule.to)}" aria-label="${esc(col.label)} a" ${op !== "range" ? "hidden" : ""}></div>`;
}
function ruleHtml(col: (typeof COLUMNS)[number], rule: any) {
    return `<div class="rule"><div class="rule-fields">${fieldInput(col, rule)}</div><button type="button" class="remove-rule" aria-label="Rimuovi condizione ${esc(col.label)}">×</button></div>`;
}
const scopeLabels: Record<string, string> = {
    open: "Attivi / aperti",
    closed: "Chiusi",
    expired: "Scaduti",
    all: "Storico completo",
};
function scopeValues() {
    return Array.isArray(search.scope) ? search.scope : [search.scope];
}
function scopeText() {
    return (
        scopeValues()
            .map((value) => scopeLabels[value])
            .join(" + ") || "Nessuno stato selezionato"
    );
}
function renderScope() {
    $("scope")
        .querySelectorAll<HTMLInputElement>("input")
        .forEach(
            (input) =>
                (input.checked = scopeValues().includes(input.value as any)),
        );
    $("scopeSelection").textContent = scopeText();
}
function renderFilters() {
    specialEditor.sync(search.special);
    const openStates = new Map(
        [
            ...$("filterGroups").querySelectorAll<HTMLDetailsElement>(
                "details[data-field]",
            ),
        ].map((group) => [group.dataset.field, group.open]),
    );
    $("filterGroups").innerHTML = COLUMNS.map((c, i) => {
        const rules = search.rules.filter((r) => r.field === c.key);
        return `<details class="filter-group" data-field="${c.key}" ${(openStates.has(c.key) ? openStates.get(c.key) : i < 2 || rules.length) ? "open" : ""}><summary>${esc(c.label)}<span class="badge">${rules.length || "Facoltativo"}</span></summary><div class="rules">${(rules.length ? rules : [{}]).map((r) => ruleHtml(c, r)).join("")}</div><button type="button" class="add-rule">+ Aggiungi alternativa</button></details>`;
    }).join("");
    renderScope();
}
function readSearch() {
    const rules: any[] = [];
    $("filterGroups")
        .querySelectorAll<HTMLElement>("[data-field]")
        .forEach((group) =>
            group.querySelectorAll<HTMLElement>(".rule").forEach((rule) => {
                const value =
                        rule.querySelector<HTMLInputElement>(
                            "[data-value]",
                        )!.value,
                    to =
                        rule.querySelector<HTMLInputElement>(
                            "[data-to]",
                        )?.value,
                    op =
                        rule.querySelector<HTMLSelectElement>(
                            "[data-op]",
                        )!.value;
                if (value || (op === "range" && to))
                    rules.push({
                        ...readRuleMode(rule),
                        field: group.dataset.field,
                        op,
                        value,
                        ...(op === "range" && to ? { to } : {}),
                    });
            }),
        );
    return validateSearch({
        ...search,
        special: specialEditor.read(),
        scopeExclude: false,
        scope: [
            ...$("scope").querySelectorAll<HTMLInputElement>("input:checked"),
        ].map((input) => input.value),
        rules,
    });
}
const format = (row: Row, c: { key: string; kind: string }) => {
    const v = row[c.key];
    return v == null || v === ""
        ? "—"
        : c.kind === "number"
          ? num(v, /price/i.test(c.key) ? 4 : 3)
          : c.kind === "date"
            ? String(v).slice(0, 10).split("-").reverse().join("/")
            : String(v);
};
let groupSuppliers = false;
const expandedSuppliers = new Set<string>();
const expandedContracts = new Set<string>();
const contractKey = (row: Row) =>
    JSON.stringify([
        String(row.id),
        String(row.line),
        String(row.supplierCode),
    ]);
function markup(data: Row[], columns: typeof COLUMNS, contractRows = false) {
    return data
        .map(
            (row) =>
                (contractRows
                    ? `<tr data-contract-row="${esc(contractKey(row))}">`
                    : "<tr>") +
                columns
                    .map(
                        (c, index) =>
                            `<td data-column="${c.key}" ${c.key === "item" && row.item ? `data-analysis-article="${esc(row.item)}"` : ["supplier", "supplierCode"].includes(c.key) && row.supplierCode ? `data-analysis-supplier-code="${esc(row.supplierCode)}"` : ""} class="${c.kind === "number" ? "numeric" : ""}" title="${esc(format(row, c))}">${contractRows && index === 0 ? `<button class="document-expand" data-expand-contract="${esc(row.id)}" data-line="${esc(row.line)}" data-supplier="${esc(row.supplierCode)}" aria-expanded="${expandedContracts.has(contractKey(row))}" aria-label="Mostra o nascondi ordini del contratto ${esc(row.contract)}, riga ${esc(row.line)}">${expandedContracts.has(contractKey(row)) ? "▾" : "▸"}</button>` : ""}${c.key === "contract" ? `<button class="bom-link" data-contract="${row.id}" data-line="${row.line}">${esc(format(row, c))}</button>` : esc(format(row, c))}</td>`,
                    )
                    .join("") +
                "</tr>",
        )
        .join("");
}
const pinnedHeaders = new Map<HTMLTableElement, HTMLElement>();
function cleanupPinnedTables() {
    for (const [table, header] of pinnedHeaders)
        if (!table.isConnected || !header.isConnected) {
            pinObserver.unobserve(header);
            pinnedHeaders.delete(table);
        }
}
const pinObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
        const header = entry.target as HTMLElement,
            table = header.closest("table");
        if (table)
            table.style.setProperty(
                "--bar-supplier-width",
                header.getBoundingClientRect().width + "px",
            );
    }
});
function pinContractColumns(table: HTMLTableElement) {
    cleanupPinnedTables();
    const header = table.tHead?.rows[0]?.cells[0];
    if (!header) return;
    const old = pinnedHeaders.get(table);
    if (old && old !== header) pinObserver.unobserve(old);
    pinnedHeaders.set(table, header);
    pinObserver.observe(header);
    table.style.setProperty(
        "--bar-supplier-width",
        header.getBoundingClientRect().width + "px",
    );
}
function supplierMarkup(groups: SupplierSummary[], columns: typeof COLUMNS) {
    return groups
        .map(
            (group) =>
                `<tr class="bar-supplier-summary" data-supplier-group="${esc(group.key)}">${columns
                    .map((c, index) => {
                        const value = group.totals[c.key],
                            partial = group.partial.includes(c.key),
                            text =
                                c.key === "contract"
                                    ? num(value, 0) +
                                      (Number(value) === 1
                                          ? " contratto"
                                          : " contratti")
                                    : format(group.totals, c),
                            special =
                                c.key === "amount"
                                    ? group.amounts
                                          .map(
                                              (a) =>
                                                  `<div>${num(a.value)} ${esc(a.currency || "Valuta non indicata")}${a.partial ? " *" : ""}</div>`,
                                          )
                                          .join("")
                                    : c.key === "currency" &&
                                        group.amounts.length
                                      ? group.amounts
                                            .map(
                                                (a) =>
                                                    `<div>${esc(a.currency || "Valuta non indicata")}</div>`,
                                            )
                                            .join("")
                                      : c.key === "unit" &&
                                          group.originalOrdered.length
                                        ? group.originalOrdered
                                              .map(
                                                  (q) =>
                                                      `<div>${esc(q.unit || "U.M. non indicata")}</div>`,
                                              )
                                              .join("")
                                        : c.key === "erpOrdered"
                                          ? group.originalOrdered
                                                .map(
                                                    (q) =>
                                                        `<div>${num(q.value)} ${esc(q.unit || "U.M. non indicata")}${q.partial ? " *" : ""}</div>`,
                                                )
                                                .join("")
                                          : null;
                        return `<td ${["supplier", "supplierCode"].includes(c.key) ? `data-analysis-supplier-code="${esc(group.totals.supplierCode)}"` : c.key === "item" && value ? `data-analysis-article="${esc(value)}"` : ""} class="${c.kind === "number" ? "numeric" : ""}" title="${esc(partial ? "Totale parziale: alcuni contratti hanno dati mancanti." : text)}">${index === 0 ? `<button class="document-expand" data-expand-supplier="${esc(group.key)}" aria-expanded="${expandedSuppliers.has(group.key)}" aria-label="Mostra o nascondi contratti di ${esc(group.totals.supplier)}">${expandedSuppliers.has(group.key) ? "▾" : "▸"}</button>` : ""}${special === null ? esc(text) + (partial && value != null ? " *" : "") : special || "—"}</td>`;
                    })
                    .join("")}</tr>`,
        )
        .join("");
}
let supplierInlineId = 0;
function toggleSupplier(button: HTMLButtonElement) {
    const parent = button.closest("tr")!,
        table = parent.closest("table")!,
        key = button.dataset.expandSupplier!,
        current = parent.nextElementSibling;
    if (current?.classList.contains("bar-supplier-contracts-row")) {
        current.remove();
        cleanupPinnedTables();
        expandedSuppliers.delete(key);
        button.textContent = "▸";
        button.setAttribute("aria-expanded", "false");
        button.removeAttribute("aria-controls");
        return;
    }
    const group = summarizeSuppliers(filtered, search.sort).find(
        (group) => group.key === key,
    );
    if (!group) return;
    const child = document.createElement("tr");
    child.className = "bar-supplier-contracts-row";
    const cell = document.createElement("td");
    cell.colSpan = parent.cells.length;
    cell.className = "analysis-linked-documents";
    child.append(cell);
    const panel = document.createElement("div");
    panel.className = "bar-supplier-contracts linked-document";
    panel.id = "supplierContracts" + ++supplierInlineId;
    const heading = document.createElement("strong");
    heading.textContent =
        String(group.totals.supplier) +
        " · " +
        group.totals.contract +
        (Number(group.totals.contract) === 1 ? " contratto" : " contratti");
    const scroller = document.createElement("div");
    scroller.className = "table-scroll";
    scroller.tabIndex = 0;
    scroller.setAttribute(
        "aria-label",
        "Contratti di " + group.totals.supplier,
    );
    const nested = document.createElement("table");
    nested.className = "bar-contract-table linked-documents-table";
    nested.innerHTML = "<thead></thead><tbody></tbody>";
    scroller.append(nested);
    panel.append(heading, scroller);
    cell.append(panel);
    parent.after(child);
    panel.style.width =
        Math.max(200, table.parentElement!.clientWidth - 56) + "px";
    const columns = COLUMNS.filter((c) => preferences.columns.includes(c.key));
    nested.tHead!.innerHTML =
        "<tr>" +
        columns
            .map(
                (c) =>
                    `<th data-column="${c.key}" class="${c.kind === "number" ? "numeric" : ""}">${esc(c.label)}</th>`,
            )
            .join("") +
        "</tr>";
    nested.tBodies[0].innerHTML = markup(
        group.rows.slice(0, 250),
        columns,
        true,
    );
    restoreContractExpansions(nested);
    pinContractColumns(nested);
    continueTableOnScroll({
        table: nested,
        total: group.rows.length,
        initial: Math.min(250, group.rows.length),
        append: (from, to) => {
            nested.tBodies[0].insertAdjacentHTML(
                "beforeend",
                markup(group.rows.slice(from, to), columns, true),
            );
            restoreContractExpansions(nested);
        },
    });
    expandedSuppliers.add(key);
    button.textContent = "▾";
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", panel.id);
}
function restoreSupplierExpansions(
    table: HTMLTableElement,
    groups: SupplierSummary[],
    columns: typeof COLUMNS,
) {
    cleanupPinnedTables();
    table
        .querySelectorAll<HTMLButtonElement>(
            ":scope>tbody>tr[data-supplier-group]>td>[data-expand-supplier]",
        )
        .forEach((button) => {
            if (
                expandedSuppliers.has(button.dataset.expandSupplier!) &&
                !button
                    .closest("tr")!
                    .nextElementSibling?.classList.contains(
                        "bar-supplier-contracts-row",
                    )
            )
                toggleSupplier(button);
        });
}
function render() {
    renderScope();
    $("resultsTitle").textContent = "Contratti barra · " + scopeText();
    rows = summarize(contracts, orders);
    filtered = filterRows(rows, search);
    const columns = COLUMNS.filter((c) =>
            preferences.columns.includes(c.key),
        ).map((c) => ({
            ...c,
            label:
                groupSuppliers && c.key === "euroPrice"
                    ? "Prezzo medio ponderato (€/kg)"
                    : groupSuppliers && c.key === "contract"
                      ? "Contratti"
                      : c.label,
        })),
        table = $<HTMLTableElement>("results");
    table.tHead!.innerHTML =
        "<tr>" +
        columns
            .map(
                (c) =>
                    `<th data-column="${c.key}" class="${c.kind === "number" ? "numeric" : ""}">${esc(c.label)}</th>`,
            )
            .join("") +
        "</tr>";
    const groups = summarizeSuppliers(filtered, search.sort);
    table.tBodies[0].innerHTML = groupSuppliers
        ? supplierMarkup(groups.slice(0, 250), columns)
        : markup(filtered.slice(0, 250), columns, true);
    table.classList.toggle("bar-contract-table", !groupSuppliers);
    if (groupSuppliers) restoreSupplierExpansions(table, groups, columns);
    else {
        restoreContractExpansions(table);
        pinContractColumns(table);
    }
    $("groupSuppliers").setAttribute("aria-pressed", String(groupSuppliers));
    const sort = (next: Search["sort"]) => {
        search = { ...search, sort: next };
        render();
    };
    bindSortingHeaders(table, columns, search.sort, sort);
    updateSortingBar(table, COLUMNS, search.sort, sort);
    table.hidden = !filtered.length;
    $("empty").hidden = !!filtered.length || !loaded;
    $<HTMLButtonElement>("export").disabled = !loaded || !filtered.length;
    $("contractCount").textContent = loaded
        ? num(new Set(filtered.map((r) => r.id)).size, 0)
        : "—";
    for (const [key, id] of [
        ["received", "receivedCount"],
        ["available", "availableCount"],
    ]) {
        const known = filtered.filter((r) => r[key] != null);
        $(id).textContent = loaded
            ? known.length || !filtered.length
                ? num(known.reduce((a, r) => a + Number(r[key]), 0)) +
                  (known.length < filtered.length ? " *" : "")
                : "—"
            : "—";
        $(id).title =
            known.length < filtered.length
                ? "Totale parziale: alcune righe hanno dati mancanti."
                : "";
    }
    continueTableOnScroll({
        table,
        total: groupSuppliers ? groups.length : filtered.length,
        initial: Math.min(
            250,
            groupSuppliers ? groups.length : filtered.length,
        ),
        append: (from, to) => {
            table.tBodies[0].insertAdjacentHTML(
                "beforeend",
                groupSuppliers
                    ? supplierMarkup(groups.slice(from, to), columns)
                    : markup(filtered.slice(from, to), columns, true),
            );
            if (groupSuppliers)
                restoreSupplierExpansions(table, groups, columns);
            else restoreContractExpansions(table);
        },
        progress: (n, total) => {
            $("loaded").textContent = loaded
                ? `${num(n, 0)} di ${num(total, 0)} ${groupSuppliers ? "fornitori" : "righe contratto"}`
                : "";
        },
    });
    $("columnCount").textContent = String(columns.length);
    $("sourceInfo").textContent = queriedAt
        ? "Lettura gestionale: " +
          new Date(queriedAt).toLocaleString("it-IT") +
          "."
        : "";
}
function renderColumns() {
    $("columnPicker").innerHTML = COLUMNS.map(
        (c) =>
            `<label><input type="checkbox" value="${c.key}" ${preferences.columns.includes(c.key) ? "checked" : ""} ${["supplier", "contract"].includes(c.key) ? "disabled" : ""}>${esc(c.label)}</label>`,
    ).join("");
}
function renderPresets() {
    $<HTMLSelectElement>("presets").innerHTML =
        '<option value="">Scegli preset</option>' +
        preferences.presets
            .map((p, i) => `<option value="${i}">${esc(p.name)}</option>`)
            .join("");
    $<HTMLButtonElement>("deletePreset").disabled = true;
}
async function savePreferences() {
    const r = await ipc.invoke("bar-contracts-preferences-save", preferences);
    if (!r.ok) throw Error(r.error);
}
const report = (e: any) => setStatus(e.message || String(e), true);
type Supplier = { code: string; name: string; disabled: boolean };
let supplierDirectory: Supplier[] = [],
    selectedSuppliers: string[] = [],
    supplierBusy = false,
    supplierSaving = false;
const supplierStatus = (message = "", error = false) => {
    $("supplierSettingsStatus").textContent = message;
    $("supplierSettingsStatus").classList.toggle("error", error);
};
function supplierChoices() {
    const term = $<HTMLInputElement>("supplierSearch")
        .value.trim()
        .toLocaleLowerCase("it");
    const matches = supplierDirectory.filter(
        (s) =>
            !selectedSuppliers.includes(s.code) &&
            `${s.name} ${s.code}`.toLocaleLowerCase("it").includes(term),
    );
    $<HTMLSelectElement>("supplierChoice").innerHTML = matches
        .slice(0, 100)
        .map(
            (s) =>
                `<option value="${esc(s.code)}">${esc(s.name)} · ${esc(s.code)}${s.disabled ? " (disabilitato)" : ""}</option>`,
        )
        .join("");
    $<HTMLButtonElement>("supplierAdd").disabled =
        supplierBusy || !matches.length;
    $("supplierMatches").textContent =
        matches.length > 100
            ? `${num(matches.length, 0)} fornitori trovati: visualizzati i primi 100, affina la ricerca.`
            : matches.length
              ? ""
              : "Nessun fornitore trovato.";
}
function supplierSelection() {
    $("selectedSuppliers").innerHTML = selectedSuppliers.length
        ? selectedSuppliers
              .map((code) => {
                  const supplier = supplierDirectory.find(
                      (s) => s.code === code,
                  );
                  return `<div class="selected-supplier"><span>${esc(supplier?.name || "Fornitore non più in anagrafica")} · ${esc(code)}${supplier?.disabled ? " (disabilitato)" : ""}</span><button type="button" data-remove-supplier="${esc(code)}" aria-label="Rimuovi ${esc(supplier?.name || code)}">×</button></div>`;
              })
              .join("")
        : "<p>Nessun fornitore incluso: l’analisi resterà vuota.</p>";
    supplierChoices();
}
function supplierControls(busy: boolean) {
    supplierBusy = busy;
    $<HTMLButtonElement>("suppliersSave").disabled = busy;
    for (const control of $("suppliersForm").querySelectorAll<
        HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >("#supplierSearch,#supplierChoice,#supplierAdd,[data-remove-supplier]"))
        control.disabled = busy;
    supplierChoices();
}
$("supplierSettings").onclick = async () => {
    const button = $<HTMLButtonElement>("supplierSettings");
    button.disabled = true;
    supplierDirectory = [];
    selectedSuppliers = [];
    $<HTMLInputElement>("supplierSearch").value = "";
    supplierSelection();
    supplierControls(true);
    supplierStatus("Lettura anagrafica fornitori…");
    $<HTMLDialogElement>("suppliersDialog").showModal();
    try {
        const result = await ipc.invoke("bar-contracts-suppliers-load");
        if (!result.ok) throw Error(result.error);
        supplierDirectory = result.suppliers;
        selectedSuppliers = result.selected;
        supplierSelection();
        supplierStatus();
        supplierControls(false);
    } catch (e) {
        supplierStatus((e as Error).message, true);
    } finally {
        button.disabled = false;
    }
};
$("supplierSearch").oninput = supplierChoices;
$("supplierAdd").onclick = () => {
    const code = $<HTMLSelectElement>("supplierChoice").value;
    if (!supplierBusy && code && !selectedSuppliers.includes(code)) {
        if (selectedSuppliers.length >= 200) {
            supplierStatus("Sono disponibili al massimo 200 fornitori.", true);
            return;
        }
        selectedSuppliers.push(code);
        supplierSelection();
        supplierStatus();
    }
};
$("selectedSuppliers").onclick = (e) => {
    const button = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-remove-supplier]",
    );
    if (button && !supplierBusy) {
        selectedSuppliers = selectedSuppliers.filter(
            (code) => code !== button.dataset.removeSupplier,
        );
        supplierSelection();
    }
};
const closeSupplierSettings = () => {
    if (!supplierSaving) $<HTMLDialogElement>("suppliersDialog").close();
};
$("suppliersClose").onclick = closeSupplierSettings;
$("suppliersCancel").onclick = closeSupplierSettings;
$("suppliersDialog").addEventListener("cancel", (e) => {
    if (supplierSaving) e.preventDefault();
});
$("suppliersForm").onsubmit = async (e) => {
    e.preventDefault();
    if (supplierBusy) return;
    supplierSaving = true;
    supplierControls(true);
    supplierStatus("Salvataggio…");
    try {
        const result = await ipc.invoke(
            "bar-contracts-suppliers-save",
            selectedSuppliers,
        );
        if (!result.ok) throw Error(result.error);
        $<HTMLDialogElement>("suppliersDialog").close();
        contracts = [];
        orders = [];
        loaded = false;
        queriedAt = "";
        render();
        await load();
    } catch (e) {
        supplierStatus((e as Error).message, true);
    } finally {
        supplierSaving = false;
        supplierControls(false);
    }
};
$("filterGroups").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!b) return;
    const g = b.closest<HTMLElement>("[data-field]")!,
        col = COLUMNS.find((c) => c.key === g.dataset.field)!;
    if (b.classList.contains("add-rule"))
        g.querySelector(".rules")!.insertAdjacentHTML(
            "beforeend",
            ruleHtml(col, {}),
        );
    if (b.classList.contains("remove-rule")) {
        const rule = b.closest(".rule")!;
        if (g.querySelectorAll(".rule").length > 1) rule.remove();
        else rule.outerHTML = ruleHtml(col, {});
    }
});
$("filterGroups").addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (!el.matches("[data-op]")) return;
    const rule = el.closest<HTMLElement>(".rule")!;
    rule.querySelector("[data-to]")?.toggleAttribute(
        "hidden",
        el.value !== "range",
    );
    rule.querySelector("[data-value]")?.parentElement?.classList.toggle(
        "range",
        el.value === "range",
    );
});
$("searchForm").onsubmit = (e) => {
    e.preventDefault();
    try {
        search = readSearch();
        setStatus();
        render();
    } catch (e) {
        report(e);
    }
};
$("scope").onchange = (event) => {
    try {
        const input = event.target as HTMLInputElement;
        if (input.checked)
            $("scope")
                .querySelectorAll<HTMLInputElement>("input")
                .forEach((other) => {
                    if (
                        input.value === "all"
                            ? other !== input
                            : other.value === "all"
                    )
                        other.checked = false;
                });
        search = readSearch();
        setStatus();
        render();
    } catch (e) {
        report(e);
    }
};
$("reset").onclick = () => {
    search = initialSearch();
    renderFilters();
    render();
    setStatus();
};
$("columnPicker").onchange = () => {
    preferences.columns = Array.from(
        $("columnPicker").querySelectorAll<HTMLInputElement>("input:checked"),
    ).map((i) => i.value);
    render();
    void savePreferences().catch(report);
};
$("presets").onchange = () => {
    const select = $<HTMLSelectElement>("presets");
    $<HTMLButtonElement>("deletePreset").disabled = !select.value;
    if (!select.value) return;
    const p = preferences.presets[Number(select.value)];
    search = validateSearch(p.search);
    preferences.columns = [...p.columns];
    renderFilters();
    renderColumns();
    render();
    void savePreferences().catch(report);
};
$("savePreset").onclick = () => {
    try {
        readSearch();
        if (preferences.presets.length >= 10)
            throw Error("Sono disponibili al massimo dieci preset.");
        $<HTMLInputElement>("presetName").value = "";
        $<HTMLDialogElement>("presetDialog").showModal();
    } catch (e) {
        report(e);
    }
};
$("presetDialog").addEventListener("close", () => {
    if ($<HTMLDialogElement>("presetDialog").returnValue !== "save") return;
    try {
        const next = validatePreferences({
            ...preferences,
            presets: [
                ...preferences.presets,
                {
                    name: $<HTMLInputElement>("presetName").value,
                    search: readSearch(),
                    columns: [...preferences.columns],
                },
            ],
        });
        preferences = next;
        renderPresets();
        void savePreferences().catch(report);
    } catch (e) {
        report(e);
    }
});
$("deletePreset").onclick = () => {
    const select = $<HTMLSelectElement>("presets");
    if (!select.value) return;
    preferences.presets.splice(Number(select.value), 1);
    renderPresets();
    void savePreferences().catch(report);
};
const ORDER_COLUMNS: typeof COLUMNS = [
    { key: "document", label: "Ordine", kind: "text" },
    { key: "date", label: "Data", kind: "date" },
    { key: "item", label: "Articolo", kind: "text" },
    { key: "description", label: "Descrizione", kind: "text" },
    { key: "unit", label: "U.M.", kind: "text" },
    { key: "quantity", label: "Ordinati", kind: "number" },
    { key: "received", label: "Ricevuti", kind: "number" },
    { key: "pending", label: "In corso", kind: "number" },
    { key: "delivery", label: "Consegna prevista", kind: "date" },
    { key: "price", label: "Prezzo / U.M.", kind: "number" },
    { key: "currency", label: "Valuta", kind: "text" },
    { key: "state", label: "Stato", kind: "text" },
];
function renderOrders(table: HTMLTableElement, row: Row) {
    const cols = ORDER_COLUMNS;
    const linked = relatedOrders(row, orders).map((o) => ({
        ...o,
        pending: orderPending(o),
        state:
            yes(o.cancelled) || yes(o.lineCancelled)
                ? "Annullato"
                : yes(o.closed) || yes(o.lineClosed)
                  ? "Evaso"
                  : "Aperto",
    }));
    table.tHead!.innerHTML =
        "<tr>" + cols.map((c) => `<th>${esc(c.label)}</th>`).join("") + "</tr>";
    table.tBodies[0].innerHTML = markup(linked.slice(0, 250), cols);
    continueTableOnScroll({
        table,
        total: linked.length,
        initial: Math.min(250, linked.length),
        append: (from, to) =>
            table.tBodies[0].insertAdjacentHTML(
                "beforeend",
                markup(linked.slice(from, to), cols),
            ),
    });
    return linked.length;
}
let inlineContractId = 0;
function toggleContractOrders(button: HTMLButtonElement) {
    const parent = button.closest("tr")!,
        table = parent.closest("table")!,
        row = rows.find(
            (r) =>
                String(r.id) === button.dataset.expandContract &&
                String(r.line) === button.dataset.line &&
                String(r.supplierCode) === button.dataset.supplier,
        );
    if (!row) return;
    const key = contractKey(row),
        current = parent.nextElementSibling;
    if (current?.classList.contains("contract-orders-row")) {
        current.remove();
        expandedContracts.delete(key);
        button.textContent = "▸";
        button.setAttribute("aria-expanded", "false");
        button.removeAttribute("aria-controls");
        return;
    }
    const child = document.createElement("tr");
    child.className = "contract-orders-row";
    const cell = document.createElement("td");
    cell.colSpan = parent.cells.length;
    cell.className = "analysis-linked-documents";
    child.append(cell);
    const panel = document.createElement("div");
    panel.className = "bar-inline-orders linked-document";
    panel.id = `contractOrders${++inlineContractId}`;
    const title = document.createElement("strong");
    title.textContent = `Ordini del contratto ${row.contract} · riga ${row.line}`;
    const scroller = document.createElement("div");
    scroller.className = "table-scroll";
    scroller.tabIndex = 0;
    scroller.setAttribute(
        "aria-label",
        `Ordini del contratto ${row.contract}, riga ${row.line}`,
    );
    const nested = document.createElement("table");
    nested.id = panel.id + "Table";
    nested.className = "linked-documents-table";
    nested.innerHTML = "<thead></thead><tbody></tbody>";
    scroller.append(nested);
    panel.append(title, scroller);
    cell.append(panel);
    parent.after(child);
    panel.style.width =
        Math.max(200, table.parentElement!.clientWidth - 56) + "px";
    const count = renderOrders(nested, row);
    if (!count) {
        const empty = document.createElement("p");
        empty.className = "bar-inline-empty";
        empty.textContent =
            "Nessun ordine collegato a questa riga del contratto.";
        panel.append(empty);
    }
    expandedContracts.add(key);
    button.textContent = "▾";
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", panel.id);
}
function restoreContractExpansions(table: HTMLTableElement) {
    table
        .querySelectorAll<HTMLButtonElement>(
            ":scope>tbody>tr[data-contract-row]>td>[data-expand-contract]",
        )
        .forEach((button) => {
            const row = button.closest("tr")!;
            if (
                expandedContracts.has(row.dataset.contractRow!) &&
                !row.nextElementSibling?.classList.contains(
                    "contract-orders-row",
                )
            )
                toggleContractOrders(button);
        });
}
window.addEventListener("resize", () =>
    document
        .querySelectorAll<HTMLElement>(".bar-inline-orders")
        .forEach((panel) => {
            const table = panel.closest("td")?.closest("table");
            if (table?.parentElement)
                panel.style.width =
                    Math.max(200, table.parentElement.clientWidth - 56) + "px";
        }),
);
let opener: HTMLElement | null = null;
function openDetail(id: string, line: string) {
    const row = rows.find(
        (r) => String(r.id) === id && String(r.line) === line,
    );
    if (!row) return;
    opener = document.activeElement as HTMLElement;
    $("detailTitle").textContent = `${row.supplier} · ${row.contract}`;
    $("detailSubtitle").textContent =
        `Riga ${row.line} · ${row.description} · Ricevuti ${format(row, { key: "received", kind: "number" })} kg · Disponibili ${format(row, { key: "available", kind: "number" })} kg`;
    const count = renderOrders($<HTMLTableElement>("detailTable"), row);
    $("detailEmpty").hidden = count > 0;
    $<HTMLDialogElement>("contractDetail").showModal();
}
$("groupSuppliers").onclick = () => {
    groupSuppliers = !groupSuppliers;
    render();
};
$("results").onclick = (e) => {
    const supplier = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-expand-supplier]",
    );
    if (supplier) {
        toggleSupplier(supplier);
        return;
    }
    const expand = (e.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-expand-contract]",
    );
    if (expand) {
        toggleContractOrders(expand);
        return;
    }
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-contract]");
    if (b) openDetail(b.dataset.contract!, b.dataset.line!);
};
$("detailClose").onclick = () => $<HTMLDialogElement>("contractDetail").close();
$("contractDetail").addEventListener("close", () => opener?.focus());
$("close").onclick = () => ipc.send("bar-contracts-close");
async function load() {
    const button = $<HTMLButtonElement>("refresh");
    button.disabled = true;
    setStatus("Lettura contratti e ordini…");
    try {
        const r = await ipc.invoke("bar-contracts-load");
        if (!r.ok) throw Error(r.error);
        contracts = r.contracts;
        orders = r.orders;
        queriedAt = r.queriedAt;
        loaded = true;
        render();
        applyIncomingContext();
        setStatus();
    } catch (e) {
        report(e);
    } finally {
        button.disabled = false;
    }
}
$("refresh").onclick = () => void load();
$("export").onclick = async () => {
    const button = $<HTMLButtonElement>("export");
    button.disabled = true;
    try {
        const result = await ipc.invoke("bar-contracts-export", {
            search,
            groupSuppliers,
            columns: preferences.columns,
        });
        if (!result.ok) throw Error(result.error);
        setStatus(
            result.canceled
                ? ""
                : `Esportate ${num(result.count, 0)} righe contratto.`,
        );
    } catch (e) {
        report(e);
    } finally {
        button.disabled = !filtered.length;
    }
};
let incomingContext: AnalysisContext | null = null;
function applyIncomingContext() {
    if (!loaded || !incomingContext) return;
    const context = incomingContext;
    incomingContext = null;
    search = {
        ...emptySearch(),
        scope: "all",
        rules: [
            ...(context.article
                ? [
                      {
                          field: "item",
                          op: "exact" as const,
                          value: context.article,
                      },
                  ]
                : []),
            ...(context.supplierCode
                ? [
                      {
                          field: "supplierCode",
                          op: "exact" as const,
                          value: context.supplierCode,
                      },
                  ]
                : []),
        ],
    };
    $<HTMLDialogElement>("contractDetail").close();
    renderFilters();
    render();
}
installAnalysisLinks(contextFromAnalysisElement, (message) =>
    setStatus(message, true),
);
ipc.on("analysis-open-context", (_event: any, context: AnalysisContext) => {
    incomingContext = context;
    applyIncomingContext();
});
ipc.send("analysis-context-ready");
void (async () => {
    try {
        const r = await ipc.invoke("bar-contracts-preferences-load");
        if (!r.ok) throw Error(r.error);
        preferences = validatePreferences(r.preferences);
    } catch (e) {
        report(e);
    }
    renderFilters();
    renderColumns();
    renderPresets();
    await load();
})();
