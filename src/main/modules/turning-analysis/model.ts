import * as XLSX from 'xlsx';

export const TURNING_SOURCE='\\\\Dl360\\pubbliche\\INFO\\REGISTRAZIONE PRODUZIONE TORNERIA\\Controllo_Valorizzazione.xlsm';
export const UNKNOWN='Non indicato';
export const MONTHS=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
export type Capacity={eight:number;fourteen:number;mixed:number};
export type TurningRecord={
    id:number;customer:string;order:string;article:string;phase:string;description:string;machine:string;date:string;year:number;month:number;
    unitPrice:number|null;quantity:number|null;setup:number|null;production:number|null;hours:number|null;revenue:number|null;
    rate:number|null;ideal:number|null;cycle:number|null;sheetCycle:number|null;note:string;
};
export type TurningData={
    source:string;modifiedAt:string;loadedAt:string;records:TurningRecord[];years:number[];
    machines:{code:string;description:string;rate:number|null}[];customers:string[];articles:string[];
    capacities:Record<string,Record<string,Capacity>>;monitored:Record<string,string[]>;
    quality:{read:number;included:number;blank:number;invalidDates:number;invalidInputs:number;blankNumericCells:number;missingMachine:number;missingArticle:number;unpriced:number;noIdeal:number;cachedErrors:number;formulaDifferences:number;examples:{row:number;issue:string}[]};
};
export type TurningFilters={years:number[];from:number;to:number;machines:string[];customers:string[];articles:string[];search?:string;minRate?:number;maxRate?:number;minPrice?:number;maxPrice?:number;minQuantity?:number;maxQuantity?:number};
export type TurningSettings={targets:Record<string,{revenue?:number;hours?:number;registrations?:number}>;capacities:Record<string,Capacity>;capacityBasis:'annual'|'period'};
export const emptyTurningSettings=():TurningSettings=>({targets:{},capacities:{},capacityBasis:'annual'});
const text=(v:unknown)=>String(v??'').trim();
export function numeric(v:unknown):number|null{
    if(v===null||v===undefined||v==='')return null;
    if(typeof v==='number')return Number.isFinite(v)?v:null;
    if(typeof v!=='string')return null;
    let str=v.trim().replace(/[€\s\u00a0]/g,'');if(!str||str.startsWith('#'))return null;
    if(str.includes(','))str=str.replace(/\./g,'').replace(',','.');
    return /^[-+]?\d+(?:\.\d+)?$/.test(str)&&Number.isFinite(Number(str))?Number(str):null;
}
function values(sheet:XLSX.WorkSheet){return XLSX.utils.sheet_to_json<any[]>(sheet,{header:1,raw:true,defval:null,blankrows:true});}
function cellAt(sheet:XLSX.WorkSheet,row:number,col:number):XLSX.CellObject|undefined{return Array.isArray(sheet)?sheet[row]?.[col]:sheet[XLSX.utils.encode_cell({r:row,c:col})]||(sheet as any)['!data']?.[row]?.[col];}
function period(value:unknown):{year:number;month:number}|null{
    if(typeof value==='number'){const d=XLSX.SSF.parse_date_code(value);return d&&d.y>=1900&&d.y<=9998?{year:d.y,month:d.m}:null;}
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return {year:value.getUTCFullYear(),month:value.getUTCMonth()+1};
    if(typeof value==='string'){
        const iso=value.match(/^(\d{4})-(\d{2})/),local=value.match(/^\d{1,2}\/(\d{1,2})\/(\d{4})$/);
        const year=iso?+iso[1]:local?+local[2]:0,month=iso?+iso[2]:local?+local[1]:0;
        if(year>=1900&&year<=9998&&month>=1&&month<=12)return {year,month};
    }return null;
}
export function buildTurningData(workbook:XLSX.WorkBook,source=TURNING_SOURCE,modifiedAt=''):TurningData{
    if(!workbook.Sheets.COMPLETO)throw new Error('Il file non contiene il foglio COMPLETO.');
    const rows=values(workbook.Sheets.COMPLETO),headers=rows[0]||[];
    for(const [index,header] of [[0,'Cliente'],[2,'Articolo'],[7,'Ore Att'],[8,'Ore Lav'],[10,'Ricavo Tot'],[12,'Mese/Anno'],[19,'Macchina']] as const)
        if(text(headers[index]).toLowerCase()!==header.toLowerCase())throw new Error(`Struttura del foglio COMPLETO non riconosciuta: colonna ${index+1}, ${header}.`);
    if(!text(headers[5]).endsWith('/pezzo')||!text(headers[6]).toLowerCase().includes('pezzi'))throw new Error('Colonne prezzo o quantità non riconosciute nel foglio COMPLETO.');
    const quality:TurningData['quality']={read:0,included:0,blank:0,invalidDates:0,invalidInputs:0,blankNumericCells:0,missingMachine:0,missingArticle:0,unpriced:0,noIdeal:0,cachedErrors:0,formulaDifferences:0,examples:[]};
    const issue=(row:number,message:string)=>{if(quality.examples.length<40)quality.examples.push({row,issue:message});};
    const machines=new Map<string,TurningData['machines'][number]>();
    if(workbook.Sheets.VALORIZZAZIONE)for(const row of values(workbook.Sheets.VALORIZZAZIONE).slice(1)){
        const code=text(row[0]);if(!code)continue;const rate=numeric(row[4]);
        if(machines.has(code))throw new Error(`Macchina duplicata nel foglio VALORIZZAZIONE: ${code}.`);
        machines.set(code,{code,description:text(row[2]),rate:rate!==null&&rate>0?rate:null});
    }
    const capacities:TurningData['capacities']={},monitored:TurningData['monitored']={};
    for(const name of workbook.SheetNames.filter(name=>/^\d{4}$/.test(name))){
        const sheet=workbook.Sheets[name],cells=values(sheet);capacities[name]={};monitored[name]=[];
        for(let i=0;i<cells.length;i++){
            const code=text(cells[i]?.[1]);if(!/^21[A-Z]\d{3}$/i.test(code))continue;
            const limits=[15,17,19].map(col=>{
                const cell=cellAt(sheet,i,col);
                const match=String(cell?.f||'').match(/\/\s*(\d+(?:\.\d+)?)/);return match?+match[1]:null;
            });
            if(limits.every(v=>v!==null&&v>0)){
                capacities[name][code]={eight:limits[0]!,fourteen:limits[1]!,mixed:limits[2]!};
                if(!monitored[name].includes(code))monitored[name].push(code);
            }
        }
    }
    const records:TurningRecord[]=[];
    for(let i=1;i<rows.length;i++){
        const row=rows[i];if(!row.some(v=>v!==null&&v!=='')){quality.blank++;continue;}quality.read++;
        const p=period(row[12]);if(!p){quality.invalidDates++;issue(i+1,'Periodo non valido: riga esclusa dai confronti temporali.');continue;}
        const excelNumber=(v:unknown,col:number)=>cellAt(workbook.Sheets.COMPLETO,i,col)?.t==='e'?null:v===null||v===undefined||v===''?0:numeric(v);
        const machine=text(row[19])||UNKNOWN,article=text(row[2])||UNKNOWN,quantity=excelNumber(row[6],6),unitPrice=excelNumber(row[5],5),setup=excelNumber(row[7],7),production=excelNumber(row[8],8);
        quality.blankNumericCells+=[5,6,7,8].filter(col=>(row[col]===null||row[col]===undefined||row[col]==='')&&cellAt(workbook.Sheets.COMPLETO,i,col)?.t!=='e').length;
        const hours=setup!==null&&production!==null?setup+production:null,revenue=quantity!==null&&unitPrice!==null?quantity*unitPrice:null;
        const cachedIdeal=numeric(row[15]),ideal=cachedIdeal!==null&&cachedIdeal>0?cachedIdeal:machines.get(machine)?.rate??null;
        if(!machines.has(machine)&&machine!==UNKNOWN)machines.set(machine,{code:machine,description:'Macchina presente nelle registrazioni',rate:ideal});
        if(machine===UNKNOWN){quality.missingMachine++;issue(i+1,'Macchina mancante.');}
        if([UNKNOWN,'?','0'].includes(article)){quality.missingArticle++;issue(i+1,'Articolo non identificato.');}
        if([quantity,unitPrice,setup,production].some(v=>v===null)){quality.invalidInputs++;issue(i+1,'Quantità, prezzo o ore non numerici: il valore non è stimato.');}
        if((quantity??0)>0&&(unitPrice??0)===0){quality.unpriced++;issue(i+1,'Registrazione con prezzo zero o assente.');}
        if(ideal===null)quality.noIdeal++;
        const cachedHours=numeric(row[9]),cachedRevenue=numeric(row[10]);
        if(hours!==null&&cachedHours!==null&&Math.abs(hours-cachedHours)>1e-6||revenue!==null&&cachedRevenue!==null&&Math.abs(revenue-cachedRevenue)>0.005){quality.formulaDifferences++;issue(i+1,'Valori ricalcolati differenti dalle formule memorizzate in Excel.');}
        const errors=row.filter(v=>typeof v==='string'&&/^#(DIV\/0!|VALUE!|N\/A|REF!|NUM!|NAME\?)/.test(v)).length;
        // Le celle errore possono essere rappresentate dal lettore XLSX con tipo e.
        const sheet=workbook.Sheets.COMPLETO;let typedErrors=0;for(let col=0;col<23;col++)if(cellAt(sheet,i,col)?.t==='e')typedErrors++;
        quality.cachedErrors+=Math.max(errors,typedErrors);
        records.push({id:i+1,customer:text(row[0])||UNKNOWN,order:text(row[1]),article,phase:text(row[3]),description:text(row[4]),machine,
            year:p.year,month:p.month,date:`${p.year}-${String(p.month).padStart(2,'0')}-01`,quantity,unitPrice,setup,production,hours,revenue,
            rate:hours!==null&&hours>0&&revenue!==null?revenue/hours:null,ideal,cycle:quantity!==null&&quantity>0&&production!==null?production*3600/quantity:null,sheetCycle:numeric(row[21]),note:text(row[22])});
    }
    if(!records.length)throw new Error('Il foglio COMPLETO non contiene registrazioni con un periodo valido.');
    quality.included=records.length;
    return {source,modifiedAt,loadedAt:new Date().toISOString(),records,years:[...new Set(records.map(r=>r.year))].sort((a,b)=>a-b),
        machines:[...machines.values()].sort((a,b)=>a.code.localeCompare(b.code)),customers:[...new Set(records.map(r=>r.customer))].sort(),articles:[...new Set(records.map(r=>r.article))].sort(),capacities,monitored,quality};
}
export function filterTurningRecords(data:TurningData,filters:TurningFilters,years=filters.years){
    const yearSet=new Set(years),machineSet=new Set(filters.machines),customerSet=new Set(filters.customers),articleSet=new Set(filters.articles),search=(filters.search||'').trim().toLocaleLowerCase('it');
    const within=(v:number|null,min?:number,max?:number)=>min===undefined&&max===undefined||v!==null&&(min===undefined||v>=min)&&(max===undefined||v<=max);
    return data.records.filter(r=>yearSet.has(r.year)&&r.month>=filters.from&&r.month<=filters.to&&(!machineSet.size||machineSet.has(r.machine))&&(!customerSet.size||customerSet.has(r.customer))&&(!articleSet.size||articleSet.has(r.article))
        &&(!search||[r.customer,r.article,r.order,r.description,r.machine,r.phase,r.note].some(v=>v.toLocaleLowerCase('it').includes(search)))
        &&within(r.rate,filters.minRate,filters.maxRate)&&within(r.unitPrice,filters.minPrice,filters.maxPrice)&&within(r.quantity,filters.minQuantity,filters.maxQuantity));
}
export type TurningStats={revenue:number;quantity:number;setup:number;production:number;hours:number;registrations:number;orders:number;articles:number;customers:number;rate:number|null;meanRate:number|null;meanRevenue:number|null;idealRate:number|null;idealRevenue:number;gap:number|null;setupShare:number|null;bestRate:number|null;minRevenue:number|null;maxRevenue:number|null;months:number[];unpriced:number};
export function turningStats(rows:readonly TurningRecord[]):TurningStats{
    const sum=(key:'revenue'|'quantity'|'setup'|'production'|'hours')=>rows.reduce((s,r)=>s+(r[key]??0),0);
    const revenue=sum('revenue'),hours=sum('hours'),rates=rows.map(r=>r.rate).filter((v):v is number=>v!==null),ideals=rows.filter(r=>r.ideal!==null&&r.revenue!==null&&r.hours!==null&&r.hours>0),idealHours=ideals.reduce((s,r)=>s+r.hours!,0),idealRevenue=ideals.reduce((s,r)=>s+r.hours!*r.ideal!,0);
    const incomplete=rows.some(r=>r.revenue===null||r.hours===null);
    const values=rows.map(r=>r.revenue).filter((v):v is number=>v!==null);
    return {revenue,quantity:sum('quantity'),setup:sum('setup'),production:sum('production'),hours,registrations:rows.length,
        orders:new Set(rows.map(r=>r.order).filter(v=>v&&v!=='?')).size,articles:new Set(rows.map(r=>r.article).filter(v=>![UNKNOWN,'?','0'].includes(v))).size,customers:new Set(rows.map(r=>r.customer).filter(v=>v!==UNKNOWN)).size,
        rate:hours>0&&!incomplete?revenue/hours:null,meanRate:rates.length?rates.reduce((s,v)=>s+v,0)/rates.length:null,meanRevenue:values.length?revenue/values.length:null,idealRate:idealHours>0?idealRevenue/idealHours:null,idealRevenue,
        gap:ideals.length?ideals.reduce((s,r)=>s+(r.revenue??0)-r.hours!*r.ideal!,0):null,setupShare:hours>0?sum('setup')/hours:null,bestRate:rates.length?Math.max(...rates):null,
        minRevenue:values.length?Math.min(...values):null,maxRevenue:values.length?Math.max(...values):null,months:[...new Set(rows.map(r=>r.month))].sort((a,b)=>a-b),unpriced:rows.filter(r=>(r.quantity??0)>0&&(r.unitPrice??0)===0).length};
}
export function turningGroups(rows:readonly TurningRecord[],dimension:'machine'|'customer'|'article'){
    const groups=new Map<string,TurningRecord[]>();for(const row of rows){const key=row[dimension];if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(row);}return [...groups].map(([key,records])=>({key,records,stats:turningStats(records)}));
}
export function capacityFor(data:TurningData,machine:string,year:number,settings:TurningSettings):Capacity|null{
    if(machine===UNKNOWN)return null;
    const override=settings.capacities[`${year}|${machine}`];if(override)return override;
    const sourceYear=capacitySourceYear(data,machine,year);return sourceYear===null?null:data.capacities[sourceYear][machine];
}
export function capacitySourceYear(data:TurningData,machine:string,year:number):number|null{
    const years=Object.keys(data.capacities).map(Number).filter(y=>!!data.capacities[y]?.[machine]).sort((a,b)=>Math.abs(a-year)-Math.abs(b-year)||a-b);return years[0]??null;
}
export function monitoredForYear(data:TurningData,year:number):string[]{
    const years=Object.keys(data.monitored).map(Number).filter(y=>data.monitored[y].length).sort((a,b)=>Math.abs(a-year)-Math.abs(b-year)||a-b);return years.length?data.monitored[years[0]]:[];
}
export function turningSaturation(data:TurningData,rows:readonly TurningRecord[],year:number,filters:TurningFilters,settings:TurningSettings){
    const machines=filters.machines.length?filters.machines:[...new Set([...monitoredForYear(data,year),...rows.map(r=>r.machine)])];
    const factor=settings.capacityBasis==='period'?(filters.to-filters.from+1)/12:1;
    let eight=0,fourteen=0,mixed=0;let unknown=rows.filter(r=>r.hours===null).length;
    for(const machine of machines){const c=capacityFor(data,machine,year,settings);if(!c){if(rows.some(r=>r.machine===machine&&(r.hours??0)!==0))unknown++;continue;}eight+=c.eight*factor;fourteen+=c.fourteen*factor;mixed+=c.mixed*factor;}
    const hours=turningStats(rows).hours;
    return {eight:!unknown&&eight>0?hours/eight:null,fourteen:!unknown&&fourteen>0?hours/fourteen:null,mixed:!unknown&&mixed>0?hours/mixed:null,unknown,capacity:{eight,fourteen,mixed}};
}
export function turningTargetKey(filters:TurningFilters,year:number){return JSON.stringify([year,filters.from,filters.to,[...filters.machines].sort(),[...filters.customers].sort(),[...filters.articles].sort(),filters.search||'',filters.minRate??null,filters.maxRate??null,filters.minPrice??null,filters.maxPrice??null,filters.minQuantity??null,filters.maxQuantity??null]);}
export function validateTurningSettings(input:unknown):TurningSettings{
    const value=input as any;if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['targets','capacities','capacityBasis'].includes(k)))throw new Error('Impostazioni non valide.');
    if(!['annual','period'].includes(value.capacityBasis))throw new Error('Base capacità non valida.');
    for(const key of ['targets','capacities'])if(!value[key]||typeof value[key]!=='object'||Array.isArray(value[key])||Object.keys(value[key]).length>2000)throw new Error('Limite impostazioni superato.');
    const result=emptyTurningSettings();result.capacityBasis=value.capacityBasis;
    for(const [key,target] of Object.entries(value.targets) as [string,any][]){
        if(key.length>20000||!key.startsWith('[')||!target||typeof target!=='object'||Array.isArray(target))throw new Error('Obiettivo non valido.');
        const clean:any={};for(const metric of Object.keys(target)){if(!['revenue','hours','registrations'].includes(metric)||typeof target[metric]!=='number'||!Number.isFinite(target[metric])||target[metric]<=0||target[metric]>1e12||metric==='registrations'&&!Number.isInteger(target[metric]))throw new Error('Valore obiettivo non valido.');clean[metric]=target[metric];}result.targets[key]=clean;
    }
    for(const [key,capacity] of Object.entries(value.capacities) as [string,any][]){
        if(!/^\d{4}\|21[A-Z]\d{3}$/i.test(key)||!capacity||Object.keys(capacity).length!==3||['eight','fourteen','mixed'].some(k=>typeof capacity[k]!=='number'||!Number.isFinite(capacity[k])||capacity[k]<=0||capacity[k]>10000))throw new Error('Capacità annuale non valida.');
        result.capacities[key]={eight:capacity.eight,fourteen:capacity.fourteen,mixed:capacity.mixed};
    }return result;
}
