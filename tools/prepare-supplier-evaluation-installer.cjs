// Optional validation for a manual Access import; backend packaging does not require or ship this file.
const fs=require('node:fs'),path=require('node:path');
function validateOptionalSupplierImport(file=path.resolve(__dirname,'../.private/supplier-evaluation-import.json')){
    if(!fs.existsSync(file))return {available:false};
    const source=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    if(source.version!==1||!source.readAt||!Array.isArray(source.records)||!source.records.length||!Array.isArray(source.suppliers)||!source.suppliers.length)throw Error('File di importazione Valutazione fornitori incompleto.');
    if(new Set(source.records.map(r=>String(r.id))).size!==source.records.length)throw Error('ID valutazioni duplicati nel file di importazione.');
    return {available:true,records:source.records.length,suppliers:source.suppliers.length};
}
if(require.main===module){
    const result=validateOptionalSupplierImport();
    console.log(result.available?`Importazione Access facoltativa disponibile: ${result.records} valutazioni, ${result.suppliers} anagrafiche. Applicazione manuale dal modulo Valutazione fornitori.`:'Nessun file di importazione Access: non è necessario per aggiornare il backend.');
}
module.exports={validateOptionalSupplierImport};
