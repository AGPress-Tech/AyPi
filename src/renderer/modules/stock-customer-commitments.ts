import { enhanceDetailTable } from "./analysis-detail-filters";
import { continueTableOnScroll } from "./table-scroll-loader";
import { openDocumentDetails } from "./document-details";
import { formatDocumentQuantity } from "./document-links";
const ipc = require("electron").ipcRenderer;
const escape = (value: unknown) =>
    String(value ?? "").replace(
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
const num = formatDocumentQuantity;
export async function renderStockCustomerCommitments(
    host: HTMLElement,
    article: string,
    channel = "stock-analysis-customer-commitments",
) {
    host.textContent = "Lettura degli ordini aperti per cliente…";
    try {
        const result = await ipc.invoke(channel, {
            article,
        });
        if (!result.ok) throw Error(result.error);
        if (!host.isConnected) return;
        const columns = [
            "Cliente",
            "Codice cliente",
            "Ordine",
            "Data ordine",
            "Riga",
            "Descrizione",
            "U.M.",
            "Quantità ordinata",
            "Consegnato",
            "Residuo",
            "Allocato",
            "Prelevato",
            "Magazzino",
            "Consegna prevista",
        ];
        const keys = [
            "customerName",
            "customerCode",
            "documentNo",
            "documentDate",
            "line",
            "description",
            "unit",
            "quantity",
            "deliveredQuantity",
            "residual",
            "allocated",
            "picked",
            "storage",
            "deliveryDate",
        ];
        const numeric = new Set([
            "line",
            "quantity",
            "deliveredQuantity",
            "residual",
            "allocated",
            "picked",
        ]);
        host.innerHTML =
            '<p class="stock-current-note">Ordini aperti attuali · lettura ' +
            escape(new Date(result.queriedAt).toLocaleString("it-IT")) +
            '. Il residuo è una richiesta da consegnare, non una quantità fisica già assegnata. Allocato e prelevato sono separati; questi dati non ricostruiscono i periodi di giacenza storici.</p><div class="table-scroll"><table class="stock-customer-commitments"><thead><tr>' +
            columns.map((label) => `<th>${escape(label)}</th>`).join("") +
            "</tr></thead><tbody></tbody></table></div>";
        const table = host.querySelector("table")!;
        const markup = (from: number, to: number) =>
            result.rows
                .slice(from, to)
                .map(
                    (row) =>
                        "<tr>" +
                        keys
                            .map(
                                (key) =>
                                    `<td ${["customerName", "customerCode"].includes(key) ? `data-analysis-customer-code="${escape(row.customerCode)}"` : key === "documentNo" ? `data-analysis-document-id="${escape(row.documentId)}" data-analysis-document-kind="order" data-analysis-document-no="${escape(row.documentNo)}"` : ""} title="${escape(row[key])}" data-filter-value="${escape(row[key])}" class="${numeric.has(key) ? "numeric" : ""}">${key === "documentNo" ? `<button type="button" class="document-link" data-open-order="${escape(row.documentId)}" data-order-no="${escape(row.documentNo)}">${escape(row.documentNo)}</button>` : numeric.has(key) ? num(row[key]) : escape(row[key] || "—")}</td>`,
                            )
                            .join("") +
                        "</tr>",
                )
                .join("");
        table.tBodies[0].innerHTML = markup(0, 250);
        continueTableOnScroll({
            table,
            total: result.rows.length,
            initial: Math.min(250, result.rows.length),
            append: (from, to) =>
                table.tBodies[0].insertAdjacentHTML(
                    "beforeend",
                    markup(from, to),
                ),
        });
        enhanceDetailTable(table, "stock-current-customer-orders");
        table.addEventListener("click", (event) => {
            const button = (
                event.target as HTMLElement
            ).closest<HTMLButtonElement>("[data-open-order]");
            if (!button) return;
            const id = Number(button.dataset.openOrder);
            if (Number.isSafeInteger(id) && id > 0)
                openDocumentDetails(button, "order", id, button.dataset.orderNo || "");
        });
    } catch (error) {
        if (host.isConnected) {
            host.textContent = (error as Error).message;
            const retry = document.createElement("button");
            retry.type = "button";
            retry.textContent = "Riprova";
            retry.onclick = () =>
                void renderStockCustomerCommitments(host, article, channel);
            host.append(" ", retry);
        }
    }
}
