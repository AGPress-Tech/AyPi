import Chart from 'chart.js/auto';
import { attachChartInteractions } from './forno/chart-interactions';
import { createChartReveal } from './forno/chart-reveal';
import { channelAverage } from './forno/channel-average';
import { setupFornoSplash } from './forno/splash';
import { DEFAULT_VIEW_SETTINGS, normalizeViewSettings, divisionTicks, shouldLabel, dayRange, type FornoViewSettings } from '../../main/modules/forno/preferences';
const { ipcRenderer } = require('electron');

type Bucket = { fromMs: number; toMs: number; samples: number; valid: number; missing: number; min: number | null; max: number | null; mean: number | null; first: number | null; last: number | null; firstTime: number | null; lastTime: number | null };
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const resolution = element<HTMLSelectElement>('resolution');
const live = element<HTMLInputElement>('live');
const statusElement = element('status');
const collectorStatus = element('collector-status');
let backendState: any = null;
const bootSplash = setupFornoSplash();
const canvas = element<HTMLCanvasElement>('chart');
const report = element<HTMLDialogElement>('report');
const optionsDialog = element<HTMLDialogElement>('options-dialog');
const dateDialog = element<HTMLDialogElement>('date-dialog');
const diagnostics = element<HTMLDetailsElement>('diagnostics');
let preferences: FornoViewSettings = { ...DEFAULT_VIEW_SETTINGS };
let preferencesFile = '';
let settingsWrites: Promise<unknown> = Promise.resolve();
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
    label.innerHTML='<input type="checkbox" data-channel="'+id+'" checked><span class="channel-name">Canale '+id+'</span><strong id="channel-value-'+id+'">\u2014 \u00b0C</strong><small id="channel-state-'+id+'">In attesa</small>';
    channelControls.append(label);
}
function toggleChannel(id:number) {
    preferences.visibleChannels=preferences.visibleChannels.includes(id)?preferences.visibleChannels.filter(n=>n!==id):[...preferences.visibleChannels,id].sort();
    render();void savePreferences().catch(()=>{});
}
channelControls.addEventListener('change',event=>{const id=Number((event.target as HTMLInputElement).dataset.channel);if(id)toggleChannel(id);});
function channelsOf(result:any) { return result.channels || [{id:1,name:'Canale 1',buckets:result.buckets,stats:result.stats}]; }
function clearSeries() { for(const channel of series)channel.length=0;buckets=[]; }
function updateChannelCards() {
    const now=Date.now()+clockOffset;
    const current=backendState?.channels?.[0] || backendState?.lastSample;
    const last=series[0][series[0].length-1];
    const headerValue=current?.quality==='good' && now-current.timestampMs<15000 ? current.temperature : live.checked && last?.valid && last.lastTime!==null && now-last.lastTime<5000 ? last.last : null;
    element('temperature').textContent=headerValue===null?'\u2014 \u00b0C':headerValue.toFixed(1)+' \u00b0C';
    for(let i=0;i<4;i++) {
        const latest=backendState?.channels?.[i] || backendState?.lastSample?.channels?.[i] || (i===0?backendState?.lastSample:null);
        const rows=series[i].filter(b=>b.toMs>=start&&b.fromMs<=end), tail=rows[rows.length-1];
        const recent=latest && now-latest.timestampMs<15000;
        const freshHistory=tail?.valid && tail.lastTime!==null && now-tail.lastTime<5000;
        const fromStatus=recent && latest.quality==='good' && (!freshHistory || latest.timestampMs>tail.lastTime!);
        const value=live.checked?(fromStatus?latest.temperature:freshHistory?tail!.last:null):(tail?.last??null);
        element('channel-value-'+(i+1)).textContent=value===null?'\u2014 \u00b0C':value.toFixed(1)+' \u00b0C';
        element('channel-state-'+(i+1)).textContent=live.checked?(value!==null?'Live':recent?(latest.quality==='off'?'Off \u00b7 disattivato':latest.quality==='good'?'Nessuna lettura recente':latest.quality):'Nessuna lettura recente'):(tail?.valid?'Ultimo nel periodo':tail?.samples?'Nessun campione valido':'Nessun dato nel periodo');
    }
}
let effective = Number(resolution.value);
let watermark = start;
let busy = false;
let pendingFull = false;
let revision = 0;
let disposed = false;
let lastStatusCheck = 0;
let interactions: ReturnType<typeof attachChartInteractions> | undefined;
const reveal=createChartReveal();
let loadedInterval=0;

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
                afterBuildTicks: axis => { axis.ticks = divisionTicks(axis.min, axis.max, preferences.yDivisions); },
                title: { display: true, text: 'Temperatura (\u00b0C)', color: color('--muted'), font: { size: 11 } },
                ticks: { color: color('--muted'), autoSkip: false, padding: 8, font: { size: 10 },
                    callback: (value, index, ticks) => shouldLabel(index, ticks.length, preferences.yLabelEvery) ? Number(value).toLocaleString('it-IT', {minimumFractionDigits:preferences.temperatureDecimals,maximumFractionDigits:preferences.temperatureDecimals}) : '' },
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
    plugins: [reveal.plugin,{id:'forno-selection',afterDraw(){interactions?.drawSelection();}}],
});
interactions=attachChartInteractions(chart,{
    range:()=>({start,end}),move:updateView,commit:()=>{void refresh(true);},
    select:(lo,hi)=>{void analyzeSelection(lo,hi);},
});

