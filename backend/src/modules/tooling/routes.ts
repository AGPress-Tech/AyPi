import type {Router} from '../../shared/http/router';
import {getAssignees} from '../shared/service';
import {getRequestActor} from '../../shared/http/context';
import {unauthorized,badRequest} from '../../shared/http/errors';
import {readJsonBody} from '../../shared/http/request';
import {sendJson} from '../../shared/http/response';
import {analyticsService} from '../analytics/service';
import * as service from './service';
export function registerToolingRoutes(router:Router,erp=analyticsService){
 const groups=()=>((getAssignees() as any)?.groups||{}),actor=(req:any)=>{const name=getRequestActor(req);if(!Object.values(groups()).flat().some(x=>String(x).toLocaleLowerCase('it')===name.toLocaleLowerCase('it')))throw unauthorized('Selezionare un dipendente.');return name;};
 const get=(route:string,run:(req:any,p:any)=>any)=>router.register('GET','/api/tooling/'+route,async(req,res,p)=>{actor(req);res.setHeader('Cache-Control','no-store');sendJson(res,200,await run(req,p));});
 const post=(route:string,run:(v:any,user:string,p:any)=>any)=>router.register('POST','/api/tooling/'+route,async(req,res,p)=>{const user=actor(req),v=await readJsonBody(req);sendJson(res,200,await run(v,user,p));});
 router.register('GET','/api/tooling/employees',async(_req,res)=>sendJson(res,200,{groups:groups()}));
 get('snapshot',()=>service.snapshot());get('audit/:id',(_req,p)=>({audit:service.audit(p.id)}));get('attachments/:id',(_req,p)=>service.attachment(p.id));get('preferences',(req)=>({preferences:service.preferences(actor(req))}));
 post('articles/search',async v=>{try{return await erp.articleDirectory(v.search,v.exact===true);}catch{throw badRequest('Ricerca articoli non riuscita. Verificare il gestionale e riprovare.');}});
 post('save/:kind',async(v,user,p)=>{let article;if(p.kind==='article'||p.kind==='link'&&v.erpCode){const result=await erp.articleDirectory(v.erpCode,true);article=result.articles.find(a=>a.code===v.erpCode);}return {entity:service.save(p.kind,v,user,article)};});
 post('delete/:kind',(v,user,p)=>({entity:service.remove(p.kind,v,user)}));post('movement',(v,user)=>({entity:service.move(v,user)}));post('void',(v,user)=>service.voidMovement(v,user));
 post('preferences',(v,user)=>({preferences:service.preferences(user,v)}));post('import-preview',(v,user)=>service.previewImport(v,user));post('import-apply',(v,user)=>service.applyImport(v.token,user));post('import-cancel',(v,user)=>service.cancelImport(v.token,user));
}
