import {validateArticleOrderFilters,buildArticleDocumentQuery,ArticleOrderFilters,validateDocumentSort} from './article-orders';
export const OFFER_SORT_COLUMNS=['article','description','offerNo','line','offerDate','customerCode','customerName','customerType','quantity','unit','unitPrice','netPrice','currency'];
export type ArticleOfferFilters=Pick<ArticleOrderFilters,'articles'|'customers'|'units'|'quantities'|'prices'|'offset'|'limit'|'sort'>&{
    offers?:ArticleOrderFilters['orders'];offerDates?:ArticleOrderFilters['orderDates'];
};
export function validateArticleOfferFilters(input:unknown):ArticleOfferFilters {
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Filtri non validi.');
    const value=input as any;
    if(Object.keys(value).some(k=>!['articles','customers','offers','offerDates','quantities','units','prices','offset','limit','sort'].includes(k)))throw new Error('Filtro offerte non previsto.');
    const {articles,customers,orders,orderDates,quantities,units,prices,offset,limit}=validateArticleOrderFilters({
        articles:value.articles,customers:value.customers,orders:value.offers,orderDates:value.offerDates,quantities:value.quantities,units:value.units,prices:value.prices,offset:value.offset,limit:value.limit,
    });
    return {articles,customers,offers:orders,offerDates:orderDates,quantities,units,prices,offset,limit,sort:validateDocumentSort(value.sort,OFFER_SORT_COLUMNS)};
}
export const ARTICLE_OFFER_SOURCE=`SELECT d.Item AS article,d.Description AS description,h.QuotationNo AS offerNo,
 h.CustQuotaId AS offerId,d.Line AS line,
 CASE WHEN h.QuotationDate>='19000101' THEN CONVERT(date,h.QuotationDate) END AS offerDate,
 CASE WHEN h.UseContact='1' THEN h.Contact ELSE h.Customer END AS customerCode,
 CASE WHEN h.UseContact='1' THEN contact.CompanyName ELSE c.CompanyName END AS customerName,
 CASE WHEN h.UseContact='1' THEN 'Contatto' ELSE 'Cliente' END AS customerType,
 d.Qty AS quantity,d.UoM AS unit,d.UnitValue AS unitPrice,d.NetPrice AS netPrice,h.Currency AS currency
 FROM dbo.MA_CustQuotasDetail d JOIN dbo.MA_CustQuotas h ON h.CustQuotaId=d.CustQuotaId
 LEFT JOIN dbo.MA_CustSupp c ON h.UseContact<>'1' AND c.CustSupp=h.Customer AND c.CustSuppType=h.CustSuppType
 LEFT JOIN dbo.MA_Contacts contact ON h.UseContact='1' AND contact.Contact=h.Contact
 WHERE NULLIF(LTRIM(RTRIM(d.Item)),'') IS NOT NULL`;
export function buildArticleOfferQuery(input:unknown){
    const filters=validateArticleOfferFilters(input);
    return buildArticleDocumentQuery(filters,{
        source:ARTICLE_OFFER_SOURCE,text:{articles:['article'],customers:['customerCode','customerName'],offers:['offerNo'],units:['unit']},
        ranges:{offerDates:'offerDate',quantities:'quantity',prices:'unitPrice'},dates:['offerDates'],conditions:[],
        order:'article,offerDate DESC,offerId DESC,line',sortable:OFFER_SORT_COLUMNS,
    });
}
