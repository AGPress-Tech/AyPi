export type EntityKind='machine'|'plan'|'record';
export type Entity={id:string;revision:number;[key:string]:any};
export const todayInRome=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function calendarDate(value:unknown){
    const text=String(value??'');if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(text))||new Date(text).toISOString().slice(0,10)!==text)throw Error('Data non valida.');return text;
}
export function addMonths(date:string,months:number){
    const [y,m,d]=calendarDate(date).split('-').map(Number),target=new Date(Date.UTC(y,m-1+months,1)),last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
    target.setUTCDate(Math.min(d,last));return target.toISOString().slice(0,10);
}
export function maintenanceDue(machines:Entity[],plans:Entity[],records:Entity[],today=todayInRome()){
    const active=new Set(machines.filter(m=>m.active!==false).map(m=>m.id));
    const owners=new Map(plans.map(p=>[p.id,p.machineId]));
    const last=new Map<string,string>();for(const r of records)if(r.kind==='ordinary'&&owners.get(r.planId)===r.machineId&&r.date&&r.date<=today&&(!last.has(r.planId)||last.get(r.planId)!<r.date))last.set(r.planId,r.date);
    return plans.filter(p=>p.active!==false&&active.has(p.machineId)&&Number.isInteger(p.frequencyMonths)&&p.frequencyMonths>0&&last.has(p.id)).map(p=>{
        const lastDate=last.get(p.id)!,dueDate=addMonths(lastDate,p.frequencyMonths);return {id:p.id,planId:p.id,machineId:p.machineId,description:p.description,lastDate,dueDate,daysOverdue:Math.max(0,Math.round((Date.parse(today)-Date.parse(dueDate))/86400000))};
    }).filter(d=>d.dueDate<today).sort((a,b)=>b.daysOverdue-a.daysOverdue);
}
const text=(v:any,max:number,required=false)=>{if(typeof v!=='string'||v.length>max||required&&!v.trim())throw Error('Testo mancante o troppo lungo.');return v.trim()};
export function validateEntity(kind:EntityKind,value:any,machines:Entity[],plans:Entity[],today=todayInRome()):any{
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Dati non validi.');
    if(kind==='machine'){
        const code=text(value.code,128,true),equipmentTypes=value.equipmentTypes;
        if(!Array.isArray(equipmentTypes)||equipmentTypes.length>20||equipmentTypes.some(v=>typeof v!=='string'||v.length>100))throw Error('Tipi di attrezzatura non validi.');
        if(value.year!=null&&(!Number.isInteger(value.year)||value.year<1800||value.year>Number(today.slice(0,4))))throw Error('Anno di costruzione non valido.');
        return {code,department:text(value.department,100,true),description:text(value.description,2000,true),year:value.year??null,responsible:text(value.responsible||'',200),serial:text(value.serial||'',200),robotSerial:text(value.robotSerial||'',200),islandSerial:text(value.islandSerial||'',200),conformity:text(value.conformity||'',100),robotConformity:text(value.robotConformity||'',100),equipmentTypes:[...new Set(equipmentTypes)],active:value.active!==false};
    }
    const machineId=text(value.machineId,128,true),machine=machines.find(m=>m.id===machineId);
    if(!machine)throw Error('Selezionare una macchina esistente.');
    if(kind==='plan'){
        const frequencyMonths=value.frequencyMonths;
        if(frequencyMonths!=null&&(!Number.isInteger(frequencyMonths)||frequencyMonths<1||frequencyMonths>1200))throw Error('Frequenza: indicare da 1 a 1200 mesi, oppure lasciare vuoto.');
        return {machineId,description:text(value.description,10000,true),frequencyMonths:frequencyMonths??null,active:value.active!==false};
    }
    if(!['ordinary','extraordinary'].includes(value.kind))throw Error('Tipo di manutenzione non valido.');
    const date=calendarDate(value.date);if(date>today)throw Error('Non è possibile registrare una manutenzione in una data futura.');
    const planId=value.kind==='ordinary'?text(value.planId,128,true):null,plan=plans.find(p=>p.id===planId);
    if(value.kind==='ordinary'&&(!plan||plan.machineId!==machineId))throw Error('La manutenzione ordinaria non appartiene alla macchina selezionata.');
    return {machineId,kind:value.kind,planId,date,description:value.kind==='ordinary'?plan!.description:text(value.description,20000,true),notes:text(value.notes||'',50000)};
}
export function validateAttachment(value:any){
    const name=text(value?.name,255,true),path=value.path==null?null:text(value.path,2048,true);
    if(!/\.(pdf|jpe?g|png|txt|csv|xlsx?|docx?)$/i.test(name))throw Error('Tipo allegato non supportato.');
    if(path&&(!/^\\\\[^\\]+\\[^\\]+\\/.test(path)||path.split(/[\\/]/).includes('..')||/[\x00-\x1f]/.test(path)))throw Error('Selezionare un file nella rete condivisa.');
    if(path&&!/\.(pdf|jpe?g|png|txt|csv|xlsx?|docx?)$/i.test(path))throw Error('Tipo di file non supportato.');
    return {name,path};
}
