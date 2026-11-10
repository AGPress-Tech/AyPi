export const CHART_PAGES=['dashboard','comparisons','machines','customers','articles','performance','simulator','quality'] as const;
export type ChartPage=typeof CHART_PAGES[number];
export const BUILTIN_CHARTS:Record<ChartPage,{id:string;label:string}[]>={
    dashboard:[{id:'turningMonthly',label:'Andamento del ricavo'},{id:'turningMachines',label:'Macchine per ricavo'},{id:'turningCustomers',label:'Clienti per ricavo'}],
    comparisons:[],machines:[{id:'entityMonthly',label:'Ricavo mensile / cumulativo'},{id:'entityRanking',label:'Ore per articolo'}],
    customers:[{id:'entityMonthly',label:'Ricavo mensile / cumulativo'},{id:'entityRanking',label:'Articoli per ricavo'}],
    articles:[{id:'entityMonthly',label:'Ricavo mensile / cumulativo'},{id:'entityRanking',label:'Articoli per ricavo'}],
    performance:[{id:'rateScatter',label:'Resa, pezzi e ore · esplorazione 2D / 3D / bolle'},{id:'rateRanking',label:'Resa per segmento'}],simulator:[],quality:[]
};
export const AXIS_METRICS={quantity:'Pezzi per registrazione',rate:'Resa €/h',production:'Ore produzione',setup:'Ore attrezzaggio',hours:'Ore totali',revenue:'Ricavo valorizzato €',unitPrice:'Prezzo €/pezzo',ideal:'Riferimento €/h',cycle:'Ciclo reale · s/pezzo'};
export type AxisMetric=keyof typeof AXIS_METRICS;
export const AGGREGATE_METRICS={revenue:'Ricavo valorizzato',quantity:'Pezzi lavorati',production:'Ore produzione',setup:'Ore attrezzaggio',hours:'Ore totali',rate:'Resa complessiva €/h',setupShare:'Quota attrezzaggio',registrations:'Registrazioni',orders:'Ordini distinti',customers:'Clienti',articles:'Articoli identificati'};
export type AggregateMetric=keyof typeof AGGREGATE_METRICS;
export type ScatterPreferences={mode:'scatter3d'|'bubble'|'scatter';x:AxisMetric;y:AxisMetric;z:AxisMetric;compressedX:boolean;scope:'current'|'compare'};
export type CustomChart=ScatterPreferences&{id:string;title:string;kind:'bar'|'line'|'doughnut'|'scatter3d'|'bubble';dimension:'machine'|'customer'|'article'|'month'|'year';metric:AggregateMetric;limit:number};
export type ChartLayout={hidden:string[];charts:CustomChart[];scatter:ScatterPreferences;layout:'compact'|'expanded'};
export type ChartPreferences={version:1;pages:Partial<Record<ChartPage,ChartLayout>>;presets:Partial<Record<ChartPage,{id:string;name:string;layout:ChartLayout}[]>>};
export const defaultScatter=():ScatterPreferences=>({mode:'scatter',x:'quantity',y:'rate',z:'production',compressedX:true,scope:'current'});
export const defaultChartLayout=():ChartLayout=>({hidden:[],charts:[],scatter:defaultScatter(),layout:'compact'});
export const emptyChartPreferences=():ChartPreferences=>({version:1,pages:{},presets:{}});
function object(value:any,keys:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error('Configurazione grafici non valida.');}
function id(value:any){if(typeof value!=='string'||!/^chart-[a-z0-9-]{1,70}$/i.test(value))throw Error('Identificatore grafico non valido.');return value;}
function label(value:any,max:number){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Nome del grafico o preset non valido.');return value.trim();}
function scatter(value:any):ScatterPreferences{
    object(value,['mode','x','y','z','compressedX','scope']);
    if(!['scatter3d','bubble','scatter'].includes(value.mode)||![value.x,value.y,value.z].every(k=>Object.prototype.hasOwnProperty.call(AXIS_METRICS,k))||new Set([value.x,value.y,value.z]).size!==3||typeof value.compressedX!=='boolean'||!['current','compare'].includes(value.scope))throw Error('Scegli tre misure diverse e opzioni degli assi valide.');
    return {mode:value.mode,x:value.x,y:value.y,z:value.z,compressedX:value.compressedX,scope:value.scope};
}
function layout(value:any,page:ChartPage):ChartLayout{
    object(value,['hidden','charts','scatter','layout']);
    if(!Array.isArray(value.hidden)||!Array.isArray(value.charts)||value.charts.length>8||!['compact','expanded'].includes(value.layout))throw Error('Massimo 8 grafici personalizzati per pagina.');
    const ids=BUILTIN_CHARTS[page].map(c=>c.id);if(value.hidden.length>ids.length+8||value.hidden.some((k:any)=>typeof k!=='string')||new Set(value.hidden).size!==value.hidden.length)throw Error('Visibilità dei grafici non valida.');
    const charts:CustomChart[]=value.charts.map((c:any)=>{
        object(c,['id','title','kind','dimension','metric','limit','mode','x','y','z','compressedX','scope']);
        if(!['bar','line','doughnut','scatter3d','bubble'].includes(c.kind)||!['machine','customer','article','month','year'].includes(c.dimension)||!Object.prototype.hasOwnProperty.call(AGGREGATE_METRICS,c.metric)||!Number.isInteger(c.limit)||c.limit<3||c.limit>30||c.kind==='line'&&!['month','year'].includes(c.dimension)||c.kind==='doughnut'&&!['revenue','quantity','production','setup','hours','registrations'].includes(c.metric))throw Error('Tipo, raggruppamento o indicatore non valido. Gli anelli richiedono misure additive; le linee una dimensione temporale.');
        const s=scatter({mode:c.mode,x:c.x,y:c.y,z:c.z,compressedX:c.compressedX,scope:c.scope});return {...s,id:id(c.id),title:label(c.title,100),kind:c.kind,dimension:c.dimension,metric:c.metric,limit:c.limit};
    });
    if(new Set(charts.map(c=>c.id)).size!==charts.length||value.hidden.some((key:string)=>!ids.includes(key)&&!charts.some(c=>c.id===key)))throw Error('Grafici duplicati o mancanti.');
    return {hidden:[...value.hidden],charts,scatter:scatter(value.scatter),layout:value.layout};
}
export function validateChartPreferences(input:unknown):ChartPreferences{
    const value=input as any;object(value,['version','pages','presets']);if(value.version!==1)throw Error('Versione dei preset non supportata.');object(value.pages,[...CHART_PAGES]);object(value.presets,[...CHART_PAGES]);
    const result=emptyChartPreferences();
    for(const page of CHART_PAGES){
        if(value.pages[page]!==undefined)result.pages[page]=layout(value.pages[page],page);
        if(value.presets[page]!==undefined){const presets=value.presets[page];if(!Array.isArray(presets)||presets.length>10)throw Error('Massimo 10 preset per pagina.');
            result.presets[page]=presets.map((p:any)=>{object(p,['id','name','layout']);return {id:id(p.id),name:label(p.name,60),layout:layout(p.layout,page)}});
            if(new Set(result.presets[page]!.map(p=>p.id)).size!==presets.length||new Set(result.presets[page]!.map(p=>p.name.toLocaleLowerCase('it'))).size!==presets.length)throw Error('Nomi o identificatori preset duplicati.');
        }
    }return result;
}
