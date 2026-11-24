import { assertServiceAvailable } from "./maintenance";
export function createOperationQueue(_scope: string) {
    let tail: Promise<unknown> = Promise.resolve();

    return function enqueue<T>(
        _operationName: string,
        run: () => T | Promise<T>,
    ) {
        const guarded = () => {
            assertServiceAvailable();
            return run();
        };
        const task = tail.then(guarded, guarded);
        tail = task.then(
            () => undefined,
            () => undefined,
        );
        return task;
    };
}
