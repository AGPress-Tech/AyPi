// Read-only business views verified against NuovaAGP metadata, 26 November 2026.
import { specialFilterSql } from "./special-filters";
import { validateSpecialFilters } from "./special-filter-model";
import { businessFilterFields } from "./business-filter-fields";
export const BUSINESS_COLUMNS: Record<string, string[]> = {
    prices: ["source", "priceList", "priceListName", "customerCode", "customerName", "article", "description", "minimumQuantity", "unit", "price", "currency", "discount1", "discount2", "discountFormula", "taxIncluded", "validFrom", "validTo", "status", "notes"],
    commitments: ["customerCode", "customerName", "orderNo", "line", "article", "description", "orderDate", "deliveryDate", "quantity", "deliveredQuantity", "residual", "unit", "allocated", "picked", "storage"],
};
const isoDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function validateBusinessRequest(input: any) {
    if (!input || typeof input !== "object" || Array.isArray(input) || !["prices", "commitments", "manager"].includes(input.mode) || Object.keys(input).some(key => !["mode", "search", "article", "customerCode", "sort", "offset", "limit", "asOf", "from", "to", "currentOnly", "special"].includes(key))) throw Error("Analisi gestionale non valida.");
    if (!isoDate(input.asOf)) throw Error("Data di riferimento non valida.");
    const clean = { mode: input.mode as string, search: input.search ?? "", article: input.article ?? "", customerCode: input.customerCode ?? "", sort: input.sort ?? [], offset: input.offset ?? 0, limit: input.limit ?? 250, asOf: input.asOf, from: input.from ?? `${Number(input.asOf.slice(0, 4)) - 2}-01-01`, to: input.to ?? input.asOf, currentOnly: input.currentOnly ?? false };
    for (const value of [clean.search, clean.article, clean.customerCode]) if (typeof value !== "string" || value.length > 128) throw Error("Ricerca non valida.");
    if (![clean.asOf, clean.from, clean.to].every(isoDate) || clean.from > clean.to || Number(clean.to.slice(0, 4)) - Number(clean.from.slice(0, 4)) > 10 || typeof clean.currentOnly !== "boolean" || !Number.isInteger(clean.offset) || clean.offset < 0 || clean.offset > 1000000 || !Number.isInteger(clean.limit) || clean.limit < 1 || clean.limit > 1000) throw Error("Periodo o limite non valido.");
    const seen = new Set();
    if (!Array.isArray(clean.sort) || clean.sort.length > 20) throw Error("Ordinamento non valido.");
    for (const item of clean.sort) {
        if (!item || Object.keys(item).some(key => !["key", "direction"].includes(key)) || !(BUSINESS_COLUMNS[clean.mode] || []).includes(item.key) || !["asc", "desc"].includes(item.direction) || seen.has(item.key)) throw Error("Ordinamento non valido.");
        seen.add(item.key);
    }
    return { ...clean, special: validateSpecialFilters(input.special, businessFilterFields(BUSINESS_COLUMNS[input.mode] || [])) };
}
const date = (column: string) => `CASE WHEN ${column}>='19000101' THEN CONVERT(date,${column}) END`;
export const COMMITMENT_SOURCE = `SELECT h.SaleOrdId AS orderId,h.InternalOrdNo AS orderNo,d.Line AS line,d.SubId AS subId,h.Customer AS customerCode,c.CompanyName AS customerName,
d.Item AS article,d.Description AS description,${date("h.OrderDate")} AS orderDate,
COALESCE(${date("d.ExpectedDeliveryDate")},${date("h.ExpectedDeliveryDate")}) AS deliveryDate,
d.Qty AS quantity,d.DeliveredQty AS deliveredQuantity,d.Qty-d.DeliveredQty AS residual,d.UoM AS unit,d.AllocatedQty AS allocated,d.PickedQty AS picked,
COALESCE(NULLIF(d.StoragePhase1,''),h.StoragePhase1) AS storage,d.TaxableAmount AS lineAmount,h.Currency AS currency
FROM dbo.MA_SaleOrdDetails d JOIN dbo.MA_SaleOrd h ON h.SaleOrdId=d.SaleOrdId
LEFT JOIN dbo.MA_CustSupp c ON c.CustSupp=h.Customer AND c.CustSuppType=h.CustSuppType
WHERE NULLIF(LTRIM(RTRIM(d.Item)),'') IS NOT NULL AND LTRIM(d.Item) NOT LIKE '*%'
AND COALESCE(h.Cancelled,'0')<>'1' AND COALESCE(d.Cancelled,'0')<>'1'
AND COALESCE(h.Delivered,'0')<>'1' AND COALESCE(d.Delivered,'0')<>'1' AND d.Qty-d.DeliveredQty>0`;
export const CUSTOMER_PRICE_SOURCE = `SELECT r.*,
CASE WHEN headerFrom IS NULL OR rowFrom>headerFrom THEN rowFrom ELSE headerFrom END AS validFrom,
CASE WHEN headerTo IS NULL OR rowTo<headerTo THEN rowTo ELSE headerTo END AS validTo
FROM (
SELECT 'Listino' AS source,p.PriceList AS priceList,l.Description AS priceListName,c.CustSupp AS customerCode,c.CompanyName AS customerName,p.Item AS article,i.Description AS description,
p.Qty AS minimumQuantity,p.PriceListUoM AS unit,p.Price AS price,l.Currency AS currency,p.Discount1 AS discount1,p.Discount2 AS discount2,p.DiscountFormula AS discountFormula,
CASE WHEN p.WithTax='1' THEN 'Inclusa' WHEN p.WithTax='0' THEN 'Esclusa' ELSE 'Non definita' END AS taxIncluded,
${date("p.ValidityStartingDate")} AS rowFrom,${date("p.ValidityEndingDate")} AS rowTo,${date("l.ValidityStartingDate")} AS headerFrom,${date("l.ValidityEndingDate")} AS headerTo,
CASE WHEN p.Disabled='1' OR l.Disabled='1' THEN 1 ELSE 0 END AS disabled,p.Notes AS notes
FROM dbo.MA_ItemsPriceLists p JOIN dbo.MA_PriceLists l ON l.PriceList=p.PriceList
LEFT JOIN dbo.MA_CustSupp c ON c.PriceList=p.PriceList AND c.CustSuppType=3211264
LEFT JOIN dbo.MA_Items i ON i.Item=p.Item
UNION ALL
SELECT 'Specifico cliente','', '',p.Customer,c.CompanyName,p.Item,i.Description,p.Qty,p.UoM,p.Price,CAST(NULL AS varchar(8)),p.Discount1,p.Discount2,p.DiscountFormula,
CASE WHEN p.WithTax='1' THEN 'Inclusa' WHEN p.WithTax='0' THEN 'Esclusa' ELSE 'Non definita' END,
${date("p.ValidityStartingDate")},${date("p.ValidityEndingDate")},CAST(NULL AS date),CAST(NULL AS date),0,p.Notes
FROM dbo.MA_ItemCustomersPriceLists p LEFT JOIN dbo.MA_CustSupp c ON c.CustSupp=p.Customer AND c.CustSuppType=3211264
LEFT JOIN dbo.MA_Items i ON i.Item=p.Item) r`;
export function businessTableQuery(input: unknown) {
    const filters = validateBusinessRequest(input);
    if (filters.mode === "manager") throw Error("Usare il riepilogo Manager.");
    const bindings: { name: string; type: string; value: unknown }[] = [];
    const bind = (value: unknown, type = "text") => { const name = `p${bindings.length}`; bindings.push({ name, type, value }); return "@" + name; };
    const conditions = [];
    if (filters.article) conditions.push(`article=${bind(filters.article)}`);
    if (filters.customerCode) conditions.push(`customerCode=${bind(filters.customerCode)}`);
    if (filters.search.trim()) {
        const pattern = bind("%" + filters.search.trim().replace(/[\[\]%_\\]/g, "\\$&") + "%");
        conditions.push("(" + ["article", "description", "customerCode", "customerName", ...(filters.mode === "prices" ? ["priceList", "priceListName"] : ["orderNo", "storage"])].map(field => `[${field}] LIKE ${pattern} ESCAPE '\\'`).join(" OR ") + ")");
    }
    const asOf = bind(filters.asOf, "date");
    conditions.push(...specialFilterSql(filters.special, businessFilterFields(BUSINESS_COLUMNS[filters.mode]), bind, true));
    if (filters.mode === "prices" && filters.currentOnly) conditions.push(`disabled=0 AND (validFrom IS NULL OR validFrom<=${asOf}) AND (validTo IS NULL OR validTo>=${asOf})`);
    const offset = bind(filters.offset, "int"), limit = bind(filters.limit, "int");
    const source = filters.mode === "prices" ? CUSTOMER_PRICE_SOURCE : COMMITMENT_SOURCE;
    const selected = filters.mode === "prices" ? `*,CASE WHEN disabled=1 THEN 'Disattivato' WHEN validTo<${asOf} THEN 'Scaduto' WHEN validFrom>${asOf} THEN 'Futuro' ELSE 'In validità' END AS status` : "*";
    const order = [...filters.sort.map((item: any) => `[${item.key}] ${item.direction.toUpperCase()}`), ...(filters.mode === "prices" ? ["source", "priceList", "customerCode", "article", "minimumQuantity", "rowFrom", "rowTo", "unit"] : ["deliveryDate", "orderId", "line", "subId"]).filter(key => !filters.sort.some((item: any) => item.key === key))].join(",");
    return { filters, bindings, sql: `WITH Data AS (${source}), Visible AS (SELECT ${selected} FROM Data) SELECT *,COUNT_BIG(*) OVER() AS totalRows FROM Visible WHERE ${conditions.join(" AND ") || "1=1"} ORDER BY ${order} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY` };
}

