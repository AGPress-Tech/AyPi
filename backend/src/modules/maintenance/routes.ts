import type {Router} from '../../shared/http/router';
import {getAssignees} from '../shared/service';
import {getRequestActor} from '../../shared/http/context';
import {unauthorized,badRequest} from '../../shared/http/errors';
import {readJsonBody} from '../../shared/http/request';
import {sendJson} from '../../shared/http/response';
import {deleteMaintenanceEntity,importMaintenance,maintenanceAttachment,maintenancePreferences,maintenanceSnapshot,saveMaintenanceEntity,previewMaintenanceSync,applyMaintenanceSync,cancelMaintenanceSync} from './service';
import type {EntityKind} from './model';
export function registerMaintenanceRoutes(router:Router){
    const employees=()=>getAssignees() as any;
    const actor=(req:any)=>{const name=getRequestActor(req);if(!Object.values(employees()?.groups||{}).flat().some((v:any)=>String(v).trim().toLocaleLowerCase('it')===name.toLocaleLowerCase('it')))throw unauthorized('Seleziona un dipendente dall’elenco per accedere alle manutenzioni.');return name};
    const kind=(s:string):EntityKind=>{if(!['machine','plan','record'].includes(s))throw badRequest('Tipo scheda non valido.');return s as EntityKind};
    router.register('GET','/api/maintenance/employees',async(_req,res)=>sendJson(res,200,{groups:employees()?.groups||{}}));
    router.register('GET','/api/maintenance/snapshot',async(req,res)=>{actor(req);res.setHeader('Cache-Control','no-store');sendJson(res,200,maintenanceSnapshot())});
    router.register('POST','/api/maintenance/entities/:kind',async(req,res,p)=>{const user=actor(req),body=await readJsonBody(req);sendJson(res,200,{entity:saveMaintenanceEntity(kind(p.kind),body,user)})});
    router.register('POST','/api/maintenance/delete/:kind',async(req,res,p)=>{const user=actor(req),body:any=await readJsonBody(req);if(typeof body?.id!=='string'||!Number.isInteger(body?.revision))throw badRequest('Scheda non valida.');sendJson(res,200,{entity:deleteMaintenanceEntity(kind(p.kind),body.id,body.revision,user)})});
    router.register('POST','/api/maintenance/import',async(req,res)=>{const user=actor(req);sendJson(res,200,{info:importMaintenance(await readJsonBody(req),user)})});
    router.register('POST','/api/maintenance/import-preview',async(req,res)=>{const user=actor(req);sendJson(res,200,{comparison:previewMaintenanceSync(await readJsonBody(req),user)})});
    for(const cancel of [false,true])router.register('POST',cancel?'/api/maintenance/import-cancel':'/api/maintenance/import-apply',async(req,res)=>{const user=actor(req),body:any=await readJsonBody(req);if(typeof body?.token!=='string'||body.token.length>100)throw badRequest('Confronto non valido.');sendJson(res,200,cancel?cancelMaintenanceSync(body.token,user):{report:applyMaintenanceSync(body.token,user)})});
    router.register('GET','/api/maintenance/attachments/:id',async(req,res,p)=>{actor(req);res.setHeader('Cache-Control','no-store');sendJson(res,200,maintenanceAttachment(p.id))});
    router.register('GET','/api/maintenance/preferences',async(req,res)=>sendJson(res,200,{preferences:maintenancePreferences(actor(req))}));
    router.register('PUT','/api/maintenance/preferences',async(req,res)=>{const user=actor(req),value=await readJsonBody(req);sendJson(res,200,{preferences:maintenancePreferences(user,value)})});
}
