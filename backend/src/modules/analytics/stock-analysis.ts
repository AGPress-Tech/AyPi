export type StockRequest={year?:number;period?:number;article?:string;supplierCode?:string;customerCode?:string};
export function validateStockRequest(value:unknown):StockRequest{
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Ricerca giacenze non valida.');
    const clean:StockRequest={};
    for(const [key,v] of Object.entries(value)){
        if(key==='year'||key==='period'){
            if(!Number.isInteger(v)||Number(v)<(key==='year'?1900:1)||Number(v)>(key==='year'?9999:99))throw Error('Esercizio o periodo non valido.');
            clean[key]=v as number;
        }else if(['article','supplierCode','customerCode'].includes(key)){
            if(typeof v!=='string'||!v.trim()||v.length>128)throw Error('Codice ricerca non valido.');
            (clean as any)[key]=v.trim();
        }else throw Error('Parametro giacenze non valido.');
    }
    return clean;
}
/** Verified against MA_ItemsStorageQty / MA_Storages on NuovaAGP, 20 November 2026.
 * Read one fiscal year AND period; never sum successive fiscal snapshots.
 * Specificator types 6750208/09 identify customers/suppliers, independently of ownership.
 */
export function stockAnalysisQuery(input:unknown){
    const filters=validateStockRequest(input);
    return {filters,sql:`
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
SELECT @selectedYear AS year,@selectedPeriod AS period;`};
}
