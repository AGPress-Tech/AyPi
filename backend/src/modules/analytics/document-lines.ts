import { validateDocumentLinkRequest } from "./document-links";

/** Exact ERP identity, with every detail line, including text/internal lines. */
export function documentLinesQuery(input: unknown) {
    const { kind, id } = validateDocumentLinkRequest(input);
    const order = kind === "order";
    return {
        bindings: [{ name: "id", value: id }],
        sql: `SELECT TOP (100001) '${kind}' AS kind,h.${order ? "SaleOrdId" : "CustQuotaId"} AS documentId,
 h.${order ? "InternalOrdNo" : "QuotationNo"} AS documentNo,
 h.${order ? "OrderDate" : "QuotationDate"} AS documentDate,
 d.Line AS line,d.Item AS article,d.Description AS description,d.Qty AS quantity,d.UoM AS unit,
 ${order ? "d.DeliveredQty" : "NULL"} AS deliveredQuantity,
 ${order ? "CASE WHEN d.Cancelled='1' OR h.Cancelled='1' OR d.Delivered='1' THEN 0 ELSE CASE WHEN d.Qty-d.DeliveredQty>0 THEN d.Qty-d.DeliveredQty ELSE 0 END END" : "NULL"} AS residual,
 d.UnitValue AS unitPrice,d.NetPrice AS netPrice,d.TaxableAmount AS netAmount,h.Currency AS currency,
 h.Customer AS customerCode
 FROM dbo.${order ? "MA_SaleOrdDetails" : "MA_CustQuotasDetail"} d
 JOIN dbo.${order ? "MA_SaleOrd" : "MA_CustQuotas"} h ON h.${order ? "SaleOrdId" : "CustQuotaId"}=d.${order ? "SaleOrdId" : "CustQuotaId"}
 WHERE h.${order ? "SaleOrdId" : "CustQuotaId"}=@id ORDER BY d.Line${order ? ",d.SubId" : ""}`,
    };
}
