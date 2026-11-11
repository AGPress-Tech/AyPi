import {BrowserWindow,ipcMain,dialog} from 'electron';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import {requestAypiBackend} from '../file-manager/backend-client';
import {ARTICLE_ORDER_COLUMNS,ARTICLE_OFFER_COLUMNS,ArticleDocumentColumn} from './columns';
import {registerAnalysisTarget,canOpenAnalysis} from '../analysis-navigation';
import type {AnalysisTarget} from '../analysis-navigation-model';

export function registerArticleOrdersIpc(mainWindow:BrowserWindow,icon:()=>string){
    ipcMain.handle('analysis-access-denied',async event=>{
        if(event.sender!==mainWindow.webContents)return;
        await dialog.showMessageBox(mainWindow,{type:'info',title:'Accesso riservato',message:'Il Controllo di gestione è riservato agli amministratori.',detail:'Premi F2 per accedere come amministratore.',buttons:['Ho capito']});
    });
    registerArticleDocumentIpc(mainWindow,icon,{channel:'article-orders',title:'Analisi Venduto per Articolo',columns:ARTICLE_ORDER_COLUMNS,page:'article-orders.html',sheet:'Ordini per articolo',note:'Quantità espresse nella U.M. della riga; prezzi nella valuta dell’ordine. Residuo zero per righe consegnate o annullate.'});
    registerArticleDocumentIpc(mainWindow,icon,{channel:'article-offers',title:'Analisi Offerte per Articolo',columns:ARTICLE_OFFER_COLUMNS,page:'article-offers.html',sheet:'Offerte per articolo',note:'Quantità e prezzi registrati nell’offerta, nella U.M. della riga e nella valuta del documento. Prezzo offerto: UnitValue; prezzo netto: NetPrice.'});
}
function registerArticleDocumentIpc(mainWindow:BrowserWindow,icon:()=>string,options:{channel:string;title:string;columns:readonly ArticleDocumentColumn[];page:string;sheet:string;note:string}){
    let window:BrowserWindow|null=null;
    const owns=(event:any)=>window&&!window.isDestroyed()&&event.sender===window.webContents;
    const query=(filters:any)=>requestAypiBackend(`/api/erp/${options.channel}`,{method:'POST',body:filters});
    const open=async()=>{
        if(window&&!window.isDestroyed()){window.maximize();window.show();window.focus();return window;}
        const win=new BrowserWindow({width:1500,height:940,minWidth:1000,minHeight:680,title:`AyPi · ${options.title}`,icon:icon(),show:false,backgroundColor:'#f7f4ed',webPreferences:{nodeIntegration:true,contextIsolation:false}});
        window=win;win.setMenu(null);win.maximize();
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
        win.once('ready-to-show',()=>{if(!win.isDestroyed())win.show()});
        win.on('closed',()=>{if(window===win)window=null});
        const theme=/[?&]theme=bluearchive(?:&|$)/.test(mainWindow.webContents.getURL()||'')?'bluearchive':'standard';
        void win.loadFile(path.join(__dirname,'..','..','pages',options.page),{query:{theme}}).catch(error=>{if(!win.isDestroyed())win.webContents.send('analysis-navigation-error',error.message);});
        return win;
    };
    registerAnalysisTarget(options.channel as AnalysisTarget,open,owns);
    ipcMain.handle(`${options.channel}-open`,async event=>{
        if(event.sender!==mainWindow.webContents&&!canOpenAnalysis(event.sender))return {ok:false,error:'Apertura non autorizzata.'};
        await open();return {ok:true};
    });
    ipcMain.handle(`${options.channel}-search`,async(event,filters)=>{
        if(!owns(event))return {ok:false,error:'Finestra non autorizzata.'};
        try{return {ok:true,...await query(filters)}}catch(error){return {ok:false,error:error instanceof Error&&error.message.includes('(404)')?`Aggiornare il backend AyPi per abilitare ${options.title}.`:error instanceof Error?error.message:'Ricerca non riuscita.'}}
    });
    let exporting=false;
    ipcMain.handle(`${options.channel}-export`,async(event,payload)=>{
        if(!owns(event)||exporting)return {ok:false,error:'Esportazione non disponibile.'};
        const columns=options.columns.filter(c=>c.key==='article'||Array.isArray(payload?.columns)&&payload.columns.includes(c.key));
        exporting=true;
        try{
            const owner=window!;
            const result=await dialog.showSaveDialog(owner,{title:`Esporta ${options.title}`,defaultPath:`${options.title}.xlsx`,filters:[{name:'Excel',extensions:['xlsx']}]});
            if(result.canceled||!result.filePath)return {ok:true,canceled:true};
            const rows:any[]=[];let total=0;
            do{
                if(owner.isDestroyed())return {ok:false,error:'Finestra chiusa.'};
                const page=await query({...payload.filters,offset:rows.length,limit:1000});
                total=page.total;
                if(total>100000)throw new Error('Oltre 100.000 righe: restringere i filtri prima di esportare.');
                if(!page.rows.length)break;
                rows.push(...page.rows);
            }while(rows.length<total);
            const sheet=XLSX.utils.aoa_to_sheet([columns.map(c=>c.label),...rows.map(row=>columns.map(col=>col.kind==='boolean'?(row[col.key]?'SÌ':'NO'):row[col.key]??null))]);
            sheet['!cols']=columns.map(c=>({wch:c.key==='customerName'||c.key==='description'?38:c.kind==='text'?19:18}));
            sheet['!autofilter']={ref:sheet['!ref']||'A1'};
            columns.forEach((col,index)=>{if(['money','number'].includes(col.kind))for(let r=1;r<=rows.length;r++){const cell=sheet[XLSX.utils.encode_cell({r,c:index})];if(cell?.t==='n')cell.z=col.kind==='money'?'#,##0.00####':'#,##0.######'}});
            const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,options.sheet);
            XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([['Analisi',options.title],['Lettura dati',new Date().toISOString()],['Filtri',JSON.stringify(payload.filters)],['Righe esportate',rows.length],['Origine','SQL · NuovaAGP'],['Nota',options.note]]),'Ricerca');
            await fs.promises.writeFile(result.filePath,XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
            return {ok:true,count:rows.length};
        }catch(error){return {ok:false,error:error instanceof Error?error.message:'Esportazione non riuscita.'}}finally{exporting=false}
    });
    ipcMain.on(`${options.channel}-close`,event=>{if(owns(event))window?.close()});
}
