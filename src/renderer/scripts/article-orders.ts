import {ARTICLE_ORDER_COLUMNS,DEFAULT_ARTICLE_ORDER_COLUMNS,ARTICLE_OFFER_COLUMNS,DEFAULT_ARTICLE_OFFER_COLUMNS,ArticleDocumentColumn} from '../../main/modules/article-orders/columns';
import {SortCriterion} from '../../main/modules/analysis-sorting';
import {bindSortingHeaders,updateSortingBar} from '../modules/table-sorting';
const ipc=require('electron').ipcRenderer;
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const IS_OFFERS=decodeURIComponent(location.pathname).endsWith('article-offers.html');
const CHANNEL=IS_OFFERS?'article-offers':'article-orders';
const COLUMNS:readonly ArticleDocumentColumn[]=IS_OFFERS?ARTICLE_OFFER_COLUMNS:ARTICLE_ORDER_COLUMNS;
const STORAGE_KEY=IS_OFFERS?'aypi.articleOffers.columns':'aypi.articleOrders.columns';
const ID_KEY=IS_OFFERS?'offerId':'orderId';
const INITIAL_EMPTY=$('empty').innerHTML;
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
const number=new Intl.NumberFormat('it-IT',{maximumFractionDigits:6});
const price=new Intl.NumberFormat('it-IT',{minimumFractionDigits:2,maximumFractionDigits:6});
const groups=[
    {key:'articles',label:'Articolo',type:'text',placeholder:'Es. 1272AOA77',op:'exact',required:true},
    {key:'customers',label:'Cliente',type:'text',placeholder:'Codice o ragione sociale',op:'contains'},
    {key:IS_OFFERS?'offerDates':'orderDates',label:IS_OFFERS?'Data offerta':'Data ordine',type:'date'},
    ...(!IS_OFFERS?[{key:'deliveryDates',label:'Consegna prevista',type:'date'}]:[]),
    {key:IS_OFFERS?'offers':'orders',label:IS_OFFERS?'Numero offerta':'Numero ordine',type:'text',placeholder:IS_OFFERS?'Es. 26/00622':'Es. 26/00913',op:'exact'},
    {key:'quantities',label:IS_OFFERS?'Quantità offerta':'Quantità ordinata',type:'number'},
    {key:'units',label:'Unità di misura',type:'text',placeholder:'Es. NR',op:'exact'},
    {key:'prices',label:IS_OFFERS?'Prezzo offerto':'Prezzo unitario',type:'number'},
    ...(!IS_OFFERS?[{key:'residuals',label:'Residuo da evadere',type:'number'}]:[]),
];
let rows:any[]=[],total=0,applied:any=null,loading=false,exporting=false,generation=0,lastRead='';
let sorting:SortCriterion[]=[];
let selected=new Set<string>(IS_OFFERS?DEFAULT_ARTICLE_OFFER_COLUMNS:DEFAULT_ARTICLE_ORDER_COLUMNS);
try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(Array.isArray(saved))selected=new Set(saved.filter(k=>COLUMNS.some(c=>c.key===k)));}catch{}
selected.add('article');
const setStatus=(text:string,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error)};
const markDirty=()=>{if(applied){$('export').setAttribute('disabled','');setStatus(`Filtri modificati: premi Cerca ${IS_OFFERS?'offerte':'ordini'} per aggiornare i risultati.`)}};
function addRule(group:typeof groups[number],container:HTMLElement){
    if(container.children.length>=20){setStatus('Puoi aggiungere al massimo 20 condizioni per filtro.',true);return}
    const row=document.createElement('div');row.className='rule';
    row.innerHTML=`<div class="rule-fields">${group.type==='text'?`<select class="operator" aria-label="Tipo ricerca ${group.label}"><option value="exact">Corrisponde a</option><option value="contains">Contiene</option><option value="prefix">Inizia con</option><option value="range">Intervallo di codici</option></select><input class="value" maxlength="128" aria-label="${group.label}" placeholder="${group.placeholder}"><input class="end" maxlength="128" aria-label="${group.label} fino al codice" placeholder="Fino al codice" hidden>`:`<div class="range"><label>Da<input class="from" type="${group.type}" ${group.type==='number'?'step="any"':'min="1900-01-01" max="9998-12-31"'} aria-label="${group.label} da"></label><label>A<input class="to" type="${group.type}" ${group.type==='number'?'step="any"':'min="1900-01-01" max="9998-12-31"'} aria-label="${group.label} a"></label></div>`}</div><button type="button" class="remove-rule" aria-label="Rimuovi condizione ${group.label}">×</button>`;
    const operator=row.querySelector<HTMLSelectElement>('.operator');
    if(operator){operator.value=group.op||'exact';operator.addEventListener('change',()=>{row.querySelector<HTMLElement>('.end')!.hidden=operator.value!=='range'})}
    row.querySelector('.remove-rule')!.addEventListener('click',()=>{
        if(container.children.length>1)row.remove();else row.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.value='');
        updateBadges();markDirty();
    });
    row.addEventListener('input',()=>{updateBadges();markDirty()});row.addEventListener('change',markDirty);
    container.appendChild(row);updateBadges();
}
function updateBadges(){
    document.querySelectorAll<HTMLElement>('.filter-group').forEach(group=>{
        const count=Array.from(group.querySelectorAll('.rule')).filter(row=>Array.from(row.querySelectorAll<HTMLInputElement>('input')).some(input=>input.value.trim())).length;
        group.querySelector('.badge')!.textContent=count?String(count):group.dataset.key==='articles'?'Richiesto':'Facoltativo';
    });
}
function initFilters(){
    $('filterGroups').replaceChildren();
    for(const group of groups){
        const details=document.createElement('details');details.className='filter-group';details.dataset.key=group.key;details.open=!!group.required;
        details.innerHTML=`<summary>${group.label}<span class="badge"></span></summary><div class="rules"></div><button class="add-rule" type="button">+ ${group.type==='text'?'Aggiungi alternativa':'Aggiungi intervallo'}</button>`;
        $('filterGroups').appendChild(details);
        const container=details.querySelector<HTMLElement>('.rules')!;addRule(group,container);
        details.querySelector('button.add-rule')!.addEventListener('click',()=>{addRule(group,container);container.lastElementChild?.querySelector('input')?.focus()});
    }
}
function collect(){
    const filters:any={};
    for(const group of groups){
        const container=document.querySelector(`[data-key="${group.key}"]`)!;
        filters[group.key]=Array.from(container.querySelectorAll<HTMLElement>('.rule')).flatMap(row=>{
            if(group.type==='text'){
                const value=row.querySelector<HTMLInputElement>('.value')!.value.trim(),op=row.querySelector<HTMLSelectElement>('.operator')!.value,to=op==='range'?row.querySelector<HTMLInputElement>('.end')!.value.trim():'';
                if(!value&&!to)return [];
                if(!value||op==='range'&&!to)throw new Error(`Completa il filtro ${group.label.toLowerCase()}.`);
                return [{op,value,...(op==='range'?{to}:{})}];
            }
            const from=row.querySelector<HTMLInputElement>('.from')!,to=row.querySelector<HTMLInputElement>('.to')!;
            if(!from.value&&!to.value)return [];
            const range:any={};
            for(const [key,input] of [['from',from],['to',to]] as const)if(input.value){if(!input.checkValidity())throw new Error(`Valore non valido: ${group.label}.`);range[key]=group.type==='number'?Number(input.value):input.value}
            if(range.from!==undefined&&range.to!==undefined&&range.from>range.to)throw new Error(`Intervallo invertito: ${group.label}.`);
            return [range];
        });
    }
    if(!filters.articles.length)throw new Error('Inserisci almeno un articolo o un intervallo di articoli.');
    if(!IS_OFFERS){filters.delivered=$<HTMLSelectElement>('delivered').value;filters.includeCancelled=$<HTMLInputElement>('includeCancelled').checked;}
    filters.sort=sorting.map(item=>({...item}));
    return filters;
}
function visibleColumns(){return COLUMNS.filter(c=>selected.has(c.key))}
function renderColumns(){
    $('columnPicker').innerHTML=COLUMNS.map(col=>`<label><input type="checkbox" data-column="${col.key}" ${selected.has(col.key)?'checked':''} ${col.key==='article'?'disabled':''}>${col.label}${col.key==='article'?' · sempre visibile':''}</label>`).join('');
    $('columnCount').textContent=`(${selected.size})`;
    $('columnPicker').querySelectorAll<HTMLInputElement>('input:not(:disabled)').forEach(input=>input.addEventListener('change',()=>{
        if(input.checked)selected.add(input.dataset.column!);else selected.delete(input.dataset.column!);
        try{localStorage.setItem(STORAGE_KEY,JSON.stringify([...selected]))}catch{}
        $('columnCount').textContent=`(${selected.size})`;renderTable();
    }));
}
function format(row:any,col:ArticleDocumentColumn){
    const val=row[col.key];if(val===null||val===undefined)return '—';
    if(col.kind==='boolean')return `<span class="state ${val?'yes':'no'}">${val?'SÌ':'NO'}</span>`;
    if(col.kind==='date')return escape(String(val).slice(0,10).split('-').reverse().join('/'));
    if(col.kind==='number'||col.kind==='money')return escape((col.kind==='money'?price:number).format(Number(val)));
    return escape(val);
}
function renderTable(){
    const columns=visibleColumns(),table=$<HTMLTableElement>('results');
    table.hidden=!rows.length;$('empty').hidden=!!rows.length;
    table.querySelector('thead')!.innerHTML='<tr>'+columns.map(col=>`<th class="${['number','money'].includes(col.kind)?'numeric':''}" scope="col">${col.label}</th>`).join('')+'</tr>';
    bindSortingHeaders(table,columns,sorting,changeSorting);
    updateSortingBar(table,COLUMNS,sorting,changeSorting);
    let lastArticle='';const multipleArticles=(!sorting.length||sorting[0].key==='article')&&rows.some(r=>r.article!==rows[0]?.article);
    table.querySelector('tbody')!.innerHTML=rows.map(row=>{
        const heading=multipleArticles&&lastArticle!==row.article?`<tr class="article-group"><td colspan="${columns.length}">Articolo ${escape(row.article)} · ${escape(row.description)}</td></tr>`:'';
        lastArticle=row.article;
        return heading+'<tr>'+columns.map(col=>`<td class="${['number','money'].includes(col.kind)?'numeric':''}" title="${escape(row[col.key])}">${format(row,col)}</td>`).join('')+'</tr>';
    }).join('');
    $('loaded').textContent=applied?`${number.format(rows.length)} di ${number.format(total)} righe · scorri per caricare altri risultati`:'Nessuna ricerca eseguita';
    if(rows.length>=total&&applied)$('loaded').textContent=`${number.format(rows.length)} righe · tutti i risultati caricati`;
    $('more').hidden=!applied||rows.length>=total;
    $('total').textContent=applied?number.format(total):'—';
    $('orders').textContent=applied?number.format(new Set(rows.map(r=>r[ID_KEY])).size):'—';
    $('articles').textContent=applied?number.format(new Set(rows.map(r=>r.article)).size):'—';
    const units=new Map<string,number>();for(const row of rows)units.set(row.unit||'U.M. n.d.',(units.get(row.unit||'U.M. n.d.')||0)+Number(row[IS_OFFERS?'quantity':'residual']||0));
    const residual=[...units].map(([unit,amount])=>`${number.format(amount)} ${unit}`).join(' · ');
    $('residual').textContent=applied?(residual||'0'):'—';$('residual').title=residual;
}
function syncButtons(){
    $<HTMLButtonElement>('search').disabled=loading;
    $<HTMLButtonElement>('more').disabled=loading;
    $<HTMLButtonElement>('export').disabled=!applied||exporting||loading||JSON.stringify(collectSafe())!==JSON.stringify(applied);
}
const collectSafe=()=>{try{return collect()}catch{return null}};
function changeSorting(next:SortCriterion[]){
    if(JSON.stringify(next)===JSON.stringify(sorting))return;
    sorting=next;
    renderTable();
    if(applied)void search(false,{...applied,sort:sorting.map(item=>({...item}))});
}
async function search(append=false,overrideFilters?:any){
    if(append&&(loading||!applied||rows.length>=total))return;
    let filters:any;try{filters=append?applied:overrideFilters??collect()}catch(error){setStatus((error as Error).message,true);return}
    const token=append?generation:++generation;
    loading=true;syncButtons();setStatus(append?`Caricamento di ${IS_OFFERS?'altre offerte':'altri ordini'}…`:'Ricerca nel gestionale…');
    try{
        const result=await ipc.invoke(`${CHANNEL}-search`,{...filters,offset:append?rows.length:0,limit:250});
        if(token!==generation)return;
        if(!result.ok)throw new Error(result.error);
        if(!append){rows=[];applied=filters;$('tableScroll').scrollTop=0}
        const seen=new Set(rows.map(r=>`${r[ID_KEY]}/${r.line}`));rows.push(...result.rows.filter((r:any)=>!seen.has(`${r[ID_KEY]}/${r.line}`)));
        total=result.total;lastRead=new Date(result.queriedAt).toLocaleString('it-IT');
        renderTable();
        if(!rows.length)$('empty').innerHTML=`<span class="empty-symbol">⌕</span><h2>${IS_OFFERS?'Nessuna offerta trovata':'Nessun ordine trovato'}</h2><p>Controlla il codice articolo o amplia i filtri della ricerca.</p>`;
        setStatus(`Lettura SQL ${lastRead}${append?' · risultati aggiunti':''}.`);
        if(JSON.stringify(collectSafe())!==JSON.stringify(applied))setStatus(`I filtri sono cambiati durante la ricerca. Premi Cerca ${IS_OFFERS?'offerte':'ordini'} per applicarli.`);
    }catch(error){if(token===generation){sorting=(applied?.sort||[]).map(item=>({...item}));renderTable();setStatus(`${(error as Error).message}${applied?' I risultati precedenti restano visibili.':''}`,true)}}
    finally{if(token===generation){loading=false;syncButtons()}}
}
$('searchForm').addEventListener('submit',event=>{event.preventDefault();void search()});
$('more').addEventListener('click',()=>void search(true));
$('tableScroll').addEventListener('scroll',()=>{const el=$('tableScroll');if(el.scrollHeight-el.scrollTop-el.clientHeight<120)void search(true)});
for(const id of ['delivered','includeCancelled'])$(id)?.addEventListener('change',markDirty);
$('reset').addEventListener('click',()=>{generation++;loading=false;rows=[];total=0;applied=null;initFilters();if(!IS_OFFERS){$<HTMLSelectElement>('delivered').value='all';$<HTMLInputElement>('includeCancelled').checked=false;}$('empty').innerHTML=INITIAL_EMPTY;renderTable();syncButtons();setStatus('Filtri azzerati. Inserisci un articolo per iniziare.');document.querySelector<HTMLInputElement>('[data-key="articles"] .value')?.focus()});
$('export').addEventListener('click',async()=>{
    if(!applied||loading||exporting)return;
    exporting=true;syncButtons();setStatus('Esportazione di tutti i risultati della ricerca…');
    try{const result=await ipc.invoke(`${CHANNEL}-export`,{filters:applied,columns:[...selected]});if(!result.ok)throw new Error(result.error);setStatus(result.canceled?'Esportazione annullata.':`${number.format(result.count)} righe esportate in Excel.`)}catch(error){setStatus((error as Error).message,true)}finally{exporting=false;syncButtons()}
});
$('close').addEventListener('click',()=>ipc.send(`${CHANNEL}-close`));
document.addEventListener('keydown',event=>{if(event.key==='Escape')$<HTMLDetailsElement>('columns').open=false});
document.addEventListener('click',event=>{if(!$('columns').contains(event.target as Node))$<HTMLDetailsElement>('columns').open=false});
initFilters();renderColumns();renderTable();syncButtons();document.querySelector<HTMLInputElement>('[data-key="articles"] .value')?.focus();
