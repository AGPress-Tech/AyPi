const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module');
const original=Module._extensions['.ts'];
Module._extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText,file);
const model=require('../src/main/modules/customer-analysis/model.ts');
const queries=require('../backend/src/modules/analytics/customer-analysis.ts');
const {documentLinksQuery,validateDocumentLinkRequest}=require('../backend/src/modules/analytics/document-links.ts');
const {validateArticleOrderFilters}=require('../backend/src/modules/analytics/article-orders.ts');
const {buildArticleOrderQuery}=require('../backend/src/modules/analytics/article-orders.ts');
const {ARTICLE_ORDER_COLUMNS,DEFAULT_ARTICLE_ORDER_COLUMNS}=require('../src/main/modules/article-orders/columns.ts');
assert.deepEqual(ARTICLE_ORDER_COLUMNS.slice(0,5).map(c=>c.key),['article','description','netWeight','grossWeight','orderNo']);
assert(DEFAULT_ARTICLE_ORDER_COLUMNS.includes('netWeight')&&DEFAULT_ARTICLE_ORDER_COLUMNS.includes('grossWeight'));
assert(!DEFAULT_ARTICLE_ORDER_COLUMNS.includes('description'));
const weightQuery=buildArticleOrderQuery({articles:[{op:'exact',value:'ART-A'}],sort:[{key:'netWeight',direction:'asc'}]});
assert.match(weightQuery.sql,/g.NetWeight AS netWeight,g.GrossWeight AS grossWeight/);
assert.match(weightQuery.sql,/LEFT JOIN dbo.MA_ItemsGoodsData g ON g.Item=d.Item/);
assert.match(weightQuery.sql,/netWeight ASC/);
const {validateArticleOfferFilters}=require('../backend/src/modules/analytics/article-offers.ts');
const {createAnalyticsService}=require('../backend/src/modules/analytics/service.ts');
const base={kind:'order',documentId:1,documentNo:'ORD-1',documentDate:'2026-01-10',deliveryDate:'2026-02-01',customerCode:'C001',customerName:'Test',article:'ART-A',description:'Articolo',line:1,unit:'PZ',currency:'EUR',quantity:100,deliveredQuantity:25,residual:75,unitPrice:2,netPrice:1.5,netAmount:120,createdDate:'2026-01-09',delivered:0,cancelled:0};
const rows=model.normalizeCustomerRows([
 base,{...base,line:2,article:'ART-B',netAmount:60,quantity:50,deliveredQuantity:50,residual:0,delivered:1},
 {...base,documentId:2,documentNo:'ORD-2',documentDate:'2025-12-01',quantity:10,netAmount:100,unit:'KG',currency:'USD',netPrice:10,deliveredQuantity:0,residual:10,deliveryDate:null},
 {...base,documentId:3,documentNo:'ORD-3',cancelled:1,residual:0,quantity:400},
 {...base,kind:'offer',documentId:1,documentNo:'OFF-1',netAmount:300,quantity:200,delivered:null,cancelled:null,residual:null,deliveredQuantity:null},
 {...base,kind:'offer',documentId:2,documentNo:'OFF-2',quantity:20,netAmount:null,netPrice:null,documentDate:null,delivered:null,cancelled:null,residual:null,deliveredQuantity:null},
]);
async function main(){
 const filters=model.defaultCustomerFilters(),selected=model.filterCustomerRows(rows,filters,'2026-11-10'),stats=model.customerStats(selected,'2026-11-10');
 assert.equal(stats.orders,2);assert.equal(stats.offers,2);assert.equal(stats.documents,4);assert.equal(stats.lines,5);assert.equal(stats.open,2);assert.equal(stats.overdue,1);assert.equal(stats.missingDeliveries,1);assert.equal(stats.missingPrices,1);assert.equal(stats.missingDates,1);
 assert.deepEqual(stats.units.find(u=>u.unit==='PZ'),{unit:'PZ',orders:150,offers:220,delivered:75,residual:75});
 assert.deepEqual(stats.currencies.find(v=>v.currency==='EUR'),{currency:'EUR',orders:225,offers:300,netOrders:180,netOffers:300,backlog:112.5,missing:1,missingAmount:1});
 assert.equal(stats.currencies.find(v=>v.currency==='USD').orders,100);
 assert.equal(model.filterCustomerRows(rows,{...filters,status:'overdue'},'2026-11-10').length,1);
 assert.equal(model.filterCustomerRows(rows,{...filters,status:'delivered'},'2026-11-10').length,1);
 assert.equal(model.filterCustomerRows(rows,{...filters,status:'cancelled'},'2026-11-10').length,1);
 assert.equal(model.filterCustomerRows(rows,{...filters,status:'partial'},'2026-11-10').length,1);
 assert.equal(model.filterCustomerRows(rows,{...filters,years:['2025']},'2026-11-10').length,1);
 assert.equal(model.filterCustomerRows(rows,{...filters,from:'2026-01-01',to:'2026-01-31',kind:'order'},'2026-11-10').length,2);
 assert.equal(model.filterCustomerRows(rows,{...filters,unit:'KG',currency:'USD'},'2026-11-10').length,1);
 assert.equal(model.filterCustomerRows(rows,{...filters,minQuantity:'60',maxQuantity:'150'},'2026-11-10').length,1);
 assert.equal(model.filterCustomerRows(rows,{...filters,minPrice:'5'},'2026-11-10').length,1);
 assert.equal(model.filterCustomerRows(rows,{...filters,deliveryFrom:'2026-02-01',deliveryTo:'2026-02-01',kind:'order'},'2026-11-10').length,2);
 assert.equal(model.filterCustomerRows(rows,{...filters,minResidual:'50',maxResidual:'100'},'2026-11-10').length,1);
 assert.equal(model.filterCustomerRows(rows,{...filters,stateBucket:'Annullato'},'2026-11-10').length,1);
 assert.equal(model.filterCustomerRows(rows,{...filters,stateBucket:'Parziale'},'2026-11-10').length,0,'Il drill sul grafico non include le righe classificate Scaduto');
 const exactRows=model.normalizeCustomerRows([base,{...base,article:'ART-AB'}]);
 assert.equal(model.filterCustomerRows(exactRows,{...filters,article:'ART-A'},'2026-11-10').length,2);
 assert.equal(model.filterCustomerRows(exactRows,{...filters,article:'ART-A',articleExact:true},'2026-11-10').length,1);
 let selection=model.toggleCustomerSelection(model.emptyCustomerSelection(),'article','ART-A');
 assert.equal(model.filterCustomerRows(rows,{...filters,selection},'2026-11-10').length,4);
 selection=model.toggleCustomerSelection(selection,'article','ART-B',true);
 selection=model.toggleCustomerSelection(selection,'month','2026-01');
 assert.equal(model.filterCustomerRows(rows,{...filters,selection},'2026-11-10').length,3);
 selection=model.toggleCustomerSelection(selection,'month','2025-12',true);
 assert.equal(model.filterCustomerRows(rows,{...filters,selection},'2026-11-10').length,4);
 selection=model.toggleCustomerSelection(selection,'article','ART-A',true);
 assert.equal(model.filterCustomerRows(rows,{...filters,selection},'2026-11-10').length,1);
 selection=model.toggleCustomerSelection(selection,'article','ART-B');assert.equal(selection.article.length,0);
 assert.throws(()=>model.validateCustomerSelection({month:['2026-13']}));
 assert.throws(()=>model.validateCustomerSelection({kind:['injected']}));
 const oldFilters={...filters};delete oldFilters.selection;assert.deepEqual(model.validateCustomerFilters(oldFilters).selection,model.emptyCustomerSelection());
 const chart={...model.defaultCustomerCharts()[0],limit:36};
 const data=model.customerChartData(selected,chart,'2026-11-10');
 assert.equal(data.find(b=>b.key==='2026-01'&&b.series==='Ordini').value,1,'Documento con due righe contato una sola volta');
 const gaps=model.customerChartData(model.normalizeCustomerRows([base,{...base,documentId:2,documentDate:'2026-03-01'}]),chart,'2026-11-10');
 assert.deepEqual(gaps.map(b=>[b.key,b.value]),[['2026-01',1],['2026-02',0],['2026-03',1]]);
 const cumulative=model.customerChartData(model.normalizeCustomerRows([base,{...base,documentId:2,documentDate:'2026-03-01'}]),{...chart,cumulative:true},'2026-11-10');
 assert.deepEqual(cumulative.map(b=>b.value),[1,1,2]);
 const values=model.customerChartData(selected,{...chart,dimension:'year',metric:'value'},'2026-11-10');
 assert(values.some(b=>b.series==='Ordini · EUR'));assert(values.some(b=>b.series==='Ordini · USD'));
 const prefs=model.emptyCustomerPreferences();prefs.presets.push({id:'test',name:'Test',charts:prefs.charts,filters,expanded:true});assert.deepEqual(model.validateCustomerPreferences(prefs),prefs);
 prefs.presets[0].filters.selection=selection;assert.deepEqual(model.validateCustomerPreferences(prefs).presets[0].filters.selection,selection);prefs.presets[0].filters.selection=model.emptyCustomerSelection();
 assert.throws(()=>model.validateCustomerPreferences({...prefs,charts:[{...chart,id:'<script>'}]}));
 assert.throws(()=>model.validateCustomerPreferences({...prefs,charts:[chart,chart]}));
 assert.throws(()=>model.validateCustomerPreferences({...prefs,presets:Array(11).fill(prefs.presets[0])}));
 assert.throws(()=>model.validateCustomerFilters({...filters,from:'2026-02-30'}));
 assert.throws(()=>model.validateCustomerFilters({...filters,minQuantity:'200',maxQuantity:'10'}));
 assert.throws(()=>queries.validateCustomerSearch({search:'a'}));assert.throws(()=>queries.validateCustomerSearch({search:'ABC',sql:'DROP'}));
 assert.throws(()=>queries.validateCustomerAnalysis({customer:'C',from:'2026-02-30'}));assert.throws(()=>queries.validateCustomerAnalysis({customer:'C',from:'2026-02-01',to:'2026-01-01'}));
 const attack="x'; DROP TABLE MA_SaleOrd;--",query=queries.customerAnalysisQuery({customer:attack,from:'2026-01-01',to:'2026-12-31'});
 assert(!query.sql.includes(attack));assert.equal(query.bindings[0].value,attack);assert.match(query.sql,/customerCode=@customer/);assert.match(query.sql,/TOP \(100001\)/);assert.match(query.sql,/customerType='Cliente'/);
 const search=queries.customerSearchQuery({search:'A%_['});assert.equal(search.bindings[0].value,'%A\\%\\_\\[%');
 assert.throws(()=>validateDocumentLinkRequest({kind:'order',id:"1; DROP TABLE x"}));
 assert.throws(()=>validateDocumentLinkRequest({kind:'offer',id:0}));
 const linked=documentLinksQuery({kind:'order',id:123});assert.equal(linked.bindings[0].value,123);assert.match(linked.sql,/ReferenceQuotationId/);assert.match(linked.sql,/MA_CrossReferences/);assert.match(linked.sql,/DerivedDocID=@id/);
 assert.equal(validateArticleOrderFilters({articles:[],orders:[{op:'exact',value:'26/001'}]}).articles.length,0);
 assert.equal(validateArticleOfferFilters({articles:[],offers:[{op:'exact',value:'26/OFF-1'}]}).articles.length,0);
 assert.throws(()=>validateArticleOrderFilters({articles:[],orders:[{op:'contains',value:'26'}]}));
 let recordset=[],calls=[];
 const driver={VarChar:n=>`text:${n}`,Date:'date',ConnectionPool:class {
  on(){} async connect(){return this}async close(){}
  request(){const bindings=[];return {input(...p){bindings.push(p)},async query(sql){calls.push({bindings,sql});return {recordset}}};}
 }};
 const service=createAnalyticsService(async()=>({server:'test',instance:'test',database:'test',user:'test',password:'test',encrypt:false,trustServerCertificate:true}),driver);
 recordset=[{code:'C001',name:'Cliente'}];assert.equal((await service.customerSearch({search:'Cli'})).customers[0].code,'C001');
 recordset=[{...base,documentDate:new Date('2026-01-10T00:00:00Z')}];const result=await service.customerAnalysis({customer:'C001',from:'2026-01-01'});assert.equal(result.rows[0].documentDate,'2026-01-10');assert.equal(calls.at(-1).bindings[0][2],'C001');assert.equal(calls.at(-1).bindings[1][1],'date');
 const documents=await service.documentLinks({kind:'order',id:123});assert.equal(documents.rows[0].documentDate,'2026-01-10');assert.equal(calls.at(-1).bindings[0][0],'id');assert.equal(calls.at(-1).bindings[0][2],123);
 recordset=Array(100001).fill(base);await assert.rejects(()=>service.customerAnalysis({customer:'C001'}),/100.000/);
 await service.close();
 await testRoutes();await testIpc();
 console.log('OK: conteggi distinti, filtri, stati, U.M./valute, calendario, preset, SQL parametrico, HTTP, IPC, persistenza e file Excel completo.');
}
async function testRoutes(){
 const http=require('node:http'),{Router}=require('../backend/src/shared/http/router.ts'),{registerAnalyticsRoutes}=require('../backend/src/modules/analytics/routes.ts');
 const router=new Router();let calls=0;
 registerAnalyticsRoutes(router,{customerSearch:async()=>{calls++;return {customers:[{code:'C001',name:'Test'}],more:false}},customerAnalysis:async()=>{calls++;return {rows:[],queriedAt:'2026-11-10',customer:'C001'}}});
 const server=http.createServer((req,res)=>void router.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const post=(endpoint,body)=>fetch(`http://127.0.0.1:${server.address().port}${endpoint}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/api/erp/customer-search',{search:'a'})).status,400);assert.equal(calls,0);
  const found=await post('/api/erp/customer-search',{search:'Cli'});assert.equal(found.status,200);assert.equal(found.headers.get('cache-control'),'no-store');assert.equal((await found.json()).customers[0].code,'C001');
  assert.equal((await post('/api/erp/customer-analysis',{customer:'C001',to:'invalid'})).status,400);
  const data=await post('/api/erp/customer-analysis',{customer:'C001'});assert.equal(data.status,200);assert.equal((await data.json()).customer,'C001');
 }finally{await new Promise(resolve=>server.close(resolve));}
}
async function testIpc(){
 const vm=require('node:vm'),XLSX=require('xlsx'),artifacts=path.resolve(__dirname,'../.tmp-customer-analysis/ipc');fs.mkdirSync(artifacts,{recursive:true});
 const handlers={},listeners={},mainContents={getURL:()=>'?theme=bluearchive'},windows=[];let fail=false;
 const mainWindow={webContents:mainContents};
 class FakeWindow {
  constructor(){this.webContents={setWindowOpenHandler(){},on(){}};windows.push(this)}
  isDestroyed(){return false}setMenu(){}maximize(){}show(){}focus(){}once(){}on(){}async loadFile(){}close(){}
 }
 const out={exports:{}};
 const source=ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src/main/modules/customer-analysis/ipc.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(source,{exports:out.exports,__dirname:path.resolve(__dirname,'../src/main/modules/customer-analysis'),Buffer,Intl,Date,Map,Set,Promise,require:id=>id==='electron'?{app:{getPath:()=>artifacts},BrowserWindow:FakeWindow,ipcMain:{handle:(k,v)=>handlers[k]=v,on:(k,v)=>listeners[k]=v},dialog:{showSaveDialog:async()=>({filePath:path.join(artifacts,'result.xlsx')})}}:id==='../analysis-navigation'?{registerAnalysisTarget(){},canOpenAnalysis(){return false}}:id==='../analysis-excel'?require('../src/main/modules/analysis-excel.ts'):id==='./model'?model:id==='../file-manager/backend-client'?{requestAypiBackend:async(_path,body)=>{if(fail)throw Error('Offline');return {rows,customer:body.body.customer,queriedAt:'2026-11-10T10:00:00Z'}}}:require(id)});
 out.exports.registerCustomerAnalysisIpc(mainWindow,()=> '');
 assert.equal((await handlers['customer-analysis-open']({sender:{}})).ok,false);
 assert.equal((await handlers['customer-analysis-open']({sender:mainContents})).ok,true);
 const event={sender:windows[0].webContents};
 assert.equal((await handlers['customer-analysis-load']({sender:{}},{customer:'C001'})).ok,false);
 assert.equal((await handlers['customer-analysis-load'](event,{customer:'C001'})).ok,true);
 const prefs=model.emptyCustomerPreferences();assert.equal((await handlers['customer-analysis-preferences-save'](event,prefs)).ok,true);
 assert.equal((await handlers['customer-analysis-preferences-load'](event)).preferences.charts.length,4);
 const exported=await handlers['customer-analysis-export'](event,model.defaultCustomerFilters());assert.equal(exported.ok,true);assert.equal(exported.count,5);
 const workbook=XLSX.readFile(path.join(artifacts,'result.xlsx'),{cellNF:true,cellDates:true});assert(workbook.SheetNames.includes('Storico mensile'));assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['Righe documenti']).length,5);assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Documenti).length,4);assert.equal(workbook.Sheets['Righe documenti'].D2.t,'d');assert.equal(workbook.Sheets.Documenti.D2.t,'d');
 const selectedFilters={...model.defaultCustomerFilters(),selection:model.toggleCustomerSelection(model.emptyCustomerSelection(),'article','ART-B')};
 assert.equal((await handlers['customer-analysis-export'](event,selectedFilters)).count,1,'Excel follows the shared chart selection');
 fail=true;assert.equal((await handlers['customer-analysis-load'](event,{customer:'OTHER'})).ok,false);
 assert.equal((await handlers['customer-analysis-export'](event,model.defaultCustomerFilters())).count,5,'La cache precedente sopravvive a una lettura fallita');
 const settings=path.join(artifacts,'customer-analysis.preferences.json');fs.writeFileSync(settings,'corrotto');assert.equal((await handlers['customer-analysis-preferences-save'](event,prefs)).ok,false);assert.equal(fs.readFileSync(settings,'utf8'),'corrotto');
 fs.writeFileSync(settings,JSON.stringify(prefs));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(original)Module._extensions['.ts']=original;else delete Module._extensions['.ts'];});
