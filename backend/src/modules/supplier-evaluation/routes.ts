import type {Router} from '../../shared/http/router';
import {getAssignees} from '../shared/service';
import {getRequestActor} from '../../shared/http/context';
import {unauthorized,badRequest,isHttpError} from '../../shared/http/errors';
import {readJsonBody} from '../../shared/http/request';
import {sendJson} from '../../shared/http/response';
import * as service from './service';
export function registerSupplierEvaluationRoutes(router:Router){
    const root='/api/supplier-evaluation',groups=()=>(getAssignees() as any)?.groups||{};
    const actor=(req:any)=>{const name=getRequestActor(req);if(!Object.values(groups()).flat().some(v=>String(v).trim().toLocaleLowerCase('it')===name.toLocaleLowerCase('it')))throw unauthorized('Seleziona un dipendente per accedere.');return name;};
    const write=async(fn:()=>any)=>{try{return await fn()}catch(e){if(isHttpError(e))throw e;throw badRequest((e as Error).message);}};
    router.register('GET',root+'/employees',async(_req,res)=>sendJson(res,200,{groups:groups()}));
    router.register('GET',root+'/snapshot',async(req,res)=>{actor(req);res.setHeader('Cache-Control','no-store');sendJson(res,200,await service.supplierSnapshot(req.url?.includes('refresh=1')))});
    router.register('POST',root+'/record',async(req,res)=>{const user=actor(req),body=await readJsonBody(req);sendJson(res,200,{entity:await write(()=>service.saveSupplierRecord(body,user))})});
    router.register('POST',root+'/delete-record',async(req,res)=>{const user=actor(req),body=await readJsonBody(req);sendJson(res,200,await write(()=>service.deleteSupplierRecord(body,user)))});
    router.register('POST',root+'/profile',async(req,res)=>{const user=actor(req),body=await readJsonBody(req);sendJson(res,200,{entity:await write(()=>service.saveSupplierProfile(body,user))})});
    router.register('PUT',root+'/settings',async(req,res)=>{const user=actor(req),body=await readJsonBody(req);sendJson(res,200,{settings:await write(()=>service.saveSupplierSettings(body,user))})});
    router.register('GET',root+'/attachment/:id',async(req,res,p)=>{actor(req);sendJson(res,200,service.supplierAttachment(p.id))});
    router.register('GET',root+'/preferences',async(req,res)=>sendJson(res,200,{preferences:service.supplierPreferences(actor(req))}));
    router.register('PUT',root+'/preferences',async(req,res)=>{const user=actor(req),body=await readJsonBody(req);sendJson(res,200,{preferences:await write(()=>service.supplierPreferences(user,body))})});
    router.register('POST',root+'/import-preview',async(req,res)=>{actor(req);sendJson(res,200,{report:await write(async()=>service.supplierImportPreview(await readJsonBody(req)))})});
    router.register('POST',root+'/import-apply',async(req,res)=>{const user=actor(req);sendJson(res,200,{report:await write(async()=>service.supplierImportApply(await readJsonBody(req),user))})});
}
