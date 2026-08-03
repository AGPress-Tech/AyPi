const { dialog, net } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");

const UPDATE_CONFIG = {
    provider: "github",
    owner: "AGPress-Tech",
    repo: "AyPi",
    private: false,
    url: "https://github.com/AGPress-Tech/AyPi/releases/download/",
};

const RELEASE_NOTES_URL = "https://api.github.com/repos/AGPress-Tech/AyPi/releases/latest";
const FALLBACK_RELEASE_NOTES = "Nessuna nota di rilascio disponibile.";
const FALLBACK_RELEASE_NOTES_ERROR = "Errore nel recupero delle note di rilascio.";
const RELEASE_NOTES_TIMEOUT_MS = 10000;
const PERIODIC_CHECK_MS = 2 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [
    60 * 1000,
    3 * 60 * 1000,
    10 * 60 * 1000,
    30 * 60 * 1000,
];
let updaterConfigured = false;

log.transports.file.level = "info";
autoUpdater.logger = log;
autoUpdater.setFeedURL(UPDATE_CONFIG);

async function fetchReleaseNotes() {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        RELEASE_NOTES_TIMEOUT_MS,
    );
    try {
        const response = await fetch(RELEASE_NOTES_URL, {
            signal: controller.signal,
            headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": "AyPi-AutoUpdater",
            },
        });
        if (!response.ok) {
            throw new Error(`release notes status ${response.status}`);
        }
        const data = await response.json();
        return data.body || FALLBACK_RELEASE_NOTES;
    } catch (error) {
        const detail =
            error && error.name === "AbortError"
                ? `timeout dopo ${RELEASE_NOTES_TIMEOUT_MS} ms`
                : error;
        log.warn("Note di rilascio non disponibili:", detail);
        return FALLBACK_RELEASE_NOTES_ERROR;
    } finally {
        clearTimeout(timeout);
    }
}

function bringUpdatePromptToFront(mainWindow) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.flashFrame(true);
}

