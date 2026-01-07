const { ipcRenderer, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { exec } = require("child_process");

const ADDIN_URL = "http://data.agpress-srl.it/AypiExcelAddin/MacroUtils.xlam";
const ADDIN_FOLDER = "C:\\AyPiAddin";
const ADDIN_FILENAME = "MacroUtils.xlam";
const ADDIN_PATH = path.join(ADDIN_FOLDER, ADDIN_FILENAME);

function ensureAddinFolder() {
    if (!fs.existsSync(ADDIN_FOLDER)) {
        fs.mkdirSync(ADDIN_FOLDER, { recursive: true });
    }
}

async function downloadAddin() {
    const response = await axios.get(ADDIN_URL, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    fs.writeFileSync(ADDIN_PATH, buffer);
}

function buildPowerShellInstallScript() {
    const escapedPath = ADDIN_PATH.replace(/\\/g, "\\\\");
    return [
        "try {",
        `  $addinPath = "${escapedPath}"`,
        "  $excel = New-Object -ComObject Excel.Application",
        "  $excel.Visible = $false",
        "  $addin = $excel.AddIns.Add($addinPath, $true)",
        "  $addin.Installed = $true",
        "  $excel.Quit()",
        "  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null",
        "  Write-Output \"SUCCESS\"",
        "} catch {",
        "  Write-Output \"FAIL\"",
        "}",
    ].join(" ");
}

function tryEnableAddin() {
    const script = buildPowerShellInstallScript();
    exec(`powershell -NoProfile -Command "${script}"`, (error, stdout) => {
        if (stdout && stdout.includes("SUCCESS")) {
            alert("AyPi Excel Add-in installato correttamente!");
        } else {
            alert("Add-in installato, ma non e' stato possibile attivarlo automaticamente. Attivalo manualmente da Excel.");
        }
    });
}

async function installAddinFunction() {
    try {
        ensureAddinFolder();
        const alreadyExists = fs.existsSync(ADDIN_PATH);
        await downloadAddin();

        if (alreadyExists) {
            alert("AyPi Excel Add-in aggiornato correttamente!");
        } else {
            tryEnableAddin();
        }
    } catch (err) {
        alert("Errore nel download dell'add-in: " + err.message);
    }
}

function fadeInBodyOnLoad() {
    document.body.style.opacity = 0;
    document.body.style.transition = "opacity 0.3s ease";
    window.addEventListener("DOMContentLoaded", () => {
        requestAnimationFrame(() => {
            document.body.style.opacity = 1;
        });
    });
}

function wireGithubIcon() {
    const githubIcon = document.getElementById("githubIcon");
    if (!githubIcon) return;
    githubIcon.addEventListener("click", () => {
        shell.openExternal("https://github.com/AGPress-Tech/AyPi");
    });
}

function wireAppVersion() {
    const appVersionElement = document.getElementById("appVersion");
    if (!appVersionElement) return;
    ipcRenderer.invoke("get-app-version").then((version) => {
        appVersionElement.textContent = `AyPi v${version}`;
    });
}

function wireSidebarActions() {
    const sidebarContainer = document.getElementById("sidebar-container");
    if (!sidebarContainer) return;

    fetch("sidebar.html")
        .then((res) => res.text())
        .then((html) => {
            sidebarContainer.innerHTML = html;

            const sidebar = document.getElementById("mySidebar");
            const closeBtn = sidebar ? sidebar.querySelector(".closebtn") : null;
            const menuBtn = document.getElementById("menuBtn");

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

            if (menuBtn) menuBtn.addEventListener("mouseenter", openNav);
            if (sidebar) sidebar.addEventListener("mouseleave", closeNav);
            if (closeBtn) closeBtn.addEventListener("click", closeNav);

            const clockElement = document.getElementById("clock");
            if (clockElement) {
                function updateClock() {
                    const now = new Date();
                    const hours = now.getHours().toString().padStart(2, "0");
                    const minutes = now.getMinutes().toString().padStart(2, "0");
                    clockElement.textContent = `${hours}:${minutes}`;
                }
                updateClock();
                setInterval(updateClock, 1000);

                clockElement.addEventListener("click", () => {
                    ipcRenderer.send("open-timer-window");
                });
            }

            const installBtn = document.getElementById("install-addin");
            if (installBtn) {
                installBtn.addEventListener("click", installAddinFunction);
            }
        })
        .catch((err) => console.error("Errore caricamento sidebar:", err));
}

function initCommonUI() {
    fadeInBodyOnLoad();
    wireGithubIcon();
    wireAppVersion();
    wireSidebarActions();
}

module.exports = { initCommonUI };
