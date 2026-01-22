const { ipcRenderer, shell } = require("electron");
const { initCommonUI } = require("../modules/utils");
const { PRODUZIONE_FILES } = require("../config/paths");

initCommonUI();

["openRegStampaggio", "openRegTranceria", "openRegTorneria"].forEach((id, index) => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.addEventListener("click", () => {
            ipcRenderer.send("open-file", PRODUZIONE_FILES[index]);
        });
    }
});

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});
