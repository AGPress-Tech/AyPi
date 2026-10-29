import { setupRobotConsole } from './forge/robot-console';
import { setupForgeSplash } from './forge/splash';
const { ipcRenderer } = require("electron");
const theme =
    new URLSearchParams(location.search).get("theme") === "bluearchive"
        ? "bluearchive"
        : "standard";
document.documentElement.dataset.forgeTheme = theme;
document.body.classList.toggle('agpress-scripted-splash',theme==='standard');
const bootSplash=setupForgeSplash();
bootSplash.mark('interface');bootSplash.mark('theme');
const robotConsole=setupRobotConsole();
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
    ipcRenderer.send("open-production-planner-window", { theme:'standard' }),
);
element("forge-open-forno").addEventListener("click", () =>
    ipcRenderer.send("open-forno-window",{theme}),
);
element("forge-open-robots").addEventListener("click", () => showSection(true));
element("forge-home").addEventListener("click", () => showSection(false));
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented && !element("forge-robots").hidden && document.getElementById('robotConsoleBackdrop')?.getAttribute('aria-hidden')==='true')
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
        robotConsole.openStatus({robotId:robot.id,robotUrl:robot.url,robotStateKey:robot.key}),
    );
element("pingRobots").addEventListener("click",()=>robotConsole.openConnections());
const clock = () =>
    (element("forge-clock").textContent = new Date().toLocaleTimeString(
        "it-IT",
        { hour: "2-digit", minute: "2-digit" },
    ));
clock();
const timer = setInterval(clock, 30000);
bootSplash.mark('modules');bootSplash.mark('ready');bootSplash.ready();
window.addEventListener("beforeunload", () => {clearInterval(timer);bootSplash.dispose();});
export {};
