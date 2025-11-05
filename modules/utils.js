// Importa i moduli necessari da Electron e Node.js
const { ipcRenderer, shell } = require("electron");   // ipcRenderer: comunica con il processo principale; shell: apre link esterni
const path = require("path");                         // Gestione dei percorsi di file e directory
const fs = require("fs");                             // Lettura/scrittura file nel filesystem
const axios = require("axios");                       // Richieste HTTP (download, API, ecc.)
const { exec } = require("child_process");            // Esecuzione di comandi esterni (es. PowerShell)

// Inizializza gli elementi comuni dell'interfaccia utente
function initCommonUI() {

    // --- Effetto dissolvenza al caricamento pagina ---
    document.body.style.opacity = 0;
    document.body.style.transition = "opacity 0.3s ease";
    window.addEventListener("DOMContentLoaded", () => {
        requestAnimationFrame(() => {
            document.body.style.opacity = 1; // Mostra il corpo gradualmente
        });
    });

    // --- Icona GitHub: apre il repository ---
    const githubIcon = document.getElementById("githubIcon");
    if (githubIcon) {
        githubIcon.addEventListener("click", () => {
            shell.openExternal("https://github.com/AGPress-Tech/AyPi");
        });
    }

    // --- Orologio in tempo reale (HH:MM) ---
    const clockElement = document.getElementById("clock");
    if (clockElement) {
        function updateClock() {
            const now = new Date();
            const hours = now.getHours().toString().padStart(2, "0");
            const minutes = now.getMinutes().toString().padStart(2, "0");
            clockElement.textContent = `${hours}:${minutes}`; // Aggiorna l'orologio
        }
        setInterval(updateClock, 1000); // Aggiorna ogni secondo
        updateClock();                  // Aggiorna subito al caricamento
    }

    // --- Mostra la versione corrente dell'app ---
    const appVersionElement = document.getElementById("appVersion");
    if (appVersionElement) {
        ipcRenderer.invoke("get-app-version").then(version => {
            appVersionElement.textContent = `AyPi v${version}`;
        });
    }

    // --- Gestione sidebar/menu ---
    const sidebar = document.getElementById("mySidebar");
    const menuBtn = document.getElementById("menuBtn");
    const closeBtn = sidebar ? sidebar.querySelector(".closebtn") : null;

    // Apre la sidebar (30% della larghezza schermo)
    function openNav() {
        if (sidebar) sidebar.style.width = "30%";
        const main = document.getElementById("main");
        if (main) main.style.marginLeft = "30%";
    }

    // Chiude la sidebar
    function closeNav() {
        if (sidebar) sidebar.style.width = "0";
        const main = document.getElementById("main");
        if (main) main.style.marginLeft = "0";
    }

    // Apre la sidebar al passaggio del mouse sul pulsante menu
    if (menuBtn) {
        menuBtn.addEventListener("mouseenter", openNav);
    }

    // Chiude la sidebar quando il cursore esce
    if (sidebar) {
        sidebar.addEventListener("mouseleave", closeNav);
    }

    // Pulsante di chiusura sidebar
    if (closeBtn) {
        closeBtn.addEventListener("click", closeNav);
    }
}

// URL dell'add-in Excel da scaricare
const addinUrl = 'http://data.agpress-srl.it/AypiExcelAddin/MacroUtils.xlam';

// Percorso locale della cartella AddIns di Excel
const addinFolder = path.join(process.env.APPDATA, 'Microsoft', 'AddIns');

// Crea la cartella se non esiste
if (!fs.existsSync(addinFolder)) fs.mkdirSync(addinFolder, { recursive: true });

// Percorso completo dove salvare l'add-in
const addinPath = path.join(addinFolder, 'MacroUtils.xlam');

// --- Quando l’utente clicca su “install-addin” ---
document.getElementById('install-addin').addEventListener('click', async () => {
    try {
        // Scarica il file dall’URL remoto come buffer binario
        const response = await axios.get(addinUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        // Controlla se esiste già (per capire se è aggiornamento o nuova installazione)
        const alreadyExists = fs.existsSync(addinPath);

        // Scrive il file nella cartella AddIns
        fs.writeFileSync(addinPath, buffer);

        if (alreadyExists) {
            // Se il file esisteva già → è un aggiornamento
            alert('AyPi Excel Add-in aggiornato correttamente!');
        } else {
            // Se è una nuova installazione → tenta di installarlo in Excel via PowerShell
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

            // Esegue lo script PowerShell in background per aggiungere l’add-in a Excel
            exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g,'')}"`, (error, stdout) => {
                if (stdout && stdout.includes('SUCCESS')) {
                    // Installazione e attivazione completate
                    alert('AyPi Excel Add-in installato correttamente!');
                } else {
                    // Installazione riuscita, ma attivazione automatica fallita
                    alert('AyPi Excel Add-in installato correttamente, ma non è stato possibile attivarlo automaticamente.\nPuoi attivarlo manualmente da Excel.');
                }
            });
        }

    } catch (err) {
        // Gestione errori (es. rete, permessi, URL non raggiungibile)
        alert('Errore nel download: ' + err.message);
    }
});

// Esporta la funzione per essere usata altrove (es. nel preload o nel renderer)
module.exports = { initCommonUI };
