const { ipcRenderer, shell } = require("electron");

ipcRenderer.invoke("get-app-version").then(version => {
    document.getElementById("appVersion").textContent = `AyPi v${version}`;
});

document.getElementById("githubIcon").addEventListener("click", () => {
    shell.openExternal("https://github.com/AGPress-Tech/AyPi");
});

function updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    document.getElementById("clock").textContent = `${hours}:${minutes}`;
}
updateClock();
setInterval(updateClock, 1000);

const sidebar = document.getElementById("mySidebar");
const menuBtn = document.getElementById("menuBtn");
const closeBtn = sidebar.querySelector(".closebtn");

function openNav() {
    sidebar.style.width = "250px";
    document.getElementById("main").style.marginLeft = "250px";
}

function closeNav() {
    sidebar.style.width = "0";
    document.getElementById("main").style.marginLeft = "0";
}

menuBtn.addEventListener("mouseenter", openNav);
sidebar.addEventListener("mouseleave", closeNav);
closeBtn.addEventListener("click", closeNav);

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

initCommonUI();

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-calcolatore");
});
