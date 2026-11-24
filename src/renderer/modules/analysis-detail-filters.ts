import { materializeTableRows } from "./table-scroll-loader";
import { bindSortingHeaders, updateSortingBar } from "./table-sorting";
import type { SortCriterion } from "../../main/modules/analysis-sorting";
import {
    comparable,
    matchesDetailFilters,
    DetailRule,
    DetailFilters,
} from "../../main/modules/analysis-detail-filters";
const escape = (value: string) =>
    value.replace(
        /[&<>"']/g,
        (char) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[char]!,
    );
const instances = new WeakMap<HTMLTableElement, { refresh: () => void }>();
/** Filters the complete local detail, without changing its parent context or removing rows. */
export function enhanceDetailTable(table: HTMLTableElement, key: string) {
    const previous =
        (table as any)[Symbol.for("aypi.detailFilterController")] ||
        instances.get(table);
    if (previous) {
        previous.refresh();
        return;
    }
    if (!table.tHead || !table.tBodies.length || !table.tHead.rows.length)
        return;
    const labels = Array.from(table.tHead.rows[0].cells).map(
        (cell) =>
            cell.querySelector(".sort-header-button")?.firstChild
                ?.textContent ||
            cell.textContent ||
            "Colonna",
    );
    if (!labels.length) return;
    let filters: DetailFilters = { search: "", rules: [] },
        applying = false;
    const storageKey = "aypi.detail-filter-presets.v1:" + key;
    let presets: { name: string; filters: DetailFilters }[] = [];
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
        if (Array.isArray(saved))
            presets = saved
                .filter(
                    (p) =>
                        typeof p?.name === "string" &&
                        typeof p.filters?.search === "string" &&
                        Array.isArray(p.filters.rules) &&
                        p.filters.rules.length <= 100 &&
                        p.filters.rules.every(
                            (rule: any) =>
                                Number.isInteger(rule?.column) &&
                                ["contains", "exact", "not", "range"].includes(
                                    rule.op,
                                ) &&
                                typeof rule.value === "string" &&
                                typeof rule.to === "string",
                        ),
                )
                .slice(0, 20);
    } catch {}
    const toolbar = document.createElement("section");
    toolbar.className = "analysis-detail-filters";
    toolbar.setAttribute("aria-label", "Filtri del dettaglio");
    toolbar.innerHTML = `<div class="analysis-detail-tools"><label>Ricerca nel dettaglio<input type="search" data-detail-search placeholder="Articolo, descrizione, cliente…"></label><button type="button" data-detail-add>+ Condizione</button><button type="button" data-detail-reset>Azzera</button><span data-detail-count role="status"></span></div><div data-detail-rules></div><details class="analysis-filter-presets" data-filter-popover><summary>Preset filtri</summary><div class="analysis-preset-controls"><select data-detail-preset aria-label="Preset del dettaglio"></select><button type="button" data-detail-load>Carica</button><input data-detail-name maxlength="60" placeholder="Nome preset" aria-label="Nome preset del dettaglio"><button type="button" data-detail-save>Salva</button><button type="button" data-detail-delete>Elimina</button></div><span data-detail-message role="status"></span></details>`;
    const container = table.closest<HTMLElement>(".table-scroll") || table;
    container.before(toolbar);
    toolbar.addEventListener("keydown", (event) => {
        if (
            event.key === "Enter" &&
            (event.target as HTMLElement).matches("input")
        ) {
            event.preventDefault();
        }
    });
    const el = <T extends HTMLElement = HTMLElement>(selector: string) =>
        toolbar.querySelector<T>(selector)!;
    function renderPresets() {
        el<HTMLSelectElement>("[data-detail-preset]").innerHTML =
            '<option value="">Scegli preset</option>' +
            presets
                .map(
                    (p, i) => `<option value="${i}">${escape(p.name)}</option>`,
                )
                .join("");
    }
    function renderRules() {
        el("[data-detail-rules]").innerHTML = filters.rules
            .map(
                (rule, index) =>
                    `<div class="analysis-detail-rule" data-rule-index="${index}"><label>Campo<select data-rule-column>${labels.map((label, i) => `<option value="${i}" ${rule.column === i ? "selected" : ""}>${escape(label)}</option>`).join("")}</select></label><label>Condizione<select data-rule-op>${Object.entries(
                        {
                            contains: "Contiene",
                            exact: "Uguale a",
                            not: "Non contiene",
                            range: "Intervallo numero / data",
                        },
                    )
                        .map(
                            ([op, label]) =>
                                `<option value="${op}" ${rule.op === op ? "selected" : ""}>${label}</option>`,
                        )
                        .join(
                            "",
                        )}</select></label><label>${rule.op === "range" ? "Da" : "Valore"}<input data-rule-value value="${escape(rule.value)}"></label>${rule.op === "range" ? `<label>A<input data-rule-to value="${escape(rule.to)}"></label>` : ""}<button type="button" data-rule-remove aria-label="Rimuovi condizione">×</button></div>`,
            )
            .join("");
    }
    function apply() {
        if (applying || !table.isConnected) return;
        applying = true;
        try {
            const active = !!filters.search || filters.rules.length > 0;
            // The loader owns the full selection; materialize on demand before filtering.
            if (active) materializeTableRows(table);
            let count = 0,
                total = 0,
                previousVisible = true;
            for (const row of Array.from(table.tBodies[0]?.rows || [])) {
                if (
                    row.cells.length !== labels.length ||
                    Array.from(row.cells).some((cell) => cell.colSpan > 1)
                ) {
                    row.hidden = !previousVisible;
                    continue;
                }
                total++;
                const values = Array.from(row.cells).map(
                    (cell) =>
                        (cell.dataset.filterValue ??
                            cell.title.replace(/^Valore originale:\s*/i, "")) ||
                        cell.textContent ||
                        "",
                );
                const visible = matchesDetailFilters(values, filters);
                row.hidden = !visible;
                previousVisible = visible;
                if (visible) count++;
            }
            const note = `${count} / ${total} righe caricate`;
            if (el("[data-detail-count]").textContent !== note)
                el("[data-detail-count]").textContent = note;
        } finally {
            applying = false;
        }
    }
    renderPresets();
    el("[data-detail-search]").addEventListener("input", () => {
        filters.search = el<HTMLInputElement>("[data-detail-search]").value;
        apply();
    });
    el("[data-detail-add]").onclick = () => {
        filters.rules.push({ column: 0, op: "contains", value: "", to: "" });
        renderRules();
    };
    el("[data-detail-reset]").onclick = () => {
        filters = { search: "", rules: [] };
        el<HTMLInputElement>("[data-detail-search]").value = "";
        renderRules();
        apply();
    };
    el("[data-detail-rules]").addEventListener("input", (event) => {
        const target = event.target as HTMLInputElement,
            row = target.closest<HTMLElement>("[data-rule-index]");
        if (!row) return;
        const rule = filters.rules[Number(row.dataset.ruleIndex)];
        if (target.matches("[data-rule-value]")) rule.value = target.value;
        if (target.matches("[data-rule-to]")) rule.to = target.value;
        apply();
    });
    el("[data-detail-rules]").addEventListener("change", (event) => {
        const target = event.target as HTMLSelectElement,
            row = target.closest<HTMLElement>("[data-rule-index]");
        if (!row) return;
        const rule = filters.rules[Number(row.dataset.ruleIndex)];
        if (target.matches("[data-rule-column]")) rule.column = +target.value;
        if (target.matches("[data-rule-op]")) {
            rule.op = target.value as DetailRule["op"];
            renderRules();
        }
        apply();
    });
    el("[data-detail-rules]").addEventListener("click", (event) => {
        const remove = (event.target as HTMLElement).closest(
            "[data-rule-remove]",
        );
        if (remove) {
            filters.rules.splice(
                +remove.closest<HTMLElement>("[data-rule-index]")!.dataset
                    .ruleIndex!,
                1,
            );
            renderRules();
            apply();
        }
    });
    el("[data-detail-load]").onclick = () => {
        const preset =
            presets[+el<HTMLSelectElement>("[data-detail-preset]").value];
        if (
            !preset ||
            el<HTMLSelectElement>("[data-detail-preset]").value === ""
        )
            return;
        filters = structuredClone(preset.filters);
        filters.rules = filters.rules.filter(
            (rule) => rule.column >= 0 && rule.column < labels.length,
        );
        el<HTMLInputElement>("[data-detail-search]").value = filters.search;
        renderRules();
        apply();
    };
    const persist = () => {
        try {
            localStorage.setItem(storageKey, JSON.stringify(presets));
            renderPresets();
            el("[data-detail-message]").textContent =
                "Preset salvati su questo PC.";
        } catch {
            el("[data-detail-message]").textContent =
                "Impossibile salvare i preset.";
        }
    };
    el("[data-detail-save]").onclick = () => {
        const name = el<HTMLInputElement>("[data-detail-name]").value.trim();
        if (!name) {
            el("[data-detail-message]").textContent =
                "Indica un nome per il preset.";
            return;
        }
        const existing = presets.find((p) => p.name === name);
        if (existing) existing.filters = structuredClone(filters);
        else if (presets.length < 20)
            presets.push({ name, filters: structuredClone(filters) });
        else {
            el("[data-detail-message]").textContent = "Massimo 20 preset.";
            return;
        }
        persist();
    };
    el("[data-detail-delete]").onclick = () => {
        const value = el<HTMLSelectElement>("[data-detail-preset]").value;
        if (value !== "") {
            presets.splice(+value, 1);
            persist();
        }
    };
    let sorting: SortCriterion[] = [];
    const sortColumns = labels.map((label, index) => ({
        key: String(index),
        label,
    }));
    const raw = (cell?: HTMLTableCellElement) =>
        cell
            ? (cell.dataset.filterValue ??
                  cell.title.replace(/^Valore originale:\s*/i, "")) ||
              cell.textContent ||
              ""
            : "";
    const sort = (next: SortCriterion[]) => {
        sorting = next;
        materializeTableRows(table);
        const blocks: {
            row: HTMLTableRowElement;
            children: HTMLTableRowElement[];
        }[] = [];
        for (const row of Array.from(table.tBodies[0].rows)) {
            if (
                row.cells.length === labels.length &&
                !Array.from(row.cells).some((cell) => cell.colSpan > 1)
            )
                blocks.push({ row, children: [] });
            else if (blocks.length)
                blocks[blocks.length - 1].children.push(row);
        }
        blocks.sort((a, b) => {
            for (const criterion of sorting) {
                const left = raw(a.row.cells[+criterion.key]),
                    right = raw(b.row.cells[+criterion.key]),
                    ln = comparable(left),
                    rn = comparable(right);
                const order =
                    ln !== null && rn !== null
                        ? ln - rn
                        : left.localeCompare(right, "it", { numeric: true });
                if (order)
                    return criterion.direction === "asc" ? order : -order;
            }
            return 0;
        });
        table.tBodies[0].append(
            ...blocks.flatMap((block) => [block.row, ...block.children]),
        );
        bindSortingHeaders(table, sortColumns, sorting, sort);
        updateSortingBar(table, sortColumns, sorting, sort);
        apply();
    };
    if (!table.id) table.id = "detail-table-" + crypto.randomUUID();
    bindSortingHeaders(table, sortColumns, sorting, sort);
    updateSortingBar(table, sortColumns, sorting, sort);
    const controller = { refresh: apply };
    instances.set(table, controller);
    (table as any)[Symbol.for("aypi.detailFilterController")] = controller;
    apply();
}
