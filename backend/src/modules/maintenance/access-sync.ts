import {createHash,randomUUID} from 'crypto';
import {Entity,EntityKind,validateEntity} from './model';
export type AccessAlias={kind:EntityKind;sourceId:string;targetId:string};
export type AccessExisting={machine:any[];plan:any[];record:any[];attachments:any[];aliases:AccessAlias[];removedAttachments:string[]};
export function attachmentSignature(recordId:string,a:any){
    const content=a.path?'path:'+String(a.path).replace(/\//g,'\\').toLocaleLowerCase('it'):'bytes:'+createHash('sha256').update(typeof a.data==='string'?Buffer.from(a.data,'base64'):Buffer.from(a.data||[])).digest('hex');
    return createHash('sha256').update(recordId+'\0'+content+'\0'+String(a.name).toLocaleLowerCase('it')).digest('hex');
}
const canonical=(v:any):string=>JSON.stringify(Array.isArray(v)?[...v].sort():v==null||v===''?null:typeof v==='string'?v.replace(/\r\n/g,'\n').trim():v);
export function buildAccessSync(input:any,existing:AccessExisting){
    const aliases=[...existing.aliases],writes:{kind:EntityKind;id:string;value:any}[]=[],attachments:any[]=[],changed:any[]=[],skipped:any[]=[],addedItems:any[]=[];
    const counts={machines:0,plans:0,ordinary:0,extraordinary:0,attachments:0};let unchanged=0;
    const machineMap=new Map<string,string>(),planMap=new Map<string,string>(),recordMap=new Map<string,string>();
    const rows={machine:[...existing.machine],plan:[...existing.plan],record:[...existing.record]};
    function bind(kind:EntityKind,sourceId:string,targetId:string){if(!aliases.some(a=>a.kind===kind&&a.sourceId===sourceId))aliases.push({kind,sourceId,targetId})}
    function find(kind:EntityKind,sourceId:string,natural:(e:any)=>boolean){
        const alias=aliases.find(a=>a.kind===kind&&a.sourceId===sourceId);
        if(alias)return rows[kind].find(e=>e.id===alias.targetId)||{id:alias.targetId,deleted:true};
        const historic=rows[kind].find(e=>String(e.legacy?.sourceId??'')===sourceId);
        if(historic)return historic;
        const candidates=rows[kind].filter(e=>!e.legacy?.sourceId&&!aliases.some(a=>a.kind===kind&&a.targetId===e.id)&&natural(e));
        if(candidates.length>1)return {ambiguous:true};return candidates[0];
    }
    function merge(kind:EntityKind,sourceId:string,label:string,value:any,old:any){
        if(old?.deleted||old?.ambiguous){skipped.push({kind,sourceId,label,reason:old.deleted?'Eliminata in AyPi: non ripristinata':'Più corrispondenze possibili in AyPi'});return null;}
        if(old){bind(kind,sourceId,old.id);const fields=Object.keys(value).filter(k=>!['active','frequencyMonths'].includes(k)&&canonical(value[k])!==canonical(old[k]));
            if(fields.length)changed.push({kind,sourceId,label,fields:fields.map(field=>({field,access:value[field]??null,aypi:old[field]??null}))});else unchanged++;
            return old.id;
        }
        try{value=validateEntity(kind,value,rows.machine,rows.plan)}catch(e){skipped.push({kind,sourceId,label,reason:(e as Error).message});return null;}
        const id=randomUUID(),entity={...value,id,revision:1,createdBy:'Archivio Access',legacy:{sourceId:kind==='record'?sourceId.replace(/^(ordinary|extraordinary):/,''):sourceId}};
        writes.push({kind,id,value:entity});rows[kind].push(entity);bind(kind,sourceId,id);
        addedItems.push({kind,sourceId,label});
        counts[kind==='machine'?'machines':kind==='plan'?'plans':value.kind==='ordinary'?'ordinary':'extraordinary']++;
        return id;
    }
    for(const m of input.machines){const sourceId=String(m.id),value={code:String(m.code||m.id),department:m.department||'',description:m.description||'',year:m.year??null,responsible:m.responsible||'',serial:m.serial||'',robotSerial:m.robotSerial||'',islandSerial:m.islandSerial||'',conformity:m.conformity||'',robotConformity:m.robotConformity||'',equipmentTypes:m.equipmentTypes||[],active:true};
        const id=merge('machine',sourceId,value.code,value,find('machine',sourceId,e=>String(e.code).toLocaleLowerCase('it')===value.code.toLocaleLowerCase('it')));if(id)machineMap.set(sourceId,id);
    }
    for(const p of input.plans){const sourceId=String(p.id),machineId=machineMap.get(String(p.machineId));if(!machineId){skipped.push({kind:'plan',sourceId,label:p.description,reason:'Macchina non disponibile in AyPi'});continue;}
        const value={machineId,description:p.description,frequencyMonths:null,active:true};const id=merge('plan',sourceId,p.description,value,find('plan',sourceId,e=>e.machineId===machineId&&canonical(e.description)===canonical(p.description)));if(id)planMap.set(sourceId,id);
    }
    const descriptions=new Map<string,string>(input.plans.map(p=>[String(p.id),p.description]));
    for(const [kind,list] of [['ordinary',input.ordinary],['extraordinary',input.extraordinary]] as const)for(const r of list){
        const sourceId=kind+':'+r.id,machineId=machineMap.get(String(r.machineId)),planId=kind==='ordinary'?planMap.get(String(r.planId)):null;
        const label=`${r.machineId} · ${r.date} · ${kind==='ordinary'?descriptions.get(String(r.planId)):r.description}`;
        if(!machineId||kind==='ordinary'&&!planId){skipped.push({kind:'record',sourceId,label,reason:'Macchina o manutenzione prevista non disponibile in AyPi'});continue;}
        const value={machineId,planId,kind,date:r.date,description:kind==='ordinary'?descriptions.get(String(r.planId)):r.description,notes:r.notes||'',attachments:[]};
        const old=rows.record.find(e=>e.kind===kind&&String(e.legacy?.sourceId??'')===String(r.id))||find('record',sourceId,e=>e.kind===kind&&e.machineId===machineId&&e.planId===planId&&e.date===r.date&&canonical(e.description)===canonical(value.description));
        delete value.attachments;
        const id=merge('record',sourceId,label,value,old);if(id)recordMap.set(sourceId,id);
    }
    const known=new Set(existing.attachments.map(a=>attachmentSignature(a.record_id||a.recordId,a))),removed=new Set(existing.removedAttachments);
    for(const a of input.attachments){const recordId=recordMap.get(a.recordId);if(!recordId)continue;const signature=attachmentSignature(recordId,a);if(known.has(signature)||removed.has(signature))continue;
        attachments.push({...a,id:randomUUID(),recordId});known.add(signature);counts.attachments++;addedItems.push({kind:'attachment',sourceId:String(a.id),label:a.name});
    }
    return {writes,attachments,aliases,report:{added:counts,addedItems,unchanged,changed,skipped,excludedAnomalies:input.cleanup?.excluded?.length||0,discardedManualDates:input.cleanup?.manualDatesDiscarded||0}};
}
