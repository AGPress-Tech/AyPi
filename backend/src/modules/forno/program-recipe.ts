import { createProgramConnection, type Connection } from './programs';

export type RecipeSegment = {
    number: number; name: string; type: number; durationSeconds: number;
    targets: number[]; rampSeconds: number[]; rates: number[];
    endType: number; holdback: number[]; goBackTo: number; cycles: number;
};
export type ProgramRecipe = {
    name: string; readAtMs: number; channels: number; rampStyle: number; rampUnits: number[];
    servoTo: number[]; holdback: number[]; segments: RecipeSegment[];
};
type Client = ReturnType<typeof createProgramConnection>;
const decode = (words: number[]) => String.fromCharCode(...words.slice(0, words.includes(0) ? words.indexOf(0) : words.length)).trim();
const native = (address: number) => 32768 + address * 2;
const fail = (message: string) => { throw new Error(message); };

/** In formato nativo float32 IEEE e time_t uint32 in millisecondi, senza scala int16. */
export function decodeRecipeSegment(number: number, name: string, words: number[], channels: number): RecipeSegment {
    if (words.length !== 72 || words.some(v => !Number.isInteger(v) || v < 0 || v > 65535)) fail('Parametri segmento non validi.');
    const buffer = Buffer.alloc(words.length * 2);
    words.forEach((word, i) => buffer.writeUInt16BE(word, i * 2));
    const value = (offset: number) => words[offset * 2];
    const float = (offset: number) => buffer.readFloatBE(offset * 4);
    const seconds = (offset: number) => buffer.readUInt32BE(offset * 4) / 1000;
    const targets = Array.from({ length: channels }, (_, i) => float(2 + i));
    const rates = Array.from({ length: channels }, (_, i) => float(6 + i));
    if (value(0) > 5 || targets.some(v => !Number.isFinite(v)) || rates.some(v => !Number.isFinite(v))) fail('Parametri segmento non interpretabili.');
    return { number, name, type: value(0), durationSeconds: seconds(1), targets,
        rampSeconds: Array.from({ length: channels }, (_, i) => seconds(4 + i)), rates,
        endType: value(8), holdback: Array.from({ length: channels }, (_, i) => value(9 + i)),
        goBackTo: value(18), cycles: buffer.readInt16BE(19 * 4) };
}

async function snapshot(client: Client) {
    const [mode, status] = await client.read(14928, 2);
    const name = decode(await client.read(27323, 21));
    const [amended] = await client.read(14916, 1);
    if (![1, 2, 4].includes(mode) || status < 1 || status > 63 || amended > 1) fail('Stato del programmatore non valido.');
    return { name, mode, status, amended };
}
async function readLoaded(client: Client): Promise<ProgramRecipe> {
    const before = await snapshot(client);
    if (before.amended) fail('Il programma contiene modifiche non salvate. Riprovare dopo averle salvate o annullate.');
    const [revision] = await client.read(4256, 1);
    const setup = await client.read(14880, 12), settings = await client.read(15008, 8);
    const channels = setup[0];
    if (![1, 2].includes(channels) || ![0, 1].includes(settings[5]) || settings.slice(6, 8).some(v => v > 2)) fail('Configurazione del programmatore non riconosciuta.');
    const segments: RecipeSegment[] = [];
    for (let i = 0; i < 26; i++) {
        const words = await client.read(native(15040 + 48 * i), 72);
        const name = decode(await client.read(27344 + 21 * i, 21));
        const segment = decodeRecipeSegment(i + 1, name, words, channels);
        segments.push(segment);
        if (segment.type === 0) break;
    }
    if (segments[segments.length - 1]?.type !== 0) fail('La ricetta non contiene un segmento di fine valido.');
    const [endRevision] = await client.read(4256, 1), after = await snapshot(client);
    if (before.name !== after.name || before.amended !== after.amended || revision !== endRevision) fail('Il programma è cambiato durante la lettura. Riprovare.');
    return { name: before.name, readAtMs: Date.now(), channels, rampStyle: settings[5],
        rampUnits: settings.slice(6, 6 + channels), servoTo: setup.slice(10, 10 + channels),
        holdback: settings[0] === 1 ? settings.slice(1, 1 + channels) : [], segments };
}

