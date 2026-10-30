import { createRecipeChart } from './recipe-chart';
import type { ProgramRecipe } from './recipe-profile';
type StoredPrograms = { programs: string[]; readAtMs: number; scope?: 'stored' | 'current'; mode?: number };
type PreviewResponse = ProgramRecipe | { needsTemporaryLoad: true; currentProgram: string };

export function setupProgramsDialog(request: () => Promise<StoredPrograms>, preview: (input: { name: string; allowTemporaryLoad?: boolean; expectedCurrentProgram?: string }) => Promise<PreviewResponse>) {
    const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const dialog = element<HTMLDialogElement>('programs-dialog');
    const menu = element('programs-menu'), results = element('programs-results');
    const status = element('programs-status'), error = element('programs-error');
    const list = element('programs-list'), readTime = element('programs-read-time');
    const back = element<HTMLButtonElement>('programs-back'), refresh = element<HTMLButtonElement>('programs-refresh');
    const detail = element('programs-detail'), content = element('recipe-content');
    let view: 'menu' | 'list' | 'detail' = 'menu';
    let disposeChart: (() => void) | null = null;
    let chosen = '';
    let listTitle = 'Cicli memorizzati';
    let generation = 0;
    const clearChart = () => { disposeChart?.(); disposeChart = null; };
    const message = (failure: unknown) => {
        const text = failure instanceof Error ? failure.message : '';
        return text.includes('(404)') ? 'Aggiornare il backend sul server per consultare i cicli.' : (text.replace(/^Error invoking remote method '[^']+': Error: /, '').replace(/^Backend POST .*?failed \(\d+\): /, '') || 'Impossibile leggere i cicli. Verificare il collegamento e riprovare.');
    };
    const showMenu = () => {
        generation++; clearChart(); view = 'menu'; detail.hidden = true; dialog.classList.remove('program-detail');
        menu.hidden = false; results.hidden = true; back.hidden = true; refresh.hidden = true;
        element('programs-title').textContent = 'Cicli forno';
    };
    const load = async () => {
        const current = ++generation;
        clearChart(); view = 'list'; detail.hidden = true; dialog.classList.remove('program-detail');
        menu.hidden = true; results.hidden = false; back.hidden = false; refresh.hidden = false;
        element('programs-title').textContent = 'Cicli memorizzati';
        refresh.disabled = true; results.setAttribute('aria-busy', 'true');
        list.replaceChildren(); readTime.textContent = ''; error.textContent = ''; error.hidden = true;
        status.textContent = 'Lettura dei cicli dal nanodac…';
        try {
            const data = await request();
            if (generation !== current || !dialog.open) return;
            if (!Array.isArray(data?.programs) || data.programs.length > 100 || data.programs.some(name => typeof name !== 'string') || !Number.isSafeInteger(data.readAtMs)) throw new Error('Elenco cicli ricevuto non valido.');
            for (const name of data.programs) {
                const item = document.createElement('li'), button = document.createElement('button');
                button.type = 'button'; button.className = 'stored-program-button';
                const label = document.createElement('span'); label.className = 'stored-program-name'; label.textContent = name;
                const arrow = document.createElement('span'); arrow.className = 'stored-program-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
                button.append(label, arrow); button.setAttribute('aria-label', 'Visualizza programmazione di ' + name);
                button.addEventListener('click', () => void openRecipe(name)); item.append(button); list.append(item);
            }
            listTitle = data.scope === 'current' ? (data.mode === 4 ? 'Ciclo in pausa' : 'Ciclo in lavorazione') : 'Cicli memorizzati';
            element('programs-title').textContent = listTitle;
            status.textContent = data.scope === 'current'
                ? 'Seleziona il ciclo caricato per visualizzarne il grafico. L’archivio completo è consultabile a forno fermo, in Reset.'
                : data.programs.length ? `${data.programs.length} ${data.programs.length === 1 ? 'ciclo memorizzato' : 'cicli memorizzati'}` : 'Nessun ciclo memorizzato nel nanodac.';
            readTime.textContent = 'Ultima lettura: ' + new Date(data.readAtMs).toLocaleString('it-IT');
        } catch (failure) {
            if (generation !== current || !dialog.open) return;
            status.textContent = 'Lettura non riuscita.';
            error.textContent = message(failure);
            error.hidden = false;
        } finally {
            if (generation === current) { refresh.disabled = false; results.setAttribute('aria-busy', 'false'); }
        }
    };
    async function openRecipe(name: string, allowTemporaryLoad = false, expectedCurrentProgram?: string) {
        const current = ++generation; clearChart(); view = 'detail'; chosen = name;
        menu.hidden = true; results.hidden = true; detail.hidden = false; back.hidden = false; refresh.hidden = true;
        dialog.classList.add('program-detail'); element('programs-title').textContent = 'Programmazione del ciclo';
        element('recipe-name').textContent = name;
        content.replaceChildren(); content.setAttribute('aria-busy', 'true');
        const loading = document.createElement('p'); loading.className = 'recipe-loading'; loading.setAttribute('role', 'status');
        loading.textContent = allowTemporaryLoad ? 'Lettura delle fasi e ripristino del programma iniziale…' : 'Lettura della programmazione dal nanodac…'; content.append(loading);
        try {
            const data = await preview({ name, allowTemporaryLoad, expectedCurrentProgram });
            if (current !== generation || !dialog.open) return;
            content.replaceChildren();
            if ('needsTemporaryLoad' in data) {
                const box = document.createElement('div'); box.className = 'recipe-read-confirm';
                const title = document.createElement('h3'); title.textContent = 'Leggere questo ciclo a forno fermo';
                const text = document.createElement('p'); text.textContent = `Per leggere le fasi, il nanodac deve caricare temporaneamente questo ciclo. Al termine sarà ripristinato “${data.currentProgram}”. Il riscaldamento non viene avviato. Procedere solo se nessuno sta usando il pannello del forno.`;
                const button = document.createElement('button'); button.type = 'button'; button.className = 'button primary'; button.textContent = 'Leggi e ripristina';
                button.addEventListener('click', () => void openRecipe(name, true, data.currentProgram)); box.append(title, text, button); content.append(box);
                return;
            }
            if (data.name !== name) throw new Error('La ricetta ricevuta non corrisponde al ciclo selezionato.');
            disposeChart = createRecipeChart(content, data);
        } catch (failure) {
            if (current !== generation || !dialog.open) return;
            content.replaceChildren();
            const notice = document.createElement('p'); notice.className = 'form-error'; notice.setAttribute('role', 'alert'); notice.textContent = message(failure);
            const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'button secondary'; retry.textContent = 'Riprova'; retry.addEventListener('click', () => void openRecipe(name)); content.append(notice, retry);
        } finally { if (current === generation) content.setAttribute('aria-busy', 'false'); }
    }
    element('open-programs').addEventListener('click', () => { showMenu(); dialog.showModal(); });
    element('list-programs').addEventListener('click', () => void load());
    refresh.addEventListener('click', () => void load());
    back.addEventListener('click', () => {
        if (view === 'detail') {
            generation++; clearChart(); view = 'list'; detail.hidden = true; results.hidden = false; refresh.hidden = false;
            dialog.classList.remove('program-detail'); element('programs-title').textContent = listTitle;
            Array.from(list.querySelectorAll<HTMLButtonElement>('button')).find(b => b.querySelector('.stored-program-name')?.textContent === chosen)?.focus();
        } else { showMenu(); element('list-programs').focus(); }
    });
    dialog.addEventListener('close', () => { generation++; clearChart(); });
}
