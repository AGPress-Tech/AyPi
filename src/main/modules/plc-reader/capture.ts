/** Accesso passivo a Npcap/libpcap. Nessuna funzione di invio pacchetti esposta. */
import fs from 'fs';
import path from 'path';
const koffi = require('koffi');
let api: any;
function load() {
    if (api) return api;
    const candidates = process.platform === 'win32'
        ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'Npcap', 'wpcap.dll')]
        : process.platform === 'darwin' ? ['/usr/lib/libpcap.A.dylib'] : ['libpcap.so.1', 'libpcap.so'];
    let library: any, lastError: unknown;
    for (const file of candidates) {
        try { if (process.platform === 'win32' && !fs.existsSync(file)) continue; library = koffi.load(file); break; }
        catch (error) { lastError = error; }
    }
    if (!library) throw new Error(`Npcap non disponibile: installare Npcap sul PC collector e verificare i permessi. ${lastError || ''}`);
    const Timeval = koffi.struct('AyPiTimeval', { sec: 'long', usec: 'long' });
    const Header = koffi.struct('AyPiPcapHeader', { ts: Timeval, caplen: 'uint32_t', len: 'uint32_t' });
    const Device = koffi.struct('AyPiPcapDevice', { next: 'void *', name: 'str', description: 'str', addresses: 'void *', flags: 'uint32_t' });
    const Program = koffi.struct('AyPiBpfProgram', { length: 'uint32_t', instructions: 'void *' });
    api = { Header, Device, Program,
        find: library.func('int pcap_findalldevs(_Out_ void **devices, _Out_ char *errbuf)'),
        freeDevices: library.func('void pcap_freealldevs(void *devices)'),
        open: library.func('void *pcap_open_live(const char *device, int snaplen, int promisc, int timeout, _Out_ char *errbuf)'),
        nonblock: library.func('int pcap_setnonblock(void *handle, int value, _Out_ char *errbuf)'),
        next: library.func('int pcap_next_ex(void *handle, _Out_ void **header, _Out_ void **data)'),
        error: library.func('const char *pcap_geterr(void *handle)'), close: library.func('void pcap_close(void *handle)'),
        link: library.func('int pcap_datalink(void *handle)'),
        compile: library.func('int pcap_compile(void *handle, _Out_ AyPiBpfProgram *program, const char *filter, int optimize, uint32_t netmask)'),
        setFilter: library.func('int pcap_setfilter(void *handle, AyPiBpfProgram *program)'),
        freeCode: library.func('void pcap_freecode(AyPiBpfProgram *program)'),
        stats: library.func('int pcap_stats(void *handle, _Out_ void *stats)'),
    };
    return api;
}
const errorText = (buffer: Buffer) => buffer.toString('utf8').split('\0')[0];
export function listInterfaces(): { id: string; name: string }[] {
    const lib = load(), out = [null], err = Buffer.alloc(256);
    if (lib.find(out, err) !== 0) throw new Error(errorText(err) || 'Impossibile elencare le schede Npcap');
    const result = [];
    try {
        let pointer: any = out[0];
        while (pointer && result.length < 1024) {
            const device = koffi.decode(pointer, lib.Device);
            result.push({ id: device.name, name: device.description || device.name }); pointer = device.next;
        }
    } finally { if (out[0]) lib.freeDevices(out[0]); }
    return result;
}
export class PassiveCapture {
    private handle: any;
    private lib: any;
    constructor(iface: string) {
        this.lib = load();
        const err = Buffer.alloc(256);
        this.handle = this.lib.open(iface, 65535, 1, 20, err);
        if (!this.handle) throw new Error(errorText(err) || 'Impossibile aprire la scheda Npcap');
        try {
            if (this.lib.link(this.handle) !== 1) throw new Error('La scheda selezionata non espone frame Ethernet');
            if (this.lib.nonblock(this.handle, 1, err) !== 0) throw new Error(errorText(err));
            const program: any = {};
            const filter = 'not ether src ac:64:17:f8:9a:70 and (ether proto 0x8892 or ether proto 0x8100 or ether proto 0x88a8 or ether proto 0x9100)';
            if (this.lib.compile(this.handle, program, filter, 1, 0xffffffff) !== 0) throw new Error(this.lib.error(this.handle));
            try { if (this.lib.setFilter(this.handle, program) !== 0) throw new Error(this.lib.error(this.handle)); }
            finally { this.lib.freeCode(program); }
        } catch (error) { this.close(); throw error; }
    }
    drain(receive: (raw: Buffer, ts: number) => void) {
        const started = performance.now();
        for (let count = 0; count < 4096 && performance.now() - started < 12; count++) {
            const header = [null], data = [null], rc = this.lib.next(this.handle, header, data);
            if (rc === 0) return;
            if (rc !== 1) throw new Error(this.lib.error(this.handle) || 'Acquisizione Npcap terminata');
            const info = koffi.decode(header[0], this.lib.Header);
            if (!data[0] || info.caplen > 65535 || info.caplen < 14) continue;
            receive(Buffer.from(koffi.decode(data[0], 'uint8_t', info.caplen)), Number(info.ts.sec) + Number(info.ts.usec) / 1000000);
        }
    }
    stats() {
        const buffer = Buffer.alloc(256);
        if (!this.handle || this.lib.stats(this.handle, buffer) !== 0) return null;
        return { received: buffer.readUInt32LE(0), dropped: buffer.readUInt32LE(4), interfaceDropped: buffer.readUInt32LE(8) };
    }
    close() { if (this.handle) this.lib.close(this.handle); this.handle = null; }
}
