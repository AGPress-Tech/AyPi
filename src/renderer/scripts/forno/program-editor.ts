import { eventLabel, eventDescription } from './event-labels';
import { openProgramTransfer, type TransferApi } from './program-transfer-dialog';
import Chart from 'chart.js/auto';
import { addStep, buildDraftProfile, cloneDraft, createDraftStep, draftTimeline, formatDuration as formatExactDuration, insertDraftPoint, moveDraftPoint, newProgramDraft, parseDeci, parseDuration, removeStep, reorderStep, reviewDraft, STEP_LABELS, validateDraft, type ProgramDraft, type DraftStep, type StepKind } from '../../../main/modules/forno/program-draft';

export type DraftStorage = { load: () => Promise<ProgramDraft | null>; save: (draft: ProgramDraft) => Promise<ProgramDraft>; export: (draft: ProgramDraft) => Promise<{ path: string } | null>; import: () => Promise<ProgramDraft | null>; archive?: (draft: ProgramDraft) => Promise<{ count: number }>; transfer?: TransferApi };
export function createProgramEditor(root: HTMLElement, initial: ProgramDraft, storage: DraftStorage) {
    let draft = validateDraft(initial), selected = -1, pending = false, mode: 'select' | 'draw' = 'select', revision = 0, disposed = false, saveFailed = false;
    let viewLocked = false;
    let history: ProgramDraft[] = [], future: ProgramDraft[] = [], saving: Promise<unknown> = Promise.resolve();
    const node = <K extends keyof HTMLElementTagNameMap>(tag: K, css = '', text = '') => { const e = document.createElement(tag); e.className = css; e.textContent = text; return e; };
    const button = (text: string, action: () => void, css = 'button secondary') => { const b = node('button', css, text); b.type = 'button'; b.addEventListener('click', action); return b; };
    const field = (text: string, control: HTMLElement) => { const l = node('label', '', text); l.append(control); return l; };
    const input = (label: string, value: string, key: string) => { const e = node('input'); e.type = 'text'; e.value = value; e.dataset.field = key; e.setAttribute('aria-label', label); return e; };
    const select = (label: string, options: [string, string][], key?: string) => { const e = node('select'); e.setAttribute('aria-label', label); if (key) e.dataset.field = key; for (const [value, label] of options) { const o = node('option', '', label); o.value = value; e.append(o); } return e; };
    const formatDuration = (ms: number) => formatExactDuration(ms).split('.')[0];
    const inputDuration = (ms: number) => formatDuration(ms).padStart(9, '0');
    const wholeDuration = (value: string) => { if (!/^\d{2,3}:[0-5]\d:[0-5]\d$/.test(value)) throw Error('Durata richiesta HH:MM:SS, minimo 1 secondo, senza millisecondi.'); return parseDuration(value); };
    const numberText = (n: number) => (n / 10).toFixed(1), timed = (kind: StepKind) => kind === 'ramp' || kind === 'dwell';
    const eventIcon = (on: boolean) => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(svg.namespaceURI, 'path');
        path.setAttribute('d', on ? 'M5 12l4 4L19 6' : 'M6 6l12 12M18 6L6 18');
        svg.append(path); return svg;
    };
    const toolbar = node('div', 'program-editor-toolbar'), form = node('div', 'program-editor-fields');
    const name = input('Nome del programma', draft.name, 'name'); name.maxLength = 20;
    const start = input('Temperatura iniziale anteprima in °C', numberText(draft.startDeciC), 'start'); start.inputMode = 'decimal';
    form.append(field('Nome programma', name), field('Partenza anteprima [°C]', start));
    const notice = node('p', 'program-editor-notice', 'BOZZA LOCALE · Nessun invio automatico al forno. Usa Invia al forno per creare o sovrascrivere un programma, con backup e conferma. Il grafico mostra il setpoint nominale. La partenza reale e gli ingressi di attesa dipendono dalla configurazione del forno.');
    const status = node('p', 'settings-note'); status.setAttribute('role', 'status'); const error = node('p', 'form-error'); error.setAttribute('role', 'alert');
    const workspace = node('div', 'program-editor-workspace'), left = node('section', 'program-editor-graph-pane'), right = node('section', 'program-editor-steps-pane');
    right.setAttribute('aria-label', 'Fasi del programma con scorrimento indipendente');
    const controls = node('div', 'program-editor-graph-controls');
    const kind = select('Tipo di fase da disegnare', [['ramp', 'Rampa'], ['dwell', 'Stasi']]);
    const timeSnap = select('Passo tempo nel grafico', [['1000', '1 secondo'], ['30000', '30 secondi'], ['60000', '1 minuto'], ['600000', '10 minuti'], ['1800000', '30 minuti'], ['3600000', '1 ora']]); timeSnap.value = '60000';
    const tempSnap = select('Passo temperatura nel grafico', [['10', '1 °C'], ['50', '5 °C'], ['100', '10 °C'], ['500', '50 °C'], ['1000', '100 °C']]); tempSnap.value = '10';
    const selectMode = button('Seleziona / sposta', () => { mode = 'select'; updateMode(); }), drawMode = button('Disegna punti', () => { mode = 'draw'; updateMode(); });
    controls.append(selectMode, drawMode, kind, button('Adatta grafico', () => { if (!drag) { viewLocked = false; renderGraph(draft); } }), field('Passo tempo', timeSnap), field('Passo °C', tempSnap));
    const plot = node('div', 'program-editor-plot'), canvas = node('canvas'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Profilo programmato. Trascina le rampe e le stasi; usa la tabella per gli altri tipi.'); plot.append(canvas);
    const pointInfo = node('p', 'program-editor-point'); pointInfo.setAttribute('aria-live', 'polite'); const metrics = node('div', 'program-editor-metrics');
    const graphWarnings = node('p', 'program-editor-graph-warnings'); graphWarnings.setAttribute('role', 'status');
    const help = node('details', 'program-editor-help'); help.append(node('summary', '', 'Uso del grafico e significato dei parametri'), node('p', 'settings-note', 'Trascina un termine di rampa/stasi: le fasi successive mantengono la durata. Disegna un punto dopo l’ultimo oppure dentro una rampa per dividerla. Frecce: un passo; Maiusc: dieci; Esc annulla. Ripetizioni e tempi dipendenti da attese si configurano nella tabella. Le nuove stasi propongono valore utente 5, modificabile; i valori originali restano conservati. Nel clone analizzato questo valore determina la tolleranza sotto il setpoint per Hold automatico; zero seleziona 1000 °C.'));
    const review = node('details', 'program-editor-review'); review.append(node('summary', '', 'Controverifica delle istruzioni generate')); const reviewBody = node('div'); review.append(reviewBody);
    left.append(form, controls, node('p', 'program-editor-zoom-help', 'Origine fissa 0 h / 0 °C · Rotella: zoom tempo · Maiusc + rotella: zoom temperatura · Il profilo resta interamente visibile'), plot, pointInfo, metrics, graphWarnings, review, help);
    const actions = node('div', 'program-editor-toolbar');
    const selectionInfo = node('p', 'program-editor-selection');
    let draggedPhase: number | null = null;
    function selectPhase(index: number) { selected = index; renderGraph(draft, true); updateSelection(); }
    function updateSelection() { for (const row of Array.from(tbody.rows)) { const active = Number(row.dataset.index) === selected; row.classList.toggle('selected', active); row.setAttribute('aria-selected', String(active)); row.querySelector('.program-editor-select')?.setAttribute('aria-pressed', String(active)); } selectionInfo.textContent = selected >= 0 ? `Fase ${selected + 1} selezionata: aggiungi dopo questa fase. Trascina il numero per riordinare.` : 'Seleziona una fase. Trascina il numero per riordinare; senza selezione aggiungi in fondo.'; }
    const addKind = select('Tipo di nuova fase', Object.entries(STEP_LABELS), 'newKind');
    function append(kind: StepKind) { run(() => { const next = addStep(draft, kind, selected >= 0 ? selected : draft.steps.length - 1); selected = kind === 'end' ? next.steps.length - 1 : Math.min(selected >= 0 ? selected + 1 : draft.steps.length, next.steps.length - (next.steps[next.steps.length - 1]?.kind === 'end' ? 2 : 1)); commit(next); }); }
    const addAny = button('+ Aggiungi fase', () => append(addKind.value as StepKind));
    const addRamp = button('+ Rampa', () => append('ramp')), addDwell = button('+ Stasi', () => append('dwell')), addEnd = button('+ Fine', () => append('end'));
    actions.append(addKind, addAny, addRamp, addDwell, addEnd);
    const tableScroll = node('div', 'program-editor-table-scroll'), table = node('table', 'program-editor-table'); tableScroll.tabIndex = 0; tableScroll.setAttribute('aria-label', 'Scorri le fasi del programma');
    const caption = node('caption', '', 'Fasi · tempi HH:MM:SS · eventi indipendenti OFF / ON');
    const thead = node('thead'), headings = node('tr');
    for (const label of ['Fase', 'Tipo', 'Nome', 'Temperatura °C', 'Durata', 'Tempo nominale', 'E1', 'E2', 'E3', 'Valore utente CH1', 'Azioni', 'Parametri specifici']) { const h = node('th', '', label); h.scope = 'col'; headings.append(h); }
    thead.append(headings); const tbody = node('tbody'); table.append(caption, thead, tbody); tableScroll.append(table);
    const paste = node('details', 'program-editor-paste'); paste.append(node('summary', '', 'Incolla righe da Excel'), node('p', 'settings-note', '7 colonne TSV senza intestazione: rampa/stasi, temperatura °C, HH:MM:SS, E1/E2/E3 (ON/OFF o V/X), valore utente CH1. Tutte le righe oppure nessuna. Fine, Step, Wait e GoBack si configurano dalle fasi.'));
    const pasteText = node('textarea'); pasteText.rows = 2; pasteText.setAttribute('aria-label', 'Righe da Excel');
    const pasteButton = button('Aggiungi righe incollate', () => run(() => {
        if (!pasteText.value.trim()) throw Error('Incollare almeno una riga.'); let next = cloneDraft(draft);
        for (const [i, line] of pasteText.value.trim().split(/\r?\n/).entries()) {
            const c = line.split('\t'), k = c[0].trim().toLowerCase(); if (c.length !== 7 || !['rampa', 'ramp', 'stasi', 'sosta', 'hold', 'dwell'].includes(k)) throw Error(`Riga ${i + 1}: servono 7 colonne e tipo rampa/stasi.`);
            const kind = ['rampa', 'ramp'].includes(k) ? 'ramp' : 'dwell'; const count = next.steps.filter(s => s.kind !== 'end').length;
            next = addStep(next, kind); const s = next.steps[count];
            s.targetDeciC = parseDeci(c[1]); s.durationMs = wholeDuration(c[2]); s.events = c.slice(3, 6).map(v => { if (!/^(ON|OFF|V|X)$/i.test(v.trim())) throw Error(`Riga ${i + 1}: eventi ON/OFF o V/X.`); return /^(ON|V)$/i.test(v.trim()); }) as DraftStep['events']; s.userValueDeci = parseDeci(c[6]);
            // Nessuna correzione di una stasi incoerente inserita da Excel.
            if (next.steps[next.steps.length - 1]?.kind === 'end') next.steps[next.steps.length - 1].targetDeciC = s.targetDeciC;
            next = validateDraft(next);
        } commit(next); pasteText.value = '';
    })); paste.append(pasteText, pasteButton); right.append(node('h3', '', 'Le fasi del programma'), actions, selectionInfo, tableScroll, paste); workspace.append(left, right);
    const newButton = button('Nuova bozza', () => run(() => { selected = -1; viewLocked = false; commit(newProgramDraft()); }));
    const undo = button('Annulla', () => { if (pending || !history.length) return; future.push(cloneDraft(draft)); draft = history.pop()!; selected = -1; changed(); });
    const redo = button('Ripristina', () => { if (pending || !future.length) return; history.push(cloneDraft(draft)); draft = future.pop()!; selected = -1; changed(); });
    const retrySave = button('Salva bozza sul PC', () => { if (!pending) persist(); });
    const exportButton = button('Esporta bozza…', () => { if (!pending) void external(async () => { const result = await storage.export(cloneDraft(draft)); if (result) status.textContent = 'Bozza esportata: ' + result.path; }); });
    const importButton = button('Apri bozza…', () => { if (!pending) void external(async () => { const before = revision, loaded = await storage.import(); if (loaded) { if (revision !== before || pending) throw Error('La bozza è cambiata durante l’apertura del file.'); selected = -1; commit(validateDraft(loaded)); } }); });
    const archiveButton = button('Salva versione nell’archivio', () => { if (!pending && storage.archive) void external(async () => { reviewDraft(draft); const result = await storage.archive!(cloneDraft(draft)); status.textContent = `Versione salvata nell’archivio locale (${result.count} programmi). Nessuna modifica al forno.`; }); }); archiveButton.hidden = !storage.archive;
    const resetInputs = button('Annulla valori in corso', () => { pending = false; error.textContent = ''; render(); });
    const verifyButton = button('Verifica programma', () => run(() => { reviewDraft(draft); review.open = true; renderReview(); }), 'button primary');
    const transferButton = button('Invia al forno…', () => run(() => { if (saveFailed) throw Error('Salvare e rileggere la bozza prima del trasferimento.'); if (storage.transfer) openProgramTransfer(cloneDraft(draft), storage.transfer, copy => { selected = -1; commit(validateDraft(copy)); }); })); transferButton.hidden = !storage.transfer;
    toolbar.append(newButton, undo, redo, retrySave, importButton, exportButton, archiveButton, verifyButton, transferButton, resetInputs); root.replaceChildren(notice, toolbar, workspace, error, status); root.classList.add('program-editor');
    const chart = new Chart(canvas, { type: 'line', data: { datasets: [{ label: 'Setpoint CH1', data: [], borderColor: '#ec8627', backgroundColor: '#ec862713', fill: true, borderWidth: 3, pointRadius: 4, pointHoverRadius: 7, pointBorderWidth: 2, pointBackgroundColor: '#fff', tension: 0, parsing: false }] }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', intersect: true }, plugins: { legend: { display: false }, tooltip: { xAlign: 'right', callbacks: { title: items => inputDuration(Math.round((items[0]?.parsed.x || 0) * 3600000)), label: item => `${item.parsed.y.toFixed(1)} °C`, afterBody: items => { const p = items[0]?.raw as { phase: number }; return p?.phase >= 0 ? `Fase ${p.phase + 1} · ${STEP_LABELS[draft.steps[p.phase].kind]}` : 'Partenza anteprima'; } } } }, scales: { x: { type: 'linear', min: 0, max: 2, title: { display: true, text: 'Tempo nominale dall’inizio [h]' } }, y: { min: 0, max: 600, title: { display: true, text: 'Setpoint [°C]' } } } } });
    function updateMode() { selectMode.setAttribute('aria-pressed', String(mode === 'select')); drawMode.setAttribute('aria-pressed', String(mode === 'draw')); canvas.style.cursor = mode === 'draw' ? 'crosshair' : 'grab'; }
    function run(action: () => void) { if (pending) { error.textContent = 'Correggere i valori in corso oppure annullarli prima di proseguire.'; return; } try { action(); error.textContent = ''; } catch (e) { error.textContent = (e as Error).message; } }
    async function external(action: () => Promise<void>) { try { await action(); } catch (e) { if (!disposed) error.textContent = (e as Error).message; } }
    function updateButtons() { for (const b of [newButton, undo, redo, retrySave, exportButton, importButton, archiveButton, verifyButton, addAny, addRamp, addDwell, addEnd, pasteButton]) b.disabled = pending; undo.disabled ||= !history.length; redo.disabled ||= !future.length; addRamp.disabled ||= draft.steps.filter(s => s.kind !== 'end').length >= 25; addDwell.disabled ||= addRamp.disabled; addEnd.disabled ||= draft.steps.some(s => s.kind === 'end'); resetInputs.hidden = !pending; review.inert = pending; }
    function persist() { const snapshot = cloneDraft(draft), at = revision; status.textContent = 'Salvataggio bozza locale…'; saving = saving.catch(() => {}).then(() => storage.save(snapshot)).then(saved => { if (JSON.stringify(validateDraft(saved)) !== JSON.stringify(snapshot)) throw Error('Bozza riletta diversa dal salvataggio.'); if (!disposed && revision === at) { saveFailed = false; if (!pending) status.textContent = 'Bozza salvata e riletta su questo PC · nessun invio al forno'; } }).catch(e => { if (!disposed) { saveFailed = true; status.textContent = 'Bozza non salvata: ' + (e as Error).message; } }); }
    function changed(keepScale = false) { revision++; render(keepScale); persist(); }
    function commit(next: ProgramDraft, keepScale = false) { const valid = validateDraft(next); history.push(cloneDraft(draft)); if (history.length > 100) history.shift(); future = []; draft = valid; pending = false; changed(keepScale); }
    // La vista iniziale e la rotella condividono gli stessi intervalli intermedi.
    function axisSteps(axis: 'x' | 'y') {
        const steps = axis === 'x'
            ? [.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000]
            : [.5, 1, 2, 2.5, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];
        for (let magnitude = 1000; magnitude <= 100000000; magnitude *= 10)
            for (const multiple of [1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) steps.push(magnitude * multiple);
        return steps;
    }
    function setAxis(axis: 'x' | 'y', _min: number, max: number, _exact = false) {
        const steps = axisSteps(axis);
        const step = steps.find(n => n >= max / 8) || 500000000;
        const scale = chart.options.scales![axis]!; scale.min = 0; scale.max = step * 8;
        scale.ticks = { ...scale.ticks, count: 9, stepSize: step, autoSkip: false, maxRotation: 0, callback: (value, index) => axis === 'x' ? (chart.width < 560 && index % 2 ? '' : inputDuration(Math.round(Number(value) * 3600000))) : Number(value).toLocaleString('it-IT', { maximumFractionDigits: 1 }) };
    }
    function renderGraph(value: ProgramDraft, keepScale = false) {
        const profile = buildDraftProfile(value), rows = draftTimeline(value); chart.data.datasets[0].data = profile.points;
        chart.data.datasets[0].pointRadius = profile.points.map(p => p.phase === selected && selected >= 0 ? 6 : 3);
        chart.data.datasets[0].pointBackgroundColor = profile.points.map(p => p.phase === selected && selected >= 0 ? '#3296dc' : '#fff');
        if (!keepScale && !viewLocked) { setAxis('x', 0, Math.max(2, profile.shownMs / 3600000 * 1.15)); const max = Math.max(200, ...profile.points.map(p => p.y)); setAxis('y', 0, max + Math.max(50, max * .15)); }
        else if (!keepScale) {
            const bounds = zoomBounds(value);
            setAxis('x', 0, Math.max(Number(chart.options.scales!.x!.max), bounds.x), true);
            setAxis('y', 0, Math.max(Number(chart.options.scales!.y!.max), bounds.y), true);
        }
        chart.update('none'); const r = rows[selected]; pointInfo.textContent = r ? `Fase ${selected + 1} · ${STEP_LABELS[r.kind]} · ${r.timeKnown ? 'fine ' + formatDuration(r.endMs) : 'tempo dipendente da attesa/ripetizione'} · ${numberText(r.targetDeciC)} °C · durata ${formatDuration(r.durationMs)}` : 'Seleziona una fase a destra o un punto del grafico.';
        graphWarnings.textContent = profile.warnings.join(' ');
    }
    function protectDuration(control: HTMLInputElement, originalMs: number) {
        control.inputMode = 'numeric'; control.maxLength = 9;
        control.title = originalMs % 1000 ? `Durata originale ${formatExactDuration(originalMs)}: i millisecondi restano conservati finché non modifichi questa durata.` : 'Ore : minuti : secondi. I separatori sono fissi; le cifre vengono sovrascritte.';
        control.addEventListener('beforeinput', event => {
            const e = event as InputEvent; e.preventDefault();
            if (control.readOnly) return;
            const chars = control.value.split(''), start = control.selectionStart ?? 0, end = control.selectionEnd ?? start;
            const digit = (i: number) => i >= 0 && i < 9 && i !== 3 && i !== 6;
            let at = start;
            if (e.inputType.startsWith('delete')) {
                if (start === end) { at = e.inputType.includes('Backward') ? start - 1 : start; while (at >= 0 && at < 9 && !digit(at)) at += e.inputType.includes('Backward') ? -1 : 1; if (digit(at)) chars[at] = '0'; }
                else for (let i = start; i < end; i++) if (digit(i)) chars[i] = '0';
            } else if (e.inputType === 'insertText' && /^\d+$/.test(e.data || '')) {
                for (let i = start; i < end; i++) if (digit(i)) chars[i] = '0';
                for (const n of e.data!) { while (at < 9 && !digit(at)) at++; if (at < 9) chars[at++] = n; }
                while (at < 9 && !digit(at)) at++;
            } else return;
            control.value = chars.join(''); control.setSelectionRange(Math.max(0, at), Math.max(0, at));
            control.dispatchEvent(new Event('input', { bubbles: true }));
        });
        control.addEventListener('paste', e => {
            e.preventDefault(); try { control.value = inputDuration(wholeDuration(e.clipboardData?.getData('text') || '')); control.dispatchEvent(new Event('input', { bubbles: true })); }
            catch (failure) { error.textContent = (failure as Error).message; }
        });
    }
    function renderTable(value: ProgramDraft) {
        const scroll = tableScroll.scrollTop; tbody.replaceChildren();
        for (const r of draftTimeline(value)) {
            const row = node('tr'); row.dataset.index = String(r.index); row.dataset.kind = r.kind; row.classList.toggle('selected', r.index === selected);
            const td = (child: HTMLElement, label: string, css = '') => { const e = node('td', css); e.dataset.label = label; e.append(child); row.append(e); return e; };
            const handle = button(String(r.index + 1).padStart(2, '0'), () => run(() => selectPhase(r.index)), 'program-editor-select');
            handle.draggable = r.kind !== 'end'; handle.title = r.kind === 'end' ? 'Fine rimane ultima' : 'Trascina per riordinare. Alt + freccia su/gi? per spostare.';
            handle.setAttribute('aria-label', `Seleziona o sposta fase ${r.index + 1}`);
            handle.addEventListener('dragstart', e => { if (pending || !handle.draggable) { e.preventDefault(); return; } draggedPhase = r.index; selectPhase(r.index); e.dataTransfer!.effectAllowed = 'move'; e.dataTransfer!.setData('text/plain', String(r.index)); row.classList.add('dragging'); e.dataTransfer!.setDragImage(row, 15, 15); });
            handle.addEventListener('dragend', () => { draggedPhase = null; clearDropMarkers(); row.classList.remove('dragging'); });
            handle.addEventListener('keydown', e => { if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); run(() => { const to = r.index + (e.key === 'ArrowUp' ? -1 : 1); const next = reorderStep(draft, r.index, to); selected = to; commit(next); (tbody.rows[to]?.querySelector('.program-editor-select') as HTMLElement)?.focus(); }); });
            row.addEventListener('click', e => { if (pending || (e.target as HTMLElement).closest('button')) return; selectPhase(r.index); });
            td(handle, 'Fase', 'phase-number');
            const k = select(`Tipo fase ${r.index + 1}`, Object.entries(STEP_LABELS), 'kind'); k.value = r.kind; td(k, 'Tipo', 'phase-kind');
            const label = input(`Nome fase ${r.index + 1}`, r.label, 'label'); label.maxLength = 20; label.placeholder = String(r.index + 1); td(label, 'Nome', 'phase-name');
            const target = input(`Temperatura finale fase ${r.index + 1}`, numberText(r.targetDeciC), 'target'); target.inputMode = 'decimal'; target.readOnly = !['ramp', 'step'].includes(r.kind); td(target, 'CH1 temperatura [°C]', 'phase-target');
            const duration = input(`Durata fase ${r.index + 1}`, timed(r.kind) ? inputDuration(r.durationMs) : '—', 'duration'); duration.readOnly = !timed(r.kind); if (timed(r.kind)) protectDuration(duration, r.durationMs); td(duration, timed(r.kind) ? 'Durata [HH:MM:SS]' : r.kind === 'wait' ? 'Durata variabile' : 'Senza durata prefissata', 'phase-duration');
            td(node('span', 'program-editor-time', r.timeKnown ? formatDuration(r.startMs) + ' → ' + formatDuration(r.endMs) : 'Dipende da attesa/ripetizione'), 'Tempo nominale', 'phase-time');
            for (let i = 0; i < 3; i++) { const on = r.events[i]; const toggle = button('', () => { if (pending) return; toggle.value = toggle.value === 'on' ? 'off' : 'on'; toggle.dispatchEvent(new Event('change', { bubbles: true })); }, 'program-event-toggle'); toggle.append(eventIcon(on)); toggle.value = on ? 'on' : 'off'; toggle.dataset.field = 'event' + i; toggle.setAttribute('aria-label', `${eventDescription(i)} fase ${r.index + 1}: ${on ? 'ON' : 'OFF'}`); toggle.setAttribute('aria-pressed', String(on)); toggle.title = eventDescription(i) + ': ' + (on ? 'ON' : 'OFF'); toggle.disabled = r.kind === 'end' && r.endAction === 'reset'; td(toggle, eventLabel(i), 'phase-event'); }
            const user = input(`Valore utente CH1 fase ${r.index + 1}`, numberText(r.userValueDeci), 'user'); user.readOnly = r.kind === 'end' && r.endAction === 'reset'; td(user, 'Valore utente CH1', 'phase-user');
            td(button('Elimina', () => run(() => { const next = removeStep(draft, r.index); selected = Math.min(selected, next.steps.length - 1); commit(next); })), '', 'phase-delete');
            const extra = node('div', 'phase-specific');
            if (r.kind === 'end') { const action = select(`Azione Fine fase ${r.index + 1}`, [['reset', 'Reset'], ['dwell', 'Mantieni indefinitamente']], 'endAction'); action.value = r.endAction!; extra.append(field('Azione finale', action), node('small', '', r.endAction === 'reset' ? 'Reset: eventi e valore utente dagli stati globali del forno.' : 'Mantiene il setpoint e gli eventi di questa fase senza scadenza.')); }
            if (r.kind === 'wait') { const waitFor = select(`Ingresso attesa fase ${r.index + 1}`, [['0', 'Digitale alto'], ['1', 'Analogico 1']], 'waitFor'); waitFor.value = String(r.waitFor); const criterion = select(`Criterio attesa fase ${r.index + 1}`, [['1', 'Assoluto alto'], ['2', 'Assoluto basso'], ['3', 'Deviazione alta'], ['4', 'Deviazione bassa']], 'waitCondition'); criterion.value = String(r.waitCondition); const threshold = input(`Soglia attesa fase ${r.index + 1}`, numberText(r.waitValueDeci!), 'waitValue'); criterion.disabled = r.waitFor === 0; threshold.readOnly = r.waitFor === 0; extra.append(field('Ingresso', waitFor), field('Criterio', criterion), field('Soglia', threshold), node('small', '', 'Usa Wait Digital / Wait Analog 1 configurati nel forno. Il grafico non inventa il tempo necessario.')); }
            if (r.kind === 'goback') { const target = select(`Destinazione GoBack fase ${r.index + 1}`, value.steps.slice(0, r.index).map((s, i) => [String(i + 1), `${i + 1} · ${s.label || STEP_LABELS[s.kind]}`]), 'goBackTo'); target.value = String(r.goBackTo); const cycles = input(`Ripetizioni fase ${r.index + 1}`, String(r.cycles), 'cycles'); extra.append(field('Torna alla fase', target), field('Ripetizioni (0 = continuo)', cycles), node('small', '', 'Sono vietati cicli annidati/sovrapposti. I cicli finiti sono espansi nel grafico.')); }
            if (extra.childElementCount) td(extra, 'Configurazione', 'phase-extra'); tbody.append(row);
        } tableScroll.scrollTop = scroll; updateSelection();
    }
    function clearDropMarkers() { for (const row of Array.from(tbody.rows)) row.classList.remove('drop-before', 'drop-after'); }
    function dropPosition(e: DragEvent) {
        const row = (e.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-index]');
        if (!row || !tbody.contains(row) || draggedPhase === null) return null;
        const index = Number(row.dataset.index), after = e.clientY > row.getBoundingClientRect().top + row.clientHeight / 2;
        const limit = draft.steps.filter(s => s.kind !== 'end').length - 1;
        return { row, after, to: Math.max(0, Math.min(limit, index + (after ? 1 : 0) - (draggedPhase < index + (after ? 1 : 0) ? 1 : 0))) };
    }
    function reorderOver(e: DragEvent) {
        if (pending || draggedPhase === null) return; const place = dropPosition(e); if (!place) return;
        e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; clearDropMarkers(); place.row.classList.add(place.after && place.row.dataset.kind !== 'end' ? 'drop-after' : 'drop-before');
        const bounds = tableScroll.getBoundingClientRect(); if (e.clientY < bounds.top + 35) tableScroll.scrollTop -= 18; else if (e.clientY > bounds.bottom - 35) tableScroll.scrollTop += 18;
    }
    function reorderDrop(e: DragEvent) {
        if (pending || draggedPhase === null) return; const place = dropPosition(e), from = draggedPhase; draggedPhase = null; clearDropMarkers(); if (!place) return;
        e.preventDefault(); if (from === place.to) return;
        run(() => { const next = reorderStep(draft, from, place.to); selected = place.to; commit(next); });
    }
    tableScroll.addEventListener('dragover', reorderOver); tableScroll.addEventListener('drop', reorderDrop);
    function renderReview(value = draft) { reviewBody.replaceChildren(); try { const r = reviewDraft(value); reviewBody.append(node('p', 'settings-note', r.status), node('p', '', `${r.instructions.length} segmenti · durata ${r.durationMs === null ? 'variabile' : formatDuration(r.durationMs)} · massimo ${numberText(r.maxDeciC)} °C`)); const pre = node('pre'); pre.textContent = r.instructions.map(s => `${s.phase} nome=${s.label} ${s.type} ${s.fromMs === null ? 'tempo variabile' : formatDuration(s.fromMs) + ' → ' + formatDuration(s.toMs!)} durata=${formatDuration(s.durationMs)} target=${s.targetC} °C float32=${s.targetFloat32C} ${s.events.map((v, i) => `${eventLabel(i)}=${v ? 'V' : 'X'}`).join(' ')} UserVal=${s.userValue}${s.kind === 'wait' ? ` WaitFor=${s.waitFor} criterio=${s.waitCondition} soglia=${s.waitValue}` : ''}${s.kind === 'goback' ? ` torna=${s.goBackTo} ripetizioni=${s.cycles}` : ''}${s.kind === 'end' ? ` azione=${s.endAction}` : ''}`).join('\n') + '\n' + r.end; reviewBody.append(pre); } catch (e) { reviewBody.append(node('p', 'settings-note', (e as Error).message)); } }
    function render(keepScale = false) { name.value = draft.name; start.value = numberText(draft.startDeciC); renderGraph(draft, keepScale); renderTable(draft); renderReview(); updateMode(); updateButtons(); renderMetrics(draft); }
    function renderMetrics(value: ProgramDraft) { const rows = draftTimeline(value), variable = rows.some(r => !r.timeKnown); metrics.textContent = `${value.steps.filter(s => s.kind !== 'end').length} / 25 fasi · ${value.steps.some(s => s.kind === 'end') ? 'Fine presente' : 'Fine da aggiungere'} · durata ${variable ? 'variabile' : formatDuration(rows[rows.length - 1]?.endMs || 0)} · 0,1 °C / 1 secondo`; }
    function readForm() {
        const d = cloneDraft(draft); d.name = name.value; d.startDeciC = parseDeci(start.value); let previous = d.startDeciC;
        for (const [index, row] of Array.from(tbody.rows).entries()) {
            const get = (key: string) => (row.querySelector(`[data-field="${key}"]`) as HTMLInputElement | HTMLSelectElement | HTMLButtonElement | null)?.value;
            const k = get('kind') as StepKind, old = draft.steps[index], changedKind = k !== old.kind, s = changedKind ? createDraftStep(k, previous, index) : { ...old };
            s.label = get('label')!; s.targetDeciC = ['ramp', 'step'].includes(k) ? parseDeci(get('target')!) : previous;
            s.durationMs = timed(k) ? (changedKind && !timed(old.kind) ? 3600000 : get('duration') === inputDuration(old.durationMs) ? old.durationMs : wholeDuration(get('duration')!)) : 0;
            s.events = [0, 1, 2].map(i => get('event' + i) === 'on') as DraftStep['events']; const entered = parseDeci(get('user')!);
            s.userValueDeci = changedKind && entered === (old.kind === 'dwell' ? 50 : 0) ? (k === 'dwell' ? 50 : 0) : entered;
            if (k === 'wait' && !changedKind) { s.waitFor = Number(get('waitFor')) as 0 | 1; s.waitCondition = Number(get('waitCondition')); s.waitValueDeci = parseDeci(get('waitValue')!); }
            if (k === 'goback' && !changedKind) { s.goBackTo = Number(get('goBackTo')); if (!/^\d+$/.test(get('cycles')!)) throw Error('Le ripetizioni devono essere un intero (0 = continuo).'); s.cycles = Number(get('cycles')); }
            if (k === 'end') { if (!changedKind) s.endAction = get('endAction') as 'reset' | 'dwell'; if (s.endAction === 'reset') { s.events = [false, false, false]; s.userValueDeci = 0; } }
            d.steps[index] = s; previous = s.targetDeciC;
        } return validateDraft(d);
    }
    function editInput(e: Event) { if ((e.target as HTMLElement).closest('.program-editor-fields, .program-editor-table')) { pending = true; status.textContent = 'Valori in corso: grafico e verifica mostrano l’ultima versione valida. Conferma con Tab/Invio oppure annulla.'; review.open = false; updateButtons(); } }
    function editChange(e: Event) { if (!(e.target as HTMLElement).closest('.program-editor-fields, .program-editor-table')) return; try { commit(readForm()); error.textContent = ''; } catch (errorValue) { pending = true; updateButtons(); error.textContent = (errorValue as Error).message; } }
    function confirmInput(e: KeyboardEvent) { if (e.key === 'Enter' && (e.target as HTMLElement).matches('.program-editor-fields input, .program-editor-table input')) { e.preventDefault(); editChange(e); } }
    root.addEventListener('input', editInput); root.addEventListener('change', editChange); root.addEventListener('keydown', confirmInput);
    let drag: { pointer: number; index: number; before: ProgramDraft; candidate: ProgramDraft; moved: boolean; valid: boolean; x: number; y: number } | null = null;
    const coordinates = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * chart.width / r.width, y: (e.clientY - r.top) * chart.height / r.height }; };
    const graphValue = (e: PointerEvent) => { const p = coordinates(e); return { ms: Math.round(Math.max(0, chart.scales.x.getValueForPixel(p.x) || 0) * 3600000 / Number(timeSnap.value)) * Number(timeSnap.value), deci: Math.round((chart.scales.y.getValueForPixel(p.y) || 0) * 10 / Number(tempSnap.value)) * Number(tempSnap.value) }; };
    const pointerDown = (e: PointerEvent) => {
        if (pending || e.button !== 0 || drag) return; const p = coordinates(e), a = chart.chartArea; if (p.x < a.left || p.x > a.right || p.y < a.top || p.y > a.bottom) return;
        const points = buildDraftProfile(draft).points, rows = draftTimeline(draft); let hit = -1, distance = 14;
        chart.getDatasetMeta(0).data.forEach((dot, i) => { const raw = points[i], row = rows[raw.phase]; if (!row || !row.timeKnown || raw.x * 3600000 !== row.endMs || !['ramp', 'dwell', 'step'].includes(row.kind)) return; const dist = Math.hypot(p.x - dot.x, p.y - dot.y); if (dist < distance) { hit = raw.phase; distance = dist; } });
        if (hit >= 0) { selected = hit; renderGraph(draft, true); renderTable(draft); if (draft.steps.some(s => s.kind === 'goback')) { pointInfo.textContent += ' · Modifica i parametri nella tabella per i profili con ripetizioni.'; return; } drag = { pointer: e.pointerId, index: hit, before: cloneDraft(draft), candidate: cloneDraft(draft), moved: false, valid: true, x: p.x, y: p.y }; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; canvas.focus(); chart.options.events = []; renderGraph(draft, true); pinDragTooltip(); e.preventDefault(); }
        else if (mode === 'draw') run(() => { const v = graphValue(e), next = insertDraftPoint(draft, v.ms, v.deci, kind.value as StepKind); selected = draftTimeline(next).findIndex(r => r.endMs === v.ms && r.kind !== 'end'); commit(next); });
    };
    function pinDragTooltip() {
        if (!drag) return;
        const points = chart.data.datasets[0].data as unknown as { phase: number }[];
        let index = points.length - 1; while (index >= 0 && points[index].phase !== drag.index) index--;
        if (index < 0) return;
        const dot = chart.getDatasetMeta(0).data[index];
        chart.tooltip?.setActiveElements([{ datasetIndex: 0, index }], { x: dot.x, y: dot.y }); chart.draw();
    }
    let dragFrame = 0, latestPointer: PointerEvent | null = null;
    function updateDrag() {
        dragFrame = 0; const e = latestPointer; latestPointer = null;
        if (!drag || !e) return;
        const p = coordinates(e), a = chart.chartArea;
        if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < 3) return;
        drag.moved = true;
        try {
            // Scala immobile: conversione assoluta, senza accumulare scarti al cambio di vista.
            const x = Math.max(a.left, Math.min(a.right, p.x)), y = Math.max(a.top, Math.min(a.bottom, p.y));
            const timeStep = Number(timeSnap.value), tempStep = Number(tempSnap.value);
            const ms = Math.min(Math.floor(chart.scales.x.max * 3600000 / timeStep) * timeStep, Math.max(Math.ceil(chart.scales.x.min * 3600000 / timeStep) * timeStep, Math.round(chart.scales.x.getValueForPixel(x)! * 3600000 / timeStep) * timeStep));
            const deci = Math.min(Math.floor(chart.scales.y.max * 10 / tempStep) * tempStep, Math.max(Math.ceil(chart.scales.y.min * 10 / tempStep) * tempStep, Math.round(chart.scales.y.getValueForPixel(y)! * 10 / tempStep) * tempStep));
            drag.candidate = moveDraftPoint(drag.before, drag.index, ms, deci); drag.valid = true;
            renderGraph(drag.candidate, true); renderMetrics(drag.candidate);
            // Aggiorna i campi esistenti: niente ricostruzioni della tabella durante il drag.
            for (const r of draftTimeline(drag.candidate)) {
                const row = tbody.rows[r.index];
                (row.querySelector('[data-field=target]') as HTMLInputElement).value = numberText(r.targetDeciC);
                (row.querySelector('[data-field=duration]') as HTMLInputElement).value = timed(r.kind) ? inputDuration(r.durationMs) : '\u2014';
                row.querySelector('.program-editor-time')!.textContent = r.timeKnown ? formatDuration(r.startMs) + ' \u2192 ' + formatDuration(r.endMs) : 'Tempo variabile';
            }
            if (review.open) renderReview(drag.candidate);
            pinDragTooltip();
            error.textContent = '';
        } catch (err) { drag.valid = false; error.textContent = (err as Error).message; }
    }
    const pointerMove = (e: PointerEvent) => { if (!drag || drag.pointer !== e.pointerId) return; latestPointer = e; if (!dragFrame) dragFrame = requestAnimationFrame(updateDrag); };
    function finishDrag(cancel: boolean) {
        if (!drag) return;
        if (dragFrame) { cancelAnimationFrame(dragFrame); dragFrame = 0; }
        if (!cancel) updateDrag(); latestPointer = null;
        const current = drag; drag = null; chart.options.events = ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove']; chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
        if (canvas.hasPointerCapture(current.pointer)) canvas.releasePointerCapture(current.pointer);
        if (!cancel && current.moved && current.valid) run(() => commit(current.candidate, true));
        else { render(true); if (!current.valid) error.textContent = 'Spostamento annullato: punto finale non valido.'; }
        updateMode();
    }
    function zoomBounds(value: ProgramDraft) {
        const profile = buildDraftProfile(value);
        return { x: Math.max(8 / 3600000, profile.shownMs / 3600000 * 1.03), y: Math.max(.8, ...profile.points.map(p => p.y * 1.03)) };
    }
    function wheelZoom(e: WheelEvent) {
        if (drag) { e.preventDefault(); return; }
        if (pending || !e.deltaY) return;
        const r = canvas.getBoundingClientRect(), px = (e.clientX - r.left) * chart.width / r.width, py = (e.clientY - r.top) * chart.height / r.height, a = chart.chartArea;
        if (px < a.left || px > a.right || py < a.top || py > a.bottom) return;
        e.preventDefault(); const axis = e.shiftKey ? 'y' : 'x', scale = chart.scales[axis];
        const span = scale.max - scale.min, delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? a.height : 1);
        const bounds = zoomBounds(draft);
        const sizes = axisSteps(axis).map(n => n * 8);
        const nextSpan = delta > 0 ? sizes.find(n => n > span + .000001) ?? span : [...sizes].reverse().find(n => n < span - .000001 && n >= bounds[axis]) ?? span;
        setAxis(axis, 0, nextSpan, true); viewLocked = true; renderGraph(draft, true);
    }
    const pointerUp = (e: PointerEvent) => { if (drag?.pointer === e.pointerId) finishDrag(false); }, pointerCancel = () => finishDrag(true);
    const keyDown = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag) { e.preventDefault(); e.stopPropagation(); finishDrag(true); return; } if (pending || selected < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); const r = draftTimeline(draft)[selected], multiplier = e.shiftKey ? 10 : 1; run(() => commit(moveDraftPoint(draft, selected, r.endMs + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) * Number(timeSnap.value) * multiplier, r.targetDeciC + (e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0) * Number(tempSnap.value) * multiplier))); };
    canvas.addEventListener('wheel', wheelZoom, { passive: false }); canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerCancel); canvas.addEventListener('lostpointercapture', pointerCancel); canvas.addEventListener('keydown', keyDown);
    render(); status.textContent = 'Bozza locale · nessun invio al forno';
    return { getDraft: () => cloneDraft(draft), isPending: () => pending, hasSaveError: () => saveFailed, replace: (next: ProgramDraft) => { if (pending) throw Error('Correggere o annullare i valori in corso.'); selected = -1; viewLocked = false; commit(validateDraft(next)); }, dispose: () => { disposed = true; if (dragFrame) cancelAnimationFrame(dragFrame); canvas.removeEventListener('wheel', wheelZoom); tableScroll.removeEventListener('dragover', reorderOver); tableScroll.removeEventListener('drop', reorderDrop); chart.destroy(); root.removeEventListener('input', editInput); root.removeEventListener('change', editChange); root.removeEventListener('keydown', confirmInput); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel); canvas.removeEventListener('lostpointercapture', pointerCancel); canvas.removeEventListener('keydown', keyDown); root.classList.remove('program-editor'); } };
}
