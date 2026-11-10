import Chart from "chart.js/auto";
import * as XLSX from "xlsx";
import { ManagementData, Movement, CATEGORIES, margins, matches } from "../../main/modules/management/model";
import { createManagementGoals, GoalsContext } from "../modules/management-goals";
import {SortCriterion,SortValue,sortByCriteria,sortHierarchy} from '../../main/modules/analysis-sorting';
import {bindSortingHeaders,updateSortingBar} from '../modules/table-sorting';

const { ipcRenderer } = require("electron");
const $ = (id: string) => document.getElementById(id)!;
const select = (id: string) => $(id) as HTMLSelectElement;
const check = (id: string) => ($(id) as HTMLInputElement).checked;
const independent = () => select("comparisonMode").value === "custom";
const months = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const euro = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
const number = (n: number) => new Intl.NumberFormat("it-IT").format(n);
const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (n: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(n) + "%";
const delta = (value: number, base: number) => Math.abs(base) < 1e-9 ? "n.d." : pct((value - base) / Math.abs(base) * 100);
const themeStyle = getComputedStyle(document.body);
const colors = [themeStyle.getPropertyValue("--ops-accent").trim(), "#45556b"];
Chart.defaults.font.family = themeStyle.fontFamily;
Chart.defaults.color = themeStyle.getPropertyValue("--ops-muted").trim();
let data: ManagementData | null = null;
let category: string | null = null;
let view = "overview", busy = false;
const expanded = new Set<string>();
const expandedGroups = new Set<string>();
const expandedAccounts = new Set<string>();
const expandedMovementYears = new Set<string>();
type MovementItem = Movement & { share: number; allocatedValue: number };
type MovementState = { items: MovementItem[]; total: number; loading: boolean; error: string; offset: number };
const movementStates = new Map<string, MovementState>();
let movementContext = "";
const charts = new Map<string, Chart>();
const extraYears = new Set<number>();
const titles = { overview: "Overview economica", goals:"Obiettivi e KPI", statement: "Conto economico", trends: "Andamento e anni", details: "Dettaglio conti", quality: "Origine e verifiche" };
const goals = createManagementGoals(group => {
    const item=data!.groups.find(g=>g.name===group)!;
    select("detailCategory").value=item.category;updateDetailGroups(group);setView("details");
});
type Report = { groups: Record<string, number>; categories: Record<string, number>; metrics: Record<string, number>; revenue: number; costs: number; total: number };
function options(id: string, values: { value: string | number; text: string }[], value?: string | number) {
    const node = select(id); node.replaceChildren();
    values.forEach(v => { const opt = document.createElement("option"); opt.value = String(v.value); opt.textContent = v.text; node.appendChild(opt); });
    if (value !== undefined) node.value = String(value);
}
function range(comparison = false) {
    const custom = comparison && independent();
    return { year: +select(comparison ? "compare" : "year").value,
        from: +select(custom ? "compareFrom" : "from").value,
        to: +select(custom ? "compareTo" : "to").value };
}
function selectedRanges() {
    const primary = range(), comparison = range(true);
    const ranges = new Map<number, ReturnType<typeof range>>();
    for (const year of extraYears) if (data!.years.includes(year)) ranges.set(year, { ...comparison, year });
    ranges.set(comparison.year, comparison);
    ranges.set(primary.year, primary);
    return [...ranges.values()].sort((a,b) => a.year - b.year);
}
function selectedReports() { return selectedRanges().map(r => report(r.year,r.from,r.to)); }
function seriesColor(index: number, total: number) {
    return index === total - 1 ? colors[0] : ["#53687f", "#22958b", "#8a68be", "#ce8640", "#c66383"][index] || `hsl(${index * 137.5 % 360}, 52%, 43%)`;
}
function updateYearChoices() {
    if (!data) return;
    const fixed = new Set([range().year, range(true).year]);
    const additional = [...extraYears].filter(y => !fixed.has(y)).length;
    $("extraYearCount").textContent = additional ? `+${additional}` : "";
    $("yearChoices").replaceChildren();
    for (const year of data.years) {
        const label = document.createElement("label"), input = document.createElement("input");
        input.type = "checkbox"; input.value = String(year); input.checked = fixed.has(year) || extraYears.has(year); input.disabled = fixed.has(year);
        input.onchange = () => { input.checked ? extraYears.add(year) : extraYears.delete(year); render(); };
        label.append(input, String(year)); $("yearChoices").appendChild(label);
    }
}
function report(year: number, from: number, to: number): Report {
    const groups = Object.create(null), categories = Object.create(null);
    for (const p of data!.points) if (p.year === year && p.month >= from && p.month <= to) groups[p.group] = (groups[p.group] || 0) + p.value;
    for (const g of data!.groups) categories[g.category] = (categories[g.category] || 0) + (groups[g.name] || 0);
    const values = Object.values(categories) as number[];
    return { groups, categories, metrics: margins(categories), revenue: values.filter(v => v > 0).reduce((s,v) => s+v,0),
        costs: -values.filter(v => v < 0).reduce((s,v) => s+v,0), total: values.reduce((s,v) => s+v,0) };
}
function reports() { const a = range(), b = range(true); return [report(a.year,a.from,a.to),report(b.year,b.from,b.to)]; }
type Cell = string | number | { text: string; change: number | null;sort?:number|null };
type TableRow = { cells: Cell[]; sortValues?:SortValue[];cls?: string; toggle?: string; toggleKind?: string; open?: boolean; title?: string; subline?: string };
const tableSorting=new Map<string,SortCriterion[]>();
const deltaCell = (value: number, base: number, percent = false): Cell => ({ text: percent ? delta(value,base) : euro(value-base), change: percent && Math.abs(base) < 1e-9 ? null : value-base,sort:percent?(Math.abs(base)<1e-9?null:(value-base)/Math.abs(base)*100):value-base });
const sortColumns=(headers:string[])=>headers.map((label,i)=>({key:i===0?'label':label==='Δ %'?`percent:${headers[i+1]}`:label,label,...label==='Δ %'?{summaryLabel:`${headers[i-1]} %`}:{}}));
function cellSortValue(cell:Cell):SortValue {
    if(typeof cell==='number')return cell;
    if(typeof cell==='object')return cell.sort??(cell.change===null?null:cell.change);
    if(['n.d.','—',''].includes(cell))return null;
    const date=cell.match(/^(\d{2})\/(\d{2})\/(\d{4})/);if(date)return `${date[3]}-${date[2]}-${date[1]}`;
    if(/^-?[\d.,\s\u00a0]+[€%]?$/.test(cell))return Number(cell.replace(/[\s\u00a0€%]/g,'').replace(/\./g,'').replace(',','.'));
    return cell;
}
function sortedTableRows<T extends TableRow>(id:string,headers:string[],rows:readonly T[]):T[]{
    const criteria=tableSorting.get(id)||[],columns=sortColumns(headers);
    const value=(row:T,key:string):SortValue=>{const index=columns.findIndex(c=>c.key===key);return index<0?null:row.sortValues?row.sortValues[index]:cellSortValue(row.cells[index]);};
    return id==='statementTable'?sortHierarchy(rows,criteria,{value,depth:row=>row.cls==='group-row'?1:row.cls==='account-row'?2:row.cls==='account-year-row'?3:row.cls?.includes('movement-')?4:0,pinned:row=>row.cls==='subtotal'||!!row.cls?.includes('movement-note')}):sortByCriteria(rows,criteria,value);
}
function sortedRecords<T>(id:string,headers:string[],records:readonly T[],values:(item:T)=>SortValue[],cls?:(item:T)=>string){
    return sortedTableRows(id,headers,records.map(record=>({record,cells:[] as Cell[],sortValues:values(record),cls:cls?.(record)}))).map(row=>row.record);
}
function changeTableSorting(id:string,next:SortCriterion[]){
    tableSorting.set(id,next);
    if(id==='statementTable'){
        movementStates.clear();statement();
        for(const key of expandedMovementYears){const [group,code,year]=JSON.parse(key);void loadAccountMovements(group,code,year);}
    }else if(id==='historyTable')trends();else details();
}
function table(id: string, headers: string[], rows: TableRow[]) {
    const node = $(id) as HTMLTableElement;
    rows=sortedTableRows(id,headers,rows);
    node.style.minWidth = `${Math.max(750, 360 + (headers.length - 1) * 145)}px`;
    node.innerHTML = `<thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr class="${r.cls || ""}">${r.cells.map((cell, i) => {
        const text = typeof cell === "object" ? cell.text : cell;
        const change = typeof cell === "object" ? cell.change : null;
        const cls = change !== null && Math.abs(change) > 1e-8 ? change > 0 ? "delta-positive" : "delta-negative" : "";
        const open = r.open ?? expanded.has(r.toggle);
        return `<td class="${cls}" title="${escape(i === 0 && r.title ? r.title : text)}">${i === 0 && r.toggle ? `<button class="row-toggle" data-${r.toggleKind || "category"}="${escape(r.toggle)}" aria-expanded="${open}">${open ? "▾" : "▸"} ${escape(text)}</button>` : escape(text)}${i === 0 && r.subline ? `<small class="movement-subline">${escape(r.subline)}</small>` : ""}</td>`;
    }).join("")}</tr>`).join("")}</tbody>`;
    bindSortingHeaders(node,sortColumns(headers),tableSorting.get(id)||[],next=>changeTableSorting(id,next));
    updateSortingBar(node,sortColumns(headers),tableSorting.get(id)||[],next=>changeTableSorting(id,next),id==='statementTable'?'Ordina separatamente i livelli della gerarchia; margini e totali mantengono la loro posizione.':'');
}
function comparisonHeaders() {
    return selectedRanges().flatMap((r,i,all) => i ? [`Δ ${all[i-1].year} → ${r.year}`, "Δ %", String(r.year)] : [String(r.year)]);
}
function comparisonCells(values: number[]): Cell[] {
    return values.flatMap((value,i): Cell[] => i ? [deltaCell(value,values[i-1]),deltaCell(value,values[i-1],true),euro(value)] : [euro(value)]);
}
function comparisonSortValues(values:number[]):SortValue[]{return values.flatMap((value,i):SortValue[]=>i?[value-values[i-1],Math.abs(values[i-1])<1e-9?null:(value-values[i-1])/Math.abs(values[i-1])*100,value]:[value]);}
function chart(id: string, type: "bar" | "line", labels: string[], datasets: any[], horizontal = false, click?: (i: number) => void) {
    charts.get(id)?.destroy();
    const node = $(id) as HTMLCanvasElement;
    const instance = new Chart(node, { type, data: { labels, datasets }, options: {
        responsive: true, maintainAspectRatio: false, animation: false, indexAxis: horizontal ? "y" : "x",
        interaction: { mode: "index", intersect: true },
        hover: { mode: "nearest", intersect: true },
        plugins: { legend: { position: "top", align: "end", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 12 } } },
            tooltip: { mode: "index", intersect: true, callbacks: { label: (ctx) => `${ctx.dataset.label}: ${euro(Number(horizontal ? ctx.parsed.x : ctx.parsed.y))}` } } },
        scales: { x: { grid: { display: horizontal }, ticks: { font: { size: 12 }, callback: function(value) { return horizontal ? compact(Number(value)) : shortLabel(this.getLabelForValue(Number(value))); } } },
            y: { beginAtZero: true, grid: { display: !horizontal, color: "#edf1f7" }, ticks: { autoSkip: !horizontal, font: { size: horizontal && node.parentElement!.clientHeight < 250 ? 11 : 12 }, callback: function(value) { return horizontal ? shortLabel(this.getLabelForValue(Number(value))) : compact(Number(value)); } } } },
        onClick: (event, elements, current) => {
            const area = current.chartArea;
            if (event.x >= area.left && event.x <= area.right && event.y >= area.top && event.y <= area.bottom && click && elements.length) click(elements[0].index);
        },
        onHover: (_event,elements) => { node.style.cursor = click && elements.length ? "pointer" : "default"; },
    } });
    node.onmouseleave = () => {
        instance.setActiveElements([]); instance.tooltip?.setActiveElements([],{x:0,y:0});
        node.style.cursor = "default"; instance.update("none");
    };
    charts.set(id, instance);
}
function compact(v: number) { return Math.abs(v) >= 1e6 ? number(Math.round(v/1e4)/100) + " M" : Math.abs(v) >= 1e3 ? number(Math.round(v/100)/10) + " k" : number(v); }
function shortLabel(s: string) { return s.length > 28 ? s.slice(0,26) + "…" : s; }
function series(reports: Report[], keys: string[], kind: "categories" | "groups") {
    return reports.map((r,i) => ({ label: String(selectedRanges()[i].year), data: keys.map(k => r[kind][k] || 0), backgroundColor: seriesColor(i,reports.length), borderRadius: 3 }));
}
function overview() {
    const [a,b] = reports();
    const cards = [ ["Ricavi gestionali", a.revenue, b.revenue], ["Costi gestionali", a.costs,b.costs], ["Margine finale · M3",a.metrics["Margine 3"],b.metrics["Margine 3"]], ["Margine / ricavi produzione",a.metrics["Margine 3"],b.metrics["Margine 3"]] ];
    $("kpis").innerHTML = cards.map(([title,v,base],i) => `<article class="kpi"><small>${title} · ${range().year}</small><strong class="${i === 2 ? Number(v) >= 0 ? "positive" : "negative" : ""}">${i === 3 ? a.categories[CATEGORIES[0]] ? pct(Number(v) / a.categories[CATEGORIES[0]] * 100) : "n.d." : euro(Number(v))}</strong><p class="${i === 3 || Number(v) === Number(base) ? "" : Number(v) > Number(base) ? "delta-positive" : "delta-negative"}">${i === 3 ? "Rapporto M3 / ricavi di produzione" : `Δ ${euro(Number(v)-Number(base))} · ${delta(Number(v),Number(base))}`}</p><p>${i === 3 ? "Perimetro gestionale completo" : `rispetto al ${range(true).year}`}</p></article>`).join("");
    const all = selectedReports();
    chart("categoryChart", "bar", data!.categories, series(all,data!.categories,"categories"), true, i => { category = category === data!.categories[i] ? null : data!.categories[i]; overview(); });
    const groups = data!.groups.filter(g => !category || g.category === category).map(g => g.name)
        .sort((x,y) => Math.max(...all.map(r => Math.abs(r.groups[y]||0)))-Math.max(...all.map(r => Math.abs(r.groups[x]||0)))).slice(0,12);
    $("groupTitle").textContent = category || "Componenti di risultato · primi 12 gruppi";
    chart("groupChart", "bar", groups, series(all,groups,"groups"), true, i => { select("detailCategory").value = data!.groups.find(g => g.name === groups[i])!.category; updateDetailGroups(groups[i]); setView("details"); });
    $("marginBridge").innerHTML = Object.entries(a.metrics).map(([name,value]) => `<div><small>${escape(name)}</small><strong class="${value >= 0 ? "positive" : "negative"}">${euro(value)}</strong></div>`).join("");
}
function statementRows() {
    const all = selectedReports(), rows: { name: string; values: number[]; type: string }[] = [];
    for (const cat of data!.categories) {
        rows.push({ name:cat,values:all.map(r => r.categories[cat]||0),type:"category" });
        if (expanded.has(cat)) for (const g of data!.groups.filter(g => g.category === cat)) rows.push({ name:g.name,values:all.map(r => r.groups[g.name]||0),type:"group" });
        const metric = marginAfter(cat);
        if (metric) rows.push({ name:metric,values:all.map(r => r.metrics[metric]),type:"subtotal" });
    }
    rows.push({ name:"Margine 3",values:all.map(r => r.metrics["Margine 3"]),type:"subtotal" });
    return rows;
}
function marginAfter(category: string) {
    return category === CATEGORIES[3] ? "Margine 1" : category === CATEGORIES[5] ? "Margine 2" : category === CATEGORIES[8] ? "Totale Algeria" : null;
}
function metricOrder() {
    return [...data!.categories.flatMap(c => marginAfter(c) ? [c,marginAfter(c)!] : [c]),"Margine 3","Ricavi gestionali","Costi gestionali"];
}
function accountKey(group: string, code: string) { return JSON.stringify([group,code]); }
function movementYearKey(group: string, code: string, year: number) { return JSON.stringify([group,code,year]); }
function groupAccounts(group: string) {
    const ranges = selectedRanges(), rules = data!.rules.filter(r => r.group === group);
    const codes = new Map<string,{code:string;values:number[];share:number}>();
    const shares = new Map<string,number>();
    for (const p of data!.accounts) {
        const i = ranges.findIndex(r => r.year === p.year && p.month >= r.from && p.month <= r.to);
        if (i < 0) continue;
        if (!shares.has(p.code)) shares.set(p.code,rules.filter(r => matches(p.code,r.code)).reduce((s,r) => s+r.share,0));
        if (!rules.some(r => matches(p.code,r.code))) continue;
        if (!codes.has(p.code)) codes.set(p.code,{code:p.code,values:ranges.map(() => 0),share:shares.get(p.code)!});
        codes.get(p.code)!.values[i] -= p.value*shares.get(p.code)!;
    }
    return [...codes.values()].sort((a,b) => a.code.localeCompare(b.code));
}
async function loadAccountMovements(group: string, code: string, year: number) {
    const key = movementYearKey(group,code,year);
    let state = movementStates.get(key);
    if (!state) { state = {items:[],total:0,loading:false,error:"",offset:0}; movementStates.set(key,state); }
    if (state.loading || state.items.length && state.offset >= state.total) return;
    state.loading = true; state.error = "";
    if (view === "statement") statement();
    try {
        const sort=(tableSorting.get('statementTable')||[]).flatMap(item=>item.key==='label'?[{key:'date',direction:item.direction}]:item.key===String(year)?[{key:'value',direction:item.direction}]:[]);
        const response = await ipcRenderer.invoke("management-movements",{snapshot:data!.loadedAt,group,code,ranges:selectedRanges().filter(r => r.year === year),offset:state.offset,limit:200,sort});
        if (movementStates.get(key) !== state) return;
        if (!response.ok) throw new Error(response.error);
        state.items.push(...response.items); state.total=response.total; state.offset=response.nextOffset;
    } catch(error) { if (movementStates.get(key) === state) state.error = error instanceof Error ? error.message : String(error); }
    finally { if (movementStates.get(key) === state) { state.loading=false; if (view === "statement") statement(); } }
}
function accountMovementRows(group: string, code: string, year: number): TableRow[] {
    const key = movementYearKey(group,code,year), state = movementStates.get(key), ranges=selectedRanges();
    const blank = () => comparisonHeaders().map(() => "");
    const rows: TableRow[] = (state?.items || []).map(m => ({
        cls:"movement-row",
        sortValues:[m.competenceDate,...ranges.flatMap((r,i):SortValue[]=>[...i?[null,null]:[],r.year===m.year?m.allocatedValue:null])],
        cells:[`${m.competenceDate.split("-").reverse().join("/")} · ${m.journalEntryId ? "Reg. "+m.journalEntryId+" / " : ""}Riga ${m.rowId} · ${m.description}`,...ranges.flatMap((r,i) => [...i ? ["",""] : [],r.year===m.year ? euro(m.allocatedValue) : "—"])],
        title:`Conto ${m.code} · Riga Excel ${m.sourceRow}\nCompetenza ${m.competenceDate} · Registrazione ${m.registrationDate || "n.d."}\nDare ${m.debit===null ? "n.d." : euro(m.debit)} · Avere ${m.credit===null ? "n.d." : euro(m.credit)}\nValore contabile ${euro(m.value)} · Quota ${pct(m.share*100)} · Gestionale ${euro(m.allocatedValue)}\nTipo ${m.typeCode} · Cliente/fornitore ${m.customerSupplier || "n.d."}`,
        subline:`Contabile ${euro(m.value)} · Quota ${pct(m.share*100)}${m.debit===null ? "" : ` · Dare ${euro(m.debit)}`}${m.credit===null ? "" : ` · Avere ${euro(m.credit)}`} · Reg. ${m.registrationDate || "n.d."}`,
    }));
    if (!state || state.loading) rows.push({cls:"movement-note",cells:["Caricamento movimenti…",...blank()]});
    else if (state.error) rows.push({cls:"movement-note",cells:[`Riprova · ${state.error}`,...blank()],toggle:key,toggleKind:"more"});
    else if (state.offset < state.total) rows.push({cls:"movement-note load-more-movements",cells:[`Carica altri movimenti · ${state.items.length} di ${state.total}`,...blank()],toggle:key,toggleKind:"more"});
    else rows.push({cls:"movement-note",cells:[`${state.total} ${state.total === 1 ? "movimento" : "movimenti"} · Totale ${year}`,...ranges.flatMap((r,i) => [...i ? ["",""] : [],r.year === year ? euro(state.items.reduce((s,m) => s+m.allocatedValue,0)) : "—"])]});
    return rows;
}
function statement() {
    const rows: TableRow[] = [];
    for (const r of statementRows()) {
        rows.push({cells:[r.name,...comparisonCells(r.values)],sortValues:[r.name,...comparisonSortValues(r.values)],cls:r.type === "subtotal" ? "subtotal" : r.type === "group" ? "group-row" : "",
            toggle:r.type === "subtotal" ? undefined : r.name,toggleKind:r.type === "group" ? "group" : "category",open:r.type === "group" ? expandedGroups.has(r.name) : expanded.has(r.name)});
        if (r.type !== "group" || !expandedGroups.has(r.name)) continue;
        for (const account of groupAccounts(r.name)) {
            const key = accountKey(r.name,account.code);
            rows.push({cls:"account-row",cells:[`${account.code} · ${data!.descriptions[account.code] || ""} · ${pct(account.share*100)}`,...comparisonCells(account.values)],sortValues:[account.code,...comparisonSortValues(account.values)],toggle:key,toggleKind:"account",open:expandedAccounts.has(key)});
            if (expandedAccounts.has(key)) for (const [i,period] of selectedRanges().entries()) {
                const yearKey = movementYearKey(r.name,account.code,period.year);
                rows.push({cls:"account-year-row",cells:[`${period.year} · ${months[period.from-1]}–${months[period.to-1]}`,...selectedRanges().flatMap((r,j) => [...j ? ["",""] : [],r.year === period.year ? euro(account.values[i]) : "—"])],sortValues:[period.year,...selectedRanges().flatMap((r,j):SortValue[]=>[...j?[null,null]:[],r.year===period.year?account.values[i]:null])],toggle:yearKey,toggleKind:"movement-year",open:expandedMovementYears.has(yearKey)});
                if (expandedMovementYears.has(yearKey)) rows.push(...accountMovementRows(r.name,account.code,period.year));
            }
        }
    }
    table("statementTable", ["Categoria / gruppo / conto / anno / movimento",...comparisonHeaders()],rows);
}
function metric(r: Report, key: string) { return key === "Ricavi gestionali" ? r.revenue : key === "Costi gestionali" ? r.costs : r.metrics[key] ?? r.categories[key] ?? 0; }
function goalsContext(period=range()): GoalsContext {
    const r=report(period.year,period.from,period.to), compare=range(true), b=report(compare.year,compare.from,compare.to);
    return {...period,comparisonYear:compare.year,
        actual:{"Ricavi di Produzione":r.categories[CATEGORIES[0]]||0,"Margine 3":r.metrics["Margine 3"],"Costi gestionali":r.costs},
        reference:{"Ricavi di Produzione":b.categories[CATEGORIES[0]]||0,"Margine 3":b.metrics["Margine 3"],"Costi gestionali":b.costs},
        categories:data!.categories.map(name=>({name,value:r.categories[name]||0})),
        groups:data!.groups.map(g=>({...g,value:r.groups[g.name]||0})),
    };
}
function historyRows() { const a = range(); return data!.years.map(year => ({ year, r:report(year,a.from,a.to), months:data!.periods[year].filter(m => m >= a.from && m <= a.to).length })); }
function historyHeaders(){return ['Esercizio','Mesi con dati / richiesti','Ricavi gestionali','Costi gestionali','Margine 1','Margine 2','Margine 3','Δ M3 €','Δ M3 %'];}
function historySortValues(history:ReturnType<typeof historyRows>,i:number):SortValue[]{
    const h=history[i],value=h.r.metrics['Margine 3'],previous=i&&history[i-1].months?history[i-1].r.metrics['Margine 3']:null;
    return [h.year,h.months,...[h.r.revenue,h.r.costs,h.r.metrics['Margine 1'],h.r.metrics['Margine 2'],value].map(v=>h.months?v:null),h.months&&previous!==null?value-previous:null,h.months&&previous!==null&&Math.abs(previous)>1e-9?(value-previous)/Math.abs(previous)*100:null];
}
function detailHeaders(){return ['Conto / descrizione','Gruppo','Regola','Quota',...selectedRanges().flatMap((r,i,all)=>[...i?[`Δ ${all[i-1].year} → ${r.year}`]:[],`Saldo ${r.year}`,`Gestionale ${r.year}`])];}
function detailSortValues(r:ReturnType<typeof detailRows>[number]):SortValue[]{return [`${r.code} · ${r.description}`,r.group,r.prefix,r.share*100,...r.values.flatMap((value,i)=>[...i?[value-r.values[i-1]]:[],r.balances[i],value])];}
function trends() {
    const key = select("metric").value, a = range();
    const ranges = selectedRanges();
    const visibleMonths = [...new Set(ranges.flatMap(r => Array.from({length:r.to-r.from+1},(_,i) => r.from+i)))].sort((a,b) => a-b);
    const sets = ranges.map((r,i) => {
        let sum = 0;
        return { label:String(r.year),borderColor:seriesColor(i,ranges.length),backgroundColor:seriesColor(i,ranges.length),pointRadius:3,tension:.2,spanGaps:false,
            data:visibleMonths.map(m => {
                if (m < r.from || m > r.to || !data!.periods[r.year].includes(m)) return null;
                const value = metric(report(r.year,m,m),key); sum += value;
                return check("cumulative") ? sum : value;
            }) };
    });
    chart("monthlyChart","line",visibleMonths.map(m => months[m-1].slice(0,3)),sets);
    const history = historyRows();
    chart("historyChart","bar",history.map(h => String(h.year)),[{ label:key,data:history.map(h => h.months ? metric(h.r,key) : null),backgroundColor:history.map(h => h.year === a.year ? colors[0] : "#aec6e4"),borderRadius:4 }]);
    table("historyTable",["Esercizio","Mesi con dati / richiesti","Ricavi gestionali","Costi gestionali","Margine 1","Margine 2","Margine 3","Δ M3 €","Δ M3 %"],history.map((h,i) => ({sortValues:historySortValues(history,i),cells:[h.year,`${h.months} / ${a.to-a.from+1}`,...[h.r.revenue,h.r.costs,h.r.metrics["Margine 1"],h.r.metrics["Margine 2"],h.r.metrics["Margine 3"]].map(v => h.months ? euro(v) : "n.d."),...i && h.months && history[i-1].months ? [deltaCell(h.r.metrics["Margine 3"],history[i-1].r.metrics["Margine 3"]),deltaCell(h.r.metrics["Margine 3"],history[i-1].r.metrics["Margine 3"],true)] : ["n.d.","n.d."]]})));
}
function updateDetailGroups(value = "") {
    const cat = select("detailCategory").value;
    options("detailGroup",[{value:"",text:"Tutti i gruppi"},...data!.groups.filter(g => !cat || g.category === cat).map(g => ({value:g.name,text:g.name}))],value);
}
function detailRows() {
    const cat = select("detailCategory").value, group = select("detailGroup").value, search = ($( "search") as HTMLInputElement).value.toLocaleLowerCase("it-IT").trim();
    const ranges = selectedRanges(), primaryIndex = ranges.findIndex(r => r.year === range().year);
    const totals = ranges.map(r => {
        const map = new Map<string,number>();
        for (const p of data!.accounts) if (p.year === r.year && p.month >= r.from && p.month <= r.to) map.set(p.code,(map.get(p.code)||0)+p.value);
        return map;
    });
    const rows: { code:string; description:string; group:string; category:string; prefix:string; share:number; balances:number[]; values:number[]; value:number }[] = [];
    for (const rule of data!.rules) {
        const category = data!.groups.find(g => g.name === rule.group)!.category;
        if (cat && cat !== category || group && group !== rule.group) continue;
        for (const code of new Set(totals.flatMap(map => [...map.keys()]))) {
            if (!matches(code,rule.code)) continue;
            const description = data!.descriptions[code] || "";
            if (search && !`${code} ${description}`.toLocaleLowerCase("it-IT").includes(search)) continue;
            const balances = totals.map(map => map.get(code)||0), values = balances.map(v => -v*rule.share);
            rows.push({code,description,group:rule.group,category,prefix:rule.code,share:rule.share,balances,values,value:values[primaryIndex]});
        }
    }
    return rows.sort((a,b) => a.code.localeCompare(b.code));
}
function details() {
    const rows = detailRows();
    $("detailSummary").textContent = `${number(rows.length)} ripartizioni · Totale gestionale selezionato ${euro(rows.reduce((s,r) => s+r.value,0))} · Il saldo contabile può ripetersi tra regole; sommare i valori ripartiti.`;
    const ranges = selectedRanges();
    table("detailTable",["Conto / descrizione","Gruppo","Regola","Quota",...ranges.flatMap((r,i) => [...i ? [`Δ ${ranges[i-1].year} → ${r.year}`] : [],`Saldo ${r.year}`,`Gestionale ${r.year}`])],rows.map(r => ({sortValues:detailSortValues(r),cells:[`${r.code} · ${r.description}`,r.group,r.prefix,pct(r.share*100),...r.values.flatMap((value,i):Cell[] => [...i ? [deltaCell(value,r.values[i-1])] : [],euro(r.balances[i]),euro(value)])]})));
}
function quality() {
    const q = data!.quality;
    const values: [string,string][] = [["Origine dati",data!.source],["Ultima modifica parametri Excel",new Date(data!.modifiedAt).toLocaleString("it-IT")],["Ultima lettura riuscita",new Date(data!.loadedAt).toLocaleString("it-IT")],["Movimenti originali",number(q.total)],["Movimenti inclusi",number(q.included)],["Scritture di chiusura escluse",number(q.closing)],["Date non valide escluse",number(q.invalidDates)],["Regole di ripartizione",number(data!.rules.length)],["Gruppi / categorie",`${data!.groups.length} / ${data!.categories.length}`],["Conti senza regola",`${number(q.unmatchedAccounts)} · saldo contabile complessivo ${euro(q.unmatchedValue)}`],["Conti ripartiti oltre il 100%",number(q.overlappingAccounts)],...data!.years.map(y => [`Copertura ${y}`,data!.periods[y].map(m => months[m-1].slice(0,3)).join(" · ")] as [string,string])];
    if(data!.sourceKind==="sql")values.unshift(["Sorgente","SQL Server tramite backend"],["Query eseguita",new Date(data!.queriedAt!).toLocaleString("it-IT")],["File parametri",data!.parameterSource || ""]);
    const baseCount = values.length - data!.years.length;
    const core = values.slice(0, baseCount);
    $("qualityInfo").innerHTML = `<dl>${core.map(([key,value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join("")}</dl><details><summary>Copertura mensile dei ${data!.years.length} esercizi</summary><div class="coverage-grid">${values.slice(baseCount).map(([key,value]) => `<p><b>${escape(key)}</b><br>${escape(value)}</p>`).join("")}</div></details>`;
}
function render() {
    if (!data) return;
    const context = JSON.stringify([data.loadedAt,selectedRanges()]);
    if (context !== movementContext) { movementContext=context; expandedAccounts.clear(); expandedMovementYears.clear(); movementStates.clear(); }
    const a = range(), b = range(true);
    updateYearChoices();
    $("samePeriodNote").textContent = `${months[a.from-1].slice(0,3)} → ${months[a.to-1].slice(0,3)}`;
    $("samePeriodNote").hidden = independent();
    document.querySelectorAll<HTMLElement>(".comparison-period").forEach(el => el.hidden = !independent());
    const coverage = (r: ReturnType<typeof range>) => data!.periods[r.year].filter(m => m >= r.from && m <= r.to).length;
    $("sourceFooter").textContent = selectedRanges().map(r => `${r.year}: ${months[r.from-1]}–${months[r.to-1]} (${coverage(r)}/${r.to-r.from+1} mesi con dati)`).join(" · ") + ` · ${data.sourceKind==="sql" ? "SQL letto "+new Date(data.queriedAt!).toLocaleString("it-IT") : "Istantanea Excel "+new Date(data.modifiedAt).toLocaleString("it-IT")}`;
    $("sourceFooter").title = $("sourceFooter").textContent;
    if (view === "overview") overview(); else if (view === "goals") goals.render(goalsContext()); else if (view === "statement") statement(); else if (view === "trends") trends(); else if (view === "details") details(); else quality();
}
function setView(next: string) {
    view = next;
    document.querySelectorAll<HTMLElement>(".view").forEach(el => el.hidden = el.id !== view);
    document.querySelectorAll<HTMLElement>("nav button").forEach(el => el.classList.toggle("active",el.dataset.view === view));
    $("viewTitle").textContent = titles[view]; render();
}
function resetFilters() {
    extraYears.clear();
    expandedGroups.clear(); expandedAccounts.clear(); expandedMovementYears.clear(); movementStates.clear();
    select("year").value = String(data!.years.at(-1)); select("compare").value = String(data!.years.at(-2) || data!.years.at(-1));
    select("from").value = "1"; select("to").value = String(Math.max(...data!.periods[range().year]));
    select("compareFrom").value = "1"; select("compareTo").value = select("to").value;
    select("comparisonMode").value = "same";
    document.querySelectorAll<HTMLElement>(".comparison-period").forEach(el => el.hidden=true);
    category=null; expanded.clear(); select("detailCategory").value=""; updateDetailGroups(); ($( "search") as HTMLInputElement).value="";
}
async function load(refresh = false) {
    if (busy) return;
    busy=true; ($( "refresh") as HTMLButtonElement).disabled=true; ($( "export") as HTMLButtonElement).disabled=true; select("dataSource").disabled=true;
    $("status").className="";
    const sqlMode=select("dataSource").value==="sql";
    $("status").textContent=sqlMode ? "Lettura SQL tramite backend e applicazione dei parametri Excel…" : "Lettura dell’istantanea Excel da DL360…";
    try {
        const response = await ipcRenderer.invoke("management-load", {refresh,mode:select("dataSource").value});
        if (!response.ok) throw new Error(response.error);
        const first = !data;
        const previous = first ? null : ["year","compare","from","to","compareFrom","compareTo"].map(id => select(id).value);
        data=response.data;
        for (const year of extraYears) if (!data!.years.includes(year)) extraYears.delete(year);
        const years=data!.years.map(y => ({value:y,text:String(y)})); options("year",years); options("compare",years);
        if (first) {
            for (const id of ["from","to","compareFrom","compareTo"]) options(id,months.map((m,i) => ({value:i+1,text:m})));
        }
        const indicators = metricOrder(), previousIndicator = select("metric").value;
        options("metric",indicators.map(k => ({value:k,text:k})),indicators.includes(previousIndicator) ? previousIndicator : "Margine 3");
        const oldCategory = select("detailCategory").value, oldGroup=select("detailGroup").value;
        options("detailCategory",[{value:"",text:"Tutte le categorie"},...data!.categories.map(c => ({value:c,text:c}))],oldCategory);
        updateDetailGroups(oldGroup);
        if (first || !previous!.slice(0,2).every(y => data!.years.includes(+y))) resetFilters();
        else ["year","compare","from","to","compareFrom","compareTo"].forEach((id,i) => select(id).value=previous![i]);
        if(first)await goals.load();
        $("content").hidden=false;
        const q=data!.quality;
        const warnings=[q.invalidDates ? `${q.invalidDates} date non valide escluse` : "", q.overlappingAccounts ? `${q.overlappingAccounts} conti ripartiti oltre il 100%: verificare le regole` : ""].filter(Boolean);
        $("status").className=warnings.length ? "warning" : "";
        $("status").title=`${data!.sourceKind==="sql" ? "SQL" : "Excel"} - ${number(q.included)} movimenti elaborati · ${number(q.closing)} chiusure escluse · ${data!.years[0]}–${data!.years.at(-1)} · Ultima lettura ${new Date(data!.loadedAt).toLocaleString("it-IT")}${warnings.length ? " · "+warnings.join(" · ") : ""}`;
        $("status").textContent = warnings.length ? warnings.join(" · ") : `${data!.sourceKind==="sql" ? "SQL" : "Excel"} - ${number(q.included)} movimenti · Lettura ${new Date(data!.loadedAt).toLocaleTimeString("it-IT")}`;
        render();
    } catch(error) {
        $("status").className="error";
        $("status").textContent=`${sqlMode ? "Impossibile leggere i dati SQL dal backend" : "Impossibile leggere il file Excel"}. ${error instanceof Error ? error.message : String(error)}.${data ? " Sono ancora visualizzati i dati dell’ultima lettura riuscita del "+new Date(data.loadedAt).toLocaleString("it-IT")+"." : " Verifica la connessione e premi Aggiorna dati."}`;
    } finally { busy=false; ($( "refresh") as HTMLButtonElement).disabled=false; ($( "export") as HTMLButtonElement).disabled=!data; select("dataSource").disabled=false; }
}
async function exportWorkbook() {
    if (!data) return;
    const book=XLSX.utils.book_new(), a=range(), b=range(true);
    const add = (name:string,rows:any[][]) => {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = rows[0].map((_,i) => ({wch: i===0 ? 55 : 22}));
        rows[0].forEach((header,i) => {
            if (!String(header).startsWith("Δ")) return;
            for (let row=1;row<rows.length;row++) {
                const cell = ws[XLSX.utils.encode_cell({r:row,c:i})];
                if (cell?.t === "n") cell.z = String(header).includes("%") ? '[Green]0.0"%";[Red]-0.0"%";0.0"%"' : '[Green]#,##0.00;[Red]-#,##0.00;0.00';
            }
        });
        XLSX.utils.book_append_sheet(book,ws,name);
    };
    // Esporta sempre tutti i gruppi, indipendentemente dall’espansione della matrice.
    const prior = new Set(expanded); data.categories.forEach(c => expanded.add(c)); const rows=statementRows(); expanded.clear(); prior.forEach(c => expanded.add(c));
    const ranges = selectedRanges();
    add("Conto economico",[["Voce","Livello",...comparisonHeaders()],...sortedRecords('statementTable',['Voce',...comparisonHeaders()],rows,r=>[r.name,...comparisonSortValues(r.values)],r=>r.type==='subtotal'?'subtotal':r.type==='group'?'group-row':'').map(r => [r.name,r.type,...r.values.flatMap((v,i) => i ? [v-r.values[i-1],Math.abs(r.values[i-1])<1e-9 ? null : (v-r.values[i-1])/Math.abs(r.values[i-1])*100,v] : [v])])]);
    const history = historyRows();
    add("Storico",[["Anno","Dal mese","Al mese","Mesi presenti","Ricavi","Costi","Margine 1","Margine 2","Margine 3","Δ M3 €","Δ M3 %"],...sortedRecords('historyTable',historyHeaders(),history,h=>historySortValues(history,history.indexOf(h))).map(h => {
        const i=history.indexOf(h);
        const previous = i && history[i-1].months ? history[i-1].r.metrics["Margine 3"] : null;
        const value = h.r.metrics["Margine 3"];
        return [h.year,a.from,a.to,h.months,...[h.r.revenue,h.r.costs,h.r.metrics["Margine 1"],h.r.metrics["Margine 2"],value].map(v => h.months ? v : null),h.months && previous!==null ? value-previous : null,h.months && previous!==null && Math.abs(previous)>1e-9 ? (value-previous)/Math.abs(previous)*100 : null];
    })]);
    add("Dettaglio filtrato",[["Conto","Descrizione","Categoria","Gruppo","Regola","Percentuale",...ranges.flatMap((r,i) => [...i ? [`Δ ${ranges[i-1].year} → ${r.year}`] : [],`Saldo ${r.year}`,`Gestionale ${r.year}`])],...sortedRecords('detailTable',detailHeaders(),detailRows(),detailSortValues).map(r => [r.code,r.description,r.category,r.group,r.prefix,r.share,...r.values.flatMap((v,i) => [...i ? [v-r.values[i-1]] : [],r.balances[i],v])])]);
    add("Origine",[["Sorgente",data.source],["Tipo sorgente",data.sourceKind || "excel"],["Lettura SQL",data.queriedAt || ""],["Parametri Excel",data.parameterSource || data.source],["Modifica parametri",data.modifiedAt],["Lettura riuscita",data.loadedAt],["Esportazione",new Date().toISOString()],["Principale",a.year,a.from,a.to],["Confronto",b.year,b.from,b.to],...ranges.map(r => ["Periodo selezionato",r.year,r.from,r.to]),["Filtro categoria dettaglio",select("detailCategory").value],["Filtro gruppo dettaglio",select("detailGroup").value],["Ricerca conto",($( "search") as HTMLInputElement).value],...Object.entries(data.quality)]);
    const objectiveRows=goals.exportRows(ranges.map(r=>goalsContext(r)));
    if(objectiveRows.length)add("Obiettivi",[["Anno","Dal mese","Al mese","Indicatore","Obiettivo €","Consuntivo €","Δ favorevole €","Stato"],...objectiveRows]);
    try {
        const result = await ipcRenderer.invoke("management-save", XLSX.write(book,{type:"buffer",bookType:"xlsx"}));
        if (!result.ok) throw new Error(result.error);
    } catch(error) { $("status").className="error"; $("status").textContent=`Esportazione non riuscita: ${error instanceof Error ? error.message : String(error)}`; }
}
document.querySelectorAll<HTMLElement>("nav button").forEach(el => el.addEventListener("click",() => setView(el.dataset.view!)));
for (const id of ["year","compare","from","to","compareFrom","compareTo","metric","cumulative"]) $(id).addEventListener("change",() => {
    const comparison=id.startsWith("compare") && id !== "compare";
    const from=select(comparison ? "compareFrom" : "from"), to=select(comparison ? "compareTo" : "to");
    if (+from.value > +to.value) { if (id.endsWith("From") || id === "from") to.value=from.value; else from.value=to.value; }
    render();
});
$("comparisonMode").addEventListener("change", () => {
    if (independent()) {
        select("compareFrom").value = select("from").value;
        select("compareTo").value = select("to").value;
    }
    render();
});
$("lastFourYears").addEventListener("click", () => {
    if (!data) return;
    extraYears.clear();
    data.years.filter(y => y <= range().year).slice(-4).forEach(y => extraYears.add(y));
    render();
});
document.addEventListener("click", event => {
    const picker = $("additionalYears") as HTMLDetailsElement;
    if (!picker.contains(event.target as Node)) picker.open = false;
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape") ($( "additionalYears") as HTMLDetailsElement).open = false;
});
let resizeTimer: ReturnType<typeof setTimeout>;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 100); });
$("detailCategory").addEventListener("change",() => { if (!data) return; updateDetailGroups(); details(); });
$("detailGroup").addEventListener("change",() => { if (data) details(); });
$("search").addEventListener("input",() => { if (data) details(); });
$("clearCategory").addEventListener("click",() => { category=null; render(); });
$("statementTable").addEventListener("click",event => {
    const button=(event.target as HTMLElement).closest<HTMLElement>("[data-category],[data-group],[data-account],[data-movement-year],[data-more]");
    if (!button) return;
    if (button.dataset.category !== undefined) {
        const key=button.dataset.category; expanded.has(key) ? expanded.delete(key) : expanded.add(key); statement();
    } else if (button.dataset.group !== undefined) {
        const key=button.dataset.group; expandedGroups.has(key) ? expandedGroups.delete(key) : expandedGroups.add(key); statement();
    } else {
        const key=button.dataset.account ?? button.dataset.movementYear ?? button.dataset.more;
        const [group,code,year]=JSON.parse(key);
        if (button.dataset.more !== undefined) { void loadAccountMovements(group,code,year); return; }
        if (button.dataset.movementYear !== undefined) {
            if (expandedMovementYears.has(key)) { expandedMovementYears.delete(key); statement(); }
            else {
                expandedMovementYears.add(key);
                if (movementStates.has(key)) statement(); else void loadAccountMovements(group,code,year);
            }
            return;
        }
        if (expandedAccounts.has(key)) { expandedAccounts.delete(key); statement(); }
        else {
            expandedAccounts.add(key);
            statement();
        }
    }
});
$("statementTable").parentElement!.addEventListener("scroll", () => {
    const container=$("statementTable").parentElement!, bounds=container.getBoundingClientRect();
    container.querySelectorAll<HTMLElement>(".load-more-movements [data-more]").forEach(button => {
        const rect=button.getBoundingClientRect();
        if (rect.top < bounds.bottom+80 && rect.bottom > bounds.top) {
            const [group,code,year]=JSON.parse(button.dataset.more!); void loadAccountMovements(group,code,year);
        }
    });
});
$("expandAll").addEventListener("click",() => { if (expanded.size) expanded.clear(); else data!.categories.forEach(c => expanded.add(c)); statement(); });
$("reset").addEventListener("click",() => { if (data) { resetFilters(); render(); } });
$("refresh").addEventListener("click",() => load(true));
$("dataSource").addEventListener("change",()=>load(true));
$("export").addEventListener("click",exportWorkbook);
$("close").addEventListener("click",() => window.close());
ipcRenderer.on("admin-state-changed",(_event,state) => { if (!state.management) { data=null; charts.forEach(c => c.destroy()); goals.destroy(); $("content").hidden=true; window.close(); } });
($( "export") as HTMLButtonElement).disabled=true;
void load();
