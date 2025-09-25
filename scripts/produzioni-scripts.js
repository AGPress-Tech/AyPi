const { ipcRenderer, shell } = require("electron");
const { initCommonUI } = require("../modules/utils");

initCommonUI();

const filePaths = [
    "\\\\Dl360\\pubbliche\\INFO\\REGISTRAZIONE PRODUZIONE STAMPAGGIO\\2025 Registrazione produzione stampaggio.xls",
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\Registrazione Produzione Tranceria.xlsx",
    "\\\\Dl360\\pubbliche\\INFO\\REGISTRAZIONE PRODUZIONE TORNERIA\\Controllo_Valorizzazione.xlsm"
];

["openRegStampaggio", "openRegTranceria", "openRegTorneria"].forEach((id, index) => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.addEventListener("click", () => {
            ipcRenderer.send("open-file", filePaths[index]);
        });
    }
});

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});
