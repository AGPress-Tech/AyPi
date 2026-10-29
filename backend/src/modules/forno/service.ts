import path from 'path';
import { fork, ChildProcess, ForkOptions } from 'child_process';
import { getFornoConfig } from './config';
import { HttpError } from '../../shared/http/errors';
import { logger } from '../../shared/logging/logger';

let child: ChildProcess | null = null;
let sequence = 0;
let ready = false;
let stopping = false;
let lastError = '';
let restartTimer: NodeJS.Timeout | null = null;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

function unavailable(message: string) {
    return new HttpError(503, message, { code: 'FORNO_UNAVAILABLE' });
}

export function fornoRequest(command: string, parameters: Record<string, unknown> = {}): Promise<any> {
    if (!child || !ready) return Promise.reject(unavailable(lastError || 'Acquisizione forno non attiva'));
    if (pending.size >= 8) return Promise.reject(new HttpError(429, 'Troppe richieste forno: riprovare tra poco'));
    const target = child;
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(unavailable('Timeout archivio forno'));
        }, 15000);
        pending.set(id, { resolve, reject, timer });
        target.send({ ...parameters, id, command }, error => {
            if (error) {
                clearTimeout(timer);
                pending.delete(id);
                reject(unavailable('Canale archivio forno interrotto'));
            }
        });
    });
}

export async function getFornoStatus() {
    if (!ready) {
        const enabled = getFornoConfig().enabled;
        return { enabled, running: false, error: lastError || (enabled ? 'Acquisizione forno non pronta' : 'Modulo forno disabilitato') };
    }
    return { enabled: true, serverTimeMs: Date.now(), ...await fornoRequest('status') };
}

export async function startFornoService(): Promise<void> {
    if (child) return;
    const config = getFornoConfig();
    if (!config.enabled) return;
    stopping = false;
    const target = fork(path.join(__dirname, 'worker.js'), [], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', AYPI_FORNO_CONFIG: JSON.stringify(config),
            AYPI_FORNO_RESOURCES: (process as any).resourcesPath ? path.join((process as any).resourcesPath, 'backend-resources/forno') : '' },
    } as ForkOptions & { windowsHide: boolean });
    child = target;
    let stderr = '';
    target.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2000); });
    await new Promise<void>((resolve, reject) => {
        let hadReady = false;
        const timer = setTimeout(() => {
            lastError = 'Avvio worker forno scaduto';
            target.kill();
            reject(new Error(lastError));
        }, 10000);
        target.on('message', (message: any) => {
            try {
                if (message.type === 'ready') {
                    clearTimeout(timer);
                    hadReady = true;
                    ready = true;
                    lastError = '';
                    resolve();
                } else if (message.type === 'fatal') {
                    lastError = String(message.error);
                    clearTimeout(timer);
                    reject(new Error(lastError));
                } else {
                    const request = pending.get(message.id);
                    if (!request) return;
                    pending.delete(message.id);
                    clearTimeout(request.timer);
                    if (message.error) request.reject(Object.assign(new Error(String(message.error)),{code:message.errorCode}));
                    else request.resolve(message.result);
                }
            } catch { /* messaggi non JSON non sono dati validi */ }
        });
        target.once('error', error => {
            clearTimeout(timer);
            lastError = `Worker forno non avviabile: ${error.message}`;
            reject(new Error(lastError));
        });
        target.once('close', code => {
            clearTimeout(timer);
            ready = false;
            if (child === target) child = null;
            if (!stopping) lastError = lastError || `Worker forno terminato (${code}): ${stderr}`;
            for (const request of pending.values()) {
                clearTimeout(request.timer);
                request.reject(unavailable(lastError || 'Archivio forno arrestato'));
            }
            pending.clear();
            reject(new Error(lastError || 'Worker forno arrestato'));
            // Nessun retry automatico per errori di configurazione all'avvio.
            // Un crash dopo l'avvio viene recuperato; il periodo scoperto resta esplicito nei timestamp.
            if (!stopping && hadReady && code !== 1) {
                restartTimer = setTimeout(() => {
                    restartTimer = null;
                    void startFornoService().catch(error => logger.error('Forno restart failed', { module: 'core', detail: String(error) }));
                }, 5000);
            }
        });
    });
}

export async function stopFornoService() {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    const target = child;
    if (!target) return;
    const closed = new Promise<void>(resolve => target.once('close', () => resolve()));
    const fallback = setTimeout(() => target.kill(), 6000);
    try {
        if (ready) await fornoRequest('stop');
        else target.kill();
        await closed;
    } finally {
        clearTimeout(fallback);
    }
}
