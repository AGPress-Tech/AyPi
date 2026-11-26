import { AnalysisContext } from "../analysis-navigation-model";
export const ERP_BLOCKS = [
    { id: "customers", label: "Anagrafiche clienti" },
    { id: "suppliers", label: "Anagrafica fornitori" },
    { id: "articles", label: "Articoli" },
    { id: "contracts", label: "Contratti" },
    { id: "orders", label: "Ordini" },
    { id: "stock", label: "Magazzino" },
] as const;
export type ErpColumn = { key: string; label: string; kind: string; type?: string };
export type ErpPage = { dataset: string; label: string; columns: ErpColumn[]; keys: string[]; rows: Record<string, any>[]; total: number; relations: { id: string; label: string; target: string; map: Record<string, string> }[]; period?: { year: number; period: number }; queriedAt: string };
export function explorerContextRequest(context: AnalysisContext) {
    if (context.productionOrderId) return { dataset: "production", where: { MOId: context.productionOrderId } };
    if (context.purchaseOrderId) return { dataset: "purchaseOrders", where: { PurchaseOrdId: context.purchaseOrderId } };
    if (context.contractId) return { dataset: "contracts", where: { SuppQuotaId: context.contractId } };
    if (context.documentId && context.documentKind) return context.documentKind === "order" ? { dataset: "orders", where: { SaleOrdId: context.documentId } } : { dataset: "offers", where: { CustQuotaId: context.documentId } };
    if (context.customerCode) return { dataset: "customers", where: { CustSupp: context.customerCode } };
    if (context.supplierCode) return { dataset: "suppliers", where: { CustSupp: context.supplierCode } };
    return { dataset: "articles", where: { Item: context.article || context.bom || "" } };
}
/** Resolve only the clicked cell; never attach a row's identity to a generic value. */
export function explorerCellContext(dataset: string, row: Record<string, any>, field: string): AnalysisContext | null {
    const item = row[field]; if (item === null || item === undefined || item === "") return null;
    if (field === "_PartyName") return ["orders", "offers"].includes(dataset)
        ? explorerCellContext(dataset, row, "Customer") : explorerCellContext(dataset, row, "Supplier");
    if (field === "_DocumentNo") {
        if (row.SaleOrdId) return { documentId: String(row.SaleOrdId), documentNo: String(item), documentKind: "order" };
        if (row.CustQuotaId) return { documentId: String(row.CustQuotaId), documentNo: String(item), documentKind: "offer" };
        if (row.PurchaseOrdId) return { purchaseOrderId: String(row.PurchaseOrdId) };
        if (row.MOId) return { productionOrderId: String(row.MOId) };
        if (row.SuppQuotaId) return { contractId: String(row.SuppQuotaId) };
    }
    if (["Item", "Component"].includes(field)) return { article: String(item) };
    if (field === "BOM") return { bom: String(item) };
    if (field === "MOId" || (field === "MONo" && dataset === "production")) return row.MOId ? { productionOrderId: String(row.MOId) } : null;
    if (field === "Customer") return row.UseContact === true || String(row.UseContact) === "1" ? null : { customerCode: String(item) };
    if (field === "Supplier") return { supplierCode: String(item) };
    if (["CustSupp", "CompanyName"].includes(field)) {
        if (dataset === "customers" || Number(row.CustSuppType) === 3211264) return { customerCode: String(row.CustSupp), customerName: String(row.CompanyName || row.CustSupp) };
        if (dataset === "suppliers" || Number(row.CustSuppType) === 3211265) return { supplierCode: String(row.CustSupp), supplierName: String(row.CompanyName || row.CustSupp) };
    }
    if (field === "SaleOrdId" || (field === "InternalOrdNo" && dataset === "orders")) return row.SaleOrdId ? { documentId: String(row.SaleOrdId), documentNo: String(row.InternalOrdNo || row.SaleOrdId), documentKind: "order" } : null;
    if (field === "CustQuotaId" || (field === "QuotationNo" && dataset === "offers")) return row.CustQuotaId ? { documentId: String(row.CustQuotaId), documentNo: String(row.QuotationNo || row.CustQuotaId), documentKind: "offer" } : null;
    if (field === "PurchaseOrdId" || (field === "InternalOrdNo" && dataset === "purchaseOrders")) return row.PurchaseOrdId ? { purchaseOrderId: String(row.PurchaseOrdId) } : null;
    if (field === "SuppQuotaId" || (field === "QuotationNo" && dataset === "contracts")) return row.SuppQuotaId ? { contractId: String(row.SuppQuotaId) } : null;
    return null;
}
