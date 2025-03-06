const { ipcRenderer, shell } = require("electron");

//Recupera la versione dell'app
ipcRenderer.invoke("get-app-version").then((version) => {
    document.getElementById("appVersion").textContent = `AyPi v${version}`;
});

const filePaths = [
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\AyPi Ticket Support\\AyPi - Ticket Support.accdb",
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\AyPi Valutazione Fornitori\\AyPi - Valutazione Fornitori.accdb",
    "\\\\Dl360\\pubbliche\\QUALITA'\\MANUTENZIONI MACCHINE\\AyPi - Manutenzione Macchine.accdb",
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\AyPi Gestione Utensili e Attrezzature\\AyPi - Gestione Utensili e Attrezzature.accdb",
];

const buttons = ["openTicket", "openFornitori", "openManutenzioni", "openUtensili"];

buttons.forEach((id, index) => {
    document.getElementById(id).addEventListener("click", () => {
        ipcRenderer.send("open-file", filePaths[index]);
    });
});

document.getElementById("githubIcon").addEventListener("click", () => {
    shell.openExternal("https://github.com/AGPress-Tech/AyPi");
});

function openNav() {
    document.getElementById("main").style.marginLeft = "35%";
    document.getElementById("mySidebar").style.width = "35%";
    document.getElementById("mySidebar").style.display = "block";
    document.getElementById("openNav").style.display = "none";
}

function closeNav() {
    document.getElementById("main").style.marginLeft = "0%";
    document.getElementById("mySidebar").style.display = "none";
    document.getElementById("openNav").style.display = "inline-block";
}
