type Stats={samples:number;valid:number;missing:number;min:number|null;max:number|null;delta:number|null;mean:number|null};
type AnalysisSeries={id:number;name:string;stats:Stats;windows:{count:number;meanDelta:number|null;maxDelta:null|{fromMs:number;toMs:number;min:number;max:number;delta:number;minTime:number;maxTime:number}}};
export type AnalysisResponse={fromMs:number;toMs:number;windowSeconds:number;combined:AnalysisSeries;channels:AnalysisSeries[]};

export function setupAnalysisPanel(options:{request(input:{fromMs:number;toMs:number;windowSeconds:number}):Promise<AnalysisResponse>;getSeconds():number;saveSeconds(seconds:number):void;formatTime(t:number):string}) {
    const dialog=document.getElementById('report') as HTMLDialogElement;
    const content=document.getElementById('report-content')!;
    const input=document.getElementById('analysis-seconds') as HTMLInputElement;
    const form=document.getElementById('analysis-form') as HTMLFormElement;
    const message=document.getElementById('analysis-message')!;
    const button=document.getElementById('analysis-recalculate') as HTMLButtonElement;
    let range={fromMs:0,toMs:0},revision=0,busy=false,pending=false;
    function node(tag:string,className:string,text?:string) {const n=document.createElement(tag);n.className=className;if(text!==undefined)n.textContent=text;return n;}
    const temp=(v:number|null)=>v===null?'\u2014':v.toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})+' °C';
    function metric(label:string,value:number|null){const n=node('div','analysis-metric');n.append(node('span','',label),node('strong','',temp(value)));return n;}
    function card(series:AnalysisSeries,combined=false) {
        const n=node('section','analysis-card'+(combined?' analysis-card--combined':''));n.dataset.channel=String(series.id);
        const header=node('div','analysis-card-heading');header.append(node('h3','',series.name),node('small','',combined?'Media dei canali validi per istante':series.stats.valid?series.stats.valid.toLocaleString('it-IT')+' campioni validi':'Off / nessun dato valido'));
        n.append(header);
        const metrics=node('div','analysis-metrics');
        for(const [label,key]of [['T max','max'],['T min','min'],['Delta T','delta'],['Media campioni','mean']] as const) {const m=metric(label,series.stats[key]);m.dataset.metric=key;metrics.append(m);}
        n.append(metrics);
        const windows=node('div','analysis-windows');windows.append(metric('Delta T medio / finestra',series.windows.meanDelta),metric('Delta T massimo / finestra',series.windows.maxDelta?.delta??null));n.append(windows);
        const maximum=series.windows.maxDelta;
        if(maximum) {
            const details=document.createElement('details');details.className='analysis-window-details';
            const summary=document.createElement('summary');summary.textContent='Intervallo con il massimo Delta T';
            const times=node('p','',options.formatTime(maximum.fromMs)+' → '+options.formatTime(maximum.toMs));
            const extremes=node('p','',`T min ${temp(maximum.min)} · T max ${temp(maximum.max)} · Delta T ${temp(maximum.delta)}`);
            details.append(summary,times,extremes,node('p','analysis-note',`Minimo: ${options.formatTime(maximum.minTime)} · Massimo: ${options.formatTime(maximum.maxTime)}`));n.append(details);
        }else n.append(node('p','analysis-note',series.stats.valid?'Selezione più breve della finestra o nessuna finestra con dati validi.':'Nessuna temperatura valida da analizzare.'));
        n.append(node('p','analysis-note',`${series.windows.count.toLocaleString('it-IT')} finestre · ${series.stats.missing.toLocaleString('it-IT')} campioni non validi / Off`));
        return n;
    }
    async function calculate() {
        const seconds=Number(input.value);
        if(!input.checkValidity()||!Number.isFinite(seconds)||seconds<0.5||seconds>86400){message.textContent='Inserire una finestra tra 0,5 e 86400 secondi.';return;}
        options.saveSeconds(seconds);revision++;
        if(busy){pending=true;return;}
        const version=revision,request={...range,windowSeconds:seconds};busy=true;button.disabled=true;content.setAttribute('aria-busy','true');message.textContent='Analisi dei campioni originali in corso…';
        try {
            const response=await options.request(request);
            if(version!==revision||!dialog.open)return;
            content.replaceChildren(card(response.combined,true));
            const channels=node('div','analysis-channel-grid');for(const channel of response.channels)channels.append(card(channel));content.append(channels);
            message.textContent=`Finestre mobili di ${response.windowSeconds.toLocaleString('it-IT')} s, aggiornate a ogni campione. Delta T = massima − minima. Off esclusi; nessuna interpolazione.`;
        }catch(error){if(version===revision){message.textContent='Analisi non disponibile: '+String((error as Error).message||error);content.replaceChildren(node('p','form-error','Verificare lo stato del backend o ridurre l’intervallo selezionato.'));}}
        finally{busy=false;button.disabled=false;content.removeAttribute('aria-busy');if(pending&&dialog.open){pending=false;void calculate();}}
    }
    let timer:ReturnType<typeof setTimeout>|undefined;
    form.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);void calculate();});
    input.addEventListener('change',()=>{clearTimeout(timer);timer=setTimeout(()=>{void calculate();},400);});
    dialog.addEventListener('close',()=>{revision++;pending=false;clearTimeout(timer);});
    return {open(fromMs:number,toMs:number){range={fromMs,toMs};input.value=String(options.getSeconds());document.getElementById('analysis-range')!.textContent=options.formatTime(fromMs)+' → '+options.formatTime(toMs)+' · '+((toMs-fromMs)/1000).toLocaleString('it-IT')+' s';content.replaceChildren();if(!dialog.open)dialog.showModal();void calculate();}};
}
