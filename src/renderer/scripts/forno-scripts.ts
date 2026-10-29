import Chart from 'chart.js/auto';
import { degreeTicks, parseLocalDateTime, formatLocalInput } from './forno/axes';
import { setupAnalysisPanel } from './forno/analysis-panel';
import { setupContinuousTooltip } from './forno/continuous-tooltip';
import { setupAnnotations } from './forno/annotations';
import { attachChartInteractions } from './forno/chart-interactions';
import { createChartReveal } from './forno/chart-reveal';
import { channelAverage } from './forno/channel-average';
import { appendLiveFrame,type LiveFrame } from './forno/live-series';
import { DEFAULT_VIEW_SETTINGS, normalizeViewSettings, divisionTicks, shouldLabel, dayRange, EVENT_LABELS, type FornoViewSettings } from '../../main/modules/forno/preferences';
const { ipcRenderer } = require('electron');

type Bucket = { fromMs: number; toMs: number; samples: number; valid: number; missing: number; min: number | null; max: number | null; mean: number | null; first: number | null; last: number | null; firstTime: number | null; lastTime: number | null };
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const resolution = element<HTMLSelectElement>('resolution');
const live = element<HTMLInputElement>('live');
const statusElement = element('status');
const collectorStatus = element('collector-status');
let backendState: any = null;
const canvas = element<HTMLCanvasElement>('chart');
const report = element<HTMLDialogElement>('report');
const optionsDialog = element<HTMLDialogElement>('options-dialog');
const dateDialog = element<HTMLDialogElement>('date-dialog');
const diagnostics = element<HTMLDetailsElement>('diagnostics');
let preferences: FornoViewSettings = { ...DEFAULT_VIEW_SETTINGS };
let preferencesFile = '';
let settingsWrites: Promise<unknown> = Promise.resolve();
const analysisPanel=setupAnalysisPanel({request:input=>ipcRenderer.invoke('forno-analysis',input),getSeconds:()=>preferences.analysisWindowSeconds,saveSeconds:seconds=>{preferences.analysisWindowSeconds=seconds;void savePreferences().catch(()=>{});},formatTime:t=>formatTime(t)});
const color = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function axisTime(value: number, endpoint: boolean) {
    const d = new Date(value);
    const time = d.toLocaleTimeString('it-IT', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', ...(end-start<60000 ? { fractionalSecondDigits: 3 } : {}) } as Intl.DateTimeFormatOptions);
    return preferences.dateLabels === 'time' && !endpoint ? time : [d.toLocaleDateString('it-IT'), time];
}
const formatTime = (t: number) => new Date(t).toLocaleString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions);
let clockOffset = 0;
let end = Date.now();
let start = end - DEFAULT_VIEW_SETTINGS.periodMs;
let buckets: Bucket[] = [];
const channelColors = ['#dc7c16','#2994dc','#20a875','#a676df'];
const series: Bucket[][] = [[],[],[],[]];
const shown: Bucket[][] = [[],[],[],[]];
const channelControls = element('channel-controls');
for (let id=1;id<=4;id++) {
    const label=document.createElement('label');label.className='channel-card';label.style.setProperty('--channel-color',channelColors[id-1]);
    label.innerHTML='<input type="checkbox" data-channel="'+id+'" aria-label="Mostra canale '+id+'" aria-describedby="channel-state-'+id+'" checked><span class="channel-name">CH'+id+'</span><strong id="channel-value-'+id+'">\u2014 \u00b0C</strong><small id="channel-state-'+id+'" hidden>In attesa</small>';
    channelControls.append(label);
    const reading=document.createElement('div');reading.className='live-channel';reading.style.setProperty('--channel-color',channelColors[id-1]);
    reading.innerHTML='<span>CH'+id+'</span><strong id="'+(id===1?'temperature':'live-temperature-'+id)+'">\u2014 \u00b0C</strong>';
    element('live-channel-values').append(reading);
}
function toggleChannel(id:number) {
    preferences.visibleChannels=preferences.visibleChannels.includes(id)?preferences.visibleChannels.filter(n=>n!==id):[...preferences.visibleChannels,id].sort();
    render();void savePreferences().catch(()=>{});
}
channelControls.addEventListener('change',event=>{const id=Number((event.target as HTMLInputElement).dataset.channel);if(id)toggleChannel(id);});
function channelsOf(result:any) { return result.channels || [{id:1,name:'Canale 1',buckets:result.buckets,stats:result.stats}]; }
function clearSeries() { for(const channel of series)channel.length=0;buckets=[];coverage=null;loadedInterval=0; }
function updateChannelCards() {
    const now=Date.now()+clockOffset;
    for(let i=0;i<4;i++) {
        const latest=backendState?.channels?.[i] || backendState?.lastSample?.channels?.[i] || (i===0?backendState?.lastSample:null);
        const rows=series[i].filter(b=>b.toMs>=start&&b.fromMs<=end), tail=rows[rows.length-1];
        const recent=latest && now-latest.timestampMs<15000;
        const freshHistory=tail?.valid && tail.lastTime!==null && now-tail.lastTime<5000;
        const header=element(i===0?'temperature':'live-temperature-'+(i+1));
        const headerValue=recent?(latest.quality==='good'?latest.temperature:null):freshHistory?tail!.last:null;
        header.textContent=recent&&latest.quality==='off'?'Off':headerValue===null?'\u2014 \u00b0C':headerValue.toFixed(1)+' \u00b0C';
        header.parentElement!.title='Canale '+(i+1)+' · '+(recent?latest.quality==='off'?'Off · disattivato':latest.quality==='good'?'Live · '+formatTime(latest.timestampMs):'Lettura non disponibile':headerValue!==null?'Live · '+formatTime(tail!.lastTime!):'Nessuna lettura recente');
        const fromStatus=recent && latest.quality==='good' && (!freshHistory || latest.timestampMs>tail.lastTime!);
        const value=live.checked?(fromStatus?latest.temperature:freshHistory?tail!.last:null):(tail?.last??null);
        element('channel-value-'+(i+1)).textContent=value===null?'\u2014 \u00b0C':value.toFixed(1)+' \u00b0C';
        element('channel-state-'+(i+1)).textContent=live.checked?(value!==null?'Live':recent?(latest.quality==='off'?'Off \u00b7 disattivato':latest.quality==='good'?'Nessuna lettura recente':latest.quality):'Nessuna lettura recente'):(tail?.valid?'Ultimo nel periodo':tail?.samples?'Nessun campione valido':'Nessun dato nel periodo');
        element('channel-value-'+(i+1)).closest('label')!.title='Canale '+(i+1)+' · '+element('channel-state-'+(i+1)).textContent;
    }
}
let effective = Number(resolution.value);
let watermark = start;
let busy = false;
let pendingFull = false;
let pendingPrefetch=false,pendingAnimate=true;
let coverage:{from:number;to:number;interval:number}|null=null;
let revision = 0;
let disposed = false;
let lastStatusCheck = 0;
let interactions: ReturnType<typeof attachChartInteractions> | undefined;
let continuous:ReturnType<typeof setupContinuousTooltip>|undefined;
let annotations:ReturnType<typeof setupAnnotations>|undefined;
const reveal=createChartReveal();
let loadedInterval=0;
let currentDegreeStep=10;
let streamOnline=false,streamReceivedAt=0,liveAppliedThrough=0;
let streamNeedsSync=true;
let streamStaleAfter=10000;
let streamFrames:LiveFrame[]=[];
function applyStreamFrames(){
    if(!live.checked||!streamOnline||streamNeedsSync||loadedInterval!==effective||busy||interactions?.busy)return;
    const now=Date.now()+clockOffset,span=end-start;end=now;start=end-span;
    for(const frame of streamFrames){
        if(frame.timestampMs<=liveAppliedThrough)continue;
        appendLiveFrame(series,frame,effective,start,end);liveAppliedThrough=frame.timestampMs;
    }
    buckets=series[0];watermark=buckets[buckets.length-1]?.fromMs||start;
    statusElement.textContent='Live · Risoluzione visualizzata: '+effective/1000+' s';render(false);
}
const receiveLive=(_event:any,frame:LiveFrame)=>{
    if(disposed)return;
    streamOnline=true;streamReceivedAt=Date.now();streamStaleAfter=Math.max(10000,frame.intervalMs*3);
    if(frame.resync){streamFrames=[];streamNeedsSync=true;}
    streamFrames.push(frame);if(streamFrames.length>20000)streamFrames.splice(0,streamFrames.length-20000);
    if(backendState){backendState.channels=frame.values.map((value,i)=>({id:i+1,name:'Canale '+(i+1),timestampMs:frame.timestampMs,temperature:value===null?null:value/10,quality:frame.qualities[i]===0?'good':frame.qualities[i]===9?'off':'unavailable'}));backendState.lastSample={...backendState.channels[0],channels:backendState.channels};}
    updateChannelCards();
    if(streamNeedsSync&&live.checked&&!busy)void refresh(true);else applyStreamFrames();
};
ipcRenderer.on('forno-live-frame',receiveLive);
const receiveLiveState=(_event:any,state:{online:boolean})=>{if(!state.online&&streamOnline)streamNeedsSync=true;streamOnline=state.online;};
ipcRenderer.on('forno-live-state',receiveLiveState);

