import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { normalizeViewSettings } from './preferences';

export function readViewSettings(file: string) {
    if (!fs.existsSync(file)) return { settings: normalizeViewSettings(null), path: file };
    return { settings: normalizeViewSettings(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))), path: file };
}
export function writeViewSettings(file: string, input: unknown) {
    const settings = normalizeViewSettings(input);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return { settings, path: file };
}
