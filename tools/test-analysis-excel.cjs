const assert=require('assert/strict'),XLSX=require('xlsx');
const {excelDateCell,excelNumberFormat,formatExcelNumbers,excelDurationCell}=require('../dist-ts/modules/analysis-excel');
for(const value of [0,1,10,-15,10000]){const format=excelNumberFormat(value);assert.equal(format,'#,##0');assert(!/[.,]$/.test(XLSX.SSF.format(format,value)))}
assert.equal(excelNumberFormat(2.58,3,3),'#,##0.000');assert.equal(XLSX.SSF.format(excelNumberFormat(2.58,3,3),2.58),'2.580');
assert.equal(excelNumberFormat(2,2),'#,##0.00');assert.equal(excelNumberFormat(2.43936,2),'#,##0.00000');
assert.equal(excelNumberFormat(10.123456,0,3),'#,##0.000');assert.equal(XLSX.SSF.format(excelNumberFormat(10.123456,0,3),10.123456),'10.123');assert.equal(excelNumberFormat(10.1,0,3),'#,##0.0');
assert.equal(excelDateCell(null),null);assert.equal(excelDateCell(''),null);assert.equal(excelDateCell('2026-02-30'),null);assert.equal(excelDateCell(new Date(NaN)),null);
assert.equal(excelDateCell('1900-01-01').v,1);assert.equal(excelDateCell('1900-03-01').v,61);
const date=excelDateCell('2026-01-01');assert.equal(date.v,46023);assert.equal(date.z,'dd/mm/yyyy');
assert.equal(excelDateCell(new Date(2026,0,1)).v,46023);
assert.equal(XLSX.SSF.format(date.z,date.v),'01/01/2026');assert.equal(XLSX.SSF.format('mm/yyyy',excelDateCell('2026-02','mm/yyyy').v),'02/2026');
const dt=excelDateCell('2026-01-01T10:30:00Z','dd/mm/yyyy hh:mm:ss');assert.equal(XLSX.SSF.format(dt.z,dt.v),'01/01/2026 11:30:00');
const sheet=XLSX.utils.aoa_to_sheet([['Data','Numero','Peso','Durata','Codice'],[date,10,{t:'n',v:2.58,z:excelNumberFormat(2.58,3,3)},excelDurationCell(90000),'00123']]);formatExcelNumbers(sheet);
assert.equal(sheet.A2.z,'dd/mm/yyyy');assert.equal(sheet.B2.z,'#,##0');assert.equal(sheet.C2.z,'#,##0.000');assert.equal(sheet.D2.z,'[h]:mm:ss');assert.equal(sheet.E2.t,'s');
const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Test');
const buffer=XLSX.write(book,{type:'buffer',bookType:'xlsx'}),read=XLSX.read(buffer,{type:'buffer',cellDates:true,cellNF:true}).Sheets.Test;
assert.equal(read.A2.t,'d');assert.equal(read.A2.v.getFullYear(),2026);assert.equal(read.A2.v.getMonth(),0);assert.equal(read.A2.v.getDate(),1);assert.equal(read.B2.t,'n');assert.equal(read.C2.v,2.58);assert.equal(read.C2.z,'#,##0.000');assert.equal(read.E2.v,'00123');
console.log('OK: numeri senza separatori finali, pesi a tre decimali, date reali, mesi, date/ore, durate e codici testuali nel file XLSX.');
