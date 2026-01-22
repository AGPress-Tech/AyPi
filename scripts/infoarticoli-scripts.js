const { ipcRenderer, shell } = require("electron");
const { initCommonUI } = require("../modules/utils");
const { INFOARTICOLI_PATHS } = require("../config/paths");

initCommonUI();

["openTavole", "openCicli", "openMontaggioStampi", "openDifettiProduzione"].forEach((id, index) => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.addEventListener("click", () => {
            ipcRenderer.send("open-file", INFOARTICOLI_PATHS[index]);
        });
    }
});

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});
