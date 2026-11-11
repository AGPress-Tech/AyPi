import Chart from 'chart.js/auto';
import {analysisChartControls,setChartExpanded} from '../modules/analysis-chart-controls';
import {installAnalysisLinks} from '../modules/analysis-links';
import {contextFromAnalysisElement} from '../modules/document-links';
import type {AnalysisContext} from '../../main/modules/analysis-navigation-model';
import {axisLabel,axisTicks,countMetric} from '../modules/chart-axis';
import {color as chartColor} from 'chart.js/helpers';
import {cumulativeSeries} from '../../main/modules/turning-analysis/chart-values';
import {AGGREGATE_METRICS,AXIS_METRICS,BUILTIN_CHARTS,ChartPreferences,ChartLayout,CustomChart,ScatterPreferences,defaultChartLayout,defaultScatter,emptyChartPreferences,validateChartPreferences} from '../../main/modules/turning-analysis/chart-presets';
import {TurningScatter3D,SpatialPoint} from '../modules/turning-scatter3d';
import {ProductionHypothesis,defaultHypothesis,validateHypothesis,simulateAlternatives,simulationSummary} from '../../main/modules/turning-analysis/simulation';
import * as XLSX from 'xlsx';
import {TurningData,TurningRecord,TurningFilters,TurningSettings,TurningStats,MONTHS,UNKNOWN,emptyTurningSettings,filterTurningRecords,turningStats,turningGroups,turningSaturation,capacityFor,capacitySourceYear,monitoredForYear,turningTargetKey} from '../../main/modules/turning-analysis/model';
import {SortCriterion,SortValue,sortByCriteria,sortHierarchy} from '../../main/modules/analysis-sorting';
import {bindSortingHeaders,updateSortingBar} from '../modules/table-sorting';

