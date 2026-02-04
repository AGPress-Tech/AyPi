const { ipcRenderer } = require("electron");
const { initCommonUI } = require("../modules/utils");

initCommonUI();

function calcola() {
    const D = parseFloat(document.getElementById("diametro").value);
    const z = parseInt(document.getElementById("taglienti").value);
    const Vc = parseFloat(document.getElementById("vc").value);
    const f = parseFloat(document.getElementById("f").value);
    const riduzione = parseFloat(document.getElementById("riduzione").value) || 0;

    const risultato = document.getElementById("risultato");

    if (isNaN(D) || isNaN(z) || isNaN(Vc) || isNaN(f)) {
        risultato.innerHTML = "⚠️ Inserisci tutti i valori!";
        return;
    }

    let n = (1000 * Vc) / (Math.PI * D);
    let Vf = f * z * n;

    if (riduzione > 0) {
        const factor = (100 - riduzione) / 100;
        n *= factor;
        Vf *= factor;
    }

    risultato.innerHTML =
        `🔧 Numero di giri: <b>${n.toFixed(0)} rpm</b><br>` +
        `➡️ Avanzamento: <b>${Vf.toFixed(1)} mm/min</b>`;
}

ipcRenderer.send("resize-calcolatore");
