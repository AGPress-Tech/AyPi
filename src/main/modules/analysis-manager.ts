import { BrowserWindow, dialog, ipcMain } from "electron";
import * as XLSX from "xlsx";
import { requestAypiBackend } from "./file-manager/backend-client";

import { excelDateCell } from "./analysis-excel";
import { managerFilters, managerStock, MANAGER_TABLES, MANAGER_INFORMATION } from "./analysis-manager-model";
export function registerManagerAnalysis(owns: (event: any) => boolean, allowed: () => boolean, request = requestAypiBackend) {
    const load = async (event: any, input: any) => {
        if (!owns(event) || !allowed()) throw Error("Analisi Manager non autorizzata.");
        const filters = managerFilters(input);
        const [business, stock] = await Promise.allSettled([
            request("/api/erp/business-analysis", { method: "POST", body: { mode: "manager", ...filters } }),
            request("/api/erp/stock-analysis", { method: "POST", body: {} }),
        ]);
        if (business.status !== "fulfilled") throw business.reason;
        return { ...business.value, stock: stock.status === "fulfilled" ? managerStock(stock.value.rows || []) : [], stockPeriod: stock.status === "fulfilled" ? stock.value.selected : null, stockError: stock.status === "rejected" ? "Magazzino non disponibile: riepilogo parziale. " + String(stock.reason?.message || "Riprovare.") : "", filters };
    };
    ipcMain.handle("analysis-manager-load", async (event, input) => {
        try { return { ok: true, ...(await load(event, input)) }; }
        catch (error) { return { ok: false, error: (error as Error).message }; }
    });
    let exporting = false;
    ipcMain.handle("analysis-manager-export", async (event, input) => {
        if (exporting) return { ok: false, error: "Esportazione già in corso." };
        exporting = true;
        try {
            const result = await load(event, input);
            const choice = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)!, { title: "Esporta dashboard Manager", defaultPath: `AyPi-Manager-${result.filters.to}.xlsx`, filters: [{ name: "Excel", extensions: ["xlsx"] }] });
            if (choice.canceled || !choice.filePath) return { ok: true, canceled: true };
            const book = XLSX.utils.book_new();
            for (const table of MANAGER_TABLES) {
                const sheet = XLSX.utils.aoa_to_sheet([table.columns.map(([, label]) => label), ...(result[table.key] || []).map((row: any) => table.columns.map(([key]) => row[key] ?? null))]);
                table.columns.forEach(([key], column) => (result[table.key] || []).forEach((_row: any, index: number) => {
                    const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: column })];
                    if (cell?.t === "n") cell.z = key === "amount" || key === "estimatedAmount" || !Number.isInteger(cell.v) ? "#,##0.00" : "#,##0";
                }));
                XLSX.utils.book_append_sheet(book, sheet, table.key);
            }
            XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([result.backlog?.[0] || {}, result.acquired?.[0] || {}]), "Indicatori");
            XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Dal", excelDateCell(result.filters.from)], ["Al", excelDateCell(result.filters.to)], ["Riferimento", excelDateCell(result.filters.asOf)], ["Dati letti", result.queriedAt], ["Magazzino", result.stockPeriod ? `${result.stockPeriod.year}/${result.stockPeriod.period}` : result.stockError], ["Classifica clienti", "Prime 15 posizioni per valuta nel periodo selezionato."], ["Criteri", MANAGER_INFORMATION]]), "Informazioni");
            XLSX.writeFile(book, choice.filePath); return { ok: true };
        } catch (error) { return { ok: false, error: (error as Error).message }; }
        finally { exporting = false; }
    });
}
