import {app,BrowserWindow,ipcMain,dialog} from 'electron';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import {requestAypiBackend} from '../file-manager/backend-client';
import {registerAnalysisTarget,canOpenAnalysis} from '../analysis-navigation';
import {CustomerRow,normalizeCustomerRows,emptyCustomerPreferences,validateCustomerPreferences,validateCustomerFilters,filterCustomerRows,customerStats,rowStatus,estimatedValue,documentKey} from './model';

const localToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function registerCustomerAnalysisIpc(mainWindow:BrowserWindow,icon:()=>string){
    let window:BrowserWindow|null=null,cache:{rows:CustomerRow[];customer:string;queriedAt:string;request:any}|null=null,loading=false,exporting=false;
    let writes:Promise<unknown>=Promise.resolve();
    const owns=(event:any)=>window&&!window.isDestroyed()&&event.sender===window.webContents;
    const file=()=>path.join(app.getPath('userData'),'customer-analysis.preferences.json');
    const failure=(error:unknown)=>({ok:false,error:error instanceof Error&&error.message.includes('(404)')?'Aggiornare il backend AyPi per abilitare Analisi per cliente.':error instanceof Error?error.message:'Operazione non riuscita.'});
    const open=async()=>{
        if(window&&!window.isDestroyed()){window.maximize();window.show();window.focus();return window;}
        const win=new BrowserWindow({width:1520,height:960,minWidth:1050,minHeight:700,show:false,title:'AyPi · Analisi per cliente',icon:icon(),backgroundColor:'#f7f4ed',webPreferences:{nodeIntegration:true,contextIsolation:false}});
        window=win;cache=null;win.setMenu(null);win.maximize();
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
        win.once('ready-to-show',()=>{if(!win.isDestroyed())win.show();});
        win.on('closed',()=>{if(window===win){window=null;cache=null;}});
        const theme=/[?&]theme=bluearchive(?:&|$)/.test(mainWindow.webContents.getURL()||'')?'bluearchive':'standard';
        void win.loadFile(path.join(__dirname,'..','..','pages','customer-analysis.html'),{query:{theme}}).catch(error=>{if(!win.isDestroyed())win.webContents.send('analysis-navigation-error',error.message);});return win;
    };
    registerAnalysisTarget('customer-analysis',open,owns);
    ipcMain.handle('customer-analysis-open',async event=>{
        if(event.sender!==mainWindow.webContents&&!canOpenAnalysis(event.sender))return {ok:false,error:'Finestra non autorizzata.'};
        await open();return {ok:true};
    });
    ipcMain.handle('customer-analysis-customers',async(event,input)=>{
        if(!owns(event))return {ok:false,error:'Finestra non autorizzata.'};
        try{return {ok:true,...await requestAypiBackend('/api/erp/customer-search',{method:'POST',body:input})};}catch(error){return failure(error);}
    });
    ipcMain.handle('customer-analysis-load',async(event,input)=>{
        if(!owns(event)||loading)return {ok:false,error:'Lettura già in corso o finestra non autorizzata.'};
        const owner=window;loading=true;
        try{
            const result=await requestAypiBackend('/api/erp/customer-analysis',{method:'POST',body:input}),rows=normalizeCustomerRows(result.rows);
            if(window!==owner||owner!.isDestroyed())return {ok:false,error:'Finestra chiusa.'};
            cache={rows,customer:result.customer,queriedAt:result.queriedAt,request:input};return {ok:true,...cache};
        }catch(error){return failure(error);}finally{loading=false;}
    });
    ipcMain.handle('customer-analysis-preferences-load',async event=>{
        if(!owns(event))return {ok:false,error:'Finestra non autorizzata.'};
        try{return {ok:true,preferences:fs.existsSync(file())?validateCustomerPreferences(JSON.parse(await fs.promises.readFile(file(),'utf8'))):emptyCustomerPreferences()};}
        catch{return {ok:false,error:'Preset personali non leggibili. Il file esistente è stato conservato.'};}
    });
    ipcMain.handle('customer-analysis-preferences-save',async(event,input)=>{
        if(!owns(event))return {ok:false,error:'Finestra non autorizzata.'};
        let preferences;try{if(JSON.stringify(input).length>1000000)throw Error('Preset troppo estesi.');preferences=validateCustomerPreferences(input);}catch(error){return failure(error);}
        const write=async()=>{
            const target=file();await fs.promises.mkdir(path.dirname(target),{recursive:true});
            if(fs.existsSync(target))validateCustomerPreferences(JSON.parse(await fs.promises.readFile(target,'utf8')));
            await fs.promises.writeFile(target+'.tmp',JSON.stringify(preferences,null,2),'utf8');await fs.promises.rename(target+'.tmp',target);return {ok:true,preferences};
        };
        const pending=writes.then(write,write);writes=pending.catch(()=>{});try{return await pending;}catch{return {ok:false,error:'Impossibile salvare i preset. Il file precedente è stato conservato.'};}
    });
    ipcMain.handle('customer-analysis-export',async(event,input)=>{
        if(!owns(event)||!cache||exporting)return {ok:false,error:'Esportazione non disponibile.'};
        const snapshot=cache;exporting=true;
        try{
            const filters=validateCustomerFilters(input),today=localToday(),rows=filterCustomerRows(snapshot.rows,filters,today),stats=customerStats(rows,today);
            const choice=await dialog.showSaveDialog(window!,{title:'Esporta Analisi per cliente',defaultPath:'Analisi per cliente.xlsx',filters:[{name:'Excel',extensions:['xlsx']}]});
            if(choice.canceled||!choice.filePath)return {ok:true,canceled:true};
            const book=XLSX.utils.book_new();
            const add=(name:string,data:unknown[][])=>{const sheet=XLSX.utils.aoa_to_sheet(data);sheet['!autofilter']={ref:sheet['!ref']||'A1'};sheet['!cols']=data[0].map(()=>({wch:23}));XLSX.utils.book_append_sheet(book,sheet,name);};
            add('Righe documenti',[['Tipo','ID documento','Numero','Data documento','Inserimento documento','Inserimento riga','Consegna prevista','Consegna confermata','Validità offerta fino al','Articolo','Descrizione','Riga','Stato riga','Annullata','Consegnata','Quantità','U.M.','Consegnato','Residuo','Prezzo unitario','Prezzo netto','Imponibile riga (gestionale)','Valore netto stimato','Valuta','Testata consegnata','Testata annullata'],...rows.map(r=>[r.kind==='order'?'Ordine':'Offerta',r.documentId,r.documentNo,r.documentDate,r.createdDate,r.lineCreatedDate,r.deliveryDate,r.confirmedDeliveryDate,r.validityDate,r.article,r.description,r.line,rowStatus(r,today),r.cancelled===null?null:r.cancelled?'Sì':'No',r.delivered===null?null:r.delivered?'Sì':'No',r.quantity,r.unit,r.deliveredQuantity,r.residual,r.unitPrice,r.netPrice,r.netAmount,estimatedValue(r),r.currency,r.headerDelivered===null?null:r.headerDelivered?'Sì':'No',r.headerCancelled===null?null:r.headerCancelled?'Sì':'No'])]);
            const documents=new Map<string,CustomerRow[]>();rows.forEach(r=>{const k=documentKey(r);const group=documents.get(k)??[];group.push(r);documents.set(k,group);});
            add('Documenti',[['Tipo','ID','Numero','Data','Righe filtrate','Articoli distinti','Stati delle righe filtrate'],...[...documents.values()].map(rs=>[rs[0].kind==='order'?'Ordine':'Offerta',rs[0].documentId,rs[0].documentNo,rs[0].documentDate,rs.length,new Set(rs.map(r=>r.article)).size,[...new Set(rs.map(r=>rowStatus(r,today)))].join(', ')])]);
            add('Quantità per UM',[['U.M.','Ordini','Offerte','Consegnato','Residuo'],...stats.units.map(u=>[u.unit,u.orders,u.offers,u.delivered,u.residual])]);
            add('Valori per valuta',[['Valuta','Imponibile ordini','Imponibile offerte','Ordini stimati','Offerte stimate','Portafoglio stimato','Righe senza valore stimato','Righe senza imponibile'],...stats.currencies.map(v=>[v.currency,v.netOrders,v.netOffers,v.orders,v.offers,v.backlog,v.missing,v.missingAmount])]);
            const annual=new Map<string,CustomerRow[]>();rows.forEach(r=>{const key=r.documentDate?.slice(0,4)??'Data assente';const group=annual.get(key)??[];group.push(r);annual.set(key,group);});
            add('Storico annuale',[['Anno','Ordini','Offerte','Articoli','Righe','Ordini con residuo','Ordini scaduti'],...[...annual].sort(([a],[b])=>a.localeCompare(b)).map(([y,rs])=>{const s=customerStats(rs,today);return [y,s.orders,s.offers,s.articles,s.lines,s.open,s.overdue];})]);
            const monthly=new Map<string,CustomerRow[]>();rows.forEach(r=>{const key=r.documentDate?.slice(0,7)??'Data assente';const group=monthly.get(key)??[];group.push(r);monthly.set(key,group);});
            add('Storico mensile',[['Mese','Ordini','Offerte','Articoli','Righe','Ordini con residuo','Ordini scaduti'],...[...monthly].sort(([a],[b])=>a.localeCompare(b)).map(([month,rs])=>{const s=customerStats(rs,today);return [month,s.orders,s.offers,s.articles,s.lines,s.open,s.overdue];})]);
            add('Ricerca',[['Voce','Valore'],['Cliente',snapshot.customer],['Ragione sociale',snapshot.rows[0]?.customerName??''],['Letto il',snapshot.queriedAt],['Periodo SQL',JSON.stringify(snapshot.request)],['Filtri applicati',JSON.stringify(filters)],['Righe esportate',rows.length],['Nota','Valore stimato = quantità × prezzo netto. Non è fatturato; esclusi IVA, spese e rettifiche di documento. I documenti collegati sono consultabili nel modulo; nessun tasso di conversione calcolato. Stati e consegne sono riferiti alle righe. Inserimento documento e riga da TBCreated. Consegne previste e confermate, non effettive. Imponibile riga da TaxableAmount, distinto dai valori stimati. Solo righe articolo.']]);
            await fs.promises.writeFile(choice.filePath,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));return {ok:true,count:rows.length};
        }catch(error){return failure(error);}finally{exporting=false;}
    });
    ipcMain.on('customer-analysis-close',event=>{if(owns(event))window?.close();});
}
