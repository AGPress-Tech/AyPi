const test=require('node:test'),assert=require('node:assert/strict');
const {degreeTicks,parseLocalDateTime,formatLocalInput}=require('../dist-ts/scripts/forno/axes');
test('griglia in gradi: multipli fissi e suddivisioni indipendenti dallo zoom',()=>{
 const r=degreeTicks(93,127,10,5);assert.deepEqual(r.ticks.filter(t=>t.major).map(t=>t.value),[100,110,120]);assert.equal(r.ticks[0].value,93);assert.equal(r.ticks.at(-1).value,127);
 assert(r.ticks.some(t=>t.value===102&&!t.major));assert.deepEqual(degreeTicks(101,119,10,5).ticks.filter(t=>t.major).map(t=>t.value),[110]);
 assert(degreeTicks(-10,10,2,4).ticks.some(t=>t.value===-8&&t.major));
 assert(degreeTicks(-10000,10000,0.01,10).ticks.length<=502);
});
test('range locale: precisione millisecondi, validazione e cambio ora legale',()=>{
 const text='2026-10-29T08:12:13.456',t=parseLocalDateTime(text);assert.equal(formatLocalInput(t),text);
 assert.throws(()=>parseLocalDateTime('2026-02-30T10:00'));assert.throws(()=>parseLocalDateTime('invalid'));
 if(Intl.DateTimeFormat().resolvedOptions().timeZone==='Europe/Rome')assert.throws(()=>parseLocalDateTime('2026-03-29T02:30'));
});
