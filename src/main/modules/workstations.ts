import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import {
    defaultStationConfig,
    stationAccess,
    stationCatalog,
    StationConfig,
    validateStationConfig,
} from "./workstations-model";
import { requestAypiBackend } from "./file-manager/backend-client";

let config: StationConfig;
let loadError = "";
let revision = 0;
const configPath = () =>
    path.join(app.getPath("userData"), "workstations.json");
function readConfig() {
    if (config) return config;
    try {
        const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
        config = validateStationConfig(raw);
        revision = Number.isSafeInteger(raw.revision) ? raw.revision : 0;
    } catch (error) {
        config = defaultStationConfig();
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            loadError =
                "Impossibile leggere la configurazione postazioni. Accedi come amministratore per ripristinarla.";
            config.activeId = "default";
            for (const entry of stationCatalog)
                config.profiles[0].rules[entry.id] = "hidden";
        }
    }
    return config;
}
export function canAccessStationEntry(id: string) {
    return stationAccess(readConfig(), id) === "accessible";
}
function snapshot() {
    return {
        config: readConfig(),
        catalog: stationCatalog,
        revision,
        error: loadError,
    };
}
function writeConfig(next: StationConfig, nextRevision = revision) {
    const file = configPath(),
        temporary = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
        temporary,
        JSON.stringify({ ...next, revision: nextRevision }, null, 2),
        "utf8",
    );
    fs.renameSync(temporary, file);
    config = next;
    revision = nextRevision;
}
function requireClosedModules(main: BrowserWindow, next: StationConfig) {
    const changesAccess = stationCatalog.some(
        (entry) =>
            stationAccess(next, entry.id) !==
            stationAccess(readConfig(), entry.id),
    );
    if (
        changesAccess &&
        BrowserWindow.getAllWindows().some(
            (window) =>
                window !== main &&
                !window.isDestroyed() &&
                (window.isVisible() || window.isMinimized()),
        )
    )
        throw Error(
            "Chiudi le finestre dei moduli prima di cambiare la vista della postazione.",
        );
}
function broadcast() {
    for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed())
            window.webContents.send("workstations-changed", snapshot());
}

/** Apply the same policy to launch requests from the home, shortcuts and other modules. */
export function installStationLaunchGuards() {
    const entryFor = (channel: string, payload: any) => {
        if (["robot-status-custom", "ping-robot-custom"].includes(channel))
            return stationCatalog.find((entry) => entry.id === "forge-robots");
        if (channel === "open-production-planner-analysis-window")
            return stationCatalog.find(
                (entry) => entry.id === "open-production-planner-window",
            );
        if (channel === "open-address")
            return stationCatalog.find(
                (entry) => entry.addressKey === payload?.key,
            );
        if (channel === "analysis-navigate")
            return stationCatalog.find(
                (entry) => entry.target === payload?.target,
            );
        const aliases: Record<string, string> = {
            "open-maintenance-window": "moduli.openManutenzioni",
            "open-measurement-window": "moduli.openTarature",
            "open-tooling-window": "moduli.openUtensili",
            "open-processing-cycles-window": "infoarticoli.openCicli",
            "open-supplier-evaluation-window": "moduli.openFornitori",
            "open-product-manager-cart-window": "open-product-manager-window",
            "open-product-manager-interventions-window":
                "open-product-manager-window",
            "open-assignees-manager-window": "open-ferie-permessi-window",
            "pm-open-calendar-assignees": "open-ferie-permessi-window",
            "pm-open-calendar-admins": "open-ferie-permessi-window",
            "open-admin-manager-window": "open-ferie-permessi-window",
            "open-ferie-permessi-hours-window": "open-ferie-permessi-window",
            "open-ferie-permessi-analysis-window": "open-ferie-permessi-window",
            "hierarchy-open-batch-rename": "open-batch-rename-window",
            "hierarchy-compare-folder-A": "open-compare-folders-window",
            "hierarchy-compare-folder-B": "open-compare-folders-window",
            "open-warehouse-movement-details-window":
                "open-inventario-magazzino-window",
            "warehouse-3d-open-window": "open-inventario-magazzino-window",
        };
        return stationCatalog.find(
            (entry) =>
                entry.channel === channel ||
                entry.id === aliases[channel] ||
                (!!entry.target && `${entry.target}-open` === channel),
        );
    };
    const on = ipcMain.on.bind(ipcMain);
    ipcMain.on = ((channel: string, listener: (...args: any[]) => any) =>
        on(channel, (event, ...args) => {
            const entry = entryFor(channel, args[0]);
            if (entry && !canAccessStationEntry(entry.id)) {
                event.sender.send(
                    "workstation-access-denied",
                    "Modulo non accessibile su questa postazione.",
                );
                return;
            }
            return listener(event, ...args);
        })) as typeof ipcMain.on;
    const handle = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = ((channel: string, listener: (...args: any[]) => any) =>
        handle(channel, (event, ...args) => {
            const entry = entryFor(channel, args[0]);
            if (entry && !canAccessStationEntry(entry.id))
                return {
                    ok: false,
                    error: "Modulo non accessibile su questa postazione.",
                };
            return listener(event, ...args);
        })) as typeof ipcMain.handle;
}

