const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {releaseFiles,hash,verifyRelease}=require('./verify-backend-release.cjs');
test('manifest release: rifiuta modifiche, sorgenti cambiati, aggiunte e file mancanti',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-release-'));
 const write=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text)};
 try{
  write('backend/src/app.ts','source');write('backend-dist/app.js','compiled');write('package.json','{}');
  const manifest={version:1,release:'1.4.1-analytics-2026-11-06',files:Object.fromEntries(releaseFiles(root).map(name=>[name,hash(path.join(root,name))]))};
  assert.deepEqual(verifyRelease(root,manifest),[]);
  write('backend/src/app.ts','changed');assert.match(verifyRelease(root,manifest).join(),/contenuto diverso/);write('backend/src/app.ts','source');
  write('backend-dist/extra.js','extra');assert.match(verifyRelease(root,manifest).join(),/aggiunta non prevista/);
  fs.unlinkSync(path.join(root,'backend-dist/extra.js'));fs.unlinkSync(path.join(root,'backend-dist/app.js'));assert.match(verifyRelease(root,manifest).join(),/file mancante/);
 }finally{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('aypi-release-'));fs.rmSync(root,{recursive:true,force:true})}
});
