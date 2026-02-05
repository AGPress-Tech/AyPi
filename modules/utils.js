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
    const applyFadeIn = () => {
        if (!document.body) return;
        document.body.style.opacity = 0;
        document.body.style.transition = "opacity 0.3s ease";
        requestAnimationFrame(() => {
            document.body.style.opacity = 1;
        });
    };

    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", applyFadeIn, { once: true });
    } else {
        applyFadeIn();
    }
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

function wireAdminHotkey() {
    const ensureAdminPrompt = () => {
        if (document.getElementById("aypi-admin-overlay")) {
            return;
        }

        const overlay = document.createElement("div");
        overlay.id = "aypi-admin-overlay";
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = "rgba(0, 0, 0, 0.55)";
        overlay.style.display = "none";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.zIndex = "9999";

        const card = document.createElement("div");
        card.style.background = "#2b2824";
        card.style.border = "1px solid #4a433d";
        card.style.borderRadius = "10px";
        card.style.boxShadow = "0 8px 20px rgba(0,0,0,0.6)";
        card.style.padding = "14px 16px";
        card.style.minWidth = "280px";

        const title = document.createElement("div");
        title.textContent = "Admin";
        title.style.color = "#e4ab32";
        title.style.fontWeight = "600";
        title.style.marginBottom = "8px";

        const input = document.createElement("input");
        input.type = "password";
        input.placeholder = "Password";
        input.style.width = "100%";
        input.style.boxSizing = "border-box";
        input.style.padding = "6px 8px";
        input.style.borderRadius = "6px";
        input.style.border = "1px solid #777";
        input.style.background = "#1f1c19";
        input.style.color = "#fff";
        input.style.marginBottom = "10px";

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.justifyContent = "flex-end";
        actions.style.gap = "8px";

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.textContent = "Annulla";
        cancelBtn.style.padding = "6px 12px";
        cancelBtn.style.borderRadius = "6px";
        cancelBtn.style.border = "none";
        cancelBtn.style.background = "#4a433d";
        cancelBtn.style.color = "#f3e6d5";

        const okBtn = document.createElement("button");
        okBtn.type = "button";
        okBtn.textContent = "Conferma";
        okBtn.style.padding = "6px 12px";
        okBtn.style.borderRadius = "6px";
        okBtn.style.border = "none";
        okBtn.style.background = "#cc930e";
        okBtn.style.color = "#332f2b";

        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);

        card.appendChild(title);
        card.appendChild(input);
        card.appendChild(actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const close = () => {
            overlay.style.display = "none";
            input.value = "";
        };

        cancelBtn.addEventListener("click", close);
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close();
        });

        const submit = async () => {
            const password = input.value;
            if (!password) return;
            const result = await ipcRenderer.invoke("admin-auth", password);
            if (result && result.ok) {
                ipcRenderer.invoke("show-message-box", {
                    type: "info",
                    message: "Accesso admin attivo fino alla chiusura dell'app.",
                });
            } else {
                ipcRenderer.invoke("show-message-box", {
                    type: "warning",
                    message: "Password non valida.",
                });
            }
            close();
        };

        okBtn.addEventListener("click", submit);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                submit();
            } else if (event.key === "Escape") {
                event.preventDefault();
                close();
            }
        });
    };

    const runPrompt = async () => {
        if (document.hidden || !document.hasFocus()) return;
        const isAdmin = await ipcRenderer.invoke("admin-is-enabled");
        if (isAdmin) {
            await ipcRenderer.invoke("admin-disable");
            ipcRenderer.invoke("show-message-box", {
                type: "info",
                message: "Modalità ADMIN terminata",
            });
            return;
        }

        ensureAdminPrompt();
        const overlay = document.getElementById("aypi-admin-overlay");
        const input = overlay ? overlay.querySelector("input") : null;
        if (!overlay || !input) return;
        overlay.style.display = "flex";
        input.focus();
        input.select();
    };

    window.addEventListener("keydown", async (event) => {
        if (event.key !== "F2") return;
        event.preventDefault();
        if (document.hidden || !document.hasFocus()) return;
        runPrompt();
    });

    ipcRenderer.on("admin-hotkey", () => {
        if (document.hidden || !document.hasFocus()) return;
        runPrompt();
    });

    ipcRenderer.on("admin-hotkey-close", () => {
        const overlay = document.getElementById("aypi-admin-overlay");
        if (!overlay) return;
        const input = overlay.querySelector("input");
        overlay.style.display = "none";
        if (input) input.value = "";
    });
}

function wireSidebarActions() {
    const sidebarContainer = document.getElementById("sidebar-container");
    if (!sidebarContainer) return;

    const applySidebarHtml = (html) => {
        sidebarContainer.innerHTML = typeof html === "string" ? html : String(html || "");

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

        if (menuBtn) {
            menuBtn.addEventListener("mouseenter", openNav);
            menuBtn.addEventListener("click", openNav);
        }
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

        if (!sidebar || !menuBtn) {
            ipcRenderer.invoke("show-message-box", {
                type: "warning",
                message: "Sidebar non inizializzata.",
                detail: `sidebar: ${!!sidebar} | menuBtn: ${!!menuBtn}`,
            });
        }
    };

    const sidebarPath = path.join(__dirname, "..", "pages", "sidebar.html");
    try {
        const html = fs.readFileSync(sidebarPath, "utf8");
        if (html) {
            applySidebarHtml(html);
            return;
        }
    } catch (err) {
        console.error("Errore lettura sidebar da path:", err);
    }
    fetch("sidebar.html")
        .then((res) => res.text())
        .then((htmlText) => applySidebarHtml(htmlText))
        .catch((fetchErr) => {
            console.error("Errore caricamento sidebar:", fetchErr);
            ipcRenderer.invoke("show-message-box", {
                type: "warning",
                message: "Sidebar non caricata.",
                detail: `Percorso: ${sidebarPath}\n${fetchErr?.message || fetchErr}`,
            });
        });
}

function initCommonUI() {
    const run = () => {
        fadeInBodyOnLoad();
        wireGithubIcon();
        wireAppVersion();
        wireAdminHotkey();
        wireSidebarActions();
    };
    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", run, { once: true });
    } else {
        run();
    }
}

module.exports = { initCommonUI };
