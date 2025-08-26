const { app, BrowserWindow, ipcMain, dialog, net, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { mostraPopup } = require('./modules/robot');
const { toMAC } = require('@network-utils/arp-lookup');

let mainWindow;

async function getMacForIP(ip) {
  try {
    const mac = await toMAC(ip);
    return mac;
  } catch {
    return null;
  }
}

const log = require("electron-log");
log.transports.file.level = "info";
autoUpdater.logger = log;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 750,
        height: 550,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, 'assets', 'app-icon.png')
    });

    mainWindow.loadFile("./pages/moduli.html");
    mainWindow.setMenu(null);

    if (net.isOnline()) {
        autoUpdater.checkForUpdatesAndNotify();
    } else {
        dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Verificare Connessione",
            message: "Connessione ad Internet assente, impossibile verificare la presenza di nuovi aggiornamenti!",
        });
    }
});

autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'AGPress-Tech',
    repo: 'AyPi',
    private: false,
    url: 'https://github.com/AGPress-Tech/AyPi/releases/download/'
});

autoUpdater.on("update-available", (info) => {
    log.info("Aggiornamento disponibile: " + info.version);
    dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Aggiornamento disponibile",
        message: `È disponibile una nuova versione (${info.version}). L'aggiornamento verrà scaricato in background.`,
    });
});

autoUpdater.on("update-downloaded", async () => {
    const releaseNotes = await getReleaseNotes();

    dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Aggiornamento pronto",
        message: `L'aggiornamento è stato scaricato. Vuoi riavviare ora per applicarlo?\n\nNote di aggiornamento:\n\n${releaseNotes}`,
        buttons: ["Aggiorna Adesso", "Aggiorna Più Tardi"],
    }).then((result) => {
        if (result.response === 0) {
            log.info("Riavvio per installare l'aggiornamento.");
            autoUpdater.quitAndInstall();
        } else {
            log.info("L'utente ha scelto di aggiornare più tardi.");
        }
    });
});

autoUpdater.on("error", (error) => {
    log.error("Errore nell'aggiornamento:", error);
    dialog.showMessageBox(mainWindow, {
        type: 'error',
        buttons: ['Ok'],
        title: "Errore Aggiornamento",
        message: "Errore durante l'aggiornamento. Contattare Ayrton."
    });
});

ipcMain.handle("get-app-version", async () => {
    return app.getVersion();
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

// Ascolta messaggi dai renderer
ipcMain.on("mostra-robot-popup", async (event, robotId, url, chiaveStato) => {
    await mostraPopup(robotId, url, chiaveStato);
});

ipcMain.on("open-file", (event, filePath) => {
    const testFile = "\\\\Dl360\\private\\AyPi Server Validator.txt";

    fs.access(testFile, fs.constants.F_OK, (err) => {
        if (err) {
            log.warn("Il server non è raggiungibile:", err.message);
            dialog.showMessageBox(mainWindow, {
                type: 'warning',
                buttons: ['Ok'],
                defaultId: 0,
                title: "Server Non Raggiungibile",
                message: "Il server \\\\dl360 non è disponibile. Verificare la connessione e riprovare."
            });
            return;
        }

        log.info("Il server è accessibile.");

        fs.stat(filePath, (err, stats) => {
            if (err) {
                log.warn("Percorso non trovato:", filePath);
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    buttons: ['Ok'],
                    defaultId: 0,
                    title: "Percorso Non Trovato",
                    message: "Il file o la cartella sembra essere stata spostata o eliminata. Verificare il percorso e riprovare."
                });
                return;
            }

            if (stats.isDirectory()) {
                log.info("Apertura cartella:", filePath);
                shell.openPath(filePath);
            } else {
                log.info("Apertura file:", filePath);
                exec(`start "" "${filePath}"`, (error) => {
                    if (error) {
                        log.error("Errore nell'apertura del file:", error);

                        if (
                            error.message.includes("Impossibile accedere al file.") ||
                            error.message.includes("Il file è utilizzato da un altro processo.")
                        ) {
                            dialog.showMessageBox(mainWindow, {
                                type: 'warning',
                                buttons: ['Apri in sola lettura', 'Annulla'],
                                defaultId: 0,
                                title: "File in Uso",
                                message: "Il file è attualmente in uso da un altro operatore. Vuoi aprirlo in sola lettura?"
                            }).then(result => {
                                if (result.response === 0) {
                                    shell.openPath(filePath).then(openError => {
                                        if (openError) {
                                            log.error("Errore nell'apertura in sola lettura:", openError);
                                            dialog.showMessageBox(mainWindow, {
                                                type: 'error',
                                                buttons: ['Ok'],
                                                defaultId: 0,
                                                title: "Errore",
                                                message: "Il file non può essere aperto nemmeno in sola lettura."
                                            });
                                        } else {
                                            log.info("File aperto in sola lettura:", filePath);
                                        }
                                    });
                                }
                            });

                        } else if (
                            error.message.includes("Impossibile trovare il file") ||
                            error.message.includes("Il sistema non trova il file")
                        ) {
                            dialog.showMessageBox(mainWindow, {
                                type: 'warning',
                                buttons: ['Ok'],
                                defaultId: 0,
                                title: "File Non Trovato",
                                message: "Il file sembra essere stato spostato o eliminato. Verificare il percorso e riprovare."
                            });

                        } else {
                            dialog.showMessageBox(mainWindow, {
                                type: 'error',
                                buttons: ['Ok'],
                                defaultId: 0,
                                title: "Errore",
                                message: "Errore nell'apertura del file. Contattare Ayrton."
                            });
                        }
                    }
                });
            }
        });
    });
});

const robots = {
    "21D500": { ip: "192.168.1.153", mac: "00:03:1d:12:0f:71" },
    "21D600": { ip: "192.168.1.152", mac: "00:03:1d:11:62:da" },
    "21D850": { ip: "192.168.1.92",  mac: "00:03:1d:14:13:38" }
};

ipcMain.handle("ping-robot-dialog", async () => {
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Annulla", "21D500", "21D600", "21D850"],
    cancelId: 0,
    defaultId: 1,
    title: "Seleziona robot",
    message: "Quale robot vuoi pingare?"
  });

  if (response === 0) return;

  const robotId = Object.keys(robots)[response - 1];
  const { ip, mac: macAtteso } = robots[robotId];

  return new Promise(async (resolve) => {
    exec(`ping -n 1 ${ip}`, async (error, stdout) => {
      const righe = stdout.split("\n").map(r => r.trim()).filter(r => r);
      const ultimaRiga = righe[righe.length - 1];

      let messaggio;
      if (ultimaRiga.includes("Persi = 0")) {
        messaggio = `Nessuna risposta ricevuta dall'indirizzo ${ip}!\nVerificare che il Robot sia acceso e collegato alla rete!`;
      } else {
        messaggio = `L'indirizzo è raggiungibile!\nRisultato ping a ${ip}:\n${ultimaRiga}`;
        
        const macReale = await getMacForIP(ip);
        if (macReale) {
          if (macReale.toLowerCase() !== macAtteso.toLowerCase()) {
            messaggio += `\n\nATTENZIONE: MAC atteso (${macAtteso}) diverso da MAC rilevato (${macReale}). Possibile conflitto IP!`;
          }
        } else {
          messaggio += `\n\nMAC address non rilevato. Controlla rete o ARP cache.`;
        }
      }

      dialog.showMessageBox({
        type: "info",
        title: `Ping ${robotId}`,
        message: messaggio
      });

      resolve(messaggio);
    });
  });
});
