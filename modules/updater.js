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

log.transports.file.level = "info";
autoUpdater.logger = log;
autoUpdater.setFeedURL(UPDATE_CONFIG);

async function fetchReleaseNotes() {
    try {
        const response = await fetch(RELEASE_NOTES_URL);
        if (!response.ok) {
            throw new Error(`release notes status ${response.status}`);
        }
        const data = await response.json();
        return data.body || FALLBACK_RELEASE_NOTES;
    } catch (error) {
        log.error("Errore nel recupero delle note di rilascio:", error);
        return FALLBACK_RELEASE_NOTES_ERROR;
    }
}

function setupAutoUpdater(mainWindow) {
    if (net.isOnline()) {
        autoUpdater.checkForUpdatesAndNotify();
    } else {
        dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Verificare Connessione",
            message: "Connessione ad Internet assente, impossibile verificare aggiornamenti.",
        });
    }

    autoUpdater.on("update-available", (info) => {
        log.info("Aggiornamento disponibile: " + info.version);
        dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Aggiornamento disponibile",
            message: `E' disponibile una nuova versione (${info.version}). Verra' scaricata in background.`,
        });
    });

    autoUpdater.on("update-downloaded", async () => {
        const releaseNotes = await fetchReleaseNotes();

        dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Aggiornamento pronto",
            message: `Vuoi riavviare ora per applicarlo?\n\nNote:\n\n${releaseNotes}`,
            buttons: ["Aggiorna Adesso", "Aggiorna Piu' Tardi"],
        }).then((result) => {
            if (result.response === 0) {
                log.info("Riavvio per aggiornamento.");
                autoUpdater.quitAndInstall();
            }
        });
    });

    autoUpdater.on("error", (error) => {
        log.error("Errore aggiornamento:", error);
        dialog.showMessageBox(mainWindow, {
            type: "error",
            buttons: ["Ok"],
            title: "Errore Aggiornamento",
            message: "Errore durante l'aggiornamento. Contattare Ayrton.",
        });
    });
}

module.exports = { setupAutoUpdater };
