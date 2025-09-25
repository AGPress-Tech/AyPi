const { ipcRenderer, shell } = require("electron");

function initCommonUI() {
    document.body.style.opacity = 0;
    document.body.style.transition = "opacity 0.3s ease";
    window.addEventListener("DOMContentLoaded", () => {
        requestAnimationFrame(() => {
            document.body.style.opacity = 1;
        });
    });

    const githubIcon = document.getElementById("githubIcon");
    if (githubIcon) {
        githubIcon.addEventListener("click", () => {
            shell.openExternal("https://github.com/AGPress-Tech/AyPi");
        });
    }

    const clockElement = document.getElementById("clock");
    if (clockElement) {
        function updateClock() {
            const now = new Date();
            const hours = now.getHours().toString().padStart(2, "0");
            const minutes = now.getMinutes().toString().padStart(2, "0");
            clockElement.textContent = `${hours}:${minutes}`;
        }
        setInterval(updateClock, 1000);
        updateClock();
    }

    const appVersionElement = document.getElementById("appVersion");
    if (appVersionElement) {
        ipcRenderer.invoke("get-app-version").then(version => {
            appVersionElement.textContent = `AyPi v${version}`;
        });
    }

const sidebar = document.getElementById("mySidebar");
    const menuBtn = document.getElementById("menuBtn");
    const closeBtn = sidebar ? sidebar.querySelector(".closebtn") : null;

    function openNav() {
        if (sidebar) sidebar.style.width = "30%";
        const main = document.getElementById("main");
        if (main) main.style.marginLeft = "30%";
    }

    function closeNav() {
        if (sidebar) sidebar.style.width = "0";
        const main = document.getElementById("main");
        if (main) main.style.marginLeft = "0";
    }

    if (menuBtn) {
        menuBtn.addEventListener("mouseenter", openNav);
    }

    if (sidebar) {
        sidebar.addEventListener("mouseleave", closeNav);
    }

    if (closeBtn) {
        closeBtn.addEventListener("click", closeNav);
    }
}

module.exports = { initCommonUI };
