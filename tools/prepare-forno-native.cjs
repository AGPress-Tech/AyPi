/* Prepara la libreria SQLite per il runtime Electron distribuito, senza compilatori sul server. */
const fs=require('fs');const path=require('path');const zlib=require('zlib');const crypto=require('crypto');const {execFileSync}=require('child_process');
async function main(){
 const root=path.resolve(__dirname,'..');
 const version=require('better-sqlite3/package.json').version;
 const electron=require('electron');
 const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};
 const runtime=JSON.parse(execFileSync(electron,['-e','console.log(JSON.stringify({abi:process.versions.modules,platform:process.platform,arch:process.arch}))'],{env,windowsHide:true,encoding:'utf8'}).trim());
 const name=`electron-v${runtime.abi}-${runtime.platform}-${runtime.arch}`;
 const destination=path.join(root,'backend/resources/forno/native',name,'better_sqlite3.node');
 if(fs.existsSync(destination)&&fs.existsSync(destination+'.version')&&fs.readFileSync(destination+'.version','utf8')===version){console.log('SQLite Electron pronto:',name);return;}
 const asset=`better-sqlite3-v${version}-${name}.tar.gz`;
 const url=`https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${asset}`;
 const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error(`Download SQLite ${response.status}: ${url}`);
 const tar=zlib.gunzipSync(Buffer.from(await response.arrayBuffer()));let binary;
 for(let offset=0;offset+512<=tar.length;){
  const header=tar.subarray(offset,offset+512);const entry=header.subarray(0,100).toString().split('\0')[0];
  const size=parseInt(header.subarray(124,136).toString().replace(/\0/g,'').trim()||'0',8);
  if(!Number.isSafeInteger(size)||size<0||offset+512+size>tar.length)throw new Error('Archivio SQLite non valido');
  if(entry==='build/Release/better_sqlite3.node')binary=tar.subarray(offset+512,offset+512+size);
  offset+=512+Math.ceil(size/512)*512;
 }
 if(!binary)throw new Error('Binario SQLite mancante nel rilascio ufficiale');
 fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,binary);fs.writeFileSync(destination+'.version',version);
 console.log('SQLite Electron preparato:',name,'sha256',crypto.createHash('sha256').update(binary).digest('hex'));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
