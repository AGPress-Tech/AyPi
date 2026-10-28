import fs from 'fs';
import path from 'path';
import { deflateSync, inflateSync } from 'zlib';
const Database = require('better-sqlite3');
export type Sample = { t: number; v: number | null; q: number };
export type Identity = { host: string; port: number; unit: number; address: number; scale: number };
const INVALID = -2147483648;
const BLOCK_SIZE = 120;

export function openDatabase(file: string, options: Record<string, unknown> = {}) {
    let nativeBinding: string | undefined;
    if (process.versions.electron) {
        const folder = `electron-v${process.versions.modules}-${process.platform}-${process.arch}`;
        const roots = [process.env.AYPI_FORNO_RESOURCES || '', path.resolve(__dirname, '../../../resources/forno'), path.resolve(__dirname, '../../../backend/resources/forno')];
        nativeBinding = roots.filter(Boolean).map(root => path.join(root, 'native', folder, 'better_sqlite3.node')).find(candidate => fs.existsSync(candidate));
        if (!nativeBinding) throw new Error('SQLite Electron non incluso: eseguire npm run prepare:forno durante la build');
    }
    return new Database(file, { ...options, ...(nativeBinding ? { nativeBinding } : {}) });
}

export function summarize(rows: Sample[]) {
    const result: any = { count: rows.length, valid: 0, minimum: null, maximum: null, total: 0, first_t: null, first_v: null, last_t: null, last_v: null, min_t: null, max_t: null };
    for (const { t, v, q } of rows) {
        if (q !== 0 || v === null) continue;
        result.valid++; result.total += v;
        if (result.minimum === null || v < result.minimum) { result.minimum = v; result.min_t = t; }
        if (result.maximum === null || v > result.maximum) { result.maximum = v; result.max_t = t; }
        if (result.first_t === null || t < result.first_t) { result.first_t = t; result.first_v = v; }
        if (result.last_t === null || t > result.last_t) { result.last_t = t; result.last_v = v; }
    }
    return result;
}
function merge(target: any, item: any) {
    target.count += item.count; target.valid += item.valid; target.total += item.total;
    if (!item.valid) return;
    if (target.minimum === null || item.minimum < target.minimum) { target.minimum = item.minimum; target.min_t = item.min_t; }
    if (target.maximum === null || item.maximum > target.maximum) { target.maximum = item.maximum; target.max_t = item.max_t; }
    if (target.first_t === null || item.first_t < target.first_t) { target.first_t = item.first_t; target.first_v = item.first_v; }
    if (target.last_t === null || item.last_t > target.last_t) { target.last_t = item.last_t; target.last_v = item.last_v; }
}
function publicStats(s: any) {
    return { samples: s.count, valid: s.valid, missing: s.count - s.valid,
        min: s.valid ? s.minimum / 10 : null, max: s.valid ? s.maximum / 10 : null,
        mean: s.valid ? s.total / s.valid / 10 : null, delta: s.valid ? (s.maximum - s.minimum) / 10 : null,
        first: s.valid ? s.first_v / 10 : null, last: s.valid ? s.last_v / 10 : null,
        firstTime: s.first_t, lastTime: s.last_t, minTime: s.min_t, maxTime: s.max_t };
}
export function unpackBlock(start: number, payload: Buffer): Sample[] {
    const raw = inflateSync(payload);
    if (raw.length % 9) throw new Error('Blocco temperature danneggiato');
    const rows: Sample[] = [];
    for (let offset = 0; offset < raw.length; offset += 9) {
        const v = raw.readInt32LE(offset + 4);
        rows.push({ t: start + raw.readUInt32LE(offset), v: v === INVALID ? null : v, q: raw[offset + 8] });
    }
    return rows;
}

