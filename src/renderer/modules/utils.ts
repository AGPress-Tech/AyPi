import { ipcRenderer, shell } from "electron";
import path from "path";
import fs from "fs";
import http from "http";
import https from "https";
import { exec } from "child_process";

const ADDIN_URL = "https://data.agpress-srl.it/AypiExcelAddin/MacroUtils.xlam";
const ADDIN_FOLDER = "C:\\AyPiAddin";
const ADDIN_FILENAME = "MacroUtils.xlam";
const ADDIN_PATH = path.join(ADDIN_FOLDER, ADDIN_FILENAME);

function ensureAddinFolder() {
    if (!fs.existsSync(ADDIN_FOLDER)) {
        fs.mkdirSync(ADDIN_FOLDER, { recursive: true });
    }
}

const MAX_REDIRECTS = 5;

function downloadAddin() {
    // Uso new Promise<voi> per evitare il callback hell
    return new Promise<void>((resolve, reject) => {
        // Funzione per effettuare il download
        const startDownload = (urlStr: string, redirectsLeft: number) => {
            // Controlla se l'URL è valida
            let url: URL;
            try {
                // se la stringa non è un URL, provo a creare un oggetto URL
                url = new URL(urlStr);
            } catch (err) {
                reject(new Error(`URL non valida: ${urlStr}`));
                return;
            }

            // Effettua il download
            const client = url.protocol === "https:" ? https : http;
            // const request fa una richiesta HTTP al server e riceve una risposta
            const request = client.get(
                url,
                {
                    timeout: 15000,
                    headers: {
                        "User-Agent": "AyPi-Addin-Updater/1.0",
                        Accept: "*/*",
                    },
                },
                (res) => {
                    const status = res.statusCode || 0;
                    const isRedirect = [301, 302, 303, 307, 308].includes(
                        status,
                    );

                    // se la risposta è un redirect e ci sono ancora redirects da effettuare
                    if (isRedirect && res.headers.location) {
                        // se non ci sono più redirects da effettuare
                        if (redirectsLeft <= 0) {
                            // se la risposta è un redirect e non ci sono più redirects da effettuare chiudo la richiesta
                            res.resume();
                            // altrimenti ritorno un errore
                            reject(
                                new Error(
                                    "Troppi redirect durante il download.",
                                ),
                            );
                            return;
                        }
                        // se la risposta è un redirect e ci sono ancora redirects da effettuare
                        const nextUrl = new URL(
                            // converto l'URL del redirect in un oggetto URL
                            res.headers.location,
                            url,
                        ).toString();
                        res.resume();
                        startDownload(nextUrl, redirectsLeft - 1);
                        return;
                    }

                    // se la risposta non è un redirect e il codice di stato non è 200 (OK)
                    if (status !== 200) {
                        res.resume();
                        reject(
                            new Error(
                                `Risposta non valida dal server (HTTP ${status}).`,
                            ),
                        );
                        return;
                    }

                    const tmpPath = `${ADDIN_PATH}.tmp`;
                    // creo un file temporaneo per il download
                    const file = fs.createWriteStream(tmpPath);
                    res.pipe(file);

                    // quando il download è completato chiudo il file e rinomino il file temporaneo in ADDIN_PATH
                    file.on("finish", () => {
                        file.close(() => {
                            try {
                                if (fs.existsSync(ADDIN_PATH)) {
                                    fs.unlinkSync(ADDIN_PATH);
                                }
                                fs.renameSync(tmpPath, ADDIN_PATH);
                                resolve();
                            } catch (err) {
                                reject(err);
                            }
                        });
                    });

                    file.on("error", (err) => {
                        res.resume();
                        reject(err);
                    });
                },
            );

            // se il download fallisce o viene interrotto, chiudo la richiesta
            request.on("timeout", () => {
                request.destroy(new Error("Timeout durante il download."));
            });
            request.on("error", (err) => {
                reject(err);
            });
        };

        startDownload(ADDIN_URL, MAX_REDIRECTS);
    });
}

// Funzione per creare lo script PowerShell per installare l'add-in
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
        '  Write-Output "SUCCESS"',
        "} catch {",
        '  Write-Output "FAIL"',
        "}",
    ].join(" ");
}