bootSplash.mark('chart');

function showRange() {
    element('range-label').textContent = formatTime(start).replace(/,\d{3}$/, '') + '  \u2192  ' + formatTime(end).replace(/,\d{3}$/, '');
    chart.options.scales!.x!.min = start;
    chart.options.scales!.x!.max = end;
}
function applyAppearance() {
    document.documentElement.dataset.theme = preferences.theme;
    const splash=document.getElementById('forno-splash');
    if(splash && !splash.hidden) document.body.classList.toggle('agpress-scripted-splash',preferences.theme==='classic');
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
    element('scale-auto').setAttribute('aria-pressed',String(preferences.scaleMode==='auto'));
    element('scale-zero').setAttribute('aria-pressed',String(preferences.scaleMode==='zeroMax'));
    element('grid-summary').textContent=preferences.xDivisions+' divisioni temporali \u00b7 etichetta ogni '+preferences.xLabelEvery;
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
}
async function refresh(full = false) {
    if (disposed) return;
    if (backendState?.enabled === false) {
        statusElement.textContent = 'Raccolta forno disabilitata sul server: verificare forno.autoStart e riavviare il backend.';
        return;
    }
    if (full) revision++;
    if (busy) { pendingFull ||= full; return; }
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
        const fromMs = full || !buckets.length ? alignedStart : Math.max(alignedStart,watermark);
        const result = await ipcRenderer.invoke('forno-history', { fromMs, toMs: Math.floor(end), intervalMs: effective, maxPoints: 2000 });
        bootSplash.mark('archive');
        if (disposed || version !== revision) return;
        const responseChannels=channelsOf(result);
        const keepCache=loadedInterval===effective;
        const span=end-start;
        for(let i=0;i<4;i++) {
            const incoming:Bucket[]=responseChannels.find((c:any)=>c.id===i+1)?.buckets||[];
            // Conserva un margine locale per tornare indietro senza svuotare la curva.
            // Elimina prima la copertura sostituita, anche se la risposta e vuota.
            const existing=new Map<number,Bucket>((keepCache?series[i].filter(b=>b.toMs<fromMs||b.fromMs>end):[]).map(b=>[b.fromMs,b]));
            for(const b of incoming)existing.set(b.fromMs,b);
            series[i]=[...existing.values()].filter(b=>b.toMs>=start-span/2&&b.fromMs<=end+span/2).sort((a,b)=>a.fromMs-b.fromMs).slice(-4000);
        }
        loadedInterval=effective;
        buckets=series[0];
        const received:Bucket[]=responseChannels.flatMap((c:any)=>c.buckets);
        watermark=received.length?Math.max(...received.map(b=>b.fromMs)):alignedStart;
        const tail = buckets[buckets.length-1];
        if (live.checked) element('temperature').textContent = tail?.valid && tail.lastTime !== null && serverNow-tail.lastTime<5000 ? `${tail.last!.toFixed(1)} °C` : '— °C';
        statusElement.textContent = `${live.checked ? 'Live' : 'Storico'} · Risoluzione visualizzata: ${effective/1000} s` + (effective>requested ? ' (adattata al periodo per contenere il traffico)' : '') + (series.some(rows=>rows.some(b=>b.samples>0&&b.toMs>=start&&b.fromMs<=end)) ? '' : ' · Nessun campione nel periodo');
        render(full);
    } catch(error) {
        statusElement.textContent = `Dati non aggiornati: ${error instanceof Error ? error.message : String(error)}`;
        if (live.checked) element('temperature').textContent = '— °C';
    } finally {
        busy = false;
        if (pendingFull && !disposed) { pendingFull=false; void refresh(true); }
    }
}
function updateView(lo: number, hi: number) {
    revision++;
    const span = Math.max(1000,Math.min(365*86400000,hi-lo));
    start=Math.max(0,lo); end=start+span; live.checked=false;
    reveal.stop();interactions?.hideTooltip();showRange();chart.update('none');
}
async function analyzeSelection(lo:number,hi:number) {
        element('report-content').textContent='Calcolo sui campioni originali…'; report.showModal();
        try {
            const result=await ipcRenderer.invoke('forno-history',{fromMs:lo,toMs:hi,intervalMs:Math.max(500,hi-lo+1),maxPoints:1});
            const temperature=(v:number|null)=>v===null?'\u2014':v.toFixed(2)+' \u00b0C';
            const lines=[`Da: ${formatTime(lo)}`,`A: ${formatTime(hi)}`,`Durata: ${((hi-lo)/1000).toFixed(1)} s`];
            const average=channelAverage(channelsOf(result).map((channel:any)=>({id:channel.id,name:channel.name,valid:channel.stats.valid,mean:channel.stats.mean})));
            lines.push('','TEMPERATURA MEDIA COMPLESSIVA',temperature(average.temperature));
            if(average.channels.length)lines.push('Canali inclusi: '+average.channels.map(c=>c.name).join(', '),'Media aritmetica delle medie dei canali nel periodo. Campioni Off o non validi esclusi; incluse anche le curve nascoste.');
            else lines.push('Nessun canale con dati validi nel periodo selezionato.');
            for(const channel of channelsOf(result)) {
                const s=channel.stats;
                lines.push('',channel.name||'Canale '+channel.id,`Campioni validi: ${s.valid} · Non validi / disattivati: ${s.missing}`,`Minima: ${temperature(s.min)}`,`Massima: ${temperature(s.max)}`,`Delta (max − min): ${temperature(s.delta)}`,`Media campioni: ${temperature(s.mean)}`,`Primo / ultimo: ${temperature(s.first)} / ${temperature(s.last)}`);
            }
            element('report-content').textContent=lines.join('\n');
        } catch(error) { element('report-content').textContent=String(error); }

}
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
    resolution.value=String(preferences.resolutionMs);
    end=Date.now()+clockOffset;start=end-preferences.periodMs;
    diagnostics.open=preferences.showDiagnostics;
    applyAppearance();showRange();chart.update('none');
}
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
const optionFields: Record<string,keyof FornoViewSettings> = {
    'opt-x-divisions':'xDivisions','opt-y-divisions':'yDivisions','opt-x-every':'xLabelEvery','opt-y-every':'yLabelEvery',
    'opt-decimals':'temperatureDecimals','opt-date-labels':'dateLabels','opt-theme':'theme','opt-line-width':'lineWidth',
    'opt-grid-opacity':'gridOpacity','opt-legend':'showLegend','opt-envelope':'showEnvelope','opt-points':'showPoints','opt-diagnostics':'showDiagnostics',
};
function previewDivisions(){const n=Number(element<HTMLInputElement>('opt-x-divisions').value);element('division-preview').textContent=n+' divisioni = '+n+' intervalli e '+(n+1)+' linee. Prima e ultima etichetta sempre visibili.';}
function fillOptions(settings:FornoViewSettings){
    for(const [id,key] of Object.entries(optionFields)) {const field=element<HTMLInputElement>(id);if(typeof settings[key]==='boolean')field.checked=settings[key] as boolean;else field.value=String(settings[key]);}
    previewDivisions();
}
element('opt-x-divisions').addEventListener('input',previewDivisions);
element('open-options').addEventListener('click',()=>{fillOptions(preferences);optionsDialog.showModal();});
element('reset-options').addEventListener('click',()=>fillOptions({...DEFAULT_VIEW_SETTINGS}));
element<HTMLFormElement>('options-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const next:any={...preferences};
    for(const [id,key] of Object.entries(optionFields)){const field=element<HTMLInputElement>(id);next[key]=typeof DEFAULT_VIEW_SETTINGS[key]==='boolean'?field.checked:typeof DEFAULT_VIEW_SETTINGS[key]==='number'?Number(field.value):field.value;}
    preferences=normalizeViewSettings(next);diagnostics.open=preferences.showDiagnostics;render();
    try{await savePreferences();optionsDialog.close();}catch{/* errore visibile nel pannello */}
});
function setModuleState(state:string,label:string) {
    const badge=element('module-state');badge.dataset.state=state;badge.title=label;badge.setAttribute('aria-label',label);badge.querySelector('span')!.textContent=label;
}
element('refresh-view').addEventListener('click',async()=>{
    const button=element<HTMLButtonElement>('refresh-view');button.disabled=true;
    try{await checkStatus();await refresh(true);}finally{button.disabled=false;}
});
async function checkStatus() {
    try {
        const s=await ipcRenderer.invoke('forno-status');
        backendState=s;updateChannelCards();bootSplash.mark('server');
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
    if(!interactions?.busy && live.checked) await refresh(false);
    if(Date.now()-lastStatusCheck>10000) {lastStatusCheck=Date.now();await checkStatus();}
    if(!disposed) setTimeout(tick,Math.max(1000,Math.min(5000,Number(resolution.value))));
}
window.addEventListener('beforeunload',()=>{bootSplash.dispose();disposed=true;interactions?.dispose();reveal.stop();chart.destroy();});
void (async()=>{try{await loadPreferences();bootSplash.mark('interface');await checkStatus();showRange();await refresh(true);}finally{bootSplash.ready();}void tick();})();
