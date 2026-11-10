import { ManagementData, MovementIndex, matches } from "./model";
import {sortByCriteria,SortCriterion} from '../analysis-sorting';

export function queryMovements(data: ManagementData, index: MovementIndex, request: any) {
    if (!request || request.snapshot !== data.loadedAt) throw new Error("I dati sono stati aggiornati. Riaprire il conto.");
    if (typeof request.code !== "string" || typeof request.group !== "string" || !data.groups.some(g => g.name === request.group)) throw new Error("Conto o gruppo non valido.");
    const rules = data.rules.filter(r => r.group === request.group && matches(request.code,r.code));
    if (!rules.length) throw new Error("Il conto non appartiene al gruppo selezionato.");
    if (!Array.isArray(request.ranges) || !request.ranges.length || request.ranges.length > data.years.length) throw new Error("Periodi non validi.");
    const years = new Set<number>();
    for (const r of request.ranges) {
        if (!r || !Number.isInteger(r.year) || !data.years.includes(r.year) || years.has(r.year)
            || !Number.isInteger(r.from) || !Number.isInteger(r.to) || r.from < 1 || r.to > 12 || r.from > r.to) throw new Error("Periodo non valido.");
        years.add(r.year);
    }
    const offset = request.offset ?? 0, limit = request.limit ?? 200;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Intervallo di movimenti non valido.");
    const share = rules.reduce((sum,r) => sum+r.share,0);
    const sorting=request.sort??[];
    if(!Array.isArray(sorting)||sorting.length>2||sorting.some((s,i)=>!s||!['date','value'].includes(s.key)||!['asc','desc'].includes(s.direction)||sorting.slice(0,i).some(other=>other.key===s.key)))throw new Error('Ordinamento movimenti non valido.');
    const original = (index[request.code] || []).filter(m => request.ranges.some(r => r.year === m.year && m.month >= r.from && m.month <= r.to))
        .sort((a,b) => a.competenceDate.localeCompare(b.competenceDate) || a.sourceRow-b.sourceRow);
    const movements=sortByCriteria(original,sorting as SortCriterion[],(m,key)=>key==='date'?m.competenceDate:-m.value*share);
    return { items: movements.slice(offset,offset+limit).map(m => ({ ...m,share,allocatedValue:-m.value*share })),
        total: movements.length, nextOffset: Math.min(offset+limit,movements.length), share };
}