async function load(client: Client, name: string) {
    const state = await snapshot(client);
    if (state.mode !== 1 || state.status !== 1 || state.amended) fail('Lettura consentita solo in Reset e senza modifiche non salvate.');
    await client.selectFilename(name);
    const [mode, status] = await client.read(14928, 2);
    if (mode !== 1 || status !== 1) fail('Il forno non è più in Reset. Operazione annullata.');
    await client.loadSelected();
    while (true) {
        const [operation, result] = await client.read(14912, 2);
        if (operation === 1) {
            if (result !== 1) fail('Il nanodac non ha caricato il ciclo richiesto.');
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    const after = await snapshot(client);
    if (after.name !== name) fail('Il programma caricato non corrisponde al ciclo richiesto.');
    if (after.mode !== 1 || after.status !== 1 || after.amended) fail('Stato del forno cambiato durante la lettura. Controllare il nanodac.');
}

export async function readProgramRecipe(config: Connection, name: string, allowTemporaryLoad = false, expectedCurrentProgram?: string): Promise<ProgramRecipe | { needsTemporaryLoad: true; currentProgram: string }> {
    if (typeof name !== 'string' || !name || name.length > 20 || /[\x00-\x1f\x7f/\\]/.test(name)) fail('Nome ciclo non valido.');
    const client = createProgramConnection(config, 30000);
    let original = '', attempted = false;
    try {
        const current = await snapshot(client);
        if (current.name === name) {
            if (current.amended) fail('Il ciclo caricato contiene modifiche non salvate e non coincide necessariamente con la ricetta memorizzata. Salvarle o annullarle sul nanodac prima della consultazione.');
            return await readLoaded(client);
        }
        if (current.mode !== 1 || current.status !== 1) fail('Il forno è in esecuzione o in pausa: si può consultare solo il programma già caricato.');
        if (current.amended) fail('Il programma caricato contiene modifiche non salvate. Salvarle sul nanodac prima di leggere altri cicli.');
        if (!current.name) fail('Nessun programma iniziale da ripristinare. Caricare il ciclo dal pannello del forno.');
        if (!allowTemporaryLoad) return { needsTemporaryLoad: true, currentProgram: current.name };
        if (expectedCurrentProgram !== current.name) fail('Il programma iniziale è cambiato dopo la conferma. Riaprire il ciclo e riprovare.');
        // Prima di caricare una ricetta, accerta che anche quella iniziale sia salvata.
        await client.refreshList();
        while ((await client.read(14976, 1))[0] !== 0) await new Promise(resolve => setTimeout(resolve, 100));
        const names: string[] = [];
        for (let i = 0; i < 100; i++) { const entry = decode(await client.read(30976 + i, 21)); if (!entry) break; names.push(entry); }
        if (!names.includes(name) || !names.includes(current.name)) fail('Ciclo richiesto o programma iniziale non presenti nell’archivio del nanodac.');
        const verify = await snapshot(client);
        if (JSON.stringify(current) !== JSON.stringify(verify)) fail('Stato del forno cambiato. Riprovare.');
        original = current.name;
        attempted = true;
        await load(client, name);
        return await readLoaded(client);
    } finally {
        client.close();
        if (attempted) {
            const recovery = createProgramConnection(config, 12000);
            try {
                // Anche in caso di ACK perso, attendi l'esito dell'eventuale Load.
                while ((await recovery.read(14912, 1))[0] !== 1) await new Promise(resolve => setTimeout(resolve, 100));
                const state = await snapshot(recovery);
                if ((state.name !== name && state.name !== original) || state.mode !== 1 || state.status !== 1 || state.amended) fail('Ripristino sospeso: stato del forno cambiato. Controllare il programma sul nanodac.');
                // Ricarica anche se il nome non è cambiato: un Load fallito può essere parziale.
                await load(recovery, original);
            } catch (error) { fail(`Ripristino del programma ${original} non confermato. Controllare il nanodac. ${(error as Error).message}`); }
            finally { recovery.close(); }
        }
    }
}
