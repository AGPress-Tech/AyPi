import * as XLSX from 'xlsx';
export type WorkbookCell={value:string|number|boolean|null;display:string;format?:string;formula?:string};
export type WorkbookTable={name:string;columns:{key:string;label:string;defaultHidden?:boolean}[];rows:{number:number;cells:WorkbookCell[]}[]};
export type WorkbookTables={sheets:WorkbookTable[];modifiedAt:string};

// Read cached source values, including rows excluded by the analytical model.
// Never recalculate or save the source workbook.
export function buildWorkbookTables(book:XLSX.WorkBook,modifiedAt=''):WorkbookTables {
    let count=0;
    const complete=book.SheetNames.find(name=>name.trim().toLocaleLowerCase('it')==='completo');
    if(!complete||!book.Sheets[complete])throw Error('Il file non contiene il foglio Completo.');
    const excluded=new Set(['mese esatto','anno','rapporto formattazione']);
    const hidden=new Set(['s/pezzo ideale','s/pezzo reale','s/pezzo reali','€/pezzo ideale']);
    const normalize=(title:string)=>title.normalize('NFKC').trim().toLocaleLowerCase('it').replace(/\s+/g,' ').replace(/\s*\/\s*/g,'/');
    const sheets=[complete].map(name=>{
        const sheet=book.Sheets[name],range=XLSX.utils.decode_range(sheet['!ref']||'A1');
        count+=(range.e.r-range.s.r+1)*(range.e.c-range.s.c+1);
        if(count>3000000)throw Error('La vista Excel supera tre milioni di celle. Nessun dato è stato troncato.');
        const cell=(r:number,c:number):WorkbookCell=>{
            const source=Array.isArray(sheet)?sheet[r]?.[c]:sheet[XLSX.utils.encode_cell({r,c})];
            if(!source)return {value:null,display:''};
            const value=source.t==='e'?(source.w||XLSX.utils.format_cell(source)):source.v??null;
            const numeric=typeof value==='number'&&!(source.z&&XLSX.SSF.is_date(source.z));
            const display=numeric?new Intl.NumberFormat('it-IT',{maximumFractionDigits:2,...(source.z?.includes('%')?{style:'percent' as const}:{})}).format(value):source.w??XLSX.utils.format_cell(source);
            return {value:typeof value==='number'||typeof value==='boolean'||typeof value==='string'?value:value instanceof Date?value.toISOString():null,
                display,format:source.z,formula:source.f};
        };
        const columns=Array.from({length:range.e.c-range.s.c+1},(_,i)=>{
            const c=range.s.c+i,letter=XLSX.utils.encode_col(c),title=cell(range.s.r,c).display;
            return {key:letter,label:title||'Senza intestazione',defaultHidden:hidden.has(normalize(title))};
        }).filter(column=>!excluded.has(normalize(column.label)));
        const rows=Array.from({length:range.e.r-range.s.r},(_,i)=>({number:range.s.r+i+2,cells:columns.map(column=>cell(range.s.r+i+1,XLSX.utils.decode_col(column.key)))}));
        return {name,columns,rows};
    });
    return {sheets,modifiedAt};
}
