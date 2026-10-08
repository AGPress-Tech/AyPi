async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (!items.length) return [];
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length);

    await Promise.all(
        Array.from({ length: workerCount }, async () => {
            while (true) {
                const index = nextIndex++;
                if (index >= items.length) return;
                results[index] = await mapper(items[index], index);
            }
        }),
    );
    return results;
}

export { mapWithConcurrency };
