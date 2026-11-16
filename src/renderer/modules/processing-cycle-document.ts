export type CyclePhase={id:string;fase:number;[key:string]:string|number};
export type ProcessingCycle={id?:string;revision?:number;fasi:CyclePhase[];[key:string]:any};
export type CycleField={key:string;label:string;type?:string};
export const cycleHeaderFields:CycleField[]=[
    {key:'metodo',label:'Metodo'},{key:'codiceProdotto',label:'Codice prodotto'},{key:'numeroDisegno',label:'Nr disegno'},{key:'edizione',label:'Ediz.'},{key:'denominazione',label:'Denominazione'},{key:'data',label:'Data',type:'date'},{key:'revisione',label:'Rev.'},
    {key:'materiale',label:'Materiale'},{key:'dimensioni',label:'Dimensioni'},{key:'pesoGrezzo',label:'Peso grezzo (Kg)'},{key:'pesoFinito',label:'Peso finito (Kg)'},{key:'cliente',label:'Cliente'},
];
export const cyclePhaseFields:CycleField[]=[{key:'macchina',label:'Macchina'},{key:'numeroProgramma',label:'Nr programma'},{key:'cassettaAttrezzatura',label:'Cassetta attrezzatura'},{key:'tempoAttrezzaggio',label:'Tempo attrezzaggio'},{key:'tempoMacchinaPrevisto',label:'Tempo macchina previsto'},{key:'tempoCambioPezzo',label:'Tempo cambio pezzo'},{key:'pezziOra',label:'Pz/h'},{key:'attrezzista',label:'Attrezzista'},{key:'data',label:'Data',type:'date'},{key:'descrizione',label:'Descrizione lavorazione'}];
export const escapeCycle=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const emptyCyclePhase=():CyclePhase=>({id:crypto.randomUUID(),fase:5,...Object.fromEntries(cyclePhaseFields.map(f=>[f.key,'']))});
export const emptyProcessingCycle=():ProcessingCycle=>({...Object.fromEntries(cycleHeaderFields.map(f=>[f.key,''])),fasi:[emptyCyclePhase()]});
const display=(key:string,value:unknown)=>key==='data'&&value?String(value).split('-').reverse().join('/'):value;
export function processingCyclePrintHtml(item:ProcessingCycle,logo:string){
    const value=(source:any,key:string)=>escapeCycle(display(key,source[key]))||'&nbsp;';
    const technical=(keys:string[])=>keys.map(key=>{const field=cycleHeaderFields.find(f=>f.key===key)!,weight=key==='pesoGrezzo'||key==='pesoFinito',label=weight?field.label.replace(/\s*\(Kg\)$/,''):field.label;return `<td><small>${escapeCycle(label)}</small>${weight?`<div class="weight"><span>${value(item,key)}</span><span>kg</span></div>`:`<div>${value(item,key)}</div>`}</td>`;}).join('');
    return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>
    @page{size:A4 portrait;margin:12mm}
    *{box-sizing:border-box}
    html,body{width:186mm;max-width:186mm;min-width:0}
    body{font:9pt 'Segoe UI',Arial,sans-serif;line-height:1.2;color:#111;margin:0;padding:0}
    table{width:100%;max-width:100%;min-width:0;border-collapse:collapse;table-layout:fixed}
    td,th{border:1px solid #333;padding:3px;vertical-align:middle;min-width:0;overflow-wrap:anywhere;word-break:break-word}
    small{display:block;font-size:8pt;font-weight:400;line-height:1.15;margin-bottom:2px}
    thead{display:table-header-group}
    .document{width:186mm;max-width:186mm;min-width:0}
    .document>thead>tr>td,.document>tbody>tr>td{border:0;padding:0 0 7px}
    .brand{display:flex;align-items:center;gap:20px;margin-bottom:8px;max-width:100%}
    .brand img{width:135px;max-height:45px;object-fit:contain}
    .brand h1{font-size:14pt;font-weight:500;margin:0;min-width:0}
    .section{background:#e8e8e8;text-align:center;font-size:10pt;font-weight:bold}
    .meta td{vertical-align:top}
    .meta small{text-transform:uppercase}
    .meta div{min-height:3.5mm;white-space:pre-wrap}
    .meta .weight{display:flex;justify-content:space-between;align-items:end;gap:5px}.weight span:last-child{flex-shrink:0}
    .identity small{font-size:9pt}.identity div{font-size:10pt}
    .phase{break-inside:avoid;page-break-inside:avoid}
    .phase table{margin:0}
    .phase th{font-size:8.5pt;font-weight:400;line-height:1.15;text-align:center}
    .phase .time-heading{font-size:7pt;line-height:1.15;padding:2px}
    .phase .pieces-heading{font-size:10pt}
    .phase .phase-number{font-size:16pt;text-align:center}
    .phase .value{height:7mm;white-space:pre-wrap}
    .phase .description{white-space:pre-wrap;padding:4px 5px}
    .phase .description small{display:inline;font-size:8pt;margin:0 6px 0 0}
    .phase .phase-date small{display:inline;font-size:8pt;margin:0 5px 0 0}
    .phase .operator{vertical-align:top}
    .phase .section{font-size:10pt;font-weight:bold}
    footer{font-size:6pt;color:#555;margin-top:5px}
    </style></head><body><table class="document"><thead><tr><td><div class="brand">${logo?`<img src="${logo}" alt="A.G.PRESS">`:''}<h1>CICLO DI LAVORAZIONE</h1></div>
    <table class="meta identity"><colgroup><col style="width:49.6%"><col style="width:50.4%"></colgroup><tbody><tr>${technical(['metodo','codiceProdotto'])}</tr><tr><th class="section" colspan="2">UFFICIO TECNICO</th></tr></tbody></table>
    <table class="meta"><colgroup><col style="width:26%"><col style="width:7.5%"><col style="width:47%"><col style="width:13%"><col style="width:6.5%"></colgroup><tbody><tr>${technical(['numeroDisegno','edizione','denominazione','data','revisione'])}</tr></tbody></table><table class="meta"><colgroup><col style="width:21%"><col style="width:12.3%"><col style="width:13.5%"><col style="width:19.1%"><col style="width:34.1%"></colgroup><tbody><tr>${technical(['materiale','dimensioni','pesoGrezzo','pesoFinito','cliente'])}</tr></tbody></table></td></tr></thead><tbody>
    ${item.fasi.map((phase,index)=>`<tr class="phase"><td><table><colgroup><col style="width:8%"><col style="width:16.3%"><col style="width:13%"><col style="width:13.5%"><col style="width:9.1%"><col style="width:9.1%"><col style="width:9.1%"><col style="width:9.1%"><col style="width:12.8%"></colgroup><tbody><tr><th class="section" colspan="9">REPARTO OFFICINA</th></tr><tr><th rowspan="2">FASE</th><th rowspan="2">MACCHINA</th><th rowspan="2">NR PROGRAMMA</th><th rowspan="2">CASSETTA ATTREZZATURA</th><th colspan="4">TEMPI</th><td rowspan="2" class="operator"><small>ATTREZZISTA</small>${value(phase,'attrezzista')}</td></tr><tr><th class="time-heading">TEMPO<br>ATTREZZ.</th><th class="time-heading">TEMPO<br>MACCHINA<br>PREVISTO</th><th class="time-heading">TEMPO<br>CAMBIO PZ</th><th class="pieces-heading">PZ/h</th></tr><tr><td class="phase-number" rowspan="2">${(index+1)*5}</td>${['macchina','numeroProgramma','cassettaAttrezzatura','tempoAttrezzaggio','tempoMacchinaPrevisto','tempoCambioPezzo','pezziOra'].map(key=>`<td class="value">${value(phase,key)}</td>`).join('')}<td class="phase-date"><small>DATA</small>${value(phase,'data')}</td></tr><tr><td colspan="8" class="description"><small>DESCRIZIONE LAVORAZIONE</small>${value(phase,'descrizione')}</td></tr></tbody></table></td></tr>`).join('')}
    </tbody></table><footer>M08-7 · Ciclo di lavorazione</footer></body></html>`;
}
