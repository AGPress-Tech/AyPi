import { createOperationQueue } from "../../shared/ops/queue";
import type { ActionContext } from "../../shared/logging/audit";
import { buildContext } from "../../shared/logging/audit";
import { logger } from "../../shared/logging/logger";
import {
    loadProductionPlannerSnapshot,
    loadProductionPlannerRevision,
    saveProductionPlannerSnapshot,
} from "./repository";

const enqueue = createOperationQueue("production-planner");
const revisionWaiters = new Set<(revision: number) => void>();

export function getProductionPlannerSnapshot() {
    return loadProductionPlannerSnapshot();
}

export function getProductionPlannerRevision() {
    return loadProductionPlannerRevision();
}

export function waitForProductionPlannerRevision(
    afterRevision: number,
    timeoutMs = 25000,
) {
    const current = getProductionPlannerRevision();
    if (current.revision > afterRevision) return Promise.resolve(current);
    return new Promise<ReturnType<typeof getProductionPlannerRevision>>(
        (resolve) => {
            const finish = () => {
                clearTimeout(timer);
                revisionWaiters.delete(onRevision);
                resolve(getProductionPlannerRevision());
            };
            const onRevision = (revision: number) => {
                if (revision > afterRevision) finish();
            };
            const timer = setTimeout(finish, timeoutMs);
            revisionWaiters.add(onRevision);
        },
    );
}

export function releaseProductionPlannerWaiters() {
    revisionWaiters.forEach((notify) => notify(Number.MAX_SAFE_INTEGER));
    revisionWaiters.clear();
}

export function saveProductionPlanner(
    state: unknown,
    baseRevision: number,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("savePlanner", async () => {
        const snapshot = saveProductionPlannerSnapshot(
            state,
            baseRevision,
            meta.actor || "Operatore AyPi",
        );
        logger.info("Production planner saved", {
            ...meta,
            event: "production_planner_saved",
            module: "production-planner",
            category: "data",
            revision: snapshot.revision,
            machines: Array.isArray((state as any)?.machines)
                ? (state as any).machines.length
                : 0,
            jobs: Array.isArray((state as any)?.jobs)
                ? (state as any).jobs.length
                : 0,
        });
        revisionWaiters.forEach((notify) => notify(snapshot.revision));
        return snapshot;
    });
}
