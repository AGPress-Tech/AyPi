import {calendarDate} from './model';
export function validateMaintenancePreferences(value:any){
    const object=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
    const list=(v:any,max:number,length=128)=>{if(!Array.isArray(v)||v.length>max||v.some(x=>typeof x!=='string'||x.length>length))throw Error('Elenco preferenze non valido.');return [...new Set<string>(v)]};
    const views=['dashboard','records','machines','plans','due'];
    if(!object(value))throw Error('Preferenze non valide.');
    const presets=value.filterPresets??[];if(!Array.isArray(presets)||presets.length>10)throw Error('Massimo dieci preset filtri.');
    const names=new Set<string>();
    const filterPresets=presets.map(p=>{
        if(!object(p)||typeof p.name!=='string'||!p.name.trim()||p.name.length>60||names.has(p.name.trim().toLocaleLowerCase('it'))||!views.includes(p.view)||!object(p.filters))throw Error('Preset filtri non valido.');names.add(p.name.trim().toLocaleLowerCase('it'));
        const f=p.filters;if(!['','ordinary','extraordinary'].includes(f.kind)||typeof f.text!=='string'||f.text.length>1000||!Array.isArray(f.rules)||f.rules.length>30)throw Error('Filtri non validi.');
        const from=f.from?calendarDate(f.from):'',to=f.to?calendarDate(f.to):'';if(from&&to&&from>to)throw Error('Intervallo date invertito.');
        const rules=f.rules.map(r=>{if(!object(r)||typeof r.field!=='string'||!/^\w{1,100}$/.test(r.field)||!['contains','exact','prefix','gte','lte','empty','range','not'].includes(r.op)||typeof r.value!=='string'||r.value.length>1000||r.to!=null&&(typeof r.to!=='string'||r.to.length>1000))throw Error('Condizione filtro non valida.');return {field:r.field,op:r.op,value:r.value,to:r.to||''}});
        return {name:p.name.trim(),view:p.view,filters:{departments:list(f.departments,1000),machines:list(f.machines,10000),kind:f.kind,from,to,text:f.text,rules}};
    });
    const columns:any={};if(value.columns!=null&&!object(value.columns))throw Error('Colonne non valide.');for(const [view,keys] of Object.entries(value.columns||{})){if(!views.includes(view))throw Error('Vista colonne non valida.');columns[view]=list(keys,100,100)}
    const w=value.workspace??{version:1,layout:{expanded:false,hidden:[],charts:[]},presets:[]};
    const layout=(l:any)=>{if(!object(l)||typeof l.expanded!=='boolean'||!Array.isArray(l.charts)||l.charts.length>12)throw Error('Layout non valido.');const hidden=list(l.hidden,100,100),charts=l.charts.map(c=>{if(!object(c)||typeof c.id!=='string'||!/^custom-[\w-]{1,90}$/.test(c.id)||typeof c.source!=='string'||c.source.length>100||typeof c.title!=='string'||!c.title.trim()||c.title.length>100||!['bar','line','doughnut'].includes(c.kind)||!Number.isInteger(c.limit)||c.limit<3||c.limit>240||typeof c.metric!=='string'||c.metric.length>100)throw Error('Grafico non valido.');return {id:c.id,source:c.source,title:c.title,kind:c.kind,limit:c.limit,metric:c.metric}});if(new Set(charts.map(c=>c.id)).size!==charts.length)throw Error('Grafici duplicati.');return {expanded:l.expanded,hidden,charts}};
    if(w.version!==1||!Array.isArray(w.presets)||w.presets.length>10)throw Error('Preset grafici non validi.');const workspace={version:1,layout:layout(w.layout),presets:w.presets.map(p=>{if(typeof p?.name!=='string'||!p.name.trim()||p.name.length>60)throw Error('Nome preset non valido.');return {name:p.name,layout:layout(p.layout)}})};
    return {workspace,filterPresets,columns};
}
