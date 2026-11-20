import {sortByCriteria,SortCriterion} from '../analysis-sorting';
export type Row=Record<string,string|number|null>;
export const COLUMNS:{key:string;label:string;kind:'text'|'number'|'date'}[]=[
 {key:'supplier',label:'Fornitore',kind:'text'}, {key:'contract',label:'Contratto',kind:'text'},
 {key:'quantity',label:'Quantità contratto (kg)',kind:'number'}, {key:'euroPrice',label:'Prezzo (€/kg)',kind:'number'},
 {key:'received',label:'Kg ricevuti',kind:'number'}, {key:'openOrders',label:'Ordini in corso',kind:'text'},
 {key:'pending',label:'Kg ordini in corso',kind:'number'}, {key:'available',label:'Disponibilità residua (kg)',kind:'number'},
 {key:'status',label:'Stato',kind:'text'}, {key:'supplierCode',label:'Codice fornitore',kind:'text'},
 {key:'supplierContract',label:'Contratto fornitore',kind:'text'}, {key:'date',label:'Data contratto',kind:'date'},
 {key:'expiry',label:'Scadenza',kind:'date'}, {key:'item',label:'Articolo',kind:'text'},
 {key:'description',label:'Descrizione',kind:'text'}, {key:'remaining',label:'Residuo da ricevere (kg)',kind:'number'},
 {key:'ordered',label:'Kg ordinati',kind:'number'}, {key:'erpOrdered',label:'Ordinato registrato nel contratto',kind:'number'},
 {key:'coverage',label:'Ricevuto (%)',kind:'number'}, {key:'currency',label:'Valuta',kind:'text'},
 {key:'price',label:'Prezzo originale / U.M.',kind:'number'}, {key:'unit',label:'U.M. originale',kind:'text'},
 {key:'amount',label:'Imponibile contratto',kind:'number'}, {key:'quality',label:'Verifica dati',kind:'text'},
 {key:'notes',label:'Note contratto',kind:'text'}, {key:'lineNotes',label:'Note riga',kind:'text'},
 {key:'id',label:'ID gestionale',kind:'number'}, {key:'line',label:'Riga contratto',kind:'number'}
];
export const DEFAULT_COLUMNS=COLUMNS.slice(0,9).map(c=>c.key);
export function validateSupplierCodes(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>200||value.some(v=>typeof v!=='string'||!v.trim()||v.length>128))throw Error('Elenco fornitori non valido (massimo 200).');
 return [...new Set(value.map(v=>v.trim()))];
}
export function defaultSupplierCodes(suppliers:{code:string;name:string}[]){return suppliers.filter(s=>/METALLURGICA SAN MARCO|GAMBARI|VEZZOLA/i.test(s.name)).map(s=>s.code);}
export const yes=(v:unknown)=>v===true||String(v)==='1';
const kg=(v:unknown)=>String(v??'').trim().toUpperCase()==='KG';
const num=(v:unknown)=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
export function orderPending(o:Row){const q=num(o.quantity),r=num(o.received);return yes(o.cancelled)||yes(o.lineCancelled)||yes(o.closed)||yes(o.lineClosed)?0:q==null||r==null?null:Math.max(0,q-r);}
export function relatedOrders(contract:Row,orders:Row[]){return orders.filter(o=>String(o.contractId)===String(contract.id)&&String(o.contractLine)===String(contract.line)&&String(o.supplierCode).trim()===String(contract.supplierCode).trim());}
export function summarize(contracts:Row[],orders:Row[],today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'})):Row[]{
 return contracts.map(c=>{
    const linked=relatedOrders(c,orders),active=linked.filter(o=>!yes(o.cancelled)&&!yes(o.lineCancelled)),issues:string[]=[];
    // Le consegne già effettuate rimangono reali anche se l'ordine viene successivamente annullato.
    const receivedKnown=linked.every(o=>kg(o.unit)&&num(o.received)!=null),pendingKnown=active.every(o=>orderPending(o)===0||kg(o.unit)&&orderPending(o)!=null);
    const received=receivedKnown?linked.reduce((a,o)=>a+Number(o.received),0):null;
    const pending=pendingKnown?active.reduce((a,o)=>a+Number(orderPending(o)),0):null;
    const quantity=kg(c.unit)?num(c.quantity):null;
    if(quantity==null)issues.push('Quantità contratto non espressa in kg');
    if(!receivedKnown)issues.push('Ricevimenti con U.M./quantità da verificare');
    if(!pendingKnown)issues.push('Ordini aperti con U.M./quantità da verificare');
    const remaining=quantity!=null&&received!=null?quantity-received:null,available=remaining!=null&&pending!=null?remaining-pending:null;
    const closed=yes(c.closed)||yes(c.lineClosed),expired=!!c.expiry&&String(c.expiry)<today;
    const open=active.filter(o=>orderPending(o)==null||Number(orderPending(o))>0);
    return {...c,quantity,received,pending,remaining,available,relatedArticles:JSON.stringify([...new Set(linked.map(o=>String(o.item??'').trim()).filter(Boolean))]),
      euroPrice:kg(c.unit)&&String(c.currency).trim().toUpperCase()==='EUR'?num(c.price):null,
      ordered:active.every(o=>kg(o.unit)&&num(o.quantity)!=null)?active.reduce((a,o)=>a+Number(o.quantity),0):null,
      openOrders:[...new Set(open.map(o=>String(o.document)))].join(', '),
      coverage:quantity&&received!=null?received/quantity*100:null,
      status:closed?'Chiuso':expired?'Aperto · scaduto':'Aperto',active:closed?0:1,expired:expired?1:0,
      quality:issues.join('; ')||(available!=null&&available<0?'Superamento quantità contrattuale':'')};
 });
}
export type Rule={field:string;op:'contains'|'exact'|'prefix'|'range';value:string;to?:string};
export type SupplierSummary={key:string;rows:Row[];totals:Row;partial:string[];amounts:{currency:string;value:number;partial:boolean}[];originalOrdered:{unit:string;value:number;partial:boolean}[]};
/** Aggregate additive measures only; rates are weighted, original currencies/units stay separate. */
export function summarizeSuppliers(rows:Row[],sort:SortCriterion[]=[]):SupplierSummary[]{
 const groups=new Map<string,SupplierSummary>();for(const row of rows){const code=String(row.supplierCode??'').trim(),key=code.toLocaleLowerCase('it')||JSON.stringify([row.id,row.line]);let group=groups.get(key);if(!group){group={key,rows:[],totals:{supplier:row.supplier,supplierCode:row.supplierCode},partial:[],amounts:[],originalOrdered:[]};groups.set(key,group);}group.rows.push(row);}
 const sum=(list:Row[],key:string)=>{const known=list.filter(row=>num(row[key])!=null);return {value:known.length?known.reduce((s,row)=>s+Number(row[key]),0):null,partial:known.length<list.length};};
 for(const group of groups.values()){
    for(const key of ['quantity','received','pending','available','remaining','ordered']){const total=sum(group.rows,key);group.totals[key]=total.value;if(total.partial)group.partial.push(key);}
    group.totals.contract=new Set(group.rows.map(row=>String(row.id))).size;
    group.totals.openOrders=[...new Set(group.rows.flatMap(row=>String(row.openOrders||'').split(', ').filter(Boolean)))].join(', ');
    const priced=group.rows.filter(row=>num(row.quantity)!=null&&Number(row.quantity)>0&&num(row.euroPrice)!=null),weight=priced.reduce((s,row)=>s+Number(row.quantity),0);group.totals.euroPrice=weight?priced.reduce((s,row)=>s+Number(row.quantity)*Number(row.euroPrice),0)/weight:null;
    if(group.rows.some(row=>num(row.quantity)==null||Number(row.quantity)>0&&num(row.euroPrice)==null))group.partial.push('euroPrice');
    group.totals.coverage=group.totals.quantity&&group.totals.received!=null?Number(group.totals.received)/Number(group.totals.quantity)*100:null;if(group.partial.some(key=>['quantity','received'].includes(key)))group.partial.push('coverage');
    for(const field of ['status','unit','currency'])group.totals[field]=[...new Set(group.rows.map(row=>String(row[field]||'')).filter(Boolean))].join(', ');
    for(const field of ['item','description','supplierContract']){const values=[...new Set(group.rows.map(row=>row[field]).filter(v=>v!=null&&v!==''))];group.totals[field]=values.length===1?values[0]:null;}
    group.totals.quality=[...new Set(group.rows.map(row=>String(row.quality||'')).filter(Boolean))].join('; ');
    for(const currency of [...new Set(group.rows.map(row=>String(row.currency||'').trim()))]){const total=sum(group.rows.filter(row=>String(row.currency||'').trim()===currency),'amount');if(total.value!=null&&(currency||total.value!==0))group.amounts.push({currency,value:total.value,partial:total.partial});}
    for(const unit of [...new Set(group.rows.map(row=>String(row.unit||'').trim()))]){const total=sum(group.rows.filter(row=>String(row.unit||'').trim()===unit),'erpOrdered');if(total.value!=null&&(unit||total.value!==0))group.originalOrdered.push({unit,value:total.value,partial:total.partial});}
 }
 return sortByCriteria([...groups.values()],sort,(group,key)=>group.totals[key]);
}
export type ContractScope='open'|'all'|'closed'|'expired';
export type Search={scope:ContractScope|ContractScope[];rules:Rule[];sort:SortCriterion[]};
export const emptySearch=():Search=>({scope:['open'],rules:[],sort:[{key:'supplier',direction:'asc'},{key:'date',direction:'desc'}]});
export function validateSearch(v:any):Search{
 const scopes=Array.isArray(v?.scope)?v.scope:[v?.scope];
 if(!v||scopes.length>4||scopes.some((scope:any)=>!['open','all','closed','expired'].includes(scope))||!Array.isArray(v.rules)||v.rules.length>100||!Array.isArray(v.sort)||v.sort.length>COLUMNS.length)throw Error('Filtri contratti non validi.');
 const rules=v.rules.map((r:any)=>{const c=COLUMNS.find(c=>c.key===r?.field);if(!c||!['contains','exact','prefix','range'].includes(r.op)||typeof r.value!=='string'||r.value.length>256||r.to!=null&&(typeof r.to!=='string'||r.to.length>256))throw Error('Condizione non valida.');
    if(c.kind!=='text'){if(!['exact','range'].includes(r.op))throw Error('Operatore non valido.');for(const val of [r.value,r.to])if(val&&(c.kind==='number'?!Number.isFinite(Number(val)):!/^\d{4}-\d{2}-\d{2}$/.test(val)||Number.isNaN(Date.parse(val))||new Date(val).toISOString().slice(0,10)!==val))throw Error('Numero o data non valido.');
      if(r.value&&r.to&&(c.kind==='number'?Number(r.value)>Number(r.to):r.value>r.to))throw Error('Intervallo invertito.');}
    return {field:r.field,op:r.op,value:r.value.trim(),...(r.to?{to:r.to.trim()}:{})};});
 const sort=v.sort.map((s:any)=>{if(!COLUMNS.some(c=>c.key===s?.key)||!['asc','desc'].includes(s.direction))throw Error('Ordinamento non valido.');return {key:s.key,direction:s.direction};});return {scope:scopes.includes('all')?['all']:[...new Set(scopes)] as ContractScope[],rules,sort};
}
export function filterRows(rows:Row[],input:Search){const s=validateSearch(input),groups=new Map<string,Rule[]>();for(const r of s.rules){if(!r.value&&!r.to)continue;groups.set(r.field,[...(groups.get(r.field)||[]),r]);}
 const normalize=(v:unknown)=>String(v??'').toLocaleLowerCase('it');
 return sortByCriteria(rows.filter(row=>((s.scope as ContractScope[]).some(scope=>scope==='all'||(scope==='expired'?Number(row.expired)===1:Number(row.active)===(scope==='open'?1:0))))&&[...groups].every(([field,rules])=>rules.some(r=>(field==='item'?[row.item,...JSON.parse(String(row.relatedArticles||'[]'))]:[row[field]]).some(v=>{if(v==null)return false;const a=normalize(v),b=normalize(r.value),numeric=COLUMNS.find(c=>c.key===field)!.kind==='number';if(r.op==='range')return numeric?(!b||Number(v)>=Number(b))&&(!r.to||Number(v)<=Number(r.to)):(!b||a>=b)&&(!r.to||a<=normalize(r.to));if(r.op==='exact')return numeric?Number(v)===Number(b):a===b;return r.op==='prefix'?a.startsWith(b):a.includes(b);})) )),s.sort,(row,key)=>row[key]);
}
export type Preferences={version:1;columns:string[];presets:{name:string;search:Search;columns:string[]}[]};
export function validateColumns(v:any):string[]{if(!Array.isArray(v)||!v.length||v.length>COLUMNS.length||v.some(k=>!COLUMNS.some(c=>c.key===k)))throw Error('Colonne non valide.');return [...new Set(['supplier','contract',...v])] as string[];}
export function validatePreferences(v:any):Preferences{if(v?.version!==1||!Array.isArray(v.presets)||v.presets.length>10)throw Error('Preferenze non valide.');const names=new Set<string>();return {version:1,columns:validateColumns(v.columns),presets:v.presets.map((p:any)=>{if(typeof p?.name!=='string'||!p.name.trim()||p.name.length>60||names.has(p.name.trim()))throw Error('Nome preset non valido o duplicato.');names.add(p.name.trim());return {name:p.name.trim(),search:validateSearch(p.search),columns:validateColumns(p.columns)};})};}
