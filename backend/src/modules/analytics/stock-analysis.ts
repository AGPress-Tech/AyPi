export type StockRequest = {
    year?: number;
    period?: number;
    article?: string;
    supplierCode?: string;
    customerCode?: string;
};
export function stockCustomerCommitmentsQuery(input: unknown) {
    if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => key !== "article") ||
        typeof (input as any).article !== "string" ||
        !(input as any).article.trim() ||
        (input as any).article.length > 128
    )
        throw Error("Seleziona un articolo valido.");
    return {
        article: (input as any).article.trim(),
        sql: `
SELECT TOP (100001) d.Item AS article,d.Description AS description,h.Customer AS customerCode,c.CompanyName AS customerName,
h.SaleOrdId AS documentId,h.InternalOrdNo AS documentNo,CONVERT(date,h.OrderDate) AS documentDate,d.Line AS line,d.SubId AS subId,
d.UoM AS unit,d.Qty AS quantity,d.DeliveredQty AS deliveredQuantity,
CASE WHEN d.Qty IS NULL OR d.DeliveredQty IS NULL THEN NULL WHEN d.Qty-d.DeliveredQty>0 THEN d.Qty-d.DeliveredQty ELSE 0 END AS residual,
d.AllocatedQty AS allocated,d.PickedQty AS picked,d.BookedQty AS booked,
COALESCE(NULLIF(d.StoragePhase1,''),h.StoragePhase1) AS storage,
CONVERT(date,COALESCE(CASE WHEN d.ExpectedDeliveryDate>='19000101' THEN d.ExpectedDeliveryDate END,CASE WHEN h.ExpectedDeliveryDate>='19000101' THEN h.ExpectedDeliveryDate END)) AS deliveryDate
FROM dbo.MA_SaleOrdDetails d JOIN dbo.MA_SaleOrd h ON h.SaleOrdId=d.SaleOrdId
LEFT JOIN dbo.MA_CustSupp c ON c.CustSupp=h.Customer AND c.CustSuppType=h.CustSuppType
WHERE d.Item=@article AND LTRIM(d.Item) NOT LIKE '*%' AND COALESCE(h.Cancelled,'0')<>'1' AND COALESCE(d.Cancelled,'0')<>'1'
AND COALESCE(h.Delivered,'0')<>'1' AND COALESCE(d.Delivered,'0')<>'1'
AND (d.Qty-d.DeliveredQty>0 OR d.AllocatedQty<>0 OR d.PickedQty<>0)
ORDER BY c.CompanyName,h.Customer,h.OrderDate,h.SaleOrdId,d.Line,d.SubId`,
    };
}
export function validateStockRequest(value: unknown): StockRequest {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("Ricerca giacenze non valida.");
    const clean: StockRequest = {};
    for (const [key, v] of Object.entries(value)) {
        if (key === "year" || key === "period") {
            if (
                !Number.isInteger(v) ||
                Number(v) < (key === "year" ? 1900 : 1) ||
                Number(v) > (key === "year" ? 9999 : 99)
            )
                throw Error("Esercizio o periodo non valido.");
            clean[key] = v as number;
        } else if (["article", "supplierCode", "customerCode"].includes(key)) {
            if (typeof v !== "string" || !v.trim() || v.length > 128)
                throw Error("Codice ricerca non valido.");
            (clean as any)[key] = v.trim();
        } else throw Error("Parametro giacenze non valido.");
    }
    return clean;
}
/** Verified against MA_ItemsStorageQty / MA_Storages on NuovaAGP, 20 November 2026.
 * Read one fiscal year AND period; never sum successive fiscal snapshots.
 * Specificator types 6750208/09 identify customers/suppliers, independently of ownership.
 */
