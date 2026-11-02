const test = require('node:test'), assert = require('node:assert/strict');
const { decodeRecipeSegment } = require('../backend-dist/modules/forno/program-recipe');
const output = require('esbuild').buildSync({entryPoints:['src/renderer/scripts/forno/recipe-auxiliary.ts'],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const compiled={exports:{}};new Function('module','exports',output)(compiled,compiled.exports);
const {segmentEventSummary,renderRecipeAuxiliary}=compiled.exports;

test('ciclo 1 reale: decodifica FC03 confrontata indipendentemente con i parametri del clone iTools',()=>{
    const fixture=require('./fixtures/forno-cycle1-2026-11-02.json');
    assert.equal(fixture.segments.length,8);
    for(const segment of fixture.segments){
        const actual=decodeRecipeSegment(segment.number,String(segment.number),segment.words,fixture.channels);
        for(const [key,expected]of Object.entries(segment.expected)){
            const values=Array.isArray(expected)?expected:[expected],decoded=Array.isArray(actual[key])?actual[key]:[actual[key]];
            assert.equal(decoded.length,values.length);
            values.forEach((value,i)=>typeof value==='boolean'?assert.equal(decoded[i],value):assert(Math.abs(decoded[i]-value)<=1e-7*Math.max(1,Math.abs(value)),`Segmento ${segment.number}, ${key}: ${decoded[i]} != ${value}`));
        }
    }
});

test('decodifica nativa: maschere bool, entrambi i canali, soglie e valori utente senza perdere i word originali',()=>{
    const b=Buffer.alloc(144);
    const integer=(offset,value)=>b.writeUInt16BE(value,offset*4), float=(offset,value)=>b.writeFloatBE(value,offset*4);
    integer(0,4);float(11,12.5);float(12,25);integer(13,3);integer(14,1);integer(15,2);float(16,123.5);float(17,-5);
    integer(20,1);integer(21,5);float(22,550);float(23,20);float(24,42.5);float(25,-2);integer(34,0);integer(35,1);
    for(let i=0;i<8;i++){integer(26+i,1<<i);b.writeUInt16BE(32768,(26+i)*4+2);}
    const words=Array.from({length:72},(_,i)=>b.readUInt16BE(i*2)),s=decodeRecipeSegment(7,'<camino>',words,2);
    assert.deepEqual(s.events,Array(8).fill(true));assert.deepEqual(s.eventRaw,[1,2,4,8,16,32,64,128]);
    assert.deepEqual(s.holdbackValues,[12.5,25]);assert.equal(s.waitFor,3);assert.deepEqual(s.wait,[1,2]);assert.deepEqual(s.waitValues,[123.5,-5]);
    assert.deepEqual(s.pvEvents,[1,5]);assert.deepEqual(s.pvEventValues,[550,20]);assert.deepEqual(s.pvEventUse,[0,1]);assert.deepEqual(s.userValues,[42.5,-2]);
    assert.deepEqual(s.nativeWords,words);words[0]=99;assert.equal(s.nativeWords[0],4);
});

test('UI: include End, Wait, GoBack, stati OFF e Reset; backend precedente dichiarato incompleto',()=>{
    class Element {constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.textContent='';}append(e){this.children.push(e);}setAttribute(){} }
    const previous=global.document;global.document={createElement:tag=>new Element(tag)};
    const flatten=e=>e.textContent+' '+e.children.map(flatten).join(' ');
    try {
        const segment=(number,type)=>({number,type,name:String(number),endType:1,events:[true,true,true],holdback:[0],userValues:[0],waitFor:0,goBackTo:1,cycles:2});
        const recipe={maxEvents:3,channels:1,resetEvents:[false,false,false],resetUserValues:[0],features:{userValues:true},segments:[segment(1,1),segment(2,4),segment(3,5),segment(4,0)]};
        assert.equal(segmentEventSummary(recipe,recipe.segments[0]),'E1 · Apertura saracinesca ON · E2 · Aspiratore ON · E3 · Scambiatore ON');
        assert.equal(segmentEventSummary(recipe,recipe.segments[3]),'E1 · Apertura saracinesca ON → OFF · E2 · Aspiratore ON → OFF · E3 · Scambiatore ON → OFF');
        const root=new Element('section');renderRecipeAuxiliary(root,recipe);const text=flatten(root);
        for(const label of ['Apertura saracinesca','Marcia aspiratore','Marcia scambiatore','Attesa','Ripetizione','Fine → Reset','ON','OFF','Impostazione globale','wiring iTools']) assert(text.includes(label),label);
        const missing=new Element('section');renderRecipeAuxiliary(missing,{segments:[]});assert(flatten(missing).includes('Aggiornare il backend'));
    } finally {global.document=previous;}
});


test('schede: nasconde OFF invariati, mostra ON e solo le transizioni ON -> OFF',()=>{
    const off=[false,false,false],recipe={maxEvents:3,resetEvents:off,segments:[
        {number:1,type:1,events:off},{number:2,type:2,events:off},
        {number:3,type:1,events:[true,false,true]},{number:4,type:2,events:[false,true,true]},
        {number:5,type:2,events:off},{number:6,type:0,endType:1,events:[true,true,true]}
    ]};
    assert.equal(segmentEventSummary(recipe,recipe.segments[0]),'');assert.equal(segmentEventSummary(recipe,recipe.segments[1]),'');
    const on=segmentEventSummary(recipe,recipe.segments[2]);assert(on.includes('E1')&&on.includes('E3'));assert(!on.includes('E2'));
    const mixed=segmentEventSummary(recipe,recipe.segments[3]);assert(mixed.includes('ON \u2192 OFF'));assert(mixed.includes('Aspiratore ON'));assert(mixed.includes('Scambiatore ON'));
    const switchedOff=segmentEventSummary(recipe,recipe.segments[4]);assert(!switchedOff.includes('E1'));assert(switchedOff.includes('E2')&&switchedOff.includes('E3'));
    assert.equal(segmentEventSummary(recipe,recipe.segments[5]),'');
});
