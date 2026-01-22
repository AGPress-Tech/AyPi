const { ipcRenderer } = require("electron");
const { initCommonUI } = require("../modules/utils");
const { MODULI_FILES } = require("../config/paths");

initCommonUI();

const buttons = [
    "openFornitori", "openDDT", "openManutenzioni", "openTarature",
    "openModuloStampi", "openMorsetti", "openUtensili", "openTicket"
];

buttons.forEach((id, index) => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.addEventListener("click", () => {
            ipcRenderer.send("open-file", MODULI_FILES[index]);
        });
    }
});

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});
