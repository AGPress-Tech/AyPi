import Chart from 'chart.js/auto';
import {analysisChartControls,setChartExpanded} from './analysis-chart-controls';
import {analysisSelectionHighlight} from './analysis-selection-highlight';
import {installHtmlAreaSelection} from './analysis-chart-area-selection';
import {emptyWorkspace,validateWorkspace,WorkspaceChart} from '../../main/modules/analysis-ui-model';
const ipc=require('electron').ipcRenderer;
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
type Options={key:string;actions:HTMLElement;container:()=>HTMLElement;reset?:()=>void;sources?:{id:string;title:string}[];metrics?:{id:string;title:string}[];build?:(spec:WorkspaceChart)=>any;revision?:()=>unknown;persistence?:{load:()=>Promise<any>;save:(preferences:any)=>Promise<any>};htmlPanels?:{id:string;panel:HTMLElement;title:string;area?:(indices:number[],multiple:boolean)=>void}[]};
/** Add the same chart controls/editor to existing reports without replacing their tables. */
export function installAnalysisWorkspace(options:Options){
    Chart.register(analysisSelectionHighlight);
    document.body.classList.add('analysis-ui-enhanced');
    let preferences=emptyWorkspace(),focusId='',returnFocus:HTMLElement|null=null,editing='',ready=false,signature='',saving=false;
    const sources=new Map<string,{title:string;chart:any}>(),customCharts=new Map<string,Chart>();
    const menu=document.createElement('button');menu.id='chartsMenu';menu.type='button';menu.textContent='Grafici';
    const layout=document.createElement('button');layout.id='layoutToggle';layout.type='button';layout.textContent='↕ Vista ampia';
    options.actions.prepend(menu,layout);
    const backdrop=document.createElement('div');backdrop.className='analysis-chart-backdrop';backdrop.hidden=true;document.body.append(backdrop);
    const custom=document.createElement('div');custom.className='workspace-custom-grid';custom.dataset.workspaceOwned='true';
    const dialog=document.createElement('dialog');dialog.className='workspace-charts-dialog';dialog.dataset.workspaceOwned='true';document.body.append(dialog);
    function message(text:string){const host=dialog.querySelector<HTMLElement>('[data-workspace-message]');if(host)host.textContent=text;}
    function resize(){for(const source of sources.values())if(source.chart?.canvas)source.chart.resize();for(const chart of customCharts.values())if(chart.canvas)chart.resize();}
    function closeFocus(){const previous=focusId;focusId='';document.querySelectorAll('.analysis-workspace-panel.chart-focused').forEach(node=>{node.classList.remove('chart-focused');node.removeAttribute('role');node.removeAttribute('aria-modal')});backdrop.hidden=true;document.body.classList.remove('chart-focus-open');document.querySelectorAll<HTMLElement>('[data-expand-chart]').forEach(b=>setChartExpanded(b,false));resize();(returnFocus?.isConnected?returnFocus:document.querySelector<HTMLElement>(`[data-expand-chart="${previous}"]`))?.focus({preventScroll:true});}
    function expand(id:string,button:HTMLElement){if(focusId===id){closeFocus();return}closeFocus();const panel=document.getElementById(id)?.closest<HTMLElement>('.analysis-workspace-panel');if(!panel)return;returnFocus=button;focusId=id;panel.classList.add('chart-focused');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',panel.querySelector('h2,h3')?.textContent||'Grafico');backdrop.hidden=false;document.body.classList.add('chart-focus-open');setChartExpanded(button,true);button.focus();resize();}
    function sourceOptions(){return options.sources||[...sources].map(([id,v])=>({id,title:v.title}));}
    function applyLayout(){document.body.classList.toggle('analysis-workspace-expanded',preferences.layout.expanded);layout.textContent=preferences.layout.expanded?'↕ Vista compatta':'↕ Vista ampia';layout.setAttribute('aria-pressed',String(preferences.layout.expanded));resize();}
    function renderEditor(){
        const rows=[...sourceOptions(),...preferences.layout.charts.map(c=>({id:c.id,title:c.title}))];
        dialog.innerHTML=`<div class="dialog-heading"><h2>Grafici e preset personali</h2></div><div class="workspace-editor"><section><h3>Grafici visibili</h3>${rows.map(c=>`<div class="workspace-visibility"><label><input type="checkbox" data-visible="${esc(c.id)}" ${preferences.layout.hidden.includes(c.id)?'':'checked'}>${esc(c.title)}</label>${preferences.layout.charts.some(v=>v.id===c.id)?`<div><button data-edit="${esc(c.id)}">Modifica</button><button data-remove="${esc(c.id)}">Elimina</button></div>`:''}</div>`).join('')}</section><section><h3>${editing?'Modifica grafico':'Aggiungi un grafico'}</h3><form id="workspaceBuilder"><div class="workspace-fields"><label>Nome<input name="title" maxlength="100" required value="Nuovo grafico"></label><label>Dati<select name="source">${sourceOptions().map(s=>`<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('')}</select></label><label>Tipo<select name="kind"><option value="bar">Barre</option><option value="line">Linee</option><option value="doughnut">Anello</option></select></label>${options.metrics?`<label>Indicatore<select name="metric">${options.metrics.map(m=>`<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('')}</select></label>`:''}<label>Voci / periodi<input name="limit" type="number" min="3" max="240" value="12" required></label></div><button type="submit">${editing?'Applica modifica':'Aggiungi grafico'}</button>${editing?'<button type="button" data-cancel-edit>Annulla modifica</button>':''}</form></section><section><h3>Preset personali</h3><div class="workspace-preset-row"><select id="workspacePreset">${preferences.presets.map((p,i)=>`<option value="${i}">${esc(p.name)}</option>`).join('')}</select><button data-load-preset>Carica</button><button data-delete-preset>Elimina</button></div><div class="workspace-preset-row"><input id="workspacePresetName" maxlength="60" placeholder="Nome nuovo preset"><button data-save-preset>Salva nuovo preset</button></div></section><p data-workspace-message role="status"></p></div><div class="dialog-actions"><button data-restore>Ripristina grafici</button><button data-close>Chiudi</button><button data-save>Salva pagina</button></div>`;
        if(editing){const c=preferences.layout.charts.find(c=>c.id===editing)!;for(const key of ['title','source','kind','limit','metric']){const input=dialog.querySelector<HTMLInputElement>(`[name=${key}]`);if(input)input.value=String(c[key])}}
    }
    function configure(spec:WorkspaceChart){
        if(options.build)return options.build(spec);
        const original=sources.get(spec.source)?.chart;if(!original)return null;
        const labels=copy(original.data.labels||[]).slice(0,spec.limit),datasets=copy(original.data.datasets).filter((d:any)=>!d.highlightSeries).map((d:any)=>({...d,data:d.data.slice(0,spec.limit)}));
        if(datasets.some((d:any)=>d.data.some((v:any)=>typeof v==='object')))return null;
        const kind=spec.kind==='doughnut'&&datasets.some((d:any)=>d.data.some((v:number)=>v<0))?'bar':spec.kind;
        return {type:kind,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{position:'bottom'}},...(kind!=='doughnut'?{scales:{y:{beginAtZero:true}}}:{}),onClick:original.config.options?.onClick,onAreaSelect:original.config.options?.onAreaSelect}};
    }
    function sync(){
        for(const entry of options.htmlPanels||[]){const host=document.getElementById(entry.id);if(host&&entry.area)installHtmlAreaSelection(host,()=>Array.from(host.querySelectorAll<HTMLElement>('.chart-track')),entry.area);}
        for(const entry of options.htmlPanels||[]){entry.panel.classList.add('analysis-workspace-panel');entry.panel.hidden=preferences.layout.hidden.includes(entry.id);const head=entry.panel.querySelector('.card-heading,header');if(head&&!head.querySelector('[data-expand-chart]')){const controls=document.createElement('div');controls.className='panel-actions analysis-workspace-controls';controls.dataset.workspaceOwned='true';controls.innerHTML=analysisChartControls(entry.id,entry.title);head.append(controls)}}
        document.querySelectorAll<HTMLCanvasElement>('canvas[id]').forEach(canvas=>{
            if(canvas.closest('[data-workspace-owned]'))return;
            const chart=Chart.getChart(canvas);if(!chart||!['bar','line','doughnut'].includes((chart.config as any).type))return;
            const panel=canvas.closest<HTMLElement>('.panel,.chart-card,.custom-card,.fpa-card,.card')||canvas.parentElement?.parentElement;if(!panel)return;
            const head=panel.querySelector<HTMLElement>('.panel-head,header,.card-heading,h2,h3');if(!head)return;
            panel.classList.add('analysis-workspace-panel');
            const title=panel.querySelector('h2,h3')?.textContent||canvas.id;sources.set(canvas.id,{title,chart});
            if(!panel.querySelector(`[data-expand-chart="${canvas.id}"]`)){const controls=document.createElement('div');controls.className='panel-actions analysis-workspace-controls';controls.dataset.workspaceOwned='true';controls.innerHTML=analysisChartControls(canvas.id,title);head.append(controls)}
            panel.hidden=preferences.layout.hidden.includes(canvas.id);
        });
        const next=JSON.stringify([preferences.layout,options.revision?.(),[...sources].map(([id,s])=>[id,s.chart.data])]);
        if(next!==signature){
            signature=next;for(const chart of customCharts.values())chart.destroy();customCharts.clear();custom.replaceChildren();
            const container=options.container();if(custom.parentElement!==container)container.append(custom);
            for(const spec of preferences.layout.charts){
                const panel=document.createElement('article');panel.className='panel analysis-workspace-panel workspace-custom-chart';panel.hidden=preferences.layout.hidden.includes(spec.id);
                panel.innerHTML=`<div class="panel-head"><h2>${esc(spec.title)}</h2><div class="panel-actions">${analysisChartControls(spec.id,spec.title)}</div></div><div class="workspace-chart-body"><canvas id="${esc(spec.id)}"></canvas></div>`;custom.append(panel);
                const config=configure(spec);if(config)customCharts.set(spec.id,new Chart(panel.querySelector('canvas')!,config));else panel.querySelector('.workspace-chart-body')!.textContent='Apri la vista dei dati di origine per visualizzare questo grafico.';
            }
            custom.hidden=!preferences.layout.charts.length;
            document.body.classList.toggle('analysis-has-custom-charts',!!preferences.layout.charts.length);
        }
        if(focusId&&!document.getElementById(focusId)?.closest('.chart-focused')){
            const id=focusId,button=document.querySelector<HTMLElement>(`[data-expand-chart="${id}"]`);
            if(button&&!button.closest<HTMLElement>('.analysis-workspace-panel')?.hidden){focusId='';expand(id,button)}else closeFocus();
        }
        applyLayout();
    }
    menu.onclick=()=>{sync();editing='';renderEditor();dialog.showModal()};layout.onclick=()=>{preferences.layout.expanded=!preferences.layout.expanded;applyLayout()};backdrop.onclick=closeFocus;
    document.addEventListener('click',event=>{const b=(event.target as HTMLElement).closest<HTMLElement>('[data-expand-chart],[data-reset-chart]');if(!b||!b.closest('.analysis-workspace-panel'))return;if(b.dataset.expandChart)expand(b.dataset.expandChart,b);else{options.reset?.();sync()}});
    document.addEventListener('keydown',event=>{
        if(!focusId||dialog.open)return;
        if(event.key==='Escape'){event.preventDefault();closeFocus()}
        if(event.key==='Tab'){const buttons=Array.from(document.querySelectorAll<HTMLElement>('.chart-focused button,.chart-focused select,.chart-focused input,.chart-focused [tabindex="0"]')).filter(e=>!e.hidden&&!e.hasAttribute('disabled'));const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    });
    dialog.addEventListener('change',event=>{const input=event.target as HTMLInputElement;if(input.dataset.visible){preferences.layout.hidden=preferences.layout.hidden.filter(id=>id!==input.dataset.visible);if(!input.checked)preferences.layout.hidden.push(input.dataset.visible);sync()}});
    dialog.addEventListener('submit',event=>{event.preventDefault();const form=event.target as HTMLFormElement;if(!form.reportValidity())return;const fields=new FormData(form);const chart:WorkspaceChart={id:editing||'custom-'+Date.now().toString(36),source:String(fields.get('source')),title:String(fields.get('title')),kind:fields.get('kind') as any,limit:Number(fields.get('limit')),metric:String(fields.get('metric')||'')};try{const next=copy(preferences);next.layout.charts=next.layout.charts.filter(c=>c.id!==chart.id).concat(chart);preferences=validateWorkspace(next);editing='';sync();renderEditor()}catch(e){message((e as Error).message)}});
    dialog.addEventListener('click',async event=>{
        const b=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b)return;
        if(b.closest('form')&&b.type==='submit')return;
        if(saving&&(b.hasAttribute('data-save')||b.hasAttribute('data-save-preset')||b.hasAttribute('data-delete-preset')))return;
        try{
            if(b.hasAttribute('data-close')){dialog.close();return}
            if(b.dataset.edit){editing=b.dataset.edit;renderEditor();return}
            if(b.hasAttribute('data-cancel-edit')){editing='';renderEditor();return}
            if(b.dataset.remove){preferences.layout.charts=preferences.layout.charts.filter(c=>c.id!==b.dataset.remove);preferences.layout.hidden=preferences.layout.hidden.filter(id=>id!==b.dataset.remove)}
            if(b.hasAttribute('data-restore'))preferences.layout=emptyWorkspace().layout;
            const index=Number(dialog.querySelector<HTMLSelectElement>('#workspacePreset')?.value);
            if(b.hasAttribute('data-load-preset')){const preset=preferences.presets[index];if(!preset)throw Error('Seleziona un preset.');preferences.layout=copy(preset.layout)}
            if(b.hasAttribute('data-delete-preset'))preferences.presets.splice(index,1);
            if(b.hasAttribute('data-save-preset')){const name=dialog.querySelector<HTMLInputElement>('#workspacePresetName')!.value.trim();const next=copy(preferences);next.presets.push({name,layout:copy(preferences.layout)});preferences=validateWorkspace(next)}
            if(b.hasAttribute('data-save')||b.hasAttribute('data-save-preset')||b.hasAttribute('data-delete-preset')){
                if(saving)return;saving=true;b.disabled=true;
                try{const result=await (options.persistence?options.persistence.save(preferences):ipc.invoke('analysis-ui-save',{key:options.key,preferences}));if(!result.ok)throw Error(result.error);preferences=validateWorkspace(result.preferences)}finally{saving=false;b.disabled=false}
            }
            sync();renderEditor();if(b.hasAttribute('data-save'))message('Pagina salvata.');
        }catch(error){message((error as Error).message)}
    });
    let timer:ReturnType<typeof setTimeout>;
    const observer=new MutationObserver(records=>{if(!ready||records.every(r=>(r.target as HTMLElement).closest?.('[data-workspace-owned]')))return;clearTimeout(timer);timer=setTimeout(sync,80)});
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('resize',resize);
    void (options.persistence?options.persistence.load():ipc.invoke('analysis-ui-load',options.key)).then(result=>{if(result.ok)preferences=validateWorkspace(result.preferences);else menu.title=result.error}).catch(error=>{menu.title=error.message}).finally(()=>{ready=true;sync()});
    return {sync,closeFocus};
}