export function stockAnalysisQuery(input: unknown) {
    const filters = validateStockRequest(input);
    return {
        filters,
        sql: `
DECLARE @selectedYear int=COALESCE(@year,(SELECT MAX(FiscalYear) FROM dbo.MA_ItemsStorageQty WHERE FiscalYear<=YEAR(GETDATE())));
DECLARE @selectedPeriod int=COALESCE(@period,(SELECT MAX(FiscalPeriod) FROM dbo.MA_ItemsStorageQty WHERE FiscalYear=@selectedYear));
SELECT TOP(100001) q.Item AS article,i.Description AS description,i.BaseUoM AS unit,i.Disabled AS articleDisabled,
 q.Storage AS storage,s.Description AS storageDescription,s.OwnedGoods AS owned,s.Disabled AS storageDisabled,
 q.Specificator AS subjectCode,q.SpecificatorType AS subjectType,c.CompanyName AS subjectName,
 q.DefaultLocation AS location,q.InitialQty AS initial,q.ReceivedQty AS received,q.IssuedQty AS issued,
 q.InitialQty+q.ReceivedQty-q.IssuedQty AS quantity,
 q.ReservedSaleOrd AS reservedSales,q.ReservedByProd AS reservedProduction,
 q.OrderedPurchOrd AS orderedPurchase,q.OrderedToProd AS orderedProduction,
 q.MinimumStock AS minimum,q.MaximumStock AS maximum,q.PickedQty AS picked,q.AllocatedQty AS allocated,
 q.FiscalYear AS fiscalYear,q.FiscalPeriod AS fiscalPeriod,q.TBModified AS modified
FROM dbo.MA_ItemsStorageQty q
LEFT JOIN dbo.MA_Items i ON i.Item=q.Item
LEFT JOIN dbo.MA_Storages s ON s.Storage=q.Storage
LEFT JOIN dbo.MA_CustSupp c ON c.CustSupp=q.Specificator AND c.CustSuppType=CASE q.SpecificatorType WHEN 6750208 THEN 3211264 WHEN 6750209 THEN 3211265 ELSE -1 END
WHERE q.FiscalYear=@selectedYear AND q.FiscalPeriod=@selectedPeriod
 AND (@article IS NULL OR q.Item=@article)
 AND (@supplierCode IS NULL OR (q.SpecificatorType=6750209 AND q.Specificator=@supplierCode))
 AND (@customerCode IS NULL OR (q.SpecificatorType=6750208 AND q.Specificator=@customerCode))
ORDER BY q.Item,q.Storage,q.SpecificatorType,q.Specificator;
SELECT DISTINCT FiscalYear AS year,FiscalPeriod AS period FROM dbo.MA_ItemsStorageQty ORDER BY FiscalYear DESC,FiscalPeriod DESC;
SELECT @selectedYear AS year,@selectedPeriod AS period;
SELECT TOP (100001) d.Item AS article,h.Customer AS customerCode,c.CompanyName AS customerName,d.UoM AS unit,
SUM(CASE WHEN d.Qty IS NULL OR d.DeliveredQty IS NULL THEN NULL WHEN d.Qty-d.DeliveredQty>0 THEN d.Qty-d.DeliveredQty ELSE 0 END) AS residual,
SUM(d.AllocatedQty) AS allocated,SUM(d.PickedQty) AS picked,COUNT(DISTINCT h.SaleOrdId) AS orders,
SUM(CASE WHEN d.Qty IS NULL OR d.DeliveredQty IS NULL THEN 1 ELSE 0 END) AS missingQuantities
FROM dbo.MA_SaleOrdDetails d JOIN dbo.MA_SaleOrd h ON h.SaleOrdId=d.SaleOrdId
LEFT JOIN dbo.MA_CustSupp c ON c.CustSupp=h.Customer AND c.CustSuppType=h.CustSuppType
WHERE LTRIM(d.Item) NOT LIKE '*%' AND (@article IS NULL OR d.Item=@article)
AND (@customerCode IS NULL OR h.Customer=@customerCode)
AND COALESCE(h.Cancelled,'0')<>'1' AND COALESCE(d.Cancelled,'0')<>'1' AND COALESCE(h.Delivered,'0')<>'1' AND COALESCE(d.Delivered,'0')<>'1'
AND (d.Qty-d.DeliveredQty>0 OR d.AllocatedQty<>0 OR d.PickedQty<>0)
AND EXISTS(SELECT 1 FROM dbo.MA_ItemsStorageQty q WHERE q.Item=d.Item AND q.FiscalYear=@selectedYear AND q.FiscalPeriod=@selectedPeriod)
GROUP BY d.Item,h.Customer,c.CompanyName,d.UoM ORDER BY d.Item,c.CompanyName,h.Customer,d.UoM;`,
    };
}
