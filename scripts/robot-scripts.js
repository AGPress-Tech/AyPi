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

const robots = [
    { id: "21D500", url: "http://192.168.1.153/index1.html", chiave: "STATO ROBOT P21160" },
    { id: "21D600", url: "http://192.168.1.152/index1.html", chiave: "STATO ROBOT P17259" },
    { id: "21D850", url: "http://192.168.1.92/index1.html", chiave: "STATO ROBOT P22022" }
];

robots.forEach(robot => {
    const btn = document.getElementById(`show${robot.id}`);
    if (btn) {
        btn.addEventListener("click", () => {
            ipcRenderer.send("mostra-robot-popup", robot.id, robot.url, robot.chiave);
        });
    }
});

const pingBtn = document.getElementById("pingRobots");
if (pingBtn) {
    pingBtn.addEventListener("click", async () => {
        await ipcRenderer.invoke("ping-robot-dialog");
    });
}

initCommonUI();

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});
