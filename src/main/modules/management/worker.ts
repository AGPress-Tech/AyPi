import { parentPort, workerData } from "worker_threads";
import fs from "fs";
import * as XLSX from "xlsx";
import { buildManagementData, SOURCE_PATH, MovementIndex } from "./model";

try {
    const source = workerData.source || SOURCE_PATH;
    const before = fs.statSync(source);
    const live=workerData.dataset;
    const workbook = XLSX.readFile(source, { sheets: live ? ["Calcoli", "Filtri"] : ["Bilancino", "Calcoli", "Filtri"], dense: true });
    if(live){
        if(!Array.isArray(live.columns)||!Array.isArray(live.rows))throw new Error("Il backend ha restituito un Bilancino non valido.");
        const sheet=XLSX.utils.aoa_to_sheet([live.columns,...live.rows],{dense:true} as any);
        workbook.Sheets.Bilancino=sheet;
    }
    const movements: MovementIndex = Object.create(null);
    const data = buildManagementData(workbook, source, before.mtime.toISOString(), movement => {
        (movements[movement.code] ||= []).push(movement);
    });
    data.sourceKind=live ? "sql" : "excel";
    if(live){data.source=live.source;data.queriedAt=live.queriedAt;data.parameterSource=source;}
    const after = fs.statSync(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("Il file Excel è cambiato durante la lettura. Riprovare l’aggiornamento.");
    parentPort!.postMessage({ ok: true, data, movements });
} catch (error) {
    parentPort!.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
