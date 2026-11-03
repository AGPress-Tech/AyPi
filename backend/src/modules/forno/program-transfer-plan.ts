import { createHash } from "crypto";
export type Field = {
    address: number;
    words: number[];
    label: string;
    bool?: boolean;
};
export const digest = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (s: string): never => {
    throw new Error(s);
};
export function testName(name: unknown): asserts name is string {
    if (typeof name !== "string" || !/^TEST_[A-Za-z0-9_-]{1,15}$/.test(name))
        fail(
            "Per il collaudo usare un nome TEST_ seguito da lettere, numeri, _ o -, massimo 20 caratteri.",
        );
}
export function programName(
    name: unknown,
    testsOnly = false,
): asserts name is string {
    if (testsOnly) {
        testName(name);
        return;
    }
    if (
        typeof name !== "string" ||
        !name ||
        name.length > 20 ||
        name !== name.trim() ||
        /[^\x20-\x7e]|[<>:"/\\|?*]/.test(name) ||
        name === "." ||
        name === ".." ||
        /[. ]$/.test(name)
    )
        fail(
            "Nome programma: 1-20 caratteri ASCII, senza caratteri riservati o punto finale.",
        );
}
export function stringWords(text: string) {
    if (!/^[\x20-\x7e]{0,20}$/.test(text))
        fail("Nomi sul forno: massimo 20 caratteri ASCII.");
    return Array.from({ length: 21 }, (_, i) => text.charCodeAt(i) || 0);
}
export function buildTransferPlan(
    d: any,
    limits: { min: number; max: number },
    allowAnyName = false,
) {
    if (
        !d ||
        d.format !== "aypi-forno-draft" ||
        d.version !== 2 ||
        !Array.isArray(d.steps) ||
        d.steps.length < 2 ||
        d.steps.length > 26 ||
        Object.keys(d).some(
            (k) =>
                ![
                    "format",
                    "version",
                    "name",
                    "startDeciC",
                    "steps",
                    "source",
                ].includes(k),
        )
    )
        fail("Bozza non valida per il trasferimento.");
    programName(d.name, !allowAnyName);
    const fields: Field[] = [];
    const scalar = (
        address: number,
        value: number,
        label: string,
        bool = false,
    ) =>
        fields.push({
            address,
            words: [value],
            label,
            ...(bool ? { bool } : {}),
        });
    const native = (
        address: number,
        value: number,
        label: string,
        time = false,
    ) => {
        const b = Buffer.alloc(4);
        if (time) b.writeUInt32BE(value);
        else b.writeFloatBE(value);
        fields.push({
            address: 32768 + address * 2,
            words: [b.readUInt16BE(0), b.readUInt16BE(2)],
            label,
        });
    };
    const kinds = ["end", "ramp", "dwell", "step", "wait", "goback"];
    let current = d.startDeciC;
    if (!Number.isInteger(current) || current < 0 || current > 100000)
        fail("Partenza anteprima non valida.");
    // Program.Program (27323) è il nome del file caricato: non si rinomina in RAM.
    // Il nuovo nome viene assegnato da FilenameEntry + Store, poi verificato con Load.
    // Holdback e PV Event sono disabilitati dal profilo macchina verificato.
    // Non si scrivono parametri nascosti ne eventi oltre MaxEvents=3.
    scalar(15013, 0, "Rampe a tempo");
    d.steps.forEach((s: any, i: number) => {
        const type = kinds.indexOf(s?.kind),
            base = 15040 + 48 * i;
        const extra =
            s?.kind === "wait"
                ? ["waitFor", "waitCondition", "waitValueDeci"]
                : s?.kind === "goback"
                  ? ["goBackTo", "cycles"]
                  : s?.kind === "end"
                    ? ["endAction"]
                    : [];
        if (
            type < 0 ||
            Object.keys(s).some(
                (k) =>
                    ![
                        "kind",
                        "label",
                        "targetDeciC",
                        "durationMs",
                        "events",
                        "userValueDeci",
                        ...extra,
                    ].includes(k),
            ) ||
            typeof s.label !== "string" ||
            !Array.isArray(s.events) ||
            s.events.length !== 3 ||
            s.events.some((v: any) => typeof v !== "boolean")
        )
            fail("Fase " + (i + 1) + ": tipo, nome o eventi non validi.");
        if (
            !Number.isInteger(s.targetDeciC) ||
            s.targetDeciC / 10 < limits.min ||
            s.targetDeciC / 10 > limits.max
        )
            fail(
                "Fase " +
                    (i + 1) +
                    ": temperatura fuori dai limiti dei loop (" +
                    limits.min +
                    " / " +
                    limits.max +
                    " °C).",
            );
        if (!["ramp", "step"].includes(s.kind) && s.targetDeciC !== current)
            fail("Plateau incoerente nella fase " + (i + 1));
        if (
            !Number.isInteger(s.userValueDeci) ||
            s.userValueDeci < 0 ||
            s.userValueDeci > 100000
        )
            fail("Valore utente non valido.");
        if (
            ["ramp", "dwell"].includes(s.kind)
                ? !Number.isInteger(s.durationMs) ||
                  s.durationMs < 1000 ||
                  s.durationMs > 1800000000 ||
                  s.durationMs % 1000 !== 0
                : s.durationMs !== 0
        )
            fail("Durate da 1 secondo a 500 ore, senza frazioni di secondo.");
        if ((s.kind === "end") !== (i === d.steps.length - 1))
            fail("Aggiungere una sola Fine esplicita in ultima posizione.");
        scalar(base, type, "Fase " + (i + 1) + " tipo");
        fields.push({
            address: 27344 + 21 * i,
            words: stringWords(s.label || String(i + 1)),
            label: "Nome fase " + (i + 1),
        });
        if (s.kind === "ramp" || s.kind === "step")
            native(base + 2, s.targetDeciC / 10, "Temperatura fase " + (i + 1));
        if (s.kind === "ramp")
            native(base + 4, s.durationMs, "Tempo rampa " + (i + 1), true);
        if (s.kind === "dwell")
            native(base + 1, s.durationMs, "Durata stasi " + (i + 1), true);
        if (s.kind === "wait") {
            if (
                ![0, 1].includes(s.waitFor) ||
                ![1, 2, 3, 4].includes(s.waitCondition) ||
                !Number.isInteger(s.waitValueDeci) ||
                Math.abs(s.waitValueDeci) > 100000
            )
                fail("Attesa non valida per CH1.");
            scalar(base + 13, s.waitFor, "Ingresso attesa");
            if (s.waitFor === 1) {
                scalar(base + 14, s.waitCondition, "Criterio attesa");
                native(base + 16, s.waitValueDeci / 10, "Soglia attesa");
            }
        }
        if (s.kind === "goback") {
            if (
                !Number.isInteger(s.goBackTo) ||
                s.goBackTo < 1 ||
                s.goBackTo > i ||
                !Number.isInteger(s.cycles) ||
                s.cycles < 0 ||
                s.cycles > 32767 ||
                d.steps
                    .slice(s.goBackTo - 1, i)
                    .some((p: any) => p.kind === "goback")
            )
                fail("Ripetizione non valida o annidata.");
            scalar(base + 18, s.goBackTo, "Destinazione GoBack");
            scalar(base + 19, s.cycles, "Cicli GoBack");
        }
        if (s.kind === "end") {
            if (!["reset", "dwell"].includes(s.endAction))
                fail("Azione Fine non valida.");
            if (
                s.endAction === "reset" &&
                (s.events.some(Boolean) || s.userValueDeci)
            )
                fail("Fine Reset deve usare gli stati globali.");
            scalar(base + 8, s.endAction === "reset" ? 1 : 0, "Azione Fine");
        }
        // Fine Reset usa le uscite e User Value globali di Reset, gia verificati.
        if (s.kind !== "end" || s.endAction !== "reset") {
            native(
                base + 24,
                s.userValueDeci / 10,
                "Valore utente fase " + (i + 1),
            );
            for (let e = 0; e < 3; e++)
                scalar(
                    base + 26 + e,
                    Number(s.events[e]),
                    "E" + (e + 1) + " fase " + (i + 1),
                    true,
                );
        }
        current = s.targetDeciC;
    });
    return {
        name: d.name,
        fields,
        draft: JSON.parse(JSON.stringify(d)),
        hash: digest(fields),
    };
}
