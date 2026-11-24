import {app,BrowserWindow,dialog,ipcMain} from 'electron';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import {requestAypiBackend} from '../file-manager/backend-client';
import {registerAnalysisTarget} from '../analysis-navigation';
import {STOCK_COLUMNS,DEFAULT_STOCK_COLUMNS,normalizeStock,filterStock,groupStock,stockTotals,stockCustomerQuantities,StockRow,validateStockSearch,validateStockColumns,validateStockPreferences,validateStockPeriods,StockPeriod,stockVisibleColumns} from './model';
import {excelDateCell,excelNumberFormat} from '../analysis-excel';
export function registerStockAnalysisIpc(mainWindow:BrowserWindow,icon:()=>string){
    let window:BrowserWindow|null=null,rows:StockRow[]|null=null,queriedAt='',selectedPeriods:StockPeriod[]=[],reading:Promise<any>|null=null,exporting=false,write=Promise.resolve();
    const owns=(e:any)=>!!window&&!window.isDestroyed()&&e.sender===window.webContents;
    const open=async()=>{
        if(window&&!window.isDestroyed()){window.maximize();window.show();window.focus();return window;}
        const win=new BrowserWindow({width:1500,height:940,minWidth:1000,minHeight:680,show:false,title:'AyPi · Giacenze',icon:icon(),backgroundColor:'#f7f4ed',webPreferences:{nodeIntegration:true,contextIsolation:false}});
        window=win;win.setMenu(null);win.maximize();win.once('ready-to-show',()=>{if(!win.isDestroyed())win.show();});
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
        win.on('closed',()=>{if(window===win){window=null;rows=null;}});
        const theme=/[?&]theme=bluearchive(?:&|$)/.test(mainWindow.webContents.getURL())?'bluearchive':'standard';
        void win.loadFile(path.join(__dirname,'..','..','pages','stock-analysis.html'),{query:{theme}}).catch(()=>{if(!win.isDestroyed())win.close();});return win;
    };
    registerAnalysisTarget('stock-analysis',open,owns,async context=>{
        if(!context.article&&!context.supplierCode&&!context.customerCode)return false;
        const result=await requestAypiBackend('/api/erp/stock-analysis',{method:'POST',body:context.article?{article:context.article}:context.supplierCode?{supplierCode:context.supplierCode}:{customerCode:context.customerCode}});
        return Array.isArray(result.rows)&&result.rows.some((r:StockRow)=>normalizeStock([r]).some(r=>r.quantity!==0||r.reservedSales||r.reservedProduction||r.orderedPurchase||r.orderedProduction));
    });
    const error=(e:any)=>({ok:false,error:String(e.message).includes('(404)')?'Aggiornare il backend AyPi per abilitare Giacenze.':e.message||'Operazione non riuscita.'});
    const read=async(input:any={})=>{
        if(reading)throw Error('Lettura giacenze già in corso.');
        if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Esercizio o periodo non valido.');
        let requests:any[];
        if('periods' in input){if(Object.keys(input).length!==1)throw Error('Selezione periodi non valida.');requests=validateStockPeriods(input.periods);}
        else{
            if(Object.keys(input).some(k=>!['year','period'].includes(k))||Object.entries(input).some(([k,v])=>!Number.isInteger(v)||Number(v)<(k==='year'?1900:1)||Number(v)>(k==='year'?9999:99)))throw Error('Esercizio o periodo non valido.');
            requests=[input];
        }
        const owner=window;
        reading=(async()=>{
            const datasets:any[]=[];let count=0;
            // Reuse the existing single-period endpoint; bound concurrency and never publish partial reads.
            for(let i=0;i<requests.length;i+=2){
                const batch=await Promise.allSettled(requests.slice(i,i+2).map(body=>requestAypiBackend('/api/erp/stock-analysis',{method:'POST',body})));
                for(let j=0;j<batch.length;j++){
                    const entry=batch[j];if(entry.status==='rejected')throw entry.reason;const result=entry.value,requested=requests[i+j];
                    if(!Array.isArray(result.rows)||!Array.isArray(result.periods))throw Error('Risposta giacenze non valida.');
                    if(requested.year&&requested.period&&(result.selected?.year!==requested.year||result.selected?.period!==requested.period))throw Error('Periodo non disponibile: aggiornare e riprovare.');
                    if(result.rows.some((r:any)=>r.fiscalYear!==result.selected?.year||r.fiscalPeriod!==result.selected?.period))throw Error('I saldi ricevuti non corrispondono al periodo richiesto.');
                    count+=result.rows.length;if(count>100000)throw Error('Oltre 100.000 posizioni: selezionare meno esercizi / periodi.');
                    datasets.push(result);
                }
            }
            const clients=new Map<string,any>();for(const dataset of datasets)for(const row of dataset.customerCommitments||[])clients.set(JSON.stringify([row.article,row.customerCode,row.unit]),row);
            const customerCommitments=[...clients.values()];
            const clientArticles=new Map<string,any[]>();for(const value of customerCommitments)clientArticles.set(value.article,[...(clientArticles.get(value.article)||[]),value]);
            const merged=datasets.flatMap(d=>d.rows).map(row=>({...row,currentCustomerOrders:clientArticles.get(row.article)||[]})),chosen=datasets.filter(d=>d.selected?.year).map(d=>d.selected),clean=chosen.length?validateStockPeriods(chosen):[];
            const at=datasets.map(d=>d.queriedAt).filter(Boolean).sort().pop()||new Date().toISOString();
            if(window===owner&&owner&&!owner.isDestroyed()){rows=normalizeStock(merged);queriedAt=at;selectedPeriods=clean;}
            return {ok:true,rows:merged,customerCommitments,commitmentsAvailable:datasets.every(dataset=>dataset.commitmentsAvailable),periods:datasets[0]?.periods||[],selected:clean.length===1?clean[0]:null,selectedPeriods:clean,queriedAt:at};
        })().finally(()=>{reading=null;});return reading;
    };
    ipcMain.handle('stock-analysis-load',async(e,input)=>{if(!owns(e))return error(Error('Finestra non autorizzata.'));try{return await read(input??{});}catch(e){return error(e);}});
    ipcMain.handle('stock-analysis-customer-commitments',async(e,input)=>{
        try{
            if(!owns(e))throw Error('Finestra non autorizzata.');
            if(!input||typeof input.article!=='string'||!input.article.trim()||input.article.length>128||Object.keys(input).some(key=>key!=='article'))throw Error('Articolo non valido.');
            return {ok:true,...await requestAypiBackend('/api/erp/stock-customer-commitments',{method:'POST',body:{article:input.article.trim()}})};
        }catch(e){return error(e);}
    });
    ipcMain.on('stock-analysis-close',e=>{if(owns(e))window?.close();});
    const file=()=>path.join(app.getPath('userData'),'stock-analysis.settings.json');
    const preferences=async()=>fs.existsSync(file())?validateStockPreferences(JSON.parse(await fs.promises.readFile(file(),'utf8'))):{version:1,columns:DEFAULT_STOCK_COLUMNS,presets:[]};
    ipcMain.handle('stock-analysis-preferences-load',async e=>{try{if(!owns(e))throw Error('Finestra non autorizzata.');await write;return {ok:true,preferences:await preferences()};}catch(e){return error(e);}});
    ipcMain.handle('stock-analysis-preferences-save',async(e,value)=>{try{
        if(!owns(e))throw Error('Finestra non autorizzata.');const clean=validateStockPreferences(value);
        const operation=write.then(async()=>{await preferences();await fs.promises.mkdir(path.dirname(file()),{recursive:true});await fs.promises.writeFile(file()+'.tmp',JSON.stringify(clean,null,2));await fs.promises.rename(file()+'.tmp',file());});write=operation.catch(()=>{});await operation;return {ok:true};
    }catch(e){return error(e);}});
    ipcMain.handle('stock-analysis-export',async(e,value)=>{
        if(!owns(e)||exporting||reading)return error(Error('Esportazione non disponibile durante una lettura.'));exporting=true;
        try{
            if(!rows)throw Error('Caricare le giacenze prima di esportare.');
            const search=validateStockSearch(value?.search),filtered=filterStock(rows,search),columns=stockVisibleColumns(rows,validateStockColumns(value?.columns),selectedPeriods),groups=groupStock(filtered,search.sort),book=XLSX.utils.book_new();
            const add=(name:string,data:StockRow[],keys:string[])=>{const cols=keys.map(key=>STOCK_COLUMNS.find(c=>c.key===key)!);const sheet=XLSX.utils.aoa_to_sheet([cols.map(c=>c.label),...data.map(r=>cols.map(c=>c.kind==='date'?excelDateCell(r[c.key],'dd/mm/yyyy hh:mm:ss'):r[c.key]??null))]);
                sheet['!cols']=cols.map(c=>({wch:['description','subjectName','warnings'].includes(c.key)?44:23}));sheet['!autofilter']={ref:sheet['!ref']||'A1'};
                cols.forEach((c,i)=>{if(c.kind==='number')for(let r=1;r<=data.length;r++){const cell=sheet[XLSX.utils.encode_cell({r,c:i})];if(cell?.t==='n')cell.z=['fiscalYear','fiscalPeriod'].includes(c.key)?'0':excelNumberFormat(cell.v,0,6);}});XLSX.utils.book_append_sheet(book,sheet,name);};
            add('Giacenze per articolo',groups.map(g=>g.row),columns);
            add('Dettaglio magazzini',filtered,STOCK_COLUMNS.map(c=>c.key));
            const customerRows=stockCustomerQuantities(filtered);
            XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Articolo','U.M.','Esercizio','Periodo','Codice cliente','Cliente','Quantità associata'],...customerRows.map(row=>[row.article,row.unit,row.year,row.period,row.customerCode,row.customerName,row.quantity])]),'Clienti per articolo');
            const currentCustomers=new Map<string,any>();for(const row of filtered)for(const value of row.currentCustomerOrders||[])currentCustomers.set(JSON.stringify([value.article,value.customerCode,value.unit]),value);
            XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Articolo','Cliente','Codice cliente','U.M.','Residuo ordini attuale','Allocato attuale','Prelevato attuale','Ordini','Quantità mancanti'],...[...currentCustomers.values()].map(row=>[row.article,row.customerName,row.customerCode,row.unit,row.residual,row.allocated,row.picked,row.orders,row.missingQuantities])]),'Impegni clienti attuali');
            XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Esercizio','Periodo','U.M.','Giacenza','Totale parziale'],...stockTotals(filtered).map(t=>[t.year,t.period,t.unit,t.value,t.partial?'Sì':'No'])]),'Totali per unità');
            XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Esercizi / periodi',selectedPeriods.map(p=>p.year+' / '+p.period).join(', ')],['Lettura dati',excelDateCell(queriedAt,'dd/mm/yyyy hh:mm:ss')],['Filtri',JSON.stringify(search)],['Giacenza','Quantità iniziale + carichi − scarichi. Saldi distinti per esercizio/periodo, senza somme fra periodi.'],['Proprietà','OwnedGoods del magazzino. Il soggetto associato è lo specificatore cliente/fornitore e non certifica da solo il proprietario legale.'],['Disponibile netto impegni','Giacenza − impegnato vendite − impegnato produzione. Non sottrae nuovamente prelevato/allocato.'],['Disponibilità prevista','Disponibile netto + ordinato acquisti + ordinato produzione. Non include date di consegna.'],['Ubicazione','Ubicazione predefinita del saldo; non una posizione fisica rilevata.'],['Soglie','Scorta minima e massima sono per posizione; nel riepilogo valori diversi non si sommano.'],['Clienti e quantità','Quantità associata: saldo con specificatore cliente nel periodo scelto. Residuo ordini: domanda attuale, separata da allocato e prelevato; non certifica assegnazione fisica o storica. Articoli con codice iniziale * esclusi dagli ordini.'],['Valorizzazione','Non presente: i saldi quantità non certificano costo e valore di magazzino.']]),'Informazioni');
            const save=await dialog.showSaveDialog(window!,{title:'Esporta giacenze',defaultPath:'Giacenze.xlsx',filters:[{name:'Excel',extensions:['xlsx']}]});if(save.canceled||!save.filePath)return {ok:true,canceled:true};
            await fs.promises.writeFile(save.filePath,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));return {ok:true,count:groups.length,positions:filtered.length};
        }catch(e){return error(e);}finally{exporting=false;}
    });
}
