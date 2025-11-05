// Importa moduli necessari
const { ipcMain, dialog } = require("electron");          // ipcMain: ascolta eventi dal renderer, dialog: mostra finestre di messaggio
const { exec } = require("child_process");                // Permette di eseguire comandi di sistema (es. ping)
const { toMAC } = require("@network-utils/arp-lookup");   // Recupera l’indirizzo MAC di un IP dalla tabella ARP

// Mappa dei robot registrati con ID, IP e MAC associati
const robots = {
    "21D500": { ip: "192.168.1.153", mac: "00:03:1d:12:0f:71" },
    "21D600": { ip: "192.168.1.152", mac: "00:03:1d:11:62:da" },
    "21D850": { ip: "192.168.1.92",  mac: "00:03:1d:14:13:38" }
};

// Estrae una porzione di testo dopo una chiave specifica
function estraiTesto(testo, chiave) {
    const testoUpper = testo.toUpperCase();
    const chiaveUpper = chiave.toUpperCase();

    const idx = testoUpper.indexOf(chiaveUpper);          // Trova posizione della chiave
    if (idx === -1) return null;                          // Se non trovata, restituisce null

    const dopo = testo.slice(idx + chiave.length).trim(); // Prende il testo dopo la chiave
    return dopo.split("\n")[0].replace("[","").replace("]","").trim(); // Pulisce e restituisce la prima riga
}

// Estrae solo la prima parola dopo una chiave (es. numero o tempo)
function estraiPrimaParola(testo, chiave) {
    const risultato = estraiTesto(testo, chiave);
    if (!risultato) return null;
    return risultato.split(" ")[0].trim();                // Ritorna solo la prima parola
}

