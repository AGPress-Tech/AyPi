import { eventLabel, eventDescription } from './event-labels';
import type { ProgramRecipe, RecipeSegment } from './recipe-profile';

export function segmentEventSummary(recipe: ProgramRecipe, segment: RecipeSegment) {
    if (!Number.isInteger(recipe.maxEvents) || !segment.events) return 'Eventi ausiliari non disponibili: aggiornare il backend.';
    if (!recipe.maxEvents) return '';
    const states = segment.type === 0 && segment.endType === 1 ? recipe.resetEvents : segment.events;
    if (!states || states.length < recipe.maxEvents) return 'Stati eventi non disponibili';
    const index = recipe.segments.findIndex(s => s.number === segment.number);
    const previous = index > 0 ? recipe.segments[index - 1] : undefined;
    const previousStates = previous?.type === 0 && previous.endType === 1 ? recipe.resetEvents : previous?.events;
    return Array.from({ length: recipe.maxEvents }, (_, i) => states[i]
        ? `${eventLabel(i)} ON`
        : previousStates?.[i] ? `${eventLabel(i)} ON → OFF` : '').filter(Boolean).join(' · ');
}

/** Tutti i segmenti memorizzati, anche End, Wait e GoBack esclusi dal grafico termico. */
export function renderRecipeAuxiliary(root: HTMLElement, recipe: ProgramRecipe) {
    const add = (parent: HTMLElement, tag: string, text: string) => {
        const element = document.createElement(tag); element.textContent = text; parent.append(element); return element;
    };
    add(root, 'h3', 'Azioni ausiliarie del programma');
    if (!Number.isInteger(recipe.maxEvents) || !recipe.features || recipe.segments.some(s => !s.events)) {
        add(root, 'p', 'Eventi ausiliari non disponibili. Aggiornare il backend prima di verificare il programma.'); return;
    }
    add(root, 'p', `${recipe.maxEvents} eventi configurati. ${[0, 1, 2].slice(0, recipe.maxEvents).map(eventDescription).join('; ')}. Nomi dal wiring iTools fornito; E1 ON comanda l’apertura della saracinesca, come confermato dall’operatore. ON/OFF indica il comando logico, non un feedback fisico. Eventuali eventi oltre E3 restano da identificare.`);
    const scroll = add(root, 'div', ''); scroll.className = 'recipe-events-scroll';
    const table = add(scroll, 'table', ''); table.className = 'recipe-events-table';
    add(table, 'caption', 'Stati programmati per segmento e stati globali in Reset');
    const head = add(add(table, 'thead', ''), 'tr', '');
    for (const text of ['Fase', 'Tipo', ...Array.from({ length: recipe.maxEvents }, (_, i) => eventDescription(i)), 'Altri parametri']) {
        add(head, 'th', text).setAttribute('scope', 'col');
    }
    const body = add(table, 'tbody', '');
    const stateCell = (row: HTMLElement, state: boolean | undefined) => {
        const cell = add(row, 'td', state === undefined ? 'Non disponibile' : state ? 'ON' : 'OFF');
        if (state !== undefined) cell.dataset.state = state ? 'on' : 'off';
    };
    const reset = add(body, 'tr', ''); add(reset, 'th', 'Reset').setAttribute('scope', 'row'); add(reset, 'td', 'Impostazione globale');
    for (let i = 0; i < recipe.maxEvents; i++) stateCell(reset, recipe.resetEvents?.[i]);
    add(reset, 'td', recipe.features.userValues ? recipe.resetUserValues.map((v, i) => `Valore utente CH${i + 1}: ${v}`).join(' · ') : 'Valori utente disabilitati');
    const names = ['Fine', 'Rampa', 'Sosta', 'Salto di setpoint', 'Attesa', 'Ripetizione'];
    for (const segment of recipe.segments) {
        const row = add(body, 'tr', ''); row.dataset.segment = String(segment.number);
        add(row, 'th', `${segment.number}${segment.name && segment.name !== String(segment.number) ? ' · ' + segment.name : ''}`).setAttribute('scope', 'row');
        const resetEnd = segment.type === 0 && segment.endType === 1;
        add(row, 'td', names[segment.type] + (segment.type === 0 ? resetEnd ? ' → Reset' : ' → Mantieni' : ''));
        for (let i = 0; i < recipe.maxEvents; i++) stateCell(row, (resetEnd ? recipe.resetEvents : segment.events)?.[i]);
        const notes: string[] = [];
        if (resetEnd) notes.push('Si applicano gli stati globali di Reset');
        if (segment.type === 4) notes.push('Attesa: ' + (['ingresso digitale alto', 'analogico 1', 'analogico 2', 'entrambi gli analogici'][segment.waitFor] ?? 'non riconosciuta'));
        if (segment.type === 5) notes.push(`Torna alla fase ${segment.goBackTo}; ${segment.cycles === 0 ? 'ripetizione continua' : segment.cycles + ' ripetizioni'}`);
        for (let ch = 0; ch < recipe.channels; ch++) {
            if (recipe.features.userValues) notes.push(`Valore utente CH${ch + 1}: ${segment.userValues?.[ch] ?? 'non disponibile'}`);
            if (recipe.features.pvEvents && segment.pvEvents?.[ch]) notes.push(`Evento PV CH${ch + 1}: ${['Off', 'Assoluto alto', 'Assoluto basso', 'Deviazione alta', 'Deviazione bassa', 'Banda di deviazione'][segment.pvEvents[ch]] ?? 'non riconosciuto'}; soglia ${segment.pvEventValues?.[ch]}; ${segment.pvEventUse?.[ch] ? 'allarme' : 'trigger'}`);
            if (recipe.features.holdback && segment.holdback[ch]) notes.push(`Holdback CH${ch + 1}: tipo ${segment.holdback[ch]}, soglia ${segment.holdbackValues?.[ch]}`);
            if (segment.type === 4 && (segment.waitFor === ch + 1 || segment.waitFor === 3)) notes.push(`Attesa CH${ch + 1}: criterio ${segment.wait?.[ch]}, soglia ${segment.waitValues?.[ch]}`);
        }
        add(row, 'td', notes.join(' · ') || '—');
    }
    add(root, 'p', `Funzioni abilitate: Holdback ${recipe.features.holdback ? 'sì' : 'no'}, eventi PV ${recipe.features.pvEvents ? 'sì' : 'no'}, valori utente ${recipe.features.userValues ? 'sì' : 'no'}. La tabella include anche le fasi non rappresentate nel grafico; le ripetizioni non sono espanse.`);
}
