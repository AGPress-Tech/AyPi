import './analysis-chart-area-selection';
const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[c]!);

/** Chart header controls shared by AyPi analyses; styles live in turning-analysis.css. */
export function analysisChartControls(id: string, title: string, expanded = false, cumulative?: boolean) {
    const key = escapeAttribute(id), label = escapeAttribute(title);
    const period = cumulative === undefined ? '' : `<button type="button" data-cumulative="${key}" aria-pressed="${cumulative}" title="Alterna valori mensili e cumulati dall’inizio del periodo">${cumulative ? 'Cumulativo' : 'Mensile'} ⇄</button>`;
    return `${period}<button type="button" class="chart-icon" data-reset-chart="${key}" title="Rimuovi selezioni dei grafici e zoom mensile" aria-label="Azzera selezioni del grafico ${label}">↺</button><button type="button" class="chart-icon" data-expand-chart="${key}" title="Espandi o riduci grafico" aria-label="Espandi grafico ${label}" aria-pressed="${expanded}">${expanded ? '⤡' : '⤢'}</button>`;
}

export function setChartExpanded(button: HTMLElement, expanded: boolean) {
    button.setAttribute('aria-pressed', String(expanded));
    button.textContent = expanded ? '⤡' : '⤢';
}
