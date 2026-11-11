import {app,ipcMain} from 'electron';
import path from 'path';
import fs from 'fs';
import {fileURLToPath} from 'url';
import {emptyWorkspace,validateWorkspace} from './analysis-ui-model';
export function registerAnalysisUiPreferences(){
    const pages:Record<string,string>={management:'management.html',production:'utilities/production-planner-analysis.html',mes:'utilities/mes-analysis.html',calendar:'utilities/ferie-permessi-analysis.html'};
    const writes=new Map<string,Promise<unknown>>();
    const target=(event:any,key:any)=>{
        if(typeof key!=='string'||!pages[key])throw Error('Modulo non autorizzato.');
        const expected=path.resolve(__dirname,'..','pages',pages[key]);
        const actual=fileURLToPath(new URL(event.sender.getURL()));
        if(path.resolve(actual).toLowerCase()!==expected.toLowerCase())throw Error('Finestra non autorizzata.');
        return path.join(app.getPath('userData'),`analysis-ui-${key}.json`);
    };
    ipcMain.handle('analysis-ui-load',async(event,key)=>{try{const file=target(event,key);return {ok:true,preferences:fs.existsSync(file)?validateWorkspace(JSON.parse(await fs.promises.readFile(file,'utf8'))):emptyWorkspace()}}catch(error){return {ok:false,error:(error as Error).message}}});
    ipcMain.handle('analysis-ui-save',async(event,payload)=>{
        try{
            const file=target(event,payload?.key);
            if(JSON.stringify(payload).length>1000000)throw Error('Configurazione troppo estesa.');
            const preferences=validateWorkspace(payload.preferences);
            const write=async()=>{await fs.promises.mkdir(path.dirname(file),{recursive:true});if(fs.existsSync(file))validateWorkspace(JSON.parse(await fs.promises.readFile(file,'utf8')));await fs.promises.writeFile(file+'.tmp',JSON.stringify(preferences,null,2));await fs.promises.rename(file+'.tmp',file);return {ok:true,preferences}};
            const operation=(writes.get(file)||Promise.resolve()).then(write,write);writes.set(file,operation.catch(()=>{}));return await operation;
        }catch(error){return {ok:false,error:(error as Error).message}}
    });
}
