import {
    measurementNumber,
    evaluateCalibrationSystem,
} from "./calibration-system";
import {
    addMonths,
    calendarDate,
    todayInRome,
    validateAttachment,
} from "../maintenance/model";
export { todayInRome, calendarDate };
export type Kind = "instrument" | "calibration" | "system";
export const modes = { internal: "Interna", external: "Esterna", nst: "NST" };
export const usages = {
    in_use: "In uso",
    unused: "Non in uso",
    quarantine: "In quarantena",
    retired: "Dismesso",
};
export const outcomes = {
    fit: "Idoneo",
    unfit: "Non idoneo",
    review: "Da valutare",
    unknown: "Non dichiarato",
};
export const states = {
    valid: "Regolare",
    upcoming: "In scadenza",
    today: "Scade oggi",
    overdue: "Scaduto",
    missing: "Scadenza da completare",
    requalification: "Da riqualificare",
    frequency: "Frequenza mancante",
    unfit: "Non idoneo / da valutare",
    nst: "NST",
    inactive: "Fuori uso",
};
export const text = (v: any, max = 2000, required = false) => {
    if (typeof v !== "string" || v.length > max || (required && !v.trim()))
        throw Error("Testo mancante o troppo lungo.");
    return v.trim();
};
const choice = (value: any, values: any) => {
    if (!Object.prototype.hasOwnProperty.call(values, value))
        throw Error("Scelta non valida.");
    return value;
};
const months = (v: any) => {
    if (v == null || v === "") return null;
    if (!Number.isInteger(v) || v < 1 || v > 1200)
        throw Error("Indicare una frequenza fra 1 e 1200 mesi.");
    return v;
};
const optionalDate = (v: any, today: string) => {
    if (!v) return "";
    const d = calendarDate(v);
    if (d > today) throw Error("La data non può essere futura.");
    return d;
};
export function validateInstrument(
    v: any,
    current: any = null,
    today = todayInRome(),
    records: any[] = [],
) {
    if (!v || typeof v !== "object")
        throw Error("Scheda strumento non valida.");
    const mode = choice(v.mode, modes),
        usage = choice(v.usage, usages),
        suitability = choice(v.suitability, outcomes),
        frequencyMonths = mode === "nst" ? null : months(v.frequencyMonths),
        nstReviewMonths = months(v.nstReviewMonths);
    const nstReason = text(v.nstReason || "", 10000),
        nstDate = optionalDate(v.nstDate, today),
        changeReason = text(v.changeReason || "", 10000);
    if (mode === "nst" && nstReviewMonths && !nstDate)
        throw Error(
            "Indicare la data iniziale soltanto se si imposta una revisione periodica NST.",
        );
    if (current && current.mode !== mode && mode !== "nst" && !changeReason)
        throw Error("Motivare il cambio del regime di taratura.");
    if (mode !== "nst" && !frequencyMonths)
        throw Error(
            "Per gli strumenti soggetti a taratura indicare la frequenza.",
        );
    const initialDueDate =
        mode === "nst"
            ? ""
            : v.initialDueDate
              ? calendarDate(v.initialDueDate)
              : current?.initialDueDate || "";
    if (current?.mode === "nst" && mode !== "nst" && !initialDueDate)
        throw Error(
            "Per riattivare le tarature indicare la scadenza taratura.",
        );
    const calibrationTolerance = measurementNumber(
            v.calibrationTolerance === undefined
                ? current?.calibrationTolerance
                : v.calibrationTolerance,
        ),
        calibrationUnit = text(
            v.calibrationUnit ?? current?.calibrationUnit ?? "",
            30,
            calibrationTolerance != null,
        );
    if (calibrationTolerance != null && calibrationTolerance < 0)
        throw Error("La tolleranza ammessa non pu\u00f2 essere negativa.");
    const value = {
        calibrationTolerance,
        calibrationUnit,
        code: text(v.code, 128, true),
        description: text(v.description, 2000, true),
        serial: text(v.serial || "", 200),
        category: text(v.category, 200, true),
        location: text(v.location, 300, true),
        model: text(v.model || "", 300),
        measurementRange: text(v.measurementRange || "", 500),
        useRange: text(v.useRange || "", 500),
        resolution: text(v.resolution || "", 300),
        tolerance: text(v.tolerance || "", 1000),
        method: text(v.method || "", 10000),
        responsible: text(v.responsible || "", 200),
        notes: text(v.notes || "", 30000),
        mode,
        usage,
        suitability,
        frequencyMonths,
        initialDueDate,
        nstReviewMonths,
        nstReason,
        nstDate,
        nstVerified: mode === "nst",
        changeReason,
    };
    const candidate = {
        ...value,
        id: current?.id || "__new__",
        legacy: current?.legacy,
        requalifiedAt:
            current?.mode === "nst" && mode !== "nst"
                ? new Date().toISOString()
                : current?.requalifiedAt,
    };
    if (mode !== "nst" && !schedule([candidate], records, today)[0].dueDate)
        throw Error(
            "Per gli strumenti soggetti a taratura indicare la scadenza taratura.",
        );
    return value;
}
export function validateCalibration(
    v: any,
    instruments: any[],
    current: any = null,
    today = todayInRome(),
    systemContext: any = null,
) {
    const instrument = instruments.find((i) => i.id === v?.instrumentId);
    if (!instrument) throw Error("Selezionare uno strumento esistente.");
    if (current && current.instrumentId !== v.instrumentId)
        throw Error(
            "Una taratura registrata non può essere spostata su un altro strumento.",
        );
    if (
        !current &&
        (instrument.mode === "nst" || instrument.usage === "retired")
    )
        throw Error(
            "Riattivare lo strumento prima di registrare una taratura.",
        );
    const date = calendarDate(v.date);
    if (date > today)
        throw Error("Non è possibile registrare tarature future.");
    if (current?.baseline)
        return { ...current, date, notes: text(v.notes || "", 30000) };
    if (!instrument.frequencyMonths)
        throw Error(
            "Completare la frequenza di taratura nella scheda strumento prima di registrare la taratura.",
        );
    const evaluated = systemContext
        ? evaluateCalibrationSystem(
              systemContext.snapshot,
              v.systemReadings || [],
              systemContext.tolerance,
              systemContext.unit,
          )
        : null;
    const outcome = evaluated ? evaluated.outcome : choice(v.outcome, outcomes),
        mode = choice(v.mode, { internal: 1, external: 1 });
    if (
        !evaluated &&
        (!Array.isArray(v.measurements) || v.measurements.length > 300)
    )
        throw Error("Elenco misure non valido.");
    const numeric = (x: any) => {
        if (x == null || x === "") return null;
        if (typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > 1e15)
            throw Error("Valore di misura non valido.");
        return x;
    };
    const measurements = evaluated
        ? evaluated.measurements
        : v.measurements.map((m: any) => {
              const nominal = numeric(m.nominal),
                  measured = numeric(m.measured),
                  tolerance = numeric(m.tolerance),
                  uncertainty = numeric(m.uncertainty);
              if (
                  (tolerance != null && tolerance < 0) ||
                  (uncertainty != null && uncertainty < 0)
              )
                  throw Error(
                      "Tolleranza e incertezza non possono essere negative.",
                  );
              const deviation =
                  nominal != null && measured != null
                      ? measured - nominal
                      : null;
              return {
                  label: text(m.label || "", 300, true),
                  unit: text(m.unit || "", 30),
                  nominal,
                  measured,
                  tolerance,
                  uncertainty,
                  deviation,
                  pass:
                      deviation != null && tolerance != null
                          ? Math.abs(deviation) <= tolerance + 1e-12
                          : null,
              };
          });
    if (outcome === "fit" && measurements.some((m: any) => m.pass === false))
        throw Error(
            "Una misura è fuori tolleranza: non è possibile dichiarare la taratura idonea.",
        );
    const cost = numeric(v.cost);
    if (cost != null && cost < 0) throw Error("Costo non valido.");
    const currency = text(v.currency || "", 3);
    if (cost != null && !/^[A-Z]{3}$/.test(currency))
        throw Error("Indicare una valuta a tre lettere per il costo.");
    return {
        instrumentId: instrument.id,
        date,
        mode,
        outcome,
        provider: text(v.provider || "", 500),
        certificate: text(v.certificate || "", 300),
        method: text(v.method || "", 10000),
        reference: text(v.reference || "", 2000),
        notes: text(v.notes || "", 30000),
        cost,
        currency,
        measurements,
        baseline: current?.baseline === true,
        systemId: systemContext?.snapshot.id || "",
        systemCategory: systemContext?.category || "",
        systemSnapshot: systemContext?.snapshot || null,
        systemTolerance: systemContext?.tolerance ?? null,
        systemToleranceUnit: systemContext?.unit || "",
        systemInstrumentRevision: systemContext?.instrumentRevision ?? null,
        systemReadings: evaluated
            ? evaluated.measurements.map((m) => ({
                  pointId: m.pointId,
                  readings: m.readings,
              }))
            : [],
    };
}
export function schedule(
    instruments: any[],
    records: any[],
    today = todayInRome(),
    horizon = 30,
) {
    calendarDate(today);
    const days = (a: string, b: string) =>
        Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
    return instruments.map((i) => {
        const history = records
            .filter(
                (r) =>
                    r.instrumentId === i.id &&
                    r.date <= today &&
                    (!i.requalifiedAt ||
                        (!r.baseline &&
                            r.date >= i.requalifiedAt.slice(0, 10) &&
                            r.createdAt >= i.requalifiedAt)),
            )
            .sort(
                (a, b) =>
                    b.date.localeCompare(a.date) ||
                    Number(!!a.baseline) - Number(!!b.baseline) ||
                    String(b.createdAt || "").localeCompare(
                        String(a.createdAt || ""),
                    ) ||
                    (a.outcome === "unfit" && b.outcome !== "unfit"
                        ? -1
                        : b.outcome === "unfit" && a.outcome !== "unfit"
                          ? 1
                          : 0) ||
                    String(b.id).localeCompare(String(a.id)),
            );
        const last = history[0],
            lastDate = last?.date || "";
        let declaredDate = "";
        try {
            if (i.initialDueDate || i.legacy?.nextDate)
                declaredDate = calendarDate(
                    i.initialDueDate || i.legacy.nextDate,
                );
        } catch {
            /* Missing/invalid historical dates remain explicit. */
        }
        const dueDate =
            i.mode === "nst"
                ? ""
                : lastDate && i.frequencyMonths
                  ? addMonths(lastDate, i.frequencyMonths)
                  : declaredDate;
        const daysRemaining = dueDate ? days(dueDate, today) : null;
        const pendingJudgement =
            last &&
            (["unfit", "review"].includes(last.outcome) ||
                (!last.baseline && last.outcome === "unknown"));
        const state =
            i.mode === "nst"
                ? i.usage !== "in_use"
                    ? "inactive"
                    : "nst"
                : !dueDate
                  ? "missing"
                  : !i.frequencyMonths
                    ? "frequency"
                    : i.usage !== "in_use"
                      ? "inactive"
                      : pendingJudgement ||
                          ["unfit", "review"].includes(i.suitability)
                        ? "unfit"
                        : i.requalifiedAt && !last
                          ? "requalification"
                          : daysRemaining! < 0
                            ? "overdue"
                            : daysRemaining === 0
                              ? "today"
                              : daysRemaining! <= horizon
                                ? "upcoming"
                                : "valid";
        const reviewDate =
                i.mode === "nst" && i.nstDate && i.nstReviewMonths
                    ? addMonths(i.nstDate, i.nstReviewMonths)
                    : "",
            reviewDays = reviewDate ? days(reviewDate, today) : null;
        const nstReviewLabel =
            i.mode !== "nst"
                ? ""
                : !i.nstReviewMonths
                  ? "Non soggetto a taratura"
                  : reviewDays == null
                    ? "Data revisione NST mancante"
                    : reviewDays < 0
                      ? "Revisione scaduta"
                      : reviewDays === 0
                        ? "Revisione oggi"
                        : reviewDays <= horizon
                          ? "Revisione in scadenza"
                          : "Verificato";
        return {
            ...i,
            instrumentId: i.id,
            lastDate,
            lastOutcome: last?.outcome || "unknown",
            dueDate,
            dueDateSource:
                i.mode === "nst"
                    ? ""
                    : lastDate && i.frequencyMonths
                      ? "calculated"
                      : declaredDate
                        ? "declared"
                        : "",
            daysRemaining,
            daysOverdue:
                daysRemaining != null ? Math.max(0, -daysRemaining) : null,
            state,
            stateLabel: states[state],
            modeLabel: modes[i.mode],
            usageLabel: usages[i.usage],
            suitabilityLabel: outcomes[i.suitability],
            reviewDate,
            reviewDays,
            nstReviewLabel,
            reviewOverdue:
                i.mode === "nst" &&
                i.usage === "in_use" &&
                reviewDays != null &&
                reviewDays <= 0,
            calibrationCount: history.filter((r) => !r.baseline).length,
        };
    });
}
export function cleanAttachment(a: any) {
    const clean = validateAttachment(a);
    if (clean.path) return { ...clean, data: null };
    if (
        typeof a.data !== "string" ||
        a.data.length > 8 * 1024 * 1024 ||
        !a.data.length ||
        !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
            a.data,
        )
    )
        throw Error("Contenuto allegato non valido o troppo grande.");
    return { ...clean, data: a.data };
}
export function cleanImport(input: any, today = todayInRome()) {
    if (
        input?.version !== 1 ||
        !Array.isArray(input.instruments) ||
        input.instruments.length > 100000 ||
        JSON.stringify(input).length > 9 * 1024 * 1024
    )
        throw Error("Archivio Access non valido.");
    const issues: any[] = [],
        instruments: any[] = [],
        calibrations: any[] = [],
        seen = new Set<string>();
    for (const r of input.instruments) {
        try {
            const originalCode = String(r.code || "").trim(),
                code = text(
                    originalCode ||
                        "DA-CODIFICARE:" + text(r.serial, 100, true),
                    128,
                    true,
                ),
                key = code.toLocaleLowerCase("it");
            if (seen.has(key)) throw Error("Codice duplicato.");
            if (!originalCode)
                issues.push({
                    code,
                    reason: "Codice interno mancante in Access: assegnato un identificatore provvisorio dalla matricola. Completare la scheda.",
                });
            const mode = {
                Interna: "internal",
                Esterna: "external",
                NST: "nst",
            }[r.calibrationMode];
            if (!mode) throw Error("Regime di taratura sconosciuto.");
            let frequencyMonths: number | null = null;
            if (r.frequencyYears != null) {
                const n = Number(r.frequencyYears) * 12;
                if (!Number.isInteger(n) || n < 1 || n > 1200)
                    issues.push({
                        code,
                        reason: "Frequenza storica non valida: lasciata vuota.",
                    });
                else frequencyMonths = n;
            }
            let lastDate = "";
            if (r.lastDate)
                try {
                    lastDate = optionalDate(r.lastDate, today);
                } catch {
                    issues.push({
                        code,
                        reason: "Ultima taratura con data non valida/futura: esclusa dal calcolo.",
                    });
                }
            const suitability = /GUASTO|Non idoneo/i.test(r.suitability || "")
                ? "unfit"
                : /VALUTARE/i.test(r.suitability || "")
                  ? "review"
                  : /^IDONEO$/i.test(r.suitability || "")
                    ? "fit"
                    : "unknown";
            let initialDueDate = "";
            if (mode !== "nst" && r.nextDate) {
                try {
                    initialDueDate = calendarDate(r.nextDate);
                } catch {
                    issues.push({
                        code,
                        reason: "Scadenza taratura storica non valida: da completare.",
                    });
                }
            }
            if (
                mode !== "nst" &&
                !initialDueDate &&
                !(lastDate && frequencyMonths)
            )
                issues.push({
                    code,
                    reason: "Scadenza taratura mancante per strumento non NST: completare la scheda.",
                });
            const value = {
                id: code,
                code,
                description: r.description || code,
                serial: r.serial || "",
                category: r.category || "Da classificare",
                location: r.location || "Da assegnare",
                model: r.model || "",
                measurementRange: r.measurementRange || "",
                useRange: r.useRange || "",
                resolution: r.resolution || "",
                tolerance: r.tolerance || "",
                method: r.method || "",
                responsible: "",
                notes: r.notes || "",
                mode,
                usage: r.usage === "In Uso" ? "in_use" : "unused",
                suitability,
                frequencyMonths,
                initialDueDate,
                nstReviewMonths: null,
                nstReason: "",
                nstDate: "",
                legacy: {
                    originalCode,
                    lastDate: r.lastDate || "",
                    suitability: r.suitability || "",
                    nextDate: r.nextDate || "",
                    frequencyYears: r.frequencyYears ?? null,
                    sourceId: code,
                },
            };
            (value as any).nstVerified = false;
            instruments.push(value);
            seen.add(key);
            if (lastDate)
                calibrations.push({
                    id: "access:" + code,
                    instrumentId: code,
                    date: lastDate,
                    mode,
                    outcome: "unknown",
                    provider: "",
                    certificate: "",
                    method: r.method || "",
                    reference: "",
                    notes: "Ultima data presente in Access: esito, misure e certificato non disponibili nello storico.",
                    cost: null,
                    currency: "",
                    measurements: [],
                    baseline: true,
                });
        } catch (e) {
            issues.push({
                code: r.code || "",
                reason: (e as Error).message,
                excluded: true,
            });
        }
    }
    return {
        instruments,
        calibrations,
        issues,
        source: String(input.source || ""),
        readAt: String(input.readAt || ""),
        today,
        seedHash:
            typeof input.seedHash === "string" &&
            /^[a-f0-9]{64}$/.test(input.seedHash)
                ? input.seedHash
                : null,
    };
}
