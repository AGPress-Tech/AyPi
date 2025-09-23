const { ipcRenderer, shell } = require("electron");
const { initCommonUI } = require("../modules/utils");

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

const filePaths = [
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\1 - Programma Ufficio Tecnico.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\2 - Programma Officina Stampi.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\3 - Programma Stampaggio.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\4 - Programma Tranceria.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\5 - Programma Torneria.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\6 - Programma Magazzino.xlsx",
    "\\\\Dl360\\pubbliche\\SCAMBIO DOCUMENTI\\USCITE CAMION_FURGONE\\PROGRAMMA SETTIMANALE CONSEGNE.xlsx"
];

[
    "openTecnico",
    "openOfficina",
    "openStampaggio",
    "openTranceria",
    "openTorneria",
    "openMagazzino",
    "openConsegne"
].forEach((id, index) => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.addEventListener("click", () => {
            ipcRenderer.send("open-file", filePaths[index]);
        });
    }
});

initCommonUI();

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});
