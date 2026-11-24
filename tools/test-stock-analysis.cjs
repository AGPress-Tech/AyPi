const assert=require('node:assert/strict');
const {stockAnalysisQuery,validateStockRequest}=require('../backend-dist/modules/analytics/stock-analysis');
const {normalizeStock,filterStock,groupStock,stockTotals,emptyStockSearch,validateStockSearch,validateStockColumns,validateStockPreferences,validateStockPeriods,stockVisibleColumns}=require('../dist-ts/modules/stock-analysis/model');
const base={article:'A',description:'Articolo A',unit:'NR',storage:'SEDE',storageDescription:'Principale',owned:'1',subjectCode:'-',subjectType:6750211,subjectName:'',initial:10,received:5,issued:3,reservedSales:4,reservedProduction:2,orderedPurchase:8,orderedProduction:1,minimum:5,maximum:100,picked:2,allocated:1,fiscalYear:2026,fiscalPeriod:1};
const rows=normalizeStock([base,{...base,storage:'TERZI',owned:'0',subjectType:6750208,subjectCode:'001',subjectName:'Cliente',initial:0,received:0,issued:2,minimum:3},{...base,article:'B',unit:'KG',initial:.123456789,received:0,issued:0,reservedSales:0,reservedProduction:0},{...base,article:'ZERO',initial:0,received:0,issued:0,reservedSales:0,reservedProduction:0,orderedPurchase:0,orderedProduction:0},{...base,article:'MISSING',initial:null,owned:null,unit:'',minimum:0}]);
assert.equal(rows[0].quantity,12);assert.equal(rows[0].available,6);assert.equal(rows[0].projected,15);assert.equal(rows[0].ownership,'Aziendale');assert.equal(rows[1].subjectKind,'Cliente');assert.equal(rows[1].thirdQuantity,-2);
assert.equal(rows[4].quantity,null);assert.equal(rows[4].available,null);assert.equal(rows[4].ownQuantity,null);assert(rows[4].warnings.includes('Saldo incompleto'));
assert.equal(filterStock(rows,emptyStockSearch()).length,4);
assert.equal(filterStock(rows,{...emptyStockSearch(),scope:'all'}).length,5);
assert.equal(filterStock(rows,{...emptyStockSearch(),scope:'negative'})[0].quantity,-2);
assert.equal(filterStock(rows,{...emptyStockSearch(),subjectCode:'001',subjectKind:'customer'}).length,1);
assert.equal(filterStock(rows,{...emptyStockSearch(),subjectCode:'001',subjectKind:'supplier'}).length,0);
assert.equal(filterStock(rows,{...emptyStockSearch(),storages:['TERZI'],ownership:'third'}).length,1);
assert.equal(filterStock(rows,{...emptyStockSearch(),exactArticle:'a'}).length,2);
const groups=groupStock(rows),a=groups.find(g=>g.row.article==='A');assert.equal(a.details.length,2);assert.equal(a.row.quantity,10);assert.equal(a.row.ownQuantity,12);assert.equal(a.row.thirdQuantity,-2);assert.equal(a.row.minimum,null);assert(a.row.warnings.includes('Giacenza negativa'),'Anomalies must survive compensation in article totals');
assert.equal(groupStock([...rows,{...rows[0],unit:'KG'}]).length,groups.length+1,'Different units must never be summed');
const totals=stockTotals(rows);assert.equal(totals.find(t=>t.unit==='KG').value,.123456789);assert.equal(totals.find(t=>t.unit==='U.M. non indicata').partial,true);
assert.deepEqual(stockTotals([{unit:'',quantity:0}]),[]);assert.equal(stockTotals([{unit:'',quantity:2}])[0].value,2);
const historical=[rows[0],{...rows[0],fiscalYear:2025,quantity:99}];
assert.equal(groupStock(historical).length,2,'Fiscal snapshots must never be added');
assert.deepEqual(stockTotals(historical).map(t=>[t.year,t.value]),[[2026,12],[2025,99]]);
assert.deepEqual(validateStockPeriods([{year:2025,period:1},{year:2026,period:1},{year:2025,period:1}]),[{year:2026,period:1},{year:2025,period:1}]);
for(const periods of [[],null,[{year:2026,period:0}],[{year:2026,period:1,extra:true}],Array(101).fill({year:2026,period:1})])assert.throws(()=>validateStockPeriods(periods));
assert.deepEqual(stockVisibleColumns(historical,['article','quantity']),['article','fiscalYear','fiscalPeriod','quantity']);
for(const v of [null,[],{year:'2026'},{period:0},{year:10000},{article:''},{sql:'arbitrary'}])assert.throws(()=>validateStockRequest(v));
const injection="A'; DELETE FROM MA_Items;--",q=stockAnalysisQuery({article:injection});assert(!q.sql.includes(injection));assert.equal(q.filters.article,injection);assert(q.sql.includes('q.FiscalYear=@selectedYear AND q.FiscalPeriod=@selectedPeriod'));assert(q.sql.includes('WHEN 6750208 THEN 3211264 WHEN 6750209 THEN 3211265'));assert(!/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(q.sql));
assert.throws(()=>validateStockSearch({...emptyStockSearch(),sort:[{key:'__proto__',direction:'asc'}]}));assert.throws(()=>validateStockColumns(['invalid']));assert.deepEqual(validateStockColumns(['quantity']),['article','quantity']);
const pref={version:1,columns:['article','quantity'],presets:[{name:'Terzi',search:{...emptyStockSearch(),ownership:'third',storages:['TERZI']},columns:['article','quantity']}]};assert.equal(validateStockPreferences(pref).presets[0].search.ownership,'third');
(async()=>{
 const {createAnalyticsService}=require('../backend-dist/modules/analytics/service');let bound=[],oversized=false;class Pool{on(){}async connect(){return this}async close(){}request(){return {input(name,type,value){bound.push([name,value])},async query(sql){assert(sql.includes('MA_ItemsStorageQty'));return {recordsets:[oversized?Array(100001).fill(base):[{...base,modified:new Date('2026-11-20T10:00:00Z')}],[{year:2026,period:1}],[{year:2026,period:1}]]}}}}}
 const service=createAnalyticsService(async()=>({server:'mock'}),{ConnectionPool:Pool,Int:'int',VarChar:()=> 'text'});const data=await service.stockAnalysis({year:2026,period:1,article:injection});assert.equal(data.rows[0].modified,'2026-11-20T10:00:00.000Z');assert(bound.some(([key,value])=>key==='article'&&value===injection));oversized=true;await assert.rejects(()=>service.stockAnalysis({}),/100.000/);await service.close();
 const {Router}=require('../backend-dist/shared/http/router'),{registerAnalyticsRoutes}=require('../backend-dist/modules/analytics/routes'),http=require('node:http');const router=new Router();let fail=false,calls=0;
 registerAnalyticsRoutes(router,{stockAnalysis:async input=>{calls++;if(fail)throw Error('PRIVATE_SQL_DETAIL');return {rows:[base],selected:input}}});const server=http.createServer((req,res)=>void router.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const post=body=>fetch(`http://127.0.0.1:${server.address().port}/api/erp/stock-analysis`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal((await post({sql:'bad'})).status,400);assert.equal(calls,0);const response=await post({year:2026});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).rows.length,1);fail=true;const bad=await post({});assert.equal(bad.status,503);assert(!(await bad.text()).includes('PRIVATE_SQL_DETAIL'));}finally{await new Promise(resolve=>server.close(resolve));}
 console.log('OK: stock arithmetic, separate units/ownership, anomalies, filters, exact party types, presets, parameterized SQL, row limit and HTTP.');
})().catch(e=>{console.error(e);process.exitCode=1;});
