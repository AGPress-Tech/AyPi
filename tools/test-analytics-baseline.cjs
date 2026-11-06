const test=require('node:test'),assert=require('node:assert/strict');
const {verifyBackend}=require('./verify-backend-baseline.cjs');
const baseline=require('./baselines/backend-1.4.0-1338.json');
const forno=require('./baselines/backend-forno-management-2026-11-03.json');
const sql=require('./baselines/backend-analytics-2026-11-06.json');
const verify=review=>verifyBackend(process.cwd(),baseline,forno,review);
test('revisione SQL: file e lock verificati; il perimetro degli altri moduli resta vincolato',()=>{
  const valid=verify(sql);
  assert.deepEqual(valid.failures.filter(s=>/analytics|SQL|mssql|app\.js|routes\/index|package-lock/.test(s)),[]);
  const changedBaseline=JSON.parse(JSON.stringify(baseline));
  changedBaseline.files['backend-dist/modules/forno/analysis.js']='0'.repeat(64);
  assert(verifyBackend(process.cwd(),changedBaseline,forno,sql).failures.some(s=>s.includes('forno/analysis.js')),'il controllo storico Forno deve restare attivo');
  for(const mutate of [x=>x.dependencies.extra='1',x=>x.additions['backend-dist/extra.js']={},x=>x.overrides['backend-dist/modules/forno/service.js']={},x=>x.baseReviewSha256='0'.repeat(64)]){
    const review=JSON.parse(JSON.stringify(sql));mutate(review);
    assert(verify(review).failures.some(s=>s.includes('Revisione analisi SQL non valida')));
  }
  const lock=JSON.parse(JSON.stringify(sql));lock.packageLockSha256='0'.repeat(64);
  assert(verify(lock).failures.some(s=>s.includes('package-lock.json')));
});
