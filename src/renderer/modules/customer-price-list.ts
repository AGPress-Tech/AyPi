import { OVERVIEW_CHECKS, OverviewQuery, romeDay } from "../../main/modules/analysis-overview-model";
import { businessDetailedFilters } from "./business-detailed-filters";
import { bindSortingHeaders, updateSortingBar } from "./table-sorting";
import { bindAnalysisColumnPicker } from "./analysis-column-picker";
import type { SortCriterion } from "../../main/modules/analysis-sorting";
const ipc = require("electron").ipcRenderer;
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function mountCustomerPriceList(host: HTMLElement, changed: () => void) {
    const fields = OVERVIEW_CHECKS["customer-prices"].columns.filter(field => !["customerCode", "customerName"].includes(field.key));
    const defaults = ["article", "description", "price", "currency", "unit", "minimumQuantity", "validTo", "status"];
    let selected = new Set(defaults), customer: string | null = null, rows: any[] = [], total = 0, busy = false, exporting = false, generation = 0;
    let applied: OverviewQuery | null = null, sorting: SortCriterion[] = [];
    try { const saved = JSON.parse(localStorage.getItem("aypi.customer-prices.columns.v1") || "null"); if (Array.isArray(saved) && saved.some(key => fields.some(field => field.key === key))) selected = new Set(saved.filter(key => fields.some(field => field.key === key))); } catch {}
    host.innerHTML = `<article class="panel customer-price-panel"><form class="customer-filter-row customer-price-controls"><label>Prezzi<select data-price-scope><option value="current-prices">In validità oggi</option><option value="customer-prices">Tutto lo storico</option></select></label><label>Ricerca<input type="search" maxlength="128" data-price-search placeholder="Articolo, descrizione, listino…"></label><div data-price-filters></div><button type="submit" class="primary" data-price-load>Cerca</button><button type="button" data-price-reset>Azzera</button><details class="columns-picker" data-price-columns><summary>Colonne <span data-price-column-count></span></summary><div class="column-picker">${fields.map(field => `<label><input type="checkbox" data-price-column="${field.key}" ${selected.has(field.key) ? "checked" : ""}>${esc(field.label)}</label>`).join("")}</div></details></form><p data-price-status role="status">Seleziona e analizza un cliente per consultare il listino.</p><div class="table-scroll customer-price-scroll"><table id="customerPriceTable"><thead></thead><tbody></tbody></table></div><div class="customer-price-progress" data-price-progress></div><details class="analysis-information"><summary>Informazioni sul listino</summary><p>Prezzi dei listini assegnati al cliente e prezzi specifici cliente/articolo, con scaglioni, unità e validità separati. Il prezzo è quello registrato: sconti e IVA sono consultabili nelle colonne aggiuntive. La valuta assente nella fonte resta non indicata. Le date dei documenti delle altre sezioni non filtrano il listino.</p><p data-price-source></p></details></article>`;
    const q = <T extends HTMLElement = HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
    const table = q<HTMLTableElement>("table"), form = q<HTMLFormElement>("form"), search = q<HTMLInputElement>("[data-price-search]"), scope = q<HTMLSelectElement>("[data-price-scope]"), status = q("[data-price-status]"), scroll = q(".customer-price-scroll");
    const controls = () => { q<HTMLButtonElement>("[data-price-load]").disabled = !customer || busy; q("[data-price-column-count]").textContent = String(selected.size); };
    const dirty = () => { status.textContent = "Filtri modificati: premi Cerca per applicarli."; };
    const details = businessDetailedFilters(q("[data-price-filters]"), fields, { key: "customer-price-list", changed: dirty,
        extraRead: () => ({ search: search.value, scope: scope.value, columns: [...selected] }),
        extraSync: value => {
            if (!value || typeof value.search !== "string" || value.search.length > 128 || !["current-prices", "customer-prices"].includes(value.scope) || !Array.isArray(value.columns) || !value.columns.length || value.columns.some((key: string) => !fields.some(field => field.key === key))) throw Error("Preset del listino non valido.");
            search.value = value.search; scope.value = value.scope; selected = new Set(value.columns);
            host.querySelectorAll<HTMLInputElement>("[data-price-column]").forEach(input => input.checked = selected.has(input.dataset.priceColumn!));
            localStorage.setItem("aypi.customer-prices.columns.v1", JSON.stringify([...selected])); render();
        },
    });
    bindAnalysisColumnPicker(q<HTMLDetailsElement>("[data-price-columns]"));
    const visibleFields = () => fields.filter(field => selected.has(field.key));
    const markup = (row: any) => `<tr>${visibleFields().map(field => {
        const value = row[field.key]; let text = value == null || value === "" ? "—" : String(value);
        if (value != null && field.kind === "number") text = new Intl.NumberFormat("it-IT", { maximumFractionDigits: field.key === "price" || field.key.startsWith("discount") ? 20 : 3 }).format(Number(value));
        if (value && field.kind === "date") text = String(value).slice(0, 10).split("-").reverse().join("/");
        return `<td title="${esc(value)}"${field.key === "article" && value ? ` data-analysis-article="${esc(value)}"` : ""} class="${field.kind === "number" ? "numeric" : ""}">${esc(text)}</td>`;
    }).join("")}</tr>`;
    function render() {
        table.innerHTML = `<thead><tr>${visibleFields().map(field => `<th>${esc(field.label)}</th>`).join("")}</tr></thead><tbody>${rows.map(markup).join("")}</tbody>`;
        bindSortingHeaders(table, visibleFields(), sorting, value => { sorting = value; void load(); });
        updateSortingBar(table, fields, sorting, value => { sorting = value; void load(); });
        q("[data-price-progress]").textContent = customer && applied ? `${rows.length.toLocaleString("it-IT")} di ${total.toLocaleString("it-IT")} prezzi` : "";
        controls();
    }
    async function load(append = false) {
        if (!customer || busy || append && (!applied || rows.length >= total)) return;
        const current = ++generation; busy = true; controls(); changed();
        try {
            const query: OverviewQuery = append ? { ...applied!, offset: rows.length } : { check: scope.value as OverviewQuery["check"], search: search.value.trim(), sort: sorting, offset: 0, asOf: romeDay(), refresh: true, customerCode: customer, special: details.read(), columns: visibleFields().map(field => field.key) };
            status.textContent = "Caricamento del listino…";
            const result = await ipc.invoke("customer-prices-load", query);
            if (current !== generation) return;
            if (!result.ok) throw Error(result.error);
            total = result.total;
            if (append) { table.tBodies[0].insertAdjacentHTML("beforeend", result.rows.map(markup).join("")); rows.push(...result.rows); }
            else { applied = query; rows = result.rows; render(); scroll.scrollTop = 0; }
            q("[data-price-progress]").textContent = `${rows.length.toLocaleString("it-IT")} di ${total.toLocaleString("it-IT")} prezzi`;
            status.textContent = total ? "" : "Nessun prezzo per il cliente con questi filtri. Prova Tutto lo storico o modifica i criteri.";
            q("[data-price-source]").textContent = `Riferimento: ${query.asOf}. Dati letti: ${new Date(result.queriedAt).toLocaleString("it-IT")}.`;
        } catch (error) { if (current === generation) status.textContent = (error as Error).message + (applied ? " Restano visibili i prezzi precedenti." : ""); }
        finally { if (current === generation) { busy = false; controls(); changed(); } }
    }
    async function exportData() {
        if (!customer || !applied || busy || exporting) return;
        exporting = true; changed();
        try {
            const result = await ipc.invoke("customer-prices-export", { ...applied, columns: visibleFields().map(field => field.key) });
            if (!result.ok) throw Error(result.error);
            status.textContent = result.canceled ? "Esportazione annullata." : `${result.count.toLocaleString("it-IT")} prezzi esportati.`;
        } catch (error) { status.textContent = (error as Error).message; }
        finally { exporting = false; changed(); }
    }
    form.onsubmit = event => { event.preventDefault(); void load(); };
    search.oninput = dirty; scope.onchange = dirty;
    q("[data-price-reset]").onclick = () => { search.value = ""; scope.value = "current-prices"; sorting = []; details.sync(); void load(); };
    q("[data-price-columns]").onchange = event => {
        const input = event.target as HTMLInputElement; if (!input.dataset.priceColumn) return;
        if (input.checked) selected.add(input.dataset.priceColumn); else if (selected.size > 1) selected.delete(input.dataset.priceColumn); else input.checked = true;
        localStorage.setItem("aypi.customer-prices.columns.v1", JSON.stringify([...selected])); render(); changed();
    };
    scroll.onscroll = () => { if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 150) void load(true); };
    controls(); render();
    return {
        setCustomer(code: string | null) { if (code === customer) return; generation++; busy = false; customer = code; rows = []; total = 0; applied = null; search.value = ""; scope.value = "current-prices"; sorting = []; details.sync(); render(); q("[data-price-source]").textContent = ""; status.textContent = code ? "Premi Cerca per consultare il listino del cliente." : "Seleziona e analizza un cliente per consultare il listino."; changed(); },
        show() { if (customer && !applied && !busy) void load(); },
        refresh() { return load(); }, exportData, canExport: () => !!applied && !busy && !exporting,
    };
}
