import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { validateDraft } from './program-draft';

export function readProgramDraft(file: string) {
    if (!fs.existsSync(file)) return null;
    if (fs.statSync(file).size > 200000) throw new Error('File bozza troppo grande.');
    return validateDraft(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
}
export function writeProgramDraft(file: string, input: unknown) {
    const draft = validateDraft(input);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    try {
        const fd = fs.openSync(temporary, 'wx');
        try { fs.writeFileSync(fd, JSON.stringify(draft, null, 2) + '\n', 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, file);
        const verified = readProgramDraft(file);
        if (JSON.stringify(verified) !== JSON.stringify(draft)) throw new Error('Verifica della bozza salvata non riuscita.');
        return verified;
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
