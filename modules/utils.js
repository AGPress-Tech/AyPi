// Import moduli Node/Electron
const { ipcRenderer, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { exec } = require("child_process");

// Percorso add-in Excel
const addinUrl = 'http://data.agpress-srl.it/AypiExcelAddin/MacroUtils.xlam';
const addinFolder = path.join(process.env.APPDATA, 'Microsoft', 'AddIns');
if (!fs.existsSync(addinFolder)) fs.mkdirSync(addinFolder, { recursive: true });
const addinPath = path.join(addinFolder, 'MacroUtils.xlam');

// Funzione per installare/aggiornare add-in
async function installAddinFunction() {
    try {
        const response = await axios.get(addinUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const alreadyExists = fs.existsSync(addinPath);
        fs.writeFileSync(addinPath, buffer);

        if (alreadyExists) {
            alert('AyPi Excel Add-in aggiornato correttamente!');
        } else {
            const psScript = `
                try {
                    $addinPath = "${addinPath.replace(/\\/g, '\\\\')}"
                    $excel = New-Object -ComObject Excel.Application
                    $excel.Visible = $false
                    $addin = $excel.AddIns.Add($addinPath, $true)
                    $addin.Installed = $true
                    $excel.Quit()
                    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
                    Write-Output "SUCCESS"
                } catch {
                    Write-Output "FAIL"
                }
            `;
            exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g,'')}"`, (error, stdout) => {
                if (stdout && stdout.includes('SUCCESS')) {
                    alert('AyPi Excel Add-in installato correttamente!');
                } else {
                    alert('Add-in installato, ma non è stato possibile attivarlo automaticamente. Attivalo manualmente da Excel.');
                }
            });
        }

    } catch (err) {
        alert('Errore nel download dell’add-in: ' + err.message);
    }
}

// Funzione principale per inizializzare UI comune
function initCommonUI() {
    // --- Effetto dissolvenza pagina ---
    document.body.style.opacity = 0;
    document.body.style.transition = "opacity 0.3s ease";
    window.addEventListener("DOMContentLoaded", () => {
        requestAnimationFrame(() => {
            document.body.style.opacity = 1;
        });
    });

    // --- Icona GitHub ---
    const githubIcon = document.getElementById("githubIcon");
    if (githubIcon) {
        githubIcon.addEventListener("click", () => {
            shell.openExternal("https://github.com/AGPress-Tech/AyPi");
        });
    }

    // --- Versione app ---
    const appVersionElement = document.getElementById("appVersion");
    if (appVersionElement) {
        ipcRenderer.invoke("get-app-version").then(version => {
            appVersionElement.textContent = `AyPi v${version}`;
        });
    }

    // --- Caricamento dinamico sidebar ---
    const sidebarContainer = document.getElementById("sidebar-container");
    if (sidebarContainer) {
        fetch('sidebar.html')
            .then(res => res.text())
            .then(html => {
                sidebarContainer.innerHTML = html;

                // Elementi sidebar
                const sidebar = document.getElementById("mySidebar");
                const closeBtn = sidebar ? sidebar.querySelector(".closebtn") : null;
                const menuBtn = document.getElementById("menuBtn");

                // Funzioni apertura/chiusura
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

                // --- Orologio sidebar ---
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
                }

                // --- Pulsante add-in ---
                const installBtn = document.getElementById('install-addin');
                if (installBtn) {
                    installBtn.addEventListener('click', installAddinFunction);
                }

            })
            .catch(err => console.error("Errore caricamento sidebar:", err));
    }
}

// Esportazione funzione
module.exports = { initCommonUI };
