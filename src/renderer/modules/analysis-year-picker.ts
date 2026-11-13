// Shared year checklist used by customer analysis and maintenance.
export function analysisYearPicker(years:readonly string[],selected:readonly string[]=[]) {
    return '<span>Esercizi:</span><button type="button" data-years="all">Tutti</button><button type="button" data-years="last2">Ultimi 2</button>'+
        years.filter(year=>/^\d{4}$/.test(year)).map(year=>`<label><input type="checkbox" data-year="${year}" ${selected.includes(year)?'checked':''}>${year}</label>`).join('');
}
