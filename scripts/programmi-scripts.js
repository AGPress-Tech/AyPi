const { ipcRenderer, shell } = require("electron");

ipcRenderer.invoke("get-app-version").then((version) => {
    document.getElementById("appVersion").textContent = `AyPi v${version}`;
});

const filePaths = [
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\1 - Programma Ufficio Tecnico.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\2 - Programma Officina Stampi.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\3 - Programma Stampaggio.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\4 - Programma Tranceria.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\5 - Programma Torneria.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\6 - Programma Magazzino.xlsx",
];

const buttons = ["openTecnico", "openOfficina", "openStampaggio", "openTranceria", "openTorneria", "openMagazzino"];

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
