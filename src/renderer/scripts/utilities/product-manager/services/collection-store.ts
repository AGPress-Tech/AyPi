interface CollectionStoreDependencies<T> {
    normalize: (payload: unknown) => T;
    validate: (payload: T) => { ok: boolean };
    getCached: () => unknown;
    setCached: (payload: T) => void;
    request: (
        endpoint: string,
        options: { method: string; body: T },
    ) => Promise<unknown>;
    endpoint: string;
    backendErrorMessage: string;
    saveErrorMessage: string;
    showError: (message: string, detail: string) => void;
}

function errorDetail(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function createCollectionStore<T>(
    dependencies: CollectionStoreDependencies<T>,
) {
    function load() {
        return dependencies.normalize(dependencies.getCached());
    }

    function save(payload: unknown) {
        try {
            const normalized = dependencies.normalize(payload);
            if (!dependencies.validate(normalized).ok) return false;
            dependencies.setCached(normalized);
            dependencies
                .request(dependencies.endpoint, {
                    method: "PUT",
                    body: normalized,
                })
                .catch((error) => {
                    dependencies.showError(
                        dependencies.backendErrorMessage,
                        errorDetail(error),
                    );
                });
            return true;
        } catch (error) {
            dependencies.showError(
                dependencies.saveErrorMessage,
                errorDetail(error),
            );
            return false;
        }
    }

    return { load, save };
}
