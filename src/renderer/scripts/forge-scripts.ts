const { ipcRenderer } = require("electron");
const theme =
    new URLSearchParams(location.search).get("theme") === "bluearchive"
        ? "bluearchive"
        : "standard";
document.documentElement.dataset.forgeTheme = theme;
const element = (id: string) => document.getElementById(id)!;
element("forge-edition").textContent =
    theme === "bluearchive" ? "BLUE ARCHIVE" : "AGPRESS";
element("forge-future-editor").hidden = theme !== "bluearchive";
function showSection(robots: boolean) {
    element("forge-overview").hidden = robots;
    element("forge-robots").hidden = !robots;
    element("forge-section-label").textContent = robots
        ? "Verifica robot"
        : "Centrale operativa";
    if (robots) element("show21D500").focus();
    else element("forge-open-robots").focus();
}
element("forge-open-mes").addEventListener("click", () =>
    ipcRenderer.send("open-production-planner-window", { theme }),
);
element("forge-open-forno").addEventListener("click", () =>
    ipcRenderer.send("open-forno-window"),
);
element("forge-open-robots").addEventListener("click", () => showSection(true));
element("forge-home").addEventListener("click", () => showSection(false));
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !element("forge-robots").hidden)
        showSection(false);
});
const robots = [
    {
        id: "21D500",
        url: "http://192.168.1.153/index1.html",
        key: "STATO ROBOT P21160",
    },
    {
        id: "21D600",
        url: "http://192.168.1.152/index1.html",
        key: "STATO ROBOT P17259",
    },
    {
        id: "21D850",
        url: "http://192.168.1.92/index1.html",
        key: "STATO ROBOT P22022",
    },
];
for (const robot of robots)
    element("show" + robot.id).addEventListener("click", () =>
        ipcRenderer.send("mostra-robot-popup", robot.id, robot.url, robot.key),
    );
element("pingRobots").addEventListener("click", async () => {
    const button = element("pingRobots") as HTMLButtonElement;
    button.disabled = true;
    try {
        await ipcRenderer.invoke("ping-robot-dialog");
    } catch (error) {
        const message = element("forge-error");
        message.hidden = false;
        message.textContent =
            "Verifica connessioni non disponibile: " +
            String((error as Error).message || error);
    } finally {
        button.disabled = false;
    }
});
const clock = () =>
    (element("forge-clock").textContent = new Date().toLocaleTimeString(
        "it-IT",
        { hour: "2-digit", minute: "2-digit" },
    ));
clock();
const timer = setInterval(clock, 30000);
window.addEventListener("beforeunload", () => clearInterval(timer));
export {};
