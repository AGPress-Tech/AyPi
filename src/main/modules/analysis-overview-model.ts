import type { AnalysisTarget } from "./analysis-navigation-model";
import type { SortCriterion } from "./analysis-sorting";
import { SpecialFilter, validateSpecialFilters } from "./analysis-special-filters";

export type OverviewCheck = "late-orders" | "open-orders" | "undated-orders" | "negative-stock" | "reserved-stock" | "customer-prices" | "current-prices" | "customer-commitments";
export function overviewAssistantPrompt(input?: unknown) {
    const message = "Non sai da dove iniziare? Facciamo delle analisi!";
    if (input === undefined) return { title: "Assistente AGPress", message, detail: "Apriamo il quadro delle analisi gestionali." };
    const value = input as any;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["assistant", "name"].includes(key)) || !["arona", "plana"].includes(value.assistant) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 32 || /[\u0000-\u001f\u007f]/.test(value.name)) throw Error("Assistente non valido.");
    const name = value.name.trim();
    return value.assistant === "arona"
        ? { title: "Arona", message, detail: `${name}, diamo un’occhiata insieme! Ti aiuto a trovare un punto di partenza.` }
        : { title: "Plana", message, detail: `${name}, possiamo esaminare i dati insieme. Ti aiuto a fare ordine.` };
}
export type OverviewColumn = { key: string; label: string; kind: "text" | "number" | "date" };
const orderColumns: OverviewColumn[] = [
    { key: "customerName", label: "Cliente", kind: "text" },
    { key: "orderNo", label: "Ordine", kind: "text" },
    { key: "article", label: "Articolo", kind: "text" },
    { key: "description", label: "Descrizione", kind: "text" },
    { key: "deliveryDate", label: "Consegna prevista", kind: "date" },
    { key: "residual", label: "Da consegnare", kind: "number" },
    { key: "unit", label: "U.M.", kind: "text" },
];
export const OVERVIEW_CHECKS: Record<OverviewCheck, { label: string; target: AnalysisTarget; description: string; columns: OverviewColumn[] }> = {
    "reserved-stock": { label: "Impegni clienti nei saldi ERP", target: "customer-commitments", description: "Posizioni dell'ultimo periodo con quantità impegnata clienti positiva; da confrontare con la domanda documentale, senza sommare le due fonti.", columns: [
        { key: "article", label: "Articolo", kind: "text" }, { key: "description", label: "Descrizione", kind: "text" }, { key: "storage", label: "Magazzino", kind: "text" },
        { key: "ownership", label: "Proprietà", kind: "text" }, { key: "subjectName", label: "Soggetto del saldo", kind: "text" },
        { key: "reservedSales", label: "Impegnata clienti ERP", kind: "number" }, { key: "unit", label: "U.M.", kind: "text" },
    ] },
    "customer-prices": { label: "Tutti i prezzi e lo storico", target: "customer-prices", description: "Listini nominativi e prezzi specifici cliente/articolo; validità, scaglioni e sconti restano distinti.", columns: [
        { key: "source", label: "Origine prezzo", kind: "text" }, { key: "priceList", label: "Listino", kind: "text" }, { key: "priceListName", label: "Nome listino", kind: "text" },
        { key: "customerCode", label: "Codice cliente", kind: "text" }, { key: "customerName", label: "Cliente collegato", kind: "text" },
        { key: "article", label: "Articolo", kind: "text" }, { key: "description", label: "Descrizione", kind: "text" },
        { key: "minimumQuantity", label: "Scaglione quantità", kind: "number" }, { key: "unit", label: "U.M.", kind: "text" }, { key: "price", label: "Prezzo di listino", kind: "number" }, { key: "currency", label: "Valuta", kind: "text" },
        { key: "validFrom", label: "Valido dal", kind: "date" }, { key: "validTo", label: "Valido al", kind: "date" }, { key: "status", label: "Validità", kind: "text" },
        { key: "discount1", label: "Sconto 1 (%)", kind: "number" }, { key: "discount2", label: "Sconto 2 (%)", kind: "number" }, { key: "discountFormula", label: "Formula sconto", kind: "text" }, { key: "taxIncluded", label: "IVA nel prezzo", kind: "text" }, { key: "notes", label: "Note", kind: "text" },
    ] },
    "current-prices": { label: "Prezzi in validità oggi", target: "customer-prices", description: "Solo prezzi non disattivati entro l'intervallo di validità del listino e della riga.", columns: [] },
    "customer-commitments": { label: "Domanda clienti da soddisfare", target: "customer-commitments", description: "Righe di ordini clienti non annullate e non evase con residuo positivo, indipendentemente dall'anno.", columns: [
        ...orderColumns.slice(0, 4), { key: "line", label: "Riga", kind: "number" },
        { key: "orderDate", label: "Data ordine", kind: "date" }, { key: "deliveryDate", label: "Consegna prevista", kind: "date" },
        { key: "quantity", label: "Ordinata", kind: "number" }, { key: "deliveredQuantity", label: "Consegnata", kind: "number" }, { key: "residual", label: "Richiesta residua", kind: "number" }, { key: "unit", label: "U.M.", kind: "text" },
        { key: "allocated", label: "Allocata ERP", kind: "number" }, { key: "picked", label: "Prelevata ERP", kind: "number" }, { key: "storage", label: "Magazzino", kind: "text" },
    ] },
    "late-orders": { label: "Consegne in ritardo", target: "article-orders", description: "Righe clienti ancora da consegnare, con data prevista precedente a oggi.", columns: orderColumns },
    "open-orders": { label: "Tutte le righe aperte", target: "article-orders", description: "Il residuo da consegnare, anche per ordini di anni precedenti e senza data prevista.", columns: orderColumns },
    "undated-orders": { label: "Consegne senza data", target: "article-orders", description: "Righe aperte per cui manca la data di consegna prevista.", columns: orderColumns },
    "negative-stock": {
        label: "Posizioni con saldo negativo", target: "stock-analysis",
        description: "Le posizioni di magazzino negative nell’ultimo esercizio e periodo disponibili.",
        columns: [
            { key: "article", label: "Articolo", kind: "text" }, { key: "description", label: "Descrizione", kind: "text" },
            { key: "storage", label: "Magazzino", kind: "text" }, { key: "ownership", label: "Proprietà", kind: "text" },
            { key: "subjectName", label: "Soggetto", kind: "text" }, { key: "quantity", label: "Saldo", kind: "number" }, { key: "unit", label: "U.M.", kind: "text" },
        ],
    },
};
OVERVIEW_CHECKS["current-prices"].columns = OVERVIEW_CHECKS["customer-prices"].columns;
const pricePriority = ["customerName", "customerCode", "article", "description", "price", "currency", "unit", "minimumQuantity", "validFrom", "validTo", "status", "priceList", "priceListName", "source", "discount1", "discount2", "discountFormula", "taxIncluded", "notes"];
OVERVIEW_CHECKS["customer-prices"].columns.sort((a, b) => pricePriority.indexOf(a.key) - pricePriority.indexOf(b.key));
export type OverviewArea = {
    id: string; label: string; question: string; description: string; checks: OverviewCheck[];
    links: { target: AnalysisTarget; label: string }[];
    next: string; needed: string; benefit: string;
};
export const OVERVIEW_AREAS: OverviewArea[] = [
    { id: "prices", label: "Listino clienti", question: "Quali prezzi abbiamo concordato?", description: "Consulta prezzi, scaglioni e validità dei listini senza confonderli con i prezzi effettivi degli ordini.", checks: ["customer-prices", "current-prices"], links: [{ target: "customer-prices", label: "Apri Listino clienti" }, { target: "customer-analysis", label: "Analisi cliente" }], next: "Confronto tra listino e ordini", needed: "Verificare la regola applicata per cliente, data, scaglione, unità, IVA, valuta e sconti prima di segnalare differenze di prezzo.", benefit: "Disporre del riferimento commerciale quando si esamina un ordine." },
    { id: "deliveries", label: "Consegne", question: "Quali consegne richiedono attenzione?", description: "Parti dal residuo aperto e arriva alle voci dell’ordine, al cliente e al materiale.", checks: ["late-orders", "open-orders", "undated-orders"], links: [{ target: "article-orders", label: "Venduto per articolo" }, { target: "customer-analysis", label: "Analisi cliente" }], next: "Ordini a rischio e priorità di consegna", needed: "Collegare ordini clienti, copertura materiale e avanzamento produttivo; verificare date promesse e legami tra documenti.", benefit: "Individuare gli ordini da controllare prima di comunicare una data al cliente." },
    { id: "materials", label: "Materiali", question: "Dove dobbiamo verificare il materiale?", description: "Distingui il saldo di magazzino dagli impegni e consulta tutte le posizioni dell’articolo.", checks: ["negative-stock", "customer-commitments", "reserved-stock"], links: [{ target: "stock-analysis", label: "Giacenze" }, { target: "customer-commitments", label: "Impegni clienti" }, { target: "bom-analysis", label: "Distinte e componenti" }], next: "Copertura dei fabbisogni", needed: "Incrociare impegni, giacenze, arrivi e componenti delle distinte, mantenendo separate unità, proprietà e date.", benefit: "Capire cosa manca e per quando, senza confondere il saldo con il materiale effettivamente libero." },
    { id: "purchasing", label: "Acquisti", question: "Quali acquisti dobbiamo seguire?", description: "Consulta ordini fornitori, contratti barra e valutazioni del fornitore nei moduli già disponibili.", checks: [], links: [{ target: "erp-explorer", label: "Esplora gestionale" }, { target: "bar-contracts", label: "Contratti barra" }, { target: "supplier-evaluation", label: "Valutazione fornitori" }], next: "Arrivi attesi e solleciti", needed: "Validare residui di acquisto, date confermate, ricevimenti e stati di chiusura per tutti i fornitori, oltre alla barra.", benefit: "Preparare i solleciti sui materiali che servono davvero alle consegne." },
    { id: "production", label: "Produzione", question: "Cosa dobbiamo produrre e cosa lo blocca?", description: "Usa ordini di produzione, cicli, distinte e dati Torneria come punti di partenza.", checks: [], links: [{ target: "erp-explorer", label: "Esplora gestionale" }, { target: "processing-cycles", label: "Cicli di lavorazione" }, { target: "turning-analysis", label: "Analisi Torneria" }], next: "Avanzamento e carichi", needed: "Verificare stati delle fasi, quantità effettivamente prodotte, capacità e calendari macchina. Le quantità delle diverse fasi non vanno sommate come prodotto finito.", benefit: "Distinguere mancanze di materiale, lavorazioni da completare e limiti di capacità." },
    { id: "management", label: "Manager", question: "Manager · Quadro aziendale", description: "Ordinato, portafoglio clienti, acquisti, produzione e magazzino in un unico riepilogo.", checks: [], links: [{ target: "manager", label: "Dashboard Manager" }, { target: "customer-prices", label: "Listino clienti" }, { target: "customer-analysis", label: "Clienti e andamento" }, { target: "article-offers", label: "Offerte e prezzi" }, { target: "turning-analysis", label: "Risultati Torneria" }], next: "Margini e capitale immobilizzato", needed: "Concordare costi attendibili, valorizzazione delle scorte, perimetro di ricavi e costi e criteri di confronto. I prezzi di vendita non sono costi industriali.", benefit: "Confrontare clienti e articoli con basi omogenee e individuare le verifiche economicamente rilevanti." },
    { id: "continuity", label: "Qualità e continuità", question: "Quali criticità possono fermare il lavoro?", description: "Valutazioni DDT dei fornitori, strumenti di misura e manutenzioni: i controlli per la continuità operativa.", checks: [], links: [{ target: "supplier-evaluation", label: "Valutazione DDT fornitori" }, { target: "measurement-instruments", label: "Strumenti di misura e tarature" }, { target: "maintenance", label: "Manutenzioni" }], next: "Scadenze e blocchi collegati alle consegne", needed: "Collegare manutenzioni, tarature, non conformità e disponibilità attrezzature agli articoli e alle lavorazioni interessate, verificando le relazioni.", benefit: "Portare all’attenzione le criticità che possono compromettere il piano di lavoro." },
];

