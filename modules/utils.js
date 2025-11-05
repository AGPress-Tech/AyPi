const { ipcRenderer, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { exec } = require("child_process");

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

const addinUrl = 'http://data.agpress-srl.it/AypiExcelAddin/MacroUtils.xlam';
const addinFolder = path.join(process.env.APPDATA, 'Microsoft', 'AddIns');

if (!fs.existsSync(addinFolder)) fs.mkdirSync(addinFolder, { recursive: true });

const addinPath = path.join(addinFolder, 'MacroUtils.xlam');

document.getElementById('install-addin').addEventListener('click', async () => {
    try {
        // Scarica come arraybuffer
        const response = await axios.get(addinUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        // Controlla se il file esiste già
        const alreadyExists = fs.existsSync(addinPath);

        // Scrive il file (sovrascrivendo se già presente)
        fs.writeFileSync(addinPath, buffer);

        if (alreadyExists) {
            alert('AyPi Excel Add-in aggiornato correttamente!');
        } else {
            // Prova a registrare l'addin in Excel solo per installazione nuova
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
                    alert('AyPi Excel Add-in installato correttamente, ma non è stato possibile attivarlo automaticamente.\nPuoi attivarlo manualmente da Excel.');
                }
            });
        }

    } catch (err) {
        alert('Errore nel download: ' + err.message);
    }
});

module.exports = { initCommonUI };