export function registerWorkstations(
    main: BrowserWindow,
    isAdmin: () => boolean,
    options: {
        request?: typeof requestAypiBackend;
        getCredential?: () => string | null;
    } = {},
) {
    const request = options.request || requestAypiBackend;
    let refreshing: Promise<any> | null = null;
    const refresh = () => {
        if (refreshing) return refreshing;
        refreshing = (async () => {
            try {
                const shared = await request("/api/shared/workstations", {
                    timeoutMs: 5000,
                });
                const current = readConfig();
                const activeId = shared.profiles?.some(
                    (profile: any) => profile.id === current.activeId,
                )
                    ? current.activeId
                    : "";
                const next = validateStationConfig({ ...shared, activeId });
                requireClosedModules(main, next);
                writeConfig(next, shared.revision);
                loadError =
                    current.activeId && !activeId
                        ? "La postazione scelta è stata rimossa. Scegli nuovamente la tua postazione; nel frattempo tutti i moduli sono ON."
                        : "";
                broadcast();
            } catch (error) {
                loadError = `Catalogo condiviso non aggiornato: ${(error as Error).message}. Sono disponibili gli ultimi profili salvati su questo PC.`;
            }
            return snapshot();
        })().finally(() => {
            refreshing = null;
        });
        return refreshing;
    };
    const requireAdmin = (event: Electron.IpcMainInvokeEvent) => {
        if (event.sender !== main.webContents || !isAdmin())
            throw Error(
                "Accedi con F2 e password amministratore per gestire le postazioni.",
            );
    };
    ipcMain.handle("workstations-get", () => refresh());
    ipcMain.handle("workstations-select", (event, payload) => {
        try {
            if (event.sender !== main.webContents)
                throw Error(
                    "Selezione consentita solo dal menu Postazione di questo PC.",
                );
            if (
                !payload ||
                typeof payload.id !== "string" ||
                Object.keys(payload).some((key) => key !== "id")
            )
                throw Error("Selezione postazione non valida.");
            const next = validateStationConfig({
                ...readConfig(),
                activeId: payload.id,
            });
            requireClosedModules(main, next);
            writeConfig(next);
            broadcast();
            return { ok: true, ...snapshot() };
        } catch (error) {
            return { ok: false, error: (error as Error).message };
        }
    });
    ipcMain.handle("workstations-save", async (event, payload) => {
        try {
            requireAdmin(event);
            const profiles = validateStationConfig({
                ...payload,
                activeId: "",
            }).profiles;
            const current = readConfig();
            const next = {
                version: 1 as const,
                profiles,
                activeId: profiles.some(
                    (profile) => profile.id === current.activeId,
                )
                    ? current.activeId
                    : "",
            };
            requireClosedModules(main, next);
            const credential = options.getCredential
                ? options.getCredential()
                : isAdmin()
                  ? "AGPress"
                  : null;
            if (!credential) throw Error("Sessione amministratore scaduta.");
            const shared = await request("/api/shared/workstations", {
                method: "PUT",
                headers: { "x-aypi-workstations-password": credential },
                body: {
                    version: 1,
                    profiles,
                    revision: payload.revision ?? revision,
                },
                timeoutMs: 10000,
            });
            const localId = readConfig().activeId;
            writeConfig(
                {
                    ...next,
                    activeId: profiles.some((profile) => profile.id === localId)
                        ? localId
                        : "",
                },
                shared.revision,
            );
            loadError = "";
            broadcast();
            return { ok: true, ...snapshot() };
        } catch (error) {
            return { ok: false, error: (error as Error).message };
        }
    });
    ipcMain.handle("workstations-export", async (event, payload) => {
        try {
            requireAdmin(event);
            const { profiles } = validateStationConfig({
                ...payload,
                activeId: "",
            });
            const result = await dialog.showSaveDialog(main, {
                title: "Esporta postazioni",
                defaultPath: "AyPi-postazioni.json",
                filters: [{ name: "Postazioni AyPi", extensions: ["json"] }],
            });
            requireAdmin(event);
            if (result.canceled) return { ok: true, canceled: true };
            fs.writeFileSync(
                result.filePath!,
                JSON.stringify({ version: 1, profiles }, null, 2),
                "utf8",
            );
            return { ok: true };
        } catch (error) {
            return { ok: false, error: (error as Error).message };
        }
    });
    ipcMain.handle("workstations-import", async (event) => {
        try {
            requireAdmin(event);
            const result = await dialog.showOpenDialog(main, {
                title: "Importa postazioni",
                properties: ["openFile"],
                filters: [{ name: "Postazioni AyPi", extensions: ["json"] }],
            });
            requireAdmin(event);
            if (result.canceled) return { ok: true, canceled: true };
            if (fs.statSync(result.filePaths[0]).size > 1024 * 1024)
                throw Error("File postazioni troppo grande.");
            const imported = validateStationConfig({
                ...JSON.parse(fs.readFileSync(result.filePaths[0], "utf8")),
                activeId: "",
            });
            return { ok: true, config: imported };
        } catch (error) {
            return { ok: false, error: (error as Error).message };
        }
    });
}
