import * as XLSX from "xlsx";

export const SOURCE_PATH = "\\\\Dl360\\pubbliche\\TECH\\Controlli di Gestione\\ExportMovimenti.xlsx";
export const CLOSING_TYPE = 5177346;
export const CATEGORIES = [
    "Ricavi di Produzione", "Variazione Rimanenze Prodotti Finiti e Materie Prime",
    "Incrementi Immobilizzazioni per Lavori Interni", "Costi Variabili", "Costi Fissi",
    "Ammortamento e Svalutazioni", "Subtotale Ricavi non legati alla Produzione",
    "Subvariazione Rimanenze Prodotti Commercio", "Subtotale Costi non legati alla Produzione",
    "Gestione Finanziaria", "Gestione Straordinaria",
];
export type Point = { year: number; month: number; group: string; value: number };
export type AccountPoint = { year: number; month: number; code: string; value: number };
export type Rule = { group: string; code: string; share: number };
export type Movement = {
    sourceRow: number; rowId: string; code: string; year: number; month: number;
    competenceDate: string; registrationDate: string; description: string;
    typeCode: number; amountType: string; customerSupplier: string;
    debit: number | null; credit: number | null; value: number; journalEntryId?:string;
};
export type MovementIndex = Record<string, Movement[]>;
export type ManagementData = {
    source: string; modifiedAt: string; loadedAt: string; years: number[];
    periods: Record<string, number[]>; categories: string[];
    groups: { name: string; category: string }[]; rules: Rule[];
    points: Point[]; accounts: AccountPoint[]; descriptions: Record<string, string>;
    sourceKind?:"sql"|"excel";queriedAt?:string;parameterSource?:string;
    quality: { total: number; included: number; closing: number; invalidDates: number;
        unmatchedAccounts: number; unmatchedValue: number; overlappingAccounts: number };
};
const label = (v: unknown) => v == null ? "" : String(v).trim();
export function numeric(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        let s = value.trim().replace(/\s/g, "");
        if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
        const n = Number(s);
        if (Number.isFinite(n)) return n;
    }
    throw new Error(`Valore numerico non valido: ${String(value).slice(0, 60)}`);
}
export function percentage(v: unknown) {
    if (v == null || label(v) === "") return 0;
    if (typeof v === "string" && v.trim().endsWith("%")) return numeric(v.trim().slice(0, -1)) / 100;
    const n = numeric(v);
    return Math.abs(n) > 1 ? n / 100 : n;
}
export const matches = (account: string, prefix: string) => prefix.length < 8 ? account.startsWith(prefix) : account === prefix;
function period(v: unknown, date1904: boolean): [number, number] | null {
    if (typeof v === "number") {
        const d = XLSX.SSF.parse_date_code(v, { date1904 });
        return d && d.y >= 1900 && d.y <= 9999 ? [d.y, d.m] : null;
    }
    if (v instanceof Date && Number.isFinite(v.getTime())) return [v.getFullYear(), v.getMonth() + 1];
    const s = label(v);
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(s) || /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (!m) return null;
    const iso = s.includes("-");
    const y = Number(m[iso ? 1 : 3]), mo = Number(m[2]), day = Number(m[iso ? 3 : 1]);
    const d = new Date(Date.UTC(y, mo - 1, day));
    return d.getUTCFullYear() === y && d.getUTCMonth() === mo - 1 && d.getUTCDate() === day ? [y, mo] : null;
}
function dateKey(value: unknown, date1904: boolean) {
    const p = period(value, date1904);
    if (!p) return "";
    const day = typeof value === "number" ? XLSX.SSF.parse_date_code(value, {date1904}).d
        : value instanceof Date ? value.getDate()
        : Number(label(value).includes("-") ? label(value).slice(8,10) : label(value).slice(0,2));
    return `${p[0]}-${String(p[1]).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}
function sheet(workbook: XLSX.WorkBook, name: string, required: string[]) {
    const ws = workbook.Sheets[name];
    if (!ws) throw new Error(`Foglio obbligatorio mancante: ${name}`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
    const headers = (rows.shift() || []).map(label);
    for (const key of required) if (!headers.includes(key)) throw new Error(`Colonna ${key} mancante nel foglio ${name}`);
    return { rows, at: (key: string) => headers.indexOf(key) };
}
export function buildManagementData(workbook: XLSX.WorkBook, source = SOURCE_PATH, modifiedAt = "", onMovement?: (movement: Movement) => void): ManagementData {
    const filters = sheet(workbook, "Filtri", ["Gruppo", "Categoria"]);
    const groups: ManagementData["groups"] = [], mapping = new Map<string, string>();
    for (const row of filters.rows) {
        const name = label(row[filters.at("Gruppo")]), category = label(row[filters.at("Categoria")]);
        if (!name && !category) continue;
        if (!name || !category) throw new Error("Gruppo o categoria vuoti in Filtri");
        if (mapping.has(name)) throw new Error(`Gruppo duplicato in Filtri: ${name}`);
        mapping.set(name, category); groups.push({ name, category });
    }
    const calculations = sheet(workbook, "Calcoli", ["Gruppo", "Codice", "% applicata"]);
    const rules: Rule[] = [];
    for (const row of calculations.rows) {
        const group = label(row[calculations.at("Gruppo")]), code = label(row[calculations.at("Codice")]);
        if (!code) continue;
        if (!mapping.has(group)) throw new Error(`Gruppo di Calcoli assente in Filtri: ${group}`);
        rules.push({ group, code, share: percentage(row[calculations.at("% applicata")]) });
    }
    if (!rules.length || !groups.length) throw new Error("Regole di calcolo o categorie vuote");
    const ledger = sheet(workbook, "Bilancino", ["DataCompetenza", "Codice", "TipoCodice", "Valore"]);
    const sums = new Map<string, AccountPoint>(), descriptions = Object.create(null);
    const byCode = new Map<string, Rule[]>();
    const months = new Map<number, Set<number>>();
    const quality = { total: 0, included: 0, closing: 0, invalidDates: 0, unmatchedAccounts: 0, unmatchedValue: 0, overlappingAccounts: 0 };
    const di = ledger.at("DataCompetenza"), ci = ledger.at("Codice"), ti = ledger.at("TipoCodice"), vi = ledger.at("Valore"), ni = ledger.at("Descrizione");
    const date1904 = !!workbook.Workbook?.WBProps?.date1904;
    const optional = (row: unknown[], name: string) => row[ledger.at(name)] ?? null;
    const optionalNumber = (row: unknown[], name: string) => label(optional(row,name)) ? numeric(optional(row,name)) : null;
    for (const [index,row] of ledger.rows.entries()) {
        if (row.every(v => v == null || v === "")) continue;
        quality.total++;
        if (numeric(row[ti]) === CLOSING_TYPE) { quality.closing++; continue; }
        const date = period(row[di], date1904);
        if (!date) { quality.invalidDates++; continue; }
        const code = label(row[ci]);
        if (!code) throw new Error(`Codice conto mancante alla riga ${quality.total + 1}`);
        const value = numeric(row[vi]), [year, month] = date;
        quality.included++;
        if (!months.has(year)) months.set(year, new Set());
        months.get(year)!.add(month);
        const key = `${year}/${month}/${code}`;
        if (!sums.has(key)) sums.set(key, { year, month, code, value: 0 });
        sums.get(key)!.value += value;
        if (ni >= 0) descriptions[code] = label(row[ni]);
        if (!byCode.has(code)) byCode.set(code, rules.filter(r => matches(code, r.code)));
        if (onMovement && byCode.get(code)!.length) onMovement({
            sourceRow: index+2, rowId: label(optional(row,"Riga")) || String(index+2), code, year, month,
            competenceDate: dateKey(row[di],date1904), registrationDate: dateKey(optional(row,"DataRegistrazione"),date1904),
            description: ni >= 0 ? label(row[ni]) : "", typeCode: numeric(row[ti]),
            amountType: label(optional(row,"TipoImporto")), customerSupplier: label(optional(row,"CodClienteFornitore")),
            debit: optionalNumber(row,"Dare"), credit: optionalNumber(row,"Avere"), value,
            journalEntryId:label(optional(row,"IDRegistrazione")),
        });
    }
    if (!quality.included) throw new Error("Nessun movimento gestionale valido");
    quality.unmatchedAccounts = [...byCode.values()].filter(r => !r.length).length;
    quality.overlappingAccounts = [...byCode.values()].filter(r => r.reduce((s, v) => s + v.share, 0) > 1.000001).length;
    const points = new Map<string, Point>();
    for (const account of sums.values()) {
        const selected = byCode.get(account.code)!;
        if (!selected.length) quality.unmatchedValue += account.value;
        for (const rule of selected) {
            const key = `${account.year}/${account.month}/${rule.group}`;
            if (!points.has(key)) points.set(key, { year: account.year, month: account.month, group: rule.group, value: 0 });
            points.get(key)!.value -= account.value * rule.share;
        }
    }
    return { source, modifiedAt, loadedAt: new Date().toISOString(), years: [...months.keys()].sort((a,b) => a-b),
        periods: Object.fromEntries([...months].map(([year, set]) => [year, [...set].sort((a,b) => a-b)])),
        categories: [...new Set([...CATEGORIES, ...mapping.values()])], groups, rules,
        points: [...points.values()], accounts: [...sums.values()], descriptions, quality };
}

// Le formule seguono calcola_report del notebook Prove.ipynb, inclusi gli ammortamenti nel Margine 2.
export function margins(categories: Record<string, number>) {
    const c = (name: string) => categories[name] || 0;
    const m1 = c(CATEGORIES[0]) + c(CATEGORIES[1]) + c(CATEGORIES[2]) + c(CATEGORIES[3]);
    const m2 = m1 + c(CATEGORIES[4]) + c(CATEGORIES[5]);
    const algeria = c(CATEGORIES[6]) + c(CATEGORIES[7]) + c(CATEGORIES[8]);
    return { "Margine 1": m1, "Margine 2": m2, "Totale Algeria": algeria,
        "Margine 3": m2 + algeria + c(CATEGORIES[9]) + c(CATEGORIES[10]) };
}
