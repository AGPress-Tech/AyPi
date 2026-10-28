const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {spawnSync}=require('child_process');
function resolve(payload,overrides={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-forno-boot-')),configFile=path.join(dir,'runtime.json');
 fs.writeFileSync(configFile,JSON.stringify(payload));
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('AYPI_'))delete env[key];
 Object.assign(env,{AYPI_BACKEND_CONFIG:configFile,AYPI_FORNO_DB_PATH:path.join(dir,'forno.db')},overrides);
 const source=`const runtime=require('./dist-backend-app/config').loadBackendRuntimeConfig().config;
 const direct=require('./backend-dist/modules/forno/config').getFornoConfig();
 process.stdout.write(JSON.stringify({runtime,direct}));`;
 const result=spawnSync(process.execPath,['-e',source],{cwd:path.resolve(__dirname,'..'),env,encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('avvio forno: produzione attiva senza sezione e con vecchio enabled:false',()=>{
 for(const payload of [{},{forno:{enabled:false}},{forno:{enabled:true}}]) {
  const config=resolve(payload);assert.equal(config.runtime.forno.enabled,true);assert.equal(config.direct.enabled,true);
 }
});
test('avvio forno: configurazione precedente conserva percorso, frequenza e altri moduli',()=>{
 const config=resolve({generalDir:'D:\\AyPi\\General',port:3100,forno:{enabled:false,host:'192.168.1.165',intervalMs:1000}});
 assert.equal(config.runtime.forno.enabled,true);assert.equal(config.runtime.forno.intervalMs,1000);assert.equal(config.runtime.forno.host,'192.168.1.165');assert.equal(config.runtime.generalDir,'D:\\AyPi\\General');assert.equal(config.runtime.port,3100);
});
test('avvio forno: disattivazione esplicita e precedenza variabili ambiente',()=>{
 assert.equal(resolve({forno:{autoStart:false}}).runtime.forno.enabled,false);
 for(const flag of ['0','false','off','no']){
  const config=resolve({forno:{autoStart:true}},{AYPI_FORNO_ENABLED:flag});assert.equal(config.runtime.forno.enabled,false);assert.equal(config.direct.enabled,false);
 }
 assert.equal(resolve({forno:{autoStart:false}},{AYPI_FORNO_ENABLED:'1'}).runtime.forno.enabled,true);
});
test('avvio forno: sviluppo disattivato, attivazione soltanto esplicita',()=>{
 const config=resolve({forno:{enabled:true}},{AYPI_BACKEND_PROFILE:'dev'});assert.equal(config.runtime.forno.enabled,false);assert.equal(config.direct.enabled,false);
 assert.equal(resolve({forno:{autoStart:true}},{AYPI_BACKEND_PROFILE:'dev'}).runtime.forno.enabled,true);
 assert.equal(resolve({},{AYPI_BACKEND_PROFILE:'dev',AYPI_FORNO_ENABLED:'1'}).direct.enabled,true);
});
