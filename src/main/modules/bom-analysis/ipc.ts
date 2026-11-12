import {app,BrowserWindow,dialog,ipcMain} from 'electron';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import {requestAypiBackend} from '../file-manager/backend-client';
import {registerAnalysisTarget} from '../analysis-navigation';
import {BOM_COLUMNS,BOM_SUMMARY_COLUMNS,BomRow,DEFAULT_BOM_COLUMNS,bomExportRows,validateBomColumns,validateBomPreferences,validateBomSearch} from './model';
import {excelDateCell,excelNumberFormat} from '../analysis-excel';
export function registerBomAnalysisIpc(mainWindow:BrowserWindow,icon:()=>string){
    let window:BrowserWindow|null=null,rows:BomRow[]|null=null,queriedAt='',reading:Promise<any>|null=null,exporting=false,write=Promise.resolve();
    const owns=(event:any)=>!!window&&!window.isDestroyed()&&event.sender===window.webContents;
    const open=async()=>{
        if(window&&!window.isDestroyed()){window.maximize();window.show();window.focus();return window;}
        const win=new BrowserWindow({width:1500,height:940,minWidth:1000,minHeight:680,title:'AyPi · BoM e Articoli',icon:icon(),show:false,backgroundColor:'#f7f4ed',webPreferences:{nodeIntegration:true,contextIsolation:false}});
        window=win;win.setMenu(null);win.maximize();win.once('ready-to-show',()=>{if(!win.isDestroyed())win.show()});
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
        win.on('closed',()=>{if(window===win){window=null;rows=null;}});
        const theme=/[?&]theme=bluearchive(?:&|$)/.test(mainWindow.webContents.getURL())?'bluearchive':'standard';
        void win.loadFile(path.join(__dirname,'..','..','pages','bom-analysis.html'),{query:{theme}}).catch(()=>{if(!win.isDestroyed())win.close()});return win;
    };
    registerAnalysisTarget('bom-analysis',open,owns);
    const read=async()=>{
        if(!reading)reading=requestAypiBackend('/api/erp/bom-analysis',{method:'POST',body:{}}).then(result=>{
            if(!Array.isArray(result.rows)||result.rows.length>100000)throw Error('Risposta distinte non valida.');
            rows=result.rows;queriedAt=result.queriedAt;return {ok:true,rows,queriedAt};
        }).finally(()=>{reading=null});
        return reading;
    };
    const error=(e:any)=>({ok:false,error:String(e.message).includes('(404)')?'Aggiornare il backend AyPi per abilitare BoM e Articoli.':e.message||'Operazione non riuscita.'});
    ipcMain.handle('bom-analysis-load',async event=>{if(!owns(event))return error(Error('Finestra non autorizzata.'));try{return await read()}catch(e){return error(e)}});
    ipcMain.on('bom-analysis-close',event=>{if(owns(event))window?.close()});
    const file=()=>path.join(app.getPath('userData'),'bom-analysis.settings.json');
    const preferences=async()=>fs.existsSync(file())?validateBomPreferences(JSON.parse(await fs.promises.readFile(file(),'utf8'))):{version:1,columns:DEFAULT_BOM_COLUMNS,presets:[]};
    ipcMain.handle('bom-analysis-preferences-load',async event=>{try{if(!owns(event))throw Error('Finestra non autorizzata.');return {ok:true,preferences:await preferences()}}catch(e){return error(e)}});
    ipcMain.handle('bom-analysis-preferences-save',async(event,value)=>{
        try{
            if(!owns(event))throw Error('Finestra non autorizzata.');const clean=validateBomPreferences(value);
            const operation=write.then(async()=>{await preferences();await fs.promises.mkdir(path.dirname(file()),{recursive:true});await fs.promises.writeFile(file()+'.tmp',JSON.stringify(clean,null,2));await fs.promises.rename(file()+'.tmp',file())});
            write=operation.catch(()=>{});await operation;return {ok:true};
        }catch(e){return error(e)}
    });
    ipcMain.handle('bom-analysis-export',async(event,payload)=>{
        if(!owns(event)||exporting)return error(Error('Esportazione non disponibile.'));
        exporting=true;
        try{
            const search=validateBomSearch(payload?.search),keys=validateBomColumns(payload?.columns),layout=payload?.layout??'summary';
            if(!['summary','exploded'].includes(layout))throw Error('Tipo di esportazione non valido.');
            const columns=layout==='exploded'?BOM_COLUMNS:BOM_SUMMARY_COLUMNS.filter(c=>keys.includes(c.key));
            if(!rows)await read();
            const filtered=bomExportRows(rows!,search,layout),owner=window!;
            const save=await dialog.showSaveDialog(owner,{title:'Esporta BoM e Articoli',defaultPath:'BoM e Articoli.xlsx',filters:[{name:'Excel',extensions:['xlsx']}]});
            if(save.canceled||!save.filePath)return {ok:true,canceled:true};
            const sheet=XLSX.utils.aoa_to_sheet([columns.map(c=>c.label),...filtered.map(row=>columns.map(c=>c.kind==='date'?excelDateCell(row[c.key]):c.kind==='boolean'?(row[c.key]==null?null:row[c.key]?'Sì':'No'):row[c.key]??null))]);
            sheet['!cols']=columns.map(c=>({wch:/escription|notes/i.test(c.key)?44:20}));sheet['!autofilter']={ref:sheet['!ref']||'A1'};
            columns.forEach((c,i)=>{if(c.kind==='number')for(let r=1;r<=filtered.length;r++){const cell=sheet[XLSX.utils.encode_cell({r,c:i})];if(cell?.t==='n')cell.z=excelNumberFormat(cell.v,/Weight$/.test(c.key)?3:0,/Weight$/.test(c.key)||/quantity$/i.test(c.key)?3:6)}});
            const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Distinte e componenti');
            XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Vista',search.mode==='where-used'?'Dove compare un articolo':'Composizione distinte'],['Esportazione',layout==='exploded'?'Esploso completo: tutte le righe e colonne delle distinte trovate':'Riepilogo: una riga per distinta'],['Filtri',JSON.stringify(search.rules)],['Lettura dati',excelDateCell(queriedAt,'dd/mm/yyyy hh:mm:ss')],['Righe',filtered.length],['Origine','Distinte anagrafiche del gestionale; relazioni dirette. Quantità per riga, senza moltiplicazioni tra livelli.']]),'Ricerca');
            await fs.promises.writeFile(save.filePath,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));return {ok:true,count:filtered.length};
        }catch(e){return error(e)}finally{exporting=false}
    });
}