// Funzione per attivare l'add-in
function tryEnableAddin() {
    const script = buildPowerShellInstallScript();
    exec(`powershell -NoProfile -Command "${script}"`, (_error, stdout) => {
        if (stdout && stdout.includes("SUCCESS")) {
            alert("AyPi Excel Add-in installato correttamente!");
        } else {
            alert(
                "Add-in installato, ma non e' stato possibile attivarlo automaticamente. Attivalo manualmente da Excel.",
            );
        }
    });
}

// Funzione per installare l'add-in
async function installAddinFunction() {
    // controlla se l'add-in è già installato
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
        const message = err instanceof Error ? err.message : String(err);
        alert("Errore nel download dell'add-in: " + message);
    }
}

function fadeInBodyOnLoad() {
    const applyFadeIn = () => {
        if (!document.body) return;
        document.body.style.opacity = "0";
        document.body.style.transition = "opacity 0.3s ease";
        requestAnimationFrame(() => {
            document.body.style.opacity = "1";
        });
    };

    if (document.readyState === "loading") {
        window.addEventListener("DOMContentLoaded", applyFadeIn, {
            once: true,
        });
    } else {
        applyFadeIn();
    }
}

// Funzione per collegare l'icona GitHub a un link esterno
function wireGithubIcon() {
    const githubIcon = document.getElementById("githubIcon");
    if (!githubIcon) return;
    githubIcon.addEventListener("click", () => {
        shell.openExternal("https://github.com/AGPress-Tech/AyPi");
    });
}

// Funzione per collegare la versione dell'applicazione
function wireAppVersion() {
    const appVersionElement = document.getElementById("appVersion");
    if (!appVersionElement) return;
    ipcRenderer.invoke("get-app-version").then((version) => {
        appVersionElement.textContent = `AyPi v${version}`;
    });
    appVersionElement.addEventListener("dblclick", () => {
        ipcRenderer.send("open-infographics-window");
    });
}

