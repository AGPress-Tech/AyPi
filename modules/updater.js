const { dialog, net } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");

log.transports.file.level = "info";
autoUpdater.logger = log;

autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'AGPress-Tech',
    repo: 'AyPi',
    private: false,
    url: 'https://github.com/AGPress-Tech/AyPi/releases/download/'
});

async function getReleaseNotes() {
    const releaseUrl = 'https://api.github.com/repos/AGPress-Tech/AyPi/releases/latest';

    try {
        const response = await fetch(releaseUrl);
        const data = await response.json();
        return data.body || "Nessuna nota di rilascio disponibile.";
    } catch (error) {
        log.error("Errore nel recupero delle note di rilascio:", error);
        return "Errore nel recupero delle note di rilascio.";
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
            message: `È disponibile una nuova versione (${info.version}). Verrà scaricata in background.`,
        });
    });

    autoUpdater.on("update-downloaded", async () => {
        const releaseNotes = await getReleaseNotes();

        dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Aggiornamento pronto",
            message: `Vuoi riavviare ora per applicarlo?\n\nNote:\n\n${releaseNotes}`,
            buttons: ["Aggiorna Adesso", "Aggiorna Più Tardi"],
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
            type: 'error',
            buttons: ['Ok'],
            title: "Errore Aggiornamento",
            message: "Errore durante l'aggiornamento. Contattare Ayrton."
        });
    });
}

module.exports = { setupAutoUpdater };
