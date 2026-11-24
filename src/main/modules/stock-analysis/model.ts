import {sortByCriteria,SortCriterion} from '../analysis-sorting';
export type StockPeriod={year:number;period:number};
export function validateStockPeriods(value:any):StockPeriod[]{
    if(!Array.isArray(value)||!value.length||value.length>100)throw Error('Seleziona da 1 a 100 esercizi / periodi.');
    const unique=new Map<string,StockPeriod>();
    for(const p of value){if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['year','period'].includes(k))||!Number.isInteger(p.year)||p.year<1900||p.year>9999||!Number.isInteger(p.period)||p.period<1||p.period>99)throw Error('Esercizio o periodo non valido.');unique.set(p.year+':'+p.period,{year:p.year,period:p.period});}
    return [...unique.values()].sort((a,b)=>b.year-a.year||b.period-a.period);
}
export function stockPeriodKey(row:StockRow){return String(row.fiscalYear??'')+':'+String(row.fiscalPeriod??'');}
export function stockVisibleColumns(rows:StockRow[],columns:string[],periods?:StockPeriod[]){return (periods?periods.length:new Set(rows.map(stockPeriodKey)).size)>1?['article','fiscalYear','fiscalPeriod',...columns.filter(k=>!['article','fiscalYear','fiscalPeriod'].includes(k))]:columns;}
export type StockRow=Record<string,any>;
export type StockCustomerQuantity={article:string;unit:string;year:number|null;period:number|null;customerCode:string;customerName:string;quantity:number|null};
export function stockCustomerQuantities(rows:StockRow[]):StockCustomerQuantity[]{
    const customers=new Map<string,StockCustomerQuantity>();
    for(const row of rows){
        if(row.subjectKind!=='Cliente')continue;
        const key=JSON.stringify([row.article,row.unit,row.fiscalYear,row.fiscalPeriod,row.subjectCode,row.subjectName]);
        let value=customers.get(key);
        if(!value){value={article:row.article,unit:row.unit,year:row.fiscalYear,period:row.fiscalPeriod,customerCode:row.subjectCode,customerName:row.subjectName,quantity:0};customers.set(key,value);}
        value.quantity=value.quantity===null||row.quantity===null?null:value.quantity+row.quantity;
    }
    return [...customers.values()].filter(value=>value.quantity!==0).sort((a,b)=>a.customerName.localeCompare(b.customerName,'it')||a.customerCode.localeCompare(b.customerCode,'it'));
}
export function stockCustomerQuantityText(rows:StockRow[]){return stockCustomerQuantities(rows).map(value=>`${value.customerName||'Cliente non risolto'}${value.customerCode?' ('+value.customerCode+')':''}: ${value.quantity===null?'non disponibile':String(value.quantity)} ${value.unit||'U.M. non indicata'}`).join('\n');}
const col=(key:string,label:string,kind:'text'|'number'|'date'='text')=>({key,label,kind});
export const STOCK_COLUMNS=[col('article','Articolo'),col('description','Descrizione'),col('unit','U.M.'),col('quantity','Giacenza','number'),col('ownQuantity','Di proprietà aziendale','number'),col('thirdQuantity','Di proprietà di terzi','number'),col('available','Disponibile netto impegni','number'),col('storage','Magazzino'),col('storageDescription','Descrizione magazzino'),col('ownership','Proprietà merce'),col('subjectName','Soggetto associato'),col('subjectCode','Codice soggetto'),col('subjectKind','Tipo soggetto'),col('location','Ubicazione predefinita'),col('initial','Quantità iniziale','number'),col('received','Carichi','number'),col('issued','Scarichi','number'),col('reservedSales','Impegnato vendite','number'),col('reservedProduction','Impegnato produzione','number'),col('orderedPurchase','Ordinato acquisti','number'),col('orderedProduction','Ordinato produzione','number'),col('projected','Disponibilità prevista','number'),col('minimum','Scorta minima','number'),col('maximum','Scorta massima','number'),col('picked','Prelevato','number'),col('allocated','Allocato','number'),col('warnings','Verifica dati'),col('fiscalYear','Esercizio','number'),col('fiscalPeriod','Periodo','number'),col('modified','Ultima modifica saldo','date')];
STOCK_COLUMNS.splice(4,0,col('customerQuantities','Clienti · quantità associata'),col('customerCommitments','Clienti · residuo ordini attuale'));
export const DEFAULT_STOCK_COLUMNS=['article','description','unit','quantity','customerQuantities','customerCommitments','storage','ownership','subjectName','warnings'];
export type StockSearch={article:string;exactArticle:string;description:string;unit:string;subject:string;subjectCode:string;subjectKind:string;storages:string[];ownership:'all'|'own'|'third'|'unknown';scope:'relevant'|'all'|'negative'|'shortage'|'minimum';sort:SortCriterion[]};
export const emptyStockSearch=():StockSearch=>({article:'',exactArticle:'',description:'',unit:'',subject:'',subjectCode:'',subjectKind:'',storages:[],ownership:'all',scope:'relevant',sort:[{key:'article',direction:'asc'}]});
export function validateStockSearch(value:any):StockSearch{
    if(!value||!['all','own','third','unknown'].includes(value.ownership)||!['relevant','all','negative','shortage','minimum'].includes(value.scope)||!Array.isArray(value.storages)||value.storages.length>500||value.storages.some((s:any)=>typeof s!=='string'||s.length>128)||!Array.isArray(value.sort)||value.sort.length>STOCK_COLUMNS.length)throw Error('Filtri giacenze non validi.');
    const clean={...emptyStockSearch(),ownership:value.ownership,scope:value.scope,storages:[...new Set(value.storages)] as string[]};
    for(const key of ['article','exactArticle','description','unit','subject','subjectCode','subjectKind'] as const){if(typeof value[key]!=='string'||value[key].length>256)throw Error('Testo filtro non valido.');clean[key]=value[key].trim();}
    if(!['','customer','supplier'].includes(clean.subjectKind))throw Error('Tipo soggetto non valido.');
    clean.sort=value.sort.map((c:any)=>{if(!STOCK_COLUMNS.some(col=>col.key===c?.key)||!['asc','desc'].includes(c.direction))throw Error('Ordinamento non valido.');return {key:c.key,direction:c.direction};});
    return clean;
}
const flag=(v:unknown)=>v===true||v===1||v==='1';
const numeric=(v:unknown)=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const numericKeys=STOCK_COLUMNS.filter(c=>c.kind==='number').map(c=>c.key);
const plus=(...values:(number|null)[])=>values.some(v=>v===null)?null:values.reduce<number>((s,v)=>s+v!,0);
export function normalizeStock(rows:StockRow[]):StockRow[]{return rows.map((source,index)=>{
    const row:StockRow={...source};
    for(const key of ['article','description','unit','storage','storageDescription','subjectCode','subjectName','location'])row[key]=String(row[key]??'').trim();
    for(const key of numericKeys)if(!['ownQuantity','thirdQuantity','available','projected'].includes(key))row[key]=numeric(row[key]);
    row.quantity=plus(row.initial,row.received,row.issued===null?null:-row.issued);
    row.ownership=source.owned==null||!['0','1','true','false'].includes(String(source.owned))?'Non definita':flag(source.owned)?'Aziendale':'Di terzi';
    row.subjectKind=Number(source.subjectType)===6750208?'Cliente':Number(source.subjectType)===6750209?'Fornitore':Number(source.subjectType)===6750211?'Nessuno':`Tipo ${source.subjectType??'non definito'}`;
    row.ownQuantity=row.ownership==='Aziendale'?row.quantity:row.ownership==='Di terzi'?0:null;
    row.thirdQuantity=row.ownership==='Di terzi'?row.quantity:row.ownership==='Aziendale'?0:null;
    row.available=plus(row.quantity,row.reservedSales===null?null:-row.reservedSales,row.reservedProduction===null?null:-row.reservedProduction);
    row.projected=plus(row.available,row.orderedPurchase,row.orderedProduction);
    const warnings:string[]=[];
    if(row.quantity===null)warnings.push('Saldo incompleto');
    if(row.quantity!==null&&row.quantity<0)warnings.push('Giacenza negativa');
    if(row.available!==null&&row.available<0)warnings.push('Impegni oltre giacenza');
    if(row.minimum>0&&row.quantity!==null&&row.quantity<row.minimum)warnings.push('Sotto scorta minima');
    if(!row.unit)warnings.push('U.M. mancante');
    if(row.ownership==='Non definita')warnings.push('Proprietà non definita');
    if(['Cliente','Fornitore'].includes(row.subjectKind)&&!row.subjectName)warnings.push('Soggetto non risolto');
    if(flag(source.articleDisabled))warnings.push('Articolo disabilitato');
    if(flag(source.storageDisabled))warnings.push('Magazzino disabilitato');
    row.customerQuantities=stockCustomerQuantityText([row]);row.customerBreakdown=stockCustomerQuantities([row]);
    row.currentCustomerOrders=Array.isArray(source.currentCustomerOrders)?source.currentCustomerOrders:[];
    row.customerCommitments=row.currentCustomerOrders.map((value:any)=>`${value.customerName||value.customerCode||'Cliente non risolto'}: ${value.residual==null?'non disponibile':String(value.residual)} ${value.unit||'U.M. non indicata'}${value.missingQuantities?' (parziale)':''}`).join('\n');
    row.warnings=warnings.join('; ');row.key=JSON.stringify([row.article,row.unit,row.storage,source.subjectType,row.subjectCode,row.fiscalYear,row.fiscalPeriod,index]);
    return row;
});}
const norm=(v:any)=>String(v??'').trim().toLocaleLowerCase('it');
export function filterStock(rows:StockRow[],input:StockSearch){const s=validateStockSearch(input);return sortByCriteria(rows.filter(r=>
    (!s.exactArticle||norm(r.article)===norm(s.exactArticle))&&norm(r.article).includes(norm(s.article))&&norm(r.description).includes(norm(s.description))&&(!s.unit||r.unit===s.unit)&&
    norm(r.subjectName+' '+r.subjectCode).includes(norm(s.subject))&&(!s.subjectCode||norm(r.subjectCode)===norm(s.subjectCode))&&(!s.subjectKind||r.subjectKind===(s.subjectKind==='customer'?'Cliente':'Fornitore'))&&
    (!s.storages.length||s.storages.includes(r.storage))&&(s.ownership==='all'||r.ownership===({own:'Aziendale',third:'Di terzi',unknown:'Non definita'} as any)[s.ownership])&&
    (s.scope==='all'?true:s.scope==='relevant'?['quantity','reservedSales','reservedProduction','orderedPurchase','orderedProduction'].some(k=>r[k]===null||r[k]!==0):s.scope==='negative'?r.quantity!==null&&r.quantity<0:s.scope==='shortage'?r.available!==null&&r.available<0:r.minimum>0&&r.quantity!==null&&r.quantity<r.minimum)
),s.sort,(r,k)=>r[k]);}
export type StockGroup={key:string;row:StockRow;details:StockRow[]};
export function groupStock(rows:StockRow[],sort:SortCriterion[]=[]):StockGroup[]{
    const groups=new Map<string,StockGroup>();
    for(const r of rows){const key=JSON.stringify([r.article,r.unit,r.fiscalYear,r.fiscalPeriod]);let group=groups.get(key);if(!group){group={key,row:{article:r.article,description:r.description,unit:r.unit},details:[]};groups.set(key,group);}group.details.push(r);}
    for(const group of groups.values()){
        for(const c of STOCK_COLUMNS){if(['article','description','unit'].includes(c.key))continue;
            const values=group.details.map(r=>r[c.key]);
            const distinct=[...new Set(values.filter(v=>v!=null&&v!==''))];
            group.row[c.key]=c.kind==='number'?(['fiscalYear','fiscalPeriod','minimum','maximum'].includes(c.key)?(distinct.length===1&&!values.includes(null)?distinct[0]:null):plus(...values)):c.key==='modified'?values.filter(Boolean).sort().pop()??null:distinct.join(' · ');
        }
        group.row.warnings=[...new Set(group.details.flatMap(r=>String(r.warnings).split('; ').filter(Boolean)))].join('; ');
        group.row.customerQuantities=stockCustomerQuantityText(group.details);group.row.customerBreakdown=stockCustomerQuantities(group.details);
        group.row.currentCustomerOrders=group.details[0]?.currentCustomerOrders||[];
        group.row.customerCommitments=group.details[0]?.customerCommitments||'';
        // Min/max are per location; a sum would misrepresent the reorder threshold.
    }
    return sortByCriteria([...groups.values()],sort,(g,k)=>g.row[k]);
}
export function stockTotals(rows:StockRow[],key='quantity'){
    const units=new Map<string,{year:number|null;period:number|null;unit:string;value:number;partial:boolean}>();
    for(const row of rows){
        const unit=row.unit||'U.M. non indicata',id=JSON.stringify([row.fiscalYear,row.fiscalPeriod,unit]);let total=units.get(id);
        if(!total){total={year:row.fiscalYear??null,period:row.fiscalPeriod??null,unit,value:0,partial:false};units.set(id,total);}
        if(row[key]===null)total.partial=true;else total.value+=row[key];
    }
    return [...units.values()].filter(t=>t.unit!=='U.M. non indicata'||t.value!==0||t.partial).sort((a,b)=>(b.year??0)-(a.year??0)||(b.period??0)-(a.period??0)||a.unit.localeCompare(b.unit));
}
export function validateStockColumns(value:any):string[]{if(!Array.isArray(value)||!value.length||value.length>STOCK_COLUMNS.length||value.some(k=>!STOCK_COLUMNS.some(c=>c.key===k)))throw Error('Colonne non valide.');return [...new Set(['article',...value])] as string[];}
export type StockPreferences={version:1;customerBreakdownVersion?:1;columns:string[];presets:{name:string;search:StockSearch;columns:string[]}[]};
export function validateStockPreferences(value:any):StockPreferences{if(value?.version!==1||!Array.isArray(value.presets)||value.presets.length>10)throw Error('Preferenze non valide.');const names=new Set<string>();const columns=(input:any)=>{const clean=validateStockColumns(input);return value.customerBreakdownVersion===1?clean:validateStockColumns([...clean,'customerQuantities','customerCommitments']);};return {version:1,customerBreakdownVersion:1,columns:columns(value.columns),presets:value.presets.map((p:any)=>{if(typeof p?.name!=='string'||!p.name.trim()||p.name.length>60||names.has(p.name.trim()))throw Error('Nome preset non valido o duplicato.');names.add(p.name.trim());return {name:p.name.trim(),search:validateStockSearch(p.search),columns:columns(p.columns)};})};}
