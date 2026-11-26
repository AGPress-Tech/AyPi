import type { ErpColumn, ErpPage } from "./model";

// This is an operational view, not a browser for the ERP database schema.
const party = ["CustSupp", "CompanyName", "City", "Telephone1", "EMail"];
const line = ["_DocumentNo", "Item", "Description", "Qty", "UoM", "DeliveredQty"];
export const explorerDefaultColumns: Record<string, string[]> = {
    customers: party, suppliers: party,
    articles: ["Item", "Description", "BaseUoM"],
    contracts: ["QuotationNo", "Supplier", "_PartyName", "QuotationDate", "ValidityEndingDate"],
    orders: ["InternalOrdNo", "Customer", "_PartyName", "OrderDate", "ExpectedDeliveryDate", "Delivered"],
    purchaseOrders: ["InternalOrdNo", "Supplier", "_PartyName", "OrderDate", "ExpectedDeliveryDate", "Delivered"],
    offers: ["QuotationNo", "Customer", "_PartyName", "QuotationDate"],
    stock: ["Item", "_Description", "Storage", "_Unit", "_Quantity", "_Available"],
    saleLines: line, purchaseLines: line, offerLines: line, contractLines: line,
    production: ["MONo", "BOM", "UoM", "ProductionQty", "ProducedQty", "DeliveryDate"],
    productionSteps: ["RtgStep", "WC", "UoM", "ProductionQty", "ProducedQty"],
    productionComponents: ["_DocumentNo", "Component", "UoM", "NeededQty", "PickedQuantity"],
    productionEntries: ["_DocumentNo", "PostingDate", "Item", "RtgStep", "UoM", "ProducedQty"],
    goods: ["Item", "NetWeight", "GrossWeight"], storages: ["Storage", "Description"],
};
const extra: Record<string, string[]> = {
    customers: ["TaxIdNumber", "FiscalCode", "Address", "ZIPCode", "County", "Country", "Disabled"],
    suppliers: ["TaxIdNumber", "FiscalCode", "Address", "ZIPCode", "County", "Country", "Disabled"],
    articles: ["NetWeight", "GrossWeight", "Disabled"],
    stock: ["ReservedSaleOrd", "ReservedByProd", "OrderedPurchOrd", "OrderedToProd", "ReceivedQty", "IssuedQty", "_StorageDescription"],
    contracts: ["ClosedOrder", "Currency", "Notes"],
    orders: ["Cancelled", "Currency", "Notes"], purchaseOrders: ["Cancelled", "Currency", "Notes"], offers: ["ClosedOrder", "Currency", "Notes"],
    production: ["StartingDate", "EndingDate", "ScrapQuantity", "Simulation"],
    productionSteps: ["ScrapQuantity"], productionComponents: ["WasteQuantity", "Closed"],
    productionEntries: ["Storage", "PostedToInventory"],
};
const labels: Record<string, string> = {
    CustSupp: "Codice", CompanyName: "Ragione sociale", City: "Città", Telephone1: "Telefono", EMail: "Email",
    Item: "Articolo", Description: "Descrizione", BaseUoM: "U.M.", UoM: "U.M.", _Unit: "U.M.",
    Customer: "Codice cliente", Supplier: "Codice fornitore", _PartyName: "Ragione sociale", _DocumentNo: "Documento",
    InternalOrdNo: "Ordine", QuotationNo: "Documento", OrderDate: "Data ordine", QuotationDate: "Data",
    ExpectedDeliveryDate: "Consegna prevista", ValidityEndingDate: "Scadenza", Delivered: "Evaso", Cancelled: "Annullato", ClosedOrder: "Chiuso", Currency: "Valuta", Notes: "Note",
    _Description: "Descrizione articolo", Storage: "Magazzino", _StorageDescription: "Descrizione magazzino", _Quantity: "Giacenza", _Available: "Disponibile",
    ReservedSaleOrd: "Impegnata per clienti", ReservedByProd: "Impegnata per produzione", OrderedPurchOrd: "Ordinata a fornitori", OrderedToProd: "Ordinata in produzione", ReceivedQty: "Caricata a magazzino", IssuedQty: "Scaricata da magazzino",
    Qty: "Quantità", DeliveredQty: "Consegnata", UnitValue: "Prezzo unitario", NetPrice: "Prezzo netto", TaxableAmount: "Importo netto",
    MONo: "Ordine produzione", BOM: "Distinta", Component: "Componente", WC: "Centro di lavoro", RtgStep: "Fase", ProductionQty: "Quantità prevista", ProducedQty: "Prodotta", NeededQty: "Fabbisogno", PickedQuantity: "Prelevata", WasteQuantity: "Scarto", ScrapQuantity: "Scarto", Simulation: "Simulazione",
    DeliveryDate: "Consegna", StartingDate: "Inizio", EndingDate: "Fine", PostingDate: "Registrazione", PostedToInventory: "Versata a magazzino",
    NetWeight: "Peso netto", GrossWeight: "Peso lordo", TaxIdNumber: "Partita IVA", FiscalCode: "Codice fiscale", Address: "Indirizzo", ZIPCode: "CAP", County: "Provincia", Country: "Paese", Disabled: "Disattivato", Closed: "Chiuso",
};
const contactFields = ["Address", "ZIPCode", "City", "County", "Country", "Telephone1", "EMail", "ContactName", "Name"];
export function explorerColumns(dataset: string, columns: ErpColumn[]): ErpColumn[] {
    const fields = explorerDefaultColumns[dataset] || contactFields;
    const allowed = [...fields, ...(extra[dataset] || []), ...(["saleLines", "purchaseLines", "offerLines", "contractLines"].includes(dataset) ? ["UnitValue", "NetPrice", "TaxableAmount", "Currency", "Notes"] : [])];
    return allowed.flatMap(key => {
        const column = columns.find(c => c.key === key);
        if (!column) return [];
        const label = key === "QuotationNo" ? dataset === "offers" ? "Offerta" : "Contratto"
            : key === "DeliveredQty" && dataset === "purchaseLines" ? "Ricevuta"
            : labels[key] || ({ ContactName: "Contatto", Name: "Nome" })[key];
        return label ? [{ ...column, label }] : [];
    });
}
export function explorerRelations(relations: ErpPage["relations"]): ErpPage["relations"] {
    return relations.filter(r => !!explorerDefaultColumns[r.target] || ["Contatti", "Indirizzi e sedi"].includes(r.label));
}
export function formatExplorerValue(value: unknown, column: ErpColumn): string {
    if (value == null || value === "") return "—";
    if (column.kind === "boolean") return value === true || value === 1 || value === "1" ? "Sì" : "No";
    if (column.kind === "number") {
        const text = String(value);
        if (/^-?\d+(?:\.\d+)?$/.test(text)) {
            // Round the display as decimal text: do not lose significant digits in large values.
            const negative = text.startsWith("-"), [whole, fraction = ""] = text.replace(/^-/, "").split(".");
            let scaled = BigInt(whole) * 1000n + BigInt((fraction + "000").slice(0, 3));
            if (Number(fraction[3] || 0) >= 5) scaled++;
            const decimals = (scaled % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
            return (negative && scaled !== 0n ? "-" : "") + (scaled / 1000n).toLocaleString("it-IT") + (decimals ? "," + decimals : "");
        }
        const number = Number(value);
        return Number.isFinite(number) ? new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 }).format(number) : "—";
    }
    if (column.kind === "date") {
        const date = new Date(String(value));
        return Number.isFinite(date.getTime()) ? date.toLocaleDateString("it-IT", { timeZone: "UTC" }) : "—";
    }
    return String(value);
}
