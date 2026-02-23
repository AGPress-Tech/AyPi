require("./shared/dev-guards");
const { ipcRenderer } = require("electron");
const { initCommonUI } = require("../modules/utils");

initCommonUI();

function getInputNumber(id: string) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return Number.NaN;
    return parseFloat(el.value);
}

function getInputInt(id: string) {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return Number.NaN;
    return parseInt(el.value, 10);
}

function calcola() {
    const D = getInputNumber("diametro");
    const z = getInputInt("taglienti");
    const Vc = getInputNumber("vc");
    const f = getInputNumber("f");
    const riduzione = getInputNumber("riduzione") || 0;

    const risultato = document.getElementById("risultato");
    if (!risultato) return;

    if (Number.isNaN(D) || Number.isNaN(z) || Number.isNaN(Vc) || Number.isNaN(f)) {
        risultato.innerHTML = "Inserisci tutti i valori!";
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
        `Numero di giri: <b>${n.toFixed(0)} rpm</b><br>` +
        `Avanzamento: <b>${Vf.toFixed(1)} mm/min</b>`;
}

ipcRenderer.send("resize-calcolatore");

declare global {
    interface Window {
        calcola: () => void;
    }
}

window.calcola = calcola;

export {};





