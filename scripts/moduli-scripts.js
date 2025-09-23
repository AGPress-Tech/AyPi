const { ipcRenderer } = require("electron");
const { initCommonUI } = require("../modules/utils");

initCommonUI();

const filePaths = [
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\AyPi Valutazione Fornitori\\AyPi - Valutazione Fornitori.accdb",
    "\\\\Dl360\\pubbliche\\MAGAZZINO\\DDT FORNITORI\\Controllo DDT fornitori.accdb",
    "\\\\Dl360\\pubbliche\\QUALITA'\\MANUTENZIONI MACCHINE\\AyPi - Manutenzione Macchine.accdb",
    "\\\\Dl360\\pubbliche\\QUALITA'\\CERTIFICAZIONE ISO 9001-2015\\STRUMENTI E TARATURE\\AyPi - Strumenti e Tarature.accdb",
    "\\\\Dl360\\pubbliche\\TECNICO\\MODULO STAMPI\\S1 - Scheda Montaggio Stampi.xlsm",   
    "\\\\Dl360\\pubbliche\\OFF. MECCANICA\\Gestione Morsetti\\AyPi - Gestione Morsetti.accdb",
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\AyPi Gestione Utensili e Attrezzature\\AyPi - Gestione Utensili e Attrezzature.accdb",
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\AyPi Ticket Support\\AyPi - Ticket Support.accdb"
];

const buttons = [
    "openFornitori", "openDDT", "openManutenzioni", "openTarature",
    "openModuloStampi", "openMorsetti", "openUtensili", "openTicket"
];

buttons.forEach((id, index) => {
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
