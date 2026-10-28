/** Decoder e conteggi passivi PN-RT. Non apre socket e non trasmette pacchetti. */
export const CENTRAL_CPU_MAC = 'ac:64:17:f8:9a:70';
const flowKey = (mac: string, fid: number) => `${mac.toLowerCase()}|${fid}`;
const fidText = (fid: number) => `0x${fid.toString(16).toUpperCase().padStart(4, '0')}`;
export function localStamp(ts: number) {
    const d = new Date(ts * 1000), offset = -d.getTimezoneOffset();
    const local = new Date(d.getTime() + offset * 60000).toISOString().slice(0, -1);
    const abs = Math.abs(offset);
    return `${local}${offset < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
export function decode(raw: Buffer) {
    if (raw.length < 22) return null;
    const mac = [...raw.subarray(6, 12)].map(b => b.toString(16).padStart(2, '0')).join(':');
    let pos = 14, ether = raw.readUInt16BE(12);
    while ([0x8100, 0x88a8, 0x9100].includes(ether)) {
        if (raw.length < pos + 4) return null;
        ether = raw.readUInt16BE(pos + 2); pos += 4;
    }
    if (ether !== 0x8892 || raw.length < pos + 6) return null;
    const fid = raw.readUInt16BE(pos); pos += 2;
    if (fid < 0x8000 || fid > 0xbfff) return null;
    return { mac, fid, sdu: raw.subarray(pos, -4), status: raw[raw.length - 2], transfer: raw[raw.length - 1] };
}
export type CsvSink = (file: string, fields: unknown[]) => void;
export class ProfinetReader {
    readonly machines = new Map<string, any>();
    readonly flows = new Map<string, any>();
    readonly signals = new Map<string, any>();
    readonly inventory = new Map<string, any>();
    readonly machineState = new Map<string, any>();
    readonly flowState = new Map<string, any>();
    readonly aux = new Map<string, any>();
    private auxSignals = new Map<string, any[]>();
    private displayNames = new Map<string, string>();
    private bits = new Map<string, any>();
    private events: any[] = [];
    private dynamicFlows = 0;
    private transitionRows = 0;
    droppedDisplayEvents = 0;
    constructor(readonly config: any, private write: CsvSink) {
        for (const flow of config.flussi_et200sp) {
            const key = flowKey(flow.mac, parseInt(flow.frame_id, 16));
            this.flows.set(key, flow); this.flowState.set(key, this.emptyFlow());
        }
        for (const item of [...config.flussi_et200sp, ...(config.dispositivi_profinet_aggiuntivi || [])]) this.inventory.set(item.mac.toLowerCase(), item);
        for (const m of config.macchine) {
            this.machines.set(m.codice, m);
            for (const sig of [...(m.segnale ? [m.segnale] : []), ...(m.segnali_stato || []), ...(m.dispositivo_profinet ? [m.dispositivo_profinet] : [])]) {
                this.displayNames.set(flowKey(sig.mac, parseInt(sig.frame_id, 16)), m.codice);
            }
            this.machineState.set(m.codice, { pulses: 0, pieces: 0, last: null, previous: null, frames: 0, frame_time: null, level: null, hour: [], invalid: 0, gap: false });
            this.aux.set(m.codice, { count: 0, last: null, level: null });
            if (m.segnale) this.signals.set(flowKey(m.segnale.mac, parseInt(m.segnale.frame_id, 16)), m);
            for (const sig of m.segnali_stato || []) {
                const key = flowKey(sig.mac, parseInt(sig.frame_id, 16));
                if (!this.auxSignals.has(key)) this.auxSignals.set(key, []);
                this.auxSignals.get(key)!.push({ code: m.codice, sig });
            }
        }
    }
    private emptyFlow() { return { frames: 0, last: null, previous: null, lastGood: null }; }
    private event(value: any) {
        this.events.push(value);
        if (this.events.length > 4000) { this.events.shift(); this.droppedDisplayEvents++; }
    }
    receive(raw: Buffer, ts = Date.now() / 1000) {
        const p = decode(raw);
        if (!p || p.mac === CENTRAL_CPU_MAC || !Number.isFinite(ts)) return;
        const { mac, fid, sdu, status, transfer } = p, key = flowKey(mac, fid);
        if (!this.flows.has(key)) {
            if (this.dynamicFlows >= 128) return;
            const known = this.inventory.get(mac) || {};
            const desc = { mac, frame_id: fidText(fid), nodo: known.nodo || 'Sconosciuto', ip: known.ip || 'Non determinato', nome_profinet: known.nome_profinet || '' };
            this.flows.set(key, desc); this.flowState.set(key, this.emptyFlow()); this.dynamicFlows++;
            this.write('flussi_scoperti', [localStamp(ts), mac, fidText(fid), desc.nodo, desc.ip, 'osservato_passivamente']);
        }
        const flow = this.flowState.get(key), machine = this.signals.get(key), ms = machine ? this.machineState.get(machine.codice) : null;
        flow.frames++; flow.last = ts;
        const valid = Boolean(status & 4) && transfer === 0;
        if (ms) {
            if (ms.frame_time !== null && ts - ms.frame_time > 5) { ms.level = null; ms.gap = true; }
            ms.frames++; ms.frame_time = ts;
            if (!valid) { ms.invalid++; ms.level = null; }
        }
        const auxSignals = this.auxSignals.get(key) || [];
        if (!valid) {
            flow.previous = null;
            for (const { code } of auxSignals) this.aux.get(code).level = null;
            return;
        }
        const previous: Buffer | null = flow.previous;
        if (previous && previous.length === sdu.length) {
            for (let off = 0; off < Math.min(sdu.length, 128); off++) {
                const mask = previous[off] ^ sdu[off];
                if (!mask) continue;
                for (let bit = 0; bit < 8; bit++) {
                    if (!(mask & (1 << bit))) continue;
                    const bk = `${key}|${off}|${bit}`, rise = Boolean(sdu[off] & (1 << bit));
                    const info = this.bits.get(bk) || { mac, fid: fidText(fid), offset: off, bit, changes: 0, rises: 0, last: null };
                    info.changes++; if (rise) info.rises++; info.last = ts; this.bits.set(bk, info);
                    if (this.transitionRows < 100000) { this.write('transizioni', [localStamp(ts), mac, fidText(fid), off, bit, Number(Boolean(previous[off] & (1 << bit))), Number(rise)]); this.transitionRows++; }
                    const displayMachine = this.findMachine(key) || mac.toUpperCase();
                    this.event({ kind: 'BIT', machine: displayMachine, text: `${fidText(fid)} · byte ${off} · bit ${bit} → ${Number(rise)}`, ts });
                }
            }
        }
        flow.previous = Buffer.from(sdu);
        for (const { code, sig } of auxSignals) {
            if (sdu.length <= sig.byte) continue;
            const aux = this.aux.get(code);
            if (flow.lastGood !== null && ts - flow.lastGood > 5) aux.level = null;
            const level = (sdu[sig.byte] >> sig.bit) & 1;
            if (aux.level === 0 && level === 1) {
                aux.count++; aux.last = ts;
                this.write('attivazioni_sirena', [localStamp(ts), code, mac, fidText(fid), sig.byte, sig.bit, aux.count]);
                this.event({ kind: 'SIRENA', machine: code, text: `Attivazione sirena #${aux.count}`, ts });
            }
            aux.level = level;
        }
        flow.lastGood = ts;
        if (!ms) return;
        const sig = machine.segnale;
        if (sdu.length <= sig.byte) return;
        const level = (sdu[sig.byte] >> sig.bit) & 1;
        if (ms.level === 0 && level === 1) {
            ms.pulses++; ms.pieces += machine.pezzi_per_impulso;
            ms.previous = ms.last; ms.last = ts; ms.hour.push(ts);
            this.write('impulsi', [localStamp(ts), machine.codice, mac, fidText(fid), sig.byte, sig.bit, ms.pulses, ms.pieces, machine.pezzi_per_impulso]);
            this.event({ kind: 'CONTATORE', machine: machine.codice, text: `Impulso #${ms.pulses} · ${ms.pieces} pezzi sessione`, ts });
        }
        ms.level = level;
    }
    private findMachine(key: string) {
        return this.displayNames.get(key) || null;
    }
    marker(machine: string, note: string) {
        const ts = Date.now() / 1000;
        this.write('marcatori', [localStamp(ts), machine, note]); this.event({ kind: 'MARCATORE', machine, text: note, ts });
    }
    snapshot(now = Date.now() / 1000) {
        const machines = [...this.machines.values()].map(m => {
            const s = this.machineState.get(m.codice), aux = this.aux.get(m.codice);
            let trim = 0; while (trim < s.hour.length && s.hour[trim] < now - 3600) trim++; if (trim) s.hour.splice(0, trim);
            return { asset_type: 'machine', code: m.codice, name: m.nome, mapping: m.stato, pulses: s.pulses, pieces: s.pieces,
                hour: s.hour.length * (m.pezzi_per_impulso || 0), last: s.last, cycle: s.last !== null && s.previous !== null ? s.last - s.previous : null,
                frame_time: s.frame_time, frames: s.frames, invalid: s.invalid, gap: s.gap, multiplier: m.pezzi_per_impulso, signal: m.segnale,
                device: m.dispositivo_profinet, siren: aux.count, siren_last: aux.last };
        });
        const flows = [...this.flows.entries()].map(([key, f]) => ({ node: f.nodo, ip: f.ip, mac: f.mac.toUpperCase(), fid: f.frame_id,
            machine: this.findMachine(key) || 'Da identificare', frames: this.flowState.get(key).frames, last: this.flowState.get(key).last }));
        for (const [mac, device] of this.inventory) if (!flows.some(f => f.mac.toLowerCase() === mac)) flows.push({ node: device.nodo, ip: device.ip, mac: mac.toUpperCase(), fid: '—', machine: 'Da identificare', frames: 0, last: null });
        flows.sort((a, b) => Number(a.node === 'Sconosciuto') - Number(b.node === 'Sconosciuto') || String(a.node).localeCompare(String(b.node)) || a.fid.localeCompare(b.fid));
        const bits = [...this.bits.values()].sort((a, b) => b.changes - a.changes || a.mac.localeCompare(b.mac) || a.offset - b.offset || a.bit - b.bit).slice(0, 250).map(b => ({ ...b, mac: b.mac.toUpperCase() }));
        return { machines, flows, bits, events: this.events.splice(0, 2000), droppedDisplayEvents: this.droppedDisplayEvents };
    }
    demoFrame(mac: string, fid: number, level: number, ts: number) {
        const m = this.signals.get(flowKey(mac, fid)), data = Buffer.alloc(40);
        if (m) data[m.segnale.byte] |= level << m.segnale.bit; else data[4] = level << 1;
        const header = Buffer.from('ac6417f89a70' + mac.replace(/:/g, '') + '8892', 'hex'), tail = Buffer.alloc(6);
        tail.writeUInt16BE(fid, 0); tail[4] = 0x35;
        this.receive(Buffer.concat([header, tail.subarray(0, 2), data, tail.subarray(2)]), ts);
    }
}
