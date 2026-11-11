import {ARTICLE_ORDER_SOURCE} from './article-orders';
import {ARTICLE_OFFER_SOURCE} from './article-offers';

const sqlDate=(column:string)=>`CASE WHEN ${column}>='19000101' THEN CONVERT(date,${column}) END`;
function withMetadata(source:string,fields:string){
    const marker='d.Qty AS quantity';
    if(!source.includes(marker))throw Error('Definizione righe gestionale non compatibile.');
    return source.replace(marker,fields+','+marker);
}
export const orderSource=withMetadata(ARTICLE_ORDER_SOURCE,`${sqlDate('h.TBCreated')} AS createdDate,${sqlDate('d.TBCreated')} AS lineCreatedDate,
 COALESCE(${sqlDate('d.ConfirmedDeliveryDate')},${sqlDate('h.ConfirmedDeliveryDate')}) AS confirmedDeliveryDate,
 d.TaxableAmount AS netAmount,CASE WHEN h.Delivered='1' THEN 1 ELSE 0 END AS headerDelivered,
 CASE WHEN h.Cancelled='1' THEN 1 ELSE 0 END AS headerCancelled`);
export const offerSource=withMetadata(ARTICLE_OFFER_SOURCE,`${sqlDate('h.TBCreated')} AS createdDate,${sqlDate('d.TBCreated')} AS lineCreatedDate,
 COALESCE(${sqlDate('d.ExpectedDeliveryDate')},${sqlDate('h.ExpectedDeliveryDate')}) AS expectedDeliveryDate,
 ${sqlDate('h.ValidityEndingDate')} AS validityDate,d.TaxableAmount AS netAmount`);

export type CustomerAnalysisRequest={customer:string;from?:string;to?:string};
const date=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&value>='1900-01-01'&&value<='9998-12-31'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function validateCustomerAnalysis(input:unknown):CustomerAnalysisRequest {
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Ricerca cliente non valida.');
    const v=input as any;
    if(Object.keys(v).some(k=>!['customer','from','to'].includes(k))||typeof v.customer!=='string'||!v.customer.trim()||v.customer.length>128)throw Error('Selezionare un cliente valido.');
    for(const k of ['from','to'])if(v[k]!==undefined&&!date(v[k]))throw Error('Periodo non valido.');
    if(v.from&&v.to&&v.from>v.to)throw Error('La data iniziale deve precedere la finale.');
    return {customer:v.customer.trim(),...(v.from?{from:v.from}:{}),...(v.to?{to:v.to}:{})};
}
export function validateCustomerSearch(input:unknown):{search:string} {
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='search')||typeof (input as any).search!=='string'||(input as any).search.trim().length<2||(input as any).search.length>128)throw Error('Inserire almeno due caratteri del codice o della ragione sociale.');
    return {search:(input as any).search.trim()};
}
export function customerSearchQuery(input:unknown){
    const {search}=validateCustomerSearch(input);
    return {bindings:[{name:'search',value:'%'+search.replace(/[\[\]%_\\]/g,'\\$&')+'%'}],sql:`WITH Customers AS (
      SELECT h.Customer AS code,MAX(c.CompanyName) AS name FROM dbo.MA_SaleOrd h
      LEFT JOIN dbo.MA_CustSupp c ON c.CustSupp=h.Customer AND c.CustSuppType=h.CustSuppType GROUP BY h.Customer
      UNION ALL SELECT h.Customer,MAX(c.CompanyName) FROM dbo.MA_CustQuotas h
      LEFT JOIN dbo.MA_CustSupp c ON c.CustSupp=h.Customer AND c.CustSuppType=h.CustSuppType
      WHERE COALESCE(h.UseContact,'0')<>'1' GROUP BY h.Customer)
      SELECT TOP (101) code,MAX(name) AS name FROM Customers
      WHERE NULLIF(LTRIM(RTRIM(code)),'') IS NOT NULL AND (code LIKE @search ESCAPE '\\' OR name LIKE @search ESCAPE '\\')
      GROUP BY code ORDER BY MAX(name),code`};
}
export function customerAnalysisQuery(input:unknown){
    const filters=validateCustomerAnalysis(input);
    const bindings:{name:string;value:string;type:'text'|'date'}[]=[{name:'customer',value:filters.customer,type:'text'}];
    const conditions=['customerCode=@customer'];
    for(const edge of ['from','to'] as const)if(filters[edge]){bindings.push({name:edge,value:filters[edge]!,type:'date'});conditions.push(`documentDate${edge==='from'?'>=':'<='}@${edge}`);}
    return {bindings,sql:`WITH Orders AS (${orderSource}),Offers AS (${offerSource}),Documents AS (
      SELECT 'order' AS kind,orderId AS documentId,orderNo AS documentNo,orderDate AS documentDate,deliveryDate,
      customerCode,customerName,article,description,line,unit,quantity,deliveredQuantity,residual,unitPrice,netPrice,currency,delivered,cancelled,
      createdDate,lineCreatedDate,confirmedDeliveryDate,NULL AS validityDate,netAmount,headerDelivered,headerCancelled FROM Orders
      UNION ALL SELECT 'offer',offerId,offerNo,offerDate,expectedDeliveryDate,customerCode,customerName,article,description,line,unit,quantity,
      NULL,NULL,unitPrice,netPrice,currency,NULL,NULL,createdDate,lineCreatedDate,NULL,validityDate,netAmount,NULL,NULL FROM Offers WHERE customerType='Cliente')
      SELECT TOP (100001) * FROM Documents WHERE ${conditions.join(' AND ')}
      ORDER BY documentDate DESC,kind,documentId DESC,line`};
}
