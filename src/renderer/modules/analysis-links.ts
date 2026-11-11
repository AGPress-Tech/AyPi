import type {AnalysisContext} from '../../main/modules/analysis-navigation-model';
const ipc=require('electron').ipcRenderer;
export function installAnalysisLinks(resolve:(target:HTMLElement)=>AnalysisContext|null,error:(message:string)=>void){
    document.addEventListener('contextmenu',event=>{
        const context=resolve(event.target as HTMLElement);if(!context)return;
        event.preventDefault();void ipc.invoke('analysis-context-menu',context).then((result:any)=>{if(!result.ok)error(result.error);}).catch((e:Error)=>error(e.message));
    });
    ipc.on('analysis-navigation-error',(_event:any,message:string)=>error(message));
}
