import {orderSource,offerSource} from './customer-analysis';
export function validateDocumentLinkRequest(input:unknown):{kind:'order'|'offer';id:number}{
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['kind','id'].includes(k)))throw Error('Documento non valido.');
    const v=input as any;
    if(!['order','offer'].includes(v.kind)||!Number.isInteger(v.id)||v.id<1||v.id>2147483647)throw Error('Identificativo documento non valido.');
    return {kind:v.kind,id:v.id};
}
export function documentLinksQuery(input:unknown){
    const request=validateDocumentLinkRequest(input),orders=request.kind==='offer';
    return {bindings:[{name:'id',value:request.id}],sql:`WITH Orders AS (${orderSource}),Offers AS (${offerSource}),Links AS (
      SELECT SaleOrdId AS orderId,ReferenceQuotationId AS offerId FROM dbo.MA_SaleOrdDetails WHERE ReferenceQuotationId>0 AND ${orders?'ReferenceQuotationId':'SaleOrdId'}=@id
      UNION SELECT SaleOrdId,CustQuotaId FROM dbo.MA_CustQuotas WHERE SaleOrdId>0 AND ${orders?'CustQuotaId':'SaleOrdId'}=@id
      UNION SELECT DerivedDocID,OriginDocID FROM dbo.MA_CrossReferences WHERE OriginDocType=27066371 AND DerivedDocType=27066372 AND ${orders?'OriginDocID':'DerivedDocID'}=@id)
      SELECT TOP (10001) '${orders?'order':'offer'}' AS kind,d.${orders?'orderId':'offerId'} AS documentId,
      d.${orders?'orderNo':'offerNo'} AS documentNo,d.${orders?'orderDate':'offerDate'} AS documentDate,
      d.${orders?'deliveryDate':'expectedDeliveryDate'} AS deliveryDate,d.customerCode,d.customerName,
      ${orders?"'Cliente'":'d.customerType'} AS customerType,d.article,d.description,d.line,d.unit,d.quantity,d.unitPrice,d.netPrice,d.netAmount,d.currency,d.createdDate,d.lineCreatedDate,
      ${orders?'d.deliveredQuantity,d.residual,d.delivered,d.cancelled,d.headerDelivered,d.headerCancelled,d.confirmedDeliveryDate,NULL AS validityDate':'NULL AS deliveredQuantity,NULL AS residual,NULL AS delivered,NULL AS cancelled,NULL AS headerDelivered,NULL AS headerCancelled,NULL AS confirmedDeliveryDate,d.validityDate'}
      FROM ${orders?'Orders':'Offers'} d JOIN Links l ON l.${orders?'orderId=d.orderId':'offerId=d.offerId'}
      WHERE l.${orders?'offerId':'orderId'}=@id ORDER BY documentDate DESC,documentId,line`};
}