function wireAdminHotkey() {
    // Funzione per mostrare la finestra di accesso admin
    const ensureAdminPrompt = () => {
        let overlay = document.getElementById(
            "aypi-admin-overlay",
        ) as HTMLDivElement | null;
        // se la finestra non esiste, la creo
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "aypi-admin-overlay";
        }
        // se la finestra non è stata aggiunta al DOM, la aggiungo
        if (overlay.parentElement !== document.body) {
            document.body.appendChild(overlay);
        }
        // se la finestra è stata aggiunta al DOM ma non è stata inizializzata, la inizializzo
        if (overlay.dataset.aypiAdminInit === "1") {
            return;
        }

        overlay.dataset.aypiAdminInit = "1";
        overlay.innerHTML = "";
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

        const close = () => {
            overlay.style.display = "none";
            input.value = "";
        };

        cancelBtn.addEventListener("click", close);
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close();
        });

        // Funzione per confermare l'accesso admin
        const submit = async () => {
            // se l'input è vuoto, chiudo la finestra
            const password = input.value;
            if (!password) return;
            // se la password è corretta, attivo l'accesso admin
            const result = await ipcRenderer.invoke("admin-auth", password);
            if (result && result.ok) {
                ipcRenderer.invoke("show-message-box", {
                    type: "info",
                    message:
                        "Accesso admin attivo fino alla chiusura dell'app.",
                });
            } else {
                // se la password non è corretta, mostro un messaggio di errore
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

    //  runPrompt serve a attivare l'accesso admin
    const runPrompt = async () => {
        // se il documento è nascosto, esco
        if (document.hidden) return;
        // se l'accesso admin è attivo, lo disattivo
        const isAdmin = await ipcRenderer.invoke("admin-is-enabled");
        if (isAdmin) {
            // disattivo l'accesso admin
            await ipcRenderer.invoke("admin-disable");
            ipcRenderer.invoke("show-message-box", {
                type: "info",
                message: "Modalità ADMIN terminata",
            });
            return;
        }

        // attivo l'accesso admin
        ensureAdminPrompt();
        // overlay per l'accesso admin
        const overlay = document.getElementById("aypi-admin-overlay");
        // se l'overlay non esiste, esco
        const input = overlay ? overlay.querySelector("input") : null;
        // se l'input non esiste, esco
        if (!overlay || !input) return;
        overlay.style.display = "flex";
        input.focus();
        (input as HTMLInputElement).select();
    };

    // onHotkey serve a attivare l'accesso admin con il tasto F2
    const onHotkey = (event: KeyboardEvent) => {
        // se il tasto non è F2, esco
        if (event.key !== "F2") return;
        event.preventDefault();
        // se il documento è nascosto, esco
        if (document.hidden) return;
        runPrompt();
    };

    // aggiungo l'event listener
    window.addEventListener("keydown", onHotkey, true);
    document.addEventListener("keydown", onHotkey, true);

    ipcRenderer.on("admin-hotkey", () => {
        if (document.hidden) return;
        runPrompt();
    });

    ipcRenderer.on("admin-hotkey-close", () => {
        const overlay = document.getElementById("aypi-admin-overlay");
        if (!overlay) return;
        const input = overlay.querySelector("input");
        overlay.style.display = "none";
        if (input) (input as HTMLInputElement).value = "";
    });
}

// wireSidebarActions serve a attivare il menu laterale e la ricerca nella sidebar
function wireSidebarActions() {
    // ottengo il container della sidebar
    const sidebarContainer = document.getElementById("sidebar-container");
    if (!sidebarContainer) return;

    // funzione per aggiornare il contenuto della sidebar
    const applySidebarHtml = (html: string) => {
        sidebarContainer.innerHTML =
            typeof html === "string" ? html : String(html || "");

        const sidebar = document.getElementById("mySidebar");
        const closeBtn = sidebar ? sidebar.querySelector(".closebtn") : null;
        const menuBtn = document.getElementById("menuBtn");

        // funzioni per aprire e chiudere la sidebar
        function openNav() {
            // se la sidebar ha già un larghezza, la lascio invariata altrimenti la setto a 30%
            if (sidebar) (sidebar as HTMLElement).style.width = "30%";
            const main = document.getElementById("main");
            // se il main ha già un margin-left, lo lascio invariato altrimenti lo setto a 30%
            if (main) (main as HTMLElement).style.marginLeft = "30%";
        }
        // funzione per chiudere la sidebar
        function closeNav() {
            // se la sidebar ha già un larghezza, la lascio invariata altrimenti la setto a 0
            if (sidebar) (sidebar as HTMLElement).style.width = "0";
            const main = document.getElementById("main");
            // se il main ha già un margin-left, lo lascio invariato altrimenti lo setto a 0
            if (main) (main as HTMLElement).style.marginLeft = "0";
        }

        // se il menuBtn esiste, aggiungo l'event listener per aprire la sidebar
        if (menuBtn) {
            menuBtn.addEventListener("mouseenter", openNav);
            menuBtn.addEventListener("click", openNav);
        }
        // se la sidebar esiste, aggiungo l'event listener per chiudere la sidebar
        if (sidebar) sidebar.addEventListener("mouseleave", closeNav);
        if (closeBtn) closeBtn.addEventListener("click", closeNav);

        // clockElement serve per aggiornare l'orario e per aprire la finestra del timer al click
        const clockElement = document.getElementById("clock");
        // se il clockElement esiste,
        if (clockElement) {
            // funzione per aggiornare l'orario
            function updateClock() {
                const now = new Date();
                const hours = now.getHours().toString().padStart(2, "0");
                const minutes = now.getMinutes().toString().padStart(2, "0");
                if (clockElement)
                    clockElement.textContent = `${hours}:${minutes}`;
            }
            // aggiorno l'orario
            updateClock();
            setInterval(updateClock, 1000);

            clockElement.addEventListener("click", () => {
                ipcRenderer.send("open-timer-window");
            });
        }

        // funzione per installare l'addon excel
        const installBtn = document.getElementById("install-addin");
        if (installBtn) {
            installBtn.addEventListener("click", installAddinFunction);
        }

        // se la sidebar o il menuBtn non esistono, mostro un messaggio di errore
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
                detail: `Percorso: ${sidebarPath}\n${(fetchErr as Error | undefined)?.message || fetchErr}`,
            });
        });
}

// funzione per inizializzare l'interfaccia
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

export { initCommonUI };
