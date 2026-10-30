import net from 'net';

export type Connection = { host: string; port: number; unit: number };
export type StoredPrograms = { programs: string[]; readAtMs: number; scope?: 'stored' | 'current'; mode?: number };

/** Connessione dedicata per elenco e consultazione delle ricette.
 * HA030554 §4.8.6: FC06 14976=1, attesa 0, stringhe da 30976 (21 word ciascuna).
 * Non condivide il socket del collector; Load è usato solo dalla lettura autorizzata in Reset.
 */
export function createProgramConnection(config: Connection, timeoutMs = 12000) {
    const deadline = Date.now() + timeoutMs;
    let socket: net.Socket | null = null;
    let transaction = 0;
    const request = (fc: 3 | 6 | 16, address: number, value: number, wordsToWrite?: number[]): Promise<number[]> => new Promise((resolve, reject) => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return reject(new Error('Tempo massimo di lettura dei cicli superato. Riprovare.'));
        const fresh = !socket || socket.destroyed;
        const target = fresh ? new net.Socket() : socket!;
        socket = target;
        if (fresh) target.on('error', () => {});
        const id = transaction = (transaction + 1) & 0xffff;
        let buffer = Buffer.alloc(0), finished = false;
        const finish = (error: Error | null, words: number[] = []) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            target.off('data', data); target.off('error', failed); target.off('close', closed); target.off('connect', send);
            if (error) { target.destroy(); reject(error); } else resolve(words);
        };
        const failed = () => finish(new Error('Nanodac non raggiungibile. Verificare accensione e collegamento.'));
        const closed = () => finish(new Error('Connessione al nanodac interrotta. Riprovare.'));
        const invalid = () => finish(new Error('Risposta Modbus non valida durante la lettura dei cicli.'));
        const data = (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > 260) return invalid();
            if (buffer.length < 7) return;
            const length = buffer.readUInt16BE(4);
            if (buffer.readUInt16BE(0) !== id || buffer.readUInt16BE(2) !== 0 || buffer[6] !== config.unit || length < 2 || length > 254) return invalid();
            if (buffer.length < length + 6) return;
            if (buffer.length !== length + 6) return invalid();
            if (buffer[7] === (fc | 128) && length === 3) return finish(new Error(`Il nanodac ha rifiutato la lettura dei cicli (Modbus ${buffer[8]}).`));
            if (buffer[7] !== fc) return invalid();
            if (fc === 6 || fc === 16) {
                if (length !== 6 || buffer.readUInt16BE(8) !== address || buffer.readUInt16BE(10) !== value) return invalid();
                return finish(null);
            }
            if (length !== 3 + value * 2 || buffer[8] !== value * 2) return invalid();
            finish(null, Array.from({ length: value }, (_, i) => buffer.readUInt16BE(9 + i * 2)));
        };
        const send = () => {
            const packet = Buffer.alloc(fc === 16 ? 13 + value * 2 : 12);
            packet.writeUInt16BE(id); packet.writeUInt16BE(packet.length - 6, 4);
            packet[6] = config.unit; packet[7] = fc;
            packet.writeUInt16BE(address, 8); packet.writeUInt16BE(value, 10);
            if (fc === 16) { packet[12] = value * 2; wordsToWrite!.forEach((word, i) => packet.writeUInt16BE(word, 13 + i * 2)); }
            target.write(packet, error => { if (error) failed(); });
        };
        const timer = setTimeout(() => finish(new Error('Il nanodac non risponde alla richiesta dei cicli. Riprovare.')), Math.min(2000, remaining));
        target.on('data', data); target.once('error', failed); target.once('close', closed);
        if (fresh) { target.once('connect', send); target.connect(config.port, config.host); } else send();
    });
    const read = async (address: number, count: number) => {
        try { return await request(3, address, count); }
        catch {
            // Lascia al dispositivo il tempo di liberare il socket appena chiuso.
            await new Promise(resolve => setTimeout(resolve, 150));
            return request(3, address, count);
        }
    };
    return {
        read,
        refreshList: () => request(6, 14976, 1),
        // Nessuna API di scrittura generica: soltanto selezione del nome e Load.
        selectFilename: (name: string) => {
            if (!name || name.length > 20 || /[\x00-\x1f\x7f/\\]/.test(name)) throw new Error('Nome ciclo non valido.');
            const words = Array.from({ length: 21 }, (_, i) => name.charCodeAt(i) || 0);
            return request(16, 27281, words.length, words);
        },
        loadSelected: () => request(6, 14912, 2),
        close: () => socket?.destroy(),
    };
}

export async function readStoredPrograms(config: Connection): Promise<StoredPrograms> {
    const client = createProgramConnection(config);
    const read = client.read;
    const currentIfBusy = async (): Promise<StoredPrograms | null> => {
        const [mode, status] = await read(14928, 2);
        if (![1, 2, 4].includes(mode) || status < 1 || status > 63) throw new Error('Stato del programmatore non valido.');
        if (mode === 1 && status === 1) return null;
        const words = await read(27323, 21);
        const end = words.indexOf(0);
        const name = String.fromCharCode(...words.slice(0, end < 0 ? words.length : end)).replace(/[\x00-\x1f\x7f]/g, '').trim();
        if (!name) throw new Error('Nessun ciclo caricato disponibile sul nanodac.');
        return { programs: [name], readAtMs: Date.now(), scope: 'current', mode };
    };
    try {
        // Get Listing è una scrittura e può essere rifiutata in Run/Hold.
        // Il programma già caricato è invece consultabile con sole letture FC03.
        const current = await currentIfBusy();
        if (current) return current;
        await client.refreshList();
        while (true) {
            const [status] = await read(14976, 1);
            if (status === 0) break;
            if (status !== 1) throw new Error('Elenco cicli del nanodac non disponibile. Riprovare.');
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        const programs: string[] = [];
        for (let i = 0; i < 100; i++) {
            const words = await read(30976 + i, 21);
            const end = words.indexOf(0);
            const name = String.fromCharCode(...words.slice(0, end < 0 ? words.length : end)).replace(/[\x00-\x1f\x7f]/g, '').trim();
            if (!name) break;
            programs.push(name);
        }
        return { programs, readAtMs: Date.now() };
    } catch (error) {
        // Gestisce anche Reset -> Run fra la verifica iniziale e Get Listing.
        try { const current = await currentIfBusy(); if (current) return current; } catch { /* conserva l'errore iniziale */ }
        throw error;
    } finally { client.close(); }
}

/** Più postazioni condividono la stessa richiesta in corso, senza elenchi in cache. */
export function createStoredProgramsReader(read: () => Promise<StoredPrograms>) {
    let pending: Promise<StoredPrograms> | null = null;
    return () => {
        if (!pending) pending = read().finally(() => { pending = null; });
        return pending;
    };
}