const ipc=require('electron').ipcRenderer;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const num=(value:number,digits=1)=>new Intl.NumberFormat('it-IT',{maximumFractionDigits:digits}).format(value);
const euro=(value:number,digits=2)=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR',maximumFractionDigits:digits}).format(value);
const compact=(value:number)=>new Intl.NumberFormat('it-IT',{notation:'compact',maximumFractionDigits:2}).format(value);
const pct=(value:number)=>num(value*100,1)+'%';
const style=getComputedStyle(document.body),accent=style.getPropertyValue('--ops-accent').trim()||'#168eea',muted=style.getPropertyValue('--ops-muted').trim(),ink=style.getPropertyValue('--ops-ink').trim();
Chart.defaults.font.family=style.fontFamily;Chart.defaults.color=muted;
type Dimension='machine'|'customer'|'article';
type FilterDimension='machines'|'customers'|'articles';
type View='dashboard'|'comparisons'|'machines'|'customers'|'articles'|'performance'|'simulator'|'quality';
type Kind='text'|'money'|'price'|'number'|'integer'|'percent'|'rate'|'date'|'year';
type Column={key:string;label:string;kind:Kind;optional?:boolean;delta?:boolean;lowerBetter?:boolean};
type Row={id:string;values:Record<string,SortValue>;dimension?:Dimension;entity?:string;depth?:number;parent?:string;sortValues?:Record<string,SortValue>;tooltips?:Record<string,string>};
type TableSpec={key:string;columns:Column[];rows:Row[];total?:Row;note:string};
const charts=new Map<string,Chart>(),sortStates=new Map<string,SortCriterion[]>(),columnStates=new Map<string,Set<string>>(),knownColumns=new Map<string,Set<string>>(),expandedComparisons=new Set<string>();
const renderedChartIds=new Set<string>();
const spatialCharts=new Map<string,TurningScatter3D>();
let chartPreferences=emptyChartPreferences(),chartsDirty=false,editingChartId='';
const pageCharts=():ChartLayout=>chartPreferences.pages[view]||defaultChartLayout();
const chartHidden=(id:string)=>pageCharts().hidden.includes(id);
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let data:TurningData|null=null,settings=emptyTurningSettings(),view:View='dashboard',loading=false,settingsWarning='',chartsWarning='';
let filters:TurningFilters={years:[],from:1,to:12,machines:[],customers:[],articles:[]};
let filterUndoStack:TurningFilters[]=[],activeTable:TableSpec|null=null,visibleRows=250;
const ui={metric:'revenue',grouping:'machine',monthly:false,activeOnly:true,records:false,influence:'machine' as Dimension,minRecords:3,minHours:1,cumulative:false,layout:'compact',focusChart:'',periodMode:'compare',singleYear:0};
let chartMonthContext:{from:number;to:number}|null=null;
let simulationScenario=defaultHypothesis(),simulationTable:'real'|'result'='real',simulationOnlyReference=false,simulationReference:number|null=null,simulationPhase='',simulationOrder='',simulationError='';
let simulationControlsOpen=true,simulationDirty=false;
let simulationDraft={...defaultHypothesis(),value:'',quantity:'',setup:''};
const metricDefinitions:Record<string,{label:string;kind:Kind}>={revenue:{label:'Ricavo valorizzato',kind:'money'},quantity:{label:'Pezzi lavorati',kind:'number'},setup:{label:'Ore attrezzaggio',kind:'number'},production:{label:'Ore produzione',kind:'number'},hours:{label:'Ore totali',kind:'number'},rate:{label:'Resa complessiva €/h',kind:'rate'},registrations:{label:'Registrazioni',kind:'integer'},setupShare:{label:'Incidenza attrezzaggio',kind:'percent'},saturation:{label:'Saturazione mista',kind:'percent'}};
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const groupedPage=()=>['machines','customers','articles'].includes(view);
const analysisYears=()=>groupedPage()&&ui.periodMode==='single'?[filters.years.includes(ui.singleYear)?ui.singleYear:Math.max(...filters.years)]:filters.years;
const primaryYear=()=>Math.max(...analysisYears());
const comparisonYear=()=>{const years=[...analysisYears()].sort((a,b)=>a-b);return years.length>1?years[years.length-2]:data!.years.includes(years[0]-1)?years[0]-1:null};
const simulationMatch=(row:TurningRecord)=>(!simulationPhase||row.phase.toLocaleLowerCase('it')===simulationPhase.toLocaleLowerCase('it'))&&(!simulationOrder||row.order.toLocaleLowerCase('it').includes(simulationOrder.toLocaleLowerCase('it')));
const scopeRows=(year?:number)=>data?filterTurningRecords(data,filters,year===undefined?analysisYears():[year]).filter(row=>view!=='simulator'||simulationMatch(row)):[];
// Anni, mesi e intervalli definiscono il contesto; le dimensioni evidenziano
// la quota selezionata senza eliminare i totali dagli altri grafici.
const hasChartSelection=()=>!!(filters.machines.length||filters.customers.length||filters.articles.length);
const chartRows=(year=primaryYear())=>filterTurningRecords(data!,{...filters,machines:[],customers:[],articles:view==='simulator'?filters.articles:[]},[year]).filter(row=>view!=='simulator'||simulationMatch(row));
const fadeColor=(value:string,alpha=.2)=>chartColor(value).alpha(alpha).rgbString();
const dimensionKey=(dimension:Dimension):FilterDimension=>dimension==='machine'?'machines':dimension==='customer'?'customers':'articles';
const color=(index:number,total=filters.years.length)=>index===total-1?accent:['#526c84','#21988b','#8d72b7','#ca8944','#c46183','#658b37','#7173b1'][index]||`hsl(${index*137.5%360},55%,43%)`;
const ratio=(value:number,base:number)=>Math.abs(base)<1e-9?null:(value-base)/Math.abs(base);
const statValues=(stats:TurningStats):Record<string,SortValue>=>Object.fromEntries(Object.entries(stats).filter(([,value])=>value===null||typeof value!=='object').map(([key,value])=>[key,value as SortValue]));
function status(text:string,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);$('status').hidden=!error}
function format(value:SortValue,kind:Kind){
    if(value===null||value===undefined||typeof value==='number'&&!Number.isFinite(value))return '—';
    if(kind==='text')return String(value);
    if(kind==='year')return String(value);
    if(kind==='date')return String(value).slice(0,7).split('-').reverse().join('/');
    if(kind==='money')return euro(Number(value));if(kind==='price')return euro(Number(value),6);if(kind==='rate')return euro(Number(value))+'/h';if(kind==='percent')return pct(Number(value));
    return num(Number(value),kind==='integer'?0:2);
}
function defaultFilters():TurningFilters{
    const year=data!.years[data!.years.length-1],last=Math.max(...data!.records.filter(r=>r.year===year).map(r=>r.month));
    return {years:data!.years.slice(-3),from:1,to:last,machines:[],customers:[],articles:[]};
}
function validFilters(next:TurningFilters){
    if(!next.years.length)throw new Error('Seleziona almeno un esercizio.');
    if(next.from>next.to)throw new Error('Il mese iniziale deve precedere il mese finale.');
    for(const suffix of ['Rate','Price','Quantity']){const min=next['min'+suffix],max=next['max'+suffix];if(min!==undefined&&max!==undefined&&min>max)throw new Error('Intervallo numerico invertito.');}
}
function commit(next:TurningFilters,remember=true){
    try{validFilters(next)}catch(error){status((error as Error).message,true);syncFilters();return}
    if(remember){filterUndoStack.push(clone(filters));if(filterUndoStack.length>30)filterUndoStack.shift();}
    filters=clone(next);filters.years.sort((a,b)=>a-b);visibleRows=250;syncFilters();render();
}
function choose(dimension:Dimension,key:string,multiple=false){
    const next=clone(filters),field=dimensionKey(dimension);
    next[field]=multiple?(next[field].includes(key)?next[field].filter(v=>v!==key):[...next[field],key]):next[field].length===1&&next[field][0]===key?[]:[key];
    commit(next);
}
function pickerValues(dimension:FilterDimension){
    if(dimension==='machines')return [...data!.machines.map(m=>({value:m.code,label:m.code+(m.description?' · '+m.description:'')})),...data!.records.some(r=>r.machine===UNKNOWN)?[{value:UNKNOWN,label:'Non indicata'}]:[]];
    return data![dimension].map(value=>({value,label:value}));
}
function initPickers(){
    $('yearOptions').innerHTML=data!.years.map(year=>`<label><input type="checkbox" value="${year}" data-year-choice>${year}</label>`).join('');
    for(const field of ['machines','customers','articles'] as FilterDimension[]){
        const root=document.querySelector<HTMLElement>(`[data-dimension="${field}"]`)!;
        root.querySelector('.picker-options')!.innerHTML=pickerValues(field).map(({value,label})=>`<label data-search="${esc(label.toLocaleLowerCase('it'))}"><input type="checkbox" value="${esc(value)}"><span>${esc(label)}</span></label>`).join('');
    }
}
function syncFilters(){
    if(!data)return;
    $('yearSummary').textContent=filters.years.join(' · ');$('yearSummary').title=filters.years.join(', ');
    document.querySelectorAll<HTMLInputElement>('[data-year-choice]').forEach(input=>input.checked=filters.years.includes(+input.value));
    $<HTMLSelectElement>('fromMonth').value=String(filters.from);$<HTMLSelectElement>('toMonth').value=String(filters.to);
    for(const field of ['machines','customers','articles'] as FilterDimension[]){
        const root=document.querySelector<HTMLElement>(`[data-dimension="${field}"]`)!;
        root.querySelector('.selection-count')!.textContent=filters[field].length===1?filters[field][0]:filters[field].length?String(filters[field].length):field==='machines'?'Tutte':'Tutti';
        root.querySelectorAll<HTMLInputElement>('.picker-options input').forEach(input=>input.checked=filters[field].includes(input.value));
    }
    $<HTMLInputElement>('recordSearch').value=filters.search||'';
    for(const key of ['minRate','maxRate','minPrice','maxPrice','minQuantity','maxQuantity'])$<HTMLInputElement>(key).value=filters[key]===undefined?'':String(filters[key]);
    $('advancedCount').textContent=String(['search','minRate','maxRate','minPrice','maxPrice','minQuantity','maxQuantity'].filter(k=>filters[k]!==undefined&&filters[k]!=='').length||'');
    const reference=comparisonYear();$('scope').textContent=`KPI ${primaryYear()}${reference?' vs '+reference:''} · ${MONTHS[filters.from-1]}–${MONTHS[filters.to-1]}`;
    if(view==='simulator')$('scope').textContent=`Simulazione · ${filters.years.join(' · ')} · ${MONTHS[filters.from-1]}–${MONTHS[filters.to-1]}`;
    $('selectionChips').innerHTML=(['machines','customers','articles'] as FilterDimension[]).flatMap(field=>filters[field].slice(0,2).map(value=>`<button class="selection-chip" data-remove-field="${field}" data-remove-value="${esc(value)}" title="Rimuovi selezione">${esc(value)} ×</button>`).concat(filters[field].length>2?[`<button class="selection-chip" data-clear-field="${field}">+${filters[field].length-2} · azzera</button>`]:[])).join('');
    $<HTMLButtonElement>('undo').disabled=!filterUndoStack.length;
}
function metric(rows:readonly TurningRecord[],key:string,year:number,from=filters.from,to=filters.to,machine?:string){
    if(key==='saturation')return turningSaturation(data!,rows,year,{...filters,from,to,machines:machine?[machine]:filters.machines},settings).mixed;
    return turningStats(rows)[key] as number|null;
}
function renderKpis(){
    const year=primaryYear(),reference=comparisonYear(),current=turningStats(scopeRows(year)),previous=reference===null?null:turningStats(scopeRows(reference));
    const metrics=[['revenue','Ricavo valorizzato','money'],['hours','Ore impegno macchina','number'],['quantity','Pezzi lavorati · per fase','number'],['rate','Resa complessiva','rate'],['registrations','Registrazioni','integer'],['setupShare','Quota attrezzaggio','percent']] as const;
    $('kpis').innerHTML=metrics.map(([key,label,kind])=>{
        const value=current[key],base=previous?.[key],change=typeof value==='number'&&typeof base==='number'?ratio(value,base):null;
        const favor=change===null?'':(key==='setupShare'?-change:change)>0?'positive':change<0&&key!=='setupShare'||change>0&&key==='setupShare'?'negative':'';
        const display=value===null?'—':kind==='money'?compact(value)+' €':kind==='rate'?euro(value)+'/h':kind==='percent'?pct(value):num(value,kind==='integer'||kind==='number'&&key==='quantity'?0:1);
        return `<article class="kpi" data-metric="${key}"><small>${label}</small><strong title="${esc(format(value,kind))}">${esc(display)}</strong><p class="${favor}" title="${reference?'Confronto con '+reference+', stessi mesi e selezioni':'Nessun anno di confronto'}">${change===null?reference?'Confronto '+reference+': n.d.':'Nessun confronto':`${change>0?'+':''}${pct(change)} vs ${reference}`}</p></article>`;
    }).join('');
}
function panel(title:string,subtitle:string,body:string,actions=''){
    const id=body.match(/<canvas id="([^"]+)"/)?.[1];
    const tools=id?analysisChartControls(id,title,ui.focusChart===id,['turningMonthly','entityMonthly'].includes(id)?ui.cumulative:undefined):'';
    return `<article class="panel${id?' chart-panel':''}"><div class="panel-head"><div><h2>${esc(title)}</h2><p title="${esc(subtitle)}">${esc(subtitle)}</p></div><div class="panel-actions">${actions}${tools}</div></div>${body}</article>`;
}
const canvas=(id:string)=>`<div class="chart"><div class="chart-viewport"><canvas id="${id}"></canvas></div></div>`;
function donutFractions(instance:any){
    const tween=instance.$selectionTween;if(!tween)return null;
    const elapsed=reducedMotion.matches?1:Math.min(1,(performance.now()-tween.start)/420),ease=1-Math.pow(1-elapsed,4);
    return tween.to.map((value:number,i:number)=>tween.from[i]+(value-tween.from[i])*ease);
}
function chart(id:string,type:any,labels:string[],datasets:any[],options:any={},onSelect?:(index:number,multiple:boolean)=>void){
    const valueMetric=options.valueMetric||'';delete options.valueMetric;
    if(chartHidden(id)){$(id)?.closest<HTMLElement>('.panel')?.setAttribute('hidden','');return;}
    if(spatialCharts.has(id)){spatialCharts.get(id)!.destroy();spatialCharts.delete(id);}
    renderedChartIds.add(id);
    const previous=charts.get(id),node=$<HTMLCanvasElement>(id);
    const config:any={type,data:{labels,datasets},plugins:[{id:'turning-value-labels',afterDraw(instance:any){
        const ctx=instance.ctx,area=instance.chartArea;if(!area)return;
        if(type==='doughnut'){
            const source=datasets[0],value=(source?.highlightValues||source?.data||[]).reduce((s:number,v:any)=>s+(Number(v)||0),0),arc=instance.getDatasetMeta(0).data[0],radius=arc?.innerRadius||30,unit=source?.centerUnit??'€',label=compact(value)+(unit?' '+unit:'');
            let size=22;ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';do{ctx.font=`600 ${size}px ${style.fontFamily}`;if(ctx.measureText(label).width<radius*1.7)break;size--;}while(size>11);
            const x=arc?.x??(area.left+area.right)/2,y=arc?.y??(area.top+area.bottom)/2;ctx.fillStyle=ink;ctx.fillText(label,x,y-5);ctx.font=`11px ${style.fontFamily}`;ctx.fillStyle=muted;ctx.fillText(source?.highlightValues?'SELEZIONE':'TOTALE',x,y+15);ctx.restore();
        }else if(options.indexAxis==='y'){
            if(datasets.filter(d=>!d.highlightSeries).length>1)return;
            const bars=instance.getDatasetMeta(0).data;if(bars.length>1&&Math.abs(bars[1].y-bars[0].y)<12)return;
            ctx.save();ctx.font=`10px ${style.fontFamily}`;ctx.textBaseline='middle';
            bars.forEach((bar:any,i:number)=>{const value=Number(datasets[0].data[i]);if(!Number.isFinite(value))return;const unit=String(datasets[0].label||'').toLowerCase(),label=unit.includes('ricavo')?compact(value)+' €':unit.includes('€/h')?euro(value)+'/h':unit.includes('ore')?num(value)+' h':num(value);const width=ctx.measureText(label).width,inside=bar.x+width+9>area.right;ctx.fillStyle=inside?ink:muted;ctx.textAlign=inside?'right':'left';ctx.fillText(label,inside?bar.x-6:bar.x+6,bar.y)});ctx.restore();
        }
    }},{id:'turning-grouped-highlight',afterDatasetDraw(instance:any,args:any){
        const source=datasets[args.index];if(type!=='bar'||!source?.highlightValues)return;
        const ctx=instance.ctx;ctx.save();
        instance.getDatasetMeta(args.index).data.forEach((bar:any,i:number)=>{
            const total=Number(source.data[i]),selected=Number(source.highlightValues[i]),fallback=total>0?Math.max(0,Math.min(1,selected/total)):0;
            const tween=instance.$barSelectionTween,key=source.seriesKey+'|'+labels[i],t=tween?Math.min(1,(performance.now()-tween.start)/420):1;
            const fraction=tween&&tween.to[key]!==undefined?tween.from[key]+(tween.to[key]-tween.from[key])*(1-Math.pow(1-t,4)):fallback;
            if(!fraction)return;ctx.fillStyle=source.highlightColor||accent;ctx.fillRect(bar.base,bar.y-bar.height/2,(bar.x-bar.base)*fraction,bar.height);
        });ctx.restore();
    }},{id:'turning-donut-highlight',afterDatasetDraw(instance:any,args:any){
        if(type!=='doughnut'||args.index!==0||!datasets[0]?.highlightValues)return;
        const source=datasets[0],ctx=instance.ctx,fractions=donutFractions(instance);ctx.save();
        instance.getDatasetMeta(0).data.forEach((arc:any,i:number)=>{
            const total=Number(source.data[i]),selected=Number(source.highlightValues[i]),fraction=fractions?.[i]??(total>0?Math.max(0,Math.min(1,selected/total)):0);
            if(!fraction)return;
            ctx.beginPath();ctx.arc(arc.x,arc.y,arc.outerRadius,arc.startAngle,arc.startAngle+(arc.endAngle-arc.startAngle)*fraction);
            ctx.arc(arc.x,arc.y,arc.innerRadius,arc.startAngle+(arc.endAngle-arc.startAngle)*fraction,arc.startAngle,true);ctx.closePath();ctx.fillStyle=source.highlightColors[i];ctx.fill();
        });ctx.restore();
    }}],options:{responsive:true,maintainAspectRatio:false,devicePixelRatio:Math.max(2,window.devicePixelRatio||1),animation:reducedMotion.matches?false:{duration:420,easing:'easeOutQuart'},transitions:{active:{animation:{duration:140}}},
        interaction:{mode:'nearest',intersect:true},hover:{mode:'nearest',intersect:true},
        plugins:{legend:{display:datasets.some(d=>d.year)||type==='doughnut',position:type==='doughnut'?'right':'top',align:type==='doughnut'?'center':'end',labels:{boxWidth:10,boxHeight:10,padding:13,usePointStyle:true,font:{size:12},filter:(item:any)=>!datasets[item.datasetIndex]?.highlightSeries,...type==='doughnut'?{generateLabels:()=>labels.map((label,i)=>({text:label.length>26?label.slice(0,25)+'…':label,fillStyle:datasets[0].highlightColors?.[i]||datasets[0].backgroundColor[i],strokeStyle:'transparent',lineWidth:0,index:i,pointStyle:'circle',hidden:false}))}:{}},onClick:(event:any,item:any)=>{
            if(type==='doughnut'&&onSelect){onSelect(item.index,!!(event.native?.ctrlKey||event.native?.metaKey));return;}
            const year=datasets[item.datasetIndex]?.year;if(!year)return;const next=clone(filters);next.years=next.years.includes(year)?next.years.filter(y=>y!==year):[...next.years,year];commit(next);
        }},tooltip:{callbacks:{label:(ctx:any)=>{
            const source=ctx.dataset,index=ctx.dataIndex,value=Number(type==='doughnut'?ctx.parsed:options.indexAxis==='y'?ctx.parsed.x:ctx.parsed.y);
            if(source.highlightValues)return [`Totale: ${num(value,2)}`,`Selezione: ${num(Number(source.highlightValues[index]),2)}`];
            if(type==='bar'&&datasets[1]?.highlightSeries&&hasChartSelection())return [`Totale: ${num(Number(datasets[0].data[index]),2)}`,`Selezione: ${num(Number(datasets[1].data[index]),2)}`];
            return `${source.label||ctx.label}: ${num(value,2)}`;
        }}}},
        ...type==='doughnut'?{cutout:'70%',borderWidth:2,borderColor:'#fff'}:{scales:{x:{...options.indexAxis==='y'?{beginAtZero:true,grace:'15%'}:{},grid:{display:options.indexAxis==='y',color:'#edf0f3'},ticks:{font:{size:10},precision:countMetric(valueMetric)?0:undefined,maxRotation:0,callback:function(v:any){return options.indexAxis==='y'?axisLabel(+v,valueMetric):String((this as any).getLabelForValue(v)).slice(0,22)}}},y:{beginAtZero:true,grid:{display:options.indexAxis!=='y',color:'#edf0f3'},ticks:{font:{size:10},precision:countMetric(valueMetric)?0:undefined,callback:function(v:any){return options.indexAxis==='y'?String((this as any).getLabelForValue(v)).slice(0,25):axisLabel(+v,valueMetric)}}}}},
        ...options,onHover:(_event:any,elements:any[],instance:any)=>{instance.canvas.style.cursor=onSelect&&elements.length?'pointer':'default'},onClick:(event:any,elements:any[])=>{if(onSelect&&elements.length)onSelect(elements[0].index,!!(event.native?.ctrlKey||event.native?.metaKey))},
    }};
    if(previous&&(previous.config as any).type===type){
        // Riutilizzare canvas e controller conserva le geometrie iniziali per
        // animare verso la nuova selezione, senza ripartire ogni volta da zero.
        if(type==='bar'&&datasets.some(d=>d.highlightValues)){
            const prior=(previous as any).$barSelectionTween,now=performance.now(),from:Record<string,number>={},to:Record<string,number>={};
            datasets.forEach(source=>source.data.forEach((total:number,i:number)=>{const key=source.seriesKey+'|'+labels[i];to[key]=source.highlightValues?(total>0?Math.max(0,Math.min(1,source.highlightValues[i]/total)):0):1;const t=prior?Math.min(1,(now-prior.start)/420):1;from[key]=prior?.to[key]===undefined?1:prior.from[key]+(prior.to[key]-prior.from[key])*(1-Math.pow(1-t,4));}));
            const tween={start:now,from,to};(previous as any).$barSelectionTween=tween;
            if(!reducedMotion.matches){const frame=()=>{if(charts.get(id)!==previous||(previous as any).$barSelectionTween!==tween)return;previous.draw();if(performance.now()-now<420)requestAnimationFrame(frame)};requestAnimationFrame(frame);}
        }
        if(type==='doughnut'){
            const prior=donutFractions(previous),oldLabels=previous.data.labels||[],source=datasets[0];
            const to=source.data.map((total:number,i:number)=>source.highlightValues?(total>0?Math.max(0,Math.min(1,source.highlightValues[i]/total)):0):1);
            const tween={start:performance.now(),from:labels.map(label=>prior?.[oldLabels.indexOf(label)]??1),to};(previous as any).$selectionTween=tween;
            if(!reducedMotion.matches){const frame=()=>{if(charts.get(id)!==previous||(previous as any).$selectionTween!==tween)return;previous.draw();if(performance.now()-tween.start<420)requestAnimationFrame(frame)};requestAnimationFrame(frame);}
        }
        node.replaceWith(previous.canvas);previous.unbindEvents();previous.bindEvents();previous.data.labels=labels;
        const old=previous.data.datasets as any[];
        previous.data.datasets=datasets.map(next=>{const retained=old.find(d=>d.seriesKey&&d.seriesKey===next.seriesKey);return retained?Object.assign(retained,next):next});
        previous.options=config.options;previous.config.plugins.splice(0,previous.config.plugins.length,...config.plugins);previous.update();
    }else{previous?.destroy();charts.set(id,new Chart(node,config));}
}
function monthlyChart(id:string,key=ui.metric){
    const monthList=Array.from({length:filters.to-filters.from+1},(_,i)=>filters.from+i);
    const active=hasChartSelection();
    const years=analysisYears(),datasets=years.flatMap((year,i)=>{
        const base=chartRows(year),selected=scopeRows(year),values=(rows:TurningRecord[])=>monthList.map(month=>{const period=rows.filter(r=>r.month===month);return period.length?metric(period,key,year,month,month):null});
        const raw=values(base),chosen=values(selected).map((value,index)=>value??(raw[index]!==null?0:null)),total=ui.cumulative?cumulativeSeries(raw):raw,selection=ui.cumulative?cumulativeSeries(chosen):chosen,tint=color(i,years.length);
        const common={year,pointRadius:2.5,pointHoverRadius:5,borderWidth:2.2,tension:.16,spanGaps:false};
        return [{...common,seriesKey:`${year}:total`,label:String(year),data:total,borderColor:active?fadeColor(tint,.22):tint,backgroundColor:active?fadeColor(tint,.22):tint,order:1},
            {...common,seriesKey:`${year}:selection`,highlightSeries:true,label:`${year} · selezione`,data:active?selection:monthList.map(()=>null),borderColor:tint,backgroundColor:tint,order:0}];
    });
    chart(id,'line',monthList.map(m=>MONTHS[m-1].slice(0,3)),datasets,{valueMetric:key},(index,multiple)=>{const month=monthList[index],next=clone(filters);chartMonthContext??={from:filters.from,to:filters.to};next.from=ui.cumulative?Math.min(chartMonthContext.from,month):multiple?Math.min(filters.from,month):month;next.to=multiple?Math.max(filters.to,month):month;commit(next)});
}
function rankingChart(id:string,dimension:Dimension,key='revenue',limit=8){
    const source=groupedPage()&&ui.periodMode==='compare'?analysisYears().flatMap(y=>chartRows(y)):chartRows();
    const groups=turningGroups(source,dimension).sort((a,b)=>(b.stats[key]??0)-(a.stats[key]??0)).slice(0,limit);
    highlightedRanking(id,groups.map(g=>({key:g.key,value:g.stats[key]})),dimension,key);
}
function highlightedRanking(id:string,groups:{key:string;value:number|null}[],dimension:Dimension,key:string){
    const active=hasChartSelection(),selected=new Map(turningGroups(scopeRows(primaryYear()),dimension).map(g=>[g.key,g.stats[key]])),label=metricDefinitions[key]?.label||key;
    if(groupedPage()&&ui.periodMode==='compare'){
        const years=analysisYears(),datasets=years.map((year,index)=>{
            const total=new Map(turningGroups(chartRows(year),dimension).map(g=>[g.key,g.stats[key]])),chosen=new Map(turningGroups(scopeRows(year),dimension).map(g=>[g.key,g.stats[key]])),tint=color(index,years.length);
            return {seriesKey:String(year),year,label:String(year),data:groups.map(g=>total.get(g.key)??0),backgroundColor:active?fadeColor(tint):tint,highlightColor:tint,highlightValues:active?groups.map(g=>chosen.get(g.key)??0):undefined,borderRadius:3,maxBarThickness:24};
        });
        chart(id,'bar',groups.map(g=>g.key),datasets,{indexAxis:'y',valueMetric:key},(i,multiple)=>choose(dimension,groups[i].key,multiple));return;
    }
    chart(id,'bar',groups.map(g=>g.key),[
        {seriesKey:'total',label:active?label+' · totale':label,data:groups.map(g=>g.value),backgroundColor:active?fadeColor(accent):accent,borderRadius:3,maxBarThickness:28,grouped:false,order:1},
        {seriesKey:'selection',highlightSeries:true,label:label+' · selezione',data:groups.map(g=>active?(selected.get(g.key)??0):null),backgroundColor:accent,borderRadius:3,maxBarThickness:28,grouped:false,order:0},
    ],{indexAxis:'y',valueMetric:key},(i,multiple)=>choose(dimension,groups[i].key,multiple));
}
function dashboard(){
    $('content').innerHTML=`<div class="dashboard-grid">${panel('Andamento del ricavo'+(ui.cumulative?' · cumulativo':''),ui.cumulative?'Cumulato dall’inizio del periodo selezionato · stessi mesi per ogni anno':'Esercizi confrontati sugli stessi mesi · clic su un mese per esplorarlo',canvas('turningMonthly'))}${panel('Obiettivi e avanzamento','Anno KPI e selezioni correnti',`<div class="goal-list" id="goalList"></div>`,'<button data-open-goals>Imposta obiettivi</button>')}${panel('Macchine per ricavo · '+primaryYear(),'Clic per selezionare · Ctrl+clic per selezioni multiple',canvas('turningMachines'))}${panel('Clienti per ricavo · '+primaryYear(),'Seleziona una componente per aggiornare tutta l’analisi',canvas('turningCustomers'))}</div>`;
    monthlyChart('turningMonthly','revenue');rankingChart('turningMachines','machine');
    const groups=turningGroups(chartRows(),'customer').sort((a,b)=>b.stats.revenue-a.stats.revenue),top=groups.slice(0,7),others=groups.slice(7).reduce((s,g)=>s+g.stats.revenue,0);
    const selected=new Map(turningGroups(scopeRows(primaryYear()),'customer').map(g=>[g.key,g.stats.revenue])),active=hasChartSelection(),palette=[...top.map((_,i)=>[accent,'#267f88','#526d88','#9275b9','#cc924a','#67874d','#b65d7b'][i]),'#a5b4bf'];
    chart('turningCustomers','doughnut',[...top.map(g=>g.key),...others>0?['Altri clienti']:[]],[{seriesKey:'customers',data:[...top.map(g=>g.stats.revenue),...others>0?[others]:[]],backgroundColor:active?palette.map(c=>fadeColor(c)):palette,highlightColors:palette,highlightValues:active?[...top.map(g=>selected.get(g.key)||0),...others>0?[groups.slice(7).reduce((s,g)=>s+(selected.get(g.key)||0),0)]:[]]:undefined}],{},(i,multiple)=>{if(i<top.length)choose('customer',top[i].key,multiple);else{const next=clone(filters),keys=groups.slice(7).map(g=>g.key);next.customers=multiple?[...new Set([...next.customers,...keys])]:keys;commit(next)}});
    const current=turningStats(scopeRows(primaryYear())),ref=comparisonYear(),previous=ref===null?null:turningStats(scopeRows(ref)),target=settings.targets[turningTargetKey(filters,primaryYear())]||{};
    $('goalList').innerHTML=(['revenue','hours','registrations'] as const).map(key=>{
        const value=current[key],goal=target[key],base=goal??previous?.[key],progress=base&&base>0?value/base:null;
        return `<div class="goal-item"><header><span>${key==='revenue'?'Ricavo valorizzato':key==='hours'?'Ore impegno macchina':'Registrazioni'}</span><strong>${esc(key==='revenue'?compact(value)+' €':num(value,key==='registrations'?0:1))}</strong></header><div class="goal-track"><i style="width:${progress===null?0:Math.max(0,Math.min(100,progress*100))}%;${goal&&progress!==null&&progress>=1?'background:#17846f':''}"></i></div><small>${goal?`Obiettivo ${key==='revenue'?euro(goal):num(goal)} · ${progress===null?'n.d.':pct(progress)} raggiunto`:ref!==null?`Confronto ${ref}: ${key==='revenue'?euro(base||0):num(base||0)} · nessun obiettivo impostato`:'Imposta un obiettivo per misurare l’avanzamento'}</small></div>`;
    }).join('');
}
function comparisonColumns():Column[]{return filters.years.flatMap((year,i,years)=>[...i?[{key:`delta:${year}`,label:`Δ ${years[i-1]} → ${year}`,kind:metricDefinitions[ui.metric].kind,delta:true},{key:`percent:${year}`,label:`Δ % ${year}`,kind:'percent',delta:true}]:[],{key:`year:${year}`,label:String(year),kind:metricDefinitions[ui.metric].kind}] as Column[])}
function comparisonValues(rows:readonly TurningRecord[],machine?:string,month?:number){
    const values:Record<string,SortValue>={};let previous:number|null=null;
    filters.years.forEach((year,i)=>{const period=rows.filter(r=>r.year===year&&(month===undefined||r.month===month)),value=period.length?metric(period,ui.metric,year,month??filters.from,month??filters.to,machine):null;values[`year:${year}`]=value;values[`delta:${year}`]=i&&value!==null&&previous!==null?value-previous:null;values[`percent:${year}`]=i&&value!==null&&previous!==null?ratio(value,previous):null;previous=value;});return values;
}
function comparisonSpec():TableSpec{
    const source=filterTurningRecords(data!,filters),dimension=ui.grouping as Dimension,rows:Row[]=[];
    if(ui.grouping==='month'){
        for(let month=filters.from;month<=filters.to;month++)rows.push({id:'month:'+month,values:{entity:MONTHS[month-1],...comparisonValues(source,undefined,month)},sortValues:{entity:month}});
    }else for(const group of turningGroups(source,dimension).sort((a,b)=>a.key.localeCompare(b.key))){
        const id=dimension+'|'+group.key;rows.push({id,values:{entity:group.key,...comparisonValues(group.records,dimension==='machine'?group.key:undefined)},dimension,entity:group.key});
        if(ui.monthly)for(let month=filters.from;month<=filters.to;month++)rows.push({id:id+'|'+month,parent:id,depth:1,values:{entity:MONTHS[month-1],...comparisonValues(group.records,dimension==='machine'?group.key:undefined,month)},sortValues:{entity:month}});
    }
    return {key:'comparisons',columns:[{key:'entity',label:ui.grouping==='month'?'Mese':ui.grouping==='machine'?'Macchina':ui.grouping==='customer'?'Cliente':'Articolo',kind:'text'},...comparisonColumns()],rows,total:{id:'total',values:{entity:'TOTALE FILTRATO',...comparisonValues(source)}},note:`${metricDefinitions[ui.metric].label} · stessi mesi per tutti gli esercizi · valori assenti indicati con —`};
}
function groupedComparisonSpec(dimension:Dimension):TableSpec{
    const years=filters.years,source=filterTurningRecords(data!,filters),groups=turningGroups(source,dimension),keys=new Set(groups.map(g=>g.key));
    if(dimension==='machine'&&!ui.activeOnly)for(const y of years)for(const code of monitoredForYear(data!,y))if(!filters.machines.length||filters.machines.includes(code))keys.add(code);
    const metrics:Column[]=[{key:'revenue',label:'Ricavo',kind:'money'},{key:'quantity',label:'Pezzi',kind:'number'},{key:'hours',label:'h totali',kind:'number'},{key:'rate',label:'Resa €/h',kind:'rate'},
        {key:'setup',label:'h attrezzaggio',kind:'number',optional:true},{key:'production',label:'h produzione',kind:'number',optional:true},{key:'setupShare',label:'Quota attrezzaggio',kind:'percent',optional:true},{key:'idealRate',label:'Riferimento €/h',kind:'rate',optional:true},
        {key:'registrations',label:'Registrazioni',kind:'integer',optional:true},{key:'orders',label:'Ordini distinti',kind:'integer',optional:true},{key:'customers',label:'Clienti',kind:'integer',optional:true},{key:'articles',label:'Articoli',kind:'integer',optional:true},
        {key:'meanRate',label:'Media rese di riga',kind:'rate',optional:true},{key:'meanRevenue',label:'Ricavo medio registrazione',kind:'money',optional:true},{key:'minRevenue',label:'Ricavo minimo registrazione',kind:'money',optional:true},{key:'maxRevenue',label:'Ricavo massimo registrazione',kind:'money',optional:true},{key:'bestRate',label:'Resa massima registrazione',kind:'rate',optional:true},
        ...dimension==='machine'?[{key:'satMixed',label:'Saturazione mista',kind:'percent',optional:true},{key:'sat8',label:'Saturazione 8 h',kind:'percent',optional:true},{key:'sat14',label:'Saturazione 14 h',kind:'percent',optional:true}] as Column[]:[]];
    const columns:Column[]=[{key:'entity',label:dimension==='machine'?'Macchina':dimension==='customer'?'Cliente':'Articolo',kind:'text'},...years.flatMap((y,i)=>[...i?[{key:`delta:${y}`,label:`Δ ricavo % ${years[i-1]} → ${y}`,kind:'percent',delta:true} as Column]:[],...metrics.map(m=>({...m,key:m.key+':'+y,label:m.label+' '+y}))])];
    const values=(entity:string,records:TurningRecord[],total=false)=>{
        const result:Record<string,SortValue>={entity};let previous:number|null=null;
        for(const y of years){const period=records.filter(r=>r.year===y),stats=turningStats(period),s=dimension==='machine'?turningSaturation(data!,period,y,{...filters,machines:total?filters.machines:[entity]},settings):null;
            for(const m of metrics)result[m.key+':'+y]=!period.length?null:m.key==='satMixed'?s!.mixed:m.key==='sat8'?s!.eight:m.key==='sat14'?s!.fourteen:stats[m.key];
            result[`delta:${y}`]=period.length&&previous!==null?ratio(stats.revenue,previous):null;previous=period.length?stats.revenue:null;
        }return result;
    };
    return {key:dimension+':compare',columns,rows:[...keys].sort((a,b)=>a.localeCompare(b)).map(key=>({id:key,values:values(key,groups.find(g=>g.key===key)?.records||[]),dimension,entity:key})),total:{id:'total',values:values('TOTALE FILTRATO',source,true)},note:'Tutti gli indicatori confrontabili per anno, in ordine cronologico. Altri indicatori disponibili in Colonne. Pezzi per fase; resa = ricavi / ore.'};
}
function groupedSpec(dimension:Dimension):TableSpec{
    if(ui.periodMode==='compare')return groupedComparisonSpec(dimension);
    const year=filters.years.includes(ui.singleYear)?ui.singleYear:Math.max(...filters.years),years=[year],source=filterTurningRecords(data!,filters,years),groups=turningGroups(source,dimension),keys=new Set(groups.map(g=>g.key));
    if(dimension==='machine'&&!ui.activeOnly)for(const y of years)for(const code of monitoredForYear(data!,y))if(!filters.machines.length||filters.machines.includes(code))keys.add(code);
    const columns:Column[]=[{key:'entity',label:dimension==='machine'?'Macchina':dimension==='customer'?'Cliente':'Articolo',kind:'text'},...dimension==='machine'?[{key:'description',label:'Descrizione macchina',kind:'text',optional:true} as Column]:[],{key:`revenue:${year}`,label:`Ricavo ${year}`,kind:'money'},
        {key:'quantity',label:`Pezzi ${year}`,kind:'number'},{key:'setup',label:`h attr. ${year}`,kind:'number'},{key:'production',label:`h prod. ${year}`,kind:'number'},{key:'hours',label:`h tot. ${year}`,kind:'number'},
        {key:'rate',label:`Resa €/h ${year}`,kind:'rate'},{key:'meanRate',label:'Media rese di riga',kind:'rate',optional:true},{key:'idealRate',label:'Riferimento €/h',kind:'rate'},{key:'setupShare',label:'Quota attrezzaggio',kind:'percent'},
        {key:'meanRevenue',label:'Ricavo medio per registrazione',kind:'money',optional:true},{key:'minRevenue',label:'Ricavo minimo registrazione',kind:'money',optional:true},{key:'maxRevenue',label:'Ricavo massimo registrazione',kind:'money',optional:true},{key:'bestRate',label:'Resa massima registrazione',kind:'rate',optional:true},
        ...dimension==='machine'?[{key:'sat8',label:'Saturazione 8 h',kind:'percent',optional:true},{key:'sat14',label:'Saturazione 14 h',kind:'percent',optional:true},{key:'satMixed',label:'Saturazione mista',kind:'percent'}] as Column[]:[],
        {key:'registrations',label:'Registrazioni',kind:'integer'},{key:'orders',label:'Ordini distinti',kind:'integer'},{key:'articles',label:'Articoli identificati',kind:'integer',optional:true},{key:'customers',label:'Clienti',kind:'integer',optional:true}];
    const groupValues=(key:string,records:TurningRecord[])=>{
        const primary=records.filter(r=>r.year===year),stats=turningStats(primary),values:Record<string,SortValue>={entity:key,...statValues(stats)};let previous:number|null=null;
        years.forEach((y,i)=>{const period=records.filter(r=>r.year===y),value=period.length?turningStats(period).revenue:null;values[`revenue:${y}`]=value;values[`delta:${y}`]=i&&value!==null&&previous!==null?ratio(value,previous):null;previous=value;});
        if(dimension==='machine'){const saturation=turningSaturation(data!,primary,year,{...filters,machines:[key]},settings);values.sat8=saturation.eight;values.sat14=saturation.fourteen;values.satMixed=saturation.mixed;values.description=data!.machines.find(m=>m.code===key)?.description||'';}
        return values;
    };
    const rows=[...keys].sort((a,b)=>a.localeCompare(b)).map(key=>({id:key,values:groupValues(key,groups.find(g=>g.key===key)?.records||[]),dimension,entity:key}));
    const total=groupValues('TOTALE FILTRATO',source);if(dimension==='machine'){const s=turningSaturation(data!,source.filter(r=>r.year===year),year,filters,settings);total.sat8=s.eight;total.sat14=s.fourteen;total.satMixed=s.mixed;total.description='';}
    return {key:dimension+':single',columns,rows,total:{id:'total',values:total},note:`Anno ${year} · ${MONTHS[filters.from-1]}–${MONTHS[filters.to-1]}. Resa complessiva = ricavi / ore; pezzi sommati per fase.${dimension==='machine'?' Saturazione: '+(settings.capacityBasis==='annual'?'capacità annua Excel':'capacità proquota mesi')+'.':''}`};
}
function recordsSpec():TableSpec{
    const columns:Column[]=[{key:'article',label:'Articolo',kind:'text'},{key:'customer',label:'Cliente',kind:'text'},{key:'order',label:'N. ordine',kind:'text'},{key:'phase',label:'Fase',kind:'text'},{key:'date',label:'Periodo',kind:'date'},{key:'machine',label:'Macchina',kind:'text'},
        {key:'description',label:'Descrizione',kind:'text',optional:true},{key:'quantity',label:'Pezzi lavorati',kind:'number'},{key:'unitPrice',label:'€/pezzo',kind:'money'},{key:'revenue',label:'Ricavo valorizzato',kind:'money'},{key:'setup',label:'h attrezzaggio',kind:'number'},{key:'production',label:'h produzione',kind:'number'},{key:'hours',label:'h totali',kind:'number'},
        {key:'rate',label:'Resa €/h',kind:'rate'},{key:'ideal',label:'Riferimento €/h',kind:'rate'},{key:'cycle',label:'Ciclo reale · s/pezzo',kind:'number',optional:true},{key:'sheetCycle',label:'Ciclo scheda · s/pezzo',kind:'number',optional:true},{key:'note',label:'Note',kind:'text',optional:true},{key:'sourceRow',label:'Riga Excel',kind:'integer',optional:true}];
    const source=scopeRows(),stats=turningStats(source);
    const rows=source.map(r=>({id:String(r.id),values:{...r,sourceRow:r.id} as unknown as Record<string,SortValue>,dimension:'article' as Dimension,entity:r.article}));
    return {key:'records',columns,rows,total:{id:'total',values:{article:'TOTALE FILTRATO',quantity:stats.quantity,revenue:stats.revenue,setup:stats.setup,production:stats.production,hours:stats.hours,rate:stats.rate}},note:'Una riga = una registrazione/fase. I pezzi sommati tra fasi non rappresentano pezzi finiti distinti. I totali includono tutte le righe filtrate.'};
}
function performanceSpec(source=scopeRows(primaryYear())):TableSpec{
    const global=turningStats(source);
    return {key:'performance:'+ui.influence,columns:[{key:'entity',label:ui.influence==='machine'?'Macchina':ui.influence==='customer'?'Cliente':'Articolo',kind:'text'},
        {key:'registrations',label:'Registrazioni',kind:'integer'},{key:'hours',label:'Ore totali',kind:'number'},{key:'revenue',label:'Ricavo valorizzato',kind:'money'},{key:'rate',label:'Resa complessiva',kind:'rate'},{key:'deltaRate',label:'Δ €/h vs selezione',kind:'money',delta:true},
        {key:'idealRate',label:'Riferimento €/h',kind:'rate'},{key:'performance',label:'Resa / riferimento',kind:'percent'},{key:'gap',label:'Scarto da riferimento · €',kind:'money',delta:true},{key:'setupShare',label:'Quota attrezzaggio',kind:'percent'}],
        rows:turningGroups(source,ui.influence).filter(g=>g.stats.registrations>=ui.minRecords&&g.stats.hours>=ui.minHours).map(g=>({id:g.key,dimension:ui.influence,entity:g.key,values:{entity:g.key,...statValues(g.stats),deltaRate:g.stats.rate!==null&&global.rate!==null?g.stats.rate-global.rate:null,performance:g.stats.rate!==null&&g.stats.idealRate!==null&&g.stats.idealRate>0?g.stats.rate/g.stats.idealRate:null}})),
        note:'Associazioni descrittive nel periodo KPI, non effetti causali. Lo scarto dal riferimento non è una perdita economica accertata.'};
}
function sortedRows(spec:TableSpec,all=false){
    const rows=all?spec.rows:spec.rows.filter(r=>!r.parent||expandedComparisons.has(r.parent)),criteria=sortStates.get(spec.key)||[],value=(row:Row,key:string)=>row.sortValues?.[key]??row.values[key];
    return spec.key==='comparisons'?sortHierarchy(rows,criteria,{value,depth:r=>r.depth||0,pinned:()=>false}):sortByCriteria(rows,criteria,value);
}
function selectedColumns(spec:TableSpec){
    if(!columnStates.has(spec.key)){columnStates.set(spec.key,new Set(spec.columns.filter(c=>!c.optional).map(c=>c.key)));knownColumns.set(spec.key,new Set(spec.columns.map(c=>c.key)));}
    const state=columnStates.get(spec.key)!;state.add(spec.columns[0].key);
    // Le colonne dei ricavi/anni nuovi rimangono visibili dopo un cambio di esercizi.
    const known=knownColumns.get(spec.key)!;for(const col of spec.columns){if(!known.has(col.key)&&!col.optional)state.add(col.key);known.add(col.key);}
    return spec.columns.filter(c=>state.has(c.key));
}
function tableShell(){return `<div class="table-toolbar"><span id="tableSummary" class="table-note"></span><details class="columns-picker" id="tableColumns"><summary>Colonne</summary><div id="columnOptions" class="columns-popup"></div></details></div><div class="table-scroll" id="turningTableScroll" tabindex="0"><table id="turningTable"></table></div><div class="table-footer"><span id="tableCount"></span><button id="moreRows" hidden>Carica altre righe</button></div>`}
function renderTable(spec:TableSpec,reset=true){
    activeTable=spec;if(reset)visibleRows=250;
    const columns=selectedColumns(spec),all=sortedRows(spec),shown=all.slice(0,visibleRows),node=$<HTMLTableElement>('turningTable');
    const tableRow=(row:Row,total=false)=>`<tr ${total?'':`data-analysis-article="${esc(String(row.values.article|| (row.dimension==='article'?row.entity:'')||''))}" data-analysis-customer-name="${esc(String(row.values.customer||(row.dimension==='customer'?row.entity:'')||''))}"`} class="${total?'row-total':row.depth?'child-row':''}">${columns.map((col,i)=>{
        const value=row.values[col.key],display=format(value,col.kind),cls=col.delta&&typeof value==='number'&&Math.abs(value)>1e-9?(col.lowerBetter?-value:value)>0?'positive':'negative':'';
        let cell=esc(display);
        if(i===0&&!total&&spec.key==='comparisons'&&ui.monthly&&ui.grouping!=='month'&&!row.depth)cell=`<button class="row-toggle" data-expand="${esc(row.id)}" aria-expanded="${expandedComparisons.has(row.id)}">${expandedComparisons.has(row.id)?'▾':'▸'} ${cell}</button>`;
        else if(!total&&col.key==='reference'&&spec.key.startsWith('simulator'))cell=`<button class="simulation-reference" data-simulation-reference="${row.values.sourceRow??row.id}" aria-pressed="${simulationOnlyReference&&simulationReference===Number(row.values.sourceRow??row.id)}" title="Usa solo questa riga come riferimento">${simulationOnlyReference&&simulationReference===Number(row.values.sourceRow??row.id)?'●':'◎'}</button>`;
        else if(i===0&&!total&&row.dimension&&row.entity)cell=`<button class="row-link" data-pick-dimension="${row.dimension}" data-pick-value="${esc(row.entity)}">${cell}</button>`;
        const contextField=!total&&(col.key==='article'||(i===0&&row.dimension==='article'))?'article':!total&&(col.key==='customer'||(i===0&&row.dimension==='customer'))?'customer':null;
        const contextValue=contextField==='article'?String(row.values.article||row.entity||''):String(row.values.customer||row.entity||'');
        return `<td ${contextField?`data-analysis-${contextField==='article'?'article':'customer-name'}="${esc(contextValue)}"`:''} class="${col.kind==='text'||col.kind==='date'?'':'numeric'} ${cls}" title="${esc(row.tooltips?.[col.key]||display)}">${cell}</td>`;
    }).join('')}</tr>`;
    node.innerHTML=`<thead><tr>${columns.map(col=>`<th class="${col.kind==='text'||col.kind==='date'?'':'numeric'}">${esc(col.label)}</th>`).join('')}</tr></thead><tbody>${shown.map(row=>tableRow(row)).join('')}${!shown.length?`<tr><td colspan="${columns.length}" class="empty-table">Nessuna registrazione con queste selezioni.</td></tr>`:''}</tbody>${spec.total?`<tfoot>${tableRow(spec.total,true)}</tfoot>`:''}`;
    const change=(next:SortCriterion[])=>{sortStates.set(spec.key,next);renderTable(spec)};
    bindSortingHeaders(node,columns,sortStates.get(spec.key)||[],change);updateSortingBar(node,spec.columns,sortStates.get(spec.key)||[],change);
    $('tableSummary').textContent=spec.note;$('tableSummary').title=spec.note;
    $('tableCount').textContent=`${num(shown.length,0)} di ${num(all.length,0)} righe · totali su tutta la selezione`;$('moreRows').hidden=shown.length>=all.length;
    $('columnOptions').innerHTML=spec.columns.map((col,i)=>`<label><input type="checkbox" data-column-key="${esc(col.key)}" ${columns.some(c=>c.key===col.key)?'checked':''} ${i===0?'disabled':''}>${esc(col.label)}</label>`).join('');
}
function entityDescription(dimension:Dimension){
    const field=dimensionKey(dimension);if(filters[field].length!==1)return `${filters[field].length?filters[field].length+' selezioni':'Tutto il reparto'} · confronti sugli stessi mesi`;
    const key=filters[field][0],rows=scopeRows(),groups=turningGroups(rows,'article').filter(g=>g.stats.hours>0).sort((a,b)=>(b.stats.rate||0)-(a.stats.rate||0));
    const months=filters.years.flatMap(year=>Array.from({length:filters.to-filters.from+1},(_,i)=>filters.from+i).map(month=>({year,month,stats:turningStats(rows.filter(r=>r.year===year&&r.month===month))}))).filter(m=>m.stats.registrations);
    const ordered=months.slice().sort((a,b)=>b.stats.revenue-a.stats.revenue),best=ordered[0],worst=ordered[ordered.length-1],description=dimension==='machine'?data!.machines.find(m=>m.code===key)?.description||'':key;
    return `${key}${description&&description!==key?' · '+description:''}${best?' · max '+MONTHS[best.month-1]+' '+best.year+' ('+euro(best.stats.revenue)+')':''}${worst?' · min '+MONTHS[worst.month-1]+' '+worst.year+' ('+euro(worst.stats.revenue)+')':''}${groups.length?' · resa articolo più alta '+groups[0].key+' ('+euro(groups[0].stats.rate||0)+'/h)':''}`;
}
function groupedView(dimension:Dimension){
    const title=dimension==='machine'?'Macchine':dimension==='customer'?'Clienti':'Articoli';
    const period=ui.periodMode==='compare'?analysisYears().join(' · '):String(primaryYear());
    $('content').innerHTML=`<div class="grouped-layout"><div class="analysis-mode-bar"><label>Modalità <select id="periodMode"><option value="compare" ${ui.periodMode==='compare'?'selected':''}>Confronta anni selezionati</option><option value="single" ${ui.periodMode==='single'?'selected':''}>Anno / periodo singolo</option></select></label>${ui.periodMode==='single'?`<label>Anno <select id="singleYear">${filters.years.map(year=>`<option value="${year}" ${year===primaryYear()?'selected':''}>${year}</option>`).join('')}</select></label>`:''}<span>Stessi mesi · ${esc(period)}</span></div><div class="split-view"><div class="chart-grid">${panel('Ricavo '+(ui.cumulative?'cumulativo':'mensile')+' · '+title,ui.cumulative?'Cumulato dall’inizio del periodo selezionato':'Confronto dei periodi selezionati',canvas('entityMonthly'))}${panel((dimension==='machine'?'Ore per articolo':'Articoli per ricavo')+' · '+period,'Clic su una barra per filtrare la selezione',canvas('entityRanking'))}</div>${panel(title+' · confronti e dettaglio',entityDescription(dimension),tableShell(),`<div class="view-tools">${dimension==='machine'?`<label><input type="checkbox" id="activeOnly" ${ui.activeOnly?'checked':''}> Solo voci con dati</label>`:''}${dimension==='article'?`<button id="recordMode">${ui.records?'Riepilogo articoli':'Registrazioni'}</button>`:''}</div>`)}</div></div>`;
    monthlyChart('entityMonthly','revenue');rankingChart('entityRanking','article',dimension==='machine'?'hours':'revenue',7);
    renderTable(dimension==='article'&&ui.records?recordsSpec():groupedSpec(dimension));
}
function comparisons(){
    const options=Object.entries(metricDefinitions).map(([key,value])=>`<option value="${key}" ${key===ui.metric?'selected':''}>${value.label}</option>`).join('');
    $('content').innerHTML=panel('Confronti pluriennali','Anni in ordine cronologico · delta tra esercizi selezionati consecutivi',tableShell(),`<div class="view-tools"><label>Indicatore<select id="comparisonMetric">${options}</select></label><label>Raggruppa<select id="comparisonGrouping">${[['month','Mese'],['machine','Macchina'],['customer','Cliente'],['article','Articolo']].map(([key,label])=>`<option value="${key}" ${ui.grouping===key?'selected':''}>${label}</option>`).join('')}</select></label><label><input id="monthlyDetail" type="checkbox" ${ui.monthly?'checked':''} ${ui.grouping==='month'?'disabled':''}> Dettaglio mensile</label><button id="expandComparisons">Espandi / comprimi</button></div>`);
    $('content').firstElementChild!.classList.add('full-panel');renderTable(comparisonSpec());
}
function scatterSource(config:ScatterPreferences){
    const years=config.scope==='compare'?analysisYears():[primaryYear()],base=years.flatMap(year=>chartRows(year)),selected=new Set(years.flatMap(year=>scopeRows(year)).map(row=>row.id));
    const rows=base.filter(row=>[config.x,config.y,...config.mode==='scatter'?[]:[config.z]].every(key=>typeof row[key]==='number'&&Number.isFinite(row[key]))&&(config.mode!=='bubble'||Number(row[config.z])>=0));
    return {years,base,rows,selected};
}
function renderScatter(id:string,config:ScatterPreferences){
    const node=$<HTMLCanvasElement>(id);if(chartHidden(id)){node.closest<HTMLElement>('.panel')!.hidden=true;return;}
    const {years,base,rows,selected}=scatterSource(config),active=hasChartSelection(),pointColor=(row:TurningRecord)=>fadeColor(color(years.indexOf(row.year),years.length),active&&!selected.has(row.id)? .12 : .8);
    const host=node.parentElement!;host.classList.add('scatter-host');
    const note=document.createElement('div');note.className='scatter-note';note.innerHTML=years.map((year,i)=>`<span style="color:${color(i,years.length)}">● ${year}</span>`).join(' ') + ` · ${rows.length}/${base.length} registrazioni con assi validi${config.mode==='bubble'?' · bolle: '+esc(AXIS_METRICS[config.z])+' (minimo visibile)':''}`;note.title=note.textContent||'';host.parentElement!.append(note);
    if(config.mode==='scatter3d'){
        charts.get(id)?.destroy();charts.delete(id);renderedChartIds.add(id);
        const previous=spatialCharts.get(id),instance=previous||new TurningScatter3D(node,(rowId,multiple)=>{const row=data!.records.find(r=>r.id===rowId);if(row)choose('article',row.article,multiple)},ink,muted);
        if(previous){node.replaceWith(instance.canvas);instance.mount();}spatialCharts.set(id,instance);
        const points:SpatialPoint[]=rows.map(row=>({id:row.id,x:Number(row[config.x]),y:Number(row[config.y]),z:Number(row[config.z]),selected:!active||selected.has(row.id),color:pointColor(row),label:`${row.article} · ${row.customer}\n${row.machine} · ${row.date.slice(0,7)} · ordine ${row.order||'—'} · fase ${row.phase||'—'}`}));
        instance.update(points,[{label:AXIS_METRICS[config.x],key:config.x,compressed:config.compressedX},{label:AXIS_METRICS[config.y],key:config.y},{label:AXIS_METRICS[config.z],key:config.z}]);return;
    }
    const zmax=Math.max(1,...rows.map(row=>Number(row[config.z])||0)),xValue=(v:number)=>config.compressedX?Math.sign(v)*Math.log1p(Math.abs(v)):v;
    chart(id,config.mode==='bubble'?'bubble':'scatter',[],[{seriesKey:'registrations',label:'Registrazioni',data:rows.map(row=>({x:xValue(Number(row[config.x])),y:Number(row[config.y]),...config.mode==='bubble'?{r:Math.max(2,Math.sqrt(Number(row[config.z])/zmax)*20)}:{}})),backgroundColor:rows.map(pointColor),pointRadius:rows.map(row=>active&&selected.has(row.id)?4:3)}],{
        plugins:{legend:{display:false},tooltip:{callbacks:{title:(items:any[])=>{const row=rows[items[0]?.dataIndex];return row?`${row.article} · ${row.customer}`:''},label:(context:any)=>{const row=rows[context.dataIndex];return [row.machine+' · '+row.date.slice(0,7),`${AXIS_METRICS[config.x]}: ${num(Number(row[config.x]),2)}`,`${AXIS_METRICS[config.y]}: ${num(Number(row[config.y]),2)}`,...config.mode==='bubble'?[`${AXIS_METRICS[config.z]}: ${num(Number(row[config.z]),2)}`]:[]]}}}},
        scales:{x:{type:'linear',afterBuildTicks:(scale:any)=>{const raw=rows.map(r=>Number(r[config.x]));scale.ticks=axisTicks(Math.min(0,...raw),Math.max(1,...raw),config.x,config.compressedX).map(v=>({value:xValue(v)}));},title:{display:true,text:AXIS_METRICS[config.x]},grid:{color:'#edf0f3'},ticks:{font:{size:11},maxRotation:0,callback:(v:number)=>axisLabel(config.compressedX?Math.sign(v)*Math.expm1(Math.abs(v)):v,config.x)}},y:{beginAtZero:true,title:{display:true,text:AXIS_METRICS[config.y]},grid:{color:'#edf0f3'},ticks:{font:{size:11},precision:countMetric(config.y)?0:undefined,callback:(v:number)=>axisLabel(v,config.y)}}}
    },(index,multiple)=>choose('article',rows[index].article,multiple));
}
function customGrouping(config:CustomChart,rows:TurningRecord[]){
    if(config.dimension==='month')return Array.from({length:filters.to-filters.from+1},(_,i)=>({key:String(filters.from+i),records:rows.filter(r=>r.month===filters.from+i)}));
    if(config.dimension==='year')return [...new Set(rows.map(r=>r.year))].sort((a,b)=>a-b).map(year=>({key:String(year),records:rows.filter(r=>r.year===year)}));
    return turningGroups(rows,config.dimension).map(g=>({key:g.key,records:g.records}));
}
function customSelect(config:CustomChart,key:string,multiple:boolean){
    if(config.dimension==='month'){const next=clone(filters),month=+key;chartMonthContext??={from:filters.from,to:filters.to};next.from=multiple?Math.min(next.from,month):month;next.to=multiple?Math.max(next.to,month):month;commit(next)}
    else if(config.dimension==='year'){const next=clone(filters);next.years=multiple?[...new Set([...next.years,+key])]:[+key];commit(next)}
    else choose(config.dimension,key,multiple);
}
function renderCustomCharts(){
    if(view==='simulator'&&filters.articles.length!==1){$('content').classList.remove('has-custom-charts');return;}
    const configs=pageCharts().charts.filter(c=>!chartHidden(c.id));$('content').classList.toggle('has-custom-charts',!!configs.length);if(!configs.length)return;
    const deck=document.createElement('div');deck.className='custom-chart-grid';
    deck.innerHTML=configs.map(c=>panel(c.title,`${c.scope==='compare'?'Anni selezionati':'Anno KPI'} · ${['scatter3d','bubble'].includes(c.kind)?'X '+AXIS_METRICS[c.x]+' · Y '+AXIS_METRICS[c.y]+' · Z '+AXIS_METRICS[c.z]:AGGREGATE_METRICS[c.metric]}`,canvas(c.id),`<button data-custom-edit="${c.id}" title="Modifica questo grafico">⚙</button>`)).join('');$('content').append(deck);
    for(const config of configs){
        if(['scatter3d','bubble'].includes(config.kind)){renderScatter(config.id,{...config,mode:config.kind as 'scatter3d'|'bubble'});continue;}
        const years=config.scope==='compare'?analysisYears():[primaryYear()],base=years.flatMap(y=>chartRows(y)),selected=years.flatMap(y=>scopeRows(y)),active=hasChartSelection();
        const all=customGrouping(config,base),groups=['month','year'].includes(config.dimension)?all:all.sort((a,b)=>(turningStats(b.records)[config.metric]??0)-(turningStats(a.records)[config.metric]??0)).slice(0,config.limit);
        if(config.kind==='doughnut'&&!['month','year'].includes(config.dimension)&&all.length>config.limit)groups.push({key:'__others__',records:all.slice(config.limit).flatMap(g=>g.records)});
        const labels=groups.map(g=>g.key==='__others__'?'Altre voci':config.dimension==='month'?MONTHS[+g.key-1].slice(0,3):g.key);
        const value=(records:TurningRecord[])=>records.length?turningStats(records)[config.metric]:null;
        if(config.kind==='doughnut'){
            const totals=groups.map(g=>value(g.records)??0);if(all.some(g=>(value(g.records)??0)<0)){$(config.id).replaceWith(Object.assign(document.createElement('p'),{className:'chart-empty',textContent:'Sono presenti valori negativi: usa un grafico a barre o a linee per rappresentarli.'}));continue;}
            const selectedIds=new Set(selected.map(r=>r.id)),palette=groups.map((_,i)=>color(i,groups.length+1));
            chart(config.id,'doughnut',labels,[{seriesKey:'custom',data:totals,backgroundColor:active?palette.map(c=>fadeColor(c)):palette,highlightColors:palette,highlightValues:active?groups.map(g=>value(g.records.filter(r=>selectedIds.has(r.id)))??0):undefined,centerUnit:config.metric==='revenue'?'€':config.metric==='hours'||config.metric==='production'||config.metric==='setup'?'h':''}],{},(i,m)=>{if(groups[i].key!=='__others__')customSelect(config,groups[i].key,m);else{const next=clone(filters),field=dimensionKey(config.dimension as Dimension),keys=all.slice(config.limit).map(g=>g.key);next[field]=m?[...new Set([...next[field],...keys])]:keys;commit(next)}});continue;
        }
        const seriesYears=config.dimension==='year'?[null]:years;
        const datasets=seriesYears.flatMap((year,i)=>{
            const measure=(records:TurningRecord[])=>{const grouped=new Map(customGrouping(config,year===null?records:records.filter(r=>r.year===year)).map(g=>[g.key,g.records]));return groups.map(g=>value(grouped.get(g.key)||[]))},total=measure(base),chosen=measure(selected),tint=color(i,seriesYears.length),label=year===null?AGGREGATE_METRICS[config.metric]:String(year),common={seriesKey:String(year),year:year??undefined,label,data:total,borderColor:active?fadeColor(tint):tint,backgroundColor:active?fadeColor(tint):tint,borderWidth:config.kind==='line'?2.2:0,borderRadius:3,maxBarThickness:26,pointRadius:3,tension:.12};
            if(config.kind==='bar'&&['rate','setupShare'].includes(config.metric))return [{...common,label:label+' · totale'},{...common,seriesKey:String(year)+':selection',label:label+' · selezione',hidden:!active,highlightSeries:!active,data:chosen,backgroundColor:tint}];
            return config.kind==='bar'?[{...common,highlightColor:tint,highlightValues:active?chosen.map(v=>v??0):undefined}]:[{...common,order:1},{...common,seriesKey:String(year)+':selection',highlightSeries:true,label:label+' · selezione',data:active?chosen:groups.map(()=>null),borderColor:tint,backgroundColor:tint,order:0}];
        });
        chart(config.id,config.kind,labels,datasets,config.kind==='bar'?{indexAxis:'y',valueMetric:config.metric}:{valueMetric:config.metric},(i,m)=>customSelect(config,groups[i].key,m));
    }
}
function performanceView(){
    const scatter=pageCharts().scatter;
    $('content').innerHTML=`<div class="split-view"><div class="chart-grid">${panel('Resa e dimensione delle registrazioni',scatter.mode==='scatter3d'?'Trascina per ruotare · Ctrl+rotella per zoom · clic su un punto per selezionare l’articolo':'Ogni punto è una registrazione · clic per selezionare l’articolo',canvas('rateScatter'),`<select id="scatterMode" aria-label="Visualizzazione dispersione"><option value="scatter3d" ${scatter.mode==='scatter3d'?'selected':''}>3D</option><option value="bubble" ${scatter.mode==='bubble'?'selected':''}>Bolle</option><option value="scatter" ${scatter.mode==='scatter'?'selected':''}>2D</option></select><button data-edit-scatter title="Personalizza assi e periodo">Assi</button>`)}${panel('Resa complessiva per segmento · '+primaryYear(),'Ricavo / ore dei segmenti con campione minimo',canvas('rateRanking'))}</div>${panel('Fattori associati alla resa','Analisi descrittiva · selezioni e campione minimo espliciti',tableShell(),`<div class="view-tools"><select id="influenceDimension" aria-label="Dimensione rendimento">${[['machine','Macchine'],['customer','Clienti'],['article','Articoli']].map(([value,label])=>`<option value="${value}" ${ui.influence===value?'selected':''}>${label}</option>`).join('')}</select><label>Min. registrazioni<input id="minRecords" type="number" min="1" value="${ui.minRecords}"></label><label>Min. ore<input id="minHours" type="number" min="0" step="any" value="${ui.minHours}"></label></div>`)}</div>`;
    renderScatter('rateScatter',scatter);
    const spec=performanceSpec(),rank=performanceSpec(chartRows()).rows.slice().sort((a,b)=>(b.values.rate as number||0)-(a.values.rate as number||0)).slice(0,7);
    highlightedRanking('rateRanking',rank.map(r=>({key:r.entity!,value:r.values.rate as number|null})),ui.influence,'rate');renderTable(spec);
}
function simulatorSource(){
    if(filters.articles.length!==1||['?','0',UNKNOWN].includes(filters.articles[0]))return [];
    return filterTurningRecords(data!,filters).filter(simulationMatch);
}
function simulatorRows(){const rows=simulatorSource();return simulationOnlyReference?rows.filter(row=>row.id===simulationReference):rows;}
function simulationRealSpec():TableSpec{
    const source=simulatorSource(),stats=turningStats(source);
    const columns:Column[]=[{key:'reference',label:'Rif.',kind:'text'},{key:'customer',label:'Cliente',kind:'text'},{key:'article',label:'Articolo',kind:'text'},{key:'order',label:'N. ordine',kind:'text'},{key:'phase',label:'Fase',kind:'text'},{key:'machine',label:'Macchina',kind:'text'},
        {key:'unitPrice',label:'€/pezzo',kind:'price'},{key:'quantity',label:'N. pezzi',kind:'number'},{key:'setup',label:'Ore att.',kind:'number'},{key:'production',label:'Ore lav.',kind:'number'},{key:'hours',label:'Ore tot.',kind:'number'},{key:'revenue',label:'Ricavo tot.',kind:'money'},{key:'rate',label:'Resa oraria',kind:'rate'},{key:'date',label:'Mese / anno',kind:'date'},{key:'ideal',label:'Resa ottimale',kind:'rate'},{key:'cycle',label:'s/pezzo reali',kind:'number'},{key:'sheetCycle',label:'s/pezzo da scheda',kind:'number'},
        {key:'description',label:'Descrizione',kind:'text',optional:true},{key:'sourceRow',label:'Riga Excel',kind:'integer',optional:true}];
    return {key:'simulator-real',columns,rows:source.map(row=>({id:String(row.id),values:{...row,reference:'',sourceRow:row.id},tooltips:{article:row.description||'Descrizione non disponibile'}})),total:{id:'total',values:{reference:'',customer:'TOTALE RICERCA',quantity:stats.quantity,setup:stats.setup,production:stats.production,hours:stats.hours,revenue:stats.revenue,rate:stats.rate}},note:'Dati originali non modificabili · descrizione passando sull’articolo · ◎ sceglie una riga · pezzi conteggiati per registrazione/fase.'};
}
function simulationAlternatives(){
    const source=simulatorRows(),results=simulateAlternatives(source,simulationScenario);
    const a=simulationSummary(source,results.filter(r=>r.variant==='A'),{mode:'manual',...simulationScenario}),b=simulationSummary(source,results.filter(r=>r.variant==='B'),{mode:'manual',...simulationScenario});
    const denominator=source.reduce((sum,row)=>sum+((simulationScenario.includeSetup?row.hours:row.production)??0),0);
    const realRate=denominator>0&&source.every(row=>row.revenue!==null&&(simulationScenario.includeSetup?row.hours:row.production)!==null)?source.reduce((sum,row)=>sum+row.revenue!,0)/denominator:null;
    return {source,results,a,b,summary:{...a,realRate,count:results.length,valid:a.valid+b.valid,failed:a.failed+b.failed}};
}
function simulationResultSpec():TableSpec{
    const {source,results,summary}=simulationAlternatives();
    const columns:Column[]=[{key:'reference',label:'Rif.',kind:'text'},{key:'customer',label:'Cliente',kind:'text'},{key:'article',label:'Articolo',kind:'text'},{key:'order',label:'N. ordine',kind:'text'},{key:'phase',label:'Fase',kind:'text'},{key:'machine',label:'Macchina',kind:'text'},{key:'date',label:'Periodo',kind:'date'},
        {key:'realPrice',label:'€/pz reale',kind:'price'},{key:'price',label:'€/pz simulato',kind:'price'},{key:'deltaPrice',label:'Δ €/pz',kind:'price',delta:true,optional:true},{key:'realQuantity',label:'Lotto reale',kind:'number',optional:true},{key:'quantity',label:'Lotto simulato',kind:'number'},
        {key:'realCycle',label:'s/pz reali',kind:'number'},{key:'cycle',label:'s/pz simulati',kind:'number'},{key:'deltaCycle',label:'Δ s/pz',kind:'number',delta:true,lowerBetter:true,optional:true},{key:'setup',label:'h att. simulate',kind:'number',optional:true},{key:'production',label:'h lav. simulate',kind:'number',optional:true},{key:'hours',label:'h tot. simulate',kind:'number',optional:true},{key:'revenue',label:'Ricavo simulato',kind:'money',optional:true},
        {key:'realRate',label:'Resa reale · base scelta',kind:'rate'},{key:'rate',label:'Resa simulata',kind:'rate'},{key:'target',label:'Obiettivo €/h',kind:'rate'},{key:'gapTarget',label:'Δ vs obiettivo',kind:'rate',delta:true},{key:'deltaRate',label:'Δ vs reale €/h',kind:'rate',delta:true},{key:'deltaPercent',label:'Δ vs reale %',kind:'percent',delta:true,optional:true},
        {key:'requiredPrice',label:'€/pz per obiettivo',kind:'price',optional:true},{key:'requiredCycle',label:'s/pz per obiettivo',kind:'number',optional:true},{key:'message',label:'Esito',kind:'text'}];
    const rows=results.map(result=>{const row=source.find(r=>r.id===result.id)!;return {id:row.id+':'+result.variant,values:{...row,...result,sourceRow:row.id,reference:'',realPrice:row.unitPrice,realQuantity:row.quantity,realCycle:row.cycle,message:(result.ok?'✓ ':'⚠ ')+result.message} as unknown as Record<string,SortValue>,tooltips:{article:row.description||'Descrizione non disponibile'}}});
    columns.push({key:'variantLabel',label:'Alternativa',kind:'text'});
    const priority=['reference','customer','article','variantLabel','realRate','rate','realPrice','price','realCycle','cycle','quantity'];
    const ordered=[...priority.map(key=>columns.find(col=>col.key===key)!),...columns.filter(col=>!priority.includes(col.key))];
    ordered.find(col=>col.key==='realRate')!.label='Resa reale';ordered.find(col=>col.key==='gapTarget')!.optional=true;
    return {key:'simulator-result',columns:ordered,rows,note:`Base resa: ${simulationScenario.includeSetup?'attrezzaggio + produzione':'sola produzione'}. Resa reale ricalcolata sulla stessa base. A e B sono alternative: non si sommano tra loro. Nessun dato sorgente viene modificato.`};
}
function simulatorView(){
    const {source,results,summary,a,b}=simulationAlternatives(),article=filters.articles.length===1?filters.articles[0]:'';
    const descriptions=new Map<string,string>();for(const row of data!.records)if(!descriptions.has(row.article))descriptions.set(row.article,row.description);
    const field=(id:string,label:string,value:string,attrs='')=>`<label>${esc(label)}<input id="${id}" value="${esc(value)}" ${attrs}></label>`;
    $('content').innerHTML=`<div class="simulator-layout"><section class="simulation-search"><form id="simulationSearch"><label class="simulation-article">Articolo<input id="simulationArticle" list="simulationArticles" value="${esc(article)}" required placeholder="Scrivi o scegli il codice articolo" autocomplete="off"></label><datalist id="simulationArticles">${data!.articles.filter(a=>![UNKNOWN,'?','0'].includes(a)).map(a=>`<option value="${esc(a)}" label="${esc(descriptions.get(a)||'')}"></option>`).join('')}</datalist>${field('simulationLotMin','Lotto · pezzi da',filters.minQuantity===undefined?'':String(filters.minQuantity),'type="number" min="0" step="any"')}${field('simulationLotMax','A',filters.maxQuantity===undefined?'':String(filters.maxQuantity),'type="number" min="0" step="any"')}${field('simulationPhase','Fase',simulationPhase,'placeholder="Tutte"')}${field('simulationOrder','N. ordine',simulationOrder,'placeholder="Contiene…"')}<button type="submit" class="primary">Cerca</button></form><p>Macchina, cliente, esercizi e mesi: usa i filtri in alto. Lotto = numero di pezzi della registrazione.</p></section>
    <details class="simulation-controls" id="simulationControls" ${simulationControlsOpen?'open':''}><summary>Simula tempo / prezzo / resa <span>${simulationDirty?'Modifiche da applicare':'Due alternative per ogni produzione'}</span></summary><form id="simulationForm"><div class="simulation-fields"><label class="simulation-mode">Parametro da modificare<select id="simulationDriver"><option value="rate" ${simulationDraft.driver==='rate'?'selected':''}>Resa oraria · €/h</option><option value="cycle" ${simulationDraft.driver==='cycle'?'selected':''}>Tempo al pezzo · secondi</option><option value="price" ${simulationDraft.driver==='price'?'selected':''}>Prezzo al pezzo · €</option></select></label>
    ${field('simulationValue','Nuovo valore',simulationDraft.value,'type="number" min="0" max="1000000000000" step="any" placeholder="Valore originale se vuoto"')}<label>Tempo di riferimento<select id="simulationCycleSource"><option value="real" ${simulationDraft.cycleSource==='real'?'selected':''}>Ciclo reale</option><option value="sheet" ${simulationDraft.cycleSource==='sheet'?'selected':''}>Tempo da scheda</option></select></label><label class="simulation-check"><input id="simulationIncludeSetup" type="checkbox" ${simulationDraft.includeSetup?'checked':''}> Includi attrezzaggio nella resa</label>
    ${field('simulationQuantity','Lotto / riga (facoltativo)',simulationDraft.quantity,'type="number" min="0.000001" max="1000000000000" step="any" placeholder="Lotto originale"')}${field('simulationSetup','Attrezzaggio · h (facoltativo)',simulationDraft.setup,'type="number" min="0" max="1000000000000" step="any" placeholder="Attrezzaggio originale"')}</div><div class="simulation-actions"><p></p><button id="resetSimulation" type="button">Azzera ipotesi</button><button type="submit" class="primary" ${source.length?'':'disabled'}>Simula</button></div><div id="simulationVariantsGuide" class="simulation-variants-guide"></div></form></details>
    <div class="simulation-feedback ${simulationError?'error-text':''}" role="status">${esc(simulationError||(!article?'Seleziona un articolo per iniziare.':!source.length?simulationOnlyReference?'La riga di riferimento non rientra nei filtri: scegli un’altra riga oppure simula tutte le registrazioni.':'Nessuna registrazione trovata con questi filtri.':simulationDirty?'Ipotesi modificate: premi Simula per applicarle.':`${summary.valid}/${summary.count} scenari calcolati${summary.failed?' · '+summary.failed+' non calcolabili: consulta Esito':''}. Confronto sulla ${simulationScenario.includeSetup?'somma di attrezzaggio e produzione':'sola produzione'}.`))}</div>
    <div class="simulation-summary">${[['Resa reale',summary.realRate,'rate'],['Resa alternativa A',a.rate,'rate'],['Resa alternativa B',b.rate,'rate'],['Alternative calcolate',summary.valid,'integer']].map(([label,value,kind])=>`<div><small>${esc(label)}</small><strong class="${label==='Δ resa vs reale'&&typeof value==='number'?value>0?'positive':value<0?'negative':'':''}">${esc(format(value as SortValue,kind as Kind))}</strong></div>`).join('')}</div>
    ${panel('Registrazioni e simulazione',simulationOnlyReference?'Riferimento: riga Excel '+simulationReference:'Scenari indipendenti per tutte le registrazioni filtrate',tableShell(),`<div class="view-tools"><button data-simulation-table="real" aria-pressed="${simulationTable==='real'}">Dati reali</button><button data-simulation-table="result" aria-pressed="${simulationTable==='result'}">Confronto simulato</button><select id="simulationScope" aria-label="Ambito simulazione"><option value="all" ${!simulationOnlyReference?'selected':''}>Tutte le righe</option><option value="reference" ${simulationOnlyReference?'selected':''} ${simulationReference===null?'disabled':''}>Solo riga scelta</option></select><button id="exportSimulation" ${simulatorSource().length?'':'disabled'}>↓ Esporta simulazione</button></div>`)}</div>`;
    renderTable(simulationTable==='real'?simulationRealSpec():simulationResultSpec());
    updateSimulationGuide();
}
function updateSimulationGuide(){
    const driver=simulationDraft.driver,guide=document.querySelector<HTMLElement>('.simulation-actions p');
    if(guide)guide.textContent='Vuoto = dato originale per ciascuna registrazione. Lotto e attrezzaggio restano fissi nelle due alternative. La resa di riferimento è quella reale sulla base scelta.';
    $('simulationVariantsGuide').innerHTML=(driver==='rate'?['A · Mantieni il prezzo: calcola il tempo al pezzo necessario.','B · Mantieni il tempo: calcola il prezzo necessario.']:driver==='cycle'?['A · Mantieni il prezzo: calcola la nuova resa oraria.','B · Mantieni la resa reale: calcola il nuovo prezzo.']:['A · Mantieni il tempo: calcola la nuova resa oraria.','B · Mantieni la resa reale: calcola il nuovo tempo al pezzo.']).map(text=>'<span>'+esc(text)+'</span>').join('');
    const input=$<HTMLInputElement>('simulationValue');input.min=driver==='price'?'0':'0.000001';input.closest('label')!.firstChild!.textContent=driver==='rate'?'Nuova resa · €/h':driver==='cycle'?'Nuovo tempo · s/pezzo':'Nuovo prezzo · €/pezzo';
}
function simulationFeedback(error=''){
    simulationError=error;const node=document.querySelector<HTMLElement>('.simulation-feedback');if(node){node.textContent=error||'Ipotesi modificate: premi Simula per applicarle.';node.classList.toggle('error-text',!!error)}
}
function readSimulationDraft(){
    simulationDraft.driver=$<HTMLSelectElement>('simulationDriver').value as ProductionHypothesis['driver'];simulationDraft.cycleSource=$<HTMLSelectElement>('simulationCycleSource').value as ProductionHypothesis['cycleSource'];simulationDraft.includeSetup=$<HTMLInputElement>('simulationIncludeSetup').checked;
    for(const [id,key] of [['simulationValue','value'],['simulationQuantity','quantity'],['simulationSetup','setup']])simulationDraft[key]=$<HTMLInputElement>(id).value;
    simulationDirty=true;simulationFeedback();const label=document.querySelector('#simulationControls summary span');if(label)label.textContent='Modifiche da applicare';updateSimulationGuide();
}
function applySimulation(){
    readSimulationDraft();if(!simulatorRows().length)throw Error('Scegli prima un articolo e almeno una registrazione.');
    const scenario:ProductionHypothesis={driver:simulationDraft.driver,cycleSource:simulationDraft.cycleSource,includeSetup:simulationDraft.includeSetup};
    for(const [id,key] of [['simulationValue','value'],['simulationQuantity','quantity'],['simulationSetup','setup']]){const input=$<HTMLInputElement>(id);if(!input.checkValidity())throw Error('Inserisci un valore positivo; prezzo e attrezzaggio possono essere zero.');if(input.value!=='')scenario[key]=Number(input.value);}
    simulationScenario=validateHypothesis(scenario);simulationTable='result';simulationDirty=false;simulationError='';render();requestAnimationFrame(()=>document.querySelector('.simulator-layout>.panel')?.scrollIntoView({block:'nearest',behavior:reducedMotion.matches?'auto':'smooth'}));
}
function quality(){
    const q=data!.quality,annual=data!.years.map(year=>({year,stats:turningStats(data!.records.filter(r=>r.year===year))}));
    $('content').innerHTML=`<div class="quality-layout"><article class="panel"><div class="quality-copy"><div class="eyebrow">ORIGINE E CRITERI</div><h2>Una lettura verificabile</h2><p><code>${esc(data!.source)}</code></p><dl><dt>Foglio registrazioni</dt><dd>COMPLETO</dd><dt>Parametri</dt><dd>VALORIZZAZIONE e formule annuali</dd><dt>Modifica del file</dt><dd>${esc(new Date(data!.modifiedAt).toLocaleString('it-IT'))}</dd><dt>Ultima lettura riuscita</dt><dd>${esc(new Date(data!.loadedAt).toLocaleString('it-IT'))}</dd><dt>Registrazioni incluse</dt><dd>${num(q.included,0)}</dd><dt>Intervallo degli esercizi</dt><dd>${data!.years[0]}–${data!.years[data!.years.length-1]}</dd></dl><h3>Calcoli adottati</h3><p>Ricavo valorizzato = prezzo × pezzi. Ore totali = attrezzaggio + produzione. La resa complessiva è ricavo totale / ore totali, distinta dalla media aritmetica delle rese delle registrazioni. Il ricavo valorizzato non è fatturato contabile.</p><p>Ogni riga è una registrazione/fase: i pezzi possono essere contati nuovamente in fasi diverse. Gli ordini distinti sono separati dal numero di registrazioni; il precedente Power BI chiamava “Conta Ordini” un conteggio delle righe articolo.</p><h3>Capacità e riferimenti</h3><p>La saturazione usa le capacità annue presenti nelle formule dell’Excel (8 h, 14 h e mista/robot). Con proquota mesi, la capacità è ripartita in dodicesimi: non rappresenta un calendario consuntivo di turni. I riferimenti €/h provengono dalle righe e da VALORIZZAZIONE; lo scarto non è una perdita economica accertata.</p><p>Le selezioni multiple sono combinate tra dimensioni. I KPI si riferiscono all’ultimo esercizio selezionato e al precedente selezionato, oppure all’anno prima se disponibile. I grafici e i confronti includono tutti gli anni selezionati, sugli stessi mesi.</p><p>Le impostazioni e gli obiettivi sono personali. Le celle numeriche vuote sono trattate come zero, come nelle formule elementari dell’Excel; i contenuti non numerici sono segnalati e non stimati. La lettura non esegue macro e l’esportazione crea un file separato.</p><h3>Segnalazioni della sorgente</h3><div class="quality-counters">${[['Valori non numerici',q.invalidInputs],['Celle vuote trattate come zero in Excel',q.blankNumericCells],['Date escluse',q.invalidDates],['Righe a prezzo zero/assente',q.unpriced],['Macchine mancanti',q.missingMachine],['Articoli non identificati',q.missingArticle],['Righe senza riferimento €/h',q.noIdeal],['Errori nelle formule memorizzate',q.cachedErrors],['Differenze dalle formule memorizzate',q.formulaDifferences]].map(([label,value])=>`<div><b>${num(Number(value),0)}</b>${label}</div>`).join('')}</div>${q.examples.length?'<h3>Esempi di segnalazioni</h3>'+q.examples.map(e=>`<p>Riga ${e.row}: ${esc(e.issue)}</p>`).join(''):''}</div></article>${panel('Quadratura degli esercizi','Totali dell’intero foglio, indipendenti dai filtri di analisi',tableShell())}</div>`;
    renderTable({key:'quality',columns:[{key:'year',label:'Anno',kind:'year'},{key:'registrations',label:'Registrazioni',kind:'integer'},{key:'quantity',label:'Pezzi per fase',kind:'number'},{key:'setup',label:'Ore attrezzaggio',kind:'number'},{key:'production',label:'Ore produzione',kind:'number'},{key:'hours',label:'Ore totali',kind:'number'},{key:'revenue',label:'Ricavo valorizzato',kind:'money'},{key:'rate',label:'Resa complessiva',kind:'rate'}],rows:annual.map(a=>({id:String(a.year),values:{year:a.year,...statValues(a.stats)}})),note:'Valori ricalcolati dai dati elementari; confronto diretto con le tabelle annuali Excel.'});
}
function render(){
    if(!data)return;
    document.body.dataset.view=view;syncFilters();document.body.dataset.layout=ui.layout;
    renderedChartIds.clear();activeTable=null;
    $('kpis').hidden=view==='quality'||view==='simulator';if(!$('kpis').hidden)renderKpis();
    document.querySelectorAll<HTMLElement>('[data-view]').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
    if(view==='dashboard')dashboard();else if(view==='comparisons')comparisons();else if(view==='machines')groupedView('machine');else if(view==='customers')groupedView('customer');else if(view==='articles')groupedView('article');else if(view==='performance')performanceView();else if(view==='simulator')simulatorView();else quality();
    renderCustomCharts();
    $('content').querySelectorAll<HTMLElement>('.chart-grid,.dashboard-grid').forEach(grid=>{const count=Array.from(grid.children).filter(el=>!(el as HTMLElement).hidden).length;grid.classList.toggle('one-panel',count===1);grid.classList.toggle('no-panels',count===0);grid.closest('.split-view')?.classList.toggle('no-chart-panels',count===0)});
    for(const [id,instance] of charts)if(!renderedChartIds.has(id)){instance.destroy();charts.delete(id);}
    for(const [id,instance] of spatialCharts)if(!renderedChartIds.has(id)){instance.destroy();spatialCharts.delete(id);}
    chartResizeObserver.disconnect();document.querySelectorAll('.chart-viewport').forEach(host=>chartResizeObserver.observe(host));
    if(ui.focusChart&&!renderedChartIds.has(ui.focusChart))ui.focusChart='';applyChartFocus();
    const warnings=[settingsWarning,chartsWarning].filter(Boolean).join(' · ');status(warnings,!!warnings);
    const coverage=filters.years.map(y=>`${y} ${new Set(data!.records.filter(r=>r.year===y&&r.month>=filters.from&&r.month<=filters.to).map(r=>r.month)).size}/${filters.to-filters.from+1}`).join(' · ');
    $('sourceFooter').textContent=`COMPLETO · Mesi in sorgente: ${coverage} · File ${new Date(data.modifiedAt).toLocaleString('it-IT')} · Lettura ${new Date(data.loadedAt).toLocaleString('it-IT')} · Pezzi per fase · Capacità ${settings.capacityBasis==='annual'?'annua Excel':'proquota mesi'}`;
    $('sourceFooter').title=$('sourceFooter').textContent+'\n'+data.source;
}
let resizeFrame=0;
const chartResizeObserver=new ResizeObserver(()=>resizeCharts());
function resizeCharts(){
    cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{
        for(const instance of charts.values()){
            const host=instance.canvas.parentElement;if(!host?.isConnected||host.closest('[hidden]'))continue;
            const width=host.clientWidth,height=host.clientHeight;if(width>0&&height>0&&(instance.width!==width||instance.height!==height))instance.resize(width,height);
        }
        for(const instance of spatialCharts.values())instance.resize();
    });
}
function applyChartFocus(){
    document.querySelectorAll<HTMLElement>('.chart-focused').forEach(panel=>{panel.classList.remove('chart-focused');panel.removeAttribute('role');panel.removeAttribute('aria-modal')});
    const panel=ui.focusChart?$(ui.focusChart)?.closest<HTMLElement>('.panel'):null;
    if(panel){panel.classList.add('chart-focused');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',panel.querySelector('h2')?.textContent||'Grafico');}
    document.body.classList.toggle('chart-focus-open',!!panel);$('chartBackdrop').hidden=!panel;
    document.querySelectorAll<HTMLElement>('[data-expand-chart]').forEach(button=>setChartExpanded(button,button.dataset.expandChart===ui.focusChart));
    panel?.querySelector<HTMLElement>('[data-expand-chart]')?.focus({preventScroll:true});resizeCharts();
}
function resetChartSelections(){
    if(!data)return;const next=clone(filters);next.machines=[];next.customers=[];next.articles=[];
    if(chartMonthContext){next.from=chartMonthContext.from;next.to=chartMonthContext.to;chartMonthContext=null;}commit(next);
}
function updateLayoutButton(){document.body.dataset.layout=ui.layout;$('layoutToggle').textContent=ui.layout==='expanded'?'↕ Vista compatta':'↕ Vista ampia';$('layoutToggle').setAttribute('aria-pressed',String(ui.layout==='expanded'));}
function chartMessage(message:string,error=false){$('chartsMessage').textContent=message;$('chartsMessage').classList.toggle('error-text',error);}
function updateChartPage(change:(layout:ChartLayout)=>void){
    const next=clone(chartPreferences),page={...clone(pageCharts()),layout:ui.layout as ChartLayout['layout']};change(page);next.pages[view]=page;
    chartPreferences=validateChartPreferences(next);chartsDirty=true;$('chartsMenu').textContent='Grafici •';ui.layout=page.layout;updateLayoutButton();render();
    if($<HTMLDialogElement>('chartsDialog').open)refreshChartsMenu();
}
function refreshChartsMenu(){
    const page=pageCharts(),all=[...BUILTIN_CHARTS[view].map(c=>({...c,custom:false})),...page.charts.map(c=>({id:c.id,label:c.title,custom:true}))];
    $('chartVisibility').innerHTML=all.length?all.map(c=>`<div class="chart-visibility-row"><label><input type="checkbox" data-chart-visible="${c.id}" ${page.hidden.includes(c.id)?'':'checked'}><span>${esc(c.label)}</span></label>${c.custom?`<div><button type="button" data-custom-edit="${c.id}" title="Modifica grafico">Modifica</button><button type="button" data-chart-move="${c.id}" data-step="-1" title="Sposta prima">↑</button><button type="button" data-chart-move="${c.id}" data-step="1" title="Sposta dopo">↓</button><button type="button" data-chart-delete="${c.id}" title="Elimina grafico">×</button></div>`:''}</div>`).join(''):'<p class="chart-editor-note">Questa pagina contiene una tabella. Puoi aggiungere qui i grafici che preferisci.</p>';
    $('builtinScatterSettings').hidden=view!=='performance';
    for(const [id,key] of [['builtinScatterMode','mode'],['builtinScatterScope','scope'],['builtinScatterX','x'],['builtinScatterY','y'],['builtinScatterZ','z']])$<HTMLSelectElement>(id).value=String(page.scatter[key]);
    $<HTMLInputElement>('builtinScatterCompressed').checked=page.scatter.compressedX;
    const presets=chartPreferences.presets[view]||[],selected=$<HTMLSelectElement>('chartPreset').value;
    $('chartPreset').innerHTML='<option value="">Scegli un preset…</option>'+presets.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');$<HTMLSelectElement>('chartPreset').value=selected;
}
function builderFields(){
    const kind=$<HTMLSelectElement>('customChartKind').value,spatial=['scatter3d','bubble'].includes(kind);$('spatialChartFields').hidden=!spatial;$('aggregateChartFields').hidden=spatial;
    const dimension=$<HTMLSelectElement>('customChartDimension');Array.from(dimension.options).forEach(option=>option.disabled=kind==='line'&&!['month','year'].includes(option.value));if(kind==='line'&&!['month','year'].includes(dimension.value))dimension.value='month';
    const metric=$<HTMLSelectElement>('customChartMetric');Array.from(metric.options).forEach(option=>option.disabled=kind==='doughnut'&&!['revenue','quantity','production','setup','hours','registrations'].includes(option.value));if(metric.selectedOptions[0]?.disabled)metric.value='revenue';
}
const newChartId=()=>'chart-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
function fillChartBuilder(config?:CustomChart){
    editingChartId=config?.id||'';const value=config||{...defaultScatter(),title:'Nuovo grafico',kind:'bar',dimension:'machine',metric:'revenue',limit:10,scope:'compare'};
    for(const [id,key] of [['customChartTitle','title'],['customChartKind','kind'],['customChartDimension','dimension'],['customChartMetric','metric'],['customChartLimit','limit'],['customChartScope','scope'],['customChartX','x'],['customChartY','y'],['customChartZ','z']])$<HTMLInputElement>(id).value=String(value[key]);
    $<HTMLInputElement>('customChartCompressed').checked=value.compressedX;$('chartBuilderHeading').textContent=editingChartId?'Modifica grafico':'Aggiungi un grafico';$('submitChart').textContent=editingChartId?'Applica modifica':'Aggiungi grafico';$('cancelChartEdit').hidden=!editingChartId;builderFields();
}
function openChartsMenu(editId?:string){
    if(!data)return;
    const names={dashboard:'Dashboard',comparisons:'Confronti',machines:'Macchine',customers:'Clienti',articles:'Articoli e registrazioni',performance:'Rendimenti',simulator:'Simulatore',quality:'Origine e verifiche'};
    $('chartsPageTitle').textContent='Grafici · '+names[view];refreshChartsMenu();fillChartBuilder(editId?pageCharts().charts.find(c=>c.id===editId):undefined);chartMessage(chartsWarning|| (chartsDirty?'Modifiche in anteprima: premi Salva pagina per conservarle.':'I grafici salvati vengono ripristinati alla prossima apertura.'),!!chartsWarning);
    if(!$<HTMLDialogElement>('chartsDialog').open)$<HTMLDialogElement>('chartsDialog').showModal();
}
async function persistCharts(next=chartPreferences){
    const snapshot=validateChartPreferences(clone(next)),origin=JSON.stringify(chartPreferences);chartMessage('Salvataggio dei grafici personali…');
    const result=await ipc.invoke('turning-analysis-charts-save',snapshot);if(!result.ok)throw Error(result.error);
    if(JSON.stringify(chartPreferences)===origin){chartPreferences=result.preferences;chartsDirty=false;$('chartsMenu').textContent='Grafici';}
    chartsWarning='';refreshChartsMenu();chartMessage('Grafici personali salvati su questo PC.');
}
function editCustomChart(id:string){openChartsMenu(id);$('chartBuilderHeading').scrollIntoView({block:'nearest',behavior:'smooth'});}
async function load(refresh=false){
    if(loading)return;loading=true;$<HTMLButtonElement>('refresh').disabled=true;status('Lettura e verifica del foglio COMPLETO…');
    try{
        const result=await ipc.invoke('turning-analysis-load',{refresh});if(!result.ok)throw new Error(result.error);
        const first=!data;data=result.data;
        if(first){filters=defaultFilters();const [saved,prefs]=await Promise.all([ipc.invoke('turning-analysis-settings-load'),ipc.invoke('turning-analysis-charts-load')]);if(saved.ok)settings=saved.settings;else settingsWarning=saved.error;if(prefs.ok){chartPreferences=prefs.preferences;if(chartPreferences.pages.performance)chartPreferences.pages.performance.scatter.mode='scatter';ui.layout=pageCharts().layout;updateLayoutButton();}else chartsWarning=prefs.error;}
        else{filters.years=filters.years.filter(y=>data!.years.includes(y));if(!filters.years.length)filters.years=[data!.years[data!.years.length-1]];}
        initPickers();syncFilters();render();$<HTMLButtonElement>('export').disabled=false;
    }catch(error){status(`Lettura non riuscita: ${(error as Error).message}${data?' · Restano visibili i dati dell’ultima lettura riuscita.':''}`,true)}
    finally{loading=false;$<HTMLButtonElement>('refresh').disabled=false;applyAnalysisContext();}
}
async function saveSettings(next:TurningSettings){const result=await ipc.invoke('turning-analysis-settings-save',next);if(!result.ok)throw new Error(result.error);settings=result.settings;settingsWarning='';render();}
function openGoals(){
    if(!data)return;const target=settings.targets[turningTargetKey(filters,primaryYear())]||{};
    for(const [id,key] of [['targetRevenue','revenue'],['targetHours','hours'],['targetRegistrations','registrations']])$<HTMLInputElement>(id).value=target[key]===undefined?'':String(target[key]);
    $('goalScope').textContent=`${primaryYear()} · ${MONTHS[filters.from-1]}–${MONTHS[filters.to-1]} · ${filters.machines.length?filters.machines.join(', '):'tutte le macchine'} · ${filters.customers.length?filters.customers.join(', '):'tutti i clienti'}${filters.articles.length?' · articoli '+filters.articles.join(', '):''}${filters.search?' · ricerca '+filters.search:''}`;
    $('goalError').textContent='';$<HTMLDialogElement>('goalDialog').showModal();
}
function fillCapacity(){
    if(!data)return;const year=+$<HTMLSelectElement>('capacityYear').value,machine=$<HTMLSelectElement>('capacityMachine').value,c=capacityFor(data,machine,year,settings);
    for(const [id,key] of [['capacityEight','eight'],['capacityFourteen','fourteen'],['capacityMixed','mixed']])$<HTMLInputElement>(id).value=c?String(c[key]):'';
    const own=data.capacities[year]?.[machine],custom=settings.capacities[`${year}|${machine}`];
    $('capacityOrigin').textContent=custom?'Modifica personale per questo anno e macchina.':own?'Capacità ricavata dalle formule del foglio '+year+'.':c?'Riferimento ricavato dal foglio '+capacitySourceYear(data,machine,year)+' (il più vicino disponibile); verificare la pertinenza per questo esercizio.':'Capacità non presente nelle formule disponibili: impostare un riferimento esplicito.';
    $('capacityError').textContent='';
}
function openCapacity(){
    if(!data)return;$<HTMLSelectElement>('capacityYear').innerHTML=data.years.map(year=>`<option>${year}</option>`).join('');$<HTMLSelectElement>('capacityYear').value=String(primaryYear());
    $<HTMLSelectElement>('capacityMachine').innerHTML=data.machines.filter(m=>/^21[A-Z]\d{3}$/i.test(m.code)).map(m=>`<option value="${esc(m.code)}">${esc(m.code+' · '+m.description)}</option>`).join('');
    if(filters.machines.length)$<HTMLSelectElement>('capacityMachine').value=filters.machines[0];
    $<HTMLSelectElement>('capacityBasis').value=settings.capacityBasis;fillCapacity();$<HTMLDialogElement>('capacityDialog').showModal();
}
function appendAnalysisSheet(book:XLSX.WorkBook,name:string,spec:TableSpec,allColumns=false){
    const columns=(allColumns?spec.columns:columnStates.has(spec.key)?selectedColumns(spec):spec.columns).filter(col=>col.key!=='reference'),rows=sortedRows(spec,true),values=[columns.map(c=>c.label),...rows.map(row=>columns.map(c=>row.values[c.key]??null)),...spec.total?[columns.map(c=>spec.total!.values[c.key]??null)]:[]];
    const sheet=XLSX.utils.aoa_to_sheet(values);sheet['!cols']=columns.map((col,i)=>({wch:i===0?24:col.kind==='text'?35:22}));sheet['!autofilter']={ref:sheet['!ref']||'A1'};
    for(let col=0;col<columns.length;col++)for(let r=1;r<values.length;r++){const cell=sheet[XLSX.utils.encode_cell({r,c:col})];if(cell?.t==='n'){const c=columns[col],pattern=c.kind==='price'?'#,##0.00####':c.kind==='percent'?'0.0%':'#,##0.00####';cell.z=c.kind==='year'?'0':c.kind==='integer'?'#,##0':c.delta?`[${c.lowerBetter?'Red':'Green'}]${pattern};[${c.lowerBetter?'Green':'Red'}]-${pattern};${pattern}`:pattern;}}
    XLSX.utils.book_append_sheet(book,sheet,name);
}
async function exportSimulation(){
    if(!data||!simulatorSource().length){status('Scegli un articolo con almeno una registrazione prima di esportare.',true);return;}
    const button=$<HTMLButtonElement>('export');button.disabled=true;const local=$<HTMLButtonElement>('exportSimulation');if(local)local.disabled=true;
    try{
        const book=XLSX.utils.book_new();appendAnalysisSheet(book,'Dati reali',simulationRealSpec(),true);appendAnalysisSheet(book,'Simulazione',simulationResultSpec(),true);
        const s=simulationScenario,{summary}=simulationAlternatives();
        const criteria=[['Origine',data.source],['Foglio','COMPLETO'],['Modifica file',data.modifiedAt],['Lettura riuscita',data.loadedAt],['Esportazione',new Date().toISOString()],['Articolo',filters.articles.join(', ')],['Filtri generali',JSON.stringify(filters)],['Fase',simulationPhase||'Tutte'],['Ordine contiene',simulationOrder||'Tutti'],['Ambito',simulationOnlyReference?'Riga Excel '+simulationReference:'Tutte le righe della ricerca'],['Registrazioni originali',simulatorSource().length],['Scenari validi',summary.valid],['Scenari non calcolabili',summary.failed],['Parametro modificato',s.driver],['Nuovo valore',s.value??'Originale per riga'],['Base resa',s.includeSetup?'Attrezzaggio + produzione':'Sola produzione'],['Tempo base',s.cycleSource==='sheet'?'Tempo da scheda':'Ciclo reale'],['Lotto simulato per riga',s.quantity??'Originale'],['Attrezzaggio h per riga',s.setup??'Originale'],['Alternative','A e B sono soluzioni alternative per la stessa produzione, non si sommano. La resa mantenuta è quella reale sulla base scelta.'],['Formula resa','Quantità × prezzo / (attrezzaggio incluso + quantità × secondi/pezzo / 3600)'],['Nota','Scenari indipendenti per registrazione/fase. I pezzi possono ripetersi in più fasi. Non è una modifica della sorgente né un preventivo aggregato di un singolo lotto.'],['Ordinamenti',JSON.stringify([...sortStates])]];
        XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(criteria),'Ipotesi e criteri');
        const result=await ipc.invoke('turning-analysis-export',XLSX.write(book,{type:'buffer',bookType:'xlsx'}));if(!result.ok)throw Error(result.error);status(result.canceled?'Esportazione annullata.':'Simulazione esportata: dati originali, risultati e ipotesi, su tutte le righe della ricerca.');
    }catch(error){status('Esportazione non riuscita: '+(error as Error).message,true)}finally{button.disabled=false;if(local?.isConnected)local.disabled=false;}
}
async function exportData(){
    if(view==='simulator')return exportSimulation();
    if(!data)return;const button=$<HTMLButtonElement>('export');button.disabled=true;status('Preparazione dell’esportazione completa…');
    try{
        const book=XLSX.utils.book_new();
        const add=(name:string,spec:TableSpec)=>appendAnalysisSheet(book,name,spec);
        add('Confronto esercizi',comparisonSpec());add('Macchine',groupedSpec('machine'));add('Clienti',groupedSpec('customer'));add('Articoli',groupedSpec('article'));add('Registrazioni',recordsSpec());add('Rendimenti',performanceSpec());
        const capacityRows:any[][]=[['Anno analisi','Macchina','Origine capacità','Capacità annua 8 h','Capacità annua 14 h','Capacità annua mista','Base scelta','Fattore mesi','Capacità periodo 8 h','Capacità periodo 14 h','Capacità periodo mista']];
        for(const year of filters.years){
            const machines=filters.machines.length?filters.machines:[...new Set([...monitoredForYear(data,year),...scopeRows(year).map(r=>r.machine)])];
            for(const machine of machines){const capacity=capacityFor(data,machine,year,settings),factor=settings.capacityBasis==='period'?(filters.to-filters.from+1)/12:1;
                capacityRows.push([year,machine,settings.capacities[`${year}|${machine}`]?'Personale':capacity?'Foglio '+capacitySourceYear(data,machine,year):'Non disponibile',capacity?.eight??null,capacity?.fourteen??null,capacity?.mixed??null,settings.capacityBasis,factor,capacity?capacity.eight*factor:null,capacity?capacity.fourteen*factor:null,capacity?capacity.mixed*factor:null]);}
        }
        XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(capacityRows),'Capacità utilizzate');
        const presentation=[['Modalità dettagli',ui.periodMode],['Anno singolo',ui.periodMode==='single'?(filters.years.includes(ui.singleYear)?ui.singleYear:Math.max(...filters.years)):null],['Esercizi effettivi della vista',analysisYears().join(', ')],['Grafico andamento',ui.cumulative?'Cumulativo dall’inizio del periodo selezionato':'Mensile']];
        presentation.push(['Grafici della pagina '+view,JSON.stringify(pageCharts())]);
        const meta=[['Origine',data.source],['Foglio','COMPLETO'],['Modifica file',data.modifiedAt],['Lettura riuscita',data.loadedAt],['Esportazione',new Date().toISOString()],['Filtri',JSON.stringify(filters)],['Anno KPI',primaryYear()],['Anno confronto KPI',comparisonYear()],['Indicatore confronto',ui.metric],['Raggruppamento confronto',ui.grouping],['Base capacità',settings.capacityBasis],['Capacità personali',JSON.stringify(settings.capacities)],['Ordinamenti',JSON.stringify([...sortStates])],['Obiettivi ambito corrente',JSON.stringify(settings.targets[turningTargetKey(filters,primaryYear())]||{})],['Definizione pezzi','Somma delle quantità di registrazioni/fasi; non pezzi finiti distinti.'],['Definizione ricavo','Quantità × prezzo della registrazione; non fatturato contabile.'],['Resa complessiva','Ricavo totale / ore totali; distinta dalla media aritmetica delle rese di riga.'],['Saturazione','Ore / capacità convenzionale; proquota per mesi se selezionato; non OEE.'],...Object.entries(data.quality).filter(([key])=>key!=='examples')];
        XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([...meta,...presentation]),'Origine e criteri');
        XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Riga Excel','Segnalazione'],...data.quality.examples.map(e=>[e.row,e.issue])]),'Verifiche');
        const result=await ipc.invoke('turning-analysis-export',XLSX.write(book,{type:'buffer',bookType:'xlsx'}));if(!result.ok)throw new Error(result.error);status(result.canceled?'Esportazione annullata.':'Esportazione completata: inclusi tutti i risultati filtrati, anche le righe non caricate a video.');
    }catch(error){status('Esportazione non riuscita: '+(error as Error).message,true)}finally{button.disabled=false}
}
// Eventi dei filtri: le selezioni sono condivise fra tutte le viste.
for(const id of ['fromMonth','toMonth']){$<HTMLSelectElement>(id).innerHTML=MONTHS.map((name,i)=>`<option value="${i+1}">${name}</option>`).join('');$(id).addEventListener('change',()=>{const next=clone(filters);next.from=+$<HTMLSelectElement>('fromMonth').value;next.to=+$<HTMLSelectElement>('toMonth').value;if(next.from>next.to){if(id==='fromMonth')next.to=next.from;else next.from=next.to;}commit(next)})}
document.querySelectorAll<HTMLElement>('[data-view]').forEach(button=>button.addEventListener('click',()=>{if(!data)return;view=button.dataset.view as View;visibleRows=250;render()}));
$('yearOptions').addEventListener('change',event=>{const input=event.target as HTMLInputElement,next=clone(filters);next.years=input.checked?[...next.years,+input.value]:next.years.filter(y=>y!==+input.value);commit(next)});
document.querySelectorAll<HTMLElement>('[data-years]').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();if(!data)return;const next=clone(filters);next.years=button.dataset.years==='all'?[...data.years]:data.years.slice(-Number(button.dataset.years));commit(next)}));
document.querySelectorAll<HTMLElement>('[data-dimension]').forEach(root=>{
    const field=root.dataset.dimension as FilterDimension;
    root.querySelector('.picker-search')!.addEventListener('input',event=>{const search=(event.target as HTMLInputElement).value.toLocaleLowerCase('it');root.querySelectorAll<HTMLElement>('[data-search]').forEach(label=>label.hidden=!label.dataset.search!.includes(search))});
    root.querySelector('.picker-options')!.addEventListener('change',event=>{const input=event.target as HTMLInputElement,next=clone(filters);next[field]=input.checked?[...next[field],input.value]:next[field].filter(v=>v!==input.value);commit(next)});
    root.querySelector('.clear-dimension')!.addEventListener('click',()=>{const next=clone(filters);next[field]=[];commit(next)});
});
$('selectionChips').addEventListener('click',event=>{const target=(event.target as HTMLElement).closest<HTMLElement>('button');if(!target)return;const next=clone(filters);if(target.dataset.clearField)next[target.dataset.clearField]=[];else{const field=target.dataset.removeField!;next[field]=next[field].filter((v:string)=>v!==target.dataset.removeValue)}commit(next)});
$('applyAdvanced').addEventListener('click',()=>{if(!data)return;const next=clone(filters);next.search=$<HTMLInputElement>('recordSearch').value.trim();for(const key of ['minRate','maxRate','minPrice','maxPrice','minQuantity','maxQuantity']){const input=$<HTMLInputElement>(key);if(input.value!==''&&!input.checkValidity()){status('Valore numerico non valido.',true);return}if(input.value==='')delete next[key];else next[key]=Number(input.value);}try{validFilters(next)}catch(error){status((error as Error).message,true);return}commit(next);$<HTMLDetailsElement>('advanced').open=false});
$('undo').addEventListener('click',()=>{const previous=filterUndoStack.pop();if(previous)commit(previous,false)});
$('reset').addEventListener('click',()=>{chartMonthContext=null;if(view==='simulator'){simulationPhase='';simulationOrder='';simulationOnlyReference=false;simulationReference=null;simulationError='';}if(data)commit(defaultFilters())});
$('layoutToggle').addEventListener('click',()=>{updateChartPage(page=>{page.layout=ui.layout==='compact'?'expanded':'compact'})});
$('chartsMenu').addEventListener('click',()=>openChartsMenu());
$('chartsDialog').addEventListener('close',()=>{if(ui.focusChart)applyChartFocus()});
$('chartBackdrop').addEventListener('click',()=>{ui.focusChart='';applyChartFocus()});
document.addEventListener('keydown',event=>{
    if(!ui.focusChart||document.querySelector('dialog[open]'))return;
    if(event.key==='Escape'){event.preventDefault();const id=ui.focusChart;ui.focusChart='';applyChartFocus();document.querySelector<HTMLElement>(`[data-expand-chart="${id}"]`)?.focus({preventScroll:true});}
    else if(event.key==='Tab'){
        const controls=Array.from(document.querySelectorAll<HTMLElement>('.chart-focused button,.chart-focused [tabindex="0"]')),first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
});
$('refresh').addEventListener('click',()=>void load(true));$('close').addEventListener('click',()=>ipc.send('turning-analysis-close'));$('export').addEventListener('click',()=>void exportData());$('capacity').addEventListener('click',openCapacity);
$('content').addEventListener('click',event=>{
    const target=(event.target as HTMLElement).closest<HTMLElement>('button');if(!target)return;
    if(target.hasAttribute('data-open-goals'))openGoals();
    else if(target.dataset.simulationTable){simulationTable=target.dataset.simulationTable as 'real'|'result';render();}
    else if(target.dataset.simulationReference){simulationReference=+target.dataset.simulationReference;simulationOnlyReference=true;simulationControlsOpen=true;simulationTable='result';simulationError='';render();}
    else if(target.id==='resetSimulation'){simulationScenario=defaultHypothesis();simulationDraft={...defaultHypothesis(),value:'',quantity:'',setup:''};simulationDirty=false;simulationError='';render();}
    else if(target.id==='exportSimulation')void exportSimulation();
    else if(target.hasAttribute('data-edit-scatter'))openChartsMenu();
    else if(target.dataset.customEdit)editCustomChart(target.dataset.customEdit);
    else if(target.hasAttribute('data-cumulative')){ui.cumulative=!ui.cumulative;render();}
    else if(target.dataset.resetChart)resetChartSelections();
    else if(target.dataset.expandChart){ui.focusChart=ui.focusChart===target.dataset.expandChart?'':target.dataset.expandChart;applyChartFocus();}
    else if(target.dataset.pickDimension)choose(target.dataset.pickDimension as Dimension,target.dataset.pickValue!,event.ctrlKey||event.metaKey);
    else if(target.dataset.expand){const key=target.dataset.expand;expandedComparisons.has(key)?expandedComparisons.delete(key):expandedComparisons.add(key);if(activeTable)renderTable(activeTable);}
    else if(target.id==='moreRows'){visibleRows+=250;if(activeTable)renderTable(activeTable,false);}
    else if(target.id==='recordMode'){ui.records=!ui.records;render();}
    else if(target.id==='expandComparisons'){const parents=comparisonSpec().rows.filter(r=>!r.depth).map(r=>r.id);if(parents.every(id=>expandedComparisons.has(id)))parents.forEach(id=>expandedComparisons.delete(id));else parents.forEach(id=>expandedComparisons.add(id));renderTable(comparisonSpec());}
});
$('content').addEventListener('change',event=>{
    const input=event.target as HTMLInputElement;
    if(input.closest('#simulationForm')){readSimulationDraft();return;}
    if(input.id==='simulationScope'){simulationOnlyReference=input.value==='reference';simulationError='';render();return;}
    if(input.dataset.columnKey&&activeTable){const key=input.dataset.columnKey,state=columnStates.get(activeTable.key)!;input.checked?state.add(key):state.delete(key);renderTable(activeTable,false);return;}
    if(input.id==='comparisonMetric')ui.metric=input.value;
    else if(input.id==='scatterMode'){updateChartPage(page=>{page.scatter.mode=input.value as ScatterPreferences['mode']});return;}
    else if(input.id==='periodMode'){ui.periodMode=input.value;ui.singleYear=filters.years.includes(ui.singleYear)?ui.singleYear:Math.max(...filters.years);}
    else if(input.id==='singleYear')ui.singleYear=+input.value;
    else if(input.id==='comparisonGrouping')ui.grouping=input.value;
    else if(input.id==='monthlyDetail')ui.monthly=input.checked;
    else if(input.id==='activeOnly')ui.activeOnly=input.checked;
    else if(input.id==='influenceDimension')ui.influence=input.value as Dimension;
    else if(input.id==='minRecords')ui.minRecords=Math.max(1,Number(input.value)||1);
    else if(input.id==='minHours')ui.minHours=Math.max(0,Number(input.value)||0);
    else return;render();
});
$('content').addEventListener('input',event=>{if((event.target as HTMLElement).closest('#simulationForm'))readSimulationDraft()});
$('content').addEventListener('toggle',event=>{if((event.target as HTMLElement).id==='simulationControls')simulationControlsOpen=(event.target as HTMLDetailsElement).open},true);
$('content').addEventListener('submit',event=>{
    const form=event.target as HTMLFormElement;if(!['simulationSearch','simulationForm'].includes(form.id))return;event.preventDefault();
    try{
        if(form.id==='simulationForm'){applySimulation();return;}
        const article=$<HTMLInputElement>('simulationArticle').value.trim();if(!data!.articles.includes(article)||[UNKNOWN,'?','0'].includes(article))throw Error('Ricerca non applicata: scegli un codice articolo presente nella sorgente.');
        const next=clone(filters);next.articles=[article];for(const [id,key] of [['simulationLotMin','minQuantity'],['simulationLotMax','maxQuantity']]){const input=$<HTMLInputElement>(id);if(!input.checkValidity())throw Error('Ricerca non applicata: intervallo lotto non valido.');if(input.value==='')delete next[key];else next[key]=Number(input.value);}
        validFilters(next);simulationPhase=$<HTMLInputElement>('simulationPhase').value.trim();simulationOrder=$<HTMLInputElement>('simulationOrder').value.trim();simulationOnlyReference=false;simulationReference=null;simulationError='';simulationTable='real';commit(next);
    }catch(error){simulationFeedback((error as Error).message)}
});
$('content').addEventListener('scroll',event=>{if((event.target as HTMLElement).id!=='turningTableScroll'||!activeTable)return;const el=event.target as HTMLElement;if(el.scrollHeight-el.clientHeight-el.scrollTop<100&&visibleRows<sortedRows(activeTable).length){visibleRows+=250;renderTable(activeTable,false)}},true);
document.addEventListener('click',event=>{document.querySelectorAll<HTMLDetailsElement>('.filter-picker,.columns-picker').forEach(details=>{if(!details.contains(event.target as Node))details.open=false})});
document.querySelectorAll<HTMLElement>('[data-close-dialog]').forEach(button=>button.addEventListener('click',()=>button.closest<HTMLDialogElement>('dialog')!.close()));
$('goalForm').addEventListener('submit',async event=>{
    event.preventDefault();const next=clone(settings),target:any={};
    for(const [id,key] of [['targetRevenue','revenue'],['targetHours','hours'],['targetRegistrations','registrations']]){const input=$<HTMLInputElement>(id);if(input.value){if(!input.checkValidity())return;target[key]=Number(input.value)}}
    const key=turningTargetKey(filters,primaryYear());if(Object.keys(target).length)next.targets[key]=target;else delete next.targets[key];
    try{await saveSettings(next);$<HTMLDialogElement>('goalDialog').close()}catch(error){$('goalError').textContent=(error as Error).message}
});
$('removeGoals').addEventListener('click',async()=>{const next=clone(settings);delete next.targets[turningTargetKey(filters,primaryYear())];try{await saveSettings(next);$<HTMLDialogElement>('goalDialog').close()}catch(error){$('goalError').textContent=(error as Error).message}});
for(const id of ['capacityYear','capacityMachine'])$(id).addEventListener('change',fillCapacity);
$('capacityForm').addEventListener('submit',async event=>{
    event.preventDefault();const next=clone(settings),key=$<HTMLSelectElement>('capacityYear').value+'|'+$<HTMLSelectElement>('capacityMachine').value;
    next.capacityBasis=$<HTMLSelectElement>('capacityBasis').value as TurningSettings['capacityBasis'];next.capacities[key]={eight:Number($<HTMLInputElement>('capacityEight').value),fourteen:Number($<HTMLInputElement>('capacityFourteen').value),mixed:Number($<HTMLInputElement>('capacityMixed').value)};
    try{await saveSettings(next);$<HTMLDialogElement>('capacityDialog').close()}catch(error){$('capacityError').textContent=(error as Error).message}
});
$('restoreCapacity').addEventListener('click',async()=>{const next=clone(settings),key=$<HTMLSelectElement>('capacityYear').value+'|'+$<HTMLSelectElement>('capacityMachine').value;delete next.capacities[key];next.capacityBasis=$<HTMLSelectElement>('capacityBasis').value as TurningSettings['capacityBasis'];try{await saveSettings(next);fillCapacity()}catch(error){$('capacityError').textContent=(error as Error).message}});
// Il catalogo è chiuso: i preset contengono solo misure e opzioni, mai codice.
for(const prefix of ['builtinScatter','customChart'])for(const axis of ['X','Y','Z'])$(prefix+axis).innerHTML=Object.entries(AXIS_METRICS).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('');
$('customChartMetric').innerHTML=Object.entries(AGGREGATE_METRICS).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join('');
$('customChartKind').addEventListener('change',builderFields);
$('cancelChartEdit').addEventListener('click',()=>fillChartBuilder());
$('chartBuilder').addEventListener('submit',event=>{
    event.preventDefault();try{
        const kind=$<HTMLSelectElement>('customChartKind').value as CustomChart['kind'];
        const config:CustomChart={id:editingChartId||newChartId(),title:$<HTMLInputElement>('customChartTitle').value.trim(),kind,dimension:$<HTMLSelectElement>('customChartDimension').value as CustomChart['dimension'],metric:$<HTMLSelectElement>('customChartMetric').value as CustomChart['metric'],limit:+$<HTMLInputElement>('customChartLimit').value,mode:kind==='bubble'?'bubble':'scatter3d',x:$<HTMLSelectElement>('customChartX').value as CustomChart['x'],y:$<HTMLSelectElement>('customChartY').value as CustomChart['y'],z:$<HTMLSelectElement>('customChartZ').value as CustomChart['z'],compressedX:$<HTMLInputElement>('customChartCompressed').checked,scope:$<HTMLSelectElement>('customChartScope').value as CustomChart['scope']};
        if(!['scatter3d','bubble'].includes(kind)){config.x='quantity';config.y='rate';config.z='production';config.compressedX=false;}
        updateChartPage(page=>{const existing=page.charts.findIndex(c=>c.id===config.id);if(existing>=0)page.charts[existing]=config;else page.charts.push(config);page.layout=ui.layout as ChartLayout['layout']});fillChartBuilder();chartMessage('Grafico applicato in anteprima. Premi Salva pagina per conservarlo.');
    }catch(error){chartMessage((error as Error).message,true)}
});
$('chartTemplates').addEventListener('click',event=>{
    const template=(event.target as HTMLElement).closest<HTMLElement>('[data-chart-template]')?.dataset.chartTemplate;if(!template)return;
    const choices:Record<string,Partial<CustomChart>>={monthly:{title:'Ricavi mensili',kind:'line',dimension:'month',metric:'revenue'},hours:{title:'Ore di produzione per macchina',metric:'production'},pieces:{title:'Pezzi lavorati per articolo',dimension:'article',metric:'quantity'},yield:{title:'Resa complessiva per cliente',dimension:'customer',metric:'rate'},setup:{title:'Quota attrezzaggio per macchina',metric:'setupShare'},spatial:{title:'Pezzi, resa e ore · mappa 3D',kind:'scatter3d'},bubble:{title:'Pezzi, resa e ore · bolle',kind:'bubble'}};
    fillChartBuilder({...defaultScatter(),id:'',title:'Nuovo grafico',kind:'bar',dimension:'machine',metric:'revenue',limit:10,scope:'compare',...choices[template]} as CustomChart);
});
$('chartVisibility').addEventListener('change',event=>{const input=event.target as HTMLInputElement;if(!input.dataset.chartVisible)return;try{updateChartPage(page=>{page.hidden=input.checked?page.hidden.filter(id=>id!==input.dataset.chartVisible):[...page.hidden,input.dataset.chartVisible!]});chartMessage('Visibilità aggiornata in anteprima. Premi Salva pagina per conservarla.');}catch(error){chartMessage((error as Error).message,true)}});
$('chartsDialog').addEventListener('click',event=>{
    const button=(event.target as HTMLElement).closest<HTMLElement>('button');if(!button)return;
    try{
        if(button.dataset.customEdit)editCustomChart(button.dataset.customEdit);
        else if(button.dataset.chartDelete){const id=button.dataset.chartDelete;updateChartPage(page=>{page.charts=page.charts.filter(c=>c.id!==id);page.hidden=page.hidden.filter(key=>key!==id)});if(editingChartId===id)fillChartBuilder();chartMessage('Grafico rimosso in anteprima. Salva pagina per conservare la modifica.');}
        else if(button.dataset.chartMove){updateChartPage(page=>{const index=page.charts.findIndex(c=>c.id===button.dataset.chartMove),target=index+Number(button.dataset.step);if(index>=0&&target>=0&&target<page.charts.length)[page.charts[index],page.charts[target]]=[page.charts[target],page.charts[index]]});}
    }catch(error){chartMessage((error as Error).message,true)}
});
$('applyBuiltinScatter').addEventListener('click',()=>{try{updateChartPage(page=>{page.scatter={mode:$<HTMLSelectElement>('builtinScatterMode').value as ScatterPreferences['mode'],scope:$<HTMLSelectElement>('builtinScatterScope').value as ScatterPreferences['scope'],x:$<HTMLSelectElement>('builtinScatterX').value as ScatterPreferences['x'],y:$<HTMLSelectElement>('builtinScatterY').value as ScatterPreferences['y'],z:$<HTMLSelectElement>('builtinScatterZ').value as ScatterPreferences['z'],compressedX:$<HTMLInputElement>('builtinScatterCompressed').checked}});chartMessage('Assi applicati in anteprima. Salva pagina per conservarli.')}catch(error){chartMessage((error as Error).message,true)}});
$('restoreCharts').addEventListener('click',()=>{try{updateChartPage(page=>Object.assign(page,defaultChartLayout()));fillChartBuilder();chartMessage('Pagina ripristinata in anteprima. I preset nominati sono conservati.')}catch(error){chartMessage((error as Error).message,true)}});
$('saveCharts').addEventListener('click',async()=>{try{const next=clone(chartPreferences);next.pages[view]={...clone(pageCharts()),layout:ui.layout as ChartLayout['layout']};await persistCharts(next)}catch(error){chartMessage((error as Error).message,true)}});
$('saveChartPreset').addEventListener('click',async()=>{try{const next=clone(chartPreferences),name=$<HTMLInputElement>('chartPresetName').value.trim();next.presets[view]??=[];next.presets[view]!.push({id:newChartId(),name,layout:{...clone(pageCharts()),layout:ui.layout as ChartLayout['layout']}});next.pages[view]={...clone(pageCharts()),layout:ui.layout as ChartLayout['layout']};await persistCharts(next);$<HTMLInputElement>('chartPresetName').value='';}catch(error){chartMessage((error as Error).message,true)}});
$('applyChartPreset').addEventListener('click',()=>{const preset=chartPreferences.presets[view]?.find(p=>p.id===$<HTMLSelectElement>('chartPreset').value);if(!preset){chartMessage('Scegli prima un preset.',true);return}try{updateChartPage(page=>Object.assign(page,clone(preset.layout)));fillChartBuilder();chartMessage('Preset caricato. Premi Salva pagina per usarlo alla prossima apertura.')}catch(error){chartMessage((error as Error).message,true)}});
$('deleteChartPreset').addEventListener('click',async()=>{const id=$<HTMLSelectElement>('chartPreset').value;if(!id){chartMessage('Scegli il preset da eliminare.',true);return}try{const next=clone(chartPreferences);next.presets[view]=(next.presets[view]||[]).filter(p=>p.id!==id);await persistCharts(next)}catch(error){chartMessage((error as Error).message,true)}});
let pendingAnalysisContext:AnalysisContext|null=null;
function applyAnalysisContext(){
    if(!data||loading||!pendingAnalysisContext)return;
    const context=pendingAnalysisContext;pendingAnalysisContext=null;
    view='articles';ui.records=true;ui.focusChart='';ui.periodMode='compare';ui.singleYear=0;chartMonthContext=null;
    const next:TurningFilters={years:[...data.years],from:1,to:12,machines:[],customers:[],articles:context.article?[data.articles.find(a=>a.trim().toLocaleLowerCase('it')===context.article!.trim().toLocaleLowerCase('it'))||context.article]:[]};
    if(!context.article&&(context.customerName||context.customerCode)){
        const names=[context.customerName,context.customerCode].filter(Boolean).map(v=>v!.trim().toLocaleLowerCase('it'));
        next.customers=data.customers.filter(c=>names.includes(c.trim().toLocaleLowerCase('it')));
        if(!next.customers.length)next.customers=[context.customerName||context.customerCode!];
    }
    commit(next);
}
ipc.on('analysis-open-context',(_event:any,context:AnalysisContext)=>{pendingAnalysisContext=context;applyAnalysisContext();});
installAnalysisLinks(contextFromAnalysisElement,message=>status(message,true));
ipc.send('analysis-context-ready');
void load();