export function managerQuery(input: unknown) {
    const filters = validateBusinessRequest(input);
    if (filters.mode !== "manager" || filters.search || filters.article || filters.customerCode) throw Error("Parametri Manager non validi.");
    const sales = `SELECT h.SaleOrdId AS orderId,h.Customer AS customerCode,c.CompanyName AS customerName,CONVERT(date,h.OrderDate) AS orderDate,d.TaxableAmount AS amount,COALESCE(NULLIF(h.Currency,''),'Valuta non indicata') AS currency
FROM dbo.MA_SaleOrd h JOIN dbo.MA_SaleOrdDetails d ON d.SaleOrdId=h.SaleOrdId LEFT JOIN dbo.MA_CustSupp c ON c.CustSupp=h.Customer AND c.CustSuppType=h.CustSuppType
WHERE COALESCE(h.Cancelled,'0')<>'1' AND COALESCE(d.Cancelled,'0')<>'1' AND h.OrderDate>=@from AND h.OrderDate<DATEADD(day,1,@to)`;
    return { filters, sql: `
WITH OpenRows AS (${COMMITMENT_SOURCE}) SELECT COUNT_BIG(*) AS rows,COUNT(DISTINCT orderId) AS orders,COUNT(DISTINCT customerCode) AS customers,COUNT(DISTINCT article) AS articles,SUM(CASE WHEN deliveryDate<@asOf THEN 1 ELSE 0 END) AS lateRows,SUM(CASE WHEN deliveryDate IS NULL THEN 1 ELSE 0 END) AS undatedRows FROM OpenRows;
WITH Sales AS (${sales}) SELECT COUNT(DISTINCT orderId) AS orders,COUNT(DISTINCT customerCode) AS customers,COUNT_BIG(*) AS rows FROM Sales;
WITH Sales AS (${sales}) SELECT CONVERT(char(7),orderDate,126) AS month,COALESCE(NULLIF(currency,''),'Valuta non indicata') AS currency,SUM(amount) AS amount,SUM(CASE WHEN amount IS NULL THEN 1 ELSE 0 END) AS missingAmounts,COUNT(DISTINCT orderId) AS orders FROM Sales GROUP BY CONVERT(char(7),orderDate,126),currency ORDER BY month,currency;
WITH Sales AS (${sales}), Ranked AS (SELECT customerCode,customerName,COALESCE(NULLIF(currency,''),'Valuta non indicata') AS currency,SUM(amount) AS amount,COUNT(DISTINCT orderId) AS orders,SUM(CASE WHEN amount IS NULL THEN 1 ELSE 0 END) AS missingAmounts,ROW_NUMBER() OVER(PARTITION BY currency ORDER BY SUM(amount) DESC,customerCode) AS position FROM Sales GROUP BY customerCode,customerName,currency) SELECT * FROM Ranked WHERE position<=15 ORDER BY currency,position;
WITH OpenRows AS (${COMMITMENT_SOURCE}) SELECT COALESCE(NULLIF(currency,''),'Valuta non indicata') AS currency,SUM(lineAmount*residual/NULLIF(quantity,0)) AS estimatedAmount,SUM(CASE WHEN lineAmount IS NULL THEN 1 ELSE 0 END) AS missingAmounts,COUNT_BIG(*) AS rows FROM OpenRows GROUP BY COALESCE(NULLIF(currency,''),'Valuta non indicata') ORDER BY currency;
WITH OpenRows AS (${COMMITMENT_SOURCE}) SELECT COALESCE(NULLIF(unit,''),'U.M. non indicata') AS unit,SUM(residual) AS quantity,SUM(CASE WHEN deliveryDate<@asOf THEN residual ELSE 0 END) AS lateQuantity FROM OpenRows GROUP BY COALESCE(NULLIF(unit,''),'U.M. non indicata') ORDER BY unit;
SELECT COALESCE(NULLIF(h.Currency,''),'Valuta non indicata') AS currency,COUNT(DISTINCT h.PurchaseOrdId) AS orders,COUNT_BIG(*) AS rows,SUM(d.TaxableAmount*(d.Qty-d.DeliveredQty)/NULLIF(d.Qty,0)) AS estimatedAmount,SUM(CASE WHEN d.TaxableAmount IS NULL THEN 1 ELSE 0 END) AS missingAmounts
FROM dbo.MA_PurchaseOrd h JOIN dbo.MA_PurchaseOrdDetails d ON d.PurchaseOrdId=h.PurchaseOrdId WHERE COALESCE(h.Cancelled,'0')<>'1' AND COALESCE(d.Cancelled,'0')<>'1' AND COALESCE(h.Delivered,'0')<>'1' AND COALESCE(d.Delivered,'0')<>'1' AND d.Qty-d.DeliveredQty>0 GROUP BY COALESCE(NULLIF(h.Currency,''),'Valuta non indicata') ORDER BY currency;
SELECT COALESCE(NULLIF(UoM,''),'U.M. non indicata') AS unit,COUNT_BIG(*) AS orders,SUM(ProductionQty) AS plannedQuantity,SUM(CASE WHEN ProductionQty IS NULL THEN 1 ELSE 0 END) AS missingQuantities FROM dbo.MA_MO WHERE CreationDate>=@from AND CreationDate<DATEADD(day,1,@to) AND NULLIF(LTRIM(RTRIM(Simulation)),'') IS NULL GROUP BY COALESCE(NULLIF(UoM,''),'U.M. non indicata') ORDER BY unit;
` };
}
