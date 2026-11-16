// The corporate backend installer must never silently omit its prepared Access migration.
const fs=require('node:fs'),path=require('node:path');
const file=path.resolve(__dirname,'../.private/supplier-evaluation-import.json');
if(!fs.existsSync(file))throw Error('Manca il seed privato della migrazione Valutazione fornitori: preparare .private/supplier-evaluation-import.json prima del pacchetto backend aziendale.');
const source=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
if(source.version!==1||!source.readAt||!Array.isArray(source.records)||!source.records.length||!Array.isArray(source.suppliers)||!source.suppliers.length)throw Error('Seed Valutazione fornitori incompleto: installer interrotto.');
if(new Set(source.records.map(r=>String(r.id))).size!==source.records.length)throw Error('ID valutazioni duplicati nel seed privato.');
console.log(`Migrazione privata Valutazione fornitori pronta: ${source.records.length} valutazioni, ${source.suppliers.length} anagrafiche Access.`);
