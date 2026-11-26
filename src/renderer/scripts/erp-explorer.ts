import { ERP_BLOCKS, ErpColumn, ErpPage, explorerCellContext, explorerContextRequest } from "../../main/modules/erp-explorer/model";
import type { AnalysisContext } from "../../main/modules/analysis-navigation-model";
import { specialFilterEditor } from "../modules/analysis-special-filter-editor";
import { recentAnalysisYears } from "../../main/modules/analysis-filter-modes";
import { bindSortingHeaders, setExpandedTableRow } from "../modules/table-sorting";
import { installAnalysisLinks } from "../modules/analysis-links";
import { contextFromAnalysisElement } from "../modules/document-links";
import { openDocumentDetails, openAnalysisDocumentDialog } from "../modules/document-details";
import { renderStockCustomerCommitments } from "../modules/stock-customer-commitments";
import { explorerColumns, explorerDefaultColumns, explorerRelations, formatExplorerValue as format } from "../../main/modules/erp-explorer/presentation";
const ipc = require("electron").ipcRenderer;
const $ = (id: string) => document.getElementById(id)!;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const records = new WeakMap<HTMLElement, { dataset: string; row: Record<string, any> }>();
const views = new Map<string, ExplorerTable>();
let active: ExplorerTable;
class ExplorerTable {
    page?: ErpPage; rows: Record<string, any>[] = []; columns: ErpColumn[] = []; visible: string[] = []; sorting: { key: string; direction: "asc" | "desc" }[] = [];
    loading = false; token = 0; applied: any; where: Record<string, any>; presets: any[] = [];
    openRecordAfterLoad = false;
    readonly form: HTMLFormElement; readonly result: HTMLElement; readonly table: HTMLTableElement; readonly scroll: HTMLElement; readonly special: ReturnType<typeof specialFilterEditor>;
    readonly status: HTMLElement; readonly progress: HTMLElement; readonly more: HTMLButtonElement;
    constructor(readonly host: HTMLElement, readonly dataset: string, where: Record<string, any> = {}, readonly nested = false, readonly fixedContext = false) {
        this.where = where;
        const dated = ["orders", "purchaseOrders", "contracts", "offers", "production", "productionEntries"].includes(dataset);
        const years = recentAnalysisYears();
        host.className = nested ? "erp-nested" : "erp-view";
        host.innerHTML = `<form class="${nested ? "erp-child-filters" : "filter-panel aypi-filter-panel"}">${nested ? "" : '<div class="filter-heading"><span class="eyebrow">CRITERI DI RICERCA</span><h2>Trova nel gestionale</h2></div>'}<div class="${nested ? "erp-child-filters" : "filter-scroll"}">
        ${!nested && ["orders", "purchaseOrders", "offers", "production"].includes(dataset) ? `<label>Documenti<select data-document-scope><option value="orders">Ordini clienti</option><option value="purchaseOrders">Ordini fornitori</option><option value="production">Ordini produzione</option><option value="offers">Offerte clienti</option></select></label>` : ""}
        <label>Ricerca libera<input type="search" data-search maxlength="256" placeholder="Codice, descrizione, dati anagrafici…"></label>
        ${dated ? `<label>Dal<input type="date" data-from value="${!nested && !Object.keys(where).length ? years[0] + "-01-01" : ""}"></label><label>Al<input type="date" data-to value="${!nested && !Object.keys(where).length ? years[2] + "-12-31" : ""}"></label>` : ""}
        ${dataset === "stock" ? '<label>Esercizio<input type="number" data-year min="1900" max="9999" placeholder="Ultimo disponibile"></label><label>Periodo<input type="number" data-period min="1" max="99" placeholder="Ultimo disponibile"></label>' : ""}
        <div class="erp-context" data-context></div></div><div class="filter-actions"><button type="submit" class="primary">Cerca</button><button type="button" data-reset>Azzera</button></div></form>
        <section class="erp-results"><div class="section-heading"><h2 data-title>Caricamento…</h2><details class="columns-picker"><summary>Colonne <span data-column-count></span></summary><div class="column-picker" data-columns></div></details></div><p role="status"></p><div class="table-scroll" tabindex="0"><table class="erp-table"><thead></thead><tbody></tbody></table></div><div class="results-footer"><span data-progress></span><button type="button" data-more hidden>Carica altri risultati</button></div><details class="analysis-information"><summary>Informazioni sui dati</summary><div class="erp-information">Lettura del gestionale senza modifiche. Le tabelle mostrano i dati operativi essenziali. Le quantit? sono visualizzate con massimo tre decimali; tooltip ed Excel conservano i valori originali. Magazzino: un solo esercizio e periodo alla volta; gli impegni clienti mostrano gli ordini aperti attuali. Ricevuto, ordinato in produzione e prodotto sono campi distinti, mostrati solo se presenti nella fonte. I contratti sono identificati dal suffisso /C.</div></details></section>`;
        this.form = host.querySelector("form")!; this.result = host.querySelector(".erp-results")!; this.table = host.querySelector("table")!; this.scroll = this.table.closest<HTMLElement>(".table-scroll")!;
        this.status = host.querySelector("[role=status]")!; this.progress = host.querySelector("[data-progress]")!; this.more = host.querySelector("[data-more]")!;
        let specialHost: HTMLElement = this.form;
        if (nested) {
            const advanced = document.createElement("details"); advanced.className = "advanced-filters";
            advanced.innerHTML = '<summary>Altri filtri</summary><div class="advanced-filter-popup"></div>';
            this.form.querySelector(".filter-actions")!.before(advanced);
            specialHost = advanced.querySelector<HTMLElement>("div")!;
        }
        this.special = specialFilterEditor(specialHost, () => this.columns, () => void this.load());
        this.form.querySelector<HTMLButtonElement>("[data-special-create]")!.disabled = true;
        this.form.onsubmit = event => { event.preventDefault(); void this.load(); };
        this.form.querySelector<HTMLButtonElement>("[data-reset]")!.onclick = () => {
            this.form.querySelectorAll<HTMLInputElement>("input").forEach(input => input.value = ""); if (!this.fixedContext) this.where = {}; this.special.sync(); this.sorting = []; this.renderContext(); void this.load();
        };
        this.more.onclick = () => void this.load(true);
        this.scroll.onscroll = () => { if (this.scroll.scrollHeight - this.scroll.scrollTop - this.scroll.clientHeight < 140) void this.load(true); };
        const scope = this.form.querySelector<HTMLSelectElement>("[data-document-scope]");
        if (scope) { scope.value = dataset; scope.onchange = () => activate(scope.value); }
        for (const event of ["input", "change"]) this.form.addEventListener(event, () => this.syncExport());
        this.host.querySelector("[data-columns]")!.addEventListener("change", event => {
            const input = event.target as HTMLInputElement;
            if (!input.dataset.key) return;
            if (input.checked) this.visible = [...new Set([...this.visible, input.dataset.key])]; else this.visible = this.visible.filter(k => k !== input.dataset.key);
            if (!this.visible.length) { this.visible.push(input.dataset.key); input.checked = true; }
            this.saveColumns(); this.renderTable(); this.renderColumnCount();
        });
        this.renderContext(); this.mountPresets();
    }
    private storage(key: string) { return `aypi.erp-explorer.${key}.${key === "columns" ? "v2" : "v1"}:${this.dataset}`; }
    syncExport() {
        if (active !== this) return;
        let changed = true; try { changed = !this.applied || JSON.stringify(this.read()) !== JSON.stringify(this.applied); } catch {}
        ($("export") as HTMLButtonElement).disabled = this.loading || changed;
    }
    private saveColumns() { try { localStorage.setItem(this.storage("columns"), JSON.stringify(this.visible)); } catch {} }
    private renderColumnCount() { this.host.querySelector("[data-column-count]")!.textContent = String(this.visible.length); }
    private message(text: string, error = false) { this.status.textContent = text; this.status.classList.toggle("error", error); }
    private renderContext() {
        const node = this.form.querySelector<HTMLElement>("[data-context]")!;
        if (this.fixedContext) { node.replaceChildren(); return; }
        node.innerHTML = Object.keys(this.where).length ? `<span>Contesto esatto: ${esc(Object.entries(this.where).map(([key, value]) => `${this.columns.find(c => c.key === key)?.label || "Selezione collegata"}: ${/Id$|Type$/.test(key) ? "attiva" : value}`).join(" · "))}</span><br><button type="button">Rimuovi contesto</button>` : "";
        const button = node.querySelector("button"); if (button) button.onclick = () => { this.where = {}; this.renderContext(); void this.load(); };
    }
    read() {
        const input: any = { dataset: this.dataset, search: this.form.querySelector<HTMLInputElement>("[data-search]")!.value, where: this.where, special: this.special.read(), sort: this.sorting };
        for (const key of ["from", "to", "year", "period"]) { const field = this.form.querySelector<HTMLInputElement>(`[data-${key}]`); if (field?.value) input[key] = ["year", "period"].includes(key) ? Number(field.value) : field.value; }
        return input;
    }
    async load(append = false) {
        if (this.loading && append) return;
        if (append && (!this.page || this.rows.length >= this.page.total)) return;
        const token = ++this.token; this.loading = true; this.message("Lettura del gestionale…"); this.syncExport();
        this.form.querySelector<HTMLButtonElement>('[type=submit]')!.disabled = true;
        try {
            const input = append ? this.applied : this.read();
            const result = await ipc.invoke("erp-explorer-query", { ...input, offset: append ? this.rows.length : 0, limit: 250 });
            if (token !== this.token || !this.host.isConnected) return;
            if (!result.ok) throw Error(result.error);
            const page: ErpPage = result;
            this.page = page; this.columns = explorerColumns(this.dataset, page.columns);
            this.form.querySelector<HTMLButtonElement>("[data-special-create]")!.disabled = !this.columns.length;
            if (!append) { this.applied = input; this.rows = []; this.scroll.scrollTop = 0; }
            if (!this.visible.length) {
                let saved: unknown; try { saved = JSON.parse(localStorage.getItem(this.storage("columns")) || "null"); } catch {}
                this.visible = (Array.isArray(saved) ? saved : explorerDefaultColumns[this.dataset] || this.columns.slice(0, 6).map(c => c.key)).filter(key => this.columns.some(c => c.key === key));
                if (!this.visible.length) this.visible = this.columns.slice(0, 6).map(c => c.key);
            }
            this.visible = this.visible.filter(key => this.columns.some(c => c.key === key));
            if (!this.visible.length) this.visible = this.columns.slice(0, 6).map(c => c.key);
            const from = this.rows.length; this.rows.push(...page.rows);
            this.host.querySelector("[data-title]")!.textContent = page.label;
            if (!append) this.host.querySelector("[data-columns]")!.innerHTML = this.columns.map(c => `<label><input type="checkbox" data-key="${esc(c.key)}" ${this.visible.includes(c.key) ? "checked" : ""}>${esc(c.label)}</label>`).join("");
            this.renderColumnCount(); if (!append) this.renderContext();
            if (append) this.appendRows(from, this.rows.length); else this.renderTable();
            const total = append && !page.rows.length ? this.rows.length : page.total;
            this.page.total = total;
            this.progress.textContent = `${this.rows.length.toLocaleString("it-IT")} di ${total.toLocaleString("it-IT")} righe${page.period ? ` · ${page.period.year} / ${page.period.period}` : ""}`;
            this.more.hidden = this.rows.length >= total;
            this.message(this.rows.length ? "" : "Nessun risultato per i filtri selezionati.");
            if (!append && this.openRecordAfterLoad) {
                this.openRecordAfterLoad = false;
                if (active === this && this.rows.length === 1) {
                    const parent = this.table.tBodies[0].rows[0];
                    const opener = parent?.querySelector<HTMLElement>("[data-erp-document]") || parent?.querySelector<HTMLElement>(".erp-expand");
                    if (opener) this.openRecordDialog(opener, this.rows[0]);
                }
            }
        } catch (error) { if (token === this.token) { this.openRecordAfterLoad = false; this.message((error as Error).message, true); } }
        finally { if (token === this.token) { this.loading = false; this.form.querySelector<HTMLButtonElement>('[type=submit]')!.disabled = false; this.syncExport(); } }
    }
    private activeColumns() { return this.visible.map(key => this.columns.find(c => c.key === key)!).filter(Boolean); }
    private renderTable() {
        const columns = this.activeColumns();
        this.table.tHead!.innerHTML = `<tr>${columns.map(c => `<th data-sort-key="${esc(c.key)}" class="${c.kind === "number" ? "numeric" : ""}" title="${esc(c.label)}">${esc(c.label)}</th>`).join("")}</tr>`;
        this.table.tBodies[0].replaceChildren(); this.appendRows(0, this.rows.length);
        bindSortingHeaders(this.table, columns, this.sorting, sort => { this.sorting = sort; void this.load(); });
    }
    private appendRows(from: number, to: number) {
        const columns = this.activeColumns(), body = this.table.tBodies[0];
        for (let index = from; index < to; index++) {
            const row = this.rows[index], tr = document.createElement("tr");
            tr.dataset.erpRecord = ""; records.set(tr, { dataset: this.dataset, row });
            tr.innerHTML = columns.map((c, i) => {
                const context = explorerCellContext(this.dataset, row, c.key), document = context?.documentId && context.documentKind;
                const erpIdentity = context?.purchaseOrderId || context?.productionOrderId || context?.contractId;
                return `<td data-erp-field="${esc(c.key)}" class="${c.kind === "number" ? "numeric" : ""}" title="${esc(row[c.key])}">${i === 0 ? '<button type="button" class="erp-expand" aria-expanded="false" aria-label="Esplodi dettaglio">▸</button>' : ""}${document ? `<button type="button" class="document-link" data-document-kind="${context.documentKind}" data-document-id="${context.documentId}" data-document-no="${esc(context.documentNo)}">${esc(format(row[c.key], c))}</button>` : erpIdentity ? `<button type="button" class="document-link" data-erp-document="${esc(c.key)}">${esc(format(row[c.key], c))}</button>` : esc(format(row[c.key], c))}</td>`;
            }).join("");
            tr.querySelector<HTMLButtonElement>(".erp-expand")!.onclick = event => { event.stopPropagation(); this.expand(tr, row); };
            tr.querySelectorAll<HTMLButtonElement>("[data-document-id]").forEach(button => button.onclick = () => openDocumentDetails(button, button.dataset.documentKind as "order" | "offer", Number(button.dataset.documentId), button.dataset.documentNo!));
            tr.querySelectorAll<HTMLButtonElement>("[data-erp-document]").forEach(button => button.onclick = () => {
                const context = explorerCellContext(this.dataset, row, button.dataset.erpDocument!)!;
                const request = explorerContextRequest(context);
                if (request.dataset === this.dataset) this.openRecordDialog(button, row);
                else activate(request.dataset, request.where, true);
            });
            body.append(tr);
        }
    }
    private expand(parent: HTMLTableRowElement, row: Record<string, any>) {
        const button = parent.querySelector<HTMLButtonElement>(".erp-expand")!;
        if (parent.nextElementSibling?.classList.contains("erp-detail-row")) { setExpandedTableRow(parent, null); parent.nextElementSibling.remove(); button.textContent = "▸"; button.setAttribute("aria-expanded", "false"); return; }
        const tr = document.createElement("tr"), cell = document.createElement("td"); tr.className = "erp-detail-row"; cell.colSpan = this.visible.length; tr.append(cell); setExpandedTableRow(parent, tr); parent.after(tr);
        button.textContent = "▾"; button.setAttribute("aria-expanded", "true");
        const detail = document.createElement("div"); detail.className = "erp-record-details"; detail.dataset.erpRecord = ""; records.set(detail, { dataset: this.dataset, row }); cell.append(detail);
        detail.style.width = Math.max(200, this.scroll.clientWidth - 28) + "px";
        this.renderRecordDetails(detail, row);
    }
    private openRecordDialog(opener: HTMLElement, row: Record<string, any>) {
        const keys = this.page?.keys || [];
        const identity = JSON.stringify([this.dataset, keys.length ? keys.map(key => row[key]) : row]);
        for (const existing of document.querySelectorAll<HTMLDialogElement>(".analysis-document-dialog")) {
            if (existing.dataset.erpIdentity === identity && existing.open) { existing.focus(); return; }
            existing.close();
        }
        const kind = ({ purchaseOrders: "Ordine fornitore", contracts: "Contratto fornitore", production: "Ordine di produzione" })[this.dataset] || "Documento";
        const label = kind + " " + String(row.InternalOrdNo || row.QuotationNo || row.MONo || row._DocumentNo || "");
        const dialog = openAnalysisDocumentDialog(opener, label, host => {
            host.classList.add("analysis-document-details");
            host.innerHTML = `<div class="analysis-document-content"><h3>${esc(label)}</h3><div class="erp-record-details" data-erp-record></div></div>`;
            const detail = host.querySelector<HTMLElement>(".erp-record-details")!;
            records.set(detail, { dataset: this.dataset, row });
            this.renderRecordDetails(detail, row, true);
        });
        dialog.dataset.erpIdentity = identity;
    }
    private renderRecordDetails(detail: HTMLElement, row: Record<string, any>, complete = false) {
        const useful = this.columns.filter(c => (complete || !this.visible.includes(c.key)) && row[c.key] != null && row[c.key] !== "" && (complete || c.kind !== "boolean" || !!row[c.key]) && (this.dataset !== "stock" || c.kind !== "number" || Number(row[c.key]) !== 0));
        detail.innerHTML = useful.length ? `<details ${complete ? "open" : ""}><summary>${complete ? "Dati del documento" : this.dataset === "stock" ? "Impegni e movimenti" : "Altre informazioni"}</summary><dl class="erp-record-fields">${useful.map(c => `<div><dt>${esc(c.label)}</dt><dd data-erp-field="${esc(c.key)}" title="${esc(row[c.key])}">${esc(format(row[c.key], c))}</dd></div>`).join("")}</dl></details>` : "";
        for (const relation of explorerRelations(this.page?.relations || [])) {
            if (Object.keys(relation.map).some(key => row[key] == null || row[key] === "")) continue;
            const details = document.createElement("details"); details.innerHTML = `<summary>${esc(relation.label)}</summary><div></div>`; detail.append(details); let child: ExplorerTable | undefined;
            const load = () => { if (details.open && !child) { child = new ExplorerTable(details.querySelector("div")!, relation.target, Object.fromEntries(Object.entries(relation.map).map(([from, to]) => [to, row[from]])), true, complete); void child.load(); } };
            details.addEventListener("toggle", load);
            if (complete && relation.id === "lines") { details.open = true; load(); }
        }
        if (["stock", "articles"].includes(this.dataset) && row.Item) {
            const demand = document.createElement("details"); demand.innerHTML = '<summary>Ordini clienti aperti · residuo, allocato e prelevato</summary><div></div>'; detail.append(demand); let requested = false;
            demand.addEventListener("toggle", () => { if (demand.open && !requested) { requested = true; void renderStockCustomerCommitments(demand.querySelector("div")!, row.Item, "erp-explorer-commitments"); } });
        }
    }
    private mountPresets() {
        if (this.nested) return;
        try { const saved = JSON.parse(localStorage.getItem(this.storage("presets")) || "[]"); if (Array.isArray(saved)) this.presets = saved.filter(p => typeof p?.name === "string" && p.query).slice(0, 20); } catch {}
        const details = document.createElement("details"); details.className = "analysis-filter-presets";
        details.innerHTML = '<summary>Preset di ricerca</summary><div class="erp-preset-controls"><select aria-label="Preset di ricerca"></select><input maxlength="60" placeholder="Nome preset" aria-label="Nome preset"><button type="button" data-save>Salva</button><button type="button" data-load>Carica</button><button type="button" data-delete>Elimina</button></div>';
        this.form.append(details); const select = details.querySelector("select")!;
        const render = () => select.innerHTML = '<option value="">Scegli preset</option>' + this.presets.map((p, i) => `<option value="${i}">${esc(p.name)}</option>`).join("");
        const persist = () => { localStorage.setItem(this.storage("presets"), JSON.stringify(this.presets)); render(); };
        details.querySelector<HTMLButtonElement>("[data-save]")!.onclick = () => { try { const name = details.querySelector("input")!.value.trim(); if (!name) throw Error("Indica un nome per il preset."); const saved = { name, query: this.read(), columns: this.visible }; const existing = this.presets.findIndex(p => p.name === name); if (existing >= 0) this.presets[existing] = saved; else { if (this.presets.length >= 20) throw Error("Massimo venti preset."); this.presets.push(saved); } persist(); this.message("Preset salvato su questo PC."); } catch (error) { this.message((error as Error).message, true); } };
        details.querySelector<HTMLButtonElement>("[data-load]")!.onclick = () => { try { if (!select.value) return; const p = this.presets[Number(select.value)]; for (const key of ["search", "from", "to", "year", "period"]) { const field = this.form.querySelector<HTMLInputElement>(`[data-${key}]`); if (field) field.value = p.query[key] ?? ""; } this.where = p.query.where || {}; this.sorting = p.query.sort || []; this.visible = Array.isArray(p.columns) ? p.columns.filter((key: string) => this.columns.some(c => c.key === key)) : []; this.special.sync(p.query.special); void this.load(); } catch (error) { this.message((error as Error).message, true); } };
        details.querySelector<HTMLButtonElement>("[data-delete]")!.onclick = () => { if (select.value) { this.presets.splice(Number(select.value), 1); try { persist(); } catch (error) { this.message((error as Error).message, true); } } };
        render();
    }
    async export() {
        if (!this.applied) return;
        const result = await ipc.invoke("erp-explorer-export", { query: this.applied, columns: this.visible });
        if (!result.ok && !result.cancelled) this.message(result.error, true);
        else if (result.ok) this.message(`Esportate ${result.count.toLocaleString("it-IT")} righe.`);
    }
}
function activate(dataset: string, where?: Record<string, any>, showDocument = false) {
    let view = views.get(dataset);
    if (!view) { const host = document.createElement("section"); $("views").append(host); view = new ExplorerTable(host, dataset, where); views.set(dataset, view); }
    for (const other of views.values()) other.host.hidden = other !== view;
    active = view;
    view.openRecordAfterLoad = showDocument;
    view.syncExport();
    if (where) { view.where = where; view.form.querySelectorAll<HTMLInputElement>("input").forEach(field => field.value = ""); view.special.sync(); }
    const block = ["purchaseOrders", "offers", "production"].includes(dataset) ? "orders" : dataset;
    $("blocks").querySelectorAll<HTMLButtonElement>("[data-block]").forEach(button => { const selected = button.dataset.block === block; button.classList.toggle("active", selected); button.setAttribute("aria-pressed", String(selected)); });
    if (!view.page || where) void view.load();
}
$("blocks").innerHTML = ERP_BLOCKS.map(block => `<button type="button" data-block="${block.id}">${esc(block.label)}</button>`).join("");
$("blocks").onclick = event => { const button = (event.target as HTMLElement).closest<HTMLElement>("[data-block]"); if (button) activate(button.dataset.block!); };
$("refresh").onclick = () => void active?.load();
$("export").onclick = async () => { const button = $("export") as HTMLButtonElement; button.disabled = true; try { await active?.export(); } finally { button.disabled = false; } };
$("close").onclick = () => ipc.send("erp-explorer-close");
window.addEventListener("resize", () => document.querySelectorAll<HTMLElement>(".erp-record-details").forEach(detail => {
    const scroll = detail.closest("table")?.closest<HTMLElement>(".table-scroll");
    if (scroll?.clientWidth) detail.style.width = Math.max(200, scroll.clientWidth - 28) + "px";
}));
installAnalysisLinks(target => {
    const shared = contextFromAnalysisElement(target); if (shared) return shared;
    const cell = target.closest<HTMLElement>("[data-erp-field]"), parent = cell?.closest<HTMLElement>("[data-erp-record]");
    const source = parent ? records.get(parent) : null;
    return source && cell ? explorerCellContext(source.dataset, source.row, cell.dataset.erpField!) : null;
}, message => { const status = active?.status; if (status) status.textContent = message; });
ipc.on("analysis-open-context", (_event: unknown, context: AnalysisContext) => { const query = explorerContextRequest(context); activate(query.dataset, query.where, !!(context.purchaseOrderId || context.productionOrderId || context.contractId)); });
activate("customers");
ipc.send("analysis-context-ready");
