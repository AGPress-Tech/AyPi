import os from 'os';
import path from 'path';

const roots = new Map<string, string>();
/** Interroga SOLO le condivisioni del computer che esegue il backend. */
function localShareRoot(share: string): string {
    const key = share.toLowerCase();
    if (roots.has(key)) return roots.get(key)!;
    const k = require('koffi');
    const lib = k.load('netapi32.dll');
    const Info = k.struct({ name: 'str16', type: 'uint32_t', remark: 'str16', permissions: 'uint32_t', maxUses: 'uint32_t', currentUses: 'uint32_t', path: 'str16', password: 'str16' });
    const get = lib.func('uint32_t __stdcall NetShareGetInfo(str16 server, str16 share, uint32_t level, _Out_ void **buffer)');
    const free = lib.func('uint32_t __stdcall NetApiBufferFree(void *buffer)');
    const output = [null];
    const status = get(null, share, 2, output);
    if (status !== 0) throw new Error(`Impossibile risolvere la condivisione locale ${share} (Windows ${status}). Specificare il percorso locale in forno.dbPath o verificare l'account del backend.`);
    try {
        const info = k.decode(output[0], Info);
        if ((info.type & 0xff) !== 0 || !info.path) throw new Error('La condivisione non e una cartella su disco');
        roots.set(key, info.path);
        return info.path;
    } finally { if (output[0]) free(output[0]); }
}

type Options = { platform?: string; hostname?: string; addresses?: string[]; shareRoot?: (share: string) => string };
/** Converte un UNC rivolto al server stesso in I/O locale. Mai apre SQLite via SMB. */
export function resolveLocalDatabasePath(value: string, options: Options = {}) {
    const platform = options.platform || process.platform;
    const win = platform === 'win32';
    if (!/^(\\\\|\/\/)/.test(value)) {
        const api = win ? path.win32 : path;
        if (!api.isAbsolute(value) || (win && !/^[a-z]:[\\/]/i.test(value))) throw new Error('Il database forno richiede un percorso assoluto su disco locale');
        return api.normalize(value);
    }
    if (!win) throw new Error('Un percorso UNC puo essere risolto solo sul server Windows che ospita la condivisione');
    const match = /^\\\\([^\\]+)\\([^\\]+)(?:\\(.*))?$/.exec(value.replace(/\//g, '\\'));
    if (!match) throw new Error('Percorso UNC del database forno non valido');
    const [, server, share, tail = ''] = match;
    const hostname = (options.hostname || os.hostname()).toLowerCase().replace(/\.$/, '');
    const local = new Set([hostname, hostname.split('.')[0], 'localhost', '.', '127.0.0.1', '::1']);
    const addresses = options.addresses || Object.values(os.networkInterfaces()).flat().filter(Boolean).map(address => address!.address);
    addresses.forEach(address => local.add(address.toLowerCase()));
    if (!local.has(server.toLowerCase().replace(/\.$/, ''))) throw new Error(`Il database forno deve risiedere sul server ${hostname}: ${server} e un altro computer`);
    const root = (options.shareRoot || localShareRoot)(share);
    if (!/^[a-z]:[\\/]/i.test(root)) throw new Error('La condivisione non corrisponde a un disco locale');
    const base = path.win32.resolve(root), result = path.win32.resolve(base, tail);
    if (result.toLowerCase() !== base.toLowerCase() && !result.toLowerCase().startsWith(base.toLowerCase().replace(/\\$/, '') + '\\')) throw new Error('Il percorso esce dalla cartella condivisa');
    return result;
}
