import {SortCriterion,sortByCriteria} from '../analysis-sorting';
export const BOM_COLUMNS=[
    ['bom','Distinta base','text'],['bomDescription','Descrizione distinta','text'],
    ['line','Riga','number'],['component','Articolo componente','text'],['description','Descrizione componente','text'],
    ['quantity','Quantità','number'],['unit','U.M. componente','text'],['bomUnit','U.M. distinta','text'],
    ['hasBom','Sottodistinta','boolean'],['disabled','Disabilitata','boolean'],['inProduction','In produzione','boolean'],
    ['validFrom','Valida dal','date'],['validTo','Valida al','date'],['variant','Variante componente','text'],
    ['netWeight','Peso netto articolo','number'],['grossWeight','Peso lordo articolo','number'],
    ['scrapQuantity','Quantità sfrido','number'],['scrapUnit','U.M. sfrido','text'],['waste','Codice sfrido','text'],['wastePercent','Scarto %','number'],
    ['percentage','Quantità %','number'],['percentageBasis','Distinta a percentuale','boolean'],
    ['fixedComponent','Componente fisso','boolean'],['fixedQuantity','Quantità fissa','boolean'],['toExplode','Da esplodere','boolean'],
    ['created','Creazione distinta','date'],['modified','Modifica distinta','date'],
    ['notes','Note componente','text'],['bomNotes','Note distinta','text'],['technicalData','Dati tecnici','text'],
    ['drawing','Disegno','text'],['structureCode','Struttura','text'],['itemType','Tipo articolo','text'],
    ['configurable','Configurabile','boolean'],['salesOnly','Solo documenti vendita','boolean'],
    ['componentType','Tipo componente (ERP)','number'],['subId','ID componente','number'],
].map(([key,label,kind])=>({key,label,kind:kind as 'text'|'number'|'date'|'boolean'}));
export const BOM_SUMMARY_COLUMNS=BOM_COLUMNS.filter(c=>['bom','bomDescription','bomUnit','disabled','inProduction','configurable','percentageBasis','salesOnly','created','modified','bomNotes'].includes(c.key));
export const DEFAULT_BOM_COLUMNS=['bom','bomDescription','bomUnit','disabled','inProduction','modified'];
export type BomRow=Record<string,string|number|null>;
export type BomRule={field:string;op:'contains'|'exact'|'prefix'|'range';value:string;to?:string};
export type BomSearch={mode:'where-used'|'composition';rules:BomRule[];sort:SortCriterion[]};
export const emptyBomSearch=():BomSearch=>({mode:'where-used',rules:[],sort:[{key:'bom',direction:'asc'}]});
/** Header fields only: never show an arbitrary component/quantity as a BOM summary. */
export function summarizeBomRows(rows:readonly BomRow[],sort:readonly SortCriterion[]=[]):BomRow[]{
    const unique=new Map<string,BomRow>();
    for(const row of rows){const key=String(row.bom??'').trim().toLocaleLowerCase('it');if(!key||unique.has(key))continue;
        unique.set(key,Object.fromEntries(BOM_SUMMARY_COLUMNS.map(c=>[c.key,row[c.key]??null])));
    }
    return sortByCriteria([...unique.values()],sort.filter(s=>BOM_SUMMARY_COLUMNS.some(c=>c.key===s.key)),(row,key)=>row[key]);
}
export function bomExportRows(rows:readonly BomRow[],search:BomSearch,layout:'summary'|'exploded'){
    const matched=filterBomRows(rows,search);
    if(layout==='summary')return summarizeBomRows(matched,search.sort);
    const keys=new Set(matched.map(r=>String(r.bom).trim().toLocaleLowerCase('it')));
    return filterBomRows(rows.filter(r=>keys.has(String(r.bom).trim().toLocaleLowerCase('it'))),{mode:'composition',rules:[],sort:[{key:'bom',direction:'asc'},{key:'line',direction:'asc'}]});
}
export function validateBomSearch(value:any):BomSearch{
    if(!value||!['where-used','composition'].includes(value.mode)||!Array.isArray(value.rules)||value.rules.length>100||!Array.isArray(value.sort)||value.sort.length>BOM_COLUMNS.length)throw Error('Filtri distinta non validi.');
    const rules:BomRule[]=value.rules.map((r:any)=>{
        const col=BOM_COLUMNS.find(c=>c.key===r?.field);
        if(!col||!['contains','exact','prefix','range'].includes(r.op)||typeof r.value!=='string'||r.value.length>256||r.to!=null&&(typeof r.to!=='string'||r.to.length>256))throw Error('Condizione di ricerca non valida.');
        if(col.kind==='boolean'&&(r.op!=='exact'||!['0','1'].includes(r.value)))throw Error('Selezionare Sì oppure No.');
        if(['number','date'].includes(col.kind)){
            if(!['exact','range'].includes(r.op))throw Error('Operatore non valido.');
            const valid=(v:string)=>!v||(col.kind==='number'?Number.isFinite(Number(v)):/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
            if(!valid(r.value)||r.to&&!valid(r.to))throw Error('Valore numerico o data non valido.');
            if(r.value&&r.to&&(col.kind==='number'?Number(r.value)>Number(r.to):r.value>r.to))throw Error('Intervallo invertito.');
        }
        return {field:r.field,op:r.op,value:r.value.trim(),...(r.to?{to:r.to.trim()}:{})};
    });
    const sort:SortCriterion[]=value.sort.map((s:any)=>{if(!BOM_COLUMNS.some(c=>c.key===s?.key)||!['asc','desc'].includes(s.direction))throw Error('Ordinamento non valido.');return {key:s.key,direction:s.direction}});
    return {mode:value.mode,rules,sort};
}
export function filterBomRows(rows:readonly BomRow[],value:BomSearch):BomRow[]{
    const search=validateBomSearch(value),groups=new Map<string,BomRule[]>();
    for(const r of search.rules){if(!r.value&&!r.to)continue;const group=groups.get(r.field)||[];group.push(r);groups.set(r.field,group);}
    const normalize=(v:unknown)=>String(v??'').toLocaleLowerCase('it');
    return sortByCriteria(rows.filter(row=>(search.mode!=='where-used'||!!row.component)&&[...groups].every(([field,rules])=>rules.some(rule=>{
        const col=BOM_COLUMNS.find(c=>c.key===field)!,v=row[field];if(v==null)return false;
        const a=normalize(v),b=normalize(rule.value);
        if(rule.op==='range')return col.kind==='number'?(!b||Number(v)>=Number(b))&&(!rule.to||Number(v)<=Number(rule.to)):(!b||a>=b)&&(!rule.to||a<=normalize(rule.to));
        if(rule.op==='exact')return col.kind==='number'||col.kind==='boolean'?Number(v)===Number(rule.value):a===b;
        return rule.op==='prefix'?a.startsWith(b):a.includes(b);
    }))),search.sort,(row,key)=>row[key]);
}
export type BomPreferences={version:1;columns:string[];presets:{name:string;search:BomSearch;columns:string[]}[]};
export function validateBomColumns(value:unknown):string[]{
    if(!Array.isArray(value)||!value.length||value.some(v=>typeof v!=='string'||!BOM_COLUMNS.some(c=>c.key===v)))throw Error('Colonne non valide.');
    return [...new Set(['bom',...value])];
}
export function validateBomPreferences(value:any):BomPreferences{
    if(value?.version!==1||!Array.isArray(value.presets)||value.presets.length>10)throw Error('Preferenze distinte non valide.');
    const names=new Set<string>();
    return {version:1,columns:validateBomColumns(value.columns),presets:value.presets.map((p:any)=>{
        if(typeof p?.name!=='string'||!p.name.trim()||p.name.length>60||names.has(p.name.trim()))throw Error('Nome preset non valido o duplicato.');
        names.add(p.name.trim());return {name:p.name.trim(),search:validateBomSearch(p.search),columns:validateBomColumns(p.columns)};
    })};
}
