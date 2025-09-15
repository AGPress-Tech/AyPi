const { ipcRenderer, shell } = require("electron");

ipcRenderer.invoke("get-app-version").then((version) => {
    document.getElementById("appVersion").textContent = `AyPi v${version}`;
});

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

const buttons = ["openFornitori", "openDDT", "openManutenzioni", "openTarature", "openModuloStampi", "openMorsetti", "openUtensili", "openTicket"];

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

function updateClock() {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        document.getElementById('clock').textContent = `${hours}:${minutes}`;
    }
    
setInterval(updateClock, 1000);
updateClock();

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});

