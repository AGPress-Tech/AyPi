import { specialFilterEditor } from "../modules/analysis-special-filter-editor";
import { columnRuleEditor } from "../modules/analysis-column-rule-editor";
import {
    STOCK_COLUMNS,
    DEFAULT_STOCK_COLUMNS,
    StockRow,
    StockGroup,
    StockSearch,
    StockPreferences,
    emptyStockSearch,
    normalizeStock,
    filterStock,
    groupStock,
    stockTotals,
    validateStockPreferences,
    StockPeriod,
    validateStockPeriods,
    stockVisibleColumns,
} from "../../main/modules/stock-analysis/model";
import { continueTableOnScroll } from "../modules/table-scroll-loader";
import { bindSortingHeaders, updateSortingBar, setExpandedTableRow } from "../modules/table-sorting";
import { installAnalysisLinks } from "../modules/analysis-links";
import { contextFromAnalysisElement } from "../modules/document-links";
import { renderStockCustomerCommitments } from "../modules/stock-customer-commitments";
import type { AnalysisContext } from "../../main/modules/analysis-navigation-model";
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
const kpiNum = (v: unknown) =>
    new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(
        Number(v),
    );
const num = (v: unknown) =>
    new Intl.NumberFormat("it-IT", { maximumFractionDigits: 20 }).format(
        Number(v),
    );
let rows: StockRow[] = [],
    filtered: StockRow[] = [],
    groups: StockGroup[] = [],
    search = emptyStockSearch(),
    loaded = false,
    loading = false;
let selected: StockPeriod[] = [],
    periodOptions: StockPeriod[] = [],
    queriedAt = "";
let preferences: StockPreferences = {
    version: 1,
    columns: [...DEFAULT_STOCK_COLUMNS],
    presets: [],
};
const ruleEditor = columnRuleEditor($("stockRuleGroups"), STOCK_COLUMNS);
const specialEditor = specialFilterEditor($("searchForm"), STOCK_COLUMNS, () => { try { search = readFilters(); render(); } catch (error) { report(error); } });
const expanded = new Set<string>();
let detailId = 0,
    saving = Promise.resolve();
