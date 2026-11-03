import { cloneDraft, draftFromRecipe, reviewDraft, formatDuration, STEP_LABELS, type StepKind, type ProgramDraft } from '../../../main/modules/forno/program-draft';
import { eventDescription } from './event-labels';
export type TransferApi = (input: { operation: 'context' | 'prepare' | 'execute' | 'reconcile' | 'inspect'; payload?: unknown }) => Promise<any>;
export function openProgramTransfer(draft: ProgramDraft, api: TransferApi, edit: (copy: ProgramDraft) => void, options: { action?: 'delete'; target?: string } = {}) {
    const dialog = document.createElement('dialog'); dialog.className = 'compact-dialog program-transfer-dialog';
    const node = (tag: string, text = '') => { const e = document.createElement(tag); e.textContent = text; return e; };
    const heading = node('h2', 'Programmi sul forno');
    const info = node('p', 'Lascia il forno in Reset sulla schermata del ciclo, con iTools chiuso. La lettura di un altro programma lo carica in Reset. Ogni modifica o eliminazione richiede backup e conferma. L’avvio resta dal pannello: nessun Run viene inviato.');
    const state = node('p', 'Lettura stato e archivio del forno…'), error = node('p'); error.className = 'form-error'; error.setAttribute('role', 'alert');
    const name = document.createElement('input'); name.maxLength = 20; name.value = draft.name; name.setAttribute('aria-label', 'Nome programma sul forno');
    const nameLabel = node('label', 'Nome del nuovo programma sul forno'); nameLabel.append(name);
    const destination = document.createElement('select'); destination.setAttribute('aria-label', 'Tipo di salvataggio sul forno');
    for (const [value, text] of [['new', 'Crea un nuovo programma'], ['replace', 'Sovrascrivi un programma esistente']]) { const o = document.createElement('option'); o.value = value; o.textContent = text; destination.append(o); }
    const destinationLabel = node('label', 'Salvataggio della bozza'); destinationLabel.append(destination);
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Programmi presenti sul forno');
    const targetLabel = node('label', 'Programma esistente da leggere, modificare o eliminare'); targetLabel.append(select);
    const prepared = node('div'), footer = node('div'), result = node('p'); footer.className = 'program-transfer-actions'; result.setAttribute('role', 'status');
    let ticket: any = null, busy = false, alive = true, full = false, initialized = false;
    const snapshots = new Map<string, string>();
    if (draft.source?.deviceToken) snapshots.set(draft.source.name, draft.source.deviceToken);
    const managedDrafts = new Map<string, ProgramDraft>(), buttons: HTMLButtonElement[] = [];
    const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'button secondary'; b.textContent = label; b.onclick = action; buttons.push(b); return b; };
    const close = button('Chiudi', () => { if (!busy) dialog.close(); });
    const confirm = button('Conferma operazione sul forno', () => void execute()); confirm.classList.add('primary'); confirm.hidden = true;
    const recover = button('Verifica tentativo interrotto', () => void action(async () => { invalidate(); const data = await api({ operation: 'reconcile' }); if (alive) { result.textContent = data.message; await context(); } })); recover.hidden = true;
    function invalidate() { ticket = null; confirm.hidden = true; prepared.replaceChildren(); }
    function updateDestination() { destinationLabel.hidden = !full; nameLabel.hidden = full && destination.value === 'replace'; }
    name.oninput = invalidate; select.onchange = invalidate; destination.onchange = () => { invalidate(); updateDestination(); };
    async function action(run: () => Promise<void>) {
        if (busy) return; busy = true; for (const b of buttons) b.disabled = true; name.disabled = select.disabled = destination.disabled = true; error.textContent = '';
        try { await run(); } catch (e) { if (alive) { invalidate(); const message = String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': Error: /, '').replace(/^Backend POST .*?failed \(\d+\): /, ''); error.textContent = message.includes('(404)') ? 'Aggiornare il backend sul server per gestire i programmi.' : message; result.textContent = ''; } }
        finally { busy = false; if (alive) { for (const b of buttons) b.disabled = false; name.disabled = select.disabled = destination.disabled = false; } }
    }
    async function context() {
        const data = await api({ operation: 'context' }); if (!alive) return;
        full = data.mode === 'manage'; heading.textContent = full ? 'Gestione programmi sul forno' : 'Programmi di prova sul forno';
        state.textContent = `Programma caricato: ${data.current.name || 'nessuno'} · Reset · ${data.programs.length} file memorizzati. ${data.enabled ? (full ? 'Gestione completa abilitata.' : 'Collaudo TEST_ abilitato.') : 'Trasferimenti disabilitati sul backend.'}`;
        recover.hidden = !data.pending; if (data.pending) state.textContent += ' Operazione precedente da verificare: ' + data.pending.backup + (data.pending.lastError ? ' - ' + data.pending.lastError : '');
        const previous = select.value; select.replaceChildren(); managedDrafts.clear();
        for (const entry of data.managedPrograms || []) managedDrafts.set(entry.name, entry.draft);
        for (const n of (full ? data.programs : data.managed.filter((n: string) => data.programs.includes(n)))) { const o = document.createElement('option'); o.value = o.textContent = n; select.append(o); }
        select.value = [previous, options.target, draft.source?.name, draft.name].find(n => n && data.programs.includes(n)) || select.options[0]?.value || '';
        if (!initialized) {
            if (full && draft.source?.deviceToken && draft.name === draft.source.name && data.programs.includes(draft.source.name)) destination.value = 'replace';
            if (!full && !/^TEST_/.test(name.value)) name.value = 'TEST_' + name.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 15);
            initialized = true;
        }
        updateDestination();
    }
    async function reference(target: string) {
        if (!snapshots.has(target)) { result.textContent = 'Lettura della destinazione in Reset e backup della copia caricata…'; const recipe = await api({ operation: 'inspect', payload: { name: target } }); snapshots.set(target, recipe.editToken); }
        return snapshots.get(target);
    }
    async function prepare(actionName: string) {
        await action(async () => {
            invalidate(); let payload: any = { action: actionName, name: select.value };
            if (actionName === 'upload') {
                const copy = cloneDraft(draft), overwrite = full && destination.value === 'replace'; copy.name = overwrite ? select.value : name.value; reviewDraft(copy);
                payload = { action: actionName, draft: copy, ...(full ? { overwrite, ...(overwrite ? { expectedSnapshot: await reference(copy.name) } : {}) } : {}) };
            } else { if (!select.value) throw Error('Nessun programma disponibile sul forno.'); if (full) payload.expectedSnapshot = await reference(select.value); }
            const data = await api({ operation: 'prepare', payload }); if (!alive) return; ticket = data;
            const title = data.action === 'upload' ? (data.exists ? 'SOVRASCRITTURA' : 'Nuovo programma') : data.action === 'delete' ? 'ELIMINAZIONE' : 'Caricamento';
            prepared.replaceChildren(node('h3', `${title}: ${data.name}`), node('p', data.message), node('p', `Limiti letti dai loop: ${data.limits.min} - ${data.limits.max} °C · backup sul server prima della modifica.`));
            const pre = node('pre');
            pre.textContent = data.program ? data.program.steps.map((s: any, i: number) => `${i + 1}. ${s.label || i + 1} · ${STEP_LABELS[s.kind as StepKind]} · ${s.targetDeciC / 10} °C · ${formatDuration(s.durationMs).split('.')[0]} · ${s.events.map((on: boolean, e: number) => eventDescription(e) + ' ' + (on ? 'ON' : 'OFF')).join('; ')} · Valore utente CH1 ${s.userValueDeci / 10}${s.kind === 'end' ? ' · ' + s.endAction : ''}${s.kind === 'goback' ? ' · torna a ' + s.goBackTo + ' / ' + s.cycles + ' ripetizioni' : ''}${s.kind === 'wait' ? ' · ingresso ' + s.waitFor + ' criterio ' + s.waitCondition + ' soglia ' + s.waitValueDeci / 10 : ''}`).join('\n') : (data.recipe?.segments || []).map((s: any) => `${s.number}. ${s.name} · ${['Fine', 'Rampa', 'Stasi', 'Step', 'Attesa', 'GoBack'][s.type]}`).join('\n');
            prepared.append(pre); confirm.textContent = full && (data.exists || data.action === 'delete') ? `Conferma ${data.action === 'delete' ? 'eliminazione' : 'sovrascrittura'} di ${data.name}` : 'Conferma operazione sul forno'; confirm.hidden = false;
            result.textContent = 'Verifica valida per tre minuti. Non usare il pannello o iTools durante il trasferimento.';
        });
    }
    async function execute() {
        await action(async () => {
            const selected = ticket; if (!selected) throw Error('Preparare nuovamente l’operazione.'); ticket = null; confirm.hidden = true;
            result.textContent = 'Operazione in corso: backup, trasferimento e rilettura. Attendere senza usare pannello o iTools.';
            const receipt = await api({ operation: 'execute', payload: { token: selected.token } }); if (!alive) return;
            if(full)snapshots.set(selected.name,'riaprire-programma');else snapshots.delete(selected.name); if(selected.action==='delete')destination.value='new'; result.textContent = receipt.message + ' Backup: ' + (receipt.localBackupPath || receipt.backup); prepared.replaceChildren(); await context();
            window.dispatchEvent(new CustomEvent('forno-programs-changed'));
        });
    }
    const open = button('Apri programma nell’editor', () => void action(async () => {
        if (!select.value) throw Error('Selezionare un programma.');
        const copy = full ? draftFromRecipe(await api({ operation: 'inspect', payload: { name: select.value } })) : managedDrafts.get(select.value);
        if (!copy) throw Error('Nessuna bozza verificata disponibile.'); dialog.close(); edit(cloneDraft(copy));
    }));
    const load = button('Carica programma in Reset', () => full ? void action(async () => { invalidate(); const recipe = await api({ operation: 'inspect', payload: { name: select.value } }); snapshots.set(select.value, recipe.editToken); result.textContent = recipe.name + ' caricato e letto in Reset. Nessun Run.'; await context(); }) : void prepare('load'));
    dialog.append(heading, info, state, recover, destinationLabel, nameLabel, button('Prepara invio della bozza', () => void prepare('upload')), node('h3', 'Programmi già presenti sul forno'), targetLabel, open, load, button('Prepara eliminazione programma', () => void prepare('delete')), prepared, error, result, footer); footer.append(confirm, close);
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); }); dialog.addEventListener('close', () => { alive = false; dialog.remove(); }, { once: true }); document.body.append(dialog); dialog.showModal();
    void action(async () => { await context(); }).then(()=>{if(alive&&initialized&&options.action==='delete')void prepare('delete');});
}
