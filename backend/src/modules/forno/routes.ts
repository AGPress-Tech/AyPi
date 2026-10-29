import type { Router } from '../../shared/http/router';
import { badRequest } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/response';
import { fornoRequest, getFornoStatus } from './service';
import { readJsonBody } from '../../shared/http/request';
import { HttpError } from '../../shared/http/errors';
import { EVENT_TYPES } from './messages';
import { HISTORY_MIME,sendHistory } from './transport';

/** Consultazione archivio e note operatore: il campionamento resta centrale. */
export function registerFornoRoutes(router: Router) {
    router.register('GET','/api/forno/messages',async(request,response)=>{
        const q=new URL(request.url||'/','http://localhost').searchParams,fromMs=Number(q.get('fromMs')),toMs=Number(q.get('toMs'));
        const eventTypes=(q.get('eventTypes')||'').split(',').filter(Boolean);
        const revision=q.has('revision')?Number(q.get('revision')):undefined;
        if(!q.has('fromMs')||!q.has('toMs')||!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||fromMs<0||toMs<fromMs||toMs-fromMs>366*86400000||eventTypes.some(t=>!EVENT_TYPES.includes(t as any)))throw badRequest('Intervallo o tipi messaggio non validi');
        if(revision!==undefined&&(!Number.isSafeInteger(revision)||revision<0))throw badRequest('Revisione messaggi non valida');
        sendJson(response,200,await fornoRequest('messages',{fromMs,toMs,eventTypes,revision,showNotes:q.get('showNotes')!=='0'}));
    });
    const mutation=async(command:string,request:any,input:any)=>{
        const actor=String(request.headers['x-aypi-user']||'Operatore AyPi').slice(0,120);
        try{return await fornoRequest(command,{input,actor});}catch(error){const code=(error as any).code;if(code==='NOTE_CONFLICT')throw new HttpError(409,String((error as Error).message),{code});if(code==='NOTE_NOT_FOUND')throw new HttpError(404,String((error as Error).message),{code});if(code==='NOTE_INVALID')throw badRequest(String((error as Error).message));throw error;}
    };
    router.register('POST','/api/forno/notes',async(req,res)=>sendJson(res,201,await mutation('note_save',req,await readJsonBody(req))));
    router.register('PUT','/api/forno/notes/:id',async(req,res,params)=>sendJson(res,200,await mutation('note_save',req,{...await readJsonBody<any>(req),id:params.id})));
    router.register('DELETE','/api/forno/notes/:id',async(req,res,params)=>sendJson(res,200,await mutation('note_delete',req,{...await readJsonBody<any>(req),id:params.id})));
    router.register('GET','/api/forno/sample',async(request,response)=>{
        const query=new URL(request.url||'/','http://localhost').searchParams;
        const timestampMs=Number(query.get('timestampMs'));
        if(!query.has('timestampMs')||!Number.isSafeInteger(timestampMs)||timestampMs<0)throw badRequest('Istante campione non valido');
        sendJson(response,200,await fornoRequest('sample',{timestampMs}));
    });
    router.register('GET','/api/forno/analysis',async(request,response)=>{
        const query=new URL(request.url||'/','http://localhost').searchParams;
        const fromMs=Number(query.get('fromMs')),toMs=Number(query.get('toMs')),windowSeconds=Number(query.get('windowSeconds')||60);
        if(!query.has('fromMs')||!query.has('toMs')||!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||fromMs<0||toMs<fromMs||toMs-fromMs>366*86400000||!Number.isFinite(windowSeconds)||windowSeconds<0.5||windowSeconds>86400||!Number.isSafeInteger(windowSeconds*1000))throw badRequest('Analisi non valida: intervallo massimo 366 giorni, finestra da 0,5 a 86400 secondi');
        sendJson(response,200,await fornoRequest('analysis',{fromMs,toMs,windowSeconds}));
    });
    router.register('GET', '/api/forno/status', async (_request, response) => {
        sendJson(response, 200, await getFornoStatus());
    });
    router.register('GET', '/api/forno/history', async (request, response) => {
        const query = new URL(request.url || '/', 'http://localhost').searchParams;
        const fromMs = Number(query.get('fromMs'));
        const toMs = Number(query.get('toMs'));
        const intervalMs = Number(query.get('intervalMs') || 500);
        const maxPoints = Number(query.get('maxPoints') || 2000);
        if (!query.has('fromMs') || !query.has('toMs') ||
            !Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs < 0 || toMs < fromMs || toMs-fromMs > 366*86400000 ||
            !Number.isSafeInteger(intervalMs) || intervalMs < 500 || intervalMs > 366*86400000 ||
            !Number.isSafeInteger(maxPoints) || maxPoints < 1 || maxPoints > 4000) {
            throw badRequest('Intervallo forno non valido: fromMs/toMs UTC, massimo 366 giorni, intervalMs >= 500, maxPoints 1–4000');
        }
        const binary=String(request.headers.accept||'').includes(HISTORY_MIME);
        const result=await fornoRequest(binary?'history_binary':'history', { fromMs, toMs, intervalMs, maxPoints });
        if(binary)await sendHistory(request,response,result);else sendJson(response,200,result);
    });
}
