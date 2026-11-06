const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {validateArticleOfferFilters,buildArticleOfferQuery}=require('../backend-dist/modules/analytics/article-offers');
const {registerAnalyticsRoutes}=require('../backend-dist/modules/analytics/routes');
const {Router}=require('../backend-dist/shared/http/router');
test('offerte: articolo obbligatorio, filtri multipli e intervalli inclusivi validati',()=>{
 const base={articles:[{op:'exact',value:'1272AOA77'}]};
 const valid=validateArticleOfferFilters({...base,offers:[{op:'range',value:'26/00600',to:'26/00699'},{op:'exact',value:'25/00100'}],offerDates:[{from:'2026-11-01',to:'2026-11-06'}],prices:[{from:4.5,to:6}]});
 assert.equal(valid.offers.length,2);assert.equal(valid.limit,250);assert.equal(valid.offerDates[0].to,'2026-11-06');
 for(const input of [{},{articles:[]},{...base,orders:[]},{...base,delivered:'yes'},{...base,offerDates:[{from:'2026-02-30'}]},{...base,prices:[{from:'5.58'}]},{...base,limit:1001},{...base,offers:[{op:'range',value:'26/00'}]}])assert.throws(()=>validateArticleOfferFilters(input));
});
test('offerte: SELECT sulle offerte clienti, prezzo originario, contatti corretti e parametri senza interpolazione',()=>{
 const malicious="26/001'; DELETE FROM MA_CustQuotas;--";
 const q=buildArticleOfferQuery({articles:[{op:'exact',value:'1272AOA77'},{op:'prefix',value:'1272'}],offers:[{op:'exact',value:malicious}],offerDates:[{from:'2026-01-01',to:'2026-12-31'},{from:'2025-01-01',to:'2025-12-31'}],quantities:[{from:1,to:1}],customers:[{op:'contains',value:'RAF'}]});
 assert(!q.sql.includes(malicious));assert(q.bindings.some(p=>p.value===malicious));assert.match(q.sql,/MA_CustQuotasDetail d JOIN dbo.MA_CustQuotas h/);
 assert.match(q.sql,/d.UnitValue AS unitPrice,d.NetPrice AS netPrice/);assert.match(q.sql,/c.CustSuppType=h.CustSuppType/);assert.match(q.sql,/contact.Contact=h.Contact/);
 assert.match(q.sql,/CASE WHEN h.UseContact='1' THEN contact.CompanyName ELSE c.CompanyName END AS customerName/);
 assert.match(q.sql,/offerDate>=@p\d+ AND offerDate<=@p\d+\) OR/);assert.match(q.sql,/offerId DESC,line OFFSET/);
 assert(!q.sql.includes('SaleOrdDetails'));assert(!q.sql.includes('cancelled=0'));
});
test('API offerte disponibile ai normali client; endpoint economico ancora protetto',async()=>{
 let captured;
 const service={articleOffers:async filters=>{captured=filters;return {rows:[{article:'1272AOA77',offerNo:'26/00622',unitPrice:5.58}],total:1}},config:async()=>({accessPassword:'AGPress'})};
 const router=new Router();registerAnalyticsRoutes(router,service);const server=http.createServer((req,res)=>router.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const url=`http://127.0.0.1:${server.address().port}`;
 let res=await fetch(url+'/api/erp/article-offers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({articles:[{op:'exact',value:'1272AOA77'}]})});assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal((await res.json()).rows[0].unitPrice,5.58);assert.equal(captured.articles[0].value,'1272AOA77');
 res=await fetch(url+'/api/erp/article-offers',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"articles":[]}'});assert.equal(res.status,400);
 res=await fetch(url+'/api/analytics/query/bilancino',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(res.status,401);
 }finally{await new Promise(r=>server.close(r))}
});
