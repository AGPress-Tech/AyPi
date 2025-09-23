const { shell, ipcRenderer } = require("electron");

function initAppVersion() {
    ipcRenderer.invoke("get-app-version").then((version) => {
        const appVersion = document.getElementById("appVersion");
        if (appVersion) {
            appVersion.textContent = `AyPi v${version}`;
        }
    });
}

function initGithubIcon() {
    const githubIcon = document.getElementById("githubIcon");
    if (githubIcon) {
        githubIcon.addEventListener("click", () => {
            shell.openExternal("https://github.com/AGPress-Tech/AyPi");
        });
    }
}

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
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const clock = document.getElementById("clock");
    if (clock) {
        clock.textContent = `${hours}:${minutes}`;
    }
}
function initClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function initCommonUI() {
    initAppVersion();
    initGithubIcon();
    initClock();
}

module.exports = {
    initCommonUI,
    openNav,
    closeNav
};
