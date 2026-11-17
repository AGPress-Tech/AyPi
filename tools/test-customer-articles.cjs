const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module');
const original=Module._extensions['.ts'];
Module._extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);
try {
 const model=require('../src/main/modules/customer-analysis/model.ts'),a=require('../src/main/modules/customer-analysis/articles.ts');
 const row=(article,year,quantity,extra={})=>({kind:'order',article,documentId:`${article}-${year}`,documentNo:`ORD-${year}`,documentDate:`${year}-02-01`,unit:'PZ',currency:'EUR',quantity,netPrice:2,netAmount:quantity*2,...extra});
 const history=model.normalizeCustomerRows([
  row('A',2021,10),row('A',2022,20),row('A',2023,30),row('A',2024,40),row('A',2025,50),row('A',2026,999),
  row('B',2021,80),row('B',2023,40),row('B',2024,20),row('B',2025,10),
  row('NEW',2025,100),row('OLD',2022,50),row('OLD',2022,25,{line:2}),
  row('OLD',2022,10,{documentId:'second',documentNo:'ORD-second'}),
  row('A',2025,3,{unit:'KG',currency:'USD',netPrice:12}),
  row('CANCEL',2024,100,{cancelled:true}),row('HEADER',2024,100,{headerCancelled:true}),
  row('OFFER',2025,900,{kind:'offer'}),row('UNDATED',2025,20,{documentDate:null}),
 ]);
 const life=a.articleLifecycle(history,history,'2026-11-17');
 assert(!life.some(r=>['CANCEL','HEADER','OFFER'].includes(r.article)));
 const old=life.find(r=>r.article==='OLD');assert.equal(old.inactiveYears,4);assert.equal(old.orders,2);assert.equal(old.lastOrders,2);assert.equal(old.lastQuantity,85);assert.equal(old.averageLot,42.5);assert(old.lastDocuments.includes('ORD-second'));
 const usd=life.find(r=>r.article==='A'&&r.currency==='USD');assert.equal(usd.lastOrder,'2026-02-01');assert.equal(usd.lastQuantity,null,'No artificial quantity for a unit absent from the latest order date');
 const boundary=a.articleLifecycle(history,history,'2026-01-31').find(r=>r.article==='OLD');assert.equal(boundary.inactiveYears,3);
 const annual=a.articleAnnual(history,history,'2026-11-17');assert.equal(annual.find(r=>r.article==='B'&&r.year==='2022').quantity,0);assert.equal(annual.find(r=>r.article==='B'&&r.year==='2023').quantityChange,null);assert.equal(annual.find(r=>r.article==='A'&&r.year==='2026').partial,'Sì');
 const subset=history.filter(r=>r.documentDate?.startsWith('2025'));
 const cohort=a.articleCohorts(subset,history).find(r=>r.currency==='EUR');assert.equal(cohort.newArticles,1);assert.equal(cohort.newValue,200);assert.equal(cohort.existingArticles,2);
 const forecasts=a.articleForecast(history,'2026-11-17',3);const next=forecasts.find(r=>r.article==='A'&&r.currency==='EUR'&&r.year==='2026');
 assert.equal(next.forecast,60);assert.equal(next.samples,5);assert.equal(next.slope,10);assert.equal(next.backtestError,0);assert.equal(next.training,'2021–2025');assert.equal(forecasts.filter(r=>r.article==='A'&&r.currency==='EUR').length,3);
 assert(!forecasts.some(r=>['NEW','UNDATED'].includes(r.article)));assert(forecasts.every(r=>r.lower>=0&&r.upper>=r.lower));
 assert.equal(a.articleForecast(history,'2026-11-17',3,{from:'2023-02-01'}).length,0,'Exclude partial first calendar year');
 assert.equal(a.articleForecast(history,'2026-11-17',3,{to:'2023-11-30'}).length,0,'Exclude partial last calendar year');
 assert.equal(a.articleForecast(model.normalizeCustomerRows([row('MISSING',2021,10),row('MISSING',2022,null),row('MISSING',2023,30)]),'2024-01-01').length,0);
 const orders=a.articleOrderDetails(history);assert.equal(orders.find(r=>r.article==='OLD'&&r.documentNo==='ORD-2022').quantity,75);
 assert.equal(a.percentChange(10,0),null);assert.equal(a.percentChange(10,20),-50);
 const chart={...model.defaultArticleCharts()[1],dimension:'year',metric:'newArticles',limit:20};
 const fresh=model.customerChartData(subset,chart,'2026-11-17',history);assert.equal(fresh.find(b=>b.key==='2025').value,1);
 const price=model.customerChartData(model.normalizeCustomerRows([row('A',2021,1,{netPrice:100}),row('A',2021,9,{netPrice:10,documentId:'other'}),row('A',2023,1,{netPrice:20})]),{...chart,metric:'weightedPrice'},'2026-11-17');
 assert.equal(price.find(b=>b.key==='2021').value,19);assert.equal(price.find(b=>b.key==='2022').value,null,'A missing price year is not a zero price');
 const inactivity=model.customerChartData(history,model.defaultArticleCharts()[0],'2026-11-17',history);assert.equal(inactivity.find(b=>b.key==='4').value,1);
 const filters=model.defaultCustomerFilters();filters.selection.inactivity=['4'];assert(model.filterCustomerRows(history,filters,'2026-11-17').every(r=>r.article==='OLD'));
 const annualNew=a.newArticleForecast(history,history,'2026-11-17',2);assert(annualNew.some(r=>r.unit==='articoli'));assert(annualNew.some(r=>r.currency==='EUR'));assert(annualNew.every(r=>r.forecast>=0));
 const selectedYears=model.defaultCustomerFilters();selectedYears.years=['2020','2021','2022','2023','2024','2025'];selectedYears.selection.year=['2022','2023','2024'];assert.deepEqual(a.articleForecastBounds({},selectedYears),{from:'2022-01-01',to:'2024-12-31',unavailable:false});
 selectedYears.selection.year=['2022','2024'];assert.equal(a.articleForecastBounds({},selectedYears).unavailable,true);
 const legacy=model.emptyCustomerPreferences();delete legacy.articleCharts;delete legacy.articleAnalysis;delete legacy.charts[0].cumulative;legacy.charts[0].cumulative=false;assert.equal(model.validateCustomerPreferences(legacy).articleCharts.length,7);
 assert.throws(()=>model.validateCustomerPreferences({...model.emptyCustomerPreferences(),articleAnalysis:{mode:'forecast',dormancy:'',trend:'',horizon:100}}));
 assert.throws(()=>model.validateCustomerPreferences({...model.emptyCustomerPreferences(),articleCharts:[{...chart,metric:'weightedPrice',cumulative:true}]}));
 console.log('OK: article lifecycle, inactivity, units/currencies, duplicate order lines, annual gaps, cohorts, weighted prices, forecasts/backtest, partial years, missing data and preferences.');
} finally { if(original)Module._extensions['.ts']=original;else delete Module._extensions['.ts']; }
