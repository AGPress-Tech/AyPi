import {articleLifecycle,articleAnnual,articleOrderDetails,articleCohorts,articleForecast,newArticleForecast,articleForecastBounds} from './articles';
import {excelDateCell,formatExcelNumbers} from '../analysis-excel';
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
            const add=(name:string,data:unknown[][])=>{
                const dateColumns=data[0].map((h,i)=>/^(Data|Data documento|Inserimento documento|Inserimento riga|Consegna prevista|Consegna confermata|Validità offerta fino al|Primo ordine osservato|Ultimo ordine|Data ordine|Mese)$/.test(String(h))?i:-1);
                const sheet=XLSX.utils.aoa_to_sheet(data.map((row,r)=>r?row.map((v,c)=>dateColumns.includes(c)?excelDateCell(v,data[0][c]==='Mese'?'mm/yyyy':'dd/mm/yyyy'):v):row));
                formatExcelNumbers(sheet);sheet['!autofilter']={ref:sheet['!ref']||'A1'};sheet['!cols']=data[0].map(()=>({wch:23}));XLSX.utils.book_append_sheet(book,sheet,name);
            };
            add('Righe documenti',[['Tipo','ID documento','Numero','Data documento','Inserimento documento','Inserimento riga','Consegna prevista','Consegna confermata','Validità offerta fino al','Articolo','Descrizione','Riga','Stato riga','Annullata','Consegnata','Quantità','U.M.','Consegnato','Residuo','Prezzo unitario','Prezzo netto','Imponibile riga (gestionale)','Valore netto stimato','Valuta','Testata consegnata','Testata annullata'],...rows.map(r=>[r.kind==='order'?'Ordine':'Offerta',r.documentId,r.documentNo,r.documentDate,r.createdDate,r.lineCreatedDate,r.deliveryDate,r.confirmedDeliveryDate,r.validityDate,r.article,r.description,r.line,rowStatus(r,today),r.cancelled===null?null:r.cancelled?'Sì':'No',r.delivered===null?null:r.delivered?'Sì':'No',r.quantity,r.unit,r.deliveredQuantity,r.residual,r.unitPrice,r.netPrice,r.netAmount,estimatedValue(r),r.currency,r.headerDelivered===null?null:r.headerDelivered?'Sì':'No',r.headerCancelled===null?null:r.headerCancelled?'Sì':'No'])]);
            const documents=new Map<string,CustomerRow[]>();rows.forEach(r=>{const k=documentKey(r);const group=documents.get(k)??[];group.push(r);documents.set(k,group);});
            add('Documenti',[['Tipo','ID','Numero','Data','Righe filtrate','Articoli distinti','Stati delle righe filtrate'],...[...documents.values()].map(rs=>[rs[0].kind==='order'?'Ordine':'Offerta',rs[0].documentId,rs[0].documentNo,rs[0].documentDate,rs.length,new Set(rs.map(r=>r.article)).size,[...new Set(rs.map(r=>rowStatus(r,today)))].join(', ')])]);
            add('Quantità per UM',[['U.M.','Ordini','Offerte','Consegnato','Residuo'],...stats.units.map(u=>[u.unit,u.orders,u.offers,u.delivered,u.residual])]);
            add('Valori per valuta',[['Valuta','Imponibile ordini','Imponibile offerte','Ordini stimati','Offerte stimate','Portafoglio stimato','Righe senza valore stimato','Righe senza imponibile'],...stats.currencies.map(v=>[v.currency,v.netOrders,v.netOffers,v.orders,v.offers,v.backlog,v.missing,v.missingAmount])]);
            const annual=new Map<string,CustomerRow[]>();rows.forEach(r=>{const key=r.documentDate?.slice(0,4)??'Data assente';const group=annual.get(key)??[];group.push(r);annual.set(key,group);});
            add('Storico annuale',[['Anno','Ordini','Offerte','Articoli','Righe','Ordini con residuo','Ordini scaduti'],...[...annual].sort(([a],[b])=>a.localeCompare(b)).map(([y,rs])=>{const s=customerStats(rs,today);return [y,s.orders,s.offers,s.articles,s.lines,s.open,s.overdue];})]);
            const monthly=new Map<string,CustomerRow[]>();rows.forEach(r=>{const key=r.documentDate?.slice(0,7)??'Data assente';const group=monthly.get(key)??[];group.push(r);monthly.set(key,group);});
            add('Storico mensile',[['Mese','Ordini','Offerte','Articoli','Righe','Ordini con residuo','Ordini scaduti'],...[...monthly].sort(([a],[b])=>a.localeCompare(b)).map(([month,rs])=>{const s=customerStats(rs,today);return [month,s.orders,s.offers,s.articles,s.lines,s.open,s.overdue];})]);
            const options=input.articleAnalysis??{dormancy:'',trend:'',horizon:3};
            if(!['','1','2','3','4','5','7','10'].includes(options.dormancy)||!['','up','down','stable'].includes(options.trend)||!Number.isInteger(options.horizon)||options.horizon<1||options.horizon>5)throw Error('Opzioni analisi articoli non valide.');
            const lifecycle=articleLifecycle(rows,snapshot.rows,today).filter(r=>(!options.dormancy||r.inactiveYears!==null&&r.inactiveYears>=+options.dormancy)&&(!options.trend||(options.trend==='up'?(r.quantityChange??0)>0:options.trend==='down'?(r.quantityChange??0)<0:r.quantityChange===0)));
            const articleCodes=new Set(lifecycle.map(r=>JSON.stringify([r.article,r.unit,r.currency]))),articleRows=rows.filter(r=>articleCodes.has(JSON.stringify([r.article,r.unit,r.currency])));
            const base=[['article','Articolo'],['description','Descrizione'],['unit','U.M.'],['currency','Valuta']];
            const measures=[['orders','Ordini'],['quantity','Quantità ordinata'],['value','Valore ordini'],['averageLot','Quantità per ordine'],['price','Prezzo netto ponderato'],['missingQuantity','Righe senza quantità'],['missingValue','Righe senza valore'],['missingPrice','Righe senza prezzo']];
            const changes=[['quantityChange','Delta quantità %'],['lotChange','Delta quantità per ordine %'],['priceChange','Delta prezzo %']];
            const analytical=(name:string,columns:string[][],data:any[])=>add(name,[columns.map(c=>c[1]),...data.map(r=>columns.map(c=>r[c[0]]??null))]);
            analytical('Ciclo articoli',[...base,['firstOrder','Primo ordine osservato'],['lastOrder','Ultimo ordine'],['inactiveYears','Anni inattività'],['lastDocuments','Ordini ultima data'],['lastOrders','N. ordini ultima data'],['lastQuantity','Quantità ultima data'],['lastValue','Valore ultima data'],['lastPrice','Prezzo ultima data'],...measures,['comparisonYear','Anno confronto'],...changes],lifecycle);
            analytical('Articoli per anno',[...base,['year','Anno'],['newArticle','Nuovo osservato'],['partial','Anno in corso o futuro'],...measures,...changes],articleAnnual(articleRows,snapshot.rows,today));
            analytical('Articoli per ordine',[...base,['documentNo','Numero ordine'],['documentDate','Data ordine'],...measures],articleOrderDetails(articleRows));
            analytical('Nuovi articoli',[['year','Anno'],['currency','Valuta'],['articles','Articoli'],['newArticles','Nuovi osservati'],['existingArticles','Già presenti'],['value','Valore totale'],['newValue','Valore nuovi'],['existingValue','Valore già presenti'],['newShare','Quota nuovi %'],['orders','Ordini nuovi']],articleCohorts(articleRows,snapshot.rows));
            const bounds=articleForecastBounds(snapshot.request,filters);
            const forecasts=bounds.unavailable?[]:articleForecast(articleRows,today,options.horizon,bounds);
            analytical('Previsione articoli',[...base,['year','Anno'],['forecast','Quantità prevista'],['lower','Fascia inferiore indicativa'],['upper','Fascia superiore indicativa'],['samples','Anni completi'],['training','Periodo osservato'],['slope','Tendenza annua'],['backtestError','Errore retrospettivo quantità'],['backtestPercent','Errore retrospettivo %']],forecasts);
            analytical('Previsione nuovi articoli',[['article','Indicatore'],['unit','U.M.'],['currency','Valuta'],['year','Anno'],['forecast','Stima'],['lower','Fascia inferiore indicativa'],['upper','Fascia superiore indicativa'],['samples','Anni completi'],['training','Periodo osservato'],['backtestError','Errore retrospettivo'],['backtestPercent','Errore retrospettivo %']],bounds.unavailable?[]:newArticleForecast(articleRows,snapshot.rows,today,options.horizon,bounds));
            analytical('Metodo articoli',[['name','Indicatore'],['definition','Definizione']],[
                {name:'Fonte',definition:'Ordini commerciali non annullati. Nessuna data di produzione effettiva o costo industriale disponibile.'},
                {name:'Ultimo ordine / inattività',definition:'Tutto lo storico SQL caricato fino a oggi; più ordini nella stessa data sono sommati. Anni interi trascorsi.'},
                {name:'Valore / prezzo',definition:'Imponibile riga, ripiego quantità × prezzo netto se mancante. Prezzo vendita ponderato sulle quantità positive con prezzo presente. U.M. e valute separate.'},
                {name:'Nuovo',definition:'Primo ordine osservato per codice in tutto lo storico SQL caricato, non data creazione articolo. Il periodo SQL può limitare lo storico.'},
                {name:'Variazioni',definition:'Anno di calendario precedente; base zero o mancante = variazione mancante. Periodi parziali non annualizzati.'},
                {name:'Previsione',definition:'Regressione lineare su 3–5 anni completi; anno corrente escluso; anni senza ordini a zero; fascia empirica 1,96 × errore residuo con ampliamento per distanza; non garanzia probabilistica. Errore retrospettivo sull’ultimo anno. Nessuna stagionalità o causa esterna.'},
                {name:'Opzioni articoli',definition:JSON.stringify(options)}
            ]);
            add('Ricerca',[['Voce','Valore'],['Cliente',snapshot.customer],['Ragione sociale',snapshot.rows[0]?.customerName??''],['Letto il',excelDateCell(snapshot.queriedAt,'dd/mm/yyyy hh:mm:ss')],['Periodo SQL',JSON.stringify(snapshot.request)],['Filtri applicati',JSON.stringify(filters)],['Righe esportate',rows.length],['Nota','Valore stimato = quantità × prezzo netto. Non è fatturato; esclusi IVA, spese e rettifiche di documento. I documenti collegati sono consultabili nel modulo; nessun tasso di conversione calcolato. Stati e consegne sono riferiti alle righe. Inserimento documento e riga da TBCreated. Consegne previste e confermate, non effettive. Imponibile riga da TaxableAmount, distinto dai valori stimati. Solo righe articolo.']]);
            await fs.promises.writeFile(choice.filePath,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));return {ok:true,count:rows.length};
        }catch(error){return failure(error);}finally{exporting=false;}
    });
    ipcMain.on('customer-analysis-close',event=>{if(owns(event))window?.close();});
}