const chart = new Chart<'line'>(canvas, {
    type: 'line',
    data: { datasets: channelColors.flatMap((c,i)=>[
        {label:'Canale '+(i+1)+' · minima',data:[],borderColor:c,backgroundColor:c+'18',pointRadius:0,borderWidth:1,fill:'+1'},
        {label:'Canale '+(i+1)+' · massima',data:[],borderColor:c,pointRadius:0,borderWidth:1},
        {label:'Canale '+(i+1),data:[],borderColor:c,pointRadius:0,borderWidth:2},
    ]) },
    options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true, events: ['click'],
        interaction: { mode: 'index', intersect: false },
        elements: { point: { hoverRadius: 0, hoverBorderWidth: 0 } },
        scales: {
            x: { type: 'linear', min: start, max: end,
                afterBuildTicks: axis => { axis.ticks = divisionTicks(axis.min, axis.max, preferences.xDivisions); },
                ticks: { color: color('--muted'), autoSkip: false, maxRotation: 0, minRotation: 0, padding: 8, font: { size: 10 },
                    callback: (value, index, ticks) => shouldLabel(index, ticks.length, preferences.xLabelEvery) ? axisTime(Number(value), index === 0 || index === ticks.length-1) : '' },
                title: { display: true, text: 'Data e ora', color: color('--muted'), font: { size: 11 } }, grid: { color: 'rgba('+color('--chart-grid')+',0.18)' } },
            y: { min: 0, max: 100,
                afterBuildTicks: axis => {if(preferences.yFixedStep){const grid=degreeTicks(axis.min,axis.max,preferences.yDegreeStep,preferences.ySubdivisions);currentDegreeStep=grid.effectiveStep;axis.ticks=grid.ticks;}else axis.ticks=divisionTicks(axis.min,axis.max,preferences.yDivisions);},
                title: { display: true, text: 'Temperatura (\u00b0C)', color: color('--muted'), font: { size: 11 } },
                ticks: { color: color('--muted'), autoSkip: false, padding: 8, font: { size: 10 },
                    callback: (value, index, ticks) => (preferences.yFixedStep?(index===0||index===ticks.length-1||Boolean(ticks[index].major)&&Math.abs(Math.round(Number(value)/currentDegreeStep)%preferences.yLabelEvery)===0):shouldLabel(index,ticks.length,preferences.yLabelEvery)) ? Number(value).toLocaleString('it-IT', {minimumFractionDigits:preferences.temperatureDecimals,maximumFractionDigits:preferences.temperatureDecimals}) : '' },
                grid: { color: 'rgba('+color('--chart-grid')+',0.18)' } },
        },
        plugins: {
            legend: { labels: { filter: item => item.datasetIndex! % 3 === 2, color: color('--muted'), boxWidth: 22, boxHeight: 8, font: {size: 11} },
                onClick: (_event, item) => { toggleChannel(Math.floor(item.datasetIndex!/3)+1); } },
            tooltip: { ...{events: []}, filter: item => item.datasetIndex % 3 === 2, callbacks: {
                footer: items => {
                    const index=items[0]?.dataIndex;
                    if(index===undefined)return [];
                    const average=channelAverage(shown.map((rows,i)=>({id:i+1,valid:rows[index]?.valid||0,mean:rows[index]?.mean??null})));
                    if(average.temperature===null)return ['Media complessiva: \u2014 (nessun canale valido)'];
                    return [`Media complessiva: ${average.temperature.toFixed(2)} \u00b0C`,`${average.channels.length} canali validi: ${average.channels.map(c=>'CH'+c.id).join(', ')}`];
                },
                title: items => {
                    const item=items[0]; const b = item ? shown[Math.floor(item.datasetIndex/3)][item.dataIndex] : null;
                    return b ? (b.samples === 1 ? formatTime(b.firstTime ?? b.fromMs) : `${formatTime(b.fromMs)} → ${formatTime(b.toMs)}`) : '';
                },
                label: item => {
                    const b = shown[Math.floor(item.datasetIndex/3)][item.dataIndex];
                    if (!b) return '';
                    if (!b.valid) return item.dataset.label+': nessun campione valido';
                    return b.valid === 1 && !b.missing ? `${item.dataset.label}: ${b.mean?.toFixed(1)} °C` : [`${item.dataset.label} · Min: ${b.min?.toFixed(1) ?? '—'} °C · Max: ${b.max?.toFixed(1) ?? '—'} °C`, `Media: ${b.mean?.toFixed(2) ?? '—'} °C · Validi: ${b.valid} · Mancanti: ${b.missing}`];
                },
            } },
        },
    },
    plugins: [reveal.plugin,{id:'forno-selection',afterDraw(){interactions?.drawSelection();continuous?.drawGuide();annotations?.draw();}}],
});
annotations=setupAnnotations(chart,{settings:()=>preferences,range:()=>({start,end}),formatTime,
    list:input=>ipcRenderer.invoke('forno-messages',input),sample:timestampMs=>ipcRenderer.invoke('forno-sample',{timestampMs}),
    save:input=>ipcRenderer.invoke('forno-note-save',input),remove:input=>ipcRenderer.invoke('forno-note-delete',input)});
