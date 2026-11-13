import * as XLSX from 'xlsx';
import type {WorkbookTables,WorkbookTable,WorkbookCell} from '../../main/modules/turning-analysis/workbook-table';
import {SortCriterion,sortByCriteria} from '../../main/modules/analysis-sorting';
import {bindSortingHeaders,updateSortingBar} from './table-sorting';
import {numeric} from '../../main/modules/turning-analysis/model';

const ipc=require('electron').ipcRenderer;
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
type Rule={field:string;op:string;value:string;to:string};
type State={search:string;columns:Record<string,string>;rules:Rule[];sort:SortCriterion[];visible:string[];limit:number};
const empty=():State=>({search:'',columns:{},rules:[],sort:[],visible:[],limit:250});
let data:WorkbookTables|null=null,pending:Promise<any>|null=null,host:HTMLElement|null=null,sheetName='COMPLETO',generation=0;
const states=new Map<string,State>();
const state=()=>{if(!states.has(sheetName))states.set(sheetName,{...empty(),visible:sheet().columns.filter(c=>!c.defaultHidden).map(c=>c.key)});return states.get(sheetName)!;};
const sheet=()=>data!.sheets.find(s=>s.name===sheetName)!;
const folded=(v:unknown)=>String(v??'').toLocaleLowerCase('it');
function ruleMatches(row:WorkbookTable['rows'][number],r:Rule) {
    const index=sheet().columns.findIndex(c=>c.key===r.field),cell=row.cells[index];
    const raw=cell?.value,a=folded(cell?.display),b=folded(r.value);
    const compare=(value:string)=>{
        if(typeof raw!=='number')return folded(raw).localeCompare(folded(value),'it',{numeric:true});
        if(cell.format&&XLSX.SSF.is_date(cell.format)&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
            const date=XLSX.SSF.parse_date_code(raw),key=date?`${date.y}-${String(date.m).padStart(2,'0')}-${String(date.d).padStart(2,'0')}`:'';
            return key.localeCompare(value);
        }
        const target=numeric(value);return target===null?NaN:raw-target;
    };
    if(r.op==='empty')return raw===null||raw==='';
    if(r.op==='exact')return a===b||folded(raw)===b||typeof raw==='number'&&compare(r.value)===0;
    if(r.op==='not')return !a.includes(b);
    if(r.op==='prefix')return a.startsWith(b);
    if(r.op==='range')return raw!=null&&(!r.value||compare(r.value)>=0)&&(!r.to||compare(r.to)<=0);
    if(r.op==='gte')return raw!=null&&compare(r.value)>=0;
    if(r.op==='lte')return raw!=null&&compare(r.value)<=0;
    return a.includes(b)||folded(raw).includes(b);
}
function rows() {
    const s=state(),source=sheet();
    const grouped=new Map<string,Rule[]>();
    for(const r of s.rules)if(r.op==='empty'||r.value||r.to)grouped.set(r.field,[...(grouped.get(r.field)||[]),r]);
    const filtered=source.rows.filter(row=>(!s.search||row.cells.some(c=>folded(c.display).includes(folded(s.search))))
        &&source.columns.every((c,i)=>!s.columns[c.key]||folded(row.cells[i]?.display).includes(folded(s.columns[c.key]))||folded(row.cells[i]?.value).includes(folded(s.columns[c.key])))
        &&[...grouped.values()].every(rules=>rules.some(r=>ruleMatches(row,r))));
    return sortByCriteria(filtered,s.sort,(r,key)=>key==='sourceRow'?r.number:r.cells[source.columns.findIndex(c=>c.key===key)]?.value);
}
function drawRows() {
    if(!host)return;
    const s=state(),source=sheet(),found=rows(),visible=source.columns.map((c,i)=>({...c,index:i})).filter(c=>!s.visible.length||s.visible.includes(c.key));
    host.querySelector('tbody')!.innerHTML=found.slice(0,s.limit).map(row=>`<tr>${visible.map(c=>{const cell=row.cells[c.index],context=source.name.trim().toUpperCase()==='COMPLETO'&&c.key==='C'?`data-analysis-article="${esc(cell?.value)}"`:source.name.trim().toUpperCase()==='COMPLETO'&&c.key==='A'?`data-analysis-customer-name="${esc(cell?.value)}"`:'';return `<td ${context} class="${typeof cell?.value==='number'?'numeric':''}" title="${esc(cell?.formula?'='+cell.formula:cell?.display)}">${esc(cell?.display)}</td>`;}).join('')}</tr>`).join('')||`<tr><td colspan="${visible.length}">Nessuna riga trovata.</td></tr>`;
    host.querySelector('#workbookCount')!.textContent=`${Math.min(s.limit,found.length).toLocaleString('it')} di ${found.length.toLocaleString('it')} righe`;
    (host.querySelector('#workbookMore') as HTMLButtonElement).hidden=s.limit>=found.length;
}
function drawRules() {
    host!.querySelector('#workbookRules')!.innerHTML=state().rules.map((r,i)=>`<div class="workbook-rule" data-rule="${i}"><select data-field aria-label="Colonna">${sheet().columns.map(c=>`<option value="${c.key}" ${r.field===c.key?'selected':''}>${esc(c.label)}</option>`).join('')}</select><select data-op aria-label="Confronto">${[['contains','Contiene'],['exact','Uguale a'],['prefix','Inizia con'],['not','Non contiene'],['range','Da / a'],['gte','Maggiore o uguale'],['lte','Minore o uguale'],['empty','Mancante']].map(([k,v])=>`<option value="${k}" ${r.op===k?'selected':''}>${v}</option>`).join('')}</select><input data-value aria-label="Valore" value="${esc(r.value)}" ${r.op==='empty'?'hidden':''}><input data-to aria-label="Valore finale" value="${esc(r.to)}" ${r.op!=='range'?'hidden':''}><button data-remove="${i}" aria-label="Rimuovi condizione">×</button></div>`).join('');
}
function readRules() {
    state().rules=[...host!.querySelectorAll<HTMLElement>('[data-rule]')].map(row=>({field:row.querySelector<HTMLSelectElement>('[data-field]')!.value,op:row.querySelector<HTMLSelectElement>('[data-op]')!.value,value:row.querySelector<HTMLInputElement>('[data-value]')!.value,to:row.querySelector<HTMLInputElement>('[data-to]')!.value}));
}
function render() {
    if(!host||!data)return;
    const s=state(),source=sheet(),visible=source.columns.filter(c=>!s.visible.length||s.visible.includes(c.key));
    host.innerHTML=`<article class="panel workbook-panel"><div class="panel-head workbook-tools"><h2>Vista Excel</h2><label>Cerca nel foglio<input id="workbookSearch" type="search" value="${esc(s.search)}"></label><details data-filter-popover><summary>Filtri avanzati${s.rules.length?' · '+s.rules.length:''}</summary><div class="workbook-filter-popup"><div id="workbookRules"></div><div class="workbook-actions"><button id="workbookAddRule">+ Condizione</button><button id="workbookApply" class="primary">Applica filtri</button></div></div></details><details data-filter-popover><summary>Colonne</summary><div class="columns-popup workbook-column-picker">${source.columns.map(c=>`<label><input type="checkbox" data-visible="${c.key}" ${visible.some(v=>v.key===c.key)?'checked':''}>${esc(c.label)}</label>`).join('')}</div></details><button id="workbookReset">Ripristina filtri</button></div><div class="table-scroll" tabindex="0"><table id="workbookTable"><thead><tr>${visible.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr><tr class="workbook-column-search">${visible.map(c=>`<td><input type="search" data-column-search="${c.key}" value="${esc(s.columns[c.key])}" aria-label="Filtra ${esc(c.label)}" placeholder="Filtra…"></td>`).join('')}</tr></thead><tbody></tbody></table></div><div class="table-footer"><span id="workbookCount"></span><button id="workbookMore">Carica altre righe</button></div></article>`;
    const table=host.querySelector<HTMLTableElement>('#workbookTable')!,columns=visible;
    const change=(next:SortCriterion[])=>{s.sort=next;render();};
    bindSortingHeaders(table,columns,s.sort,change);updateSortingBar(table,columns,s.sort,change);
    drawRules();drawRows();
    host.querySelector('#workbookSearch')!.addEventListener('input',e=>{s.search=(e.target as HTMLInputElement).value;s.limit=250;drawRows();});
    host.querySelectorAll<HTMLInputElement>('[data-column-search]').forEach(input=>input.oninput=()=>{s.columns[input.dataset.columnSearch!]=input.value;s.limit=250;drawRows();});
    host.querySelectorAll<HTMLInputElement>('[data-visible]').forEach(input=>input.onchange=()=>{const chosen=[...host!.querySelectorAll<HTMLInputElement>('[data-visible]:checked')].map(i=>i.dataset.visible!);if(!chosen.length){input.checked=true;return;}s.visible=chosen;render();});
    host.querySelector('#workbookAddRule')!.addEventListener('click',()=>{readRules();if(s.rules.length>=30)return;s.rules.push({field:source.columns[0].key,op:'contains',value:'',to:''});drawRules();});
    host.querySelector('#workbookApply')!.addEventListener('click',()=>{readRules();s.limit=250;drawRows();});
    host.querySelector('#workbookRules')!.addEventListener('change',e=>{if((e.target as HTMLElement).matches('[data-op]')){readRules();drawRules();}});
    host.querySelector('#workbookRules')!.addEventListener('click',e=>{const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-remove]');if(button){readRules();s.rules.splice(Number(button.dataset.remove),1);drawRules();drawRows();}});
    host.querySelector('#workbookReset')!.addEventListener('click',()=>{states.set(sheetName,{...empty(),visible:s.visible});render();});
    host.querySelector('#workbookMore')!.addEventListener('click',()=>{s.limit+=250;drawRows();});
}
export async function showTurningWorkbook(node:HTMLElement) {
    host=node;
    if(data){render();return;}
    node.innerHTML='<article class="panel workbook-loading" role="status">Lettura dei fogli Excel…</article>';
    const version=generation;
    if(!pending)pending=ipc.invoke('turning-analysis-workbook-load');
    const operation=pending;
    try{
        const result=await operation;
        if(version!==generation)return;
        if(!result.ok)throw Error(result.error);
        data=result.data;
        if(!data?.sheets.length)throw Error('Il file non contiene fogli.');
        if(!data.sheets.some(s=>s.name===sheetName))sheetName=data.sheets[0].name;
        if(host===node&&node.isConnected&&document.body.dataset.view==='workbook')render();
    }catch(error){if(node.isConnected&&document.body.dataset.view==='workbook'){node.innerHTML=`<article class="panel workbook-loading"><p role="alert">${esc((error as Error).message)}</p><button id="workbookRetry">Riprova</button></article>`;node.querySelector('button')!.onclick=()=>void showTurningWorkbook(node);}}
    finally{if(pending===operation)pending=null;}
}
export function resetTurningWorkbook(){data=null;pending=null;generation++;}
export async function exportTurningWorkbook() {
    if(!data)throw Error('Attendere la lettura del file Excel.');
    const source=sheet(),s=state(),columns=source.columns.map((c,i)=>({...c,index:i})).filter(c=>!s.visible.length||s.visible.includes(c.key));
    const cell=(c:WorkbookCell)=>({v:c.value??'',t:typeof c.value==='number'?'n':typeof c.value==='boolean'?'b':'s',z:c.format});
    const book=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([columns.map(c=>c.label),...rows().map(r=>columns.map(c=>cell(r.cells[c.index])))]);
    ws['!autofilter']={ref:ws['!ref']||'A1'};ws['!cols']=columns.map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,ws,source.name.slice(0,31));
    const result=await ipc.invoke('turning-analysis-export',XLSX.write(book,{type:'buffer',bookType:'xlsx'}));if(!result.ok)throw Error(result.error);
    return result;
}
