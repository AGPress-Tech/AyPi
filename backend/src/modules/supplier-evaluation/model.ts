export const dimensions=['punctuality','condition','conformity'] as const;
export type Dimension=typeof dimensions[number];
export type Rating={id:string;name:string;rank:number;active:boolean};
export type CriticalRule={id:string;name:string;dimension:Dimension;options:string[];mode:'count'|'rate'|'either';count:number;rate:number;minSample:number;active:boolean};
export type SupplierSettings={revision:number;levels:Rating[];options:Record<Dimension,Rating[]>;rules:CriticalRule[]};
export function defaultSupplierSettings():SupplierSettings{
    const labels={punctuality:['Puntuale','Leggero Ritardo','Ritardo'],condition:['Buono','Normale','Pessimo'],conformity:['Conforme','Parzialmente Conforme','Non Conforme']};
    return {revision:1,levels:['Alta','Media','Bassa','DWD'].map((name,i)=>({id:'level:'+(i+1),name,rank:i+1,active:true})),options:Object.fromEntries(dimensions.map(d=>[d,labels[d].map((name,i)=>({id:d+':'+(i+1),name,rank:i+1,active:true}))])) as any,rules:dimensions.map((dimension,i)=>({id:'rule:'+dimension,name:['Tempi di consegna','Stato merce alla consegna','Merce non conforme'][i],dimension,options:[dimension+':3'],mode:'count',count:3,rate:20,minSample:1,active:true}))};
}
const object=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
export function supplierText(value:any,max=1000){if(value==null)return '';if(typeof value!=='string'&&typeof value!=='number')throw Error('Valore non valido.');const s=String(value).trim();if(s.length>max)throw Error('Valore troppo lungo.');return s;}
export function supplierDate(value:any){const s=supplierText(value,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)throw Error('Data non valida.');return s;}
export function validateSupplierSettings(input:any):SupplierSettings{
    if(!object(input)||!Number.isInteger(input.revision))throw Error('Configurazione non valida.');
    const ratings=(values:any):Rating[]=>{if(!Array.isArray(values)||!values.length||values.length>100)throw Error('Inserire da 1 a 100 voci.');const ids=new Set(),names=new Set();return values.map(v=>{if(!object(v))throw Error('Voce non valida.');const id=supplierText(v.id,100),name=supplierText(v.name,100),key=name.toLocaleLowerCase('it');if(!id||!name||ids.has(id)||names.has(key)||!Number.isInteger(v.rank)||v.rank<1||v.rank>1000)throw Error('Nomi e ID devono essere univoci; ordine da 1 a 1000.');ids.add(id);names.add(key);return {id,name,rank:v.rank,active:v.active!==false};});};
    const levels=ratings(input.levels),options=Object.fromEntries(dimensions.map(d=>[d,ratings(input.options?.[d])])) as SupplierSettings['options'];
    if(!Array.isArray(input.rules)||input.rules.length>50)throw Error('Massimo 50 tipologie di criticità.');const ids=new Set();
    const rules=input.rules.map((r:any):CriticalRule=>{const id=supplierText(r.id,100),name=supplierText(r.name,150);if(!id||ids.has(id)||!name||!dimensions.includes(r.dimension)||!['count','rate','either'].includes(r.mode)||!Array.isArray(r.options)||!r.options.length||r.options.length>100||r.options.some(id=>!options[r.dimension].some(v=>v.id===id))||!Number.isInteger(r.count)||r.count<1||r.count>1000000||!Number.isFinite(r.rate)||r.rate<0||r.rate>100||!Number.isInteger(r.minSample)||r.minSample<1||r.minSample>1000000)throw Error('Tipologia di criticità non valida: controllare esiti, soglie e campione minimo.');ids.add(id);return {id,name,dimension:r.dimension,options:[...new Set<string>(r.options)],mode:r.mode,count:r.count,rate:r.rate,minSample:r.minSample,active:r.active!==false};});
    return {revision:input.revision,levels,options,rules};
}
export function validateEvaluation(input:any,settings:SupplierSettings){
    if(!object(input))throw Error('Valutazione non valida.');const supplierId=supplierText(input.supplierId,200);if(!supplierId)throw Error('Selezionare un fornitore.');
    const grades=Object.fromEntries(dimensions.map(d=>{const id=supplierText(input[d],100);if(id&&!settings.options[d].some(v=>v.id===id))throw Error('Selezionare '+({punctuality:'puntualità',condition:'stato merce',conformity:'conformità'}[d])+'.');return [d,id];}));
    return {supplierId,date:supplierDate(input.date),ddt:supplierText(input.ddt,255),...grades,notes:supplierText(input.notes,20000),extra:supplierText(input.extra,1000)};
}
export function supplierRuleResult(records:any[],rule:CriticalRule){
    const eligible=records.filter(r=>r[rule.dimension]),count=eligible.filter(r=>rule.options.includes(r[rule.dimension])).length,rate=eligible.length?count/eligible.length*100:null;
    const countHit=count>=rule.count,rateHit=eligible.length>=rule.minSample&&rate!==null&&rate>=rule.rate;
    return {id:rule.id,name:rule.name,count,total:eligible.length,rate,critical:rule.active&&(rule.mode==='count'?countHit:rule.mode==='rate'?rateHit:countHit||rateHit)};
}
export function supplierSummary(suppliers:any[],records:any[],settings:SupplierSettings){
    const grouped=new Map<string,any[]>();for(const r of records)grouped.set(r.supplierId,[...(grouped.get(r.supplierId)||[]),r]);
    return suppliers.map(s=>{const rows=grouped.get(s.id)||[],causes=settings.rules.filter(r=>r.active).map(r=>supplierRuleResult(rows,r)),triggered=causes.filter(c=>c.critical);const adverse=rows.filter(row=>settings.rules.some(rule=>rule.active&&rule.options.includes(row[rule.dimension]))).length;
        return {...s,evaluations:rows.length,adverse,adverseRate:rows.length?adverse/rows.length*100:null,critical:triggered.length>0,causes:triggered.map(c=>c.name).join(' · '),causeDetails:causes,lastDate:rows.map(r=>r.date).filter(Boolean).sort().pop()||'',...Object.fromEntries(dimensions.map(d=>[d+'Bad',rows.filter(r=>settings.rules.some(rule=>rule.active&&rule.dimension===d&&rule.options.includes(r[d]))).length]))};});
}
