import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { readViewSettings, writeViewSettings } from './forno/preferences-store';
import { requestAypiBackend } from './file-manager/backend-client';

let registered = false;
let fornoWindow: BrowserWindow | null = null;

export function setupFornoReader() {
    if (registered) return;
    registered = true;
    const preferencesPath = () => path.join(app.getPath('userData'), 'forno', 'view-settings.json');
    ipcMain.handle('forno-view-settings-load', () => readViewSettings(preferencesPath()));
    ipcMain.handle('forno-view-settings-save', (_event, input) => writeViewSettings(preferencesPath(), input));
    ipcMain.on('open-forno-window', event => {
        const senderUrl = event.sender.getURL();
        if (!senderUrl.startsWith('file:') || !/\/(bluearchive-preview|robot)\.html$/i.test(new URL(senderUrl).pathname)) return;
        if (fornoWindow && !fornoWindow.isDestroyed()) {
            if (fornoWindow.isMinimized()) fornoWindow.restore();
            fornoWindow.maximize();
            fornoWindow.show(); fornoWindow.focus(); return;
        }
        fornoWindow = new BrowserWindow({
            width: 1250, height: 820, minWidth: 900, minHeight: 650,
            icon: path.join(__dirname, '..', 'assets', 'app-icon.png'),
            show: false, autoHideMenuBar: true, title: 'AyPi — Forno', backgroundColor: '#f3f1eb',
            parent: BrowserWindow.fromWebContents(event.sender) || undefined,
            webPreferences: { nodeIntegration: true, contextIsolation: false },
        });
        fornoWindow.setMenu(null);
        fornoWindow.maximize();
        fornoWindow.once('ready-to-show', () => { fornoWindow?.maximize(); fornoWindow?.show(); });
        fornoWindow.on('closed', () => { fornoWindow = null; });
        void fornoWindow.loadFile(path.join(__dirname, '..', 'pages', 'forno.html'), { query: { standalone: '1' } });
    });
    ipcMain.handle('forno-status', () => requestAypiBackend('/api/forno/status', { timeoutMs: 18000 }));
    ipcMain.handle('forno-history', (_event, input: Record<string, number>) => {
        const query = new URLSearchParams();
        for (const key of ['fromMs', 'toMs', 'intervalMs', 'maxPoints']) {
            if (!Number.isSafeInteger(input?.[key])) throw new Error('Parametri forno non validi');
            query.set(key, String(input[key]));
        }
        return requestAypiBackend(`/api/forno/history?${query}`, { timeoutMs: 18000 });
    });
}
