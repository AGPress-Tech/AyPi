const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {validateArticleOrderFilters,buildArticleOrderQuery}=require('../backend-dist/modules/analytics/article-orders');
const {registerAnalyticsRoutes}=require('../backend-dist/modules/analytics/routes');
const {Router}=require('../backend-dist/shared/http/router');
test('ricerca articolo: richiede chiave articolo e valida limiti, date, numeri e filtri',()=>{
 const base={articles:[{op:'exact',value:'1272AOA77'}]};
 assert.equal(validateArticleOrderFilters(base).limit,250);
 for(const input of [{},{articles:[]},{...base,sql:'SELECT * FROM x'},{...base,offset:-1},{...base,limit:1001},{...base,includeCancelled:'false'},{...base,quantities:[{from:100,to:20}]},{...base,prices:[{from:Infinity}]},{...base,orderDates:[{from:'2026-02-30'}]},{...base,orderDates:[{from:'2026-11-02',to:'2026-10-01'}]},{articles:[{op:'range',value:'A'}]},{articles:Array(21).fill(base.articles[0])}])assert.throws(()=>validateArticleOrderFilters(input));
});
test('SQL parametrico: alternative OR, tipi distinti AND, date inclusive e join cliente senza fornitori omonimi',()=>{
 const injection="A'; DROP TABLE MA_SaleOrd;--";
 const q=buildArticleOrderQuery({articles:[{op:'exact',value:injection},{op:'range',value:'1272',to:'1279'}],customers:[{op:'contains',value:'50%_[x]'}],orderDates:[{from:'2026-01-01',to:'2026-01-31'},{from:'2025-01-01',to:'2025-01-31'}],quantities:[{from:30}],delivered:'no'});
 assert(!q.sql.includes(injection));assert(q.bindings.some(p=>p.value===injection));
 assert(q.bindings.some(p=>p.value==='%50\\%\\_\\[x\\]%'));
 assert.match(q.sql,/article=@p0.* OR .*article BETWEEN/s);assert.match(q.sql,/orderDate>=@p\d+ AND orderDate<=@p\d+\) OR/);
 assert.match(q.sql,/CustSuppType=h.CustSuppType/);assert.match(q.sql,/cancelled=0 AND delivered=0/);
 assert.match(q.sql,/COUNT_BIG\(\*\) OVER\(\)/);assert.match(q.sql,/orderId DESC,line OFFSET/);
});
test('API ricerca disponibile senza admin; le analisi economiche restano protette',async()=>{
 let captured;
 const service={articleOrders:async filters=>{captured=filters;return {rows:[{article:'1272AOA77',quantity:30}],total:1,offset:0}},config:async()=>({accessPassword:'AGPress'}),query:async()=>{throw Error('Should not run')}};
 const router=new Router();registerAnalyticsRoutes(router,service);
 const server=http.createServer((req,res)=>router.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  let r=await fetch(base+'/api/erp/article-orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({articles:[{op:'exact',value:'1272AOA77'}]})});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).rows[0].quantity,30);assert.equal(captured.offset,0);
  r=await fetch(base+'/api/erp/article-orders',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"articles":[]}'});assert.equal(r.status,400);
  r=await fetch(base+'/api/analytics/query/bilancino',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,401);
 }finally{await new Promise(r=>server.close(r))}
});