function status(message = "", error = false) {
    $("status").textContent = message;
    $("status").classList.toggle("error", error);
}
function report(error: unknown) {
    status((error as Error).message || String(error), true);
}
function format(row: StockRow, c: (typeof STOCK_COLUMNS)[number]) {
    const value = row[c.key];
    return value == null || value === ""
        ? "—"
        : c.kind === "number"
          ? ["fiscalYear", "fiscalPeriod"].includes(c.key)
              ? String(value)
              : num(value)
          : c.kind === "date"
            ? new Date(value).toLocaleString("it-IT")
            : String(value);
}
function readFilters(): StockSearch {
    return {
        ...search,
        rules: ruleEditor.read(),
        special: specialEditor.read(),
        modes: {},
        article: $<HTMLInputElement>("article").value,
        exactArticle: $<HTMLInputElement>("exactArticle").checked
            ? $<HTMLInputElement>("article").value
            : "",
        description: $<HTMLInputElement>("description").value,
        unit: $<HTMLSelectElement>("unit").value,
        subject: $<HTMLInputElement>("subject").value,
        subjectCode: $<HTMLInputElement>("subjectCode").value,
        subjectKind: $<HTMLSelectElement>("subjectKind").value,
        ownership: $<HTMLSelectElement>("ownership")
            .value as StockSearch["ownership"],
        scope: $<HTMLSelectElement>("scope").value as StockSearch["scope"],
        storages: [
            ...$("storageOptions").querySelectorAll<HTMLInputElement>(
                "input:checked",
            ),
        ].map((input) => input.value),
    };
}
function renderPeriods() {
    $("periodOptions").innerHTML = periodOptions
        .map(
            (p) =>
                `<label><input type="checkbox" value="${p.year}:${p.period}" ${selected.some((s) => s.year === p.year && s.period === p.period) ? "checked" : ""} ${loading ? "disabled" : ""}><span>${p.year} / ${p.period}</span></label>`,
        )
        .join("");
    $("periodCount").textContent =
        selected.length === 1
            ? selected[0].year + " / " + selected[0].period
            : selected.length
              ? String(selected.length) + " selezionati"
              : "Nessun periodo";
}
function visibleColumns() {
    return stockVisibleColumns(rows, preferences.columns, selected);
}
function renderFilters() {
    search.modes = {};
    search.rules = (search.rules || []).map(({ exclude, ...rule }) => rule);
    specialEditor.sync(search.special);
    ruleEditor.render(search.rules || []);

    $("unit").innerHTML =
        '<option value="">Tutte</option>' +
        [...new Set([...rows.map((r) => r.unit), search.unit])]
            .filter(Boolean)
            .sort()
            .map((unit) => `<option value="${esc(unit)}">${esc(unit)}</option>`)
            .join("");
    for (const key of [
        "article",
        "description",
        "unit",
        "subject",
        "subjectCode",
        "subjectKind",
        "ownership",
        "scope",
    ] as const)
        $<HTMLInputElement>(key).value = search[key];
    $<HTMLInputElement>("exactArticle").checked = !!search.exactArticle;
    if (search.exactArticle)
        $<HTMLInputElement>("article").value = search.exactArticle;
    const storages = new Map<string, string>();
    for (const row of rows) storages.set(row.storage, row.storageDescription);
    // Retain selected codes across periods even when the new period has no such position.
    for (const code of search.storages)
        if (!storages.has(code))
            storages.set(code, "Nessuna posizione in questo periodo");
    $("storageOptions").innerHTML = [...storages]
        .sort(([a], [b]) => a.localeCompare(b, "it"))
        .map(
            ([code, name]) =>
                `<label><input type="checkbox" value="${esc(code)}" ${search.storages.includes(code) ? "checked" : ""}><span>${esc(code || "Magazzino non indicato")}${name ? " · " + esc(name) : ""}</span></label>`,
        )
        .join("");
    updateStorageCount();
}
function updateStorageCount() {
    $("storageCount").textContent = search.storages.length
        ? String(search.storages.length)
        : "Tutti";
}
function contextAttributes(row: StockRow, key: string) {
    if (key === "article") return `data-analysis-article="${esc(row.article)}"`;
    if (
        ["subjectName", "subjectCode"].includes(key) &&
        row.subjectCode &&
        ["Cliente", "Fornitore"].includes(row.subjectKind)
    )
        return row.subjectKind === "Cliente"
            ? `data-analysis-customer-code="${esc(row.subjectCode)}"`
            : `data-analysis-supplier-code="${esc(row.subjectCode)}"`;
    return "";
}
function cells(row: StockRow, columns: typeof STOCK_COLUMNS, arrow = "") {
    return columns
        .map((c, i) => {
            const text = format(row, c);
            let content = esc(text);
            if (c.key === "customerQuantities" && row.customerBreakdown?.length)
                content = `<div class="stock-customer-shares">${row.customerBreakdown.map((value) => `<span data-analysis-customer-code="${esc(value.customerCode)}">${esc(value.customerName || value.customerCode || "Cliente non risolto")} <b>${value.quantity === null ? "—" : num(value.quantity)}</b> ${esc(value.unit || "U.M. non indicata")}</span>`).join("")}</div>`;
            if (
                c.key === "customerCommitments" &&
                row.currentCustomerOrders?.length
            )
                content = `<div class="stock-customer-shares">${row.currentCustomerOrders.map((value) => `<span data-analysis-customer-code="${esc(value.customerCode)}">${esc(value.customerName || value.customerCode || "Cliente non risolto")} <b>${value.residual == null ? "—" : num(value.residual)}</b> ${esc(value.unit || "U.M. non indicata")}${value.missingQuantities ? " *" : ""}</span>`).join("")}</div>`;
            return `<td data-column="${c.key}" ${contextAttributes(row, c.key)} ${c.key === "warnings" && row.warnings ? 'data-warning="true"' : ""} class="${c.kind === "number" ? "numeric" : ""}" title="${esc(c.kind === "number" && row[c.key] != null ? "Valore originale: " + String(row[c.key]) : text)}">${i === 0 ? arrow : ""}${content}</td>`;
        })
        .join("");
}
function groupMarkup(data: StockGroup[], columns: typeof STOCK_COLUMNS) {
    return data
        .map(
            (group) =>
                `<tr data-stock-group="${esc(group.key)}">${cells(group.row, columns, `<button type="button" class="document-expand" data-expand-stock="${esc(group.key)}" aria-expanded="${expanded.has(group.key)}" aria-label="Mostra o nascondi magazzini di ${esc(group.row.article)}">${expanded.has(group.key) ? "▾" : "▸"}</button>`)}</tr>`,
        )
        .join("");
}
function headers(table: HTMLTableElement, columns: typeof STOCK_COLUMNS) {
    table.tHead!.innerHTML =
        "<tr>" +
        columns
            .map(
                (c) =>
                    `<th class="${c.kind === "number" ? "numeric" : ""}">${esc(c.label)}</th>`,
            )
            .join("") +
        "</tr>";
    bindSortingHeaders(table, columns, search.sort, (sort) => {
        search = { ...search, sort };
        render();
    });
}
function toggleDetails(button: HTMLButtonElement) {
    const parent = button.closest("tr")!,
        key = button.dataset.expandStock!,
        current = parent.nextElementSibling;
    if (current?.classList.contains("stock-detail-row")) {
        setExpandedTableRow(parent, null);
        current.remove();
        expanded.delete(key);
        button.textContent = "▸";
        button.setAttribute("aria-expanded", "false");
        button.removeAttribute("aria-controls");
        return;
    }
    const group = groups.find((g) => g.key === key);
    if (!group) return;
    const child = document.createElement("tr");
    child.className = "stock-detail-row";
    const cell = document.createElement("td");
    cell.colSpan = parent.children.length;
    child.append(cell);
    setExpandedTableRow(parent, child);
    parent.after(child);
    const panel = document.createElement("div");
    panel.className = "stock-detail";
    panel.id = "stockDetail" + ++detailId;
    panel.style.width =
        Math.max(
            200,
            parent.closest("table")!.parentElement!.clientWidth - 40,
        ) + "px";
    const title = document.createElement("strong");
    title.textContent =
        group.row.article + " · " + group.details.length + " posizioni";
    const scroll = document.createElement("div");
    scroll.className = "table-scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute(
        "aria-label",
        "Dettaglio magazzini " + group.row.article,
    );
    const table = document.createElement("table");
    table.innerHTML = "<thead></thead><tbody></tbody>";
    scroll.append(table);
    panel.append(title, scroll);
    const commitments = document.createElement("details");
    commitments.className = "stock-customer-orders";
    commitments.innerHTML =
        "<summary>Impegni clienti attuali · ordini aperti</summary><div></div>";
    let requested = false;
    commitments.addEventListener("toggle", () => {
        if (commitments.open && !requested) {
            requested = true;
            void renderStockCustomerCommitments(
                commitments.querySelector("div")!,
                group.row.article,
            );
        }
    });
    panel.append(commitments);
    cell.append(panel);
    const columns = STOCK_COLUMNS.filter(
        (c) => !["ownQuantity", "thirdQuantity"].includes(c.key),
    );
    headers(table, columns);
    const markup = (from: number, to: number) =>
        group.details
            .slice(from, to)
            .map((row) => "<tr>" + cells(row, columns) + "</tr>")
            .join("");
    table.tBodies[0].innerHTML = markup(0, 250);
    continueTableOnScroll({
        table,
        total: group.details.length,
        initial: Math.min(250, group.details.length),
        append: (from, to) =>
            table.tBodies[0].insertAdjacentHTML("beforeend", markup(from, to)),
    });
    expanded.add(key);
    button.textContent = "▾";
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", panel.id);
}
function restoreDetails() {
    $("results")
        .querySelectorAll<HTMLButtonElement>("button[data-expand-stock]")
        .forEach((button) => {
            if (expanded.has(button.dataset.expandStock!))
                toggleDetails(button);
        });
}
function render() {
    filtered = filterStock(rows, search);
    groups = groupStock(filtered, search.sort);
    const table = $<HTMLTableElement>("results"),
        columns = visibleColumns().map(
            (key) => STOCK_COLUMNS.find((c) => c.key === key)!,
        );
    $("resultsTitle").textContent =
        "Giacenze per articolo" +
        (selected.length === 1
            ? " · " + selected[0].year + " / " + selected[0].period
            : selected.length
              ? " · " + selected.length + " periodi"
              : "");
    headers(table, columns);
    table.tBodies[0].innerHTML = groupMarkup(groups.slice(0, 250), columns);
    restoreDetails();
    continueTableOnScroll({
        table,
        total: groups.length,
        initial: Math.min(groups.length, 250),
        append: (from, to) => {
            table.tBodies[0].insertAdjacentHTML(
                "beforeend",
                groupMarkup(groups.slice(from, to), columns),
            );
            table
                .querySelectorAll<HTMLButtonElement>(
                    ":scope>tbody>tr>td>[data-expand-stock]",
                )
                .forEach((button) => {
                    if (
                        expanded.has(button.dataset.expandStock!) &&
                        !button
                            .closest("tr")!
                            .nextElementSibling?.classList.contains(
                                "stock-detail-row",
                            )
                    )
                        toggleDetails(button);
                });
        },
        progress: (count) => {
            $("loaded").textContent =
                num(count) +
                " di " +
                num(groups.length) +
                " righe articolo · " +
                num(filtered.length) +
                " posizioni";
        },
    });
    updateSortingBar(table, columns, search.sort, (sort) => {
        search = { ...search, sort };
        render();
    });
    table.hidden = !groups.length;
    $("empty").hidden = !!groups.length;
    $("articleCount").textContent = loaded
        ? num(new Set(filtered.map((r) => r.article)).size)
        : "—";
    $("positionCount").textContent = loaded
        ? num(new Set(filtered.map((r) => r.storage)).size) +
          " / " +
          num(filtered.length)
        : "—";
    const totals = stockTotals(filtered),
        byPeriod = new Map<string, typeof totals>();
    for (const total of totals) {
        const key = String(total.year) + " / " + String(total.period);
        byPeriod.set(key, [...(byPeriod.get(key) || []), total]);
    }
    const amount = (t: (typeof totals)[number]) =>
        `<span>${kpiNum(t.value)} ${esc(t.unit)}${t.partial ? " *" : ""}</span>`;
    $("quantityCount").classList.toggle(
        "stock-multiple-periods",
        selected.length > 1,
    );
    $("quantityCount").innerHTML = loaded
        ? [...byPeriod]
              .map(([period, values]) =>
                  selected.length > 1
                      ? `<div class="stock-period-total"><small>${esc(period)}</small>${values.map(amount).join("")}</div>`
                      : values.map(amount).join(""),
              )
              .join("") || "0"
        : "—";
    $("quantityCount").title = totals.some((t) => t.partial)
        ? "Totale parziale: alcuni valori sono mancanti."
        : "";
    $("negativeCount").textContent = loaded
        ? num(
              filtered.filter((r) => r.quantity !== null && r.quantity < 0)
                  .length,
          )
        : "—";
    updateStorageCount();
}
function renderPreferences() {
    const effective = visibleColumns();
    $("columnPicker").innerHTML = STOCK_COLUMNS.map(
        (c) =>
            `<label><input type="checkbox" value="${c.key}" ${effective.includes(c.key) ? "checked" : ""} ${c.key === "article" || (selected.length > 1 && ["fiscalYear", "fiscalPeriod"].includes(c.key)) ? "disabled" : ""} ${effective.includes(c.key) && !preferences.columns.includes(c.key) ? "data-period-auto" : ""}>${esc(c.label)}</label>`,
    ).join("");
    $("columnCount").textContent = String(effective.length);
    $("presets").innerHTML =
        '<option value="">Scegli preset</option>' +
        preferences.presets
            .map((p, i) => `<option value="${i}">${esc(p.name)}</option>`)
            .join("");
    $<HTMLButtonElement>("deletePreset").disabled = true;
}
function persist() {
    const clean = validateStockPreferences(preferences);
    const operation = saving.then(async () => {
        const result = await ipc.invoke(
            "stock-analysis-preferences-save",
            clean,
        );
        if (!result.ok) throw Error(result.error);
    });
    saving = operation.catch(report);
    return operation;
}
async function load(input: unknown = {}) {
    if (loading) return;
    loading = true;
    for (const id of [
        "refresh",
        "export",
        "periodAll",
        "periodLatest",
        "periodApply",
    ])
        $<HTMLButtonElement>(id).disabled = true;
    $("periodOptions")
        .querySelectorAll<HTMLInputElement>("input")
        .forEach((input) => (input.disabled = true));
    status("Lettura giacenze…");
    try {
        const result = await ipc.invoke("stock-analysis-load", input);
        if (!result.ok) throw Error(result.error);
        const wasMultiple = selected.length > 1;
        rows = normalizeStock(result.rows);
        selected =
            result.selectedPeriods ||
            (result.selected?.year ? [result.selected] : []);
        periodOptions = result.periods;
        queriedAt = result.queriedAt;
        loaded = true;
        renderPeriods();
        renderPreferences();
        renderFilters();
        render();
        if (wasMultiple !== selected.length > 1)
            $("results").parentElement!.scrollLeft = 0;
        status();
    } catch (error) {
        renderPeriods();
        report(error);
    } finally {
        loading = false;
        $<HTMLButtonElement>("refresh").disabled = false;
        $<HTMLButtonElement>("export").disabled = !loaded;
        for (const id of ["periodAll", "periodLatest", "periodApply"])
            $<HTMLButtonElement>(id).disabled =
                !loaded || !periodOptions.length;
        $("periodOptions")
            .querySelectorAll<HTMLInputElement>("input")
            .forEach((input) => (input.disabled = false));
    }
}
$("searchForm").addEventListener("change", event => { if ((event.target as HTMLElement).matches("[data-filter-mode]")) { try { search = readFilters(); render(); } catch (e) { report(e); } } });
$("searchForm").onsubmit = (event) => {
    event.preventDefault();
    try {
        search = readFilters();
        render();
        status();
    } catch (e) {
        report(e);
    }
};
for (const id of ["scope", "ownership", "subjectKind", "unit"])
    $(id).onchange = () => {
        try {
            search = readFilters();
            render();
        } catch (e) {
            report(e);
        }
    };