export type OverviewQuery = { check: OverviewCheck; search: string; sort: SortCriterion[]; offset: number; asOf: string; refresh: boolean; article?: string; customerCode?: string; special?: SpecialFilter[]; columns?: string[] };
const areaPriority = ["deliveries", "materials", "prices", "purchasing", "production", "management", "continuity"];
OVERVIEW_AREAS.sort((a, b) => areaPriority.indexOf(a.id) - areaPriority.indexOf(b.id));
export function romeDay(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    return ["year", "month", "day"].map(key => parts.find(part => part.type === key)!.value).join("-");
}
export function overviewQuery(input: any): OverviewQuery {
    if (!input || typeof input !== "object" || Array.isArray(input) || !Object.prototype.hasOwnProperty.call(OVERVIEW_CHECKS, input.check) || Object.keys(input).some(key => !["check", "search", "sort", "offset", "asOf", "refresh", "article", "customerCode", "special", "columns"].includes(key))) throw Error("Controllo operativo non valido.");
    for (const key of ["article", "customerCode"]) if (input[key] !== undefined && (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 128)) throw Error("Contesto non valido.");
    const search = input.search ?? "", offset = input.offset ?? 0, sort = input.sort ?? [];
    if (typeof search !== "string" || search.length > 128 || !Number.isInteger(offset) || offset < 0 || offset > 1000000 || !Array.isArray(sort) || sort.length > 10) throw Error("Parametri del controllo non validi.");
    const keys = new Set(OVERVIEW_CHECKS[input.check as OverviewCheck].columns.map(column => column.key)), seen = new Set<string>();
    for (const item of sort) {
        if (!item || Object.keys(item).some(key => !["key", "direction"].includes(key)) || !keys.has(item.key) || !["asc", "desc"].includes(item.direction) || seen.has(item.key)) throw Error("Ordinamento non valido.");
        seen.add(item.key);
    }
    const asOf = input.asOf ?? romeDay();
    if (typeof asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf || input.refresh !== undefined && typeof input.refresh !== "boolean") throw Error("Data del controllo non valida.");
    const special = validateSpecialFilters(input.special, OVERVIEW_CHECKS[input.check as OverviewCheck].columns);
    if (input.columns !== undefined && (!Array.isArray(input.columns) || !input.columns.length || input.columns.some((key: any) => !keys.has(key)) || new Set(input.columns).size !== input.columns.length)) throw Error("Colonne non valide.");
    return { check: input.check, search: search.trim(), offset, sort, asOf, refresh: input.refresh === true, special, ...(input.columns ? { columns: input.columns } : {}), ...(input.article ? { article: input.article.trim() } : {}), ...(input.customerCode ? { customerCode: input.customerCode.trim() } : {}) };
}
export function overviewOrderFilters(query: OverviewQuery, limit = 250) {
    const conditions: any[] = [{ field: "residual", op: "gt", value: "0" }];
    if (query.customerCode) conditions.push({ field: "customerCode", op: "exact", value: query.customerCode });
    if (query.check === "late-orders") conditions.push({ field: "deliveryDate", op: "lt", value: query.asOf });
    if (query.check === "undated-orders") conditions.push({ field: "deliveryDate", op: "empty", value: "" });
    const special: any[] = [{ name: "Controllo operativo", condition: { join: "all", conditions } }];
    if (query.search) special.push({ name: "Ricerca", condition: { join: "any", conditions: ["article", "description", "orderNo", "customerName", "customerCode"].map(field => ({ field, op: "contains", value: query.search })) } });
    special.push(...(query.special || []));
    return { articles: query.article ? [{ op: "exact", value: query.article }] : [], includeCancelled: false, delivered: "no", special, offset: query.offset, limit, sort: query.sort.length ? query.sort : [{ key: "deliveryDate", direction: "asc" }] };
}
