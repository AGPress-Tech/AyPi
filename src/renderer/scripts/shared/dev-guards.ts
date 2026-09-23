const { ipcRenderer } = require("electron");
const fs = require("fs");

const IS_DEV =
    (typeof process !== "undefined" &&
        process.env &&
        process.env.AYPI_DEV === "1") ||
    (typeof process !== "undefined" &&
        process.env &&
        process.env.NODE_ENV === "development");

if (IS_DEV) {
    // 1) DOM id checks (opt-in to avoid noisy logs)
    if (process.env && process.env.AYPI_DEV_WARN_IDS === "1") {
        const globalKey = "__aypiWarnedIds";
        const globalStore = window as unknown as Record<string, unknown>;
        const warnedIds =
            (globalStore[globalKey] as Set<string>) || new Set<string>();
        globalStore[globalKey] = warnedIds;
        const originalGetById = document.getElementById.bind(document);
        document.getElementById = (id: string) => {
            const el = originalGetById(id);
            if (!el && !warnedIds.has(id)) {
                warnedIds.add(id);
                console.warn(`[aypi-dev] Missing element id="${id}"`);
            }
            return el;
        };
    }

    // 2) onclick checks
    const checkOnclickBindings = () => {
        const nodes = document.querySelectorAll(
            "[onclick]",
        ) as NodeListOf<HTMLElement>;
        nodes.forEach((node) => {
            const attr = node.getAttribute("onclick");
            if (!attr) return;
            const match = /^\s*([a-zA-Z_$][\w$]*)\s*\(/.exec(attr);
            if (!match) return;
            const fnName = match[1];
            const fn = (window as unknown as Record<string, unknown>)[fnName];
            if (typeof fn !== "function") {
                console.warn(
                    `[aypi-dev] onclick="${attr}" missing function window.${fnName}`,
                );
            }
        });
    };
    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", checkOnclickBindings, {
            once: true,
        });
    } else {
        checkOnclickBindings();
    }

    // 3) IPC channel checks
    // Canali dei moduli caricati in finestre secondarie: possono essere registrati
    // dopo la prima lettura di dev-ipc-channels, ma sono comunque contratti noti.
    const knownChannels = new Set<string>([
        "dev-ipc-channels",
        "warehouse-3d-open-window",
        "warehouse-3d-update",
        "warehouse-3d-ready",
        "warehouse-3d-select-slot",
        "warehouse-3d-movement-action",
        "warehouse-3d-movement-action-request",
        "warehouse-inventory-local-load",
        "warehouse-inventory-local-save",
        "warehouse-inventory-focus-window",
        "open-warehouse-movement-details-window",
        "warehouse-movement-details-ready",
    ]);
    if (ipcRenderer && typeof ipcRenderer.invoke === "function") {
        const refreshKnownChannels = () => ipcRenderer
            .invoke("dev-ipc-channels")
            .then((payload: { on?: string[]; handle?: string[] } | null) => {
                if (!payload) return;
                (payload.on || []).forEach((ch) => knownChannels.add(ch));
                (payload.handle || []).forEach((ch) => knownChannels.add(ch));
            })
            .catch(() => {});
        void refreshKnownChannels();
        // La pagina principale può iniziare a caricarsi qualche istante prima che
        // setupFileManager abbia registrato tutti i moduli IPC. Aggiorna quindi il
        // catalogo anche dopo l'avvio, evitando falsi "unknown channel" in sviluppo.
        window.setTimeout(refreshKnownChannels, 300);
        window.setTimeout(refreshKnownChannels, 1200);
        window.addEventListener("focus", refreshKnownChannels);

        const originalSend = ipcRenderer.send.bind(ipcRenderer);
        ipcRenderer.send = (channel: string, ...args: unknown[]) => {
            if (knownChannels.size && !knownChannels.has(channel)) {
                console.warn(
                    `[aypi-dev] ipcRenderer.send unknown channel: ${channel}`,
                );
            }
            return originalSend(channel, ...args);
        };

        const originalInvoke = ipcRenderer.invoke.bind(ipcRenderer);
        ipcRenderer.invoke = (channel: string, ...args: unknown[]) => {
            if (knownChannels.size && !knownChannels.has(channel)) {
                console.warn(
                    `[aypi-dev] ipcRenderer.invoke unknown channel: ${channel}`,
                );
            }
            return originalInvoke(channel, ...args);
        };
    }

    // 4) require path checks (relative only)
    try {
        const Module = require("module");
        const originalLoad = Module._load;
        Module._load = function (
            request: string,
            parent: { filename?: string } | null,
            isMain: boolean,
        ) {
            if (
                typeof request === "string" &&
                request.startsWith(".") &&
                parent &&
                parent.filename
            ) {
                try {
                    const resolved = Module._resolveFilename(
                        request,
                        parent,
                        isMain,
                    );
                    if (
                        typeof resolved === "string" &&
                        !fs.existsSync(resolved)
                    ) {
                        console.warn(
                            `[aypi-dev] require missing path: ${request} -> ${resolved}`,
                        );
                    }
                } catch (err) {
                    console.warn(
                        `[aypi-dev] require resolve failed: ${request}`,
                        err,
                    );
                }
            }
            return originalLoad.apply(this, arguments);
        };
    } catch (err) {
        console.warn("[aypi-dev] Module patch failed:", err);
    }
}

export {};
