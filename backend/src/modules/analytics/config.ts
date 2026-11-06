import fs from "fs";
import path from "path";
import { execFile } from "child_process";

export type AnalyticsConfig = {
    server:string; instance:string; database:string; user:string; password:string;
    accessPassword:string; encrypt:boolean; trustServerCertificate:boolean; port?:number;
};
export function analyticsCredentialsPath() {
    return process.env.AYPI_ANALYTICS_CREDENTIALS_FILE || path.join(process.env.ProgramData || "C:\\ProgramData","AGPress","AyPiBackend","sql-analytics.credentials.json");
}
function unprotect(cipher:string):Promise<string> {
    return new Promise((resolve,reject)=>{
        const script="Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $v=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($v))";
        const child=execFile("powershell.exe",["-NoProfile","-NonInteractive","-Command",script],{windowsHide:true,timeout:15000,maxBuffer:65536},(error,out)=>error ? reject(new Error("Impossibile decifrare la configurazione SQL su questo server.")) : resolve(out));
        child.stdin!.end(cipher);
    });
}
export async function loadAnalyticsConfig():Promise<AnalyticsConfig> {
    let raw:any={};
    const file=analyticsCredentialsPath();
    if(fs.existsSync(file))raw=JSON.parse((await fs.promises.readFile(file,"utf8")).replace(/^\uFEFF/,""));
    const password=process.env.AYPI_ANALYTICS_SQL_PASSWORD || (raw.passwordProtected ? await unprotect(raw.passwordProtected) : "");
    if(!password)throw new Error("Configurare l’accesso SQL sul server con configure-sql-analytics.ps1.");
    return {server:process.env.AYPI_ANALYTICS_SQL_SERVER || raw.server || "DL360",instance:raw.instance ?? "SQL2017",database:raw.database || "NuovaAGP",user:raw.user || "sa",password,
        accessPassword:process.env.AYPI_ANALYTICS_ACCESS_PASSWORD || raw.accessPassword || "AGPress",
        encrypt:raw.encrypt!==false,trustServerCertificate:raw.trustServerCertificate!==false,
        ...(Number.isInteger(raw.port)&&raw.port>0&&raw.port<65536 ? {port:raw.port} : {}),
    };
}
