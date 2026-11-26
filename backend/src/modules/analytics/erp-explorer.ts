import { specialFilterSql, validateStoredSpecialFilters } from "./special-filters";

type Definition = { label: string; table: string; keys: string[]; party?: number; date?: string };
export const EXPLORER_DATASETS: Record<string, Definition> = {
    customers: { label: "Anagrafiche clienti", table: "MA_CustSupp", keys: ["CustSupp", "CustSuppType"], party: 3211264 },
    suppliers: { label: "Anagrafica fornitori", table: "MA_CustSupp", keys: ["CustSupp", "CustSuppType"], party: 3211265 },
    articles: { label: "Articoli", table: "MA_Items", keys: ["Item"] },
    contracts: { label: "Contratti fornitori", table: "MA_SuppQuotas", keys: ["SuppQuotaId"], date: "QuotationDate" },
    orders: { label: "Ordini clienti", table: "MA_SaleOrd", keys: ["SaleOrdId"], date: "OrderDate" },
    purchaseOrders: { label: "Ordini fornitori", table: "MA_PurchaseOrd", keys: ["PurchaseOrdId"], date: "OrderDate" },
    offers: { label: "Offerte clienti", table: "MA_CustQuotas", keys: ["CustQuotaId"], date: "QuotationDate" },
    stock: { label: "Magazzino", table: "MA_ItemsStorageQty", keys: ["Item", "Storage", "SpecificatorType", "Specificator", "FiscalYear", "FiscalPeriod"] },
    saleLines: { label: "Voci ordini clienti", table: "MA_SaleOrdDetails", keys: ["SaleOrdId", "Line", "SubId"] },
    purchaseLines: { label: "Voci ordini fornitori", table: "MA_PurchaseOrdDetails", keys: ["PurchaseOrdId", "Line", "SubId"] },
    contractLines: { label: "Voci contratti", table: "MA_SuppQuotasDetail", keys: ["SuppQuotaId", "Line"] },
    offerLines: { label: "Voci offerte clienti", table: "MA_CustQuotasDetail", keys: ["CustQuotaId", "Line"] },
    goods: { label: "Dati fisici articolo", table: "MA_ItemsGoodsData", keys: ["Item"] },
    production: { label: "Ordini di produzione", table: "MA_MO", keys: ["MOId"], date: "CreationDate" },
    productionSteps: { label: "Fasi di produzione", table: "MA_MOSteps", keys: ["MOId", "RtgStep", "Alternate", "AltRtgStep", "SubId"] },
    productionComponents: { label: "Componenti e prelievi produzione", table: "MA_MOComponents", keys: ["MOId", "Line", "SubId"] },
    productionEntries: { label: "Registrazioni di produzione per fase", table: "MA_MOStepsDetailedQty", keys: ["MOId", "RtgStep", "Alternate", "AltRtgStep", "Line"], date: "PostingDate" },
    storages: { label: "Magazzini", table: "MA_Storages", keys: ["Storage"] },
};
type Relation = { id: string; label: string; target: string; map: Record<string, string> };
const relations: Record<string, Relation[]> = {
    customers: [{ id: "orders", label: "Ordini del cliente", target: "orders", map: { CustSupp: "Customer", CustSuppType: "CustSuppType" } }, { id: "offers", label: "Offerte del cliente", target: "offers", map: { CustSupp: "Customer", CustSuppType: "CustSuppType" } }],
    suppliers: [{ id: "contracts", label: "Contratti del fornitore", target: "contracts", map: { CustSupp: "Supplier" } }, { id: "purchases", label: "Ordini al fornitore", target: "purchaseOrders", map: { CustSupp: "Supplier" } }],
    articles: [
        { id: "goods", label: "Dati fisici e pesi", target: "goods", map: { Item: "Item" } },
        { id: "stock", label: "Giacenze per magazzino", target: "stock", map: { Item: "Item" } },
        { id: "sales", label: "Voci ordini clienti", target: "saleLines", map: { Item: "Item" } },
        { id: "purchases", label: "Voci ordini fornitori", target: "purchaseLines", map: { Item: "Item" } },
        { id: "contracts", label: "Voci contratti", target: "contractLines", map: { Item: "Item" } },
        { id: "production", label: "Registrazioni di produzione", target: "productionEntries", map: { Item: "Item" } },
        { id: "components", label: "Impieghi nei componenti di produzione", target: "productionComponents", map: { Item: "Component" } },
    ],
    contracts: [{ id: "lines", label: "Voci del contratto", target: "contractLines", map: { SuppQuotaId: "SuppQuotaId" } }, { id: "orders", label: "Ordini legati al contratto", target: "purchaseLines", map: { SuppQuotaId: "SuppQuotaId" } }],
    orders: [{ id: "lines", label: "Tutte le voci dell’ordine", target: "saleLines", map: { SaleOrdId: "SaleOrdId" } }],
    purchaseOrders: [{ id: "lines", label: "Tutte le voci dell’ordine fornitore", target: "purchaseLines", map: { PurchaseOrdId: "PurchaseOrdId" } }],
    offers: [{ id: "lines", label: "Tutte le voci dell’offerta", target: "offerLines", map: { CustQuotaId: "CustQuotaId" } }],
    production: [{ id: "steps", label: "Fasi e quantità prodotte", target: "productionSteps", map: { MOId: "MOId" } }, { id: "components", label: "Componenti, fabbisogni e prelievi", target: "productionComponents", map: { MOId: "MOId" } }, { id: "entries", label: "Registrazioni di produzione", target: "productionEntries", map: { MOId: "MOId" } }],
    stock: [{ id: "purchases", label: "Voci ordini fornitori", target: "purchaseLines", map: { Item: "Item" } }, { id: "production", label: "Produzione per articolo e magazzino", target: "productionEntries", map: { Item: "Item", Storage: "Storage", SpecificatorType: "SpecificatorType", Specificator: "Specificator" } }],
};
const labels: Record<string, string> = {
    CustSupp: "Codice", CompanyName: "Ragione sociale", CustSuppType: "Tipo anagrafica", Address: "Indirizzo", ZIPCode: "CAP", City: "Città", County: "Provincia", Country: "Paese", Telephone1: "Telefono", EMail: "Email", TaxIdNumber: "Partita IVA", FiscalCode: "Codice fiscale", Disabled: "Disattivato",
    Item: "Articolo", Description: "Descrizione", BaseUoM: "U.M. base", NetWeight: "Peso netto", GrossWeight: "Peso lordo", Supplier: "Fornitore", Customer: "Cliente", InternalOrdNo: "Numero ordine", OrderDate: "Data ordine", ExpectedDeliveryDate: "Consegna prevista", QuotationNo: "Contratto", QuotationDate: "Data contratto", SupplierDocNo: "Documento fornitore", ClosedOrder: "Chiuso", ValidityEndingDate: "Scadenza", Currency: "Valuta", Notes: "Note", Line: "Riga", SubId: "Sottoriga", UoM: "U.M.", Qty: "Quantità", UnitValue: "Prezzo unitario", NetPrice: "Prezzo netto", TaxableAmount: "Imponibile", DeliveredQty: "Consegnata / ricevuta", Delivered: "Consegnato", Cancelled: "Annullato",
    Storage: "Magazzino", DefaultLocation: "Ubicazione", Specificator: "Specificatore", SpecificatorType: "Tipo specificatore", FiscalYear: "Esercizio", FiscalPeriod: "Periodo", InitialQty: "Saldo iniziale", ReceivedQty: "Ricevuta", IssuedQty: "Uscita", ReservedSaleOrd: "Impegnata clienti", ReservedByProd: "Impegnata produzione", OrderedPurchOrd: "Ordinata fornitori", OrderedToProd: "Ordinata produzione", PickedQty: "Prelevata", AllocatedQty: "Allocata", MinimumStock: "Scorta minima", MaximumStock: "Scorta massima", _Quantity: "Giacenza", _Available: "Disponibile", ProducedQty: "Prodotta",
    MONo: "Ordine produzione", MOId: "ID ordine produzione", BOM: "Distinta", Variant: "Variante", Simulation: "Simulazione", ProductionQty: "Prevista in produzione", MOStatus: "Stato produzione", CreationDate: "Creazione", StartingDate: "Inizio produzione", EndingDate: "Fine produzione", DeliveryDate: "Consegna", PostingDate: "Data registrazione", RtgStep: "Fase", Component: "Componente", NeededQty: "Fabbisogno", PickedQuantity: "Prelevata", WasteQuantity: "Scarto", ScrapQuantity: "Scarto", IssuedQuantity: "Scaricata", PostedToInventory: "Registrata a magazzino", ProcessingType: "Tipo lavorazione", ItemType: "Tipo articolo", WC: "Centro di lavoro",
};
type Column = { key: string; label: string; kind: string; type: string; ordinal: number; primary: number };
type Schema = Map<string, Column[]> & { extras: Map<string, Definition>; related: Map<string, Relation[]> };
const caches = new WeakMap<object, { at: number; promise: Promise<Schema> }>();
const quote = (value: string) => "[" + value.replace(/]/g, "]]") + "]";
const numeric = /^(?:tinyint|smallint|int|bigint|decimal|numeric|money|smallmoney|float|real)$/;
export function validateExplorerRequest(value: any) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["dataset", "search", "where", "special", "from", "to", "year", "period", "sort", "offset", "limit"].includes(key)) || (!Object.prototype.hasOwnProperty.call(EXPLORER_DATASETS, value.dataset) && !(typeof value.dataset === "string" && /^related-\d+$/.test(value.dataset)))) throw Error("Blocco del gestionale non valido.");
    const clean: any = { dataset: value.dataset, search: String(value.search || "").trim(), where: value.where || {}, special: validateStoredSpecialFilters(value.special), sort: value.sort || [], offset: value.offset ?? 0, limit: value.limit ?? 250 };
    if (value.search !== undefined && typeof value.search !== "string") throw Error("Testo di ricerca non valido.");
    if (clean.search.length > 256 || !Number.isInteger(clean.offset) || clean.offset < 0 || clean.offset > 10000000 || !Number.isInteger(clean.limit) || clean.limit < 1 || clean.limit > 1000) throw Error("Ricerca o limite non valido.");
    if (!clean.where || typeof clean.where !== "object" || Array.isArray(clean.where) || Object.keys(clean.where).length > 12 || Object.entries(clean.where).some(([key, item]) => !/^[\w]{1,128}$/.test(key) || !["string", "number", "boolean"].includes(typeof item) || String(item).length > 256)) throw Error("Contesto di ricerca non valido.");
    if (!Array.isArray(clean.sort) || clean.sort.length > 8 || clean.sort.some((s: any) => !s || typeof s.key !== "string" || !["asc", "desc"].includes(s.direction))) throw Error("Ordinamento non valido.");
    for (const key of ["from", "to"]) if (value[key]) { if (typeof value[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value[key]) || new Date(value[key]).toISOString().slice(0, 10) !== value[key]) throw Error("Data non valida."); clean[key] = value[key]; }
    if (clean.from && clean.to && clean.from > clean.to) throw Error("Intervallo date invertito.");
    for (const key of ["year", "period"]) if (value[key] !== undefined && value[key] !== "") { if (!Number.isInteger(value[key]) || value[key] < (key === "year" ? 1900 : 1) || value[key] > (key === "year" ? 9999 : 99)) throw Error("Esercizio o periodo non valido."); clean[key] = value[key]; }
    return clean;
}
async function schema(connection: any): Promise<Schema> {
    const cached = caches.get(connection);
    if (cached && Date.now() - cached.at < 300000) return cached.promise;
    const promise = (async () => {
        const tables = [...new Set(Object.values(EXPLORER_DATASETS).map(d => d.table))];
        const result = await connection.request().query(`SELECT t.name AS tableName,c.name AS columnName,ty.name AS typeName,c.column_id AS ordinal,
 COALESCE((SELECT MAX(ic.key_ordinal) FROM sys.index_columns ic JOIN sys.indexes ix ON ix.object_id=ic.object_id AND ix.index_id=ic.index_id WHERE ic.object_id=c.object_id AND ic.column_id=c.column_id AND ix.is_primary_key=1),0) AS primaryOrdinal
 FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.columns c ON c.object_id=t.object_id JOIN sys.types ty ON ty.user_type_id=c.system_type_id AND ty.system_type_id=ty.user_type_id
 WHERE s.name='dbo' AND (t.name IN (${tables.map(name => "'" + name + "'").join(",")}) OR t.name LIKE 'MA[_]CustSupp%' OR t.name LIKE 'MA[_]Items%') ORDER BY t.name,c.column_id;
 SELECT fk.object_id AS relationId,child.name AS childTable,parent.name AS parentTable,cc.name AS childColumn,pc.name AS parentColumn,fkc.constraint_column_id AS keyOrdinal
 FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
 JOIN sys.tables child ON child.object_id=fk.parent_object_id JOIN sys.schemas cs ON cs.schema_id=child.schema_id
 JOIN sys.tables parent ON parent.object_id=fk.referenced_object_id JOIN sys.schemas ps ON ps.schema_id=parent.schema_id
 JOIN sys.columns cc ON cc.object_id=child.object_id AND cc.column_id=fkc.parent_column_id
 JOIN sys.columns pc ON pc.object_id=parent.object_id AND pc.column_id=fkc.referenced_column_id
 WHERE cs.name='dbo' AND ps.name='dbo' AND parent.name IN ('MA_CustSupp','MA_Items') AND child.object_id<>parent.object_id
 AND (child.name LIKE 'MA[_]CustSupp%' OR child.name LIKE 'MA[_]Items%') ORDER BY fk.object_id,fkc.constraint_column_id;`);
        const catalog: Schema = Object.assign(new Map<string, Column[]>(), { extras: new Map<string, Definition>(), related: new Map<string, Relation[]>() });
        for (const row of result.recordset) {
            if ((!tables.includes(row.tableName) && !/^MA_(?:CustSupp|Items)[A-Za-z0-9_]+$/.test(row.tableName)) || typeof row.columnName !== "string") continue;
            if (!["char", "varchar", "text", "nchar", "nvarchar", "ntext", "uniqueidentifier", "bit", "date", "datetime", "datetime2", "smalldatetime", "datetimeoffset", "time"].includes(row.typeName) && !numeric.test(row.typeName)) continue;
            const field: Column = { key: row.columnName, label: labels[row.columnName] || row.columnName, kind: numeric.test(row.typeName) ? "number" : row.typeName === "bit" ? "boolean" : /date/.test(row.typeName) ? "date" : "text", type: row.typeName, ordinal: row.ordinal, primary: row.primaryOrdinal };
            catalog.set(row.tableName, [...(catalog.get(row.tableName) || []), field]);
        }
        const groups = new Map<number, any[]>();
        for (const row of result.recordsets?.[1] || []) if (Number.isInteger(row.relationId) && row.relationId > 0) groups.set(row.relationId, [...(groups.get(row.relationId) || []), row]);
        for (const [id, keys] of groups) {
            const first = keys[0], child = catalog.get(first.childTable), parent = catalog.get(first.parentTable);
            if (!child?.length || !parent?.length || keys.some(k => k.childTable !== first.childTable || k.parentTable !== first.parentTable || !child.some(c => c.key === k.childColumn) || !parent.some(c => c.key === k.parentColumn))) continue;
            const target = "related-" + id, map = Object.fromEntries(keys.map(k => [k.parentColumn, k.childColumn]));
            const suffix = String(first.childTable).replace(/^MA_(?:CustSupp|Items)/, "");
            const label = ({ Branches: "Indirizzi e sedi", Contacts: "Contatti", Banks: "Coordinate bancarie", GoodsData: "Dati fisici e pesi", CustomerOptions: "Dati commerciali cliente", SupplierOptions: "Dati commerciali fornitore" })[suffix] || "Dati aggiuntivi · " + suffix;
            catalog.extras.set(target, { table: first.childTable, label, keys: child.filter(c => c.primary > 0).map(c => c.key) });
            for (const dataset of first.parentTable === "MA_CustSupp" ? ["customers", "suppliers"] : first.parentTable === "MA_Items" ? ["articles"] : []) {
                if ((relations[dataset] || []).some(r => EXPLORER_DATASETS[r.target].table === first.childTable && JSON.stringify(r.map) === JSON.stringify(map))) continue;
                catalog.related.set(dataset, [...(catalog.related.get(dataset) || []), { id: target, label, target, map }]);
            }
        }
        return catalog;
    })();
    caches.set(connection, { at: Date.now(), promise });
    try { return await promise; } catch (error) { caches.delete(connection); throw error; }
}
export async function readErpExplorer(connection: any, driver: any, value: unknown) {
    const input = validateExplorerRequest(value), catalog = await schema(connection), def = EXPLORER_DATASETS[input.dataset] || catalog.extras.get(input.dataset);
    if (!def) throw Error("Relazione non disponibile nel gestionale collegato.");
    let columns = catalog.get(def.table);
    if (!columns?.length) throw Error("Questa tabella non è disponibile nel gestionale collegato.");
    columns = [...columns];
    const originalKeys = new Set(columns.map(c => c.key));
    const expressions = new Map(columns.map(c => [c.key, c.type === "time" ? `CONVERT(varchar(30),q.${quote(c.key)},126)` : ["text", "ntext", "uniqueidentifier"].includes(c.type) ? `CONVERT(nvarchar(max),q.${quote(c.key)})` : `q.${quote(c.key)}`]));
    let joins = "";
    const textColumn = (key: string, label: string, expression: string) => {
        expressions.set(key, expression);
        columns.push({ key, label, kind: "text", type: "nvarchar", ordinal: 999, primary: 0 });
    };
    // Resolve human document numbers on detail rows; technical IDs remain for exact links.
    const parent = ({ saleLines: ["MA_SaleOrd", "SaleOrdId", "InternalOrdNo"], purchaseLines: ["MA_PurchaseOrd", "PurchaseOrdId", "InternalOrdNo"], contractLines: ["MA_SuppQuotas", "SuppQuotaId", "QuotationNo"], offerLines: ["MA_CustQuotas", "CustQuotaId", "QuotationNo"], productionEntries: ["MA_MO", "MOId", "MONo"], productionComponents: ["MA_MO", "MOId", "MONo"] } as Record<string, string[]>)[input.dataset];
    if (parent && originalKeys.has(parent[1]) && [parent[1], parent[2]].every(key => catalog.get(parent[0])?.some(c => c.key === key))) {
        joins += ` LEFT JOIN dbo.${quote(parent[0])} header ON header.${quote(parent[1])}=q.${quote(parent[1])}`;
        textColumn("_DocumentNo", "Documento", `header.${quote(parent[2])}`);
    }
    const role = ["orders", "offers"].includes(input.dataset) ? { field: "Customer", type: 3211264 }
        : ["purchaseOrders", "contracts"].includes(input.dataset) ? { field: "Supplier", type: 3211265 } : null;
    if (role && originalKeys.has(role.field) && ["CustSupp", "CustSuppType", "CompanyName"].every(key => catalog.get("MA_CustSupp")?.some(c => c.key === key))) {
        joins += ` LEFT JOIN dbo.MA_CustSupp party ON party.CustSupp=q.${quote(role.field)} AND party.CustSuppType=${role.type}${role.field === "Customer" && originalKeys.has("UseContact") ? " AND COALESCE(q.UseContact,0)=0" : ""}`;
        textColumn("_PartyName", "Ragione sociale", "party.CompanyName");
    }
    if (input.dataset === "stock") {
        const items = new Set((catalog.get("MA_Items") || []).map(c => c.key));
        if (items.has("Item")) {
            joins += " LEFT JOIN dbo.MA_Items item ON item.Item=q.Item";
            for (const [key, source, label] of [["_Unit", "BaseUoM", "U.M."], ["_Description", "Description", "Descrizione articolo"]]) if (items.has(source)) {
                expressions.set(key, "item." + quote(source));
                columns.push({ key, label, kind: "text", type: "nvarchar", ordinal: 999, primary: 0 });
            }
        }
        const storages = new Set((catalog.get("MA_Storages") || []).map(c => c.key));
        if (storages.has("Storage") && storages.has("Description")) {
            joins += " LEFT JOIN dbo.MA_Storages storage ON storage.Storage=q.Storage";
            expressions.set("_StorageDescription", "storage.Description");
            columns.push({ key: "_StorageDescription", label: "Descrizione magazzino", kind: "text", type: "nvarchar", ordinal: 999, primary: 0 });
        }
    }
    if (input.dataset === "stock" && ["InitialQty", "ReceivedQty", "IssuedQty"].every(k => originalKeys.has(k))) {
        expressions.set("_Quantity", "(q.InitialQty+q.ReceivedQty-q.IssuedQty)");
        if (["ReservedSaleOrd", "ReservedByProd"].every(k => originalKeys.has(k))) expressions.set("_Available", "(q.InitialQty+q.ReceivedQty-q.IssuedQty-q.ReservedSaleOrd-q.ReservedByProd)");
        const types = columns.filter(c => ["InitialQty", "ReceivedQty", "IssuedQty", "ReservedSaleOrd", "ReservedByProd"].includes(c.key)).map(c => c.type);
        const quantityType = types.some(type => ["float", "real"].includes(type)) ? "float" : types.every(type => ["money", "smallmoney"].includes(type)) ? "money" : "decimal";
        for (const key of ["_Quantity", "_Available"].filter(k => expressions.has(k))) columns.push({ key, label: labels[key], kind: "number", type: quantityType, ordinal: 999, primary: 0 });
    }
    const fields = new Map(columns.map(c => [c.key, c]));
    const request = connection.request(); let index = 0;
    const bind = (item: unknown, kind: "text" | "number" | "date" | "int") => { const name = "p" + index++; request.input(name, kind === "number" ? driver.Float : kind === "int" ? driver.Int : kind === "date" ? driver.Date : driver.NVarChar(1024), kind === "date" ? new Date(String(item) + "T00:00:00Z") : item); return "@" + name; };
    const conditions: string[] = [];
    if (def.party) conditions.push(`q.CustSuppType=${bind(def.party, "int")}`);
    if (input.dataset === "contracts") conditions.push("q.QuotationNo LIKE '%/C'");
    for (const [key, item] of Object.entries(input.where)) {
        const field = fields.get(key); if (!field || !originalKeys.has(key)) throw Error("Campo di contesto non disponibile.");
        const asNumber = field.kind === "number" || field.kind === "boolean";
        if (asNumber && !Number.isFinite(Number(item))) throw Error("Identificativo numerico non valido.");
        const exactString = asNumber && typeof item === "string";
        conditions.push(`${expressions.get(key)}=${bind(asNumber && !exactString ? Number(item) : item, asNumber && !exactString ? "number" : "text")}`);
    }
    if (input.search) {
        const pattern = "%" + input.search.replace(/[\[\]%_\\]/g, "\\$&") + "%";
        const param = bind(pattern, "text");
        const searchable = columns.filter(c => c.kind === "text").map(c => `${expressions.get(c.key)} LIKE ${param} ESCAPE '\\'`);
        conditions.push(searchable.length ? "(" + searchable.join(" OR ") + ")" : "1=0");
    }
    if (def.date && fields.has(def.date)) {
        if (input.from) conditions.push(`q.${quote(def.date)}>=${bind(input.from, "date")}`);
        if (input.to) conditions.push(`q.${quote(def.date)}<DATEADD(day,1,${bind(input.to, "date")})`);
    }
    let declaration = "";
    if (input.dataset === "stock") {
        const year = input.year ? bind(input.year, "int") : "NULL", period = input.period ? bind(input.period, "int") : "NULL";
        declaration = `DECLARE @selectedYear int=COALESCE(${year},(SELECT MAX(FiscalYear) FROM dbo.MA_ItemsStorageQty WHERE FiscalYear<=YEAR(GETDATE()))); DECLARE @selectedPeriod int=COALESCE(${period},(SELECT MAX(FiscalPeriod) FROM dbo.MA_ItemsStorageQty WHERE FiscalYear=@selectedYear));`;
        conditions.push("q.FiscalYear=@selectedYear", "q.FiscalPeriod=@selectedPeriod");
    }
    // Compile on column aliases in the CTE so virtual quantities are filterable too.
    const predicates = specialFilterSql(input.special, columns, bind, true);
    const keys = columns.filter(c => c.primary > 0).sort((a, b) => a.primary - b.primary).map(c => c.key);
    const stable = keys.length ? keys : def.keys.filter(k => fields.has(k));
    if (!stable.length) stable.push(columns[0].key);
    for (const s of input.sort) if (!fields.has(s.key)) throw Error("Colonna di ordinamento non disponibile.");
    const sort = [...input.sort, ...stable.filter(key => !input.sort.some((s: any) => s.key === key)).map(key => ({ key, direction: "asc" }))];
    const select = columns.map(c => `${expressions.get(c.key)} AS ${quote(c.key)}`).join(",");
    // Preserve exact decimal/bigint text over JSON. Sort and filter the original
    // SQL numeric columns, before converting values for transport.
    const output = columns.map(c => ["bigint", "decimal", "numeric", "money", "smallmoney"].includes(c.type) ? `CONVERT(varchar(100),Data.${quote(c.key)}${["money", "smallmoney"].includes(c.type) ? ",2" : ""}) AS ${quote(c.key)}` : `Data.${quote(c.key)}`).join(",");
    const sql = `${declaration} WITH Data AS (SELECT ${select} FROM dbo.${quote(def.table)} q${joins} WHERE ${conditions.join(" AND ") || "1=1"}) SELECT ${output},COUNT_BIG(*) OVER() AS __total FROM Data WHERE ${predicates.join(" AND ") || "1=1"} ORDER BY ${sort.map(s => "Data." + quote(s.key) + " " + s.direction.toUpperCase()).join(",")} OFFSET ${bind(input.offset, "int")} ROWS FETCH NEXT ${bind(input.limit, "int")} ROWS ONLY;${input.dataset === "stock" ? "SELECT @selectedYear AS year,@selectedPeriod AS period;" : ""}`;
    const result = await request.query(sql);
    const rows = result.recordset.map((row: any) => Object.fromEntries(columns.map(c => [c.key, row[c.key] instanceof Date ? row[c.key].toISOString() : row[c.key] ?? null])));
    const children = [...(relations[input.dataset] || []), ...(catalog.related.get(input.dataset) || [])].filter(r => { const definition = EXPLORER_DATASETS[r.target] || catalog.extras.get(r.target); const targetKeys = new Set((catalog.get(definition.table) || []).map(c => c.key)); return Object.entries(r.map).every(([from, to]) => originalKeys.has(from) && targetKeys.has(to)); });
    return { dataset: input.dataset, label: def.label, columns, keys: stable, rows, total: Number(result.recordset[0]?.__total || 0), offset: input.offset, relations: children, queriedAt: new Date().toISOString(), ...(input.dataset === "stock" ? { period: result.recordsets?.[1]?.[0] } : {}) };
}