$("storageOptions").onchange = () => {
    try {
        search = readFilters();
        render();
    } catch (e) {
        report(e);
    }
};
$("allStorages").onclick = () => {
    search = { ...readFilters(), storages: [] };
    renderFilters();
    render();
};
$("reset").onclick = () => {
    search = emptyStockSearch();
    expanded.clear();
    renderFilters();
    render();
    status();
    $<HTMLSelectElement>("presets").value = "";
    $<HTMLButtonElement>("deletePreset").disabled = true;
};
$("refresh").onclick = () =>
    void load(selected.length ? { periods: selected } : {});
$("periodAll").onclick = () => {
    $("periodOptions")
        .querySelectorAll<HTMLInputElement>("input")
        .forEach((input) => (input.checked = true));
};
$("periodLatest").onclick = () => void load({});
$("periodApply").onclick = () => {
    try {
        const chosen = [
            ...$("periodOptions").querySelectorAll<HTMLInputElement>(
                "input:checked",
            ),
        ].map((input) => {
            const [year, period] = input.value.split(":").map(Number);
            return { year, period };
        });
        void load({ periods: validateStockPeriods(chosen) });
    } catch (error) {
        report(error);
    }
};
$("close").onclick = () => ipc.send("stock-analysis-close");
$("results").onclick = (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "[data-expand-stock]",
    );
    if (button) toggleDetails(button);
};
$("columnPicker").onchange = () => {
    preferences.columns = [
        ...$("columnPicker").querySelectorAll<HTMLInputElement>(
            "input:checked:not([data-period-auto])",
        ),
    ].map((input) => input.value);
    $("columnCount").textContent = String(visibleColumns().length);
    render();
    void persist().catch(() => {});
};
$("presets").onchange = () => {
    const value = $<HTMLSelectElement>("presets").value,
        preset = preferences.presets[Number(value)];
    if (value !== "" && preset) {
        search = structuredClone(preset.search);
        preferences.columns = [...preset.columns];
        renderFilters();
        renderPreferences();
        $<HTMLSelectElement>("presets").value = value;
        $<HTMLButtonElement>("deletePreset").disabled = false;
        render();
    }
};
$("savePreset").onclick = () => {
    $<HTMLInputElement>("presetName").value = "";
    $<HTMLDialogElement>("presetDialog").returnValue = "";
    $<HTMLDialogElement>("presetDialog").showModal();
    $<HTMLInputElement>("presetName").focus();
};
$("presetDialog").addEventListener("close", () => {
    if ($<HTMLDialogElement>("presetDialog").returnValue !== "save") return;
    try {
        const name = $<HTMLInputElement>("presetName").value.trim();
        const preset = {
                name,
                search: readFilters(),
                columns: [...preferences.columns],
            },
            next = structuredClone(preferences),
            index = next.presets.findIndex((p) => p.name === name);
        if (index < 0) next.presets.push(preset);
        else next.presets[index] = preset;
        preferences = validateStockPreferences(next);
        renderPreferences();
        void persist().catch(() => {});
    } catch (e) {
        report(e);
    }
});
$("deletePreset").onclick = () => {
    const index = $<HTMLSelectElement>("presets").value;
    if (index === "") return;
    preferences.presets.splice(Number(index), 1);
    renderPreferences();
    void persist().catch(() => {});
};
$("export").onclick = async () => {
    $<HTMLButtonElement>("export").disabled = true;
    try {
        const result = await ipc.invoke("stock-analysis-export", {
            search,
            columns: preferences.columns,
        });
        if (!result.ok) throw Error(result.error);
        if (!result.canceled)
            status(
                "Esportati " +
                    num(result.count) +
                    " articoli e " +
                    num(result.positions) +
                    " posizioni.",
            );
    } catch (e) {
        report(e);
    } finally {
        $<HTMLButtonElement>("export").disabled = loading || !loaded;
    }
};
installAnalysisLinks(contextFromAnalysisElement, (message) =>
    status(message, true),
);
ipc.on("analysis-open-context", (_event: any, context: AnalysisContext) => {
    search = emptyStockSearch();
    if (context.article) {
        search.article = context.article;
        search.exactArticle = context.article;
    } else if (context.supplierCode) {
        search.subjectCode = context.supplierCode;
        search.subjectKind = "supplier";
    } else if (context.customerCode) {
        search.subjectCode = context.customerCode;
        search.subjectKind = "customer";
    }
    search.scope = "all";
    renderFilters();
    render();
});
window.addEventListener("resize", () => {
    document.querySelectorAll<HTMLElement>(".stock-detail").forEach((panel) => {
        panel.style.width =
            Math.max(200, $("results").parentElement!.clientWidth - 40) + "px";
    });
});
void (async () => {
    let preferenceError: unknown;
    try {
        const result = await ipc.invoke("stock-analysis-preferences-load");
        if (!result.ok) throw Error(result.error);
        preferences = validateStockPreferences(result.preferences);
    } catch (e) {
        preferenceError = e;
    }
    renderPreferences();
    renderFilters();
    await load();
    if (preferenceError) report(preferenceError);
    ipc.send("analysis-context-ready");
})();
