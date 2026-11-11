import type {CellObject,WorkSheet} from 'xlsx';

/** Fixed decimal placeholders avoid Excel displaying a dangling decimal separator. */
export function excelNumberFormat(value:number,minimum=0,maximum=6){
    const fraction=Math.abs(value).toFixed(maximum).split('.')[1]?.replace(/0+$/,'').length||0;
    const decimals=Math.max(minimum,fraction);
    return '#,##0'+(decimals?'.'+'0'.repeat(decimals):'');
}
/** Real Excel date serials; ISO calendar dates are never parsed as locale text. */
export function excelDateCell(value:unknown,format='dd/mm/yyyy'):CellObject|null{
    if(value==null||value==='')return null;
    if(value instanceof Date&&!Number.isFinite(value.getTime()))return null;
    const raw=value instanceof Date?(format.includes('hh')?value.toISOString():`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`):String(value);
    const match=/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:T.*)?$/.exec(raw);if(!match)return null;
    const year=+match[1],month=+match[2],day=+(match[3]||1);
    let date=new Date(Date.UTC(year,month-1,day));
    if(year<1900||year>9999||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;
    if(format.includes('hh')&&raw.includes('T')){
        const instant=new Date(raw);if(!Number.isFinite(instant.getTime()))return null;
        const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant);
        const part=(key:string)=>Number(parts.find(p=>p.type===key)?.value);
        date=new Date(Date.UTC(part('year'),part('month')-1,part('day'),part('hour'),part('minute'),part('second')));
    }
    let serial=(date.getTime()-Date.UTC(1899,11,30))/86400000;
    if(serial<61)serial--; // Excel's fictional 29 February 1900.
    return {t:'n',v:serial,z:format};
}
export function formatExcelNumbers(sheet:WorkSheet){
    for(const [key,cell] of Object.entries(sheet))if(!key.startsWith('!')&&cell?.t==='n'&&typeof cell.v==='number'&&(!cell.z||cell.z==='General'))cell.z=excelNumberFormat(cell.v);
}
export function excelDurationCell(seconds:unknown):CellObject|null{
    if(seconds==null||seconds==='')return null;const n=Number(seconds);
    return Number.isFinite(n)?{t:'n',v:n/86400,z:'[h]:mm:ss'}:null;
}
