import { MANAGER_TABLES } from "../../main/modules/analysis-manager-model";
import { romeDay } from "../../main/modules/analysis-overview-model";
import { continueTableOnScroll } from "./table-scroll-loader";
const ipc = require("electron").ipcRenderer;
const orderedAmountFormat = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const managerNumberFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
const managerNumber = (value: number, monetary = false) => (monetary ? orderedAmountFormat : managerNumberFormat).format(Math.abs(value) < 0.005 ? 0 : value);
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function mountManagerDashboard(host: HTMLElement, allowed: () => boolean, refreshLinks = () => {}) {
    const today = romeDay();
    host.innerHTML = `<form class="hub-control-form" data-manager-form><label>Ordini acquisiti e produzione · dal<input type="date" name="from" value="${Number(today.slice(0, 4)) - 2}-01-01" required></label><label>Al<input type="date" name="to" value="${today}" required></label><button type="submit" class="primary" data-manager-load>Carica riepilogo</button><button type="button" data-manager-export disabled>Esporta Excel</button></form><p role="status" data-manager-status>Carica il riepilogo aziendale.</p><div data-manager-results hidden><div class="manager-kpis" data-manager-kpis></div><div class="manager-panels" data-manager-panels></div></div>`;
    const form = host.querySelector<HTMLFormElement>("form")!, status = host.querySelector<HTMLElement>("[data-manager-status]")!;
    const loadButton = host.querySelector<HTMLButtonElement>("[data-manager-load]")!, exportButton = host.querySelector<HTMLButtonElement>("[data-manager-export]")!;
    let busy = false, exporting = false, loaded: any = null;
    const filters = () => ({ from: (form.elements.namedItem("from") as HTMLInputElement).value, to: (form.elements.namedItem("to") as HTMLInputElement).value, asOf: romeDay() });
    const refreshAccess = () => { loadButton.disabled = busy || !allowed(); exportButton.disabled = busy || exporting || !loaded || !allowed(); };
    const card = (label: string, value: unknown, danger = false, link?: string) => `<div class="manager-kpi${danger ? " attention" : ""}"><span>${esc(label)}</span><strong title="${esc(value)}">${value == null ? "—" : esc(Math.abs(Number(value)) >= 1000000 ? managerNumber(Number(value) / 1000000) + " M" : managerNumber(Number(value)))}</strong>${link ? `<button type="button" data-hub-target="${link}">${({ "customer-commitments": "Impegni clienti", "stock-analysis": "Giacenze", "article-orders": "Venduto", "customer-analysis": "Clienti" } as Record<string, string>)[link]} ↗</button>` : ""}</div>`;
    function render(data: any) {
        const backlog = data.backlog?.[0] || {}, acquired = data.acquired?.[0] || {};
        const zeroIfEmpty = (value: any) => value ?? (Number(backlog.rows) === 0 ? 0 : null);
        const money = new Map<string, { amount: number; missing: number; known: boolean }>();
        for (const row of data.monthly || []) {
            const group = money.get(row.currency) || { amount: 0, missing: 0, known: false };
            if (row.amount != null) { group.amount += Number(row.amount); group.known = true; }
            group.missing += Number(row.missingAmounts || 0); money.set(row.currency, group);
        }
        host.querySelector("[data-manager-kpis]")!.innerHTML = [
            ...[...money].map(([currency, value]) => card(`Ordinato ${value.missing ? "noto (parziale) " : ""}· ${currency}`, value.known ? value.amount : null)),
            card("Ordini acquisiti nel periodo", acquired.orders, false, "article-orders"), card("Clienti nel periodo", acquired.customers, false, "customer-analysis"),
            card("Ordini clienti ancora aperti", backlog.orders, false, "customer-commitments"), card("Righe ancora da soddisfare", backlog.rows, false, "customer-commitments"),
            card("Righe in ritardo", zeroIfEmpty(backlog.lateRows), true, "customer-commitments"), card("Righe senza data prevista", zeroIfEmpty(backlog.undatedRows), true, "customer-commitments"),
            card("Clienti con domanda aperta", backlog.customers), card("Articoli richiesti", backlog.articles),
            card("Posizioni con saldo negativo", data.stockError ? null : data.stock.reduce((sum: number, row: any) => sum + row.negativePositions, 0), true, "stock-analysis"),
        ].join("");
        const panels = host.querySelector<HTMLElement>("[data-manager-panels]")!;
        panels.innerHTML = MANAGER_TABLES.map(table => `<section class="manager-panel"><h3>${esc(table.title)}</h3>${table.key === "stock" && data.stockError ? `<p class="error">${esc(data.stockError)}</p>` : `<div class="table-scroll manager-table-scroll"><table class="hub-control-table" data-manager-table="${table.key}"><thead><tr>${table.columns.map(([, label]) => `<th>${esc(label)}</th>`).join("")}</tr></thead><tbody></tbody></table></div>`}</section>`).join("");
        for (const table of MANAGER_TABLES) {
            const element = panels.querySelector<HTMLTableElement>(`[data-manager-table="${table.key}"]`); if (!element) continue;
            const rows: any[] = data[table.key] || [];
            const append = (from: number, to: number) => element.tBodies[0].insertAdjacentHTML("beforeend", rows.slice(from, to).map(row => `<tr>${table.columns.map(([key]) => `<td${key === "customerName" || key === "customerCode" ? ` data-analysis-customer-code="${esc(row.customerCode)}"` : ""} class="${typeof row[key] === "number" ? "numeric" : ""}" title="${esc(row[key])}">${typeof row[key] === "number" ? esc(managerNumber(row[key], key === "amount" || key === "estimatedAmount")) : esc(row[key] ?? "—")}</td>`).join("")}</tr>`).join(""));
            append(0, 100);
            if (!rows.length) element.tBodies[0].innerHTML = `<tr><td colspan="${table.columns.length}">Nessun dato nel perimetro selezionato.</td></tr>`;
            continueTableOnScroll({ table: element, total: rows.length, initial: Math.min(100, rows.length), append });
        }
        host.querySelector<HTMLElement>("[data-manager-results]")!.hidden = false;
        refreshLinks();
    }
    form.onsubmit = async event => {
        event.preventDefault(); if (busy || !allowed()) return;
        busy = true; refreshAccess(); status.textContent = "Caricamento del riepilogo…";
        try {
            const query = filters(), data = await ipc.invoke("analysis-manager-load", query);
            if (!data.ok) throw Error(data.error);
            render(data); loaded = query; status.textContent = data.stockError || "";
        } catch (error) { status.textContent = (error as Error).message + (loaded ? " Restano visibili i dati precedenti." : ""); }
        finally { busy = false; refreshAccess(); }
    };
    exportButton.onclick = async () => {
        if (exporting || !loaded || !allowed()) return;
        exporting = true; refreshAccess();
        try { const result = await ipc.invoke("analysis-manager-export", loaded); if (!result.ok) throw Error(result.error); status.textContent = result.canceled ? "Esportazione annullata." : "Riepilogo esportato."; }
        catch (error) { status.textContent = (error as Error).message; }
        finally { exporting = false; refreshAccess(); }
    };
    refreshAccess(); return { refreshAccess };
}
