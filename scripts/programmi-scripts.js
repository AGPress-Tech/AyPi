const { ipcRenderer, shell } = require("electron");
const { initCommonUI } = require("../modules/utils");
const { PROGRAMMI_FILES } = require("../config/paths");

initCommonUI();

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
            ipcRenderer.send("open-file", PROGRAMMI_FILES[index]);
        });
    }
});

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});
