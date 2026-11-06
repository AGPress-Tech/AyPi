import fs from "fs";
import path from "path";

export const TARGET_METRICS = ["Ricavi di Produzione", "Margine 3", "Costi gestionali"] as const;
export type TargetMetric = typeof TARGET_METRICS[number];
export type Target = { year: number; from: number; to: number; metric: TargetMetric; value: number; updatedAt: string };
export type Targets = Record<string, Target>;
export const targetKey = (scope: {year:number;from:number;to:number;metric:string}) => `${scope.year}/${scope.from}/${scope.to}/${scope.metric}`;
export function targetResult(actual: number, target: number, metric: TargetMetric) {
    const gap = metric === "Costi gestionali" ? target-actual : actual-target;
    return {gap,reached:gap>=0,percent:target>0 ? actual/target*100 : null};
}

export function validateTarget(input: any) {
    if (!input || !Number.isInteger(input.year) || input.year < 1900 || input.year > 9999
        || !Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from < 1 || input.to > 12 || input.from > input.to
        || !TARGET_METRICS.includes(input.metric)) throw new Error("Indicatore o periodo dell’obiettivo non valido.");
    if (input.value !== null && (typeof input.value !== "number" || !Number.isFinite(input.value) || input.value < 0 || input.value > 1e12
        || input.value === 0 && input.metric !== "Margine 3")) throw new Error("Inserire un importo positivo. Per il margine è ammesso anche zero.");
    return {year:input.year,from:input.from,to:input.to,metric:input.metric as TargetMetric,value:input.value as number|null};
}
export async function readTargets(file: string): Promise<Targets> {
    try {
        const parsed = JSON.parse(await fs.promises.readFile(file,"utf8"));
        if (parsed.version !== 1 || !Array.isArray(parsed.targets)) throw new Error("Formato non riconosciuto");
        const targets: Targets = Object.create(null);
        for (const raw of parsed.targets) {
            const target = validateTarget(raw);
            if (target.value === null) throw new Error("Obiettivo salvato senza importo");
            targets[targetKey(target)] = {...target,value:target.value,updatedAt:String(raw.updatedAt||"")};
        }
        return targets;
    } catch(error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.create(null);
        throw new Error("Impossibile leggere gli obiettivi salvati. " + (error instanceof Error ? error.message : String(error)));
    }
}
export async function saveTarget(file: string, input: unknown): Promise<Targets> {
    const scope = validateTarget(input), targets = await readTargets(file), key = targetKey(scope);
    if (scope.value === null) delete targets[key];
    else targets[key] = {...scope,value:scope.value,updatedAt:new Date().toISOString()};
    await fs.promises.mkdir(path.dirname(file),{recursive:true});
    const temp = file + ".tmp";
    try {
        await fs.promises.writeFile(temp,JSON.stringify({version:1,targets:Object.values(targets)},null,2),"utf8");
        await fs.promises.rename(temp,file);
    } catch(error) { await fs.promises.unlink(temp).catch(()=>{}); throw error; }
    return targets;
}
