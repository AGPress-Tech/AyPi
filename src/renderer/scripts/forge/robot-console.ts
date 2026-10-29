import fs from 'fs';
import {fileURLToPath} from 'url';
type ActionItem={robotId?:string;robotUrl?:string;robotStateKey?:string};

export function setupRobotConsole(){
 let returnFocus:HTMLElement|null=null;
 const host=document.createElement('div');
 host.innerHTML=fs.readFileSync(fileURLToPath(new URL('partials/robot-console.html',document.baseURI)),'utf8');
 document.body.append(host);
const robotConsoleBackdrop = document.getElementById(
    "robotConsoleBackdrop",
) as HTMLElement | null;
const robotConsoleSelector = document.getElementById(
    "robotConsoleSelector",
) as HTMLElement | null;
const robotConsoleLoading = document.getElementById(
    "robotConsoleLoading",
) as HTMLElement | null;
const robotConsoleResult = document.getElementById(
    "robotConsoleResult",
) as HTMLElement | null;
const robotConsoleTitle = document.getElementById(
    "robotConsoleTitle",
) as HTMLElement | null;
const robotConsoleSubtitle = document.getElementById(
    "robotConsoleSubtitle",
) as HTMLElement | null;
const robotLoadingTitle = document.getElementById(
    "robotLoadingTitle",
) as HTMLElement | null;
const robotLoadingMessage = document.getElementById(
    "robotLoadingMessage",
) as HTMLElement | null;
const robotResultStatus = document.getElementById(
    "robotResultStatus",
) as HTMLElement | null;
const robotResultRobot = document.getElementById(
    "robotResultRobot",
) as HTMLElement | null;
const robotResultIp = document.getElementById(
    "robotResultIp",
) as HTMLElement | null;
const robotResultGrid = document.getElementById(
    "robotResultGrid",
) as HTMLElement | null;
const robotResultAlert = document.getElementById(
    "robotResultAlert",
) as HTMLElement | null;
const robotConsoleBack = document.getElementById(
    "robotConsoleBack",
) as HTMLButtonElement | null;
const robotConsoleDone = document.getElementById(
    "robotConsoleDone",
) as HTMLButtonElement | null;
type RobotConsoleResult = {
    ok: boolean;
    robotId: string;
    ip?: string;
    error?: string;
    program?: string;
    state?: string;
    counter?: string;
    cycleTime?: string;
    details?: string;
    reachable?: boolean;
    summary?: string;
    expectedMac?: string;
    detectedMac?: string | null;
    macConflict?: boolean;
};

let robotConsoleRequest = 0;
let robotConsoleReturnToSelector = false;

function setRobotConsoleView(view: "selector" | "loading" | "result") {
    if (robotConsoleSelector) robotConsoleSelector.hidden = view !== "selector";
    if (robotConsoleLoading) robotConsoleLoading.hidden = view !== "loading";
    if (robotConsoleResult) robotConsoleResult.hidden = view !== "result";
    if (robotConsoleBack)
        robotConsoleBack.hidden =
            view !== "result" || !robotConsoleReturnToSelector;
    if (robotConsoleDone)
        robotConsoleDone.textContent =
            view === "loading" ? "Annulla" : "Chiudi";
}

function openRobotConsoleSelector() {
    if(robotConsoleBackdrop?.getAttribute('aria-hidden')==='true')returnFocus=document.activeElement as HTMLElement;
    robotConsoleRequest += 1;
    robotConsoleReturnToSelector = true;
    if (robotConsoleTitle)
        robotConsoleTitle.textContent = "Verifica connessioni";
    if (robotConsoleSubtitle)
        robotConsoleSubtitle.textContent =
            "Seleziona la cella da raggiungere sulla rete di produzione.";
    setRobotConsoleView("selector");
    robotConsoleBackdrop?.setAttribute("aria-hidden", "false");
    document.querySelector<HTMLButtonElement>('[data-robot-ping]')?.focus();
}

function closeRobotConsole() {
    robotConsoleRequest += 1;
    robotConsoleBackdrop?.setAttribute("aria-hidden", "true");
    if(returnFocus?.isConnected)returnFocus.focus();
}

function addRobotResultCard(label: string, value: string) {
    if (!robotResultGrid || !value) return;
    const card = document.createElement("div");
    card.className = "robot-result-card";
    const caption = document.createElement("span");
    caption.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    card.append(caption, content);
    robotResultGrid.appendChild(card);
}

function renderRobotConsoleResult(
    result: RobotConsoleResult,
    mode: "status" | "ping",
) {
    if (robotResultGrid) robotResultGrid.innerHTML = "";
    if (robotResultRobot)
        robotResultRobot.textContent = result.robotId || "UNKNOWN";
    if (robotResultIp) robotResultIp.textContent = result.ip || "N/D";
    if (robotResultAlert) {
        robotResultAlert.hidden = true;
        robotResultAlert.textContent = "";
    }

    const statusLabel = robotResultStatus?.querySelector("span");
    robotResultStatus?.classList.remove("is-error", "is-warning");

    if (!result.ok) {
        robotResultStatus?.classList.add("is-error");
        if (statusLabel) statusLabel.textContent = "LINK ERROR";
        addRobotResultCard(
            "DIAGNOSTIC REPORT",
            result.error || "Connessione non disponibile.",
        );
    } else if (mode === "ping") {
        if (result.reachable) {
            if (statusLabel) statusLabel.textContent = "ONLINE";
        } else {
            robotResultStatus?.classList.add("is-error");
            if (statusLabel) statusLabel.textContent = "OFFLINE";
        }
        addRobotResultCard("PING SUMMARY", result.summary || "Nessun dato");
        addRobotResultCard("MAC ATTESO", result.expectedMac || "N/D");
        addRobotResultCard(
            "MAC RILEVATO",
            result.detectedMac || "Non rilevato",
        );
        if (result.macConflict && robotResultAlert) {
            robotResultStatus?.classList.remove("is-error");
            robotResultStatus?.classList.add("is-warning");
            if (statusLabel) statusLabel.textContent = "IP CONFLICT";
            robotResultAlert.hidden = false;
            robotResultAlert.textContent =
                "Attenzione: il MAC rilevato non corrisponde a quello configurato. Possibile conflitto di indirizzo IP.";
        }
    } else {
        if (statusLabel) statusLabel.textContent = "ONLINE";
        addRobotResultCard("PROGRAMMA ATTIVO", result.program || "Non trovato");
        addRobotResultCard("STATO MACCHINA", result.state || "Non trovato");
        if (result.counter) addRobotResultCard("CONTAPEZZI", result.counter);
        if (result.cycleTime)
            addRobotResultCard("TEMPO CICLO", `${result.cycleTime} secondi`);
        if (result.details) addRobotResultCard("DETTAGLI", result.details);
    }
    setRobotConsoleView("result");
}

async function runRobotConsoleRequest(
    mode: "status" | "ping",
    robotId: string,
    url?: string,
    stateKey?: string,
) {
    if(robotConsoleBackdrop?.getAttribute('aria-hidden')==='true')returnFocus=document.activeElement as HTMLElement;
    const requestId = ++robotConsoleRequest;
    if (robotConsoleTitle)
        robotConsoleTitle.textContent =
            mode === "ping" ? "Test connettività" : "Stato robot";
    if (robotConsoleSubtitle)
        robotConsoleSubtitle.textContent = `Nodo ${robotId} // diagnostica AyPi`;
    if (robotLoadingTitle)
        robotLoadingTitle.textContent =
            mode === "ping"
                ? `Ping ${robotId} in corso`
                : `Connessione a ${robotId}`;
    if (robotLoadingMessage)
        robotLoadingMessage.textContent =
            mode === "ping"
                ? "Analisi della raggiungibilità e verifica dell'indirizzo MAC..."
                : "Acquisizione programma, stato macchina e dati di produzione...";
    setRobotConsoleView("loading");
    robotConsoleBackdrop?.setAttribute("aria-hidden", "false");
    robotConsoleDone?.focus();

    const slowMessage = window.setTimeout(() => {
        if (requestId === robotConsoleRequest && robotLoadingMessage) {
            robotLoadingMessage.textContent =
                "Il nodo sta impiegando più tempo del previsto. Mantengo aperto il collegamento...";
        }
    }, 2200);

    try {
        const ipcRenderer = require("electron").ipcRenderer;
        const result = (await ipcRenderer.invoke(
            mode === "ping" ? "ping-robot-custom" : "robot-status-custom",
            ...(mode === "ping"
                ? [robotId]
                : [robotId, url || "", stateKey || ""]),
        )) as RobotConsoleResult;
        if (requestId !== robotConsoleRequest) return;
        renderRobotConsoleResult(result, mode);
    } catch {
        if (requestId !== robotConsoleRequest) return;
        renderRobotConsoleResult(
            {
                ok: false,
                robotId,
                error: "Il servizio diagnostico AyPi non è disponibile.",
            },
            mode,
        );
    } finally {
        window.clearTimeout(slowMessage);
    }
}

function openRobotStatus(action: ActionItem) {
    robotConsoleReturnToSelector = false;
    void runRobotConsoleRequest(
        "status",
        action.robotId || "",
        action.robotUrl,
        action.robotStateKey,
    );
}

document
    .querySelectorAll<HTMLElement>("[data-robot-ping]")
    .forEach((button) => {
        button.addEventListener("click", () => {
            robotConsoleReturnToSelector = true;
            void runRobotConsoleRequest("ping", button.dataset.robotPing || "");
        });
    });
document
    .getElementById("robotConsoleClose")
    ?.addEventListener("click", closeRobotConsole);
robotConsoleDone?.addEventListener("click", closeRobotConsole);
robotConsoleBack?.addEventListener("click", openRobotConsoleSelector);
robotConsoleBackdrop?.addEventListener("click", (event) => {
    if (event.target === robotConsoleBackdrop) closeRobotConsole();
});

document.addEventListener("keydown", (event) => {
    if (
        event.key === "Escape" &&
        robotConsoleBackdrop?.getAttribute("aria-hidden") === "false"
    ) {
        event.preventDefault();
        closeRobotConsole();
    }
});


 return {openStatus:openRobotStatus,openConnections:openRobotConsoleSelector,close:closeRobotConsole};
}
