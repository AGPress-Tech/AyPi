import { logger } from "../logging/logger";

export function createOperationQueue(scope: string) {
    let tail: Promise<unknown> = Promise.resolve();

    return function enqueue<T>(operationName: string, run: () => T | Promise<T>) {
        const startedAt = Date.now();
        const task = tail.then(run, run);
        tail = task.then(
            () => undefined,
            () => undefined,
        );
        return task.finally(() => {
            logger.info("Queue operation completed", {
                event: "queue_operation_completed",
                category: "queue",
                scope,
                operationName,
                durationMs: Date.now() - startedAt,
            });
        });
    };
}
