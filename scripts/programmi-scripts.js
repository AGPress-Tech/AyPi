const { ipcRenderer } = require("electron");
const { initCommonUI } = require("../modules/utils");

const filePaths = [
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\1 - Programma Ufficio Tecnico.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\2 - Programma Officina Stampi.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\3 - Programma Stampaggio.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\4 - Programma Tranceria.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\5 - Programma Torneria.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\6 - Programma Magazzino.xlsx",
    "\\\\Dl360\\pubbliche\\SCAMBIO DOCUMENTI\\USCITE CAMION_FURGONE\\PROGRAMMA SETTIMANALE CONSEGNE.xlsx"
];

const buttons = [
    "openTecnico",
    "openOfficina",
    "openStampaggio",
    "openTranceria",
    "openTorneria",
    "openMagazzino",
    "openConsegne"
];

buttons.forEach((id, index) => {
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
