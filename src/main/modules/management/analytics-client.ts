import http from "http";
import https from "https";
import { gunzip } from "zlib";
import { promisify } from "util";
const unzip=promisify(gunzip);
export type SqlDataset={columns:string[];rows:unknown[][];rowCount:number;queriedAt:string;source:string;queryId:string};

export function createAnalyticsClient(getBaseUrl:()=>string,getCredential:()=>string|null) {
    let token="",expires=0,authentication:Promise<void>|null=null;
    async function request(pathname:string,method:string,body?:unknown,bearer=token):Promise<any> {
        const url=new URL(pathname,getBaseUrl()),transport=url.protocol==="https:" ? https : http;
        const payload=body===undefined ? null : JSON.stringify(body);
        return new Promise((resolve,reject)=>{
            const req=transport.request(url,{method,headers:{"Content-Type":"application/json","Accept-Encoding":"gzip",...(bearer ? {Authorization:`Bearer ${bearer}`} : {}),...(payload ? {"Content-Length":Buffer.byteLength(payload)} : {})}},res=>{
                const chunks:Buffer[]=[];let bytes=0;
                res.on("data",chunk=>{bytes+=chunk.length;if(bytes>256*1024*1024){req.destroy(new Error("Risposta del backend troppo grande."));return;}chunks.push(Buffer.from(chunk));});
                res.on("error",reject);
                res.on("aborted",()=>reject(new Error("Lettura dal backend interrotta.")));
                res.on("end",async()=>{
                    try{
                        const buffer=Buffer.concat(chunks);
                        const raw=res.headers["content-encoding"]==="gzip" ? await unzip(buffer,{maxOutputLength:256*1024*1024}) : buffer;
                        const parsed=JSON.parse(raw.toString("utf8"));
                        if((res.statusCode||500)>=400){const error:any=new Error(res.statusCode===404 ? "Aggiornare il backend AyPi per abilitare le analisi SQL." : parsed.error || "Errore del backend analisi.");error.statusCode=res.statusCode;reject(error);}
                        else resolve(parsed);
                    }catch(error){reject(error);}
                });
            });
            req.setTimeout(120000,()=>req.destroy(new Error("Timeout del backend analisi.")));
            req.on("error",reject);if(payload)req.write(payload);req.end();
        });
    }
    async function authenticate() {
        if(token&&expires>Date.now()+10000)return;
        if(!authentication)authentication=(async()=>{
            const password=getCredential();if(!password)throw new Error("Premere F2 per autorizzare il controllo di gestione.");
            const session=await request("/api/analytics/session","POST",{password},"");
            if(!getCredential())throw new Error("Sessione amministratore terminata.");
            token=session.token;expires=session.expires;
        })().finally(()=>{authentication=null;});
        return authentication;
    }
    return {async query(id:string,parameters:Record<string,unknown>={}):Promise<SqlDataset>{
        await authenticate();
        try{return await request(`/api/analytics/query/${encodeURIComponent(id)}`,"POST",parameters);}
        catch(error){if((error as any).statusCode!==401)throw error;token="";expires=0;await authenticate();return request(`/api/analytics/query/${encodeURIComponent(id)}`,"POST",parameters);}
    },async logout(){const old=token;token="";expires=0;if(old)await request("/api/analytics/session","DELETE",undefined,old).catch(()=>{});}};
}
