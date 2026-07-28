type RequestMode = string;

interface RequestStoreDependencies {
    interventionMode: RequestMode;
    normalize: (payload: unknown) => any[];
    validate: (payload: any[]) => { ok: boolean };
    request: (
        endpoint: string,
        options: { method: string; body: any[] },
    ) => Promise<unknown>;
    getPurchasingRequests: () => unknown;
    setPurchasingRequests: (requests: any[]) => void;
    getInterventions: () => unknown;
    setInterventions: (requests: any[]) => void;
    showError: (message: string, detail: string) => void;
}

function errorDetail(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function createRequestStore(dependencies: RequestStoreDependencies) {
    function isIntervention(mode: RequestMode) {
        return mode === dependencies.interventionMode;
    }

    function read(mode: RequestMode) {
        try {
            const source = isIntervention(mode)
                ? dependencies.getInterventions()
                : dependencies.getPurchasingRequests();
            const normalized = dependencies.normalize(source);
            dependencies.validate(normalized);
            return normalized;
        } catch (error) {
            dependencies.showError(
                "Errore lettura richieste.",
                errorDetail(error),
            );
            return [];
        }
    }

    function save(payload: unknown, mode: RequestMode) {
        try {
            const normalized = dependencies.normalize(payload);
            if (!dependencies.validate(normalized).ok) return false;

            const intervention = isIntervention(mode);
            if (intervention) {
                dependencies.setInterventions(normalized);
            } else {
                dependencies.setPurchasingRequests(normalized);
            }

            const endpoint = intervention
                ? "/api/product-manager/interventions"
                : "/api/product-manager/requests";
            const errorMessage = intervention
                ? "Errore salvataggio interventi backend."
                : "Errore salvataggio richieste backend.";
            dependencies
                .request(endpoint, {
                    method: "PUT",
                    body: normalized,
                })
                .catch((error) => {
                    dependencies.showError(
                        errorMessage,
                        errorDetail(error),
                    );
                });
            return true;
        } catch (error) {
            dependencies.showError(
                "Errore salvataggio richieste.",
                errorDetail(error),
            );
            return false;
        }
    }

    return { read, save };
}
