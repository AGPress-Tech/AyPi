import type Chart from 'chart.js/auto';

type Reading={id:number;name:string;temperature:number|null;quality:string};
export type CursorSample={requestedMs:number;timestampMs:number|null;channels:Reading[];mean:number|null};
export type CursorPreview={fromMs:number;toMs:number;channels:Reading[];mean:number|null};

export function setupContinuousTooltip(chart:Chart<'line'>,options:{
    request(timestampMs:number):Promise<CursorSample>;
    preview(timestampMs:number):CursorPreview|null;
    formatTime(timestampMs:number):string;
    now():number;
    colors:string[];
    changed(enabled:boolean):void;
    addNote(timestampMs:number):void;
}) {
    const canvas=chart.canvas,panel=document.getElementById('continuous-tooltip')!;
    const menu=document.getElementById('chart-context-menu')!,toggle=document.getElementById('toggle-continuous-tooltip')!;
    const time=document.getElementById('cursor-time')!,kind=document.getElementById('cursor-kind')!,mean=document.getElementById('cursor-mean')!,body=document.getElementById('cursor-readings')!;
    const events=new AbortController(),signal=events.signal;
    const values=new Map<number,{value:HTMLElement;state:HTMLElement}>();
    for(let id=1;id<=4;id++) {
        const row=document.createElement('div');row.className='cursor-reading';row.dataset.channel=String(id);row.style.setProperty('--channel-color',options.colors[id-1]);
        const name=document.createElement('span');name.className='cursor-channel';name.textContent='Canale '+id;
        const value=document.createElement('strong'),state=document.createElement('small');row.append(name,value,state);body.append(row);values.set(id,{value,state});
    }
    let enabled=false,disposed=false,dragging=false,busy=false,frame=0,lastSent=-Infinity,cooldown=0;
    let position:{clientX:number;clientY:number}|null=null,contextPosition:typeof position=null,guide:number|null=null,wanted:number|null=null;
    let timer:ReturnType<typeof setTimeout>|undefined;
    let contextTime=0;
    const cache=new Map<number,{sample:CursorSample;expires:number}>();
    const temperature=(v:number|null)=>v===null?'\u2014':v.toLocaleString('it-IT',{minimumFractionDigits:1,maximumFractionDigits:2})+' °C';
    function local(p:{clientX:number;clientY:number}){const r=canvas.getBoundingClientRect();return {x:(p.clientX-r.left)*chart.width/r.width,y:(p.clientY-r.top)*chart.height/r.height};}
    function inside(p:{x:number;y:number}){const a=chart.chartArea;return p.x>=a.left&&p.x<=a.right&&p.y>=a.top&&p.y<=a.bottom;}
    function render(channels:Reading[],average:number|null,label:string,date:string) {
        for(const [id,fields]of values){const row=channels.find(c=>c.id===id);fields.value.textContent=temperature(row?.temperature??null);fields.state.textContent=row?.quality==='off'?'Off':row?.quality==='good'?'':row?.quality==='aggregate'?'media':'Non disponibile';}
        mean.textContent=temperature(average);time.textContent=date;kind.textContent=label;panel.hidden=false;
        panel.style.top=(chart.chartArea.top+10)+'px';panel.style.right=(chart.width-chart.chartArea.right+10)+'px';
    }
    function showSample(sample:CursorSample) {
        if(sample.timestampMs!==null)guide=Math.max(chart.chartArea.left,Math.min(chart.chartArea.right,chart.scales.x.getPixelForValue(sample.timestampMs)));
        render(sample.channels,sample.mean,sample.timestampMs===null?'Nessun campione vicino all’istante scelto':'Campione originale registrato',options.formatTime(sample.timestampMs??sample.requestedMs));
        chart.draw();
    }
    function schedule() {
        if(disposed||!enabled||dragging||!menu.hidden||wanted===null||busy)return;
        clearTimeout(timer);
        const delay=Math.max(0,250-(performance.now()-lastSent),cooldown-performance.now());
        timer=setTimeout(()=>{void request();},delay);
    }
    async function request() {
        if(disposed||!enabled||dragging||!menu.hidden||wanted===null||busy)return;
        const key=wanted,hit=cache.get(key);
        if(hit&&hit.expires>performance.now()){showSample(hit.sample);return;}
        busy=true;lastSent=performance.now();
        try {
            const sample=await options.request(key);
            if(disposed)return;
            if(sample.timestampMs!==null){cache.set(key,{sample,expires:performance.now()+(Math.abs(sample.timestampMs-options.now())<10000?250:60000)});if(cache.size>80)cache.delete(cache.keys().next().value!);}
            if(enabled&&wanted===key&&!dragging&&menu.hidden)showSample(sample);
        }catch{
            cooldown=performance.now()+5000;
            if(enabled&&wanted===key)kind.textContent='Dati della vista · campione non disponibile';
        }finally{busy=false;if(!disposed&&enabled&&wanted!==key)schedule();}
    }
    function update() {
        if(!enabled||!position||dragging||!menu.hidden)return;
        const p=local(position);if(!inside(p)){guide=null;wanted=null;clearTimeout(timer);chart.draw();return;}
        guide=p.x;const t=chart.scales.x.getValueForPixel(p.x)!;
        wanted=Math.max(0,Math.round(t/100)*100);
        const hit=cache.get(wanted);
        if(hit&&hit.expires>performance.now()){showSample(hit.sample);return;}
        const preview=options.preview(t);
        if(preview)render(preview.channels,preview.mean,'Media della vista · lettura campione…',options.formatTime(preview.fromMs)+' → '+options.formatTime(preview.toMs));
        else render([],null,'Lettura campione…',options.formatTime(t));
        chart.draw();schedule();
    }
    function requestUpdate(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;update();});}
    function closeMenu(){menu.hidden=true;canvas.setAttribute('aria-expanded','false');}
    function setEnabled(value:boolean,notify=false) {
        enabled=value;toggle.setAttribute('aria-checked',String(value));closeMenu();
        clearTimeout(timer);wanted=null;guide=null;panel.hidden=true;
        if(notify)options.changed(value);
        if(enabled&&position)update();else if(enabled&&contextPosition){position=contextPosition;update();position=null;}else chart.draw();
    }
    canvas.addEventListener('contextmenu',event=>{
        let p=local(event);
        if(event.clientX===0&&event.clientY===0){const r=canvas.getBoundingClientRect();position={clientX:r.left+(chart.chartArea.left+chart.chartArea.right)/2,clientY:r.top+(chart.chartArea.top+chart.chartArea.bottom)/2};p=local(position);}
        else position={clientX:event.clientX,clientY:event.clientY};
        if(!inside(p))return;
        contextPosition=position;
        contextTime=Math.max(0,Math.round(chart.scales.x.getValueForPixel(p.x)!));
        event.preventDefault();clearTimeout(timer);menu.hidden=false;
        const bounds=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(event.clientX||position.clientX,innerWidth-bounds.width-8))+'px';menu.style.top=Math.max(8,Math.min(event.clientY||position.clientY,innerHeight-bounds.height-8))+'px';
        canvas.setAttribute('aria-expanded','true');toggle.focus();
    },{signal});
    toggle.addEventListener('click',()=>{setEnabled(!enabled,true);canvas.focus({preventScroll:true});},{signal});
    document.getElementById('add-chart-note')!.addEventListener('click',()=>{closeMenu();options.addNote(contextTime);},{signal});
    document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target as Node))closeMenu();},{signal,capture:true});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){closeMenu();canvas.focus({preventScroll:true});}},{signal});
    canvas.addEventListener('pointermove',event=>{position={clientX:event.clientX,clientY:event.clientY};if(enabled&&!dragging)requestUpdate();},{signal});
    canvas.addEventListener('pointerleave',()=>{position=null;wanted=null;guide=null;clearTimeout(timer);if(enabled)chart.draw();},{signal});
    canvas.addEventListener('pointerdown',event=>{if(event.button===0){dragging=true;guide=null;clearTimeout(timer);}},{signal});
    canvas.addEventListener('pointerup',()=>{dragging=false;if(enabled)requestUpdate();},{signal});
    canvas.addEventListener('pointercancel',()=>{dragging=false;guide=null;},{signal});
    return {
        get enabled(){return enabled;},setEnabled,
        afterChartUpdate(){if(enabled)update();},
        drawGuide(){if(!enabled||guide===null||dragging)return;const {ctx,chartArea}=chart;if(guide<chartArea.left||guide>chartArea.right)return;ctx.save();ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(guide,chartArea.top);ctx.lineTo(guide,chartArea.bottom);ctx.stroke();ctx.restore();},
        dispose(){disposed=true;clearTimeout(timer);cancelAnimationFrame(frame);events.abort();panel.hidden=true;menu.hidden=true;},
    };
}