// Estrae una riga specifica qualche linea dopo una chiave
function estraiRigaSubitoDopo(testo, chiave) {
    const testoUpper = testo.toUpperCase();
    const chiaveUpper = chiave.toUpperCase();

    const idx = testoUpper.indexOf(chiaveUpper);
    if (idx === -1) return null;

    const dopo = testo.slice(idx + chiave.length);
    const righe = dopo.split("\n");

    // Prende la quarta riga successiva alla chiave e la ripulisce
    let riga = righe[3] ? righe[3].replace("[","").replace("]","").replace(/'/g, "").trim() : null;
    if (!riga) return null;

    riga = riga.replace(/\s+/g, " ");                     // Normalizza spazi multipli
    riga = riga.charAt(0).toUpperCase() + riga.slice(1).toLowerCase(); // Formatta in maiuscolo iniziale

    return riga;
}

// Mostra popup con le informazioni di un robot
async function mostraPopup(robotId, url, chiaveStato) {
    try {
        let timeoutMostra = false;
        const controller = new AbortController();

        // Mostra popup di attesa se la risposta impiega più di 2 secondi
        const timeout = setTimeout(async () => {
            timeoutMostra = true;
            await dialog.showMessageBox({
                type: 'info',
                title: `Attendere Robot ${robotId}`,
                message: `Il robot ${robotId} non sta ancora rispondendo alla pagina ${url}. Attendere qualche istante.`,
                buttons: ['OK']
            });
        }, 2000);

        let res;
        try {
            res = await fetch(url, { signal: controller.signal }); // Richiesta HTTP alla pagina del robot
        } catch (e) {
            clearTimeout(timeout);
            throw e;
        } finally {
            clearTimeout(timeout);
        }

        if (!res.ok) throw new Error("Pagina non raggiungibile");

        // Pulisce l’HTML rimuovendo i tag per estrarre solo testo
        const html = await res.text();
        const testoPulito = html.replace(/<[^>]*>/g, '\n').replace(/\r/g,'').trim();

        // Estrae varie informazioni dal testo
        const programma = estraiTesto(testoPulito, "Programma di lavoro:");
        const stato = estraiTesto(testoPulito, chiaveStato);
        const contapezzi = estraiPrimaParola(testoPulito, "PEZZI NUMERO");
        const tempoCiclo = estraiPrimaParola(testoPulito, "TEMPO CICLO");
        const rigaSuccessiva = estraiRigaSubitoDopo(testoPulito, "PEZZI NUMERO");

        // Costruisce il messaggio per il popup
        let messaggio = `Nome Programma: ${programma || "Non trovato"}\nStato: ${stato || "Non trovato"}`;
        if (contapezzi) messaggio += `\nContapezzi: ${contapezzi}`;
        if (tempoCiclo) messaggio += `\nTempo Ciclo: ${tempoCiclo} secondi`;
        if (rigaSuccessiva) messaggio += `\nDettagli: ${rigaSuccessiva}.`;

        // Mostra finestra con le informazioni raccolte
        dialog.showMessageBox({
            type: 'info',
            title: `Informazioni Robot ${robotId}`,
            message: messaggio
        });

    } catch (err) {
        // Errore di connessione o robot non raggiungibile
        dialog.showMessageBox({
            type: 'error',
            title: `Errore Robot ${robotId}`,
            message: `Il Robot ${robotId} non è stato individuato, potrebbe essere spento o scollegato dalla rete.\nSe il problema persiste verificare che la porta non sia occupata!\nVerificare risposta indirizzo macchina utilizzando il pulsante "Verifica Connessioni"`
        });
    }
}

// Recupera MAC address per un dato IP tramite ARP lookup
async function getMacForIP(ip) {
    try {
        return await toMAC(ip);
    } catch {
        return null;                                      // Ritorna null se non trovato
    }
}

// Imposta la logica principale di gestione robot (eventi IPC)
function setupRobotManager(mainWindow) {

    // Evento IPC per mostrare popup informazioni robot
    ipcMain.on("mostra-robot-popup", async (event, robotId, url, chiaveStato) => {
        await mostraPopup(robotId, url, chiaveStato);
    });

    // Evento IPC per eseguire ping e mostrare stato connessione robot
    ipcMain.handle("ping-robot-dialog", async () => {

        // Finestra di selezione robot
        const { response } = await dialog.showMessageBox({
            type: "question",
            buttons: ["Annulla", "21D500", "21D600", "21D850"],
            cancelId: 0,
            defaultId: 1,
            title: "Seleziona robot",
            message: "Quale robot vuoi pingare?"
        });

        if (response === 0) return;                       // Se “Annulla” → esci

        // Recupera ID, IP e MAC del robot selezionato
        const robotId = Object.keys(robots)[response - 1];
        const { ip, mac: macAtteso } = robots[robotId];

        // Esegue il comando di ping e verifica eventuali conflitti IP
        return new Promise((resolve) => {
            exec(`ping -n 1 ${ip}`, async (error, stdout) => {
                const righe = stdout.split("\n").map(r => r.trim()).filter(r => r);
                const ultimaRiga = righe[righe.length - 1]; // Analizza l'ultima riga del ping

                let messaggio;
                if (ultimaRiga.includes("Persi = 0")) {     // Se non ha ricevuto risposta
                    messaggio = `Nessuna risposta da ${ip}! Controlla che il Robot sia acceso.`;
                } else {
                    messaggio = `Ping ${ip} eseguito:\n${ultimaRiga}`;
                    const macReale = await getMacForIP(ip); // Recupera il MAC effettivo
                    if (macReale && macReale.toLowerCase() !== macAtteso.toLowerCase()) {
                        messaggio += `\n\nATTENZIONE: MAC atteso ${macAtteso}, rilevato ${macReale}. Possibile conflitto IP!`;
                    }
                }

                // Mostra il risultato del ping
                dialog.showMessageBox({
                    type: "info",
                    title: `Ping ${robotId}`,
                    message: messaggio
                });

                resolve(messaggio); // Restituisce messaggio finale
            });
        });
    });
}

// Esporta la funzione principale per l'uso nel main process
module.exports = { setupRobotManager };
