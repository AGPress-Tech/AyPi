const { dialog } = require('electron');

async function mostraPopup(robotId, url, chiaveStato) {

    function estraiTesto(testo, chiave) {
        const testoUpper = testo.toUpperCase();
        const chiaveUpper = chiave.toUpperCase();

        const idx = testoUpper.indexOf(chiaveUpper);
        if (idx === -1) return "Non trovato";

        const dopo = testo.slice(idx + chiave.length).trim();
        return dopo.split("\n")[0].replace("[","").replace("]","").trim();
    }

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Pagina non raggiungibile");

        const html = await res.text();
        const testoPulito = html.replace(/<[^>]*>/g, '\n').replace(/\r/g,'').trim();

        const programma = estraiTesto(testoPulito, "Programma di lavoro:");
        const stato = estraiTesto(testoPulito, chiaveStato);

        dialog.showMessageBox({
            type: 'info',
            title: `Informazioni Robot ${robotId}`,
            message: `Nome Programma: ${programma}\nStato: ${stato}`
        });

    } catch (err) {
        dialog.showMessageBox({
            type: 'error',
            title: `Errore Robot ${robotId}`,
            message: `Robot ${robotId} non trovato alla pagina ${url}, potrebbe essere scollegato dalla rete.\nSe il problema persiste verificare che la porta non sia occupata!`
        });
    }
}

module.exports = { mostraPopup };
