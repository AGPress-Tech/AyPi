import {registerAnalysisTarget} from '../analysis-navigation';
import {BrowserWindow,ipcMain,shell,dialog} from 'electron';
import path from 'path';
import {requestAypiBackend} from '../file-manager/backend-client';
import {getAddressEntry} from '../file-manager/address-book';
export function registerProcessingCyclesIpc(main:BrowserWindow,icon:()=>string){
    let window:BrowserWindow|null=null;
    const owns=(e:any)=>window&&!window.isDestroyed()&&e.sender===window.webContents;
    const result=async(run:()=>Promise<any>)=>{try{return {ok:true,...await run()}}catch(error){return {ok:false,error:(error as Error).message}}};
    async function open(){
        if(window&&!window.isDestroyed()){window.maximize();window.show();window.focus();return window;}
        const win=new BrowserWindow({width:1520,height:960,minWidth:1000,minHeight:680,show:false,title:'AyPi · Cicli di lavorazione',icon:icon(),webPreferences:{nodeIntegration:true,contextIsolation:false}});window=win;win.setMenu(null);win.maximize();
        win.webContents.on('will-prevent-unload',event=>{if(dialog.showMessageBoxSync(win,{type:'question',buttons:['Scarta modifiche','Annulla'],defaultId:1,cancelId:1,title:'Modifiche non salvate',message:'Chiudere il ciclo e scartare le modifiche?'} )===0)event.preventDefault();});
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.once('ready-to-show',()=>{if(!win.isDestroyed())win.show()});win.on('closed',()=>{if(window===win)window=null});
        const theme=/[?&]theme=bluearchive(?:&|$)/.test(main.webContents.getURL())?'bluearchive':'standard';await win.loadFile(path.join(__dirname,'..','..','pages','processing-cycles.html'),{query:{theme}});return win;
    }
    registerAnalysisTarget('processing-cycles',open,e=>!!owns(e),async context=>{
        if(!context.article)return false;
        const data=await requestAypiBackend('/api/processing-cycles/items');
        return data.items?.some((item:any)=>String(item.codiceProdotto||'').trim().toLocaleLowerCase('it')===context.article!.toLocaleLowerCase('it'))??false;
    });
    ipcMain.handle('processing-cycles-open',async e=>{if(e.sender!==main.webContents)return {ok:false};await open();return {ok:true}});
    ipcMain.handle('processing-cycles-request',async(e,p)=>{
        if(!owns(e))return {ok:false,error:'Finestra non autorizzata.'};
        return result(async()=>{const base='/api/processing-cycles/items';
            if(p?.action==='list')return requestAypiBackend(base);
            if(p?.action==='load'&&typeof p.id==='string')return requestAypiBackend(base+'/'+encodeURIComponent(p.id));
            if(p?.action==='save')return requestAypiBackend(base,{method:'POST',body:p.item});
            if(p?.action==='delete'&&typeof p.id==='string')return requestAypiBackend(base+'/'+encodeURIComponent(p.id),{method:'DELETE',body:{revision:p.revision}});
            throw Error('Operazione non valida.');
        });
    });
    ipcMain.handle('processing-cycles-legacy',async e=>{if(!owns(e))return {ok:false};return result(async()=>{const folder=getAddressEntry('infoarticoli.openCicli')?.path;if(!folder)throw Error('Percorso archivio precedente non configurato.');const error=await shell.openPath(folder);if(error)throw Error(error);return {};});});
    ipcMain.on('processing-cycles-close',e=>{if(owns(e))window?.close()});
    return {open};
}
