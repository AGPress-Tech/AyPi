type TextRule = { op: 'exact'|'contains'|'prefix'|'range'; value: string; to?: string };
type Range = { from?: number|string; to?: number|string };
export type ArticleOrderFilters = {
    articles: TextRule[]; customers?: TextRule[]; orders?: TextRule[]; units?: TextRule[];
    orderDates?: Range[]; deliveryDates?: Range[]; quantities?: Range[]; prices?: Range[]; residuals?: Range[];
    delivered?: 'all'|'yes'|'no'; includeCancelled?: boolean; offset?:number; limit?:number;
};
const textKeys=['articles','customers','orders','units'];
const dateKeys=['orderDates','deliveryDates'];
const numberKeys=['quantities','prices','residuals'];
export function validateArticleOrderFilters(input:unknown):ArticleOrderFilters {
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Filtri non validi.');
    const value=input as any;
    if(Object.keys(value).some(k=>![...textKeys,...dateKeys,...numberKeys,'delivered','includeCancelled','offset','limit'].includes(k)))throw new Error('Filtro non previsto.');
    const clean:any={};
    for(const key of [...textKeys,...dateKeys,...numberKeys]){
        const rules=value[key]??[];
        if(!Array.isArray(rules)||rules.length>20)throw new Error('Sono ammessi al massimo 20 filtri per tipo.');
        clean[key]=rules.map(rule=>{
            if(!rule||typeof rule!=='object'||Array.isArray(rule))throw new Error('Condizione non valida.');
            if(textKeys.includes(key)){
                if(Object.keys(rule).some(k=>!['op','value','to'].includes(k))||!['exact','contains','prefix','range'].includes(rule.op)
                    ||typeof rule.value!=='string'||!rule.value.trim()||rule.value.length>128)throw new Error('Inserire un codice o un testo valido.');
                if(rule.op==='range'&&(typeof rule.to!=='string'||!rule.to.trim()||rule.to.length>128))throw new Error('Completare l’intervallo di codici.');
                return {op:rule.op,value:rule.value.trim(),...(rule.op==='range'?{to:rule.to.trim()}: {})};
            }
            if(Object.keys(rule).some(k=>!['from','to'].includes(k))||(rule.from===undefined&&rule.to===undefined))throw new Error('Completare l’intervallo.');
            const result:any={};
            for(const edge of ['from','to'])if(rule[edge]!==undefined){
                const val=rule[edge];
                if(dateKeys.includes(key)){
                    if(typeof val!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(val)||val<'1900-01-01'||val>'9998-12-31'||!Number.isFinite(Date.parse(`${val}T00:00:00Z`))||new Date(`${val}T00:00:00Z`).toISOString().slice(0,10)!==val)throw new Error('Data non valida.');
                }else if(typeof val!=='number'||!Number.isFinite(val)||Math.abs(val)>1e14)throw new Error('Valore numerico non valido.');
                result[edge]=val;
            }
            if(result.from!==undefined&&result.to!==undefined&&result.from>result.to)throw new Error('L’inizio dell’intervallo deve precedere la fine.');
            return result;
        });
    }
    if(!clean.articles.length)throw new Error('Inserire almeno un articolo o un intervallo di articoli.');
    if(value.delivered!==undefined&&!['all','yes','no'].includes(value.delivered))throw new Error('Stato consegna non valido.');
    if(value.includeCancelled!==undefined&&typeof value.includeCancelled!=='boolean')throw new Error('Stato annullamento non valido.');
    for(const [key,min,max,defaultValue] of [['offset',0,1000000,0],['limit',1,1000,250]] as const){
        const n=value[key]??defaultValue;if(!Number.isInteger(n)||n<min||n>max)throw new Error('Limite risultati non valido.');clean[key]=n;
    }
    clean.delivered=value.delivered??'all';clean.includeCancelled=value.includeCancelled??false;
    return clean;
}
const validDate=(col:string)=>`CASE WHEN ${col} >= '19000101' THEN CONVERT(date,${col}) END`;
export const ARTICLE_ORDER_SOURCE = `SELECT d.Item AS article,d.Description AS description,h.InternalOrdNo AS orderNo,
 h.SaleOrdId AS orderId,d.Line AS line,${validDate('h.OrderDate')} AS orderDate,
 COALESCE(${validDate('d.ExpectedDeliveryDate')},${validDate('h.ExpectedDeliveryDate')}) AS deliveryDate,
 h.Customer AS customerCode,c.CompanyName AS customerName,d.UoM AS unit,d.Qty AS quantity,
 d.DeliveredQty AS deliveredQuantity,
 CASE WHEN d.Cancelled='1' OR h.Cancelled='1' OR d.Delivered='1' THEN 0
      WHEN COALESCE(d.Qty,0)-COALESCE(d.DeliveredQty,0)>0 THEN COALESCE(d.Qty,0)-COALESCE(d.DeliveredQty,0) ELSE 0 END AS residual,
 d.UnitValue AS unitPrice,d.NetPrice AS netPrice,h.Currency AS currency,
 CASE WHEN d.Delivered='1' THEN 1 ELSE 0 END AS delivered,
 CASE WHEN d.Cancelled='1' OR h.Cancelled='1' THEN 1 ELSE 0 END AS cancelled
 FROM dbo.MA_SaleOrdDetails d JOIN dbo.MA_SaleOrd h ON h.SaleOrdId=d.SaleOrdId
 LEFT JOIN dbo.MA_CustSupp c ON c.CustSupp=h.Customer AND c.CustSuppType=h.CustSuppType
 WHERE NULLIF(LTRIM(RTRIM(d.Item)),'') IS NOT NULL`;
