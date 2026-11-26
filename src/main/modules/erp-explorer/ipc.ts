import { BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import fs from "fs";
import * as XLSX from "xlsx";
import { requestAypiBackend } from "../file-manager/backend-client";
import { registerAnalysisTarget } from "../analysis-navigation";
import { explorerContextRequest, ErpPage } from "./model";
import { explorerColumns } from "./presentation";
import { excelDateCell, excelNumberFormat } from "../analysis-excel";

export function registerErpExplorerIpc(main: BrowserWindow, icon: () => string) {
    let window: BrowserWindow | null = null, exporting = false;
    const owns = (event: any) => !!window && !window.isDestroyed() && event.sender === window.webContents;
    const query = (input: unknown): Promise<ErpPage> => requestAypiBackend("/api/erp/explorer", { method: "POST", body: input });
    const failure = (error: unknown) => ({ ok: false, error: (error as Error).message });
    const open = async () => {
        if (window && !window.isDestroyed()) { window.maximize(); window.show(); window.focus(); return window; }
        const win = new BrowserWindow({ width: 1500, height: 940, minWidth: 1000, minHeight: 680, show: false, title: "AyPi · Esplora gestionale", icon: icon(), backgroundColor: "#f7f4ed", webPreferences: { nodeIntegration: true, contextIsolation: false } });
        window = win; win.setMenu(null); win.maximize();
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", event => event.preventDefault());
        win.once("ready-to-show", () => { if (!win.isDestroyed()) win.show(); });
        win.on("closed", () => { if (window === win) window = null; });
        const theme = /[?&]theme=bluearchive(?:&|$)/.test(main.webContents.getURL()) ? "bluearchive" : "standard";
        void win.loadFile(path.join(__dirname, "..", "..", "pages", "erp-explorer.html"), { query: { theme } });
        return win;
    };
    registerAnalysisTarget("erp-explorer", open, owns, async context => {
        const input = explorerContextRequest(context);
        if (Object.values(input.where).some(value => !value)) return false;
        return (await query({ ...input, limit: 1 })).rows.length > 0;
    });
    ipcMain.handle("erp-explorer-query", async (event, input) => {
        if (!owns(event)) return { ok: false, error: "Finestra non autorizzata." };
        try { return { ok: true, ...(await query(input)) }; } catch (error) { return failure(error); }
    });
    ipcMain.handle("erp-explorer-commitments", async (event, input) => {
        if (!owns(event)) return { ok: false, error: "Finestra non autorizzata." };
        try {
            if (!input || typeof input.article !== "string" || !input.article.trim() || input.article.length > 128) throw Error("Articolo non valido.");
            return { ok: true, ...(await requestAypiBackend("/api/erp/stock-customer-commitments", { method: "POST", body: { article: input.article } })) };
        } catch (error) { return failure(error); }
    });
    ipcMain.handle("erp-explorer-export", async (event, payload) => {
        if (!owns(event)) return { ok: false, error: "Finestra non autorizzata." };
        if (exporting) return { ok: false, error: "Esportazione già in corso." };
        const owner = window!;
        exporting = true;
        try {
            if (!payload?.query || !Array.isArray(payload.columns) || !payload.columns.length || payload.columns.some((key: unknown) => typeof key !== "string")) throw Error("Colonne non valide.");
            const selected = [...new Set<string>(payload.columns)];
            const target = await dialog.showSaveDialog(owner, { title: "Esporta dati del gestionale", defaultPath: "Analisi AGPress.xlsx", filters: [{ name: "Excel", extensions: ["xlsx"] }] });
            if (target.canceled || !target.filePath) return { ok: false, cancelled: true };
            const rows: Record<string, any>[] = []; let first: ErpPage | undefined;
            do {
                if (owner.isDestroyed()) throw Error("Finestra chiusa.");
                const page = await query({ ...payload.query, offset: rows.length, limit: 1000 });
                first ||= page;
                if (page.total > 100000 || rows.length + page.rows.length > 100000) throw Error("Oltre 100.000 righe: restringere i filtri prima dell’export.");
                if (!page.rows.length) break;
                rows.push(...page.rows);
                if (rows.length >= page.total) break;
            } while (true);
            const available = explorerColumns(first!.dataset, first!.columns);
            const columns = selected.map(key => available.find(c => c.key === key));
            if (columns.some(c => !c)) throw Error("Colonna non disponibile.");
            const excelValue = (c: NonNullable<typeof columns[number]>, value: any) => {
                if (c.kind === "date") return excelDateCell(value, "dd/mm/yyyy hh:mm:ss");
                if (c.kind === "number" && typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
                    const significant = value.replace(/(\.\d*?)0+$/, "$1").replace(/[.\-]/g, "").replace(/^0+/, "");
                    if (significant.length <= 15) return Number(value);
                }
                return value;
            };
            const sheet = XLSX.utils.aoa_to_sheet([columns.map(c => c!.label), ...rows.map(row => columns.map(c => excelValue(c!, row[c!.key])))]);
            sheet["!cols"] = columns.map(c => ({ wch: c!.kind === "text" ? 30 : 20 }));
            sheet["!autofilter"] = { ref: sheet["!ref"] || "A1" };
            columns.forEach((c, index) => { if (c!.kind === "number") for (let row = 1; row <= rows.length; row++) { const cell = sheet[XLSX.utils.encode_cell({ r: row, c: index })]; if (cell?.t === "n") cell.z = excelNumberFormat(cell.v, 0, 15); } });
            const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "Dati");
            XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Blocco", first!.label], ["Lettura", first!.queriedAt], ["Filtri", JSON.stringify(payload.query)], ["Righe", rows.length], [], ["Campo", "Colonna ERP"], ...columns.map(c => [c!.label, c!.key])]), "Informazioni");
            await fs.promises.writeFile(target.filePath, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
            return { ok: true, count: rows.length };
        } catch (error) { return failure(error); } finally { exporting = false; }
    });
    ipcMain.on("erp-explorer-close", event => { if (owns(event)) window?.close(); });
}
