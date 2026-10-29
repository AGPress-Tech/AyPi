import fs from 'fs';
import { fileURLToPath } from 'url';

const { ipcRenderer } = require('electron');
let cachedHtml: string | undefined;

/** Carica il frammento HTML locale condiviso e collega il pulsante di ingresso. */
export function mountForgeLanding(root: HTMLElement, theme: 'standard' | 'bluearchive') {
    if (cachedHtml === undefined) {
        const file = new URL('partials/forge-landing.html', document.baseURI);
        cachedHtml = fs.readFileSync(fileURLToPath(file), 'utf8');
    }

    root.innerHTML = cachedHtml;
    root.querySelector('#open-forge')?.addEventListener('click', () => {
        ipcRenderer.send('open-forge-window', { theme });
    });
}
