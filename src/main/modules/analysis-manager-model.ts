import { normalizeStock } from "./stock-analysis/model";
import { romeDay } from "./analysis-overview-model";
export function managerFilters(input: any) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["from", "to", "asOf"].includes(key))) throw Error("Periodo Manager non valido.");
    const asOf = input.asOf ?? romeDay();
    if (typeof asOf !== "string") throw Error("Data Manager non valida.");
    const from = input.from ?? `${Number(asOf.slice(0, 4)) - 2}-01-01`, to = input.to ?? asOf;
    for (const value of [asOf, from, to]) if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw Error("Data Manager non valida.");
    if (from > to || Number(to.slice(0, 4)) - Number(from.slice(0, 4)) > 10) throw Error("Intervallo Manager non valido (massimo dieci anni).");
    return { from, to, asOf };
}
export function managerStock(rows: any[]) {
    const groups = new Map<string, any>();
    for (const row of normalizeStock(rows)) {
        const unit = row.unit || "U.M. non indicata", key = JSON.stringify([unit, row.ownership]);
        if (!groups.has(key)) groups.set(key, { unit, ownership: row.ownership, positions: 0, quantity: 0, negativePositions: 0, missingQuantities: 0 });
        const group = groups.get(key)!; group.positions++;
        if (row.quantity === null) group.missingQuantities++; else { group.quantity += row.quantity; if (row.quantity < 0) group.negativePositions++; }
    }
    return [...groups.values()].map(group => ({ ...group, quantity: group.missingQuantities === group.positions ? null : group.quantity })).sort((a, b) => a.unit.localeCompare(b.unit, "it") || a.ownership.localeCompare(b.ownership, "it"));
}
export const MANAGER_TABLES = [
    { key: "monthly", title: "Ordinato acquisito per mese e valuta", columns: [["month", "Mese"], ["currency", "Valuta"], ["orders", "Ordini"], ["amount", "Imponibile ordinato"], ["missingAmounts", "Importi mancanti"]] },
    { key: "customers", title: "Primi 15 clienti per valuta nel periodo", columns: [["customerCode", "Codice cliente"], ["customerName", "Cliente"], ["currency", "Valuta"], ["orders", "Ordini"], ["amount", "Imponibile ordinato"], ["missingAmounts", "Importi mancanti"]] },
    { key: "backlogValues", title: "Portafoglio aperto per valuta", columns: [["currency", "Valuta"], ["rows", "Righe aperte"], ["estimatedAmount", "Valore residuo stimato"], ["missingAmounts", "Importi mancanti"]] },
    { key: "backlogUnits", title: "Domanda residua per unità", columns: [["unit", "U.M."], ["quantity", "Da consegnare"], ["lateQuantity", "Di cui in ritardo"]] },
    { key: "purchases", title: "Acquisti da ricevere per valuta", columns: [["currency", "Valuta"], ["orders", "Ordini"], ["rows", "Righe"], ["estimatedAmount", "Valore residuo stimato"], ["missingAmounts", "Importi mancanti"]] },
    { key: "production", title: "Ordini di produzione creati nel periodo", columns: [["unit", "U.M."], ["orders", "Ordini senza simulazione"], ["plannedQuantity", "Quantità pianificata"], ["missingQuantities", "Quantità mancanti"]] },
    { key: "stock", title: "Saldi di magazzino per unità e proprietà", columns: [["unit", "U.M."], ["ownership", "Proprietà"], ["positions", "Posizioni"], ["quantity", "Saldo noto"], ["negativePositions", "Posizioni negative"], ["missingQuantities", "Saldi incompleti"]] },
];
export const MANAGER_INFORMATION = "Ordinato acquisito: imponibili delle righe non annullate, datate nel periodo selezionato; non è fatturato né incassato. Portafoglio e acquisti: tutti gli anni, righe non evase/non annullate con residuo positivo; valore residuo stimato pro quota dell'imponibile originale, senza trasformarlo in ricavo o costo effettivo. Ritardi: consegna precedente al giorno di riferimento di Roma. Produzione: ordini privi di codice simulazione creati nel periodo e quantità pianificata, senza dedurre avanzamento o stato dalle fasi. Magazzino: ultimo esercizio/periodo disponibile, saldi distinti per unità e proprietà. I totali noti con dati mancanti sono parziali. Nessuna conversione valutaria, valorizzazione delle scorte o margine industriale implicito.";
