import net from 'net';
export type ModbusValue = { v: number | null; q: number };
export function qualityLabel(q: number) {
    return ['good', 'timeout', 'protocol', 'connection'][q] || ({9:'off',10:'over_range',11:'under_range',12:'hardware_error',13:'ranging',14:'overflow',15:'bad',16:'hardware_exceeded',17:'no_data',20:'channel_comms_error'} as Record<number,string>)[q] || 'invalid';
}
export class ModbusReader {
    private socket: net.Socket | null = null;
    private transaction = 0;
    constructor(private host: string, private port: number, private unit: number, private address: number) {}
    close() { this.socket?.destroy(); this.socket = null; }
    private readRegisters(count: number): Promise<{ words: number[] | null; q: number }> {
        return new Promise(resolve => {
            const fresh = !this.socket || this.socket.destroyed;
            const socket = fresh ? new net.Socket() : this.socket!;
            this.socket = socket;
            if (fresh) socket.on('error', () => {});
            const tid = this.transaction = (this.transaction + 1) & 0xffff;
            let buffer: Buffer = Buffer.alloc(0), finished = false;
            const done = (words: number[] | null, q: number) => {
                if (finished) return;
                finished = true; clearTimeout(timer);
                socket.off('data', data); socket.off('error', error); socket.off('close', closed); socket.off('connect', send);
                if (q) this.close(); resolve({ words, q });
            };
            const error = () => done(null, 3), closed = () => done(null, 3);
            const data = (chunk: Buffer) => {
                buffer = Buffer.concat([buffer, chunk]);
                if (buffer.length > 260) return done(null, 2);
                if (buffer.length < 7) return;
                const length = buffer.readUInt16BE(4);
                if (buffer.readUInt16BE(0) !== tid || buffer.readUInt16BE(2) !== 0 || buffer[6] !== this.unit || length < 2 || length > 254) return done(null, 2);
                if (buffer.length < length + 6) return;
                if (length !== 3 + count * 2 || buffer.length !== 9 + count * 2 || buffer[7] !== 3 || buffer[8] !== count * 2) return done(null, 2);
                done(Array.from({length:count},(_,i)=>buffer.readUInt16BE(9+i*2)), 0);
            };
            const send = () => {
                const request = Buffer.alloc(12);
                request.writeUInt16BE(tid, 0); request.writeUInt16BE(6, 4); request[6] = this.unit; request[7] = 3;
                request.writeUInt16BE(this.address, 8); request.writeUInt16BE(count, 10);
                socket.write(request, err => { if (err) error(); });
            };
            const timer = setTimeout(() => done(null, 1), 400);
            socket.on('data', data); socket.once('error', error); socket.once('close', closed);
            if (fresh) { socket.once('connect', send); socket.connect(this.port, this.host); } else send();
        });
    }
    /** Compatibilita con la lettura del registro singolo. */
    async read(): Promise<ModbusValue> { const r=await this.readRegisters(1);return {v:r.words?.[0]??null,q:r.q}; }
    /** PV e stato dei quattro canali: 256/257,260/261,264/265,268/269. */
    async readChannels(): Promise<ModbusValue[]> {
        const r=await this.readRegisters(14);
        if(!r.words) return Array.from({length:4},()=>({v:null,q:r.q}));
        return [0,4,8,12].map(offset=>{
            const status=r.words![offset+1],raw=r.words![offset];
            return status===0?{v:raw>=32768?raw-65536:raw,q:0}:{v:null,q:Math.min(255,8+status)};
        });
    }
}
