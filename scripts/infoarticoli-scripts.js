const { ipcRenderer, shell } = require("electron");
const { initCommonUI } = require("../modules/utils");

initCommonUI();

const filePaths = [
    "\\\\Dl360\\pubbliche\\TECNICO\\PROGETTAZIONE\\A.G.PRESS TORNITI\\A.G.PRESS DISEGNI TORNITI",
    "\\\\Dl360\\pubbliche\\TECNICO\\QUALITA' E MODULISTICA\\DOCUMENTI CONDIVISI A.G.PRESS\\CICLI DI LAVORAZIONE",
    "\\\\Dl360\\pubbliche\\TECNICO\\QUALITA' E MODULISTICA\\DOCUMENTI CONDIVISI A.G.PRESS\\SCHEDE MONTAGGIO STAMPI M10-7",
    "\\\\Dl360\\pubbliche\\TECNICO\\QUALITA' E MODULISTICA\\DOCUMENTI CONDIVISI A.G.PRESS\\SCHEDE DIFETTI DI PRODUZIONE M06-8"
];

["openTavole", "openCicli", "openMontaggioStampi", "openDifettiProduzione"].forEach((id, index) => {
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
