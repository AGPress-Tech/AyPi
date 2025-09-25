const { ipcRenderer, shell } = require("electron");
const { initCommonUI } = require("../modules/utils");

initCommonUI();

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

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});
