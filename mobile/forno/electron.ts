type Waiter = { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<string, Waiter>();
let sequence = 0;
const api = window as any;
api.__aypiResolve = (id: string, ok: boolean, payload: string) => {
    const request = pending.get(id); if (!request) return;
    pending.delete(id); clearTimeout(request.timer);
    if (!ok) { request.reject(new Error(payload)); return; }
    try { request.resolve(JSON.parse(payload)); } catch { request.reject(new Error('Risposta del forno non valida.')); }
};
export const ipcRenderer = {
    async invoke(channel: string, input: any = {}) {
        if (channel === 'forno-view-settings-load') {
            try { return { settings: JSON.parse(localStorage.getItem('aypi-forno-view') || '{"theme":"blue"}'), path: '' }; }
            catch { return { settings: { theme: 'blue' }, path: '' }; }
        }
        if (channel === 'forno-view-settings-save') { localStorage.setItem('aypi-forno-view', JSON.stringify(input)); return { path: '' }; }
        if (channel === 'forno-live-start') return { started: false, transport: 'http' };
        if (!channel.startsWith('forno-')) throw new Error('Comando non disponibile.');
        if (!api.AyPiForno?.request) throw new Error('Collegamento nativo non disponibile.');
        return new Promise((resolve, reject) => {
            const id = String(++sequence);
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('Il server non risponde. Verificare il collegamento.')); }, 60000);
            pending.set(id, { resolve, reject, timer });
            try { api.AyPiForno.request(id, channel, JSON.stringify(input)); }
            catch { clearTimeout(timer); pending.delete(id); reject(new Error('Collegamento al server non disponibile.')); }
        });
    },
    on(_channel: string, _listener: (...args: any[]) => void) {},
    removeListener(_channel: string, _listener: (...args: any[]) => void) {},
    send(_channel: string) {},
};
window.addEventListener('beforeunload', () => { for (const p of pending.values()) clearTimeout(p.timer); pending.clear(); });
