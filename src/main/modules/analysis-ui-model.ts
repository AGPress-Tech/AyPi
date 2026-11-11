export type WorkspaceChart={id:string;source:string;title:string;kind:'bar'|'line'|'doughnut';limit:number;metric:string};
export type WorkspaceLayout={expanded:boolean;hidden:string[];charts:WorkspaceChart[]};
export type WorkspacePreferences={version:1;layout:WorkspaceLayout;presets:{name:string;layout:WorkspaceLayout}[]};
export const emptyWorkspace=():WorkspacePreferences=>({version:1,layout:{expanded:false,hidden:[],charts:[]},presets:[]});
export function validateWorkspace(value:any):WorkspacePreferences{
    const id=(s:any)=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
    const layout=(v:any):WorkspaceLayout=>{
        if(!v||typeof v.expanded!=='boolean'||!Array.isArray(v.hidden)||v.hidden.length>100||!v.hidden.every(id)||!Array.isArray(v.charts)||v.charts.length>12)throw Error('Configurazione grafici non valida.');
        const charts=v.charts.map((c:any)=>{
            if(!c||!id(c.id)||!c.id.startsWith('custom-')||!id(c.source)||typeof c.title!=='string'||!c.title.trim()||c.title.length>100||!['bar','line','doughnut'].includes(c.kind)||!Number.isInteger(c.limit)||c.limit<3||c.limit>240||typeof c.metric!=='string'||c.metric.length>100)throw Error('Grafico personalizzato non valido.');
            return {id:c.id,source:c.source,title:c.title.trim(),kind:c.kind,limit:c.limit,metric:c.metric};
        });
        if(new Set(charts.map((c:WorkspaceChart)=>c.id)).size!==charts.length)throw Error('Grafici duplicati.');
        return {expanded:v.expanded,hidden:[...new Set<string>(v.hidden)],charts};
    };
    if(!value||value.version!==1||!Array.isArray(value.presets)||value.presets.length>10)throw Error('Preset non validi.');
    const presets=value.presets.map((p:any)=>{if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>60)throw Error('Nome preset non valido.');return {name:p.name.trim(),layout:layout(p.layout)}});
    if(new Set(presets.map((p:any)=>p.name.toLocaleLowerCase('it'))).size!==presets.length)throw Error('Nomi preset duplicati.');
    return {version:1,layout:layout(value.layout),presets};
}
