import {calendarDate,todayInRome} from './model';
export function validMaintenanceDate(value:unknown,today=todayInRome()){
    try{return calendarDate(value)<=today}catch{return false}
}
/** Clean the AyPi migration only. The Access source and its network files are untouched. */
export function cleanMaintenanceImport(input:any,today=todayInRome()){
    const machineIds=new Set(input.machines.map(m=>String(m.id))),excluded:any[]=[];
    const plans=input.plans.filter(p=>{
        const valid=machineIds.has(String(p.machineId))&&typeof p.description==='string'&&!!p.description.trim();
        if(!valid)excluded.push({kind:'plan',id:String(p.id),reason:'Macchina o descrizione mancante'});return valid;
    });
    const byPlan=new Map<string,any>(plans.map(p=>[String(p.id),p]));
    const accepted=(r:any,kind:string)=>{
        const definition=byPlan.get(String(r.planId));
        const reason=!validMaintenanceDate(r.date,today)?'Data non valida, mancante o futura':!machineIds.has(String(r.machineId))?'Macchina mancante':kind==='ordinary'&&(!definition||String(definition.machineId)!==String(r.machineId))?'Manutenzione prevista mancante o di un’altra macchina':kind==='extraordinary'&&(!r.description||!String(r.description).trim())?'Intervento mancante':'';
        if(reason)excluded.push({kind,id:String(r.id),reason});return !reason;
    };
    const ordinary=input.ordinary.filter(r=>accepted(r,'ordinary')).map(({legacyNextDate,...r})=>r),extraordinary=input.extraordinary.filter(r=>accepted(r,'extraordinary'));
    const recordIds=new Set([...ordinary.map(r=>'ordinary:'+r.id),...extraordinary.map(r=>'extraordinary:'+r.id)]),attachments=input.attachments.filter(a=>recordIds.has(a.recordId));
    const previous=input.cleanup?.version===2?input.cleanup:null;
    const cleanup={version:2,cleanedAt:new Date().toISOString(),asOf:today,sourceCounts:previous?.sourceCounts||{machines:input.machines.length,plans:input.plans.length,ordinary:input.ordinary.length,extraordinary:input.extraordinary.length,attachments:input.attachments.length},manualDatesDiscarded:(previous?.manualDatesDiscarded||0)+input.ordinary.filter(r=>r.legacyNextDate!=null).length,excluded:[...(previous?.excluded||[]),...excluded],removedAttachments:(previous?.removedAttachments||0)+input.attachments.length-attachments.length};
    return {...input,plans,ordinary,extraordinary,attachments,cleanup};
}
