import {app,BrowserWindow,dialog,ipcMain} from 'electron';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import {requestAypiBackend} from '../file-manager/backend-client';
import {registerAnalysisTarget} from '../analysis-navigation';
import {COLUMNS,DEFAULT_COLUMNS,Row,summarize,filterRows,validateSearch,validateColumns,validatePreferences,validateSupplierCodes,defaultSupplierCodes} from './model';
import {excelDateCell} from '../analysis-excel';
export function registerBarContractsIpc(main:BrowserWindow,icon:()=>string){
 let window:BrowserWindow|null=null,data:{contracts:Row[];orders:Row[];queriedAt:string}|null=null,reading:Promise<any>|null=null,write=Promise.resolve(),exporting=false;
 const owns=(e:any)=>!!window&&!window.isDestroyed()&&e.sender===window.webContents;
 const error=(e:any)=>({ok:false,error:String(e.message).includes('(404)')?'Aggiornare il backend AyPi per abilitare i contratti barra.':e.message||'Operazione non riuscita.'});
 const open=async()=>{if(window&&!window.isDestroyed()){window.maximize();window.show();window.focus();return window;}
    const win=new BrowserWindow({width:1500,height:940,minWidth:1000,minHeight:680,title:'AyPi · Situazione Contratti Barra in Corso',icon:icon(),show:false,backgroundColor:'#f7f4ed',webPreferences:{nodeIntegration:true,contextIsolation:false}});
    window=win;win.setMenu(null);win.maximize();win.once('ready-to-show',()=>{if(!win.isDestroyed())win.show();});win.on('closed',()=>{if(window===win){window=null;data=null;}});
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    const theme=/[?&]theme=bluearchive(?:&|$)/.test(main.webContents.getURL())?'bluearchive':'standard';
    void win.loadFile(path.join(__dirname,'..','..','pages','bar-contracts.html'),{query:{theme}}).catch(()=>{if(!win.isDestroyed())win.close();});return win;
 };
 registerAnalysisTarget('bar-contracts',open,owns,async context=>{
    const result=data??await read();
    return filterRows(summarize(result.contracts,result.orders),{scope:'all',sort:[],rules:[...(context.article?[{field:'item',op:'exact' as const,value:context.article}]:[]),...(context.supplierCode?[{field:'supplierCode',op:'exact' as const,value:context.supplierCode}]:[])]}).length>0;
 });
 const supplierFile=()=>path.join(app.getPath('userData'),'bar-contracts.suppliers.json');
 const configuredSuppliers=async()=>fs.existsSync(supplierFile())?validateSupplierCodes(JSON.parse(await fs.promises.readFile(supplierFile(),'utf8'))):undefined;
 const directory=async()=>{
    const result=await requestAypiBackend('/api/erp/bar-contracts/suppliers');
    if(!Array.isArray(result.suppliers)||result.suppliers.length>100000||result.suppliers.some((s:any)=>typeof s.code!=='string'||typeof s.name!=='string'))throw Error('Anagrafica fornitori non valida.');
    return result.suppliers as {code:string;name:string;disabled:boolean}[];
 };
 let supplierWrite=Promise.resolve();
 ipcMain.handle('bar-contracts-suppliers-load',async e=>{try{if(!owns(e))throw Error('Finestra non autorizzata.');await supplierWrite;const suppliers=await directory(),codes=await configuredSuppliers();return {ok:true,suppliers,selected:codes??defaultSupplierCodes(suppliers)};}catch(e){return error(e);}});
 ipcMain.handle('bar-contracts-suppliers-save',async(e,value)=>{try{
    if(!owns(e))throw Error('Finestra non autorizzata.');const codes=validateSupplierCodes(value);
    const operation=supplierWrite.then(async()=>{
        const suppliers=await directory();if(codes.some(code=>!suppliers.some(s=>s.code===code)))throw Error('Selezionare fornitori presenti nell’anagrafica gestionale.');
        if(reading)await reading.catch(()=>{});
        await configuredSuppliers(); // Non sovrascrivere un file corrotto.
        await fs.promises.mkdir(path.dirname(supplierFile()),{recursive:true});
        await fs.promises.writeFile(supplierFile()+'.tmp',JSON.stringify(codes,null,2));await fs.promises.rename(supplierFile()+'.tmp',supplierFile());data=null;
    });supplierWrite=operation.catch(()=>{});await operation;return {ok:true};
 }catch(e){return error(e);}});
 const read=async()=>{if(!reading)reading=(async()=>{const suppliers=await configuredSuppliers();return requestAypiBackend('/api/erp/bar-contracts',{method:'POST',body:suppliers===undefined?{}:{suppliers}});})().then(result=>{
    if(!Array.isArray(result.contracts)||!Array.isArray(result.orders)||result.contracts.length>100000||result.orders.length>100000)throw Error('Risposta contratti non valida.');
    data=result;return {ok:true,...result};}).finally(()=>{reading=null;});return reading;};
 ipcMain.handle('bar-contracts-load',async e=>{if(!owns(e))return error(Error('Finestra non autorizzata.'));try{return await read();}catch(e){return error(e);}});
 ipcMain.on('bar-contracts-close',e=>{if(owns(e))window?.close();});
 const file=()=>path.join(app.getPath('userData'),'bar-contracts.settings.json');
 const preferences=async()=>fs.existsSync(file())?validatePreferences(JSON.parse(await fs.promises.readFile(file(),'utf8'))):{version:1,columns:DEFAULT_COLUMNS,presets:[]};
 ipcMain.handle('bar-contracts-preferences-load',async e=>{try{if(!owns(e))throw Error('Finestra non autorizzata.');return {ok:true,preferences:await preferences()};}catch(e){return error(e);}});
 ipcMain.handle('bar-contracts-preferences-save',async(e,value)=>{try{if(!owns(e))throw Error('Finestra non autorizzata.');const clean=validatePreferences(value);const operation=write.then(async()=>{await preferences();await fs.promises.mkdir(path.dirname(file()),{recursive:true});await fs.promises.writeFile(file()+'.tmp',JSON.stringify(clean,null,2));await fs.promises.rename(file()+'.tmp',file());});write=operation.catch(()=>{});await operation;return {ok:true};}catch(e){return error(e);}});
 ipcMain.handle('bar-contracts-export',async(e,value)=>{if(!owns(e)||exporting)return error(Error('Esportazione non disponibile.'));exporting=true;
    try{const search=validateSearch(value?.search),keys=validateColumns(value?.columns);if(!data)await read();const snapshot=data!,rows=filterRows(summarize(snapshot.contracts,snapshot.orders),search),columns=COLUMNS.filter(c=>keys.includes(c.key));
      const save=await dialog.showSaveDialog(window!,{title:'Esporta contratti barra',defaultPath:'Situazione Contratti Barra.xlsx',filters:[{name:'Excel',extensions:['xlsx']}]});if(save.canceled||!save.filePath)return {ok:true,canceled:true};
      const book=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet([columns.map(c=>c.label),...rows.map(r=>columns.map(c=>c.kind==='date'?excelDateCell(r[c.key]):r[c.key]??null))]);sheet['!cols']=columns.map(c=>({wch:c.kind==='text'?30:23}));sheet['!autofilter']={ref:sheet['!ref']||'A1'};XLSX.utils.book_append_sheet(book,sheet,'Contratti');
      const orderCols=['document','date','delivery','supplierCode','item','description','unit','quantity','received','price','currency','cancelled','lineCancelled','closed','lineClosed','contractId','contractLine'];
      const selected=new Set(rows.map(r=>`${r.supplierCode}|${r.id}|${r.line}`));const orders=snapshot.orders.filter(o=>selected.has(`${o.supplierCode}|${o.contractId}|${o.contractLine}`));
      XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Ordine','Data','Consegna prevista','Codice fornitore','Articolo','Descrizione','U.M.','Quantità ordinata','Quantità ricevuta','Prezzo / U.M.','Valuta','Ordine annullato','Riga annullata','Ordine evaso','Riga evasa','ID contratto','Riga contratto'],...orders.map(o=>orderCols.map(k=>['date','delivery'].includes(k)?excelDateCell(o[k]):o[k]??null))]),'Ordini collegati');
      XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Lettura',excelDateCell(snapshot.queriedAt,'dd/mm/yyyy hh:mm:ss')],['Filtri',JSON.stringify(search)],['Fonte','Offerte fornitore /C barra, righe ordine collegate per ID e riga. Ricevuto = DeliveredQty delle righe ordine, non quantità ordinata; DDT acquisto non presenti nella fonte verificata.'],['Disponibilità residua','Kg contratto − kg ricevuti − kg ancora aperti. Residui negativi conservati. Ordini annullati esclusi dagli impegni, consegne reali conservate.'],['Stato','Aperto se testata e riga contratto non chiuse. Scadenza non comporta chiusura automatica.'],['Prezzi','Prezzo unitario contrattuale originale, in €/kg solo per EUR e KG; eventuali maggiorazioni degli ordini restano nel dettaglio.']]),'Informazioni');
      await fs.promises.writeFile(save.filePath,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));return {ok:true,count:rows.length};
    }catch(e){return error(e);}finally{exporting=false;}
 });
}
