const { ipcRenderer, shell } = require("electron");

ipcRenderer.invoke("get-app-version").then((version) => {
    document.getElementById("appVersion").textContent = `AyPi v${version}`;
});

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

document.getElementById("pingRobots").addEventListener("click", async () => {
  await ipcRenderer.invoke("ping-robot-dialog");
});