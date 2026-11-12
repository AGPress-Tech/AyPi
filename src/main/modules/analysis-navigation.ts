import {BrowserWindow,ipcMain,Menu,WebContents} from 'electron';
import path from 'path';
import {ANALYSIS_TARGETS,AnalysisTarget,AnalysisContext,validateAnalysisContext} from './analysis-navigation-model';
import {requestAypiBackend} from './file-manager/backend-client';
import {registerAnalysisUiPreferences} from './analysis-ui-preferences';

const modules=new Map<AnalysisTarget,{open:()=>Promise<BrowserWindow>;owns:(event:any)=>boolean;exists?:(context:AnalysisContext)=>Promise<boolean>}>();
let main:BrowserWindow|null=null,hub:BrowserWindow|null=null;
const ready=new Set<number>(),pending=new Map<number,AnalysisContext>(),observed=new Set<number>();
export function registerAnalysisTarget(id:AnalysisTarget,open:()=>Promise<BrowserWindow>,owns:(event:any)=>boolean,exists?:(context:AnalysisContext)=>Promise<boolean>){modules.set(id,{open,owns,exists});}
async function destinationExists(target:AnalysisTarget,context:AnalysisContext):Promise<boolean>{
    try{
        if(target==='bom-analysis'){
            const result=await requestAypiBackend('/api/erp/bom-analysis',{method:'POST',body:context.bom?{bom:context.bom}:{article:context.article}});
            return result.rows?.length>0;
        }
        if(target==='turning-analysis')return await modules.get(target)?.exists?.(context)??false;
        if(target==='customer-analysis'){
            const result=await requestAypiBackend('/api/erp/customer-search',{method:'POST',body:{search:context.customerCode||context.customerName}});
            const same=(a:string,b?:string)=>!!b&&a?.trim().toLocaleLowerCase('it')===b.trim().toLocaleLowerCase('it');
            return result.customers?.some((c:any)=>context.customerCode?same(c.code,context.customerCode):same(c.name,context.customerName))??false;
        }
        const result=await requestAypiBackend(`/api/erp/${target}`,{method:'POST',body:{articles:context.article?[{op:'exact',value:context.article}]:[],...(context.documentId?{documentId:Number(context.documentId)}:{}),offset:0,limit:1}});
        return result.rows?.length>0;
    }catch{return false;}
}
export function canOpenAnalysis(sender:WebContents){return sender===main?.webContents||sender===hub?.webContents||[...modules.values()].some(m=>m.owns({sender}));}
export function registerAnalysisNavigation(mainWindow:BrowserWindow,icon:()=>string){
    registerAnalysisUiPreferences();
    main=mainWindow;
    ipcMain.on('analysis-context-ready',event=>{
        if(![...modules.values()].some(m=>m.owns(event)))return;
        const contents=event.sender,id=contents.id;ready.add(id);
        if(!observed.has(id)){
            observed.add(id);contents.on('did-start-loading',()=>ready.delete(id));
            contents.once('destroyed',()=>{ready.delete(id);pending.delete(id);observed.delete(id);});
        }
        const context=pending.get(id);if(context){pending.delete(id);contents.send('analysis-open-context',context);}
    });
    const navigate=async(target:AnalysisTarget,context:AnalysisContext)=>{
        const module=modules.get(target);if(!module)throw Error('Modulo non disponibile.');
        const win=await module.open();
        if(Object.keys(context).length&&!win.isDestroyed()){
            const id=win.webContents.id;
            if(ready.has(id))win.webContents.send('analysis-open-context',context);else pending.set(id,context);
        }
        return {ok:true};
    };
    ipcMain.handle('commercial-analysis-open',async event=>{
        if(!canOpenAnalysis(event.sender))return {ok:false,error:'Finestra non autorizzata.'};
        if(hub&&!hub.isDestroyed()){hub.maximize();hub.show();hub.focus();return {ok:true};}
        const win=new BrowserWindow({width:1160,height:750,minWidth:920,minHeight:600,show:false,title:'AyPi · Analisi commerciali',icon:icon(),backgroundColor:'#f2f8fc',webPreferences:{nodeIntegration:true,contextIsolation:false}});
        hub=win;win.setMenu(null);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
        win.once('ready-to-show',()=>{if(!win.isDestroyed()){win.maximize();win.show();}});win.on('closed',()=>{if(hub===win)hub=null;});
        const theme=/[?&]theme=bluearchive(?:&|$)/.test(mainWindow.webContents.getURL())?'bluearchive':'standard';
        await win.loadFile(path.join(__dirname,'..','pages','commercial-analysis.html'),{query:{theme}});return {ok:true};
    });
    ipcMain.on('commercial-analysis-close',event=>{if(event.sender===hub?.webContents)hub.close();});
    ipcMain.handle('analysis-document-links',async(event,payload)=>{
        if(![...modules.values()].some(m=>m.owns(event)))return {ok:false,error:'Finestra non autorizzata.'};
        try{return {ok:true,...await requestAypiBackend('/api/erp/document-links',{method:'POST',body:payload})};}
        catch(error){return {ok:false,error:(error as Error).message.includes('(404)')?'Aggiornare il backend AyPi per i collegamenti tra documenti.':(error as Error).message};}
    });
    ipcMain.handle('analysis-navigate',async(event,payload)=>{
        try{
            if(!canOpenAnalysis(event.sender)||!ANALYSIS_TARGETS.includes(payload?.target))throw Error('Collegamento non autorizzato.');
            return await navigate(payload.target,validateAnalysisContext(payload.context));
        }catch(error){return {ok:false,error:(error as Error).message};}
    });
    ipcMain.handle('analysis-context-menu',async(event,payload)=>{
        try{
            const source=[...modules].find(([,m])=>m.owns(event))?.[0];if(!source)throw Error('Finestra non autorizzata.');
            const context=validateAnalysisContext(payload),items:Electron.MenuItemConstructorOptions[]=[],candidates:{target:AnalysisTarget;label:string;context:AnalysisContext}[]=[];
            const add=(target:AnalysisTarget,label:string,value:AnalysisContext)=>{
                if(target===source)return;
                candidates.push({target,label,context:value});
            };
            if(context.article){
                add('article-orders','Mostra articolo in Analisi venduto',{article:context.article});
                add('article-offers','Mostra articolo in Analisi offerte',{article:context.article});
                add('turning-analysis','Mostra dettagli Analisi Torneria',{article:context.article});
                add('bom-analysis','Mostra distinte che contengono l’articolo',{article:context.article});
                add('bom-analysis','Mostra composizione distinta',{bom:context.article});
            }
            if(context.bom){
                add('bom-analysis','Mostra composizione distinta',{bom:context.bom});
                add('article-orders','Mostra articolo in Analisi venduto',{article:context.bom});
                add('article-offers','Mostra articolo in Analisi offerte',{article:context.bom});
                add('turning-analysis','Mostra dettagli Analisi Torneria',{article:context.bom});
            }
            if(context.customerCode||context.customerName)add('customer-analysis','Mostra cliente in Analisi per cliente',{...(context.customerCode?{customerCode:context.customerCode}:{}),...(context.customerName?{customerName:context.customerName}:{})});
            if(context.customerName)add('turning-analysis','Mostra produzioni del cliente in Analisi Torneria',{...(context.customerCode?{customerCode:context.customerCode}:{}),customerName:context.customerName});
            if(context.documentId&&context.documentKind)add(context.documentKind==='order'?'article-orders':'article-offers',context.documentKind==='order'?'Mostra ordine in Analisi venduto':'Mostra offerta in Analisi offerte',{documentId:context.documentId,documentNo:context.documentNo,documentKind:context.documentKind});
            const available=await Promise.all(candidates.map(async item=>({item,exists:await destinationExists(item.target,item.context)})));
            if(event.sender.isDestroyed())return {ok:true};
            for(const {item,exists} of available)if(exists)items.push({label:item.label,click:()=>void navigate(item.target,item.context).catch(error=>{if(!event.sender.isDestroyed())event.sender.send('analysis-navigation-error',(error as Error).message);})});
            if(!items.length)return {ok:true};
            Menu.buildFromTemplate(items).popup({window:BrowserWindow.fromWebContents(event.sender)||undefined});return {ok:true};
        }catch(error){return {ok:false,error:(error as Error).message};}
    });
}
