const { ipcRenderer, shell } = require("electron");

ipcRenderer.invoke("get-app-version").then((version) => {
    document.getElementById("appVersion").textContent = `AyPi v${version}`;
});

const filePaths = [
    "\\\\Dl360\\pubbliche\\INFO\\REGISTRAZIONE PRODUZIONE STAMPAGGIO\\2025 Registrazione produzione stampaggio.xls",
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\Registrazione Produzione Tranceria.xlsx",
    "\\\\Dl360\\pubbliche\\INFO\\REGISTRAZIONE PRODUZIONE TORNERIA\\Controllo_Valorizzazione.xlsm"
];

const buttons = ["openRegStampaggio", "openRegTranceria", "openRegTorneria"];

buttons.forEach((id, index) => {
    document.getElementById(id).addEventListener("click", () => {
        ipcRenderer.send("open-file", filePaths[index]);
    });
});

document.getElementById("githubIcon").addEventListener("click", () => {
    shell.openExternal("https://github.com/AGPress-Tech/AyPi");
});

function openNav() {
    document.getElementById("main").style.marginLeft = "30%";
    document.getElementById("mySidebar").style.width = "30%";
}

function closeNav() {
    document.getElementById("main").style.marginLeft = "0%";
    document.getElementById("mySidebar").style.width = "0%";
}

function updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('clock').textContent = `${hours}:${minutes}`;
}

setInterval(updateClock, 1000);
updateClock();
