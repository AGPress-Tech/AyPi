const test=require('node:test'),assert=require('node:assert/strict'),http=require('http'),{EventEmitter}=require('events');
const {queryDefinition,queryParameters}=require('../backend-dist/modules/analytics/catalog');
const {createAnalyticsService}=require('../backend-dist/modules/analytics/service');
const {registerAnalyticsRoutes}=require('../backend-dist/modules/analytics/routes');
const {Router}=require('../backend-dist/shared/http/router');
const {createAnalyticsClient}=require('../dist-ts/modules/management/analytics-client');

test('catalogo chiuso e parametri SQL tipizzati: niente query arbitrarie o interpolazioni',()=>{
  assert.throws(()=>queryDefinition('DROP TABLE x'));
  assert.throws(()=>queryDefinition('__proto__'));
  assert.throws(()=>queryParameters({sql:'SELECT * FROM x'}));
  assert.throws(()=>queryParameters({fromYear:'2026; DROP TABLE x'}));
  assert.throws(()=>queryParameters({fromYear:2026,toYear:2025}));
  const p=queryParameters({fromYear:2025,toYear:2026});
  assert.equal(p.fromDate.toISOString(),'2025-01-01T00:00:00.000Z');assert.equal(p.toDate.toISOString(),'2027-01-01T00:00:00.000Z');
  assert.match(queryDefinition('bilancino').sql,/^SELECT/);assert.match(queryDefinition('bilancino').sql,/@fromDate/);
});
test('pool riusato, richieste concorrenti accorpate, nuova lettura su richiesta e limiti di righe',async()=>{
  let connects=0,queries=0,closed=0,cancelled=0;
  const params=[];
  class Request extends EventEmitter{
    input(name,type,value){params.push({name,type,value});return this}
    cancel(){cancelled++;this.cancelled=true}
    async query(sql){queries++;await new Promise(r=>setTimeout(r,5));
      for(let i=0;i<3&&!this.cancelled;i++)this.emit('row',{Riga:i,DataCompetenza:new Date('2026-01-01T00:00:00Z'),Codice:'07011001',Valore:-100});
      this.emit('done');return {};
    }
  }
  class Pool extends EventEmitter{async connect(){connects++;return this}request(){return new Request()}async close(){closed++}}
  const config=async()=>({server:'fixture',instance:'SQL',database:'demo',user:'test',password:'test-only',encrypt:true,trustServerCertificate:true});
  const service=createAnalyticsService(config,{ConnectionPool:Pool,Date:'date-type'});
  const [a,b]=await Promise.all([service.query('bilancino',{}),service.query('bilancino',{})]);
  assert.equal(a,b);assert.equal(connects,1);assert.equal(queries,1);assert.equal(a.rows.length,3);
  assert.equal(a.rows[0][a.columns.indexOf('DataCompetenza')],'2026-01-01');
  await service.query('bilancino',{fromYear:2026});assert.equal(queries,2);assert.equal(connects,1);
  assert(params.every(p=>p.type==='date-type'));await service.close();assert.equal(closed,1);
  const limited=createAnalyticsService(config,{ConnectionPool:Pool,Date:'date-type'},2);
  await assert.rejects(limited.query('bilancino',{}),/Troppi movimenti/);assert.equal(cancelled,1);await limited.close();
});
test('HTTP: password admin, token, catalogo, gzip, revoca e errori senza segreti SQL',async()=>{
  let calls=0;
  const service={config:async()=>({accessPassword:'AGPress',password:'secret-server-only'}),query:async(id,params)=>{calls++;if(params.fromYear===2020)throw Error('secret-server-only');return {queryId:id,columns:['Codice'],rows:[['07011001']],source:'fixture',queriedAt:new Date().toISOString(),rowCount:1}}};
  const router=new Router();registerAnalyticsRoutes(router,service);
  const server=http.createServer((req,res)=>router.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const client=createAnalyticsClient(()=>base,()=> 'AGPress');
  try{
    assert.equal((await fetch(base+'/api/analytics/catalog')).status,401);assert.equal(calls,0);
    let response=await fetch(base+'/api/analytics/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'AGPRESS'})});assert.equal(response.status,401);
    const data=await client.query('bilancino');assert.equal(data.rows[0][0],'07011001');assert.equal(calls,1);
    await client.query('bilancino');assert.equal(calls,2);
    await assert.rejects(client.query('bilancino',{fromYear:2020}),e=>!e.message.includes('secret-server-only'));
    response=await fetch(base+'/api/analytics/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'AGPress'})});
    const {token}=await response.json(),headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
    const catalog=await(await fetch(base+'/api/analytics/catalog',{headers})).json();assert.equal(catalog.queries.length,2);assert(!JSON.stringify(catalog).includes('secret-server-only'));
    assert.equal((await fetch(base+'/api/analytics/query/bilancino',{method:'POST',headers,body:JSON.stringify({sql:'DROP TABLE test'})})).status,400);
    assert.equal((await fetch(base+'/api/analytics/query/unknown',{method:'POST',headers,body:'{}'})).status,400);
    await fetch(base+'/api/analytics/session',{method:'DELETE',headers});assert.equal((await fetch(base+'/api/analytics/catalog',{headers})).status,401);
  }finally{await client.logout();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
