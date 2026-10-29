import {BrowserWindow,ipcMain} from 'electron';
import path from 'path';
let registered=false,window:BrowserWindow|null=null,currentTheme='';
export function setupForgeHub(){
    if(registered)return;registered=true;
    ipcMain.on('open-forge-window',(event,payload)=>{
        const sender=event.sender.getURL();
        if(!sender.startsWith('file:')||!/^\/(?:.*\/)?(?:bluearchive-preview|mes-scada|robot)\.html$/i.test(new URL(sender).pathname))return;
        const theme=payload?.theme==='bluearchive'?'bluearchive':'standard';
        const load=()=>window!.loadFile(path.join(__dirname,'..','pages','forge.html'),{query:{theme}});
        if(window&&!window.isDestroyed()){
            if(currentTheme!==theme){currentTheme=theme;void load();}
            if(window.isMinimized())window.restore();window.maximize();window.show();window.focus();return;
        }
        currentTheme=theme;
        window=new BrowserWindow({width:1400,height:900,minWidth:900,minHeight:650,show:false,autoHideMenuBar:true,title:'AyPi — FORGE',icon:path.join(__dirname,'..','assets','app-icon.png'),backgroundColor:theme==='standard'?'#f5f2e9':'#eef5fa',webPreferences:{nodeIntegration:true,contextIsolation:false}});
        window.setMenu(null);window.maximize();window.once('ready-to-show',()=>{window?.maximize();window?.show();});window.on('closed',()=>{window=null;currentTheme='';});void load();
    });
}
