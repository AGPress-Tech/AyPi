import { BrowserWindow, dialog, ipcMain } from "electron";
import * as XLSX from "xlsx";
import { requestAypiBackend } from "./file-manager/backend-client";
import { normalizeStock } from "./stock-analysis/model";
import { sortByCriteria } from "./analysis-sorting";
import { excelDateCell, formatExcelNumbers } from "./analysis-excel";
import { OVERVIEW_CHECKS, OverviewQuery, overviewOrderFilters, overviewQuery } from "./analysis-overview-model";

export function createAnalysisOverview(request = requestAypiBackend) {
    let stock: any | null = null;
    let stockRead: Promise<any> | null = null;
    return {
        clear() { stock = null; },
        async page(query: OverviewQuery, limit = 250) {
            if (["customer-prices", "current-prices", "customer-commitments"].includes(query.check)) {
                const result = await request("/api/erp/business-analysis", { method: "POST", body: { mode: query.check === "customer-commitments" ? "commitments" : "prices", search: query.search, sort: query.sort, offset: query.offset, limit, asOf: query.asOf, currentOnly: query.check === "current-prices", special: query.special || [], ...(query.article ? { article: query.article } : {}), ...(query.customerCode ? { customerCode: query.customerCode } : {}) } });
                return { ...result, asOf: query.asOf };
            }
            if (!["negative-stock", "reserved-stock"].includes(query.check)) {
                const result = await request("/api/erp/article-orders", { method: "POST", body: overviewOrderFilters(query, limit) });
                return { ...result, asOf: query.asOf };
            }
            if ((!stock || query.refresh) && !stockRead) {
                stockRead = request("/api/erp/stock-analysis", { method: "POST", body: {} }).then(value => { stock = { ...value, rows: normalizeStock(value.rows || []) }; return stock; }).finally(() => { stockRead = null; });
            }
            const snapshot = stockRead ? await stockRead : stock;
            if (query.check === "reserved-stock" && query.customerCode) throw Error("Gli impegni nei saldi ERP non sono attribuibili a un singolo cliente. Usare la domanda documentale.");
            const needle = query.search.toLocaleLowerCase("it");
            const filtered = snapshot.rows.filter((row: any) => (query.check === "reserved-stock" ? row.reservedSales !== null && row.reservedSales > 0 : row.quantity !== null && row.quantity < 0) &&
                (!query.article || row.article === query.article) &&
                (!query.customerCode || row.subjectKind === "Cliente" && row.subjectCode === query.customerCode) &&
                (!needle || [row.article, row.description, row.storage, row.subjectName, row.ownership].some(value => String(value || "").toLocaleLowerCase("it").includes(needle))));
            const rows = sortByCriteria<any>(filtered, query.sort.length ? query.sort : [{ key: query.check === "reserved-stock" ? "reservedSales" : "quantity", direction: "asc" }], (row, key) => row[key]);
            return { rows: rows.slice(query.offset, query.offset + limit), total: rows.length, offset: query.offset, queriedAt: snapshot.queriedAt, selected: snapshot.selected, asOf: query.asOf };
        },
    };
}

export function registerAnalysisOverview(
    owns: (event: any) => boolean,
    allowed: (target: string) => boolean,
    request = requestAypiBackend,
    channels = "analysis-overview",
    prepare: (input: any) => any = input => input,
) {
    const service = createAnalysisOverview(request);
    const authorize = (event: any, input: unknown) => {
        if (!owns(event)) throw Error("Finestra non autorizzata.");
        const query = overviewQuery(prepare(input));
        if (!allowed(OVERVIEW_CHECKS[query.check].target)) throw Error("Controllo non disponibile su questa postazione.");
        return query;
    };
    ipcMain.handle(channels + "-load", async (event, input) => {
        try { return { ok: true, ...(await service.page(authorize(event, input))) }; }
        catch (error) { return { ok: false, error: (error as Error).message }; }
    });
    let exporting = false;
    ipcMain.handle(channels + "-export", async (event, input) => {
        if (exporting) return { ok: false, error: "Esportazione già in corso." };
        try {
            const query = authorize(event, input);
            exporting = true;
            const choice = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)!, {
                title: channels === "customer-prices" ? "Esporta listino cliente" : "Esporta controllo operativo", defaultPath: channels === "customer-prices" ? `AyPi-Listino-${String(query.customerCode).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 60)}-${query.asOf}.xlsx` : `AyPi-${query.check}-${query.asOf}.xlsx`, filters: [{ name: "Excel", extensions: ["xlsx"] }],
            });
            if (choice.canceled || !choice.filePath) return { ok: true, canceled: true };
            const rows: any[] = [];
            let total = 0, source: any = null;
            do {
                if (event.sender.isDestroyed()) throw Error("Finestra chiusa: esportazione annullata.");
                const result = await service.page({ ...query, offset: rows.length, refresh: false }, 1000);
                if (!source) source = result;
                if (rows.length && result.total !== total) throw Error("I dati sono cambiati durante l’esportazione. Aggiornare il controllo e riprovare.");
                total = result.total;
                if (total > 100000) throw Error("Oltre 100.000 righe: restringere la ricerca prima di esportare.");
                if (!result.rows.length && rows.length < total) throw Error("Lettura incompleta: nessun file esportato.");
                rows.push(...result.rows);
            } while (rows.length < total);
            const definition = { ...OVERVIEW_CHECKS[query.check], columns: OVERVIEW_CHECKS[query.check].columns.filter(column => !query.columns || query.columns.includes(column.key)) }, book = XLSX.utils.book_new();
            const sheet = XLSX.utils.aoa_to_sheet([definition.columns.map(column => column.label), ...rows.map(row => definition.columns.map(column => column.kind === "date" ? excelDateCell(row[column.key]) : row[column.key] ?? null))]);
            sheet["!autofilter"] = { ref: sheet["!ref"] || "A1" };
            XLSX.utils.book_append_sheet(book, sheet, channels === "customer-prices" ? "Listino cliente" : "Controllo operativo");
            XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Controllo", definition.label], ["Criterio", definition.description], ["Giorno di riferimento", excelDateCell(query.asOf)], ["Ricerca", query.search], ["Filtri dettagliati", JSON.stringify(query.special || [])], ["Articolo esatto", query.article || ""], ["Cliente esatto", query.customerCode || ""], ["Dati letti", source?.queriedAt || ""], ["Esercizio / periodo", source?.selected ? `${source.selected.year}/${source.selected.period}` : ""], ["Quantità", "Unità separate per riga; nessuna somma fra unità o proprietà diverse."], ["Ambito", "Intera selezione filtrata; nessuna modifica al gestionale."]]), "Informazioni");
            formatExcelNumbers(sheet);
            XLSX.writeFile(book, choice.filePath);
            return { ok: true, count: rows.length };
        } catch (error) { return { ok: false, error: (error as Error).message }; }
        finally { exporting = false; }
    });
    return () => service.clear();
}
