import { installMobileViewport } from './viewport';
document.documentElement.dataset.platform = 'android';
installMobileViewport();
document.documentElement.dataset.theme = 'blue';
document.documentElement.dataset.touchMode = 'navigate';
let active = true;
Object.defineProperty(document, 'hidden', { configurable: true, get: () => !active });
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => active ? 'visible' : 'hidden' });
(window as any).__aypiSetActive = (value: boolean) => { active = value; document.dispatchEvent(new Event('visibilitychange')); };
const actions = document.createElement('div'); actions.className = 'mobile-touch-actions'; actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', 'Comandi touch del grafico');
for (const [mode, label] of [['navigate', 'Scorri'], ['inspect', 'Leggi'], ['analysis', 'Analizza']]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary'; button.textContent = label; button.dataset.touchMode = mode; button.setAttribute('aria-pressed', String(mode === 'navigate'));
    button.addEventListener('click', () => {
        document.documentElement.dataset.touchMode = mode;
        for (const item of actions.querySelectorAll<HTMLButtonElement>('button[data-touch-mode]')) item.setAttribute('aria-pressed', String(item === button));
        const toggle = document.getElementById('toggle-continuous-tooltip')!;
        if ((toggle.getAttribute('aria-checked') === 'true') !== (mode === 'inspect')) toggle.click();
    });
    actions.append(button);
}
const note = document.createElement('button'); note.type = 'button'; note.className = 'button secondary'; note.textContent = 'Nota';
note.addEventListener('click', () => document.getElementById('chart')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
actions.append(note); document.querySelector('.toolbar')!.append(actions);
document.querySelector('.chart-footer > span')!.textContent = 'Trascina: scorri · Pizzica: zoom · Analizza: seleziona';
const refresh = document.getElementById('refresh-view')!; refresh.textContent = '↻'; refresh.setAttribute('aria-label', 'Aggiorna vista');
const settings = document.getElementById('open-options')!; settings.textContent = '⚙'; settings.setAttribute('aria-label', 'Impostazioni');
