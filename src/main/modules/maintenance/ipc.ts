import {app,BrowserWindow,dialog,ipcMain,shell,Menu} from 'electron';
import fs from 'fs';
import path from 'path';
import {execFile} from 'child_process';
import {promisify} from 'util';
import {randomUUID} from 'crypto';
import {createHash} from 'crypto';
import * as XLSX from 'xlsx';
import {requestAypiBackend} from '../file-manager/backend-client';
import {getAddressEntry} from '../file-manager/address-book';
import {excelDateCell} from '../analysis-excel';
import {validateWorkspace} from '../analysis-ui-model';
const execute=promisify(execFile);
export function registerMaintenanceIpc(mainWindow:BrowserWindow,icon:()=>string){
    let window:BrowserWindow|null=null,actor='',groups:Record<string,string[]>={},importing=false,exporting=false;
    const owns=(e:any)=>!!window&&!window.isDestroyed()&&e.sender===window.webContents;
    const request=(url:string,options:any={})=>{if(!actor)throw Error('Seleziona un dipendente per accedere.');return requestAypiBackend('/api/maintenance/'+url,{...options,headers:{'x-aypi-actor':actor,'x-aypi-user':actor,'x-aypi-role':'employee'}})};
    const result=async(fn:()=>Promise<any>)=>{try{return {ok:true,...await fn()}}catch(e){return {ok:false,error:(e as Error).message.includes('(404)')?'Aggiornare il backend AyPi per abilitare Gestione manutenzioni.':(e as Error).message}}};
    const open=async()=>{
        if(window&&!window.isDestroyed()){window.maximize();window.show();window.focus();return window;}
        actor='';const win=new BrowserWindow({width:1520,height:960,minWidth:1000,minHeight:680,title:'AyPi · Gestione manutenzioni',icon:icon(),show:false,backgroundColor:'#f2f8fc',webPreferences:{nodeIntegration:true,contextIsolation:false}});
        window=win;win.setMenu(null);win.maximize();win.once('ready-to-show',()=>{if(!win.isDestroyed())win.show()});win.on('closed',()=>{if(window===win){window=null;actor=''}});
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
        const theme=/[?&]theme=bluearchive(?:&|$)/.test(mainWindow.webContents.getURL())?'bluearchive':'standard';
        void win.loadFile(path.join(__dirname,'..','..','pages','maintenance.html'),{query:{theme}}).catch(()=>{if(!win.isDestroyed())win.close()});return win;
    };
    ipcMain.handle('maintenance-employees',async e=>{if(!owns(e))return {ok:false};return result(async()=>{const data=await requestAypiBackend('/api/maintenance/employees');groups=data.groups;return data})});
    ipcMain.handle('maintenance-login',async(e,name)=>{if(!owns(e))return {ok:false};return result(async()=>{const found=Object.values(groups).flat().find(v=>typeof name==='string'&&v.toLocaleLowerCase('it')===name.trim().toLocaleLowerCase('it'));if(!found)throw Error('Seleziona un dipendente dall’elenco.');actor=found;return {actor,...await request('snapshot')}})});
    ipcMain.on('maintenance-logout',e=>{if(owns(e))actor=''});
    ipcMain.on('maintenance-close',e=>{if(owns(e))window?.close()});
    ipcMain.handle('maintenance-api',async(e,payload)=>{
        if(!owns(e))return {ok:false};
        return result(async()=>{
            if(payload?.op==='snapshot')return request('snapshot');
            if(['save','delete'].includes(payload?.op)&&['machine','plan','record'].includes(payload.kind))return request((payload.op==='save'?'entities/':'delete/')+payload.kind,{method:'POST',body:payload.entity});
            if(payload?.op==='preferences-get')return request('preferences');
            if(payload?.op==='preferences-save'){
                const value=payload.value;if(!value||typeof value!=='object'||JSON.stringify(value).length>500000)throw Error('Preferenze non valide.');
                if(value.workspace)value.workspace=validateWorkspace(value.workspace);
                return request('preferences',{method:'PUT',body:value});
            }
            throw Error('Operazione non consentita.');
        });
    });
    ipcMain.handle('maintenance-import',async(e,payload)=>{
        if(owns(e)&&actor&&['apply','cancel'].includes(payload?.phase))return result(async()=>request(payload.phase==='apply'?'import-apply':'import-cancel',{method:'POST',body:{token:payload.token}}));
        if(!owns(e)||!actor||importing)return {ok:false,error:'Importazione non disponibile.'};importing=true;
        return result(async()=>{
            const output=path.join(app.getPath('temp'),'aypi-maintenance-'+randomUUID()+'.json'),temporaryScript=output+'.ps1',localSource=output+'.accdb';
            const importingActor=actor;
            try{
                const source=getAddressEntry('moduli.openManutenzioni')?.path;if(!source||!source.toLowerCase().endsWith('.accdb'))throw Error('Percorso Access delle manutenzioni non configurato.');
                const script=path.join(__dirname,'..','..','scripts','maintenance-access.ps1');
                // PowerShell cannot read Electron's virtual app.asar filesystem.
                await fs.promises.writeFile(temporaryScript,await fs.promises.readFile(script));
                let stable=false;const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
                for(let attempt=0;attempt<3;attempt++){const bytes=await fs.promises.readFile(source);await fs.promises.writeFile(localSource,bytes);if(digest(bytes)===digest(await fs.promises.readFile(source))){stable=true;break}}
                if(!stable)throw Error('Access sta cambiando durante la lettura. Ripeti il confronto tra qualche istante.');
                await execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',temporaryScript,'-Source',localSource,'-AttachmentRoot',path.dirname(source),'-Output',output],{windowsHide:true,timeout:180000,maxBuffer:1024*1024});
                if(actor!==importingActor||!owns(e))throw Error('Importazione annullata: la sessione operatore è cambiata.');
                const input={...JSON.parse(await fs.promises.readFile(output,'utf8')),source};return await request('import-preview',{method:'POST',body:input});
            }finally{await fs.promises.unlink(output).catch(()=>{});await fs.promises.unlink(temporaryScript).catch(()=>{});await fs.promises.unlink(localSource).catch(()=>{});importing=false;}
        });
    });
    ipcMain.handle('maintenance-pick-attachments',async e=>{
        if(!owns(e)||!actor)return {ok:false};return result(async()=>{
            const selected=await dialog.showOpenDialog(window!,{title:'Seleziona allegati nella rete condivisa',properties:['openFile','multiSelections'],filters:[{name:'Documenti',extensions:['pdf','jpg','jpeg','png','txt','csv','xls','xlsx','doc','docx']}]});
            if(selected.canceled)return {attachments:[]};if(selected.filePaths.some(p=>!p.startsWith('\\\\')))throw Error('Seleziona file sulla rete condivisa: gli allegati restano nel percorso originale.');
            return {attachments:selected.filePaths.map(p=>({name:path.basename(p),path:p}))};
        });
    });
    ipcMain.handle('maintenance-open-attachment',async(e,id)=>{
        if(!owns(e)||typeof id!=='string'||id.length>200)return {ok:false};return result(async()=>{
            const a=await request('attachments/'+encodeURIComponent(id));if(!/\.(pdf|jpe?g|png|txt|csv|xlsx?|docx?)$/i.test(a.name))throw Error('Tipo allegato non supportato.');
            let target=a.path;if(!target){const directory=path.join(app.getPath('temp'),'aypi-maintenance',randomUUID());await fs.promises.mkdir(directory,{recursive:true});target=path.join(directory,path.basename(a.name));await fs.promises.writeFile(target,Buffer.from(a.data,'base64'));}
            else if(!target.startsWith('\\\\')||target.split(/[\\/]/).includes('..'))throw Error('Percorso allegato non valido.');
            const error=await shell.openPath(target);if(error)throw Error(error);return {};
        });
    });
    ipcMain.handle('maintenance-row-menu',async(e,payload)=>{
        if(!owns(e)||!actor)return {ok:false};
        return result(async()=>{
            const collection={machine:'machines',plan:'plans',record:'records'}[payload?.kind];
            if(!collection||typeof payload?.id!=='string')throw Error('Scheda non valida.');
            const snapshot=await request('snapshot'),entity=snapshot[collection].find(item=>item.id===payload.id);
            if(!entity)throw Error('Scheda non trovata.');
            const send=(action:string)=>{if(!e.sender.isDestroyed())e.sender.send('maintenance-row-action',{kind:payload.kind,id:entity.id,action});};
            const items:any[]=[{label:'Modifica',click:()=>send('edit')},{label:'Elimina',click:()=>send('delete')}];
            if(payload.kind==='plan')items.push({type:'separator'},{label:'Inserisci manutenzione ordinaria',click:()=>send('record')});
            Menu.buildFromTemplate(items).popup({window:window!});return {};
        });
    });
    ipcMain.handle('maintenance-context-menu',async(e,planId)=>{
        if(!owns(e)||!actor)return {ok:false};return result(async()=>{const snapshot=await request('snapshot'),plan=snapshot.plans.find(p=>p.id===planId);if(!plan)throw Error('Manutenzione non trovata.');Menu.buildFromTemplate([{label:'Inserisci manutenzione ordinaria',click:()=>{if(!e.sender.isDestroyed())e.sender.send('maintenance-new-ordinary',{planId:plan.id,machineId:plan.machineId})}}]).popup({window:window!});return {}});
    });
    ipcMain.handle('maintenance-export',async(e,payload)=>{
        if(!owns(e)||!actor||exporting)return {ok:false};exporting=true;
        return result(async()=>{try{
            const data=await request('snapshot'),ids=new Set(Array.isArray(payload?.ids)?payload.ids:[]),allowed=['records','machines','plans','due'];if(!allowed.includes(payload?.view))throw Error('Vista non valida.');
            const rows=data[payload.view].filter(r=>ids.has(r.id)),machine=id=>data.machines.find(m=>m.id===id),plan=id=>data.plans.find(p=>p.id===id);
            const columns=payload.view==='machines'?['Codice','Reparto','Descrizione','Anno','Responsabile','Matricola','Robot/Forno','Isola robotizzata','Tipi attrezzatura','Conformità','Conformità robot']:payload.view==='plans'?['Macchina','Reparto','Manutenzione','Frequenza mesi','Attiva']:payload.view==='due'?['Macchina','Reparto','Manutenzione','Ultima esecuzione','Scadenza','Giorni di ritardo']:['Tipo','Macchina','Reparto','Manutenzione / intervento','Data','Note','Inserito da','Modificato da','Allegati'];
            const values=rows.map(r=>payload.view==='machines'?[r.code,r.department,r.description,r.year,r.responsible,r.serial,r.robotSerial,r.islandSerial,r.equipmentTypes?.join(' · '),r.conformity,r.robotConformity]:payload.view==='plans'?[machine(r.machineId)?.code||r.machineId,machine(r.machineId)?.department,r.description,r.frequencyMonths,r.active?'Sì':'No']:payload.view==='due'?[machine(r.machineId)?.code||r.machineId,machine(r.machineId)?.department,r.description,excelDateCell(r.lastDate),excelDateCell(r.dueDate),r.daysOverdue]:[r.kind==='ordinary'?'Ordinaria':'Straordinaria',machine(r.machineId)?.code||r.machineId,machine(r.machineId)?.department,r.description||plan(r.planId)?.description,excelDateCell(r.date),r.notes,r.createdBy,r.updatedBy,data.attachments.filter(a=>a.recordId===r.id).map(a=>a.path||a.name).join('\n')]);
            const save=await dialog.showSaveDialog(window!,{title:'Esporta manutenzioni',defaultPath:'Manutenzioni.xlsx',filters:[{name:'Excel',extensions:['xlsx']}]});if(save.canceled||!save.filePath)return {canceled:true};
            const sheet=XLSX.utils.aoa_to_sheet([columns,...values]);sheet['!cols']=columns.map(c=>({wch:/Descrizione|Manutenzione|Note|Allegati/.test(c)?48:22}));sheet['!autofilter']={ref:sheet['!ref']||'A1'};
            const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Manutenzioni');await fs.promises.writeFile(save.filePath,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));return {count:rows.length};
        }finally{exporting=false}});
    });
    return {open};
}
