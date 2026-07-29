export function createOperationQueue(_scope: string) {
    let tail: Promise<unknown> = Promise.resolve();

    return function enqueue<T>(_operationName: string, run: () => T | Promise<T>) {
        const task = tail.then(run, run);
        tail = task.then(
            () => undefined,
            () => undefined,
        );
        return task;
    };
}
