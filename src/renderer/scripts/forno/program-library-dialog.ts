import { eventLabel } from './event-labels';
import type { LibraryEntry, LibraryView } from '../../../main/modules/forno/program-library';
import type { ProgramDraft } from '../../../main/modules/forno/program-draft';

export type ProgramLibraryApi = {
    list: () => Promise<LibraryView>;
    importFiles: () => Promise<LibraryView | null>;
    archive: (draft: ProgramDraft, sourceId?: string) => Promise<LibraryView>;
    backup: (ids?: string[]) => Promise<{ path: string; count: number; originals: number } | null>;
    delete: (ids: string[], revision: number, deleted: boolean) => Promise<LibraryView>;
    restoreFiles: (ids: string[], originalsOnly: boolean) => Promise<{ path: string; count: number } | null>;
};
export function createProgramLibraryDialog(root: HTMLElement, api: ProgramLibraryApi, edit: (entry: LibraryEntry) => void) {
    let data: LibraryView | null = null, selection = new Set<string>(), busy = false, disposed = false;
    const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', css = '') => { const e = document.createElement(tag); e.textContent = text; e.className = css; return e; };
    const button = (label: string, action: () => void) => { const b = node('button', label, 'button secondary'); b.type = 'button'; b.addEventListener('click', action); return b; };
    const toolbar = node('div', '', 'program-editor-toolbar'), list = node('div', '', 'program-library-list');
    const status = node('p', '', 'settings-note'); status.setAttribute('role', 'status');
    const error = node('p', '', 'form-error'); error.setAttribute('role', 'alert');
    const snapshots = node('p', '', 'settings-note');
    const showDeleted = document.createElement('input'); showDeleted.type = 'checkbox'; const deletedLabel = node('label', 'Mostra anche eliminati dal PC'); deletedLabel.prepend(showDeleted);
    const all = document.createElement('input'); all.type = 'checkbox'; const allLabel = node('label', 'Seleziona tutti i programmi visibili'); allLabel.prepend(all);
    const importButton = button('Importa 1 o più programmi…', () => void operate(async () => { const state = await api.importFiles(); if (state) { data = state; selection.clear(); status.textContent = 'Importazione locale completata. Nessun invio al forno.'; } }));
    const backup = button('Backup selezionati…', () => void operate(async () => { const result = await api.backup(Array.from(selection)); if (result) status.textContent = `Backup verificato: ${result.count} programmi, ${result.originals} con originale nativo · ${result.path}`; }));
    const backupAll = button('Backup completo…', () => void operate(async () => { const result = await api.backup(); if (result) status.textContent = `Backup completo verificato: ${result.count} programmi · ${result.path}`; }));
    const originals = button('Prepara ripristino degli originali…', () => void operate(async () => { const result = await api.restoreFiles(Array.from(selection), true); if (result) status.textContent = `${result.count} file .uipz originali verificati in ${result.path}. Ripristino su forno ancora da collaudare; nessun invio eseguito.`; }));
    const generated = button('Esporta versioni locali .uipz…', () => void operate(async () => { const result = await api.restoreFiles(Array.from(selection), false); if (result) status.textContent = `${result.count} file generati e riletti in ${result.path}. Da verificare in iTools e collaudare sul forno; nessun invio eseguito.`; }));
    const remove = button('Elimina selezionati solo dal PC', () => void operate(async () => { data = await api.delete(Array.from(selection), data!.revision, true); selection.clear(); status.textContent = 'Programmi spostati fra gli eliminati locali. Gli originali e il forno sono conservati; è possibile recuperarli.'; }));
    const restore = button('Recupera eliminati locali', () => void operate(async () => { data = await api.delete(Array.from(selection), data!.revision, false); selection.clear(); status.textContent = 'Programmi recuperati nell’archivio locale.'; }));
    const reload = button('Aggiorna archivio locale', () => void refresh());
    const send = button('Invio al forno bloccato', () => {}); send.disabled = true; send.title = 'Nessuna scrittura consentita fino al backup e al collaudo del ripristino.';
    toolbar.append(importButton, backup, backupAll, originals, generated, remove, restore, reload, send);
    root.replaceChildren(node('p', 'ARCHIVIO LOCALE · Creazione, modifica, importazione ed eliminazione non cambiano i programmi sul nanodac. Il backup conserva i file nativi originali e, se importato, il clone iTools completo.', 'program-editor-notice'), toolbar, node('p', 'Per il primo backup importare il clone .uic già esportato da iTools oppure i file .uipz originali. Il solo elenco dei nomi letto dal forno non contiene le ricette. I backup AyPi usano .aypi-forno-backup.json e possono contenere più programmi.', 'settings-note'), snapshots, allLabel, deletedLabel, list, error, status);
    root.classList.add('program-library');
    function render() {
        if (!data || disposed) return; list.replaceChildren();
        snapshots.textContent = data.sourceSnapshots.length ? 'Snapshot sorgenti (non una nuova lettura del forno): ' + data.sourceSnapshots.map(s => `${s.filename} · data file ${new Date(s.capturedAtMs).toLocaleString('it-IT')}`).join(' · ') : 'Archivio di copie locali: nessuna attestazione dello stato attuale del forno.';
        const entries = data.entries.filter(e => showDeleted.checked || !e.deletedAtMs), visible = new Set(entries.map(e => e.id)); selection = new Set(Array.from(selection).filter(id => visible.has(id)));
        for (const entry of entries) {
            const row = node('div', '', 'program-library-row'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selection.has(entry.id); checkbox.setAttribute('aria-label', 'Seleziona ' + entry.name);
            checkbox.addEventListener('change', () => { if (checkbox.checked) selection.add(entry.id); else selection.delete(entry.id); updateButtons(); });
            const body = node('div'); body.append(node('strong', entry.name), node('small', entry.originalStatus), node('small', (entry.deletedAtMs ? 'Eliminato soltanto dal PC · ' : '') + 'Importato: ' + new Date(entry.importedAtMs).toLocaleString('it-IT')));
            if (entry.draft) { const description = entry.draft.steps.map((s, i) => `${i + 1}: ${s.kind === 'ramp' ? 'Rampa' : 'Stasi'}, ${s.events.map((on, e) => `${eventLabel(e)} ${on ? '✓' : '✕'}`).join(' ')}`).join(' · '); body.append(node('small', description)); }
            else body.append(node('small', 'Formato non editabile: originale conservato integralmente per backup/esportazione.'));
            const open = button('Apri copia nel programmatore', () => { if (!busy) edit(entry); }); open.disabled = busy || !entry.draft || !!entry.deletedAtMs;
            row.append(checkbox, body, open); row.dataset.id = entry.id; list.append(row);
        }
        if (!entries.length) list.append(node('p', 'Nessun programma locale. Importa un clone, un backup o uno o più file nativi.', 'settings-note'));
        all.checked = !!entries.length && entries.every(e => selection.has(e.id)); updateButtons();
    }
    function updateButtons() {
        const picked = data?.entries.filter(e => selection.has(e.id)) || [];
        for (const b of [importButton, backup, backupAll, originals, generated, remove, restore, reload]) b.disabled = busy;
        backup.disabled ||= !picked.length; originals.disabled ||= !picked.length || picked.some(e => !e.original); generated.disabled ||= !picked.length || picked.some(e => !e.draft);
        remove.disabled ||= !picked.length || picked.some(e => !!e.deletedAtMs); restore.disabled ||= !picked.length || picked.some(e => !e.deletedAtMs); backupAll.disabled ||= !data?.entries.length;
    }
    async function operate(action: () => Promise<void>) { if (busy || disposed) return; busy = true; updateButtons(); error.textContent = ''; try { await action(); } catch (e) { if (!disposed) error.textContent = (e as Error).message; } finally { busy = false; render(); } }
    async function refresh() { await operate(async () => { data = await api.list(); }); }
    all.addEventListener('change', () => { for (const e of data?.entries || []) if (showDeleted.checked || !e.deletedAtMs) { if (all.checked) selection.add(e.id); else selection.delete(e.id); } render(); }); showDeleted.addEventListener('change', () => render());
    return { refresh, dispose: () => { disposed = true; } };
}
