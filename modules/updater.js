// Importa moduli da Electron
const { dialog, net } = require("electron");               // 'dialog' per finestre di messaggio, 'net' per controllare connessione Internet
const { autoUpdater } = require("electron-updater");       // Gestisce gli aggiornamenti automatici dell'app
const log = require("electron-log");                       // Libreria per loggare eventi e errori su file

// Configurazione del livello di log
log.transports.file.level = "info";                        // Registra solo messaggi di livello 'info' o superiore
autoUpdater.logger = log;                                  // Collega il logger a autoUpdater

// Imposta la sorgente degli aggiornamenti (GitHub in questo caso)
autoUpdater.setFeedURL({
    provider: 'github',                                    // Tipo di provider
    owner: 'AGPress-Tech',                                 // Proprietario del repo
    repo: 'AyPi',                                          // Nome del repository
    private: false,                                        // Repo pubblico
    url: 'https://github.com/AGPress-Tech/AyPi/releases/download/' // URL base per i rilasci
});

// Recupera le note di rilascio più recenti da GitHub

async function getReleaseNotes() {
    const releaseUrl = 'https://api.github.com/repos/AGPress-Tech/AyPi/releases/latest'; // Endpoint GitHub API

    try {
        const response = await fetch(releaseUrl);          // Effettua richiesta HTTP a GitHub
        const data = await response.json();                // Converte la risposta in JSON
        return data.body || "Nessuna nota di rilascio disponibile."; // Restituisce note, o messaggio di fallback
    } catch (error) {
        log.error("Errore nel recupero delle note di rilascio:", error); // Logga errore su file
        return "Errore nel recupero delle note di rilascio.";            // Mostra messaggio all’utente
    }
}

// Configura il sistema di aggiornamento automatico
function setupAutoUpdater(mainWindow) {
    // Verifica se è disponibile la connessione Internet
    if (net.isOnline()) {
        autoUpdater.checkForUpdatesAndNotify();            // Controlla nuovi aggiornamenti e notifica automaticamente
    } else {
        // Se non c'è rete, mostra un messaggio di avviso
        dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Verificare Connessione",
            message: "Connessione ad Internet assente, impossibile verificare aggiornamenti.",
        });
    }

    // Evento: trovato un nuovo aggiornamento disponibile
    autoUpdater.on("update-available", (info) => {
        log.info("Aggiornamento disponibile: " + info.version); // Scrive su log la versione trovata
        dialog.showMessageBox(mainWindow, {                     // Notifica all’utente la disponibilità
            type: "info",
            title: "Aggiornamento disponibile",
            message: `È disponibile una nuova versione (${info.version}). Verrà scaricata in background.`,
        });
    });

    // Evento: aggiornamento scaricato completamente
    autoUpdater.on("update-downloaded", async () => {
        const releaseNotes = await getReleaseNotes();            // Recupera le note di rilascio per mostrarle all’utente

        dialog.showMessageBox(mainWindow, {                      // Chiede se applicare subito l’aggiornamento
            type: "info",
            title: "Aggiornamento pronto",
            message: `Vuoi riavviare ora per applicarlo?\n\nNote:\n\n${releaseNotes}`,
            buttons: ["Aggiorna Adesso", "Aggiorna Più Tardi"],  // Opzioni per l’utente
        }).then((result) => {
            if (result.response === 0) {                         // Se l’utente sceglie “Aggiorna Adesso”
                log.info("Riavvio per aggiornamento.");          // Logga l’evento
                autoUpdater.quitAndInstall();                    // Chiude e installa la nuova versione
            }
        });
    });

    // Evento: errore durante la procedura di aggiornamento
    autoUpdater.on("error", (error) => {
        log.error("Errore aggiornamento:", error);              // Registra l’errore su file log
        dialog.showMessageBox(mainWindow, {                     // Mostra messaggio d’errore all’utente
            type: 'error',
            buttons: ['Ok'],
            title: "Errore Aggiornamento",
            message: "Errore durante l'aggiornamento. Contattare Ayrton."
        });
    });
}

// Esporta la funzione per essere richiamata dal main process
module.exports = { setupAutoUpdater };
