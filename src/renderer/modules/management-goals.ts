import Chart from "chart.js/auto";
import { TARGET_METRICS, TargetMetric, Targets, targetKey, targetResult } from "../../main/modules/management/targets";

export type GoalsContext = {
    year:number;from:number;to:number;comparisonYear:number;
    actual:Record<TargetMetric,number>; reference:Record<TargetMetric,number>;
    categories:{name:string;value:number}[]; groups:{name:string;category:string;value:number}[];
};
const $ = (id:string) => document.getElementById(id)!;
const currency = new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR",maximumFractionDigits:2});
const euro = (v:number) => currency.format(Math.abs(v)<1e-9 ? 0 : v);
const percentage = (v:number) => new Intl.NumberFormat("it-IT",{maximumFractionDigits:1}).format(v)+"%";
const compact = (v:number) => {
    const scale=Math.abs(v)>=1e6 ? 1e6 : Math.abs(v)>=1e3 ? 1e3 : 1;
    return new Intl.NumberFormat("it-IT",{maximumFractionDigits:scale===1e6 ? 2 : scale===1e3 ? 1 : 0}).format(v/scale)+(scale===1e6 ? " mln" : scale===1e3 ? " mila" : "");
};
const esc = (s:unknown) => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
const monthNames = ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

export function createManagementGoals(openGroup:(group:string)=>void) {
    const {ipcRenderer} = require("electron");
    let targets: Targets = Object.create(null), context: GoalsContext | null = null;
    let selectedCategory: string | null = null, notice = "", editing: {year:number;from:number;to:number;metric:TargetMetric} | null = null;
    let reference = 0, saving = false;
    let mixMode: "costs" | "revenue" = "costs";
    const mixCategories = (c:GoalsContext) => c.categories.filter(v=>mixMode==="costs" ? v.value<0 : v.value>0).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
    const charts = new Map<string,Chart>();
    const palette = ["#267bb4","#438f89","#74859b","#bd9c61","#8c89a4","#8faeb7","#567383"];
    const dialog = $("goalDialog") as HTMLDialogElement;
    const input = $("goalValue") as HTMLInputElement;
    const scopeLabel = (r:{year:number;from:number;to:number}) => `${r.year} · ${monthNames[r.from-1]}–${monthNames[r.to-1]}`;
    const accent = () => getComputedStyle(document.body).getPropertyValue("--ops-accent").trim();
    function clearHover(node:HTMLCanvasElement, chart:Chart) {
        node.onmouseleave=()=>{chart.setActiveElements([]);chart.tooltip?.setActiveElements([],{x:0,y:0});node.style.cursor="default";chart.update("none");};
    }
    function gauge(metric:TargetMetric) {
        const c=context!, actual=c.actual[metric], target=targets[targetKey({...c,metric})];
        const result=target ? targetResult(actual,target.value,metric) : null;
        const base=target?.value ?? Math.max(0,c.reference[metric]);
        const max=Math.max(1,Math.abs(actual),base)*1.1;
        const fill=Math.max(0,Math.min(100,actual/max*100));
        const tone=metric==="Margine 3" ? "#438f89" : metric==="Costi gestionali" ? "#647d99" : accent();
        const color=result ? result.reached ? "#238572" : "#ba5267" : tone;
        const angle=Math.PI*(1-base/max), marker=(radius:number)=>`${120+radius*Math.cos(angle)},${120-radius*Math.sin(angle)}`;
        const status=!target ? "Consuntivo del periodo selezionato" : metric==="Costi gestionali" ? (result!.reached ? `Budget residuo ${euro(result!.gap)}` : `Budget superato di ${euro(-result!.gap)}`)
            : result!.reached ? `Obiettivo raggiunto · +${euro(result!.gap)}` : `Mancano ${euro(-result!.gap)}`;
        const progress=target && result!.percent!==null ? `${percentage(result!.percent)} ${metric==="Costi gestionali" ? "del budget" : "dell’obiettivo"}` : target ? "Obiettivo di pareggio" : "";
        const id="goal-gradient-"+TARGET_METRICS.indexOf(metric);
        const showMarker=target || c.reference[metric]>=0;
        const ticks=[0,.25,.5,.75,1].map(v=>{const a=Math.PI*(1-v),point=(r:number)=>`${120+r*Math.cos(a)},${120-r*Math.sin(a)}`;return `<polyline points="${point(113)} ${point(118)}" class="gauge-tick"/>`;}).join("");
        return `<article class="panel goal-card" style="--goal-tone:${tone}" data-goal-metric="${esc(metric)}">
          <div class="panel-head"><h2>${esc(metric)}</h2><button data-edit-goal="${esc(metric)}">${target ? "Modifica obiettivo" : "Imposta obiettivo"}</button></div>
          <div class="gauge-visual" role="img" aria-label="${esc(metric+': '+euro(actual)+'. '+status)}">
            <svg viewBox="0 0 240 145" aria-hidden="true"><defs><linearGradient id="${id}" x1="20" y1="120" x2="220" y2="20" gradientUnits="userSpaceOnUse"><stop stop-color="${color}" stop-opacity=".65"/><stop offset="1" stop-color="${color}"/></linearGradient></defs>
            ${ticks}<path d="M20 120 A100 100 0 0 1 220 120" pathLength="100" class="gauge-track"/><path d="M20 120 A100 100 0 0 1 220 120" pathLength="100" stroke="url(#${id})" stroke-dasharray="${fill} 100" class="gauge-fill"/>
            ${showMarker ? `<polyline points="${marker(88)} ${marker(110)}" class="gauge-marker ${target ? "" : "gauge-reference"}"><title>${esc((target ? "Obiettivo" : "Confronto "+c.comparisonYear)+": "+euro(base))}</title></polyline>` : ""}</svg>
            <div class="gauge-value" title="${esc(euro(actual))}"><span class="gauge-period">CONSUNTIVO ${c.year}</span>${esc(compact(actual))}<small>€</small></div>
            <span class="gauge-min">0 €</span><span class="gauge-max">${esc(compact(max))} €</span>
          </div>
          <div class="goal-summary"><div class="goal-detail-line"><span>Obiettivo</span><strong>${target ? esc(euro(target.value)) : "Nessun obiettivo impostato"}</strong></div>
            <div class="goal-detail-line"><span>Confronto ${c.comparisonYear}</span><span class="goal-reference-value">${esc(euro(c.reference[metric]))}</span></div>
            <div class="goal-outcome"><span class="goal-outcome-label ${result ? result.reached ? "is-reached" : "is-pending" : ""}">${esc(status)}</span>${progress ? `<span class="goal-progress">${esc(progress)}</span>` : ""}</div>
          </div></article>`;
    }
    function render(c:GoalsContext) {
        context=c;
        const components=mixCategories(c),isCosts=mixMode==="costs",mixLabel=isCosts ? "Costi" : "Ricavi";
        if (selectedCategory && !components.some(v=>v.name===selectedCategory)) selectedCategory=null;
        $("costMixTitle").textContent=`Composizione dei ${mixLabel.toLowerCase()}`;
        $("toggleGoalMix").textContent=isCosts ? "Mostra ricavi" : "Mostra costi";
        $("toggleGoalMix").setAttribute("aria-pressed",String(!isCosts));
        $("costMixChart").setAttribute("aria-label",`Composizione dei ${mixLabel.toLowerCase()} per categoria`);
        $("costMixLegend").setAttribute("aria-label",`Categorie di ${isCosts ? "costo" : "ricavo"} e incidenze`);
        $("goalsScope").textContent=`Analisi ${scopeLabel(c)} · confronto ${c.comparisonYear}`;
        $("goalsNotice").textContent=notice || "Obiettivi personali salvati su questo PC";
        $("goalsNotice").classList.toggle("negative",!!notice);
        $("goalGauges").innerHTML=TARGET_METRICS.map(gauge).join("");
        const totalMix=components.reduce((sum,item)=>sum+Math.abs(item.value),0);
        const mixColors=components.map((_,i)=>i===0 ? accent() : palette[i%palette.length]);
        const style=getComputedStyle(document.body),ink=style.getPropertyValue("--ops-ink").trim(),muted=style.getPropertyValue("--ops-muted").trim();
        const tooltipStyle={backgroundColor:"#1b344b",padding:12,cornerRadius:7,displayColors:false,titleFont:{size:12,weight:600 as const},bodyFont:{size:12}};
        charts.get("mix")?.destroy();
        const mixNode=$("costMixChart") as HTMLCanvasElement;
        const compactMix=mixNode.parentElement!.clientHeight<160;
        const selectComponent=(i:number)=>{selectedCategory=selectedCategory===components[i].name ? null : components[i].name;($("goalRankingMode") as HTMLSelectElement).value=mixMode;render(context!);};
        $("costMixLegend").innerHTML=components.length ? `<div class="cost-legend-heading"><span>Componente</span><span>Importo / incidenza</span></div>${components.map((item,i)=>`<button class="cost-legend-item ${selectedCategory===item.name ? "is-selected" : ""}" data-component-index="${i}" aria-pressed="${selectedCategory===item.name}"><i style="background:${mixColors[i]}"></i><span class="cost-legend-name">${esc(item.name)}</span><span class="cost-legend-numbers"><strong>${esc(euro(Math.abs(item.value)))}</strong><small>${esc(percentage(Math.abs(item.value)/totalMix*100))}</small></span></button>`).join("")}` : `<p class="goal-empty-state">${isCosts ? "Nessun costo" : "Nessun ricavo"} nel periodo selezionato</p>`;
        const mix=new Chart(mixNode,{
            type:"doughnut",
            data:{labels:components.map(v=>v.name),datasets:[{data:components.map(v=>Math.abs(v.value)),backgroundColor:mixColors.map((color,i)=>selectedCategory && selectedCategory!==components[i].name ? color+"70" : color),borderWidth:compactMix ? 2 : 3,borderColor:"#fff",borderRadius:3,hoverOffset:compactMix ? 2 : 4,offset:components.map(v=>v.name===selectedCategory ? compactMix ? 2 : 6 : 0)}]},
            options:{responsive:true,maintainAspectRatio:false,animation:false,cutout:"74%",layout:{padding:compactMix ? 4 : 12},interaction:{intersect:true},plugins:{legend:{display:false},tooltip:{...tooltipStyle,intersect:true,callbacks:{label:ctx=>`${euro(Number(ctx.raw))} · ${percentage(Number(ctx.raw)/totalMix*100)}`}}},onClick:(_e,elements)=>{if(elements.length)selectComponent(elements[0].index);},onHover:(_e,elements)=>{mixNode.style.cursor=elements.length ? "pointer" : "default";}},
            plugins:[{id:"costMixCenter",afterDraw(chart){
                const {ctx,chartArea:area}=chart,x=(area.left+area.right)/2,y=(area.top+area.bottom)/2,diameter=Math.min(area.right-area.left,area.bottom-area.top);
                ctx.save();ctx.textAlign="center";ctx.textBaseline="middle";
                ctx.fillStyle=ink;ctx.font=`700 ${diameter<160 ? 14 : diameter<260 ? 19 : 25}px 'Segoe UI', sans-serif`;ctx.fillText(compact(totalMix)+" €",x,y-(diameter<100 ? 0 : 8),Math.max(30,diameter*.64));
                if(diameter>=100){ctx.fillStyle=muted;ctx.font="12px 'Segoe UI', sans-serif";ctx.fillText(`${mixLabel} ${c.year}`,x,y+(diameter<160 ? 11 : 17));}ctx.restore();
            }}],
        });
        charts.set("mix",mix);clearHover(mixNode,mix);
        const mode=($("goalRankingMode") as HTMLSelectElement).value,top=+($("goalRankingTop") as HTMLSelectElement).value;
        const eligible=c.groups.filter(g=>(mode==="costs" ? g.value<0 : g.value>0) && (!selectedCategory || g.category===selectedCategory));
        const groupTotal=eligible.reduce((sum,g)=>sum+Math.abs(g.value),0);
        const groups=eligible.sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,top);
        $("goalRankingTitle").textContent=selectedCategory || `Top ${top} gruppi · ${mode==="costs" ? "costi" : "ricavi"}`;
        $("clearGoalCategory").textContent=selectedCategory ? "Azzera filtro" : `Tutti i ${mixLabel.toLowerCase()}`;
        charts.get("ranking")?.destroy();
        const rankNode=$("goalRankingChart") as HTMLCanvasElement;
        $("goalRankingPlot").style.height=Math.max(80,rankNode.parentElement!.parentElement!.clientHeight-14,groups.length*34+36)+"px";
        const ranking=new Chart(rankNode,{
            type:"bar",data:{labels:groups.map(g=>g.name),datasets:[{label:String(c.year),data:groups.map(g=>Math.abs(g.value)),backgroundColor:groups.map((_,i)=>i===0 ? accent() : "#6d8fa8"),borderRadius:4,maxBarThickness:25,categoryPercentage:.75,barPercentage:.8}]},
            options:{indexAxis:"y",responsive:true,maintainAspectRatio:false,animation:false,layout:{padding:{right:106,top:6}},interaction:{intersect:true},plugins:{legend:{display:false},tooltip:{...tooltipStyle,intersect:true,callbacks:{label:ctx=>euro(Number(ctx.raw)),afterLabel:ctx=>`${percentage(Number(ctx.raw)/groupTotal*100)} dei gruppi selezionati`}}},scales:{x:{beginAtZero:true,border:{display:false},grid:{color:"#e8eef3",drawTicks:false},ticks:{font:{size:11},maxTicksLimit:4,padding:9,callback:v=>compact(Number(v))}},y:{border:{display:false},grid:{display:false},ticks:{font:{size:12},autoSkip:false,padding:8,callback:function(v){const s=this.getLabelForValue(Number(v));return s.length>30 ? s.slice(0,28)+"…" : s;}}}},onClick:(_e,elements)=>{if(elements.length)openGroup(groups[elements[0].index].name);},onHover:(_e,elements)=>{rankNode.style.cursor=elements.length ? "pointer" : "default";}},
            plugins:[{id:"rankingValues",beforeDatasetsDraw(chart){
                const {ctx,chartArea:area}=chart;ctx.save();ctx.fillStyle="#f0f4f7";
                chart.getDatasetMeta(0).data.forEach(bar=>{const p=bar.getProps(["y","height"],true);ctx.fillRect(area.left,p.y-p.height/2,area.right-area.left,p.height);});ctx.restore();
            },afterDatasetsDraw(chart){
                const {ctx,chartArea:area}=chart;ctx.save();ctx.fillStyle=ink;ctx.font="600 12px 'Segoe UI', sans-serif";ctx.textBaseline="middle";ctx.textAlign="left";
                chart.getDatasetMeta(0).data.forEach((bar,i)=>{const p=bar.getProps(["x","y"],true);ctx.fillText(compact(Math.abs(groups[i].value))+" €",p.x+9,p.y);});
                if(!groups.length){ctx.textAlign="center";ctx.fillStyle=muted;ctx.fillText("Nessun gruppo per i filtri selezionati",(area.left+area.right)/2,(area.top+area.bottom)/2);}
                ctx.restore();
            }}],
        });
        charts.set("ranking",ranking);clearHover(rankNode,ranking);
    }
    $("goalGauges").addEventListener("click",event=>{
        const button=(event.target as HTMLElement).closest<HTMLElement>("[data-edit-goal]");
        if (!button || !context) return;
        const metric=button.dataset.editGoal as TargetMetric;
        editing={year:context.year,from:context.from,to:context.to,metric};reference=context.reference[metric];
        const goal=targets[targetKey(editing)];
        $("goalDialogTitle").textContent=`Obiettivo · ${metric}`;$("goalDialogScope").textContent=scopeLabel(editing);
        input.value=goal ? String(goal.value) : "";input.min=metric==="Margine 3" ? "0" : "0.01";
        $("goalFormError").textContent="";($("deleteGoal") as HTMLButtonElement).disabled=!goal;
        ($("useGoalComparison") as HTMLButtonElement).disabled=reference<0 || reference===0 && metric!=="Margine 3";
        $("useGoalComparison").textContent=`Usa confronto ${context.comparisonYear}: ${euro(reference)}`;
        dialog.showModal();input.focus();
    });
    async function save(value:number|null) {
        if (!editing || saving) return;
        saving=true;["saveGoal","deleteGoal","cancelGoal","useGoalComparison"].forEach(id=>($(id) as HTMLButtonElement).disabled=true);
        try {
            const response=await ipcRenderer.invoke("management-targets-save",{...editing,value});
            if(!response.ok)throw new Error(response.error);
            targets=response.targets;notice="";dialog.close();if(context)render(context);
        }catch(error){$("goalFormError").textContent=error instanceof Error ? error.message : String(error);}
        finally{
            saving=false;["saveGoal","cancelGoal"].forEach(id=>($(id) as HTMLButtonElement).disabled=false);
            ($("deleteGoal") as HTMLButtonElement).disabled=!editing || !targets[targetKey(editing)];
            ($("useGoalComparison") as HTMLButtonElement).disabled=reference<0 || reference===0 && editing?.metric!=="Margine 3";
        }
    }
    $("goalForm").addEventListener("submit",event=>{event.preventDefault();if(input.checkValidity())void save(Number(input.value));});
    $("deleteGoal").addEventListener("click",()=>save(null));
    $("cancelGoal").addEventListener("click",()=>dialog.close());
    dialog.addEventListener("cancel",event=>{if(saving)event.preventDefault();});
    $("useGoalComparison").addEventListener("click",()=>{input.value=String(reference);});
    $("goalRankingMode").addEventListener("change",()=>{selectedCategory=null;if(context)render(context);});
    $("toggleGoalMix").addEventListener("click",()=>{
        mixMode=mixMode==="costs" ? "revenue" : "costs";
        selectedCategory=null;
        ($("goalRankingMode") as HTMLSelectElement).value=mixMode;
        if(context)render(context);
    });
    $("costMixLegend").addEventListener("click",event=>{
        const button=(event.target as HTMLElement).closest<HTMLElement>("[data-component-index]");
        if(!button || !context)return;
        const components=mixCategories(context),index=Number(button.dataset.componentIndex);
        selectedCategory=selectedCategory===components[index].name ? null : components[index].name;
        ($("goalRankingMode") as HTMLSelectElement).value=mixMode;render(context);
    });
    $("goalRankingTop").addEventListener("change",()=>{if(context)render(context);});
    $("clearGoalCategory").addEventListener("click",()=>{selectedCategory=null;if(context)render(context);});
    return {render,async load(){try{const response=await ipcRenderer.invoke("management-targets-load");if(!response.ok)throw new Error(response.error);targets=response.targets;}catch(error){notice=error instanceof Error ? error.message : String(error);}},
        exportRows(contexts:GoalsContext[]){return contexts.flatMap(c=>TARGET_METRICS.flatMap(metric=>{const goal=targets[targetKey({...c,metric})];if(!goal)return [];const r=targetResult(c.actual[metric],goal.value,metric);return [[c.year,c.from,c.to,metric,goal.value,c.actual[metric],r.gap,r.reached ? "Raggiunto" : "Da raggiungere"]];}));},
        destroy(){charts.forEach(c=>c.destroy());charts.clear();dialog.close();}
    };
}
