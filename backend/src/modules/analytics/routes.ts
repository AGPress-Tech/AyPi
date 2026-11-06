import { randomBytes, timingSafeEqual, createHash } from "crypto";
import { gzip } from "zlib";
import { promisify } from "util";
import type { Router } from "../../shared/http/router";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import { ANALYTICS_QUERIES, queryDefinition, queryParameters } from "./catalog";
import { analyticsService } from "./service";
const compress=promisify(gzip);
const digest=(value:string)=>createHash("sha256").update(value).digest();

export function registerAnalyticsRoutes(router:Router,service=analyticsService) {
    const sessions=new Map<string,{ip:string;expires:number}>(), attempts=new Map<string,{count:number;until:number}>();
    const ip=(req:any)=>req.socket?.remoteAddress || "";
    const authorize=(req:any,res:any)=>{
        const token=String(req.headers.authorization||"").replace(/^Bearer /,"");
        const session=sessions.get(token);
        if(!session||session.expires<Date.now()||session.ip!==ip(req)){if(session)sessions.delete(token);sendJson(res,401,{error:"Sessione analisi scaduta o non autorizzata."});return false;}
        res.setHeader("Cache-Control","no-store");return true;
    };
    router.register("POST","/api/analytics/session",async(req,res)=>{
        const now=Date.now(),address=ip(req);
        for(const [key,value] of sessions)if(value.expires<now)sessions.delete(key);
        for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);
        const trial=attempts.get(address);
        if(trial&&trial.count>=5){sendJson(res,429,{error:"Troppi tentativi. Riprovare tra un minuto."});return;}
        try{
            const payload=await readJsonBody<any>(req),config=await service.config();
            if(typeof payload?.password!=="string"||!timingSafeEqual(digest(payload.password),digest(config.accessPassword))){attempts.set(address,{count:(trial?.count||0)+1,until:trial?.until||now+60000});sendJson(res,401,{error:"Accesso alle analisi non autorizzato."});return;}
            if(sessions.size>=1000){sendJson(res,503,{error:"Servizio analisi occupato."});return;}
            attempts.delete(address);const token=randomBytes(32).toString("hex"),expires=now+30*60000;
            sessions.set(token,{ip:address,expires});res.setHeader("Cache-Control","no-store");sendJson(res,200,{token,expires});
        }catch{sendJson(res,503,{error:"Accesso SQL non configurato sul backend. Eseguire configure-sql-analytics.ps1 sul server."});}
    });
    router.register("DELETE","/api/analytics/session",async(req,res)=>{if(!authorize(req,res))return;sessions.delete(String(req.headers.authorization).slice(7));sendJson(res,200,{ok:true});});
    router.register("GET","/api/analytics/catalog",async(req,res)=>{if(!authorize(req,res))return;sendJson(res,200,{queries:Object.entries(ANALYTICS_QUERIES).map(([id,q])=>({id,title:q.title,columns:q.columns,parameters:["fromYear","toYear"]}))});});
    router.register("POST","/api/analytics/query/:id",async(req,res,params)=>{
        if(!authorize(req,res))return;
        let input:any;
        try{queryDefinition(params.id);input=await readJsonBody(req)||{};queryParameters(input);}catch{sendJson(res,400,{error:"Analisi o parametri non validi."});return;}
        try{
            const result=await service.query(params.id,input);
            if(res.destroyed)return;
            const body=Buffer.from(JSON.stringify(result));
            if(/\bgzip\b/.test(String(req.headers["accept-encoding"]||""))){const zipped=await compress(body);res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Content-Encoding":"gzip","Content-Length":zipped.length,"Vary":"Accept-Encoding"});res.end(zipped);}
            else{res.writeHead(200,{"Content-Type":"application/json; charset=utf-8","Content-Length":body.length});res.end(body);}
        }catch{sendJson(res,503,{error:"Lettura SQL non riuscita. Verificare connessione e configurazione del backend e riprovare."});}
    });
}
