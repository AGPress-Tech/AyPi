import {parentPort,workerData} from 'worker_threads';
import fs from 'fs';
import * as XLSX from 'xlsx';
import {buildTurningData,TURNING_SOURCE} from './model';
try{
    const source=workerData?.source||TURNING_SOURCE,before=fs.statSync(source);
    const workbook=XLSX.readFile(source,{dense:true,cellFormula:true});
    const data=buildTurningData(workbook,source,before.mtime.toISOString()),after=fs.statSync(source);
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('Il file è stato modificato durante la lettura. Riprovare Aggiorna dati.');
    parentPort!.postMessage({ok:true,data});
}catch(error){parentPort!.postMessage({ok:false,error:error instanceof Error?error.message:String(error)})}
