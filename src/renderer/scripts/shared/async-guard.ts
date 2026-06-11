require("./dev-guards");

type AsyncErrorReporter = (message: string, detail: string) => void;

type GuardOptions = {
    errorTitle: string;
    promiseTitle?: string;
    report: AsyncErrorReporter;
};

function normalizeErrorDetail(error: unknown) {
    if (error instanceof Error) {
        return error.stack || error.message || String(error);
    }
    return String(error || "Errore sconosciuto");
}

function createAsyncGuard(options: GuardOptions) {
    const errorTitle = String(options?.errorTitle || "Errore modulo.");
    const promiseTitle = String(
        options?.promiseTitle || `${errorTitle} (Promise).`,
    );
    const report =
        typeof options?.report === "function"
            ? options.report
            : () => undefined;

    function handle(error: unknown, customTitle?: string) {
        report(customTitle || errorTitle, normalizeErrorDetail(error));
    }

    function wrap<TArgs extends unknown[]>(
        handler: (...args: TArgs) => unknown | Promise<unknown>,
        customTitle?: string,
    ) {
        return (...args: TArgs) => {
            return Promise.resolve()
                .then(() => handler(...args))
                .catch((error) => handle(error, customTitle));
        };
    }

    function installGlobalHandlers() {
        window.addEventListener("error", (event) => {
            handle(event?.error || event?.message, errorTitle);
        });
        window.addEventListener("unhandledrejection", (event) => {
            if (typeof event?.preventDefault === "function") {
                event.preventDefault();
            }
            handle(event?.reason, promiseTitle);
        });
    }

    return {
        handle,
        wrap,
        installGlobalHandlers,
    };
}

export { createAsyncGuard, normalizeErrorDetail };

if (
    typeof module !== "undefined" &&
    module.exports &&
    !(globalThis as any).__aypiBundled
) {
    module.exports = {
        createAsyncGuard,
        normalizeErrorDetail,
    };
}
