import Chart from 'chart.js/auto';
import { addStep, changeStart, cloneDraft, draftTimeline, formatDuration, insertDraftPoint, moveDraftPoint, newProgramDraft, parseDeci, parseDuration, removeStep, reviewDraft, validateDraft, type ProgramDraft, type DraftStep } from '../../../main/modules/forno/program-draft';

export type DraftStorage = { load: () => Promise<ProgramDraft | null>; save: (draft: ProgramDraft) => Promise<ProgramDraft>; export: (draft: ProgramDraft) => Promise<{ path: string } | null>; import: () => Promise<ProgramDraft | null>; archive?: (draft: ProgramDraft) => Promise<{ count: number }> };

export function createProgramEditor(root: HTMLElement, initial: ProgramDraft, storage: DraftStorage) {
    let draft = validateDraft(initial), selected = -1, pending = false, mode: 'select' | 'draw' = 'select';
    let history: ProgramDraft[] = [], future: ProgramDraft[] = [], revision = 0, disposed = false;
    let saving: Promise<unknown> = Promise.resolve(), saveFailed = false;
    const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => { const e = document.createElement(tag); e.className = className; e.textContent = text; return e; };
    const button = (text: string, action: () => void, className = 'button secondary') => { const b = node('button', className, text); b.type = 'button'; b.addEventListener('click', action); return b; };
    const field = (text: string, control: HTMLElement) => { const label = node('label', '', text); label.append(control); return label; };
    const input = (label: string, value: string, key: string) => { const i = node('input'); i.type = 'text'; i.value = value; i.dataset.field = key; i.setAttribute('aria-label', label); return i; };
    const select = (label: string, values: [string, string][]) => { const s = node('select'); s.setAttribute('aria-label', label); for (const [value, title] of values) { const o = node('option', '', title); o.value = value; s.append(o); } return s; };
    const numberText = (n: number) => (n / 10).toFixed(1);
    const toolbar = node('div', 'program-editor-toolbar');
    const status = node('p', 'settings-note'); status.setAttribute('role', 'status');
    const error = node('p', 'form-error'); error.setAttribute('role', 'alert');
    const form = node('div', 'program-editor-fields');
    const name = input('Nome del programma', draft.name, 'name'); name.maxLength = 20;
    const start = input('Temperatura iniziale anteprima in °C', numberText(draft.startDeciC), 'start'); start.inputMode = 'decimal';
    const endType = select('Fine programma', [['reset', 'Reset'], ['dwell', 'Mantieni a tempo indeterminato']]);
    const endLabel = input('Nome segmento Fine', draft.endLabel || '', 'endLabel'); endLabel.maxLength = 20;
    form.append(field('Nome programma', name), field('Partenza anteprima [°C]', start), field('Fine programma', endType), field('Nome segmento Fine (vuoto = numero)', endLabel));
    const notice = node('p', 'program-editor-notice', 'BOZZA LOCALE · Nessun invio al forno. La partenza reale dipende dalla configurazione PV/SP. I limiti termici della macchina e i dispositivi collegati a E1–E3 devono ancora essere verificati.');
    const graphControls = node('div', 'program-editor-graph-controls');
    const kind = select('Tipo di fase da disegnare', [['ramp', 'Rampa'], ['dwell', 'Stasi']]);
    const timeSnap = select('Passo tempo nel grafico', [['1000', '1 secondo'], ['10000', '10 secondi'], ['60000', '1 minuto'], ['1', '1 millisecondo']]); timeSnap.value = '60000';
    const tempSnap = select('Passo temperatura nel grafico', [['1', '0,1 °C'], ['10', '1 °C'], ['50', '5 °C'], ['100', '10 °C']]); tempSnap.value = '10';
    const selectMode = button('Seleziona / sposta', () => { mode = 'select'; updateMode(); });
    const drawMode = button('Disegna punti', () => { mode = 'draw'; updateMode(); });
    graphControls.append(selectMode, drawMode, kind, field('Passo tempo', timeSnap), field('Passo °C', tempSnap));
    const graphHelp = node('p', 'settings-note', 'Trascina un punto per cambiare fine fase e temperatura. Le fasi successive mantengono la durata. In “Disegna punti”, un click su una rampa la divide; dopo l’ultimo punto aggiunge una fase. Una sosta si sposta solo nel tempo. Frecce: un passo; Maiusc: dieci passi. Esc annulla il trascinamento.');
    const plot = node('div', 'program-editor-plot'), canvas = node('canvas'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Editor del profilo termico. Selezionare le fasi nella tabella per modifiche precise.'); plot.append(canvas);
    const pointInfo = node('p', 'program-editor-point', 'Aggiungi una rampa o una sosta per iniziare.'); pointInfo.setAttribute('aria-live', 'polite');
    const metrics = node('div', 'program-editor-metrics');
    const actions = node('div', 'program-editor-toolbar');
    const tableScroll = node('div', 'program-editor-table-scroll'), table = node('table', 'program-editor-table');
    const caption = node('caption', '', 'Fasi programmate · tempi HH:MM:SS.mmm · temperatura in °C · eventi indipendenti');
    const thead = node('thead'), header = node('tr');
    for (const title of ['Fase', 'Tipo', 'Nome fase', 'Temperatura finale °C', 'Durata fase', 'Inizio → fine', 'E1', 'E2', 'E3', 'Valore utente CH1', '']) { const th = node('th', '', title); th.scope = 'col'; header.append(th); }
    thead.append(header); const tbody = node('tbody'), tfoot = node('tfoot'); table.append(caption, thead, tbody, tfoot); tableScroll.append(table);
    const pastePanel = node('details', 'program-editor-paste'); pastePanel.append(node('summary', '', 'Incolla righe da Excel'));
    pastePanel.append(node('p', 'settings-note', 'Colonne separate da tabulazioni, senza intestazione: tipo (rampa/stasi), temperatura finale °C, durata HH:MM:SS.mmm, E1, E2, E3 (ON/OFF), valore utente CH1. Le righe si aggiungono in fondo, tutte insieme oppure nessuna.'));
    const pasteText = node('textarea'); pasteText.rows = 3; pasteText.setAttribute('aria-label', 'Righe da Excel');
    const pasteButton = button('Aggiungi righe incollate', () => run(() => {
        const d = cloneDraft(draft), lines = pasteText.value.trim().split(/\r?\n/); if (!pasteText.value.trim()) throw Error('Incollare almeno una riga.');
        for (const [i, line] of lines.entries()) {
            const c = line.split('\t'); if (c.length !== 7) throw Error(`Riga incollata ${i + 1}: servono esattamente 7 colonne.`);
            const k = c[0].trim().toLowerCase(); if (!['rampa', 'ramp', 'stasi', 'sosta', 'hold', 'dwell'].includes(k)) throw Error(`Riga ${i + 1}: scegliere rampa o stasi.`);
            const events = c.slice(3, 6).map(v => { if (!/^(on|off)$/i.test(v.trim())) throw Error(`Riga ${i + 1}: gli eventi devono essere ON oppure OFF.`); return /^on$/i.test(v.trim()); }) as DraftStep['events'];
            d.steps.push({ kind: k === 'rampa' || k === 'ramp' ? 'ramp' : 'dwell', label: '', targetDeciC: parseDeci(c[1]), durationMs: parseDuration(c[2]), events, userValueDeci: parseDeci(c[6]) });
        }
        commit(validateDraft(d)); pasteText.value = '';
    })); pastePanel.append(pasteText, pasteButton);
    const review = node('details', 'program-editor-review'); review.append(node('summary', '', 'Controverifica delle istruzioni generate'));
    const reviewBody = node('div'); review.append(reviewBody);
    const footnote = node('p', 'settings-note', 'Nuove stasi: valore utente proposto 5, modificabile. I valori importati sono conservati, compresi gli zero. “Stasi” è una fase a temperatura costante; Hold automatico è una pausa del programmatore. Valore utente CH1: nel clone analizzato, un valore diverso da zero imposta la tolleranza sotto il setpoint sui sensori CH1/CH2; zero seleziona 1000 °C. Le pause possono prolungare i tempi nominali. E1/E2/E3 restano denominati per numero fino alla verifica sul forno.');
    const newButton = button('Nuova bozza', () => run(() => { selected = -1; commit(newProgramDraft()); }));
    const undo = button('Annulla', () => { if (pending || !history.length) return; future.push(cloneDraft(draft)); draft = history.pop()!; selected = -1; changed(); });
    const redo = button('Ripristina', () => { if (pending || !future.length) return; history.push(cloneDraft(draft)); draft = future.pop()!; selected = -1; changed(); });
    const retrySave = button('Salva bozza sul PC', () => { if (!pending) persist(); });
    const exportButton = button('Esporta bozza…', () => { if (!pending) void external(async () => { const result = await storage.export(cloneDraft(draft)); if (result) status.textContent = 'Bozza esportata: ' + result.path; }); });
    const importButton = button('Apri bozza…', () => { if (!pending) void external(async () => { const before = revision; const loaded = await storage.import(); if (loaded) { if (revision !== before || pending) throw Error('La bozza è cambiata durante l’apertura del file. Riprovare.'); selected = -1; commit(validateDraft(loaded)); } }); });
    const resetInputs = button('Annulla valori in corso', () => { pending = false; error.textContent = ''; render(); });
    const archiveButton = button('Salva versione nell’archivio', () => { if (!pending && storage.archive) void external(async () => { reviewDraft(draft); const result = await storage.archive!(cloneDraft(draft)); status.textContent = `Versione salvata nell’archivio locale (${result.count} programmi). Nessuna modifica al forno.`; }); }); archiveButton.hidden = !storage.archive;
    const verifyButton = button('Verifica programma', () => run(() => { reviewDraft(draft); review.open = true; renderReview(); review.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }), 'button primary');
    toolbar.append(newButton, undo, redo, retrySave, importButton, exportButton, archiveButton, verifyButton, resetInputs);
    const addRamp = button('+ Rampa', () => run(() => { const after = selected >= 0 ? selected : draft.steps.length - 1; const d = addStep(draft, 'ramp', after); selected = after + 1; commit(d); }));
    const addDwell = button('+ Stasi', () => run(() => { const after = selected >= 0 ? selected : draft.steps.length - 1; const d = addStep(draft, 'dwell', after); selected = after + 1; commit(d); }));
    actions.append(addRamp, addDwell, node('span', 'settings-note', 'Aggiunge dopo la fase selezionata; senza selezione, in fondo. Massimo 25 fasi + Fine.'));
    root.replaceChildren(notice, toolbar, form, graphControls, graphHelp, plot, pointInfo, metrics, actions, tableScroll, pastePanel, review, footnote, error, status);
    root.classList.add('program-editor');
    const chart = new Chart(canvas, { type: 'line', data: { datasets: [{ label: 'Setpoint CH1', data: [], borderColor: '#ec8627', backgroundColor: '#ec862713', fill: true, borderWidth: 3, pointRadius: 5, pointHoverRadius: 8, pointBorderWidth: 2, pointBackgroundColor: '#fff', tension: 0, parsing: false }] },
        options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', intersect: true },
            plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => formatDuration(Math.round((items[0]?.parsed.x || 0) * 3600000)), label: ctx => `${ctx.parsed.y.toFixed(1)} °C`, afterBody: items => { const index = items[0]?.dataIndex - 1; const s = draft.steps[index]; return s ? `Fase ${index + 1}: ${s.kind === 'ramp' ? 'Rampa' : 'Stasi'} · ${formatDuration(s.durationMs)}\n${s.events.map((on, i) => `E${i + 1} ${on ? 'ON' : 'OFF'}`).join(' · ')}` : 'Partenza dell’anteprima'; } } } },
            scales: { x: { type: 'linear', min: 0, max: 2, title: { display: true, text: 'Tempo nominale dall’inizio [h]' }, ticks: { maxTicksLimit: 10 } }, y: { min: 0, max: 600, title: { display: true, text: 'Setpoint [°C]' } } } } });
    function updateMode() { selectMode.setAttribute('aria-pressed', String(mode === 'select')); drawMode.setAttribute('aria-pressed', String(mode === 'draw')); canvas.style.cursor = mode === 'draw' ? 'crosshair' : 'grab'; }
    function run(action: () => void) { if (pending) { error.textContent = 'Correggere i valori in corso oppure annullarli prima di proseguire.'; return; } try { action(); error.textContent = ''; } catch (e) { error.textContent = (e as Error).message; } }
    async function external(action: () => Promise<void>) { try { await action(); } catch (e) { if (!disposed) error.textContent = (e as Error).message; } }
    function updateButtons() { for (const b of [newButton, undo, redo, retrySave, exportButton, importButton, archiveButton, verifyButton, addRamp, addDwell, pasteButton]) b.disabled = pending; undo.disabled ||= !history.length; redo.disabled ||= !future.length; addRamp.disabled ||= draft.steps.length >= 25; addDwell.disabled ||= draft.steps.length >= 25; resetInputs.hidden = !pending; review.inert = pending; }
    function persist() {
        const snapshot = cloneDraft(draft), atRevision = revision; status.textContent = 'Salvataggio della bozza su questo PC…';
        saving = saving.catch(() => {}).then(() => storage.save(snapshot)).then(saved => {
            if (JSON.stringify(validateDraft(saved)) !== JSON.stringify(snapshot)) throw Error('La bozza riletta non coincide con quella inviata al salvataggio.');
            if (!disposed && revision === atRevision) { saveFailed = false; if (!pending) status.textContent = 'Bozza salvata e riletta su questo PC · nessun invio al forno'; }
        }).catch(e => { if (!disposed) { saveFailed = true; status.textContent = 'Bozza non salvata: ' + (e as Error).message; } });
    }
    function changed() { revision++; render(); persist(); }
    function commit(next: ProgramDraft) { history.push(cloneDraft(draft)); if (history.length > 100) history.shift(); future = []; draft = validateDraft(next); pending = false; changed(); }
    function renderGraph(value: ProgramDraft, keepScale = false) {
        const rows = draftTimeline(value), points = [{ x: 0, y: value.startDeciC / 10 }, ...rows.map(r => ({ x: r.endMs / 3600000, y: r.targetDeciC / 10 }))];
        chart.data.datasets[0].data = points;
        chart.data.datasets[0].pointRadius = points.map((_, i) => selected >= 0 && i === selected + 1 ? 8 : 5);
        chart.data.datasets[0].pointBackgroundColor = points.map((_, i) => selected >= 0 && i === selected + 1 ? '#3296dc' : '#fff');
        if (!keepScale) {
            chart.options.scales!.x!.max = Math.max(2, (rows[rows.length - 1]?.endMs || 0) / 3600000 * 1.25);
            const min = Math.min(0, ...points.map(p => p.y)), max = Math.max(200, ...points.map(p => p.y));
            chart.options.scales!.y!.min = Math.floor(min / 50) * 50; chart.options.scales!.y!.max = Math.ceil((max + Math.max(50, (max - min) * .15)) / 50) * 50;
        }
        chart.update('none');
        const row = rows[selected]; pointInfo.textContent = row ? `Fase ${selected + 1} · ${row.kind === 'ramp' ? 'Rampa' : 'Stasi'} · fine ${formatDuration(row.endMs)} · ${numberText(row.targetDeciC)} °C · durata ${formatDuration(row.durationMs)}` : 'Seleziona una fase nella tabella o un punto sul grafico.';
    }
    function renderTable(value: ProgramDraft) {
        tbody.replaceChildren();
        tfoot.replaceChildren(); const endRow = node('tr'), endCell = node('td'); endCell.colSpan = 11;
        endCell.textContent = `${String(value.steps.length + 1).padStart(2, '0')} · Fine · nome: ${value.endLabel || String(value.steps.length + 1)} · ${value.endType === 'reset' ? 'Reset: eventi e valori utente dagli stati globali del forno' : 'Stasi indefinita: E1 ✕ OFF · E2 ✕ OFF · E3 ✕ OFF · valore utente 0'}`;
        endRow.append(endCell); tfoot.append(endRow);
        for (const r of draftTimeline(value)) {
            const row = node('tr'); row.dataset.index = String(r.index); row.classList.toggle('selected', r.index === selected);
            const td = (child: HTMLElement) => { const cell = node('td'); cell.append(child); row.append(cell); };
            td(button(String(r.index + 1).padStart(2, '0'), () => run(() => { selected = r.index; renderGraph(draft); renderTable(draft); }), 'program-editor-select'));
            const k = select(`Tipo fase ${r.index + 1}`, [['ramp', 'Rampa'], ['dwell', 'Stasi']]); k.value = r.kind; k.dataset.field = 'kind'; td(k);
            const label = input(`Nome fase ${r.index + 1}`, r.label, 'label'); label.maxLength = 20; label.placeholder = String(r.index + 1); td(label);
            const target = input(`Temperatura finale fase ${r.index + 1}`, numberText(r.targetDeciC), 'target'); target.inputMode = 'decimal'; target.readOnly = r.kind === 'dwell'; td(target);
            const duration = input(`Durata fase ${r.index + 1}`, formatDuration(r.durationMs), 'duration'); td(duration);
            td(node('span', 'program-editor-time', formatDuration(r.startMs) + ' → ' + formatDuration(r.endMs)));
            for (let i = 0; i < 3; i++) { const event = select(`Evento ${i + 1} fase ${r.index + 1}`, [['off', '✕ OFF'], ['on', '✓ ON']]); event.value = r.events[i] ? 'on' : 'off'; event.dataset.field = 'event' + i; event.dataset.state = event.value; td(event); }
            const tolerance = input(`Valore utente CH1 fase ${r.index + 1}`, numberText(r.userValueDeci), 'user'); tolerance.inputMode = 'decimal'; td(tolerance);
            td(button('Elimina', () => run(() => { const next = removeStep(draft, r.index); selected = Math.min(selected, next.steps.length - 1); commit(next); })));
            tbody.append(row);
        }
    }
    function renderReview() {
        reviewBody.replaceChildren();
        try {
            const result = reviewDraft(draft);
            reviewBody.append(node('p', 'settings-note', result.status), node('p', '', `${result.instructions.length} fasi + Fine · durata nominale ${formatDuration(result.durationMs)} · massimo ${numberText(result.maxDeciC)} °C`));
            const pre = node('pre'); pre.textContent = result.instructions.map(s => `${String(s.phase).padStart(2, '0')}  nome=${s.label}  ${s.type}  ${formatDuration(s.fromMs)} → ${formatDuration(s.toMs)}  durata=${s.durationMs} ms  target=${s.targetC} °C  float32=${s.targetFloat32C}  ${s.events.map((on, i) => `E${i + 1}=${on ? 'ON' : 'OFF'}`).join(' ')}  UserVal=${s.userValue}`).join('\n') + '\n' + result.end;
            reviewBody.append(pre, node('p', 'settings-note', 'La differenza tra temperatura decimale e float32 è mostrata esplicitamente. Questa verifica controlla la bozza; il futuro invio richiederà una rilettura indipendente del programma salvato sul nanodac.'));
        } catch (e) { reviewBody.append(node('p', 'settings-note', (e as Error).message)); }
    }
    function render() {
        name.value = draft.name; start.value = numberText(draft.startDeciC); endType.value = draft.endType; endLabel.value = draft.endLabel || ''; endLabel.placeholder = String(draft.steps.length + 1);
        renderGraph(draft); renderTable(draft); renderReview(); updateMode(); updateButtons();
        const rows = draftTimeline(draft); metrics.textContent = `${draft.steps.length} / 25 fasi · durata nominale ${formatDuration(rows[rows.length - 1]?.endMs || 0)} · precisione tabella 0,1 °C / 1 ms${draft.source ? ' · copia di ' + draft.source.name : ''}`;
    }
    function readForm() {
        let d = cloneDraft(draft); d.name = name.value; d.endType = endType.value as ProgramDraft['endType']; if (endLabel.value) d.endLabel = endLabel.value; else delete d.endLabel; d = changeStart(d, parseDeci(start.value));
        let previous = d.startDeciC;
        for (const [index, row] of Array.from(tbody.rows).entries()) {
            const get = (key: string) => (row.querySelector(`[data-field="${key}"]`) as HTMLInputElement | HTMLSelectElement).value;
            const k = get('kind') as DraftStep['kind'];
            const target = k === 'dwell' ? previous : parseDeci(get('target'));
            const entered = parseDeci(get('user')), old = draft.steps[index];
            const userValueDeci = k !== old.kind && entered === (old.kind === 'dwell' ? 50 : 0) ? (k === 'dwell' ? 50 : 0) : entered;
            d.steps[index] = { kind: k, label: get('label'), targetDeciC: target, durationMs: parseDuration(get('duration')), events: [0, 1, 2].map(i => get('event' + i) === 'on') as DraftStep['events'], userValueDeci }; previous = target;
        }
        return validateDraft(d);
    }
    function editInput(event: Event) { if ((event.target as HTMLElement).closest('.program-editor-fields, .program-editor-table')) { pending = true; status.textContent = 'Valori in corso: grafico e verifica mostrano l’ultima versione valida. Confermare il campo con Tab/Invio oppure annullare.'; review.open = false; updateButtons(); } }
    function editChange(event: Event) {
        if (!(event.target as HTMLElement).closest('.program-editor-fields, .program-editor-table')) return;
        try { const next = readForm(); commit(next); error.textContent = ''; } catch (e) { pending = true; updateButtons(); error.textContent = (e as Error).message; }
    }
    function confirmInput(event: KeyboardEvent) { if (event.key === 'Enter' && (event.target as HTMLElement).matches('.program-editor-fields input, .program-editor-table input')) { event.preventDefault(); editChange(event); } }
    root.addEventListener('input', editInput); root.addEventListener('change', editChange);
    root.addEventListener('keydown', confirmInput);
    let drag: { pointer: number; index: number; before: ProgramDraft; candidate: ProgramDraft; moved: boolean; valid: boolean; x: number; y: number } | null = null;
    const coordinates = (event: PointerEvent) => { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left) * chart.width / rect.width, y: (event.clientY - rect.top) * chart.height / rect.height }; };
    const graphValue = (event: PointerEvent) => { const p = coordinates(event); return { ms: Math.round(Math.max(0, chart.scales.x.getValueForPixel(p.x) || 0) * 3600000 / Number(timeSnap.value)) * Number(timeSnap.value), deci: Math.round((chart.scales.y.getValueForPixel(p.y) || 0) * 10 / Number(tempSnap.value)) * Number(tempSnap.value) }; };
    const pointerDown = (event: PointerEvent) => {
        if (pending || event.button !== 0 || drag) return;
        const p = coordinates(event), area = chart.chartArea; if (p.x < area.left || p.x > area.right || p.y < area.top || p.y > area.bottom) return;
        const points = chart.getDatasetMeta(0).data;
        let hit = -1, distance = 14;
        points.forEach((point, i) => { if (i === 0) return; const d = Math.hypot(p.x - point.x, p.y - point.y); if (d < distance) { distance = d; hit = i - 1; } });
        if (hit >= 0) { selected = hit; drag = { pointer: event.pointerId, index: hit, before: cloneDraft(draft), candidate: cloneDraft(draft), moved: false, valid: true, x: p.x, y: p.y }; canvas.setPointerCapture(event.pointerId); canvas.focus(); renderGraph(draft, true); renderTable(draft); event.preventDefault(); }
        else if (mode === 'draw') run(() => { const value = graphValue(event); const next = insertDraftPoint(draft, value.ms, value.deci, kind.value as DraftStep['kind']); selected = draftTimeline(next).findIndex(r => r.endMs === value.ms); commit(next); });
    };
    const pointerMove = (event: PointerEvent) => {
        if (!drag || drag.pointer !== event.pointerId) return;
        const p = coordinates(event); if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) < 3) return;
        drag.moved = true;
        try { const value = graphValue(event); drag.candidate = moveDraftPoint(drag.before, drag.index, value.ms, value.deci); drag.valid = true; renderGraph(drag.candidate, true); renderTable(drag.candidate); error.textContent = ''; }
        catch (e) { drag.valid = false; error.textContent = (e as Error).message; }
    };
    const finishDrag = (cancel: boolean) => { if (!drag) return; const current = drag; drag = null; if (canvas.hasPointerCapture(current.pointer)) canvas.releasePointerCapture(current.pointer); if (!cancel && current.moved && current.valid) run(() => commit(current.candidate)); else { render(); if (!current.valid) error.textContent = 'Spostamento annullato: il punto finale non è valido.'; } };
    const pointerUp = (e: PointerEvent) => { if (drag?.pointer === e.pointerId) finishDrag(false); };
    const pointerCancel = () => finishDrag(true);
    const keyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finishDrag(true); return; }
        if (pending || selected < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const row = draftTimeline(draft)[selected], multiplier = event.shiftKey ? 10 : 1;
        run(() => commit(moveDraftPoint(draft, selected, row.endMs + (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0) * Number(timeSnap.value) * multiplier, row.targetDeciC + (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0) * Number(tempSnap.value) * multiplier)));
    };
    canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerCancel); canvas.addEventListener('lostpointercapture', pointerCancel); canvas.addEventListener('keydown', keyDown);
    render(); status.textContent = 'Bozza locale · nessun invio al forno';
    return { getDraft: () => cloneDraft(draft), isPending: () => pending, hasSaveError: () => saveFailed,
        replace: (next: ProgramDraft) => { if (pending) throw Error('Correggere o annullare i valori in corso.'); selected = -1; commit(validateDraft(next)); },
        dispose: () => { disposed = true; chart.destroy(); root.removeEventListener('input', editInput); root.removeEventListener('change', editChange); root.removeEventListener('keydown', confirmInput); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel); canvas.removeEventListener('lostpointercapture', pointerCancel); canvas.removeEventListener('keydown', keyDown); root.classList.remove('program-editor'); } };
}