continuous=setupContinuousTooltip(chart,{
    request:timestampMs=>ipcRenderer.invoke('forno-sample',{timestampMs}),
    formatTime,now:()=>Date.now()+clockOffset,colors:channelColors,
    changed:enabled=>{preferences.continuousTooltip=enabled;interactions?.hideTooltip();void savePreferences().catch(()=>{});},
    addNote:timestampMs=>{void annotations?.createAt(timestampMs);},
    preview:t=>{
        const index=shown[0].findIndex(b=>b.fromMs<=t&&b.toMs>=t);
        if(index<0||!shown[0][index].samples)return null;
        const channels=shown.map((rows,i)=>({id:i+1,name:'Canale '+(i+1),temperature:rows[index]?.valid?rows[index].mean:null,quality:rows[index]?.valid?(rows[index].valid===1?'good':'aggregate'):'unavailable'}));
        const valid=channels.filter(c=>c.temperature!==null);
        return {fromMs:shown[0][index].fromMs,toMs:shown[0][index].toMs,channels,mean:valid.length?valid.reduce((sum,c)=>sum+c.temperature!,0)/valid.length:null};
    },
});
interactions=attachChartInteractions(chart,{
    range:()=>({start,end}),move:updateView,commit:kind=>{void refresh(true,true,kind!=='pan');},
    select:(lo,hi)=>{void analyzeSelection(lo,hi);},
    continuous:()=>continuous?.enabled||false,
});


