import {parentPort,workerData} from 'worker_threads';
import fs from 'fs';
import * as XLSX from 'xlsx';
import {buildTurningData,TURNING_SOURCE} from './model';
import {buildWorkbookTables} from './workbook-table';
try{
    const source=workerData?.source||TURNING_SOURCE,before=fs.statSync(source);
    const tableMode=workerData?.mode==='table';
    const complete=tableMode?XLSX.readFile(source,{bookSheets:true}).SheetNames.find(name=>name.trim().toLocaleLowerCase('it')==='completo'):undefined;
    if(tableMode&&!complete)throw Error('Il file non contiene il foglio Completo.');
    const workbook=XLSX.readFile(source,{dense:true,cellFormula:true,cellNF:true,...(tableMode?{sheets:[complete!]}:{})});
    const data=workerData?.mode==='table'?buildWorkbookTables(workbook,before.mtime.toISOString()):buildTurningData(workbook,source,before.mtime.toISOString()),after=fs.statSync(source);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('Il file è stato modificato durante la lettura. Riprovare Aggiorna dati.');
    parentPort!.postMessage({ok:true,data});
}catch(error){parentPort!.postMessage({ok:false,error:error instanceof Error?error.message:String(error)})}
