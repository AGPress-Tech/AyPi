export const ANALYSIS_TARGETS = [
    "article-orders",
    "article-offers",
    "customer-analysis",
    "turning-analysis",
    "bom-analysis",
    "bar-contracts",
    "stock-analysis",
    "supplier-evaluation",
    "processing-cycles",
    "tooling",
] as const;
export type AnalysisTarget = (typeof ANALYSIS_TARGETS)[number];
export type AnalysisContext = {
    article?: string;
    bom?: string;
    customerCode?: string;
    customerName?: string;
    supplierCode?: string;
    supplierName?: string;
    documentId?: string;
    documentNo?: string;
    documentKind?: "order" | "offer";
};
export function validateAnalysisContext(value: unknown): AnalysisContext {
    if (value === undefined) return {};
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("Contesto analisi non valido.");
    const clean: AnalysisContext = {};
    for (const [key, item] of Object.entries(value)) {
        if (
            ![
                "article",
                "bom",
                "customerCode",
                "customerName",
                "supplierCode",
                "supplierName",
                "documentId",
                "documentNo",
                "documentKind",
            ].includes(key) ||
            typeof item !== "string" ||
            !item.trim() ||
            item.length >
                (["customerName", "supplierName"].includes(key) ? 256 : 128)
        )
            throw Error("Collegamento analisi non valido.");
        (clean as any)[key] = item.trim();
    }
    if (
        (clean.documentKind &&
            !["order", "offer"].includes(clean.documentKind)) ||
        (clean.documentId && !/^\d{1,10}$/.test(clean.documentId))
    )
        throw Error("Documento non valido.");
    return clean;
}
