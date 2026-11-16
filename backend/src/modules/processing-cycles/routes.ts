import type {Router} from '../../shared/http/router';
import {getRequestActor} from '../../shared/http/context';
import {readJsonBody} from '../../shared/http/request';
import {sendJson} from '../../shared/http/response';
import {listProcessingCycles,loadProcessingCycle,saveProcessingCycle,deleteProcessingCycle} from './service';
export function registerProcessingCyclesRoutes(router:Router){
    const base='/api/processing-cycles/items';
    router.register('GET',base,async(_req,res)=>sendJson(res,200,{items:listProcessingCycles()}));
    router.register('GET',base+'/:id',async(_req,res,p)=>sendJson(res,200,{item:loadProcessingCycle(p.id)}));
    router.register('POST',base,async(req,res)=>sendJson(res,200,{item:saveProcessingCycle(await readJsonBody(req),getRequestActor(req))}));
    router.register('DELETE',base+'/:id',async(req,res,p)=>{const body:any=await readJsonBody(req);deleteProcessingCycle(p.id,body.revision,getRequestActor(req));sendJson(res,200,{ok:true});});
}
