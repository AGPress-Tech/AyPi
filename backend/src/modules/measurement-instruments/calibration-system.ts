export const calibrationRules = {
    mean: "Media entro nominale ± tolleranza",
    spread: "Intervallo media ± k·s entro nominale ± tolleranza",
    all: "Ogni rilevazione entro nominale ± tolleranza",
    historical: "Limiti storici calibri, con s su tutte le rilevazioni",
};
export const calibrationCategoryKey = (category: unknown) =>
    String(category || "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("it");
export function categoryCalibrationSystem(systems: any[], category: unknown) {
    const key = calibrationCategoryKey(category);
    return key
        ? systems.find(
              (system) =>
                  system.active &&
                  calibrationCategoryKey(system.category) === key,
          )
        : undefined;
}
const text = (v: any, max: number, required = false) => {
    if (typeof v !== "string" || v.length > max || (required && !v.trim()))
        throw Error("Testo del sistema mancante o troppo lungo.");
    return v.trim();
};
export function measurementNumber(v: any, required = false): number | null {
    if (v == null || v === "") {
        if (required) throw Error("Valore numerico obbligatorio.");
        return null;
    }
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e12)
        throw Error("Valore numerico non valido.");
    return v;
}
const nonnegative = (v: any, required = false) => {
    const n = measurementNumber(v, required);
    if (n != null && n < 0)
        throw Error("La tolleranza e i parametri non possono essere negativi.");
    return n;
};
export function validateCalibrationSystem(v: any) {
    if (
        !v ||
        typeof v !== "object" ||
        !Object.prototype.hasOwnProperty.call(calibrationRules, v.rule)
    )
        throw Error("Scegliere il criterio di idoneità del sistema.");
    if (!Array.isArray(v.points) || !v.points.length || v.points.length > 100)
        throw Error("Definire da 1 a 100 punti di controllo.");
    const unit = text(v.unit || "", 30),
        tolerance = nonnegative(v.tolerance),
        repetitions = Number(v.repetitions);
    if (tolerance != null && !unit)
        throw Error("Indicare l’unità della tolleranza predefinita.");
    if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100)
        throw Error("Indicare da 1 a 100 rilevazioni per punto.");
    const ids = new Set<string>(),
        labels = new Set<string>();
    const points = v.points.map((p: any, i: number) => {
        const id = text(p.id || "point-" + (i + 1), 100, true);
        if (ids.has(id)) throw Error("Identificatori dei punti duplicati.");
        ids.add(id);
        if (!["numeric", "qualitative"].includes(p.kind))
            throw Error("Tipo di controllo non valido.");
        const count =
            p.repetitions == null || p.repetitions === ""
                ? repetitions
                : p.repetitions;
        if (
            !Number.isInteger(count) ||
            count < 1 ||
            count > 100 ||
            (["spread", "historical"].includes(v.rule) &&
                p.kind === "numeric" &&
                count < 2)
        )
            throw Error(
                "Rilevazioni non valide: i criteri statistici richiedono almeno due letture.",
            );
        const pointUnit =
            p.kind === "numeric" ? text(p.unit || unit, 30, true) : "";
        const group = text(p.group || "", 200, true),
            label = text(p.label || "", 200, true),
            key = (group + "\u001f" + label).toLocaleLowerCase("it");
        if (labels.has(key))
            throw Error("Usare nomi distinti per i punti dello stesso gruppo.");
        labels.add(key);
        return {
            id,
            group,
            label,
            kind: p.kind,
            nominal:
                p.kind === "numeric"
                    ? measurementNumber(p.nominal, true)
                    : null,
            unit: pointUnit,
            tolerance: p.kind === "numeric" ? nonnegative(p.tolerance) : null,
            repetitions: count,
            repetitionsInherited: p.repetitions == null || p.repetitions === "",
        };
    });
    return {
        name: text(v.name, 200, true),
        category: text(v.category, 200, true),
        description: text(v.description || "", 10000),
        active: v.active !== false,
        rule: v.rule,
        ruleLabel: calibrationRules[v.rule],
        unit,
        tolerance,
        repetitions,
        coverage: nonnegative(v.coverage ?? 2, true),
        limitConstant: nonnegative(v.limitConstant ?? 50, true),
        limitSlope: nonnegative(v.limitSlope ?? 0.1, true),
        limitScale: nonnegative(v.limitScale ?? 0.001, true),
        marginScale: nonnegative(v.marginScale ?? 0.001, true),
        strict: v.strict === true,
        points,
        calculationVersion: 1,
    };
}
/** Missing readings stay missing; statistics always use all entered readings. */
export function evaluateCalibrationSystem(
    system: any,
    submitted: any[],
    tolerance: number | null,
    toleranceUnit: string,
) {
    if (!Array.isArray(submitted) || submitted.length > 100)
        throw Error("Rilevazioni non valide.");
    const submittedIds = new Set<string>();
    for (const r of submitted) {
        if (
            submittedIds.has(r.pointId) ||
            !system.points.some((p) => p.id === r.pointId)
        )
            throw Error(
                "Punto di misura duplicato o non previsto dal sistema.",
            );
        submittedIds.add(r.pointId);
    }
    const measurements = system.points.map((p) => {
        const values =
            submitted.find((r) => r.pointId === p.id)?.readings || [];
        if (!Array.isArray(values) || values.length > p.repetitions)
            throw Error("Numero di rilevazioni superiore a quello previsto.");
        const readings = Array.from({ length: p.repetitions }, (_, i) => {
            const v = values[i];
            if (v == null || v === "") return null;
            if (p.kind === "qualitative") {
                if (!["ok", "not_ok"].includes(v))
                    throw Error("Esito qualitativo non valido.");
                return v;
            }
            return measurementNumber(v);
        });
        const count = readings.filter((v) => v != null).length,
            complete = count === p.repetitions;
        const base = {
            pointId: p.id,
            group: p.group,
            label: p.group + " · " + p.label,
            pointLabel: p.label,
            kind: p.kind,
            unit: p.unit,
            nominal: p.nominal,
            repetitions: p.repetitions,
            readings,
            count,
            complete,
        };
        if (p.kind === "qualitative")
            return {
                ...base,
                measured: null,
                mean: null,
                deviation: null,
                standardDeviation: null,
                tolerance: null,
                lower: null,
                upper: null,
                acceptanceLower: null,
                acceptanceUpper: null,
                pass: readings.includes("not_ok")
                    ? false
                    : complete
                      ? true
                      : null,
            };
        const numbers = readings.filter((v) => v != null) as number[];
        const mean = count
            ? numbers.reduce((sum, n) => sum + n, 0) / count
            : null;
        const variance =
            count > 1
                ? numbers.reduce((sum, n) => sum + (n - mean!) ** 2, 0) /
                  (count - 1)
                : null;
        const standardDeviation = variance == null ? null : Math.sqrt(variance);
        const pointTolerance =
            p.tolerance ??
            (p.unit === toleranceUnit ? tolerance : null) ??
            (p.unit === system.unit ? system.tolerance : null);
        const width =
            system.rule === "historical"
                ? (system.limitConstant + system.limitSlope * p.nominal) *
                  system.limitScale
                : pointTolerance;
        const acceptanceLower = width == null ? null : p.nominal - width,
            acceptanceUpper = width == null ? null : p.nominal + width;
        const statistical = ["spread", "historical"].includes(system.rule);
        const lower =
            mean == null || standardDeviation == null
                ? null
                : mean - system.coverage * standardDeviation;
        const upper =
            mean == null || standardDeviation == null
                ? null
                : mean + system.coverage * standardDeviation;
        const margin =
            system.rule === "historical"
                ? system.marginScale === 0
                    ? 0
                    : pointTolerance == null
                      ? null
                      : pointTolerance * system.marginScale
                : 0;
        const inside = (lo: number, hi: number) => {
            if (system.strict)
                return lo > acceptanceLower! && hi < acceptanceUpper!;
            const epsilon =
                Number.EPSILON *
                Math.max(1, Math.abs(p.nominal), Math.abs(lo), Math.abs(hi)) *
                8;
            return (
                lo >= acceptanceLower! - epsilon &&
                hi <= acceptanceUpper! + epsilon
            );
        };
        const decisionLower = statistical ? lower : mean,
            decisionUpper = statistical ? upper : mean;
        const ready =
            complete &&
            width != null &&
            width >= 0 &&
            acceptanceLower != null &&
            margin != null &&
            decisionLower != null &&
            decisionUpper != null;
        const pass = !ready
            ? null
            : system.rule === "all"
              ? numbers.every((n) => inside(n, n))
              : inside(decisionLower! - margin!, decisionUpper! + margin!);
        return {
            ...base,
            measured: mean,
            mean,
            deviation: mean == null ? null : mean - p.nominal,
            standardDeviation,
            tolerance: pointTolerance,
            lower,
            upper,
            acceptanceLower,
            acceptanceUpper,
            margin,
            pass,
        };
    });
    return {
        measurements,
        outcome: measurements.some((m) => m.pass === false)
            ? "unfit"
            : measurements.every((m) => m.pass === true)
              ? "fit"
              : "review",
    };
}
