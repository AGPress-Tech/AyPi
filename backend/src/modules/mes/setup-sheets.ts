import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { getMesSqliteDatabase, runMesSqliteTransaction } from '../../shared/db/mes-sqlite';
import { HttpError } from '../../shared/http/errors';
import { getTransferItem, getTransferItems, getTransferAttachmentPath } from '../transfer-attrezzaggio/service';
import { getHaasItem, getHaasItems, getHaasAttachmentPath } from '../haas-attrezzaggio/service';
import { initializeMesSqliteStore } from './repository';

function rows(sql: string, params: any[] = []) {
    const result = getMesSqliteDatabase().exec(sql,params);
    return (result?.[0]?.values || []).map((r: any[]) => Object.fromEntries(result[0].columns.map((c: string,i: number) => [c,r[i]])));
}
function sheetLabel(item: any) {
    return [item.codiceArticolo || item.code,
        item.fase ? `Fase ${item.fase}` : '',
        item.metodoVariante || item.metodo,
        item.codiceMacchina || item.macchina].filter(Boolean).join(' · ');
}
export function setupSheetPreview(type: string, recordId: string) {
    const sheet=type==='TRANSFER'?getTransferItem(recordId):type==='CENTRI'?getHaasItem(recordId):null;
    if(!sheet) throw new HttpError(404,'Scheda non trovata.');
    return {type,recordId:sheet.recordId,label:sheetLabel(sheet),sheet};
}
export function setupSheetCatalog(search = '') {
    const normalize = (item: any, type: string) => ({ type,recordId:item.recordId,article:item.codiceArticolo,
        machine:item.codiceMacchina || item.macchina || '',phase:item.fase || '',
        label:sheetLabel(item),
        updatedAt:item.updatedAt });
    const query=search.toLocaleLowerCase('it');
    return [...getTransferItems().map((i: any)=>normalize(i,'TRANSFER')),...getHaasItems().map((i: any)=>normalize(i,'CENTRI'))]
        .filter(i=>!query || `${i.label} ${i.type}`.toLocaleLowerCase('it').includes(query));
}
export function phaseSetupSheets(phaseId: string) {
    initializeMesSqliteStore();
    return rows("SELECT * FROM mes_setup_sheet_links WHERE phase_id = ? AND removed_at = '' ORDER BY linked_at",[phaseId])
        .map((r: any)=>({linkId:r.link_id,phaseId:r.phase_id,type:r.sheet_type,recordId:r.record_id,label:r.label,
            linkedAt:r.linked_at,linkedBy:r.linked_by,sheet:JSON.parse(r.snapshot_json)}));
}
export function linkSetupSheet(phaseId: string,type: 'TRANSFER'|'CENTRI',recordId: string,actor: string) {
    initializeMesSqliteStore();
    const sheet:any=type==='TRANSFER'?getTransferItem(recordId):getHaasItem(recordId);
    if(!sheet) throw new HttpError(404,'Scheda di attrezzaggio non trovata.');
    return runMesSqliteTransaction(db=>{
        if(!rows("SELECT phase_id FROM mes_phases WHERE phase_id = ? AND archived_at = ''",[phaseId]).length) throw new HttpError(404,'Fase non trovata.');
        const existing=rows("SELECT link_id FROM mes_setup_sheet_links WHERE phase_id = ? AND sheet_type = ? AND record_id = ? AND removed_at = ''",[phaseId,type,sheet.recordId])[0];
        if(existing) return phaseSetupSheets(phaseId);
        const now=new Date().toISOString(),linkId=randomUUID();
        const label=sheetLabel(sheet);
        db.run(`INSERT INTO mes_setup_sheet_links(link_id,phase_id,sheet_type,record_id,label,snapshot_json,linked_at,linked_by) VALUES (?,?,?,?,?,?,?,?)`,
            [linkId,phaseId,type,sheet.recordId,label,JSON.stringify(sheet),now,actor]);
        db.run(`INSERT INTO mes_audit_log(audit_id,entity_type,entity_id,action,payload_json,occurred_at,actor,request_id)
            VALUES (?,'PHASE',?,'LINK_SETUP_SHEET',?,?,?,'')`,[randomUUID(),phaseId,JSON.stringify({linkId,type,recordId:sheet.recordId}),now,actor]);
        return phaseSetupSheets(phaseId);
    });
}
export function unlinkSetupSheet(phaseId: string,linkId: string,actor: string) {
    initializeMesSqliteStore();
    return runMesSqliteTransaction(db=>{
        const now=new Date().toISOString();
        db.run("UPDATE mes_setup_sheet_links SET removed_at = ? WHERE link_id = ? AND phase_id = ? AND removed_at = ''",[now,linkId,phaseId]);
        db.run(`INSERT INTO mes_audit_log(audit_id,entity_type,entity_id,action,payload_json,occurred_at,actor,request_id)
            VALUES (?,'PHASE',?,'UNLINK_SETUP_SHEET',?,?,?,'')`,[randomUUID(),phaseId,JSON.stringify({linkId}),now,actor]);
        return phaseSetupSheets(phaseId);
    });
}
export function setupSheetAttachment(linkId: string,attachmentId: string) {
    initializeMesSqliteStore();
    const link=rows('SELECT * FROM mes_setup_sheet_links WHERE link_id = ?',[linkId])[0];
    if(!link) throw new HttpError(404,'Collegamento non trovato.');
    const sheet=JSON.parse(link.snapshot_json);
    const attachment=(sheet.attachments || []).find((a: any)=>a.id===attachmentId);
    if(!attachment) throw new HttpError(404,'Allegato non trovato nella scheda.');
    const file=link.sheet_type==='TRANSFER'?getTransferAttachmentPath(attachment.storedName):getHaasAttachmentPath(attachment.storedName);
    if(!fs.existsSync(file)) throw new HttpError(404,"L'allegato originale non è più disponibile.");
    if(fs.statSync(file).size>20*1024*1024) throw new HttpError(413,'Allegato superiore a 20 MB.');
    const extension=path.extname(file).toLowerCase();
    if(!['.pdf','.png','.jpg','.jpeg','.gif','.webp'].includes(extension)) throw new HttpError(400,'Formato allegato non supportato.');
    return { fileName:`scheda${extension}`,dataBase64:fs.readFileSync(file).toString('base64') };
}
