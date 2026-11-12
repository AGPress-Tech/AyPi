const assert=require('node:assert/strict');
const {validateBomRequest,bomAnalysisQuery}=require('../backend-dist/modules/analytics/bom-analysis');
const {BOM_COLUMNS,emptyBomSearch,filterBomRows,summarizeBomRows,bomExportRows,validateBomSearch,validateBomPreferences}=require('../dist-ts/modules/bom-analysis/model');
assert.deepEqual(validateBomRequest({article:' A '}),{article:'A'});
for(const v of [null,[],{sql:'DROP TABLE'},{article:1},{bom:''}])assert.throws(()=>validateBomRequest(v));
const injection="A'; DROP TABLE x;--",query=bomAnalysisQuery({article:injection,bom:'B'});
assert(!query.sql.includes(injection));assert(query.sql.includes('c.Component=@article'));assert(query.sql.includes('b.BOM=@bom'));assert.equal(query.bindings[0].value,injection);
assert(query.sql.includes('LEFT JOIN MA_BillOfMaterialsComp'));assert(query.sql.includes('TOP (100001)'));assert(!query.sql.includes('MA_Tmp'));
const rows=[{bom:'B1',component:'A',quantity:.123456,disabled:0,modified:'2026-10-01',notes:'Test'},{bom:'B2',component:'A',quantity:2,disabled:1,modified:'2025-01-01',notes:'abc'},{bom:'B3',component:'Z',quantity:3,disabled:0},{bom:'EMPTY',component:null,line:null}];
const search=(rules=[],mode='where-used')=>({...emptyBomSearch(),rules,mode});
const repeated=[{bom:'B1',component:'A',line:1,quantity:1,bomDescription:'Uno'},{bom:'B1',component:'A',line:2,quantity:2,bomDescription:'Uno'},{bom:'B1',component:'Z',line:3,quantity:3,bomDescription:'Uno'},{bom:'B2',component:'A',line:1,quantity:4,bomDescription:'Due'}];
assert.equal(summarizeBomRows(repeated).length,2);assert.equal(summarizeBomRows(repeated)[0].quantity,undefined);assert.equal(summarizeBomRows(repeated)[0].component,undefined);
const byA=search([{field:'component',op:'exact',value:'A'}]);
assert.equal(bomExportRows(repeated,byA,'summary').length,2);assert.equal(bomExportRows(repeated,byA,'exploded').length,4);
assert.equal(bomExportRows(repeated,search([{field:'quantity',op:'exact',value:'3'}]),'summary')[0].bom,'B1');
assert.equal(bomExportRows(repeated,search([{field:'bom',op:'exact',value:'B1'}],'composition'),'summary').length,1);
assert.equal(filterBomRows(rows,search()).length,3);assert.equal(filterBomRows(rows,search([],'composition')).length,4);
assert.equal(filterBomRows(rows,search([{field:'component',op:'exact',value:'a'}])).length,2);
assert.equal(filterBomRows(rows,search([{field:'component',op:'exact',value:'A'},{field:'component',op:'exact',value:'Z'},{field:'disabled',op:'exact',value:'0'}])).length,2);
assert.equal(filterBomRows(rows,search([{field:'quantity',op:'range',value:'0',to:'1'}]))[0].quantity,.123456);
assert.equal(filterBomRows(rows,search([{field:'modified',op:'range',value:'2026-01-01'}])).length,1);
assert.throws(()=>validateBomSearch(search([{field:'quantity',op:'range',value:'3',to:'2'}])));
assert.throws(()=>validateBomSearch(search([{field:'modified',op:'exact',value:'2026-02-30'}])));
assert.throws(()=>validateBomSearch(search([{field:'__proto__',op:'contains',value:'a'}])));
for(const c of BOM_COLUMNS){const value=c.kind==='boolean'?0:c.kind==='number'?42:c.kind==='date'?'2026-11-11':'ABC';const r={bom:'B',component:'A',[c.key]:value};assert.equal(filterBomRows([r],search([{field:c.key,op:'exact',value:String(value)}],'composition')).length,1,c.key)}
assert.throws(()=>validateBomPreferences({version:1,columns:['bom'],presets:[{name:'Same',search:search(),columns:['bom']},{name:'Same',search:search(),columns:['bom']}]}));
const {createAnalyticsService}=require('../backend-dist/modules/analytics/service');
(async()=>{let captured;class Pool{on(){}async connect(){return this}request(){return {input(){},async query(q){captured=q;return {recordset:[{bom:'B',created:new Date('2026-01-01')}]}}}}async close(){}}
 const service=createAnalyticsService(async()=>({server:'mock'}),{ConnectionPool:Pool,VarChar:()=>0});
 const result=await service.bomAnalysis({});assert.equal(result.rows[0].created,'2026-01-01');assert(captured.includes('MA_BillOfMaterials'));await service.close();
 const {Router}=require('../backend-dist/shared/http/router'),{registerAnalyticsRoutes}=require('../backend-dist/modules/analytics/routes'),http=require('node:http');
 const router=new Router();let fail=false,calls=0;
 registerAnalyticsRoutes(router,{bomAnalysis:async input=>{calls++;if(fail)throw Error('PRIVATE_SQL_DETAIL');return {rows:[{bom:input.bom||'B'}]}}});
 const server=http.createServer((req,res)=>void router.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const post=body=>fetch(`http://127.0.0.1:${server.address().port}/api/erp/bom-analysis`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({sql:'arbitrary'})).status,400);assert.equal(calls,0);
  const good=await post({bom:'BOM-1'});assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'no-store');assert.equal((await good.json()).rows[0].bom,'BOM-1');
  fail=true;const bad=await post({});assert.equal(bad.status,503);assert(!(await bad.text()).includes('PRIVATE_SQL_DETAIL'));
 }finally{await new Promise(resolve=>server.close(resolve))}
 console.log('OK: BoM SQL parametrizzato, filtri su tutti i campi, alternative OR/AND, date, precisione, preset, servizio e route HTTP.');
})().catch(e=>{console.error(e);process.exit(1)});
