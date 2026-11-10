const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const roots=['backend/src','src/backend-app','backend-dist','dist-backend-app','backend/scripts','backend/resources','bot-backend/src','bot-backend/assets'];
const singles=['package.json','package-lock.json','electron-builder.backend.json','backend/tsconfig.json','tsconfig.backend-app.json','tools/prepare-analytics-installer.cjs','tools/verify-backend-release.cjs','tools/verify-backend-baseline.cjs'];
function releaseFiles(root){
 const files=[];
 function walk(relative){
  const target=path.join(root,relative);if(!fs.existsSync(target))return;
  if(fs.statSync(target).isDirectory())for(const name of fs.readdirSync(target).sort())walk(`${relative}/${name}`);
  else if(!relative.endsWith('.py')&&!relative.includes('__pycache__'))files.push(relative);
 }
 roots.forEach(walk);singles.forEach(walk);return files.sort();
}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function verifyRelease(root,manifest){
 const failures=[];
 if(manifest.version!==1||!['1.4.1-analytics-2026-11-06','1.4.1-analysis-sorting-2026-11-09'].includes(manifest.release)||!manifest.files) return ['Manifest di distribuzione non valido.'];
 const current=releaseFiles(root);
 for(const name of new Set([...current,...Object.keys(manifest.files)])){
  if(!Object.hasOwn(manifest.files,name))failures.push(`${name}: aggiunta non prevista nel pacchetto congelato`);
  else if(!current.includes(name))failures.push(`${name}: file mancante`);
  else if(hash(path.join(root,name))!==manifest.files[name])failures.push(`${name}: contenuto diverso dal pacchetto congelato`);
 }
 return failures;
}
function main(){
 const root=path.resolve(__dirname,'..'),manifest=require('./baselines/backend-release-2026-11-09.json');
 const failures=verifyRelease(root,manifest);
 if(failures.length){console.error(failures.join('\n'));process.exitCode=1}
 else console.log(`Distribuzione backend 1.4.1 verificata: ${Object.keys(manifest.files).length} file, sorgenti, dipendenze e script di installazione corrispondono al manifest congelato.`);
}
if(require.main===module)main();
module.exports={releaseFiles,hash,verifyRelease,main};
