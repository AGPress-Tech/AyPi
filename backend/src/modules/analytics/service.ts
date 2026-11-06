import { loadAnalyticsConfig, AnalyticsConfig } from "./config";
import { queryDefinition, queryParameters } from "./catalog";
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
    return {config,query,async close(){const current=poolPromise;poolPromise=null;configPromise=null;if(current)await(await current).close();}};
}
export const analyticsService=createAnalyticsService();