export class Archive {
    readonly db: any;
    private guard: any;
    private lastTime: number | null = null;
    private pending = 0;
    private firstPending: number | null = null;
    constructor(readonly file: string, identity: Identity) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        this.guard = openDatabase(file + '.collector.lock', { timeout: 0 });
        try {
            this.guard.exec('CREATE TABLE IF NOT EXISTS guard(id INTEGER); BEGIN EXCLUSIVE');
            this.db = openDatabase(file, { timeout: 5000 });
            this.db.pragma('journal_mode = WAL'); this.db.pragma('synchronous = FULL');
            this.db.exec(`CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS pending(t INTEGER PRIMARY KEY,v INTEGER,q INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS blocks(start INTEGER PRIMARY KEY,end INTEGER NOT NULL,count INTEGER NOT NULL,valid INTEGER NOT NULL,
                    minimum INTEGER,maximum INTEGER,total INTEGER NOT NULL,first_t INTEGER,first_v INTEGER,last_t INTEGER,last_v INTEGER,
                    min_t INTEGER,max_t INTEGER,payload BLOB NOT NULL);
                CREATE INDEX IF NOT EXISTS blocks_end ON blocks(end);`);
            const stored = this.db.prepare("SELECT value FROM metadata WHERE key='identity'").get();
            if (stored) {
                const previous = JSON.parse(stored.value);
                if (Object.keys(identity).some(key => previous[key] !== identity[key])) throw new Error('Il database appartiene a una configurazione forno diversa');
            }
            this.db.transaction(() => {
                this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('identity',?)").run(JSON.stringify(identity));
                this.db.prepare("INSERT OR IGNORE INTO metadata VALUES ('format','delta32-int32-quality8-zlib-v1')").run();
                this.seal();
            })();
            this.lastTime = this.db.prepare('SELECT MAX(end) t FROM blocks').get().t;
        } catch (error) {
            if (this.db?.open) this.db.close();
            if (this.guard?.open) this.guard.close();
            throw error;
        }
    }
    append(sample: Sample) {
        const { t, v, q } = sample;
        if (!Number.isSafeInteger(t) || t < 0 || (this.lastTime !== null && t <= this.lastTime)) throw new Error('Orologio non crescente: controllare il server');
        if (!Number.isInteger(q) || q < 0 || q > 255 || (v !== null && (!Number.isInteger(v) || v < -32768 || v > 65535)) || (q === 0 && v === null)) throw new Error('Campione forno non valido');
        this.db.transaction(() => {
            if (this.firstPending !== null && t - this.firstPending > 0xffffffff) { this.seal(); this.pending = 0; this.firstPending = null; }
            this.db.prepare('INSERT INTO pending VALUES (?,?,?)').run(t, v, q);
            if (this.pending + 1 >= BLOCK_SIZE) this.seal();
        })();
        this.lastTime = t;
        if (this.firstPending === null) this.firstPending = t;
        this.pending++;
        if (this.pending >= BLOCK_SIZE) { this.pending = 0; this.firstPending = null; }
    }
    private seal() {
        const rows: Sample[] = this.db.prepare('SELECT t,v,q FROM pending ORDER BY t').all();
        if (!rows.length) return;
        const s = summarize(rows), start = rows[0].t;
        const raw = Buffer.alloc(rows.length * 9);
        rows.forEach((row, i) => { raw.writeUInt32LE(row.t - start, i * 9); raw.writeInt32LE(row.v === null ? INVALID : row.v, i * 9 + 4); raw[i * 9 + 8] = row.q; });
        this.db.prepare('INSERT INTO blocks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(start, rows[rows.length - 1].t,
            s.count, s.valid, s.minimum, s.maximum, s.total, s.first_t, s.first_v, s.last_t, s.last_v, s.min_t, s.max_t, deflateSync(raw));
        this.db.prepare('DELETE FROM pending').run();
    }
    close() {
        try {
            if (this.db.open) { this.db.transaction(() => this.seal())(); this.db.pragma('wal_checkpoint(TRUNCATE)'); this.db.close(); }
        } finally {
            if (this.db.open) this.db.close();
            if (this.guard.open) this.guard.close();
        }
    }
}

export function history(db: any, start: number, end: number, interval = 500, maxPoints = 2000, channel = 1, manageTransaction = true) {
    if (![start, end, interval, maxPoints].every(Number.isSafeInteger) || start < 0 || end < start || end - start > 366 * 86400000 || interval < 500 || interval > 366 * 86400000 || maxPoints < 1 || maxPoints > 4000) throw new Error('Intervallo forno non valido');
    const effective = Math.max(interval, Math.ceil((end - start + 1) / maxPoints));
    const bins = new Map<number, any>(), total = summarize([]);
    const add = (t: number, stats: any) => { const key = Math.floor((t - start) / effective); if (!bins.has(key)) bins.set(key, summarize([])); merge(bins.get(key), stats); merge(total, stats); };
    if(!Number.isInteger(channel)||channel<1||channel>4) throw new Error('Canale non valido');
    const multi=channel!==1;
    const available=!multi||Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='blocks_channels'").get());
    if(manageTransaction) db.exec('BEGIN');
    try {
        for (const block of (available ? db.prepare(multi?'SELECT * FROM blocks_channels WHERE channel = ? AND start <= ? AND end >= ? ORDER BY start':'SELECT * FROM blocks WHERE start <= ? AND end >= ? ORDER BY start').iterate(...(multi?[channel,end,start]:[end,start])) : [])) {
            if (start <= block.start && block.end <= end && Math.floor((block.start - start) / effective) === Math.floor((block.end - start) / effective)) add(block.start, block);
            else for (const row of unpackBlock(block.start, block.payload)) if (start <= row.t && row.t <= end) add(row.t, summarize([row]));
        }
        for (const row of (available ? db.prepare(multi?'SELECT t,v,q FROM pending_channels WHERE channel = ? AND t BETWEEN ? AND ? ORDER BY t':'SELECT t,v,q FROM pending WHERE t BETWEEN ? AND ? ORDER BY t').iterate(...(multi?[channel,start,end]:[start,end])) : [])) add(row.t, summarize([row]));
    } finally { if(manageTransaction) db.exec('ROLLBACK'); }
    return { fromMs: start, toMs: end, requestedIntervalMs: interval, effectiveIntervalMs: effective, stats: publicStats(total),
        buckets: [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([k, s]) => ({ fromMs: start + k * effective, toMs: Math.min(end, start + (k + 1) * effective - 1), ...publicStats(s) })) };
}
