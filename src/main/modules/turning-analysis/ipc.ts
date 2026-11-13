import {app,BrowserWindow,ipcMain,dialog} from 'electron';
import path from 'path';
import fs from 'fs';
import {Worker} from 'worker_threads';
import {TURNING_SOURCE,TurningData,emptyTurningSettings,validateTurningSettings} from './model';
import {emptyChartPreferences,validateChartPreferences} from './chart-presets';
import {registerAnalysisTarget,canOpenAnalysis} from '../analysis-navigation';

export function registerTurningAnalysisIpc(mainWindow:BrowserWindow,icon:()=>string){
    let window:BrowserWindow|null=null,cache:TurningData|null=null,worker:Worker|null=null,pending:Promise<any>|null=null;
    let writes:Promise<unknown>=Promise.resolve();
    const owns=(event:any)=>window&&!window.isDestroyed()&&event.sender===window.webContents;
    const settingsPath=()=>path.join(app.getPath('userData'),'turning-analysis.settings.json');
    const open=async()=>{
        if(window&&!window.isDestroyed()){window.maximize();window.show();window.focus();return window;}
        const win=new BrowserWindow({width:1520,height:960,minWidth:1000,minHeight:680,show:false,title:'AyPi · Analisi Torneria',icon:icon(),backgroundColor:'#f7f4ed',webPreferences:{nodeIntegration:true,contextIsolation:false}});
        window=win;cache=null;win.setMenu(null);win.maximize();
        win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
        win.once('ready-to-show',()=>{if(!win.isDestroyed())win.show()});
        win.on('closed',()=>{if(window===win){window=null;cache=null;worker?.terminate();worker=null;pending=null}});
        const theme=/[?&]theme=bluearchive(?:&|$)/.test(mainWindow.webContents.getURL()||'')?'bluearchive':'standard';
        void win.loadFile(path.join(__dirname,'..','..','pages','turning-analysis.html'),{query:{theme}}).catch(error=>{if(!win.isDestroyed())win.webContents.send('analysis-navigation-error',error.message);});return win;
    };
    let lookup:Promise<TurningData|null>|null=null,lookupUntil=0;
    const exists=async(context:import('../analysis-navigation-model').AnalysisContext)=>{
        if(!cache&&(!lookup||Date.now()>lookupUntil)){
            lookupUntil=Date.now()+60000;
            lookup=new Promise(resolve=>{
                const task=new Worker(path.join(__dirname,'worker.js'),{workerData:{source:TURNING_SOURCE}});let done=false;
                const finish=(data:TurningData|null)=>{if(done)return;done=true;clearTimeout(timer);resolve(data);void task.terminate();};
                const timer=setTimeout(()=>finish(null),10000);
                task.once('message',result=>finish(result.ok?result.data:null));task.once('error',()=>finish(null));task.once('exit',()=>finish(null));
            });
        }
        const source=cache||await lookup;
        const same=(a:string,b:string)=>a.trim().toLocaleLowerCase('it')===b.trim().toLocaleLowerCase('it');
        return !!source?.records.some(r=>context.article?same(r.article,context.article):!!context.customerName&&same(r.customer,context.customerName));
    };
    registerAnalysisTarget('turning-analysis',open,owns,exists);
    ipcMain.handle('turning-analysis-open',async event=>{
        if(event.sender!==mainWindow.webContents&&!canOpenAnalysis(event.sender))return {ok:false,error:'Finestra non autorizzata.'};
        await open();return {ok:true};
    });
    ipcMain.handle('turning-analysis-load',async(event,payload)=>{
        if(!owns(event))return {ok:false,error:'Finestra non autorizzata.'};
        if(cache&&!payload?.refresh)return {ok:true,data:cache};
        if(pending)return pending;
        const owner=window!;
        const operation=new Promise<any>(resolve=>{
            const task=new Worker(path.join(__dirname,'worker.js'),{workerData:{source:TURNING_SOURCE}});worker=task;let done=false;
            const finish=(result:any)=>{if(done)return;done=true;clearTimeout(timeout);if(worker===task)worker=null;
                if(window!==owner||owner.isDestroyed()){resolve({ok:false,error:'Finestra chiusa.'});return;}
                if(result.ok)cache=result.data;resolve(result);
            };
            const timeout=setTimeout(()=>{finish({ok:false,error:'Tempo di lettura scaduto. Verificare la condivisione DL360 e riprovare.'});void task.terminate()},120000);
            task.once('message',finish);task.once('error',error=>finish({ok:false,error:error.message}));task.once('exit',()=>finish({ok:false,error:'Lettura interrotta.'}));
        });
        pending=operation;try{return await operation}finally{if(pending===operation)pending=null}
    });
    ipcMain.handle('turning-analysis-workbook-load',async event=>{
        if(!owns(event))return {ok:false,error:'Finestra non autorizzata.'};
        const owner=window!;
        return new Promise(resolve=>{
            const task=new Worker(path.join(__dirname,'worker.js'),{workerData:{source:TURNING_SOURCE,mode:'table'}});let done=false;
            const finish=(response:any)=>{if(done)return;done=true;clearTimeout(timer);owner.removeListener('closed',closed);void task.terminate();resolve(owner.isDestroyed()?{ok:false,error:'Finestra chiusa.'}:response);};
            const closed=()=>finish({ok:false,error:'Finestra chiusa.'});owner.once('closed',closed);
            const timer=setTimeout(()=>finish({ok:false,error:'Tempo di lettura Excel scaduto.'}),120000);
            task.once('message',finish);task.once('error',error=>finish({ok:false,error:error.message}));task.once('exit',()=>finish({ok:false,error:'Lettura Excel interrotta.'}));
        });
    });
    ipcMain.handle('turning-analysis-settings-load',async event=>{
        if(!owns(event))return {ok:false,error:'Finestra non autorizzata.'};
        try{const file=settingsPath();return {ok:true,settings:fs.existsSync(file)?validateTurningSettings(JSON.parse(await fs.promises.readFile(file,'utf8'))):emptyTurningSettings()}}
        catch{return {ok:false,error:'Impostazioni personali non leggibili. Il file esistente è stato conservato.'}}
    });
    ipcMain.handle('turning-analysis-settings-save',async(event,input)=>{
        if(!owns(event))return {ok:false,error:'Finestra non autorizzata.'};
        let settings;try{if(JSON.stringify(input).length>1000000)throw new Error('Impostazioni troppo estese.');settings=validateTurningSettings(input)}catch(error){return {ok:false,error:(error as Error).message}}
        const write=async()=>{
            const file=settingsPath();await fs.promises.mkdir(path.dirname(file),{recursive:true});
            if(fs.existsSync(file)){
                // Un file corrotto viene preservato, senza sovrascriverlo silenziosamente.
                validateTurningSettings(JSON.parse(await fs.promises.readFile(file,'utf8')));
            }
            const tmp=file+'.tmp';await fs.promises.writeFile(tmp,JSON.stringify(settings,null,2),'utf8');await fs.promises.rename(tmp,file);return {ok:true,settings};
        };
        const result=writes.then(write,write);writes=result.catch(()=>{});try{return await result}catch{return {ok:false,error:'Impossibile salvare le impostazioni. Il file precedente è stato conservato.'}}
    });
    const chartsPath=()=>path.join(app.getPath('userData'),'turning-analysis.charts.json');
    ipcMain.handle('turning-analysis-charts-load',async event=>{
        if(!owns(event))return {ok:false,error:'Finestra non autorizzata.'};
        try{const file=chartsPath();return {ok:true,preferences:fs.existsSync(file)?validateChartPreferences(JSON.parse(await fs.promises.readFile(file,'utf8'))):emptyChartPreferences()}}
        catch{return {ok:false,error:'Preset grafici non leggibili. Il file personale è stato conservato.'}}
    });
    ipcMain.handle('turning-analysis-charts-save',async(event,input)=>{
        if(!owns(event))return {ok:false,error:'Finestra non autorizzata.'};
        let preferences;try{if(JSON.stringify(input).length>1000000)throw Error('Configurazione grafici troppo estesa.');preferences=validateChartPreferences(input)}catch(error){return {ok:false,error:(error as Error).message}}
        const write=async()=>{const file=chartsPath();await fs.promises.mkdir(path.dirname(file),{recursive:true});if(fs.existsSync(file))validateChartPreferences(JSON.parse(await fs.promises.readFile(file,'utf8')));const tmp=file+'.tmp';await fs.promises.writeFile(tmp,JSON.stringify(preferences,null,2),'utf8');await fs.promises.rename(tmp,file);return {ok:true,preferences}};
        const result=writes.then(write,write);writes=result.catch(()=>{});try{return await result}catch{return {ok:false,error:'Impossibile salvare i preset. Il file personale precedente è stato conservato.'}}
    });
    ipcMain.handle('turning-analysis-export',async(event,bytes)=>{
        if(!owns(event)||!cache)return {ok:false,error:'Dati o finestra non autorizzati.'};
        const buffer=Buffer.from(bytes||[]);if(!buffer.length||buffer.length>50*1024*1024)return {ok:false,error:'Esportazione non valida o troppo grande.'};
        try{
            const result=await dialog.showSaveDialog(window!,{title:'Esporta Analisi Torneria',defaultPath:'Analisi Torneria.xlsx',filters:[{name:'Excel',extensions:['xlsx']}]});
            if(result.canceled||!result.filePath)return {ok:true,canceled:true};
            if(path.resolve(result.filePath).toLowerCase()===path.resolve(TURNING_SOURCE).toLowerCase()||path.extname(result.filePath).toLowerCase()!=='.xlsx')throw new Error('Scegliere un nuovo file .xlsx, distinto dal file sorgente.');
            await fs.promises.writeFile(result.filePath,buffer);return {ok:true};
        }catch(error){return {ok:false,error:(error as Error).message}}
    });
    ipcMain.on('turning-analysis-close',event=>{if(owns(event))window?.close()});
}
