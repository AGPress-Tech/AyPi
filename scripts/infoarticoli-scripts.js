const { ipcRenderer, shell } = require("electron");
const { initCommonUI } = require("../modules/utils");

initCommonUI();

const filePaths = [
    "\\\\Dl360\\pubbliche\\TECNICO\\PROGETTAZIONE\\A.G.PRESS TORNITI\\A.G.PRESS DISEGNI TORNITI",
    "\\\\Dl360\\pubbliche\\TECNICO\\QUALITA' E MODULISTICA\\DOCUMENTI CONDIVISI A.G.PRESS\\CICLI DI LAVORAZIONE"
];

["openTavole", "openCicli"].forEach((id, index) => {
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
