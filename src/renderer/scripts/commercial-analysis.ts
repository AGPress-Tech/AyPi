const { ipcRenderer: ipc } = require("electron");
import { stationAccess, stationCatalog } from "../../main/modules/workstations-model";
import { OVERVIEW_AREAS, OVERVIEW_CHECKS, OverviewCheck, OverviewQuery, romeDay } from "../../main/modules/analysis-overview-model";
import type { SortCriterion } from "../../main/modules/analysis-sorting";
import { bindSortingHeaders, updateSortingBar } from "../modules/table-sorting";
import { installAnalysisLinks } from "../modules/analysis-links";
import { contextFromAnalysisElement, formatDocumentQuantity } from "../modules/document-links";
import { openDocumentDetails } from "../modules/document-details";
import { mountManagerDashboard } from "../modules/manager-dashboard";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const view = new URLSearchParams(location.search).get("view") || "catalog";
let exactContext: { article?: string; customerCode?: string } = {};
let station: any, area = OVERVIEW_AREAS.find(item => item.id === "deliveries")!, loading = false, exporting = false, token = 0;
let rows: any[] = [], total = 0, applied: OverviewQuery | null = null, sort: SortCriterion[] = [];
const check = () => $("overviewCheck") as HTMLSelectElement;
const access = (target: string) => {
    const entry = stationCatalog.find(item => item.target === target);
    return station && entry ? stationAccess(station.config, entry.id) : "hidden";
};
const managerDashboard = mountManagerDashboard($("managerDashboard"), () => access("manager") === "accessible", () => applyStation());
function applyStation(snapshot = station) {
    station = snapshot;
    document.querySelectorAll<HTMLButtonElement>("[data-analysis],[data-hub-target]").forEach(button => {
        const state = access(button.dataset.analysis || button.dataset.hubTarget!);
        button.hidden = state === "hidden"; button.disabled = state !== "accessible";
    });
    const permitted = !!check().value && access(OVERVIEW_CHECKS[check().value as OverviewCheck].target) === "accessible";
    $("overviewLoad").toggleAttribute("disabled", loading || !permitted);
    $("overviewExport").toggleAttribute("disabled", loading || exporting || !applied || !permitted);
    managerDashboard.refreshAccess();
}
function message(value: string, error = false) { $("overviewStatus").textContent = value; $("overviewStatus").classList.toggle("error", error); }
function resetResults() {
    if (["customer-prices", "current-prices"].includes(check().value)) $("overviewSearch").setAttribute("placeholder", "Cliente, articolo, nome o codice listino");
    if (check().value === "customer-commitments") $("overviewSearch").setAttribute("placeholder", "Cliente, ordine, articolo o magazzino");
    token++; loading = false; rows = []; total = 0; applied = null; sort = [];
    $("overviewResults").hidden = true; $("overviewTable").innerHTML = "<thead></thead><tbody></tbody>";
    $("overviewTableSorting")?.remove(); $("overviewLoad").textContent = "Carica controllo";
    message("Scegli un controllo e carica i dati."); applyStation();
}
function selectArea(id: string) {
    area = OVERVIEW_AREAS.find(item => item.id === id)!;
    if (view === "customer-commitments") area = { ...area, question: "Impegni clienti", description: "Domanda da soddisfare e impegni registrati nei saldi ERP, in due letture separate.", checks: ["customer-commitments", "reserved-stock"] };
    document.querySelectorAll<HTMLElement>("[data-hub-area]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.hubArea === id)));
    $("areaQuestion").textContent = area.question; $("areaDescription").textContent = area.description;
    $("areaAvailability").textContent = id === "management" ? "Riepilogo aziendale" : area.checks.length ? "Controlli disponibili" : "Moduli collegati";
    $("areaLinks").innerHTML = area.links.filter(link => link.target !== view).map(link => `<button type="button" data-hub-target="${link.target}">${esc(link.label)} ↗</button>`).join("");
    $("overviewControl").hidden = !area.checks.length || id === "management";
    $("managerDashboard").hidden = id !== "management";
    document.querySelector<HTMLElement>(".hub-next-step")!.hidden = id === "management" || ["customer-prices", "customer-commitments"].includes(view);
    check().innerHTML = area.checks.map(key => `<option value="${key}">${esc(OVERVIEW_CHECKS[key].label)}</option>`).join("");
    $("overviewSearch").setAttribute("placeholder", id === "materials" ? "Articolo, descrizione, magazzino o soggetto" : "Articolo, descrizione, ordine o cliente");
    ($("overviewSearch") as HTMLInputElement).value = "";
    $("nextTitle").textContent = area.next; $("nextBenefit").textContent = area.benefit; $("nextNeeded").textContent = area.needed;
    resetResults();
}
function rowMarkup(row: any) {
    return `<tr>${OVERVIEW_CHECKS[check().value as OverviewCheck].columns.map(column => {
        const value = row[column.key]; let attrs = "", content = esc(value ?? "—");
        if (column.kind === "number") content = esc((column.key === "price" || column.key.startsWith("discount")) && value != null ? new Intl.NumberFormat("it-IT", { maximumFractionDigits: 20 }).format(Number(value)) : formatDocumentQuantity(value));
        if (column.kind === "date") content = value ? esc(String(value).slice(0, 10).split("-").reverse().join("/")) : "—";
        if (column.key === "article" && value) {
            attrs = ` data-analysis-article="${esc(value)}"`;
            if (access("stock-analysis") === "accessible") content = `<button class="document-link" data-hub-article="${esc(value)}">${content}</button>`;
        }
        if (column.key === "orderNo" && row.orderId) {
            attrs = ` data-analysis-document-id="${esc(row.orderId)}" data-analysis-document-no="${esc(value)}" data-analysis-document-kind="order"`;
            content = `<button class="document-link" data-hub-order="${esc(row.orderId)}" data-order-no="${esc(value)}">${content}</button>`;
        }
        if (["customerName", "customerCode"].includes(column.key) && row.customerCode && row.customerType !== "Contatto") attrs = ` data-analysis-customer-code="${esc(row.customerCode)}"`;
        return `<td${attrs} class="${column.kind === "number" ? "numeric" : ""}" title="${esc(value)}">${content}</td>`;
    }).join("")}</tr>`;
}
async function load(append = false, refresh = false) {
    if (loading || append && (!applied || rows.length >= total)) return;
    const current = ++token;
    const query: OverviewQuery = append ? { ...applied!, offset: rows.length, refresh: false } : {
        check: check().value as OverviewCheck, search: ($("overviewSearch") as HTMLInputElement).value.trim(), sort, offset: 0, asOf: refresh ? romeDay() : applied?.asOf || romeDay(), refresh, ...exactContext,
    };
    loading = true; applyStation(); $("overviewResults").setAttribute("aria-busy", "true"); message("Caricamento in corso…");
    try {
        const result = await ipc.invoke("analysis-overview-load", query);
        if (current !== token) return;
        if (!result.ok) throw Error(result.error);
        const table = $<HTMLTableElement>("overviewTable");
        if (!append) {
            applied = { ...query, refresh: false }; rows = [];
            table.innerHTML = `<thead><tr>${OVERVIEW_CHECKS[query.check].columns.map(column => `<th>${esc(column.label)}</th>`).join("")}</tr></thead><tbody></tbody>`;
            $("overviewScroll").scrollTop = 0;
            const change = (next: SortCriterion[]) => { sort = next; void load(); };
            bindSortingHeaders(table, OVERVIEW_CHECKS[query.check].columns, sort, change);
            updateSortingBar(table, OVERVIEW_CHECKS[query.check].columns, sort, change);
        }
        rows.push(...result.rows); total = result.total;
        if (append && !result.rows.length) total = rows.length;
        table.tBodies[0].insertAdjacentHTML("beforeend", result.rows.map(rowMarkup).join(""));
        $("overviewResults").hidden = false;
        if (!append) $("overviewScroll").scrollTop = 0;
        const label = ["customer-prices", "current-prices"].includes(query.check) ? total === 1 ? "prezzo" : "prezzi" : query.check === "reserved-stock" ? "posizioni impegnate" : query.check === "customer-commitments" ? "righe aperte" : query.check === "negative-stock" ? "posizioni da verificare" : "righe da verificare";
        $("overviewCount").textContent = `${total.toLocaleString("it-IT")} ${label}`;
        $("overviewApplied").textContent = [query.search ? `Ricerca: ${query.search}` : "", query.article ? `Articolo: ${query.article}` : "", query.customerCode ? `Cliente: ${query.customerCode}` : ""].filter(Boolean).join(" · ");
        $("overviewProgress").textContent = `${rows.length.toLocaleString("it-IT")} di ${total.toLocaleString("it-IT")} righe`;
        $("overviewProgress").nextElementSibling?.toggleAttribute("hidden", rows.length >= total);
        $("overviewLoad").textContent = "Aggiorna controllo"; message(total ? "" : "Nessuna riga corrisponde al controllo.");
    } catch (error) { if (current === token) message(`${(error as Error).message}${applied ? " Restano visibili i risultati precedenti." : ""}`, true); }
    finally { if (current === token) { loading = false; $("overviewResults").setAttribute("aria-busy", "false"); applyStation(); } }
}
$("overviewAreas").innerHTML = OVERVIEW_AREAS.map(item => `<button type="button" data-hub-area="${item.id}" aria-pressed="false">${esc(item.label)}</button>`).join("");
document.querySelectorAll<HTMLElement>("[data-hub-area]").forEach(button => button.onclick = () => selectArea(button.dataset.hubArea!));
const operational = view !== "catalog";
$("operationalView").hidden = !operational; $("catalogView").hidden = operational;
document.body.classList.toggle("hub-catalog-only", !operational);
if (operational) {
    const title = ({ "customer-prices": "Listino clienti", "customer-commitments": "Impegni clienti", manager: "Manager" } as Record<string, string>)[view] || "Analisi gestionali";
    document.querySelector("h1")!.textContent = title;
    document.title = `AyPi · ${title}`;
    if (view !== "operational") { $("overviewAreas").hidden = true; document.querySelector<HTMLElement>(".hub-introduction")!.hidden = true; }
}
$("overviewForm").onsubmit = event => { event.preventDefault(); void load(false, true); };
check().onchange = resetResults;
$("overviewScroll").onscroll = () => { const node = $("overviewScroll"); if (node.scrollHeight - node.scrollTop - node.clientHeight < 120) void load(true); };
$("overviewExport").onclick = async () => {
    if (!applied || exporting) return;
    exporting = true; applyStation(); message("Preparazione Excel dell'intera selezione…");
    try { const result = await ipc.invoke("analysis-overview-export", applied); if (!result.ok) throw Error(result.error); message(result.canceled ? "Esportazione annullata." : `${result.count.toLocaleString("it-IT")} righe esportate.`); }
    catch (error) { message((error as Error).message, true); }
    finally { exporting = false; applyStation(); }
};
document.addEventListener("click", async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-analysis],[data-hub-target],[data-hub-order],[data-hub-article]");
    if (!button || button.disabled) return;
    if (button.dataset.hubOrder) { openDocumentDetails(button, "order", Number(button.dataset.hubOrder), button.dataset.orderNo!); return; }
    button.disabled = true;
    try {
        const result = await ipc.invoke("analysis-navigate", { target: button.dataset.hubArticle ? "stock-analysis" : button.dataset.analysis || button.dataset.hubTarget, ...(button.dataset.hubArticle ? { context: { article: button.dataset.hubArticle } } : {}) });
        if (!result.ok) throw Error(result.error);
    } catch (error) { $("status").hidden = false; $("status").textContent = (error as Error).message; }
    finally { button.disabled = false; applyStation(); }
});
installAnalysisLinks(contextFromAnalysisElement, error => message(error, true));
ipc.invoke("workstations-get").then(applyStation).catch((error: Error) => message(error.message, true));
ipc.on("workstations-changed", (_event: unknown, snapshot: any) => applyStation(snapshot));
$("close").onclick = () => ipc.send("commercial-analysis-close");
selectArea(view === "customer-prices" ? "prices" : view === "customer-commitments" ? "materials" : view === "manager" ? "management" : area.id);
ipc.on("analysis-open-context", (_event: unknown, context: any) => {
    if (!["customer-prices", "customer-commitments"].includes(view)) return;
    exactContext = { ...(context.article ? { article: context.article } : {}), ...(context.customerCode ? { customerCode: context.customerCode } : {}) };
    $("overviewClearContext").hidden = !Object.keys(exactContext).length;
    const reserved = check().querySelector<HTMLOptionElement>('[value="reserved-stock"]');
    if (reserved) { reserved.disabled = !!exactContext.customerCode; if (reserved.disabled && check().value === "reserved-stock") check().value = "customer-commitments"; }
    resetResults(); void load(false, true);
});
$("overviewClearContext").onclick = () => { exactContext = {}; $("overviewClearContext").hidden = true; const reserved = check().querySelector<HTMLOptionElement>('[value="reserved-stock"]'); if (reserved) reserved.disabled = false; resetResults(); void load(false, true); };
ipc.send("analysis-context-ready");
