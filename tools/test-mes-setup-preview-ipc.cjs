const assert=require('node:assert/strict');
const Module=require('node:module');
const original=Module._load;
Module._load=function(name,...args){if(name==='electron')return {app:{},shell:{}};if(name==='electron-log')return {info(){},warn(){},error(){}};return original.call(this,name,...args);};
const {registerProductionPlannerIpc}=require('../dist-ts/modules/file-manager/production-planner-ipc');
Module._load=original;
async function scenario(type,error){
 const handlers=new Map(),calls=[];
 registerProductionPlannerIpc({handle:(name,handler)=>handlers.set(name,handler)},async url=>{
  calls.push(url);
  if(url.startsWith('/api/mes/setup-sheets/')){if(error)throw new Error(error);return {type,recordId:'id',sheet:{note:'Direct'}};}
  return {item:{recordId:'id',codiceArticolo:'ART',fase:'01',metodoVariante:'Variante B',codiceMacchina:'TR1'}};
 });
 return {result:await handlers.get('mes-setup-preview')(null,{type,recordId:'id'}),calls};
}
(async()=>{
 let test=await scenario('TRANSFER');assert.equal(test.result.data.sheet.note,'Direct');assert.equal(test.calls.length,1);
 for(const type of ['TRANSFER','CENTRI']){
  test=await scenario(type,'Backend GET failed (404): Route not found');
  assert.equal(test.result.ok,true);assert.equal(test.result.data.recordId,'id');assert.match(test.result.data.label,/Variante B/);
  assert.ok(test.calls[1].includes(type==='TRANSFER'?'transfer-attrezzaggio':'haas-attrezzaggio'));
 }
 for(const error of ['Backend GET failed (404): Scheda non trovata.','Backend GET failed (500): Database unavailable']){
  test=await scenario('TRANSFER',error);assert.equal(test.result.ok,false);assert.equal(test.calls.length,1);
 }
 console.log('MES setup preview IPC compatibility: OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
