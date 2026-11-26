import type { AnalysisContext } from "../../main/modules/analysis-navigation-model";
const ipc = require("electron").ipcRenderer;
export function installAnalysisLinks(
    resolve: (target: HTMLElement) => AnalysisContext | null,
    error: (message: string) => void,
) {
    let prepareTimer: ReturnType<typeof setTimeout> | undefined;
    let preparedKey = "";
    const cancel = () => {
        clearTimeout(prepareTimer);
        preparedKey = "";
        ipc.send("analysis-context-menu-cancel");
    };
    const prepare = (event: Event) => {
        if (!(event.target instanceof Element)) return;
        const context = resolve(event.target as HTMLElement);
        const key = context ? JSON.stringify(context) : "";
        if (key === preparedKey) return;
        clearTimeout(prepareTimer);
        preparedKey = key;
        if (!context) {
            ipc.send("analysis-context-menu-prepare", null);
            return;
        }
        // Ignore quick passes over a table; warm only the cell where the pointer
        // or keyboard focus settles. No menu or navigation is triggered here.
        prepareTimer = setTimeout(() => ipc.send("analysis-context-menu-prepare", context), 100);
    };
    document.addEventListener("pointerover", prepare);
    document.addEventListener("focusin", prepare);
    document.addEventListener("pointerdown", event => {
        if (event.button !== 2) cancel();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") cancel();
    });
    document.addEventListener("contextmenu", (event) => {
        const context = resolve(event.target as HTMLElement);
        if (!context) return;
        clearTimeout(prepareTimer);
        event.preventDefault();
        void ipc
            .invoke("analysis-context-menu", context)
            .then((result: any) => {
                if (!result.ok) error(result.error);
            })
            .catch((e: Error) => error(e.message));
    });
    ipc.on("analysis-navigation-error", (_event: any, message: string) =>
        error(message),
    );
}
