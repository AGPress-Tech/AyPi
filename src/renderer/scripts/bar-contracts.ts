import {continueTableOnScroll} from '../modules/table-scroll-loader';
import {bindSortingHeaders,updateSortingBar} from '../modules/table-sorting';
import {installAnalysisLinks} from '../modules/analysis-links';
import {contextFromAnalysisElement} from '../modules/document-links';
import type {AnalysisContext} from '../../main/modules/analysis-navigation-model';
import {COLUMNS,DEFAULT_COLUMNS,Row,Search,Preferences,emptySearch,summarize,filterRows,relatedOrders,orderPending,yes,validateSearch,validatePreferences} from '../../main/modules/bar-contracts/model';
const ipc=require('electron').ipcRenderer;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const num=(v:unknown,d=3)=>new Intl.NumberFormat('it-IT',{maximumFractionDigits:d}).format(Number(v));
let contracts:Row[]=[],orders:Row[]=[],rows:Row[]=[],filtered:Row[]=[],loaded=false,search=emptySearch(),queriedAt='';
let preferences:Preferences={version:1,columns:[...DEFAULT_COLUMNS],presets:[]};
const setStatus=(text='',error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
function fieldInput(col: (typeof COLUMNS)[number], rule: any) {
    const numeric = col.kind === "number",
        date = col.kind === "date",
        type = date ? "date" : numeric ? "number" : "text",
        op =
            rule.op ||
            (["date", "number"].includes(col.kind) ? "range" : "contains");
    const options =
        numeric || date
            ? [
                  ["range", "Da / a"],
                  ["exact", "Uguale a"],
              ]
            : [
                  ["contains", "Contiene"],
                  ["prefix", "Inizia con"],
                  ["exact", "Uguale a"],
                  ["range", "Da / a"],
              ];
    return `<select data-op aria-label="Confronto ${esc(col.label)}">${options.map(([v, label]) => `<option value="${v}" ${op === v ? "selected" : ""}>${label}</option>`).join("")}</select><div class="${op === "range" ? "range" : ""}"><input data-value type="${type}" ${numeric ? 'step="any"' : ""} value="${esc(rule.value)}" aria-label="${esc(col.label)}${op === "range" ? " da" : ""}"><input data-to type="${type}" ${numeric ? 'step="any"' : ""} value="${esc(rule.to)}" aria-label="${esc(col.label)} a" ${op !== "range" ? "hidden" : ""}></div>`;
}
function ruleHtml(col: (typeof COLUMNS)[number], rule: any) {
    return `<div class="rule"><div class="rule-fields">${fieldInput(col, rule)}</div><button type="button" class="remove-rule" aria-label="Rimuovi condizione ${esc(col.label)}">×</button></div>`;
}
function renderFilters(){
 $('filterGroups').innerHTML=COLUMNS.map((c,i)=>{const rules=search.rules.filter(r=>r.field===c.key);return `<details class="filter-group" data-field="${c.key}" ${i<2||rules.length?'open':''}><summary>${esc(c.label)}<span class="badge">${rules.length||'Facoltativo'}</span></summary><div class="rules">${(rules.length?rules:[{}]).map(r=>ruleHtml(c,r)).join('')}</div><button type="button" class="add-rule">+ Aggiungi alternativa</button></details>`;}).join('');
 $<HTMLSelectElement>('scope').value=search.scope;
}
function readSearch(){const rules:any[]=[];$('filterGroups').querySelectorAll<HTMLElement>('[data-field]').forEach(group=>group.querySelectorAll<HTMLElement>('.rule').forEach(rule=>{const value=rule.querySelector<HTMLInputElement>('[data-value]')!.value,to=rule.querySelector<HTMLInputElement>('[data-to]')?.value,op=rule.querySelector<HTMLSelectElement>('[data-op]')!.value;if(value||op==='range'&&to)rules.push({field:group.dataset.field,op,value,...(op==='range'&&to?{to}:{})});}));return validateSearch({...search,scope:$<HTMLSelectElement>('scope').value,rules});}
const format=(row:Row,c:{key:string;kind:string})=>{const v=row[c.key];return v==null||v===''?'—':c.kind==='number'?num(v,/price/i.test(c.key)?4:3):c.kind==='date'?String(v).slice(0,10).split('-').reverse().join('/'):String(v);};
function markup(data:Row[],columns:typeof COLUMNS){return data.map(row=>'<tr>'+columns.map(c=>`<td ${c.key==='item'&&row.item?`data-analysis-article="${esc(row.item)}"`:(['supplier','supplierCode'].includes(c.key)&&row.supplierCode?`data-analysis-supplier-code="${esc(row.supplierCode)}"`:'')} class="${c.kind==='number'?'numeric':''}" title="${esc(format(row,c))}">${c.key==='contract'?`<button class="bom-link" data-contract="${row.id}" data-line="${row.line}">${esc(format(row,c))}</button>`:esc(format(row,c))}</td>`).join('')+'</tr>').join('');}
function render(){
 $('resultsTitle').textContent='Contratti barra · '+({open:'Attivi / aperti',closed:'Chiusi',expired:'Scaduti',all:'Storico completo'}[search.scope]);
 rows=summarize(contracts,orders);filtered=filterRows(rows,search);const columns=COLUMNS.filter(c=>preferences.columns.includes(c.key)),table=$<HTMLTableElement>('results');
 table.tHead!.innerHTML='<tr>'+columns.map(c=>`<th class="${c.kind==='number'?'numeric':''}">${esc(c.label)}</th>`).join('')+'</tr>';table.tBodies[0].innerHTML=markup(filtered.slice(0,250),columns);
 const sort=(next:Search['sort'])=>{search={...search,sort:next};render();};bindSortingHeaders(table,columns,search.sort,sort);updateSortingBar(table,COLUMNS,search.sort,sort);
 table.hidden=!filtered.length;$('empty').hidden=!!filtered.length||!loaded;$<HTMLButtonElement>('export').disabled=!loaded||!filtered.length;
 $('contractCount').textContent=loaded?num(new Set(filtered.map(r=>r.id)).size,0):'—';
 for(const [key,id] of [['received','receivedCount'],['available','availableCount']]){const known=filtered.filter(r=>r[key]!=null);$(id).textContent=loaded?(known.length||!filtered.length?num(known.reduce((a,r)=>a+Number(r[key]),0))+(known.length<filtered.length?' *':''):'—'):'—';$(id).title=known.length<filtered.length?'Totale parziale: alcune righe hanno dati mancanti.':'';}
 continueTableOnScroll({table,total:filtered.length,initial:Math.min(250,filtered.length),append:(from,to)=>table.tBodies[0].insertAdjacentHTML('beforeend',markup(filtered.slice(from,to),columns)),progress:(n,total)=>{$('loaded').textContent=loaded?`${num(n,0)} di ${num(total,0)} righe contratto`:'';}});
 $('columnCount').textContent=String(columns.length);
 $('sourceInfo').textContent=queriedAt?'Lettura gestionale: '+new Date(queriedAt).toLocaleString('it-IT')+'.':'';
}
function renderColumns(){$('columnPicker').innerHTML=COLUMNS.map(c=>`<label><input type="checkbox" value="${c.key}" ${preferences.columns.includes(c.key)?'checked':''} ${['supplier','contract'].includes(c.key)?'disabled':''}>${esc(c.label)}</label>`).join('');}
function renderPresets(){$<HTMLSelectElement>('presets').innerHTML='<option value="">Scegli preset</option>'+preferences.presets.map((p,i)=>`<option value="${i}">${esc(p.name)}</option>`).join('');$<HTMLButtonElement>('deletePreset').disabled=true;}
async function savePreferences(){const r=await ipc.invoke('bar-contracts-preferences-save',preferences);if(!r.ok)throw Error(r.error);}
const report=(e:any)=>setStatus(e.message||String(e),true);
type Supplier={code:string;name:string;disabled:boolean};
let supplierDirectory:Supplier[]=[],selectedSuppliers:string[]=[],supplierBusy=false,supplierSaving=false;
const supplierStatus=(message='',error=false)=>{$('supplierSettingsStatus').textContent=message;$('supplierSettingsStatus').classList.toggle('error',error);};
function supplierChoices(){
 const term=$<HTMLInputElement>('supplierSearch').value.trim().toLocaleLowerCase('it');
 const matches=supplierDirectory.filter(s=>!selectedSuppliers.includes(s.code)&&`${s.name} ${s.code}`.toLocaleLowerCase('it').includes(term));
 $<HTMLSelectElement>('supplierChoice').innerHTML=matches.slice(0,100).map(s=>`<option value="${esc(s.code)}">${esc(s.name)} · ${esc(s.code)}${s.disabled?' (disabilitato)':''}</option>`).join('');
 $<HTMLButtonElement>('supplierAdd').disabled=supplierBusy||!matches.length;
 $('supplierMatches').textContent=matches.length>100?`${num(matches.length,0)} fornitori trovati: visualizzati i primi 100, affina la ricerca.`:matches.length?'':'Nessun fornitore trovato.';
}
function supplierSelection(){
 $('selectedSuppliers').innerHTML=selectedSuppliers.length?selectedSuppliers.map(code=>{const supplier=supplierDirectory.find(s=>s.code===code);return `<div class="selected-supplier"><span>${esc(supplier?.name||'Fornitore non più in anagrafica')} · ${esc(code)}${supplier?.disabled?' (disabilitato)':''}</span><button type="button" data-remove-supplier="${esc(code)}" aria-label="Rimuovi ${esc(supplier?.name||code)}">×</button></div>`;}).join(''):'<p>Nessun fornitore incluso: l’analisi resterà vuota.</p>';
 supplierChoices();
}
function supplierControls(busy:boolean){supplierBusy=busy;$<HTMLButtonElement>('suppliersSave').disabled=busy;for(const control of $('suppliersForm').querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('#supplierSearch,#supplierChoice,#supplierAdd,[data-remove-supplier]'))control.disabled=busy;supplierChoices();}
$('supplierSettings').onclick=async()=>{
 const button=$<HTMLButtonElement>('supplierSettings');button.disabled=true;supplierDirectory=[];selectedSuppliers=[];$<HTMLInputElement>('supplierSearch').value='';supplierSelection();supplierControls(true);supplierStatus('Lettura anagrafica fornitori…');$<HTMLDialogElement>('suppliersDialog').showModal();
 try{const result=await ipc.invoke('bar-contracts-suppliers-load');if(!result.ok)throw Error(result.error);supplierDirectory=result.suppliers;selectedSuppliers=result.selected;supplierSelection();supplierStatus();supplierControls(false);}catch(e){supplierStatus((e as Error).message,true);}finally{button.disabled=false;}
};
$('supplierSearch').oninput=supplierChoices;
$('supplierAdd').onclick=()=>{const code=$<HTMLSelectElement>('supplierChoice').value;if(!supplierBusy&&code&&!selectedSuppliers.includes(code)){if(selectedSuppliers.length>=200){supplierStatus('Sono disponibili al massimo 200 fornitori.',true);return;}selectedSuppliers.push(code);supplierSelection();supplierStatus();}};
$('selectedSuppliers').onclick=e=>{const button=(e.target as HTMLElement).closest<HTMLElement>('[data-remove-supplier]');if(button&&!supplierBusy){selectedSuppliers=selectedSuppliers.filter(code=>code!==button.dataset.removeSupplier);supplierSelection();}};
const closeSupplierSettings=()=>{if(!supplierSaving)$<HTMLDialogElement>('suppliersDialog').close();};
$('suppliersClose').onclick=closeSupplierSettings;$('suppliersCancel').onclick=closeSupplierSettings;
$('suppliersDialog').addEventListener('cancel',e=>{if(supplierSaving)e.preventDefault();});
$('suppliersForm').onsubmit=async e=>{
 e.preventDefault();if(supplierBusy)return;supplierSaving=true;supplierControls(true);supplierStatus('Salvataggio…');
 try{const result=await ipc.invoke('bar-contracts-suppliers-save',selectedSuppliers);if(!result.ok)throw Error(result.error);$<HTMLDialogElement>('suppliersDialog').close();contracts=[];orders=[];loaded=false;queriedAt='';render();await load();}catch(e){supplierStatus((e as Error).message,true);}finally{supplierSaving=false;supplierControls(false);}
};
$('filterGroups').addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b)return;const g=b.closest<HTMLElement>('[data-field]')!,col=COLUMNS.find(c=>c.key===g.dataset.field)!;if(b.classList.contains('add-rule'))g.querySelector('.rules')!.insertAdjacentHTML('beforeend',ruleHtml(col,{}));if(b.classList.contains('remove-rule')){const rule=b.closest('.rule')!;if(g.querySelectorAll('.rule').length>1)rule.remove();else rule.outerHTML=ruleHtml(col,{});}});
$('filterGroups').addEventListener('change',e=>{const el=e.target as HTMLSelectElement;if(!el.matches('[data-op]'))return;const rule=el.closest<HTMLElement>('.rule')!;rule.querySelector('[data-to]')?.toggleAttribute('hidden',el.value!=='range');rule.querySelector('[data-value]')?.parentElement?.classList.toggle('range',el.value==='range');});
$('searchForm').onsubmit=e=>{e.preventDefault();try{search=readSearch();setStatus();render();}catch(e){report(e);}};
$('scope').onchange=()=>{try{search=readSearch();setStatus();render();}catch(e){report(e);}};
$('reset').onclick=()=>{search=emptySearch();renderFilters();render();setStatus();};
$('columnPicker').onchange=()=>{preferences.columns=Array.from($('columnPicker').querySelectorAll<HTMLInputElement>('input:checked')).map(i=>i.value);render();void savePreferences().catch(report);};
$('presets').onchange=()=>{const select=$<HTMLSelectElement>('presets');$<HTMLButtonElement>('deletePreset').disabled=!select.value;if(!select.value)return;const p=preferences.presets[Number(select.value)];search=validateSearch(p.search);preferences.columns=[...p.columns];renderFilters();renderColumns();render();void savePreferences().catch(report);};
$('savePreset').onclick=()=>{try{readSearch();if(preferences.presets.length>=10)throw Error('Sono disponibili al massimo dieci preset.');$<HTMLInputElement>('presetName').value='';$<HTMLDialogElement>('presetDialog').showModal();}catch(e){report(e);}};
$('presetDialog').addEventListener('close',()=>{if($<HTMLDialogElement>('presetDialog').returnValue!=='save')return;try{const next=validatePreferences({...preferences,presets:[...preferences.presets,{name:$<HTMLInputElement>('presetName').value,search:readSearch(),columns:[...preferences.columns]}]});preferences=next;renderPresets();void savePreferences().catch(report);}catch(e){report(e);}});
$('deletePreset').onclick=()=>{const select=$<HTMLSelectElement>('presets');if(!select.value)return;preferences.presets.splice(Number(select.value),1);renderPresets();void savePreferences().catch(report);};
let opener:HTMLElement|null=null;
function openDetail(id:string,line:string){const row=rows.find(r=>String(r.id)===id&&String(r.line)===line);if(!row)return;opener=document.activeElement as HTMLElement;
 $('detailTitle').textContent=`${row.supplier} · ${row.contract}`;$('detailSubtitle').textContent=`Riga ${row.line} · ${row.description} · Ricevuti ${format(row,{key:'received',kind:'number'})} kg · Disponibili ${format(row,{key:'available',kind:'number'})} kg`;
 const cols:typeof COLUMNS=[{key:'document',label:'Ordine',kind:'text'},{key:'date',label:'Data',kind:'date'},{key:'item',label:'Articolo',kind:'text'},{key:'description',label:'Descrizione',kind:'text'},{key:'unit',label:'U.M.',kind:'text'},{key:'quantity',label:'Ordinati',kind:'number'},{key:'received',label:'Ricevuti',kind:'number'},{key:'pending',label:'In corso',kind:'number'},{key:'delivery',label:'Consegna prevista',kind:'date'},{key:'price',label:'Prezzo / U.M.',kind:'number'},{key:'currency',label:'Valuta',kind:'text'},{key:'state',label:'Stato',kind:'text'}];
 const linked=relatedOrders(row,orders).map(o=>({...o,pending:orderPending(o),state:yes(o.cancelled)||yes(o.lineCancelled)?'Annullato':yes(o.closed)||yes(o.lineClosed)?'Evaso':'Aperto'})),table=$<HTMLTableElement>('detailTable');
 table.tHead!.innerHTML='<tr>'+cols.map(c=>`<th>${esc(c.label)}</th>`).join('')+'</tr>';table.tBodies[0].innerHTML=markup(linked.slice(0,250),cols);continueTableOnScroll({table,total:linked.length,initial:Math.min(250,linked.length),append:(from,to)=>table.tBodies[0].insertAdjacentHTML('beforeend',markup(linked.slice(from,to),cols))});$('detailEmpty').hidden=!!linked.length;$<HTMLDialogElement>('contractDetail').showModal();
}
$('results').onclick=e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('[data-contract]');if(b)openDetail(b.dataset.contract!,b.dataset.line!);};
$('detailClose').onclick=()=>$<HTMLDialogElement>('contractDetail').close();$('contractDetail').addEventListener('close',()=>opener?.focus());
$('close').onclick=()=>ipc.send('bar-contracts-close');
async function load(){const button=$<HTMLButtonElement>('refresh');button.disabled=true;setStatus('Lettura contratti e ordini…');try{const r=await ipc.invoke('bar-contracts-load');if(!r.ok)throw Error(r.error);contracts=r.contracts;orders=r.orders;queriedAt=r.queriedAt;loaded=true;render();applyIncomingContext();setStatus();}catch(e){report(e);}finally{button.disabled=false;}}
$('refresh').onclick=()=>void load();
$('export').onclick=async()=>{const button=$<HTMLButtonElement>('export');button.disabled=true;try{const result=await ipc.invoke('bar-contracts-export',{search,columns:preferences.columns});if(!result.ok)throw Error(result.error);setStatus(result.canceled?'':`Esportate ${num(result.count,0)} righe contratto.`);}catch(e){report(e);}finally{button.disabled=!filtered.length;}};
let incomingContext:AnalysisContext|null=null;
function applyIncomingContext(){
 if(!loaded||!incomingContext)return;const context=incomingContext;incomingContext=null;
 search={...emptySearch(),scope:'all',rules:[...(context.article?[{field:'item',op:'exact' as const,value:context.article}]:[]),...(context.supplierCode?[{field:'supplierCode',op:'exact' as const,value:context.supplierCode}]:[])]};
 $<HTMLDialogElement>('contractDetail').close();renderFilters();render();
}
installAnalysisLinks(contextFromAnalysisElement,message=>setStatus(message,true));
ipc.on('analysis-open-context',(_event:any,context:AnalysisContext)=>{incomingContext=context;applyIncomingContext();});
ipc.send('analysis-context-ready');
void(async()=>{try{const r=await ipc.invoke('bar-contracts-preferences-load');if(!r.ok)throw Error(r.error);preferences=validatePreferences(r.preferences);}catch(e){report(e);}renderFilters();renderColumns();renderPresets();await load();})();