function setupAutoUpdater(mainWindow) {
    if (updaterConfigured) return;
    updaterConfigured = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    const state = {
        checkInFlight: false,
        downloaded: false,
        installPromptShown: false,
        installStarted: false,
        availableNoticeShown: false,
        failureNoticeShown: false,
        failures: 0,
        retryTimer: null,
        periodicTimer: null,
        lastFailureAt: 0,
        lastProgressLogAt: 0,
        lastProgressPercent: -1,
    };

    const clearTimer = (name) => {
        if (!state[name]) return;
        clearTimeout(state[name]);
        state[name] = null;
    };

    const armTimer = (name, delay, callback) => {
        clearTimer(name);
        state[name] = setTimeout(() => {
            state[name] = null;
            callback();
        }, delay);
        state[name]?.unref?.();
    };

    const schedulePeriodicCheck = () => {
        if (state.downloaded || state.installStarted) return;
        armTimer("periodicTimer", PERIODIC_CHECK_MS, () => {
            void checkForUpdates("periodico");
        });
        log.info("Prossimo controllo aggiornamenti programmato tra 2 ore.");
    };

    const scheduleRetry = (reason) => {
        if (state.downloaded || state.installStarted) return;
        const retryIndex = Math.min(
            Math.max(0, state.failures - 1),
            RETRY_DELAYS_MS.length - 1,
        );
        const baseDelay = RETRY_DELAYS_MS[retryIndex];
        const delay = Math.round(baseDelay * (1 + Math.random() * 0.15));
        clearTimer("periodicTimer");
        armTimer("retryTimer", delay, () => {
            void checkForUpdates("retry");
        });
        log.warn(
            `Nuovo tentativo aggiornamento tra ${Math.ceil(delay / 60000)} minuti: ${reason}`,
        );
    };

    const registerFailure = (error, source) => {
        if (state.downloaded || state.installStarted) return;
        const now = Date.now();
        // electron-updater può sia rigettare la Promise sia emettere "error"
        // per lo stesso guasto. Lo contiamo una sola volta.
        if (now - state.lastFailureAt < 2000) return;
        state.lastFailureAt = now;
        state.checkInFlight = false;
        state.failures += 1;
        const detail =
            error && error.message ? error.message : String(error || "errore");
        log.warn(
            `Aggiornamento temporaneamente non disponibile (${source}, tentativo ${state.failures}): ${detail}`,
        );
        scheduleRetry(detail);
        if (state.failures >= 3 && !state.failureNoticeShown) {
            state.failureNoticeShown = true;
            bringUpdatePromptToFront(mainWindow);
            void dialog.showMessageBox(mainWindow, {
                type: "warning",
                title: "Aggiornamento in attesa",
                message:
                    "La connessione non ha ancora permesso di completare l'aggiornamento.",
                detail:
                    "AyPi continuerà a riprovare automaticamente in background. Puoi continuare a utilizzare l'app.",
                buttons: ["Ok"],
            });
        }
    };

    async function checkForUpdates(reason) {
        if (
            state.checkInFlight ||
            state.downloaded ||
            state.installStarted
        ) {
            log.info(
                `Controllo aggiornamenti ignorato (${reason}): operazione già attiva o pacchetto pronto.`,
            );
            return;
        }
        clearTimer("retryTimer");
        clearTimer("periodicTimer");
        if (!net.isOnline()) {
            state.failures += 1;
            log.warn(
                `Controllo aggiornamenti rimandato (${reason}): connessione assente.`,
            );
            scheduleRetry("connessione Internet assente");
            return;
        }
        state.checkInFlight = true;
        log.info(`Controllo aggiornamenti avviato (${reason}).`);
        try {
            await autoUpdater.checkForUpdatesAndNotify();
        } catch (error) {
            registerFailure(error, "controllo/download");
        } finally {
            state.checkInFlight = false;
        }
    }

    autoUpdater.on("update-available", (info) => {
        state.failures = 0;
        state.failureNoticeShown = false;
        clearTimer("retryTimer");
        clearTimer("periodicTimer");
        log.info("Aggiornamento disponibile: " + info.version);
        if (state.availableNoticeShown) return;
        state.availableNoticeShown = true;
        bringUpdatePromptToFront(mainWindow);
        void dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Aggiornamento disponibile",
            message: `E' disponibile una nuova versione (${info.version}). Verra' scaricata in background.`,
        });
    });

    autoUpdater.on("update-downloaded", async (info) => {
        if (state.downloaded || state.installPromptShown) {
            log.info(
                "Evento update-downloaded duplicato ignorato: pacchetto già pronto.",
            );
            return;
        }
        state.downloaded = true;
        state.installPromptShown = true;
        state.failures = 0;
        clearTimer("retryTimer");
        clearTimer("periodicTimer");
        try {
            log.info(
                `Aggiornamento ${info && info.version ? info.version : ""} scaricato; preparazione conferma installazione.`,
            );
            bringUpdatePromptToFront(mainWindow);
            const releaseNotes = await fetchReleaseNotes();
            bringUpdatePromptToFront(mainWindow);
            const notes = String(releaseNotes || FALLBACK_RELEASE_NOTES).slice(
                0,
                6000,
            );
            const result = await dialog.showMessageBox(mainWindow, {
                type: "question",
                title: "Aggiornamento pronto",
                message: "L'aggiornamento è pronto per essere installato.",
                detail: `Vuoi riavviare AyPi adesso?\n\nNote di rilascio:\n${notes}`,
                buttons: ["Aggiorna adesso", "Più tardi"],
                defaultId: 0,
                cancelId: 1,
                noLink: true,
            });
            mainWindow?.flashFrame(false);
            if (result.response !== 0) {
                log.info("Installazione aggiornamento rimandata dall'utente.");
                return;
            }
            state.installStarted = true;
            log.info("Avvio installazione aggiornamento e riavvio AyPi.");
            setImmediate(() => {
                try {
                    autoUpdater.quitAndInstall(false, true);
                } catch (error) {
                    log.error("Avvio installer aggiornamento fallito:", error);
                }
            });
        } catch (error) {
            mainWindow?.flashFrame(false);
            log.error("Conferma installazione aggiornamento fallita:", error);
            bringUpdatePromptToFront(mainWindow);
            void dialog.showMessageBox(mainWindow, {
                type: "error",
                title: "Aggiornamento scaricato",
                message:
                    "L'aggiornamento è stato scaricato, ma non è stato possibile avviare la conferma di installazione.",
                detail:
                    "Chiudi AyPi normalmente: l'aggiornamento verrà applicato all'uscita.",
                buttons: ["Ok"],
            });
        }
    });

    autoUpdater.on("update-not-available", (info) => {
        state.failures = 0;
        state.failureNoticeShown = false;
        state.availableNoticeShown = false;
        log.info(
            `Nessun aggiornamento disponibile${
                info && info.version ? ` (versione ${info.version})` : ""
            }.`,
        );
        schedulePeriodicCheck();
    });

    autoUpdater.on("download-progress", (progress) => {
        const now = Date.now();
        const percent = Math.max(
            0,
            Math.min(100, Number(progress && progress.percent) || 0),
        );
        const crossedTenPercent =
            Math.floor(percent / 10) >
            Math.floor(Math.max(0, state.lastProgressPercent) / 10);
        if (
            crossedTenPercent ||
            now - state.lastProgressLogAt >= 30000
        ) {
            state.lastProgressLogAt = now;
            state.lastProgressPercent = percent;
            log.info(
                `Download aggiornamento ${percent.toFixed(1)}%` +
                    `${
                        progress && Number(progress.bytesPerSecond)
                            ? ` · ${Math.round(progress.bytesPerSecond / 1024)} KB/s`
                            : ""
                    }`,
            );
        }
    });

    autoUpdater.on("error", (error) => {
        registerFailure(error, "evento updater");
    });

    void checkForUpdates("avvio");
}

module.exports = { setupAutoUpdater };
