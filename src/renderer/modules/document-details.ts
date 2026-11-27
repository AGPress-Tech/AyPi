import {
    loadDocumentLinks,
    formatDocumentQuantity,
    toggleDocumentExpansion,
} from "./document-links";
import { enhanceDetailTable } from "./analysis-detail-filters";
import { continueTableOnScroll } from "./table-scroll-loader";
const ipc = require("electron").ipcRenderer;
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
const number = (v: unknown) =>
    v == null
        ? "—"
        : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 20 }).format(
              Number(v),
          );
const quantityColumns = new Set(["quantity", "deliveredQuantity", "residual"]);
const columns = [
    ["line", "Riga", "number"],
    ["article", "Articolo", "text"],
    ["description", "Descrizione", "text"],
    ["quantity", "Quantità", "number"],
    ["unit", "U.M.", "text"],
    ["deliveredQuantity", "Consegnata", "number"],
    ["residual", "Residuo", "number"],
    ["unitPrice", "Prezzo offerto", "number"],
    ["netPrice", "Prezzo netto", "number"],
    ["netAmount", "Imponibile", "number"],
    ["currency", "Valuta", "text"],
];
export async function loadDocumentLines(
    host: HTMLElement,
    kind: "order" | "offer",
    id: number,
) {
    host.textContent = "Caricamento delle voci del documento…";
    try {
        const result = await ipc.invoke("analysis-document-lines", {
            kind,
            id,
        });
        if (!result.ok) throw Error(result.error);
        if (!host.isConnected) return;
        const rows = result.rows || [];
        if (!rows.length) {
            host.textContent = "Nessuna voce nel documento.";
            return;
        }
        const active = columns.filter(
            ([key]) =>
                kind === "order" ||
                !["deliveredQuantity", "residual"].includes(key),
        );
        host.innerHTML = `<div class="table-scroll"><table class="linked-documents-table"><thead><tr>${active.map(([key, label, type]) => `<th data-sort-key="${key}" class="${type === "number" ? "numeric" : ""}">${esc(kind === "order" && key === "unitPrice" ? "Prezzo unitario" : label)}</th>`).join("")}</tr></thead><tbody></tbody></table></div>`;
        const table = host.querySelector<HTMLTableElement>("table")!;
        const append = (from: number, to: number) =>
            table.tBodies[0].insertAdjacentHTML(
                "beforeend",
                rows
                    .slice(from, to)
                    .map(
                        (row: any) =>
                            `<tr>${active.map(([key, , type]) => `<td ${key === "article" && row.article ? `data-analysis-article="${esc(row.article)}"` : ""} class="${type === "number" ? "numeric" : ""}" data-filter-value="${esc(row[key])}" title="${esc(row[key])}">${type === "number" ? (quantityColumns.has(key) ? formatDocumentQuantity(row[key]) : number(row[key])) : esc(row[key])}</td>`).join("")}</tr>`,
                    )
                    .join(""),
            );
        append(0, Math.min(250, rows.length));
        continueTableOnScroll({
            table,
            total: rows.length,
            initial: Math.min(250, rows.length),
            append,
        });
        enhanceDetailTable(table, `document-own-lines:${kind}`);
    } catch (error) {
        if (!host.isConnected) return;
        host.textContent = (error as Error).message;
        const retry = document.createElement("button");
        retry.textContent = "Riprova";
        retry.onclick = () => void loadDocumentLines(host, kind, id);
        host.append(" ", retry);
    }
}
export function renderDocumentDetails(
    host: HTMLElement,
    kind: "order" | "offer",
    id: number,
    documentNo: string,
    relatedOpen = false,
) {
    host.classList.add("analysis-document-details");
    host.innerHTML = `<div class="analysis-document-content"><h3>${kind === "order" ? "Ordine" : "Offerta"} ${esc(documentNo)} · Voci del documento</h3><div data-own-lines></div><details class="document-connections" ${relatedOpen ? "open" : ""}><summary>${kind === "order" ? "Offerte correlate" : "Ordini correlati"}</summary><div data-related-lines></div></details></div>`;
    void loadDocumentLines(
        host.querySelector<HTMLElement>("[data-own-lines]")!,
        kind,
        id,
    );
    const related = host.querySelector<HTMLDetailsElement>("details")!;
    let loaded = false;
    const load = () => {
        if (related.open && !loaded) {
            loaded = true;
            void loadDocumentLinks(
                host.querySelector<HTMLElement>("[data-related-lines]")!,
                kind,
                id,
            );
        }
    };
    related.addEventListener("toggle", load);
    load();
}
export function toggleDocumentLines(
    button: HTMLElement,
    kind: "order" | "offer",
    id: number,
    documentNo: string,
) {
    const cell = toggleDocumentExpansion(button);
    if (cell) renderDocumentDetails(cell, kind, id, documentNo);
}
export function openAnalysisDocumentDialog(
    opener: HTMLElement,
    label: string,
    render: (host: HTMLElement) => void,
) {
    const dialog = document.createElement("dialog");
    dialog.className = "analysis-document-dialog";
    dialog.setAttribute("aria-label", label);
    dialog.innerHTML =
        '<div class="analysis-document-scroll"></div><div class="dialog-actions"><button type="button">Chiudi</button></div>';
    document.body.append(dialog);
    dialog.querySelector("button")!.onclick = () => dialog.close();
    dialog.addEventListener("close", () => {
        dialog.remove();
        if (opener.isConnected) opener.focus();
    });
    render(dialog.querySelector<HTMLElement>(".analysis-document-scroll")!);
    dialog.showModal();
    return dialog;
}
export function openDocumentDetails(
    opener: HTMLElement,
    kind: "order" | "offer",
    id: number,
    documentNo: string,
) {
    return openAnalysisDocumentDialog(
        opener,
        `${kind === "order" ? "Ordine" : "Offerta"} ${documentNo}`,
        (host) => renderDocumentDetails(host, kind, id, documentNo, true),
    );
}
