const { dialog } = require('electron');

async function mostraPopup(robotId, url, chiaveStato) {

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

    try {
        // Timeout informativo di 2 secondi
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
            throw e; // gestito nel catch esterno
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
        // Messaggio finale se la pagina non risponde
        dialog.showMessageBox({
            type: 'error',
            title: `Errore Robot ${robotId}`,
            message: `Robot ${robotId} non trovato alla pagina ${url}, potrebbe essere scollegato dalla rete.\nSe il problema persiste verificare che la porta non sia occupata!`
        });
    }
}

module.exports = { mostraPopup };
