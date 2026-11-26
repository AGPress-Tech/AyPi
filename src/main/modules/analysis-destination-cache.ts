import type { AnalysisContext, AnalysisTarget } from "./analysis-navigation-model";

/** Bounded, shared probes: at most two reads, including speculative hover reads. */
export class AnalysisDestinationCache {
    private readonly values = new Map<string, { value: boolean; until: number }>();
    private readonly pending = new Map<string, { promise: Promise<boolean>; run: () => void }>();
    private readonly queue: (() => void)[] = [];
    private active = 0;
    private epoch = 0;

    constructor(
        private readonly read: (target: AnalysisTarget, context: AnalysisContext) => Promise<boolean>,
        private readonly now = Date.now,
    ) {}

    clear() {
        this.epoch++;
        this.values.clear();
    }

    probe(target: AnalysisTarget, context: AnalysisContext, foreground = false): Promise<boolean> {
        const key = JSON.stringify([this.epoch, target, Object.entries(context).sort(([a], [b]) => a.localeCompare(b))]);
        const cached = this.values.get(key);
        if (cached && cached.until > this.now()) return Promise.resolve(cached.value);
        this.values.delete(key);
        const existing = this.pending.get(key);
        if (existing) {
            if (foreground) {
                const position = this.queue.indexOf(existing.run);
                if (position >= 0) this.queue.unshift(...this.queue.splice(position, 1));
            }
            return existing.promise;
        }
        if (this.pending.size >= 64) return Promise.resolve(false);
        const epoch = this.epoch;
        let resolve!: (value: boolean) => void;
        const promise = new Promise<boolean>(done => { resolve = done; });
        const run = () => {
            this.active++;
            void Promise.resolve().then(() => this.read(target, context)).then(value => {
                if (epoch !== this.epoch) { resolve(false); return; }
                this.values.set(key, { value, until: this.now() + (value ? 15000 : 2000) });
                while (this.values.size > 256) this.values.delete(this.values.keys().next().value!);
                resolve(value);
            }, () => resolve(false)).finally(() => {
                this.pending.delete(key);
                this.active--;
                this.pump();
            });
        };
        this.pending.set(key, { promise, run });
        if (foreground) this.queue.unshift(run);
        else this.queue.push(run);
        this.pump();
        return promise;
    }

    private pump() {
        while (this.active < 2 && this.queue.length) this.queue.shift()!();
    }
}
