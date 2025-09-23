const { ipcRenderer, shell } = require("electron");
const { initCommonUI } = require("../modules/utils");

ipcRenderer.invoke("get-app-version").then(version => {
    document.getElementById("appVersion").textContent = `AyPi v${version}`;
});

document.getElementById("githubIcon").addEventListener("click", () => {
    shell.openExternal("https://github.com/AGPress-Tech/AyPi");
});

function updateClock() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    document.getElementById("clock").textContent = `${hours}:${minutes}`;
}
updateClock();
setInterval(updateClock, 1000);

const sidebar = document.getElementById("mySidebar");
const menuBtn = document.getElementById("menuBtn");
const closeBtn = sidebar.querySelector(".closebtn");

function openNav() {
    sidebar.style.width = "250px";
    document.getElementById("main").style.marginLeft = "250px";
}

function closeNav() {
    sidebar.style.width = "0";
    document.getElementById("main").style.marginLeft = "0";
}

menuBtn.addEventListener("mouseenter", openNav);
sidebar.addEventListener("mouseleave", closeNav);
closeBtn.addEventListener("click", closeNav);

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

initCommonUI();

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});
