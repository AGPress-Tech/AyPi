import {app,BrowserWindow,ipcMain,dialog,shell,Menu} from 'electron';
import fs from 'fs';import path from 'path';import {execFile} from 'child_process';import {promisify} from 'util';import {randomUUID} from 'crypto';
import * as XLSX from 'xlsx';
import {requestAypiBackend} from '../file-manager/backend-client';import {getAddressEntry} from '../file-manager/address-book';
import {excelDateCell,excelNumberFormat} from '../analysis-excel';import {validateWorkspace} from '../analysis-ui-model';
import {registerAnalysisTarget,relatedAnalysisMenuItems} from '../analysis-navigation';
const execute=promisify(execFile);
export function registerSupplierEvaluationIpc(main:BrowserWindow,icon:()=>string){
    let window:BrowserWindow|null=null,actor='',groups:Record<string,string[]>={},importing=false,preview:any=null;
    const owns=(e:any)=>window&&!window.isDestroyed()&&e.sender===window.webContents;
    const request=(endpoint:string,options:any={})=>{if(!actor)throw Error('Seleziona un dipendente.');return requestAypiBackend('/api/supplier-evaluation/'+endpoint,{...options,headers:{'x-aypi-actor':actor,'x-aypi-user':actor,'x-aypi-role':'employee'}})};
    const result=async(fn:()=>Promise<any>)=>{try{return {ok:true,...await fn()}}catch(error){return {ok:false,error:(error as Error).message.includes('(404)')?'Aggiornare il backend per abilitare Valutazione fornitori.':(error as Error).message}}};
    async function open(){if(window&&!window.isDestroyed()){window.maximize();window.show();window.focus();return window;}actor='';groups={};preview=null;
        const win=new BrowserWindow({width:1520,height:960,minWidth:1000,minHeight:680,show:false,title:'AyPi · Valutazione fornitori',icon:icon(),webPreferences:{nodeIntegration:true,contextIsolation:false}});window=win;win.setMenu(null);win.maximize();win.once('ready-to-show',()=>{if(!win.isDestroyed())win.show()});win.on('closed',()=>{if(window===win){window=null;actor='';preview=null}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
        const theme=/[?&]theme=bluearchive(?:&|$)/.test(main.webContents.getURL())?'bluearchive':'standard';await win.loadFile(path.join(__dirname,'..','..','pages','supplier-evaluation.html'),{query:{theme}});return win;
    }
    registerAnalysisTarget('supplier-evaluation',open,e=>!!owns(e),async context=>{
        if(!context.supplierCode)return false;
        const data=await requestAypiBackend('/api/erp/bar-contracts/suppliers');
        return data.suppliers?.some((s:any)=>String(s.code).trim()===context.supplierCode)??false;
    });
    ipcMain.handle('supplier-evaluation-employees',async e=>{if(!owns(e))return {ok:false};return result(async()=>{const data=await requestAypiBackend('/api/supplier-evaluation/employees');groups=data.groups;return data;})});
    ipcMain.handle('supplier-evaluation-login',async(e,name)=>{if(!owns(e))return {ok:false};return result(async()=>{const found=Object.values(groups).flat().find(n=>typeof name==='string'&&n.trim().toLocaleLowerCase('it')===name.trim().toLocaleLowerCase('it'));if(!found)throw Error('Selezionare un dipendente dall’elenco.');actor=found;return {actor,...await request('snapshot')};})});
    ipcMain.on('supplier-evaluation-close',e=>{if(owns(e))window?.close()});
    ipcMain.on('supplier-evaluation-logout',e=>{if(owns(e)){actor='';preview=null}});
    ipcMain.handle('supplier-evaluation-api',async(e,p)=>{if(!owns(e))return {ok:false};return result(async()=>{
        if(p?.op==='snapshot')return request('snapshot'+(p.refresh?'?refresh=1':''));
        if(['record','profile','delete-record'].includes(p?.op))return request(p.op,{method:'POST',body:p.entity});
        if(p?.op==='settings-save')return request('settings',{method:'PUT',body:p.settings});
        if(p?.op==='preferences-get')return request('preferences');
        if(p?.op==='preferences-save'){if(p.value.workspace)p.value.workspace=validateWorkspace(p.value.workspace);if(p.value.supplierWorkspace)p.value.supplierWorkspace=validateWorkspace(p.value.supplierWorkspace);return request('preferences',{method:'PUT',body:p.value});}
        throw Error('Operazione non valida.');
    })});
    ipcMain.handle('supplier-evaluation-context',async(e,p)=>{if(!owns(e)||!actor||typeof p?.id!=='string')return {ok:false};const send=(action:string)=>{if(!e.sender.isDestroyed())e.sender.send('supplier-evaluation-action',{id:p.id,kind:p.kind,action})};
        const entries:Electron.MenuItemConstructorOptions[]=p.kind==='record'?[{label:'Modifica valutazione',click:()=>send('edit')},{label:'Elimina valutazione',click:()=>send('delete')}]:[{label:'Analizza fornitore',click:()=>send('analyze')},{label:'Modifica classificazione / collegamento',click:()=>send('edit')}];if(p.relatedSuppliers!==undefined){
            if(!Array.isArray(p.relatedSuppliers)||p.relatedSuppliers.length>100||p.relatedSuppliers.some((code:any)=>typeof code!=='string'||!code.trim()||code.length>128))return {ok:false,error:'Fornitori collegati non validi.'};
            const codes=[...new Set<string>(p.relatedSuppliers)],related:Electron.MenuItemConstructorOptions[]=[];
            for(const code of codes){const links=await relatedAnalysisMenuItems('supplier-evaluation',{supplierCode:code},e.sender);if(links.length)related.push(...(codes.length===1?links:[{label:'Fornitore '+code,submenu:links}]));}
            if(related.length)entries.push({type:'separator'},{label:'Apri in altri moduli AyPi',submenu:related});
        }
        if(!e.sender.isDestroyed())Menu.buildFromTemplate(entries).popup({window:window!});return {ok:true};});
    ipcMain.handle('supplier-evaluation-pick-attachments',async e=>{if(!owns(e)||!actor)return {ok:false};return result(async()=>{const chosen=await dialog.showOpenDialog(window!,{title:'Allega documenti alla valutazione',properties:['openFile','multiSelections']});const attachments=[];for(const file of chosen.filePaths){const stat=await fs.promises.stat(file);if(!stat.isFile()||stat.size>20*1024*1024)throw Error('Il singolo allegato deve essere un file entro 20 MiB.');attachments.push({name:path.basename(file),...(file.startsWith('\\\\')?{path:file}:{fileName:path.basename(file),dataFilePath:file})});}return {attachments};})});
    ipcMain.handle('supplier-evaluation-open-attachment',async(e,id)=>{if(!owns(e)||typeof id!=='string')return {ok:false};return result(async()=>{const a=await request('attachment/'+encodeURIComponent(id));let file=a.path;if(!file){const folder=await fs.promises.mkdtemp(path.join(app.getPath('temp'),'aypi-supplier-evidence-'));file=path.join(folder,path.basename(a.name||'allegato'));await fs.promises.writeFile(file,Buffer.from(a.dataBase64,'base64'));}const error=await shell.openPath(file);if(error)throw Error(error);return {};})});
    ipcMain.handle('supplier-evaluation-import',async(e,p)=>{if(!owns(e)||!actor)return {ok:false};return result(async()=>{
        if(p?.phase==='cancel'){preview=null;return {};}
        if(p?.phase==='apply'){if(!preview||preview.token!==p.token||preview.actor!==actor||Date.now()>preview.expires)throw Error('Confronto scaduto. Ripetere la lettura Access.');const current=preview;preview=null;return request('import-apply',{method:'POST',body:current.source});}
        if(importing)throw Error('Confronto già in corso.');importing=true;const folder=await fs.promises.mkdtemp(path.join(app.getPath('temp'),'aypi-supplier-access-')),copy=path.join(folder,'source.accdb'),output=path.join(folder,'source.json');
        try{const file=getAddressEntry('moduli.openFornitori')?.path;if(!file)throw Error('Percorso Access non configurato.');const before=await fs.promises.stat(file);await fs.promises.copyFile(file,copy);const after=await fs.promises.stat(file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('Access modificato durante la copia. Riprovare.');await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'..','..','scripts','supplier-evaluation-access.ps1'),'-Source',copy,'-Output',output],{windowsHide:true,timeout:120000});const source=JSON.parse(await fs.promises.readFile(output,'utf8'));const report=await request('import-preview',{method:'POST',body:source});preview={token:randomUUID(),source,actor,expires:Date.now()+600000};return {...report,token:preview.token};}
        finally{importing=false;for(const file of [copy,output,path.join(folder,'source.laccdb')])try{await fs.promises.unlink(file)}catch{}try{await fs.promises.rmdir(folder)}catch{}}
    })});
    ipcMain.handle('supplier-evaluation-export',async(e,p)=>{if(!owns(e)||!actor)return {ok:false};return result(async()=>{if(!Array.isArray(p?.columns)||p.columns.length>100||!Array.isArray(p.rows)||p.rows.length>100000)throw Error('Esportazione non valida.');const chosen=await dialog.showSaveDialog(window!,{title:'Esporta valutazione fornitori',defaultPath:'Valutazione fornitori.xlsx',filters:[{name:'Excel',extensions:['xlsx']}]});if(chosen.canceled||!chosen.filePath)return {canceled:true};
        const sheet=XLSX.utils.aoa_to_sheet([p.columns.map(c=>String(c.label)),...p.rows.map(row=>p.columns.map((c,i)=>c.type==='date'?excelDateCell(row[i]):typeof row[i]==='number'?{t:'n',v:row[i],z:excelNumberFormat(row[i],0,2)}:row[i]??''))]);sheet['!cols']=p.columns.map(()=>({wch:25}));sheet['!autofilter']={ref:sheet['!ref']||'A1'};const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Analisi fornitori');await fs.promises.writeFile(chosen.filePath,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));return {};})});
    return {open};
}
