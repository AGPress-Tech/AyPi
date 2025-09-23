const { ipcMain, dialog } = require("electron");
const { exec } = require("child_process");
const { toMAC } = require("@network-utils/arp-lookup");

const robots = {
    "21D500": { ip: "192.168.1.153", mac: "00:03:1d:12:0f:71" },
    "21D600": { ip: "192.168.1.152", mac: "00:03:1d:11:62:da" },
    "21D850": { ip: "192.168.1.92",  mac: "00:03:1d:14:13:38" }
};

function estraiTesto(testo, chiave) {
    const testoUpper = testo.toUpperCase();
    const chiaveUpper = chiave.toUpperCase();

    const idx = testoUpper.indexOf(chiaveUpper);
    if (idx === -1) return null;

    const dopo = testo.slice(idx + chiave.length).trim();
    return dopo.split("\n")[0].replace("[","").replace("]","").trim();
}

function estraiPrimaParola(testo, chiave) {
    const risultato = estraiTesto(testo, chiave);
    if (!risultato) return null;
    return risultato.split(" ")[0].trim();
}

function estraiRigaSubitoDopo(testo, chiave) {
    const testoUpper = testo.toUpperCase();
    const chiaveUpper = chiave.toUpperCase();

    const idx = testoUpper.indexOf(chiaveUpper);
    if (idx === -1) return null;

    const dopo = testo.slice(idx + chiave.length);
    const righe = dopo.split("\n");

    let riga = righe[3] ? righe[3].replace("[","").replace("]","").replace(/'/g, "").trim() : null;
    if (!riga) return null;

    riga = riga.replace(/\s+/g, " ");
    riga = riga.charAt(0).toUpperCase() + riga.slice(1).toLowerCase();

    return riga;
}

async function mostraPopup(robotId, url, chiaveStato) {
    try {
        let timeoutMostra = false;
        const controller = new AbortController();
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
            res = await fetch(url, { signal: controller.signal });
        } catch (e) {
            clearTimeout(timeout);
            throw e;
        } finally {
            clearTimeout(timeout);
        }

        if (!res.ok) throw new Error("Pagina non raggiungibile");

        const html = await res.text();
        const testoPulito = html.replace(/<[^>]*>/g, '\n').replace(/\r/g,'').trim();

        const programma = estraiTesto(testoPulito, "Programma di lavoro:");
        const stato = estraiTesto(testoPulito, chiaveStato);

        const contapezzi = estraiPrimaParola(testoPulito, "PEZZI NUMERO");
        const tempoCiclo = estraiPrimaParola(testoPulito, "TEMPO CICLO");
        const rigaSuccessiva = estraiRigaSubitoDopo(testoPulito, "PEZZI NUMERO");

        let messaggio = `Nome Programma: ${programma || "Non trovato"}\nStato: ${stato || "Non trovato"}`;
        if (contapezzi) messaggio += `\nContapezzi: ${contapezzi}`;
        if (tempoCiclo) messaggio += `\nTempo Ciclo: ${tempoCiclo} secondi`;
        if (rigaSuccessiva) messaggio += `\nDettagli: ${rigaSuccessiva}.`;

        dialog.showMessageBox({
            type: 'info',
            title: `Informazioni Robot ${robotId}`,
            message: messaggio
        });

    } catch (err) {
        dialog.showMessageBox({
            type: 'error',
            title: `Errore Robot ${robotId}`,
            message: `Il Robot ${robotId} non è stato individuato, potrebbe essere spento o scollegato dalla rete.\nSe il problema persiste verificare che la porta non sia occupata!\nVerificare risposta indirizzo macchina utilizzando il pulsante "Verifica Connessioni"`
        });
    }
}

async function getMacForIP(ip) {
    try {
        return await toMAC(ip);
    } catch {
        return null;
    }
}

function setupRobotManager(mainWindow) {
    ipcMain.on("mostra-robot-popup", async (event, robotId, url, chiaveStato) => {
        await mostraPopup(robotId, url, chiaveStato);
    });

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

        return new Promise((resolve) => {
            exec(`ping -n 1 ${ip}`, async (error, stdout) => {
                const righe = stdout.split("\n").map(r => r.trim()).filter(r => r);
                const ultimaRiga = righe[righe.length - 1];

                let messaggio;
                if (ultimaRiga.includes("Persi = 0")) {
                    messaggio = `Nessuna risposta da ${ip}! Controlla che il Robot sia acceso.`;
                } else {
                    messaggio = `Ping ${ip} eseguito:\n${ultimaRiga}`;
                    const macReale = await getMacForIP(ip);
                    if (macReale && macReale.toLowerCase() !== macAtteso.toLowerCase()) {
                        messaggio += `\n\nATTENZIONE: MAC atteso ${macAtteso}, rilevato ${macReale}. Possibile conflitto IP!`;
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
}

module.exports = { setupRobotManager };