export function buildArticleOrderQuery(input:unknown){
    const filters=validateArticleOrderFilters(input);
    return buildArticleDocumentQuery(filters,{
        source:ARTICLE_ORDER_SOURCE,text:{articles:['article'],customers:['customerCode','customerName'],orders:['orderNo'],units:['unit']},
        ranges:{orderDates:'orderDate',deliveryDates:'deliveryDate',quantities:'quantity',prices:'unitPrice',residuals:'residual'},dates:dateKeys,
        conditions:[...(!filters.includeCancelled?['cancelled=0']:[]),...(filters.delivered!=='all'?[`delivered=${filters.delivered==='yes'?1:0}`]:[])],
        order:'article,orderDate DESC,orderId DESC,line',
    });
}
// Descrittori definiti nel codice: nessun nome di colonna o frammento SQL proviene dal client.
export function buildArticleDocumentQuery(filters:Record<string,any>,definition:{source:string;text:Record<string,string[]>;ranges:Record<string,string>;dates:string[];conditions:string[];order:string}){
    const bindings:{name:string;type:'text'|'number'|'date'|'int';value:unknown}[]=[];
    const bind=(value:unknown,type:'text'|'number'|'date'|'int')=>{const name=`p${bindings.length}`;bindings.push({name,type,value});return '@'+name};
    const conditions:string[]=[];
    const columns=definition.text;
    for(const key of Object.keys(columns)){
        const rules=filters[key] as TextRule[];
        if(rules.length)conditions.push('('+rules.map(rule=>{
            const escaped=rule.value.replace(/[\[\]%_\\]/g,'\\$&');
            const first=bind(rule.op==='contains'?`%${escaped}%`:rule.op==='prefix'?`${escaped}%`:rule.value,'text');
            const last=rule.op==='range'?bind(rule.to,'text'):null;
            return '('+columns[key].map(col=>rule.op==='range'?`${col} BETWEEN ${first} AND ${last}`:rule.op==='exact'?`${col}=${first}`:`${col} LIKE ${first} ESCAPE '\\'`).join(' OR ')+')';
        }).join(' OR ')+')');
    }
    const ranges=definition.ranges;
    for(const [key,col] of Object.entries(ranges)){
        const rules=filters[key] as Range[];
        if(rules.length)conditions.push('('+rules.map(rule=>{
            const edges=[];
            if(rule.from!==undefined)edges.push(`${col}>=${bind(rule.from,definition.dates.includes(key)?'date':'number')}`);
            if(rule.to!==undefined)edges.push(`${col}<=${bind(rule.to,definition.dates.includes(key)?'date':'number')}`);
            return '('+edges.join(' AND ')+')';
        }).join(' OR ')+')');
    }
    conditions.push(...definition.conditions);
    const offset=bind(filters.offset,'int'),limit=bind(filters.limit,'int');
    return {filters,bindings,sql:`WITH Orders AS (${definition.source}) SELECT *,COUNT_BIG(*) OVER() AS totalRows FROM Orders
 WHERE ${conditions.join(' AND ')} ORDER BY ${definition.order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`};
}
