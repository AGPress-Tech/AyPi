// In questo gestionale i contratti barra sono offerte fornitore /C.
// Il legame alle righe ordine è SuppQuotaId + SuppQuotaLine, non il riferimento libero.
export const BAR_CONTRACTS_SQL = `
SELECT TOP (100001) q.SuppQuotaId id,d.Line line,q.QuotationNo contract,
 q.Supplier supplierCode,s.CompanyName supplier,q.SupplierDocNo supplierContract,
 q.QuotationDate date,CASE WHEN q.ValidityEndingDate>'18000101' THEN q.ValidityEndingDate END expiry,
 q.Currency currency,q.ClosedOrder closed,d.ClosedOrder lineClosed,
 d.Item item,d.Description description,d.UoM unit,d.Qty quantity,d.UnitValue price,
 d.OrderedQty erpOrdered,d.TaxableAmount amount,q.Notes notes,d.Notes lineNotes
FROM dbo.MA_SuppQuotas q
JOIN dbo.MA_SuppQuotasDetail d ON d.SuppQuotaId=q.SuppQuotaId
JOIN dbo.MA_CustSupp s ON s.CustSupp=q.Supplier AND s.CustSuppType=3211265
WHERE q.QuotationNo LIKE '%/C' AND d.Item<>''
 AND (d.Description LIKE '%BARRA%' OR d.Description LIKE '%BARRE%')
 AND (s.CompanyName LIKE '%METALLURGICA SAN MARCO%' OR s.CompanyName LIKE '%GAMBARI%' OR s.CompanyName LIKE '%VEZZOLA%')
ORDER BY q.QuotationDate DESC,q.SuppQuotaId,d.Line;
SELECT TOP (100001) d.SuppQuotaId contractId,d.SuppQuotaLine contractLine,
 o.PurchaseOrdId id,d.Line line,o.InternalOrdNo document,o.Supplier supplierCode,
 o.OrderDate date,d.ExpectedDeliveryDate delivery,d.Item item,d.Description description,
 d.UoM unit,d.Qty quantity,d.DeliveredQty received,d.UnitValue price,o.Currency currency,
 o.Cancelled cancelled,d.Cancelled lineCancelled,o.Delivered closed,d.Delivered lineClosed
FROM dbo.MA_PurchaseOrd o JOIN dbo.MA_PurchaseOrdDetails d ON d.PurchaseOrdId=o.PurchaseOrdId
WHERE EXISTS(SELECT 1 FROM dbo.MA_SuppQuotas q JOIN dbo.MA_CustSupp s ON s.CustSupp=q.Supplier AND s.CustSuppType=3211265
 WHERE q.SuppQuotaId=d.SuppQuotaId AND q.Supplier=o.Supplier AND q.QuotationNo LIKE '%/C'
 AND (s.CompanyName LIKE '%METALLURGICA SAN MARCO%' OR s.CompanyName LIKE '%GAMBARI%' OR s.CompanyName LIKE '%VEZZOLA%'))
ORDER BY o.OrderDate,o.PurchaseOrdId,d.Line;`;

export function validateBarContractsRequest(value:any):{suppliers?:string[]}{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='suppliers'))throw Error('Richiesta contratti non valida.');
 if(value.suppliers===undefined)return {};
 if(!Array.isArray(value.suppliers)||value.suppliers.length>200||value.suppliers.some((v:any)=>typeof v!=='string'||!v.trim()||v.length>128))throw Error('Elenco fornitori non valido (massimo 200).');
 return {suppliers:[...new Set(value.suppliers.map((v:string)=>v.trim()))] as string[]};
}
export function barContractsQuery(value:unknown={}){
 const input=validateBarContractsRequest(value);
 if(!input.suppliers)return {sql:BAR_CONTRACTS_SQL,bindings:[] as {name:string;value:string}[]};
 const bindings=input.suppliers.map((value,index)=>({name:`supplier${index}`,value}));
 const condition=bindings.length?`q.Supplier IN (${bindings.map(b=>'@'+b.name).join(',')})`:'1=0';
 return {sql:BAR_CONTRACTS_SQL.split("(s.CompanyName LIKE '%METALLURGICA SAN MARCO%' OR s.CompanyName LIKE '%GAMBARI%' OR s.CompanyName LIKE '%VEZZOLA%')").join(condition),bindings};
}