function showRange() {
    element('range-label').textContent = formatTime(start).replace(/,\d{3}$/, '') + '  \u2192  ' + formatTime(end).replace(/,\d{3}$/, '');
    chart.options.scales!.x!.min = start;
    chart.options.scales!.x!.max = end;
}
function applyAppearance() {
    document.documentElement.style.setProperty('--continuous-tooltip-opacity',String((optionsDialog.open?Number(element<HTMLInputElement>('opt-tooltip-opacity').value):preferences.continuousTooltipOpacity)/100));
    document.documentElement.dataset.theme = preferences.theme;
    const muted=color('--muted'), grid='rgba('+color('--chart-grid')+','+(preferences.gridOpacity/100)+')';
    for(const axis of ['x','y']) {
        chart.options.scales![axis]!.ticks!.color=muted;
        chart.options.scales![axis]!.grid!.color=grid;
        chart.options.scales![axis]!.title!.color=muted;
        chart.options.scales![axis]!.border={color:grid};
    }
    chart.options.plugins!.legend!.display=preferences.showLegend;
    chart.options.plugins!.legend!.labels!.color=muted;
    for(let i=0;i<4;i++) {
        const visible=preferences.visibleChannels.includes(i+1);
        for(let field=0;field<3;field++) chart.setDatasetVisibility(i*3+field,visible&&(field===2||preferences.showEnvelope));
        chart.data.datasets[i*3+2].borderWidth=preferences.lineWidth;
        chart.data.datasets[i*3+2].pointRadius=preferences.showPoints?2:0;
        const input=channelControls.querySelector<HTMLInputElement>('[data-channel="'+(i+1)+'"]')!;
        input.checked=visible;input.closest('label')!.classList.toggle('is-hidden',!visible);
    }
    const values=series.flatMap((rows,i)=>preferences.visibleChannels.includes(i+1)?rows.flatMap(b=>b.valid&&b.toMs>=start&&b.fromMs<=end?[b.min!,b.max!]:[]):[]).filter(Number.isFinite);
    const lo=values.length?Math.min(...values):0, hi=values.length?Math.max(...values):100;
    const pad=Math.max(1,(hi-lo)*0.1);
    chart.options.scales!.y!.min=preferences.scaleMode==='zeroMax'?0:(values.length?lo-pad:0);
    chart.options.scales!.y!.max=preferences.scaleMode==='zeroMax'?Math.max(50,(values.length?hi:0)+50):(values.length?hi+pad:100);
    if(preferences.scaleMode==='manual'){chart.options.scales!.y!.min=preferences.yMin;chart.options.scales!.y!.max=preferences.yMax;}
    chart.options.scales!.y!.grid!.lineWidth=context=>preferences.yFixedStep&&context.tick&&!context.tick.major?0.5:1;
    element('scale-manual').setAttribute('aria-pressed',String(preferences.scaleMode==='manual'));
    element('scale-auto').setAttribute('aria-pressed',String(preferences.scaleMode==='auto'));
    element('scale-zero').setAttribute('aria-pressed',String(preferences.scaleMode==='zeroMax'));
    element('grid-summary').textContent=preferences.xDivisions+' divisioni temporali \u00b7 etichetta ogni '+preferences.xLabelEvery;
    if(preferences.yFixedStep){const grid=degreeTicks(Number(chart.options.scales!.y!.min),Number(chart.options.scales!.y!.max),preferences.yDegreeStep,preferences.ySubdivisions);element('grid-summary').textContent+=' · Linee ogni '+grid.effectiveStep+' °C'+(grid.adapted?' (griglia diradata)':'');}
}
function render(animate=false) {
    interactions?.beforeChartUpdate();
    const previousPoints=shown.flat().filter(b=>b.valid&&b.mean!==null);
    const previousRange=previousPoints.length?{start:Math.min(...previousPoints.map(b=>(b.fromMs+b.toMs)/2)),end:Math.max(...previousPoints.map(b=>(b.fromMs+b.toMs)/2))}:null;
    // Common timeline keeps tooltip indices aligned even when a channel has no data.
    const timeline=new Map<number,Bucket>();
    for(const rows of series)for(const b of rows)if(b.samples>0)timeline.set(b.fromMs,b);
    const times=[...timeline.values()].sort((a,b)=>a.fromMs-b.fromMs);
    const slots:Bucket[]=[];
    for(const b of times) {
        const prev=slots[slots.length-1];
        if(prev && b.fromMs-prev.fromMs>effective*1.5)slots.push({...prev,fromMs:prev.fromMs+effective,toMs:b.fromMs-1});
        slots.push(b);
    }
    for(let i=0;i<4;i++) {
        const map=new Map(series[i].map(b=>[b.fromMs,b]));
        shown[i]=slots.map(b=>map.get(b.fromMs)||{...b,samples:0,valid:0,missing:0,min:null,max:null,mean:null,first:null,last:null,firstTime:null,lastTime:null});
        for(const [field,key] of ['min','max','mean'].entries())chart.data.datasets[i*3+field].data=shown[i].map(b=>({x:(b.fromMs+b.toMs)/2,y:b[key]})) as any;
    }
    applyAppearance();updateChannelCards();showRange();
    if(animate)reveal.start(chart,previousRange);
    chart.update('none');
    interactions?.afterChartUpdate();
    continuous?.afterChartUpdate();
    void annotations?.refresh();
}
async function refresh(full = false,prefetch=false,animate=full) {
    if (disposed) return;
    if (backendState?.enabled === false) {
        statusElement.textContent = 'Raccolta forno disabilitata sul server: verificare forno.autoStart e riavviare il backend.';
        return;
    }
    if (full) revision++;
    const span=end-start,requested=Number(resolution.value);
    const targetInterval=requested*Math.max(1,Math.ceil((span+1)/(1800*requested)));
    if(prefetch&&!live.checked&&coverage&&coverage.interval===targetInterval&&coverage.from<=start&&coverage.to>=end){effective=targetInterval;render(false);return;}
    if (busy) { pendingFull ||= full;pendingPrefetch ||= prefetch;pendingAnimate=animate; return; }
    busy = true;
    const version = revision;
    try {
        const serverNow = Date.now()+clockOffset;
        if (live.checked) { const span=end-start; end=serverNow; start=end-span; }
        const requested = Number(resolution.value);
        effective = requested*Math.max(1, Math.ceil((end-start+1)/(1800*requested)));
        // Nel live mantieni i bucket allineati per gli aggiornamenti incrementali.
        // Nello storico rispetta esattamente il giorno/intervallo selezionato.
        const alignedStart = live.checked ? Math.floor(start/effective)*effective : Math.floor(start);
        const margin=prefetch?Math.max(0,Math.min((end-start)*0.25,(366*86400000-(end-start))/2)):0;
        const fromMs = margin?Math.max(0,Math.floor(alignedStart-margin)):full||!buckets.length?alignedStart:Math.max(alignedStart,watermark);
        const queryEnd=Math.ceil(end+margin);
        const result = await ipcRenderer.invoke('forno-history', { fromMs, toMs: margin?queryEnd:Math.floor(end), intervalMs: effective, maxPoints: margin?3000:2000 });
        if (disposed || version !== revision) return;
        const responseChannels=channelsOf(result);
        const keepCache=loadedInterval===effective;
        const span=end-start;
        for(let i=0;i<4;i++) {
            const incoming:Bucket[]=responseChannels.find((c:any)=>c.id===i+1)?.buckets||[];
            // Conserva un margine locale per tornare indietro senza svuotare la curva.
            // Elimina prima la copertura sostituita, anche se la risposta e vuota.
            const existing=new Map<number,Bucket>((keepCache?series[i].filter(b=>b.toMs<fromMs||b.fromMs>queryEnd):[]).map(b=>[b.fromMs,b]));
            for(const b of incoming)existing.set(b.fromMs,b);
            series[i]=[...existing.values()].filter(b=>b.toMs>=start-span/2&&b.fromMs<=end+span/2).sort((a,b)=>a.fromMs-b.fromMs).slice(-4000);
        }
        const retainedFrom=start-span/2,retainedTo=end+span/2;
        const canMerge=keepCache&&coverage&&coverage.to>=fromMs&&coverage.from<=queryEnd;
        coverage={from:Math.max(retainedFrom,canMerge?Math.min(coverage!.from,fromMs):fromMs),to:Math.min(retainedTo,canMerge?Math.max(coverage!.to,queryEnd):queryEnd),interval:effective};
        loadedInterval=effective;
        liveAppliedThrough=result.snapshotMs??Math.floor(end);
        if(live.checked)streamNeedsSync=false;
        buckets=series[0];
        const received:Bucket[]=responseChannels.flatMap((c:any)=>c.buckets);
        watermark=received.length?Math.max(...received.map(b=>b.fromMs)):alignedStart;
        const tail = buckets[buckets.length-1];
        statusElement.textContent = `${live.checked ? 'Live' : 'Storico'} · Risoluzione visualizzata: ${effective/1000} s` + (effective>requested ? ' (adattata al periodo per contenere il traffico)' : '') + (series.some(rows=>rows.some(b=>b.samples>0&&b.toMs>=start&&b.fromMs<=end)) ? '' : ' · Nessun campione nel periodo');
        render(animate);
    } catch(error) {
        statusElement.textContent = `Dati non aggiornati: ${error instanceof Error ? error.message : String(error)}`;
        updateChannelCards();
    } finally {
        busy = false;
        if (pendingFull && !disposed) { const prefetch=pendingPrefetch,animate=pendingAnimate;pendingFull=false;pendingPrefetch=false;void refresh(true,prefetch,animate); }
        else if(streamOnline&&live.checked)applyStreamFrames();
    }
}
function updateView(lo: number, hi: number) {
    revision++;
    const span = Math.max(500,Math.min(366*86400000,hi-lo));
    start=Math.max(0,lo); end=start+span; live.checked=false;
    reveal.stop();interactions?.hideTooltip();showRange();chart.update('none');
    continuous?.afterChartUpdate();
}
function analyzeSelection(lo:number,hi:number) {analysisPanel.open(lo,hi);}
function savePreferences() {
    const snapshot={...preferences};
    settingsWrites=settingsWrites.catch(()=>{}).then(()=>ipcRenderer.invoke('forno-view-settings-save',snapshot));
    return settingsWrites.then((result:any)=>{
        preferencesFile=result.path||preferencesFile;
        element('preferences-status').textContent='Salvate su questa postazione'+(preferencesFile?' \u00b7 '+preferencesFile:'');
    }).catch(error=>{
        element('preferences-status').textContent='Salvataggio non riuscito: '+String(error);
        statusElement.textContent='Preferenze non salvate: '+String(error);
        throw error;
    });
}
async function loadPreferences() {
    try {
        const result=await ipcRenderer.invoke('forno-view-settings-load');
        preferences=normalizeViewSettings(result.settings); preferencesFile=result.path||'';
        element('preferences-status').textContent='Preferenze locali'+(preferencesFile?' \u00b7 '+preferencesFile:'');
    } catch(error) { element('preferences-status').textContent='Preferenze non caricate: '+String(error); }
    const launchTheme=new URLSearchParams(location.search).get('theme');
    if(launchTheme==='bluearchive')preferences.theme='blue';
    else if(launchTheme==='standard'||launchTheme==='agpress')preferences.theme='classic';
    live.checked=true;
    continuous?.setEnabled(preferences.continuousTooltip);
    resolution.value=String(preferences.resolutionMs);
    end=Date.now()+clockOffset;start=end-preferences.periodMs;
    diagnostics.open=preferences.showDiagnostics;
    applyAppearance();showRange();chart.update('none');
}
const receiveInterfaceTheme=(_event:any,input:{theme:string})=>{
    preferences.theme=input.theme==='bluearchive'?'blue':'classic';render(false);
};
ipcRenderer.on('forno-interface-theme',receiveInterfaceTheme);
resolution.addEventListener('change',()=>{preferences.resolutionMs=Number(resolution.value);void savePreferences().catch(()=>{});clearSeries();void refresh(true);});
live.addEventListener('change',()=>void refresh(true));
for(const [id,mode] of [['scale-auto','auto'],['scale-zero','zeroMax']] as const) element(id).addEventListener('click',()=>{preferences.scaleMode=mode;render();void savePreferences().catch(()=>{});});
diagnostics.addEventListener('toggle',()=>{if(preferences.showDiagnostics!==diagnostics.open){preferences.showDiagnostics=diagnostics.open;void savePreferences().catch(()=>{});}});
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button=>button.addEventListener('click',()=>element<HTMLDialogElement>(button.dataset.close!).close()));
function localDay(t:number) {const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
element('select-date').addEventListener('click',()=>{element<HTMLInputElement>('selected-date').value=localDay(start);element('date-error').textContent='';dateDialog.showModal();});
element<HTMLFormElement>('date-form').addEventListener('submit',event=>{
    event.preventDefault();
    try {
        const range=dayRange(element<HTMLInputElement>('selected-date').value);
        updateView(range.start,range.end);clearSeries();
        preferences.periodMs=86400000;void savePreferences().catch(()=>{});
        dateDialog.close();void refresh(true);
    } catch(error) {element('date-error').textContent=String((error as Error).message||error);}
});
element('select-range').addEventListener('click',()=>{
    element<HTMLInputElement>('range-start').value=formatLocalInput(start);
    element<HTMLInputElement>('range-end').value=formatLocalInput(end);
    element('range-error').textContent='';element<HTMLDialogElement>('range-dialog').showModal();
});
element<HTMLFormElement>('range-form').addEventListener('submit',event=>{
    event.preventDefault();
    try {
        const from=parseLocalDateTime(element<HTMLInputElement>('range-start').value),to=parseLocalDateTime(element<HTMLInputElement>('range-end').value);
        if(to-from<500||to-from>366*86400000)throw new Error('La fine deve seguire l’inizio: intervallo da 0,5 secondi a 366 giorni.');
        updateView(from,to);clearSeries();element<HTMLDialogElement>('range-dialog').close();void refresh(true);
    }catch(error){element('range-error').textContent=String((error as Error).message||error);}
});
function setManualScale(min:number,max:number) {
    if(!Number.isFinite(min)||!Number.isFinite(max)||min>=max||min< -10000||max>10000)throw new Error('Specificare minimo e massimo crescenti, tra -10000 e 10000 °C.');
    preferences.scaleMode='manual';preferences.yMin=min;preferences.yMax=max;render();void savePreferences().catch(()=>{});
}
element('scale-manual').addEventListener('click',()=>{
    element<HTMLInputElement>('scale-min').value=chart.scales.y.min.toFixed(2);element<HTMLInputElement>('scale-max').value=chart.scales.y.max.toFixed(2);
    element('scale-error').textContent='';element<HTMLDialogElement>('scale-dialog').showModal();
});
element<HTMLFormElement>('scale-form').addEventListener('submit',event=>{
    event.preventDefault();try{setManualScale(Number(element<HTMLInputElement>('scale-min').value),Number(element<HTMLInputElement>('scale-max').value));element<HTMLDialogElement>('scale-dialog').close();}
    catch(error){element('scale-error').textContent=String((error as Error).message||error);}
});
for(const [id,factor]of [['scale-in',0.8],['scale-out',1.25]] as const)element(id).addEventListener('click',()=>{
    const center=(chart.scales.y.min+chart.scales.y.max)/2,half=Math.max(0.005,Math.min(10000,(chart.scales.y.max-chart.scales.y.min)*factor/2));
    setManualScale(Math.max(-10000,center-half),Math.min(10000,center+half));
});
const optionFields: Record<string,keyof FornoViewSettings> = {
    'opt-x-divisions':'xDivisions','opt-y-divisions':'yDivisions','opt-x-every':'xLabelEvery','opt-y-every':'yLabelEvery',
    'opt-decimals':'temperatureDecimals','opt-date-labels':'dateLabels','opt-theme':'theme','opt-line-width':'lineWidth',
    'opt-y-fixed':'yFixedStep','opt-y-step':'yDegreeStep','opt-y-subdivisions':'ySubdivisions',
    'opt-notes':'showNotes','opt-events':'showEvents',
    'opt-tooltip-opacity':'continuousTooltipOpacity',
    'opt-grid-opacity':'gridOpacity','opt-legend':'showLegend','opt-envelope':'showEnvelope','opt-points':'showPoints','opt-diagnostics':'showDiagnostics',
};
function previewDivisions(){const n=Number(element<HTMLInputElement>('opt-x-divisions').value);element('division-preview').textContent=n+' divisioni = '+n+' intervalli e '+(n+1)+' linee. Prima e ultima etichetta sempre visibili.';}
function fillOptions(settings:FornoViewSettings){
    for(const [id,key] of Object.entries(optionFields)) {const field=element<HTMLInputElement>(id);if(typeof settings[key]==='boolean')field.checked=settings[key] as boolean;else field.value=String(settings[key]);}
    for(const field of document.querySelectorAll<HTMLInputElement>('[data-event-type]'))field.checked=settings.eventTypes.includes(field.dataset.eventType!);
    element<HTMLFieldSetElement>('event-filters').disabled=!settings.showEvents;
    previewDivisions();syncDegreeControls();previewTooltipOpacity();
}
function previewTooltipOpacity(){
    const value=Number(element<HTMLInputElement>('opt-tooltip-opacity').value);
    element('tooltip-opacity-value').textContent=value+'%';
    document.documentElement.style.setProperty('--continuous-tooltip-opacity',String(value/100));
}
element('opt-tooltip-opacity').addEventListener('input',previewTooltipOpacity);
optionsDialog.addEventListener('close',()=>document.documentElement.style.setProperty('--continuous-tooltip-opacity',String(preferences.continuousTooltipOpacity/100)));
for(const [type,label]of Object.entries(EVENT_LABELS)){
    const wrapper=document.createElement('label'),field=document.createElement('input');field.type='checkbox';field.dataset.eventType=type;wrapper.append(field,document.createTextNode(label));element('event-type-options').append(wrapper);
}
element('opt-events').addEventListener('change',()=>{element<HTMLFieldSetElement>('event-filters').disabled=!element<HTMLInputElement>('opt-events').checked;});
for(const [id,checked]of [['events-all',true],['events-none',false]] as const)element(id).addEventListener('click',()=>{document.querySelectorAll<HTMLInputElement>('[data-event-type]').forEach(field=>field.checked=checked);});
function syncDegreeControls(){
    const fixed=element<HTMLInputElement>('opt-y-fixed').checked;
    element('y-divisions-control').hidden=fixed;element<HTMLInputElement>('opt-y-divisions').disabled=fixed;
    for(const id of ['y-step-control','y-subdivisions-control'])element(id).hidden=!fixed;
    for(const id of ['opt-y-step','opt-y-subdivisions'])element<HTMLInputElement>(id).disabled=!fixed;
}
element('opt-y-fixed').addEventListener('change',syncDegreeControls);
element('opt-x-divisions').addEventListener('input',previewDivisions);
element('open-options').addEventListener('click',()=>{fillOptions(preferences);optionsDialog.showModal();});
element('reset-options').addEventListener('click',()=>fillOptions({...DEFAULT_VIEW_SETTINGS}));
element<HTMLFormElement>('options-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const next:any={...preferences};
    next.eventTypes=[...document.querySelectorAll<HTMLInputElement>('[data-event-type]')].filter(field=>field.checked).map(field=>field.dataset.eventType!);
    for(const [id,key] of Object.entries(optionFields)){const field=element<HTMLInputElement>(id);next[key]=typeof DEFAULT_VIEW_SETTINGS[key]==='boolean'?field.checked:typeof DEFAULT_VIEW_SETTINGS[key]==='number'?Number(field.value):field.value;}
    preferences=normalizeViewSettings(next);diagnostics.open=preferences.showDiagnostics;render();
    void annotations?.refresh(true);
    try{await savePreferences();optionsDialog.close();}catch{/* errore visibile nel pannello */}
});
function setModuleState(state:string,label:string) {
    const badge=element('module-state');badge.dataset.state=state;badge.title=label;badge.setAttribute('aria-label',label);badge.querySelector('span')!.textContent=label;
}
element('refresh-view').addEventListener('click',async()=>{
    const button=element<HTMLButtonElement>('refresh-view');button.disabled=true;
    try{await checkStatus();await refresh(true);await annotations?.refresh(true);}finally{button.disabled=false;}
});
async function checkStatus() {
    try {
        const s=await ipcRenderer.invoke('forno-status');
        backendState=s;updateChannelCards();
        const badQuality=s.lastSample && (s.channels||s.lastSample.channels||[s.lastSample]).some((c:any)=>c.quality!=='good'&&c.quality!=='off');
        setModuleState(!s.enabled?'inactive':!s.running?'offline':badQuality?'warning':'online',!s.enabled?'Raccolta disattivata':!s.running?'Acquisizione arrestata':badQuality?'Lettura da verificare':'Acquisizione attiva');
        if(s.serverTimeMs) clockOffset=s.serverTimeMs-Date.now();
        if(!s.enabled) {
            statusElement.textContent='Raccolta forno disabilitata sul server: verificare forno.autoStart e riavviare il backend.';
            collectorStatus.textContent='Backend raggiungibile | Acquisizione: disattivata | Nessun nuovo campione registrato';
            return;
        }
        const details=['Backend raggiungibile', 'Acquisizione: '+(s.running?'attiva':'arrestata')];
        if(s.lastSample) {
            const sample=s.lastSample;
            details.push('Ultimo tentativo salvato: '+formatTime(sample.timestampMs));
            details.push(sample.quality==='good' ? 'Temperatura: '+sample.temperature.toFixed(1)+' \u00b0C' : 'Lettura: '+sample.quality+' (temperatura non disponibile)');
        } else details.push('In attesa del primo campione salvato');
        if(s.channels) details.push(s.channels.map((c:any)=>c.name+': '+(c.quality==='good'?c.temperature.toFixed(1)+' \u00b0C':c.quality)).join(' \u00b7 '));
        if(s.events)details.push('Raccolta eventi: '+(s.events.running?'attiva':'arrestata')+(s.events.error?' · '+s.events.error:''));
        if(s.dbPath) details.push('Database: '+s.dbPath);
        if(Number.isFinite(s.databaseBytes)) details.push('DB: '+(s.databaseBytes/1048576).toFixed(2)+' MiB | WAL: '+((s.walBytes||0)/1048576).toFixed(2)+' MiB');
        collectorStatus.textContent=details.join(' | ');
        if(!s.running || s.error) statusElement.textContent=s.error || 'Acquisizione forno non attiva';
    } catch(error) {
        statusElement.textContent=String(error);
        setModuleState('offline','Backend non raggiungibile');
        collectorStatus.textContent='Stato acquisizione non verificabile: backend non raggiungibile o risposta non valida.';
    }
}
async function tick() {
    if(disposed) return;
    if(!report.open&&!interactions?.busy && live.checked) {
        const span=end-start,requested=Number(resolution.value),target=requested*Math.max(1,Math.ceil((span+1)/(1800*requested)));
        if(!streamOnline||Date.now()-streamReceivedAt>streamStaleAfter||loadedInterval!==target||streamNeedsSync)await refresh(streamNeedsSync);
        else applyStreamFrames();
    }
    if(Date.now()-lastStatusCheck>10000) {lastStatusCheck=Date.now();await checkStatus();}
    if(!disposed) setTimeout(tick,Math.max(1000,Math.min(5000,Number(resolution.value))));
}
window.addEventListener('beforeunload',()=>{disposed=true;ipcRenderer.send('forno-live-stop');ipcRenderer.removeListener('forno-live-frame',receiveLive);ipcRenderer.removeListener('forno-live-state',receiveLiveState);ipcRenderer.removeListener('forno-interface-theme',receiveInterfaceTheme);annotations?.dispose();continuous?.dispose();interactions?.dispose();reveal.stop();chart.destroy();});
void (async()=>{await loadPreferences();await checkStatus();showRange();await refresh(true);void ipcRenderer.invoke('forno-live-start').catch(()=>{});void tick();})();
