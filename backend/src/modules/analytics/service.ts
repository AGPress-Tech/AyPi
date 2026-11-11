import { loadAnalyticsConfig, AnalyticsConfig } from "./config";
import { queryDefinition, queryParameters } from "./catalog";
import { buildArticleOrderQuery } from "./article-orders";
import { buildArticleOfferQuery } from "./article-offers";
import {customerSearchQuery,customerAnalysisQuery} from './customer-analysis';
import {documentLinksQuery} from './document-links';
const sql = require("mssql");

export type AnalyticsDataset={queryId:string;columns:string[];rows:unknown[][];queriedAt:string;source:string;rowCount:number};
export function createAnalyticsService(getConfig=loadAnalyticsConfig, driver=sql, maxRows=750000) {
    let configPromise:Promise<AnalyticsConfig>|null=null,poolPromise:Promise<any>|null=null;
    const pending=new Map<string,Promise<AnalyticsDataset>>();
    const config=()=>configPromise ||= getConfig().catch(error=>{configPromise=null;throw error;});
    async function pool() {
        if(!poolPromise)poolPromise=(async()=>{
            const c=await config();
            const connection=new driver.ConnectionPool({server:c.server,database:c.database,user:c.user,password:c.password,
                ...(c.port ? {port:c.port} : {}),connectionTimeout:15000,requestTimeout:90000,
                pool:{min:0,max:3,idleTimeoutMillis:30000},options:{...(c.port ? {} : {instanceName:c.instance}),encrypt:c.encrypt,trustServerCertificate:c.trustServerCertificate,useUTC:true,appName:"AyPi Analytics"}});
            connection.on("error",()=>{poolPromise=null;void connection.close().catch(()=>{});});
            return connection.connect();
        })().catch(error=>{poolPromise=null;throw error;});
        return poolPromise;
    }
    async function query(id:string,input:unknown):Promise<AnalyticsDataset> {
        const definition=queryDefinition(id),params=queryParameters(input),key=JSON.stringify([id,params]);
        if(pending.has(key))return pending.get(key)!;
        if(pending.size>=2)throw new Error("Altre analisi sono in corso. Riprovare tra qualche secondo.");
        const operation=(async()=>{
            const c=await config(),connection=await pool(),request=connection.request();
            request.input("fromDate",driver.Date,params.fromDate);request.input("toDate",driver.Date,params.toDate);
            request.stream=true;
            return new Promise<AnalyticsDataset>((resolve,reject)=>{
                const rows:unknown[][]=[];let failed=false;
                const fail=(error:unknown)=>{if(!failed){failed=true;reject(error);}};
                request.on("row",row=>{
                    if(failed)return;
                    if(rows.length>=maxRows){fail(new Error("Troppi movimenti: restringere il periodo di analisi."));request.cancel();return;}
                    rows.push(definition.columns.map(name=>row[name] instanceof Date ? row[name].toISOString().slice(0,10) : row[name] ?? null));
                });
                request.on("error",error=>fail(error));
                request.on("done",()=>{if(!failed)resolve({queryId:id,columns:[...definition.columns],rows,rowCount:rows.length,queriedAt:new Date().toISOString(),source:`${c.server}\\${c.instance} / ${c.database}`});});
                request.query(definition.sql).catch(fail);
            });
        })();
        pending.set(key,operation);
        try{return await operation;}finally{pending.delete(key);}
    }
    let articleRequests=0;
    async function executeArticleQuery(definition:ReturnType<typeof buildArticleOrderQuery>){
        if(articleRequests>=3)throw new Error('Altre ricerche sono in corso. Riprovare tra qualche secondo.');
        articleRequests++;
        try{
            const connection=await pool(),request=connection.request();
            for(const p of definition.bindings)request.input(p.name,p.type==='text'?driver.VarChar(128*2+2):p.type==='date'?driver.Date:p.type==='int'?driver.Int:driver.Float,p.type==='date'?new Date(`${p.value}T00:00:00Z`):p.value);
            const result=await request.query(definition.sql);
            const rows=result.recordset.map((row:any)=>Object.fromEntries(Object.entries(row).filter(([k])=>k!=='totalRows').map(([k,v])=>[k,v instanceof Date?v.toISOString().slice(0,10):v])));
            return {rows,total:Number(result.recordset[0]?.totalRows??0),offset:definition.filters.offset,queriedAt:new Date().toISOString()};
        }finally{articleRequests--}
    }
    const articleOrders=(input:unknown)=>executeArticleQuery(buildArticleOrderQuery(input));
    const articleOffers=(input:unknown)=>executeArticleQuery(buildArticleOfferQuery(input));
    async function customerQuery(input:unknown,lookup:boolean){
        const definition=lookup?customerSearchQuery(input):customerAnalysisQuery(input);
        if(articleRequests>=3)throw Error('Altre ricerche sono in corso. Riprovare tra qualche secondo.');
        articleRequests++;
        try{
            const connection=await pool(),request=connection.request();
            for(const p of definition.bindings){const isDate='type' in p&&p.type==='date';request.input(p.name,isDate?driver.Date:driver.VarChar(258),isDate?new Date(p.value+'T00:00:00Z'):p.value);}
            const result=await request.query(definition.sql);
            if(!lookup&&result.recordset.length>100000)throw Error('Oltre 100.000 righe per questo cliente: restringere il periodo di lettura.');
            const rows=result.recordset.map((row:any)=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Date?v.toISOString().slice(0,10):v])));
            return lookup?{customers:rows.slice(0,100),more:rows.length>100}:{rows,queriedAt:new Date().toISOString(),customer:(input as any).customer};
        }finally{articleRequests--;}
    }
    const customerSearch=(input:unknown)=>customerQuery(input,true),customerAnalysis=(input:unknown)=>customerQuery(input,false);
    async function documentLinks(input:unknown){
        const definition=documentLinksQuery(input);
        if(articleRequests>=3)throw Error('Altre ricerche sono in corso. Riprovare tra qualche secondo.');
        articleRequests++;
        try{
            const connection=await pool(),request=connection.request();request.input('id',driver.Int,definition.bindings[0].value);
            const result=await request.query(definition.sql);
            if(result.recordset.length>10000)throw Error('Troppi documenti collegati per questa ricerca.');
            return {rows:result.recordset.map((row:any)=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v instanceof Date?v.toISOString().slice(0,10):v]))),queriedAt:new Date().toISOString()};
        }finally{articleRequests--;}
    }
    return {config,query,articleOrders,articleOffers,customerSearch,customerAnalysis,documentLinks,async close(){const current=poolPromise;poolPromise=null;configPromise=null;if(current)await(await current).close();}};
}
export const analyticsService=createAnalyticsService();
