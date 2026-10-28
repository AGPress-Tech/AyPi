import fs from 'fs';
import path from 'path';
import { ProfinetReader } from './engine';
import { PassiveCapture, listInterfaces } from './capture';
const HEADERS = {
    impulsi: ['timestamp_locale','macchina','mac','frame_id','byte_sdu','bit','impulso_sessione','pezzi_sessione','moltiplicatore'],
    transizioni: ['timestamp_locale','mac','frame_id','byte_sdu','bit','prima','dopo'],
    marcatori: ['timestamp_locale','macchina','nota'],
    attivazioni_sirena: ['timestamp_locale','macchina','mac','frame_id','byte_sdu','bit','attivazione_sessione'],
    flussi_scoperti: ['prima_osservazione','mac','frame_id','nodo_noto','ip_noto','origine'],
};
const line = (values: unknown[]) => values.map(value => { const text = value === null || value === undefined ? '' : String(value); return /[;"\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text; }).join(';') + '\r\n';

async function main() {
    const cfg = JSON.parse(process.env.AYPI_PLC_CONFIG || '{}');
    if (cfg.interfaces) { process.send?.({ interfaces: listInterfaces() }); process.disconnect?.(); return; }
    if (!['LIVE', 'DEMO'].includes(cfg.mode)) throw new Error('Modalita collector non valida');
    const config = JSON.parse(fs.readFileSync(cfg.configPath, 'utf8').replace(/^\uFEFF/, ''));
    fs.mkdirSync(cfg.folder, { recursive: true });
    const files = new Map<string, fs.WriteStream>();
    let closing = false, capture: PassiveCapture | null = null, timer: NodeJS.Timeout, publish: NodeJS.Timeout;
    const send = (value: unknown) => { if (process.connected) process.send!(value); };
    const close = async () => {
        if (closing) return; closing = true;
        if (timer) clearInterval(timer); if (publish) clearInterval(publish); capture?.close();
        await Promise.all([...files.values()].map(stream => new Promise<void>(resolve => { if (stream.destroyed) resolve(); else stream.end(resolve); })));
        if (process.connected) process.disconnect();
    };
    const fail = (error: unknown) => { send({ error: String((error as Error).message || error) }); void close(); };
    for (const [name, header] of Object.entries(HEADERS)) {
        const file = path.join(cfg.folder, name + '.csv'), empty = !fs.existsSync(file) || fs.statSync(file).size === 0;
        const stream = fs.createWriteStream(file, { flags: 'a', encoding: 'utf8' });
        stream.on('error', fail); files.set(name, stream); if (empty) stream.write('\uFEFF' + line(header));
    }
    const reader = new ProfinetReader(config, (name, values) => {
        const stream = files.get(name)!;
        if (stream.destroyed || stream.writableLength > 4 * 1024 * 1024) throw new Error('Scrittura CSV troppo lenta: collector arrestato per evitare perdita silenziosa di dati');
        stream.write(line(values));
    });
    const started = Date.now() / 1000;
    const emit = () => send({ mode: cfg.mode, now: Date.now() / 1000, since: started, ...reader.snapshot(), capture: capture?.stats() || null });
    if (cfg.mode === 'LIVE') {
        try { capture = new PassiveCapture(cfg.adapter); }
        catch (error) { fail(error); return; }
        timer = setInterval(() => { try { capture!.drain((raw, ts) => reader.receive(raw, ts)); } catch (error) { fail(error); } }, 5);
    } else {
        const events = new Map([...reader.flows.keys()].map(key => [key, started]));
        timer = setInterval(() => {
            try {
                const now = Date.now() / 1000;
                for (const [key, flow] of reader.flows) {
                    const fid = parseInt(flow.frame_id, 16), period = fid === 0x8004 ? 3.2 : fid === 0x8001 ? 5.6 : fid === 0x8005 ? 4.5 : 8 + fid % 5;
                    let elapsed = now - events.get(key)!;
                    if (elapsed >= period) { events.set(key, now); elapsed = 0; }
                    reader.demoFrame(flow.mac, fid, elapsed >= 0.2 ? 1 : 0, now);
                }
            } catch (error) { fail(error); }
        }, 40);
    }
    publish = setInterval(emit, 1000); emit();
    process.on('message', (message: any) => {
        if (message.kind === 'stop') { emit(); void close(); }
        else if (message.kind === 'marker') { try { reader.marker(message.machine, message.note); } catch (error) { fail(error); } }
    });
    process.once('disconnect', () => { void close(); });
}
void main().catch(error => { process.send?.({ error: String(error.message || error) }); process.exitCode = 1; if (process.connected) process.disconnect(); });
