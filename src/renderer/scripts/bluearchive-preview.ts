import { installAddinFunction } from "../modules/utils";

type ActionItem = {
    label: string;
    description: string;
};

type PageDefinition = {
    title: string;
    heading: string;
    description: string;
    code: string;
    actions?: ActionItem[];
    calculator?: boolean;
};

const pages: Record<string, PageDefinition> = {
    moduli: {
        title: "Moduli",
        heading: "Seleziona un modulo",
        description: "Accedi agli strumenti e ai moduli aziendali di AyPi.",
        code: "MDL",
        actions: [
            { label: "Valutazione Fornitori", description: "Gestione e valutazione partner" },
            { label: "DDT Fornitori", description: "Controllo documenti di trasporto" },
            { label: "Gestione Manutenzioni", description: "Manutenzioni macchine e impianti" },
            { label: "Strumenti di Misura", description: "Tarature e strumenti di controllo" },
            { label: "Gestione Stampi", description: "Schede e montaggio stampi" },
            { label: "Gestione Morsetti", description: "Gestione morsetti officina" },
            { label: "Utensili e Attrezzature", description: "Catalogo utensili aziendali" },
            { label: "Ticket Support", description: "Richieste di assistenza interna" },
        ],
    },
    programmi: {
        title: "Programmi",
        heading: "Seleziona un reparto",
        description: "Apri il programma di pianificazione del reparto desiderato.",
        code: "PRG",
        actions: [
            { label: "Ufficio Tecnico", description: "Programmazione ufficio tecnico" },
            { label: "Officina Meccanica", description: "Programmazione officina" },
            { label: "Stampaggio", description: "Piano reparto stampaggio" },
            { label: "Tranceria", description: "Piano reparto tranceria" },
            { label: "Torneria", description: "Piano reparto torneria" },
            { label: "Magazzino", description: "Piano attività magazzino" },
            { label: "Consegne", description: "Programma settimanale consegne" },
        ],
    },
    articoli: {
        title: "Articoli",
        heading: "Informazioni articoli",
        description: "Trova rapidamente disegni, cicli e schede di produzione.",
        code: "ART",
        actions: [
            { label: "Tavole e Disegni", description: "Disegni tecnici degli articoli" },
            { label: "Cicli di Lavorazione", description: "Documenti e cicli produttivi" },
            { label: "Schede Montaggio Stampi", description: "Istruzioni montaggio stampi" },
            { label: "Schede Difetti di Produzione", description: "Difetti e controlli qualità" },
            { label: "Schede Attrezzaggio", description: "Configurazioni di attrezzaggio" },
        ],
    },
    produzioni: {
        title: "Produzioni",
        heading: "Seleziona una produzione",
        description: "Consulta e aggiorna i registri dei reparti produttivi.",
        code: "PRD",
        actions: [
            { label: "Registrazione Stampaggio", description: "Registro produzione stampaggio" },
            { label: "Registrazione Tranceria", description: "Registro produzione tranceria" },
            { label: "Registrazione Torneria", description: "Registro produzione torneria" },
        ],
    },
    robot: {
        title: "Robot",
        heading: "Stato e connessioni robot",
        description: "Visualizza rapidamente stato e informazioni delle celle robotizzate.",
        code: "RBT",
        actions: [
            { label: "Stato Robot 21D500", description: "Diagnostica cella 21D500" },
            { label: "Stato Robot 21D600", description: "Diagnostica cella 21D600" },
            { label: "Stato Robot 21D850", description: "Diagnostica cella 21D850" },
            { label: "Verifica Connessioni", description: "Controllo raggiungibilità robot" },
        ],
    },
    calcolatore: {
        title: "Calcolatore",
        heading: "Calcolatore parametri",
        description: "Calcola numero di giri e avanzamento per le lavorazioni.",
        code: "CAL",
        calculator: true,
    },
    utilities: {
        title: "Utilities",
        heading: "Strumenti AyPi",
        description: "Una raccolta di strumenti rapidi per il lavoro quotidiano.",
        code: "UTL",
        actions: [
            { label: "Elenca File", description: "Trascrizione nomi dei file" },
            { label: "Batch Rinomina", description: "Rinomina multipla controllata" },
            { label: "Generatore QR", description: "Crea codici QR personalizzati" },
            { label: "Confronta Cartelle", description: "Confronto contenuti directory" },
            { label: "Gerarchia", description: "Generatore gerarchia aziendale" },
            { label: "Gantt Tasks", description: "Pianificazione attività" },
            { label: "Calendario Dipendenti", description: "Ferie, permessi e presenze" },
            { label: "Gestione Acquisti", description: "Richieste e catalogo acquisti" },
        ],
    },
};

const pageOrder = Object.keys(pages);
const aura = document.getElementById("cursorAura") as HTMLElement | null;
const clickLayer = document.getElementById("clickLayer") as HTMLElement | null;
const assistant = document.getElementById("assistant") as HTMLElement | null;
const assistantPlayer = document.getElementById("spineAssistantPlayer") as HTMLElement | null;
const assistantSwitch = document.getElementById("assistantSwitch") as HTMLButtonElement | null;
const assistantLabel = document.getElementById("assistantLabel") as HTMLElement | null;
const bubble = document.getElementById("speechBubble") as HTMLElement | null;
const menu = document.getElementById("quickMenu") as HTMLElement | null;
const menuToggle = document.getElementById("menuToggle") as HTMLButtonElement | null;
const pageContent = document.getElementById("pageContent") as HTMLElement | null;
const heroTitle = document.getElementById("heroTitle") as HTMLElement | null;
const heroDescription = document.getElementById("heroDescription") as HTMLElement | null;
const sectionTitle = document.getElementById("sectionTitle") as HTMLElement | null;
const heroNumber = document.getElementById("heroNumber") as HTMLElement | null;
const pageNumber = document.getElementById("pageNumber") as HTMLElement | null;
const footerClock = document.getElementById("footerClock") as HTMLButtonElement | null;
const startupSequence = document.getElementById("startupSequence") as HTMLElement | null;
const timerBackdrop = document.getElementById("timerBackdrop") as HTMLElement | null;
const timerClose = document.getElementById("timerClose") as HTMLButtonElement | null;
const stopwatchView = document.getElementById("stopwatchView") as HTMLElement | null;
const stopwatchDisplay = document.getElementById("stopwatchDisplay") as HTMLElement | null;
const stopwatchStatus = document.getElementById("stopwatchStatus") as HTMLElement | null;
const stopwatchToggle = document.getElementById("stopwatchToggle") as HTMLButtonElement | null;
const lapsList = document.getElementById("lapsList") as HTMLElement | null;
const countdownView = document.getElementById("countdownView") as HTMLElement | null;
const countdownDisplay = document.getElementById("countdownDisplay") as HTMLElement | null;
const countdownStatus = document.getElementById("countdownStatus") as HTMLElement | null;
const countdownToggle = document.getElementById("countdownToggle") as HTMLButtonElement | null;
const timerPanelClock = document.getElementById("timerPanelClock") as HTMLElement | null;
const phrases = [
    "Bentornato, Sensei!",
    "I moduli sono tutti al loro posto.",
    "Questa è solo la prima iterazione!",
    "Il modello Spine arriverà nel prossimo passo.",
    "Il tema standard non verrà modificato.",
];

let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
let stopwatchElapsedMs = 0;
let stopwatchStartedAt = 0;
let stopwatchRunning = false;
let lapCount = 0;
let countdownInitialMs = 5 * 60 * 1000;
let countdownRemainingMs = countdownInitialMs;
let countdownStartedAt = 0;
let countdownRunning = false;
let countdownFinishedNotified = false;
let currentAssistant: "arona" | "plana" = window.localStorage.getItem("aypi-bluearchive-assistant-v1") === "plana" ? "plana" : "arona";
let spinePlayerInstance: any = null;
let spineAnimationState: any = null;
let spineBones: null | {
    skeleton: any;
    rightEye: any;
    leftEye: any;
    frontHead: any;
    backHead: any;
    rightEyeX: number;
    rightEyeY: number;
    leftEyeX: number;
    leftEyeY: number;
    frontHeadX: number;
    frontHeadY: number;
    backHeadX: number;
    backHeadY: number;
} = null;
let assistantBlinkTimer: ReturnType<typeof setTimeout> | null = null;
let assistantSpeaking = false;

const assistantConfigs = {
    arona: {
        skel: "../assets/bluearchive/spine/arona/arona_spr.skel",
        atlas: "../assets/bluearchive/spine/arona/arona_spr.atlas",
        idle: "Idle_01",
        blink: "Eye_Close_01",
        rightEye: "R_Eye_01",
        leftEye: "L_Eye_01",
        frontHead: "Head_01",
        backHead: "Head_Back",
        eyeAngle: 76.307,
        reactions: [
            { animation: "12", text: "Tutto pronto, Sensei. Da quale reparto iniziamo?" },
            { animation: "03", text: "I moduli AyPi sono disponibili e pronti all'uso." },
            { animation: "02", text: "Cerchi un articolo? Disegni, cicli e schede sono nella sezione Articoli." },
            { animation: "18", text: "Ricordati: timer e cronometri si aprono cliccando sull'orologio." },
            { animation: "25", text: "Programmi di reparto caricati. Possiamo iniziare!" },
            { animation: "11", text: "Le Utilities AyPi sono pronte per il lavoro di oggi." },
        ],
    },
    plana: {
        skel: "../assets/bluearchive/spine/plana/plana_spr.skel",
        atlas: "../assets/bluearchive/spine/plana/plana_spr.atlas",
        idle: "Idle_01",
        blink: "Eye_Close_01",
        rightEye: "R_Eye_01",
        leftEye: "L_Eye_01",
        frontHead: "Head_Rot",
        backHead: "Head_Back",
        eyeAngle: 97.331,
        reactions: [
            { animation: "06", text: "Connessione ai sistemi AyPi confermata." },
            { animation: "13", text: "Seleziona un modulo per continuare, Sensei." },
            { animation: "15", text: "Nessuna anomalia rilevata nell'interfaccia." },
            { animation: "99", text: "Produzioni, robot e programmi di reparto sono disponibili." },
            { animation: "17", text: "Calcolatore parametri pronto all'uso." },
        ],
    },
};

function showBubble(text: string, duration = 2600) {
    if (!bubble) return;
    bubble.textContent = text;
    bubble.classList.add("visible");
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove("visible"), duration);
}

function resolvePreviewAsset(relativePath: string) {
    return new URL(relativePath, window.location.href).href;
}

function resetAssistantBones() {
    if (!spineBones) return;
    if (spineBones.rightEye) {
        spineBones.rightEye.x = spineBones.rightEyeX;
        spineBones.rightEye.y = spineBones.rightEyeY;
    }
    if (spineBones.leftEye) {
        spineBones.leftEye.x = spineBones.leftEyeX;
        spineBones.leftEye.y = spineBones.leftEyeY;
    }
    if (spineBones.frontHead) {
        spineBones.frontHead.x = spineBones.frontHeadX;
        spineBones.frontHead.y = spineBones.frontHeadY;
    }
    if (spineBones.backHead) {
        spineBones.backHead.x = spineBones.backHeadX;
        spineBones.backHead.y = spineBones.backHeadY;
    }
    spineBones.skeleton.updateWorldTransform();
}

function scheduleAssistantBlink() {
    if (assistantBlinkTimer) clearTimeout(assistantBlinkTimer);
    assistantBlinkTimer = setTimeout(() => {
        if (!assistantSpeaking && spineAnimationState) {
            const config = assistantConfigs[currentAssistant];
            spineAnimationState.setAnimation(1, config.blink, false);
            if (Math.random() > 0.62) {
                spineAnimationState.addAnimation(1, config.blink, false, 0.12);
            }
        }
        scheduleAssistantBlink();
    }, 3000 + Math.random() * 3000);
}

function updateAssistantGaze(event: MouseEvent) {
    if (!spineBones || assistantSpeaking || !assistantPlayer) return;
    const config = assistantConfigs[currentAssistant];
    const rect = assistantPlayer.getBoundingClientRect();
    const mouseX = event.clientX - (rect.left + rect.width / 2);
    const mouseY = event.clientY - (rect.top + rect.height * .28);
    const rotation = -config.eyeAngle * Math.PI / 180;
    const rotatedX = mouseX * Math.cos(rotation) - mouseY * Math.sin(rotation);
    const rotatedY = mouseX * Math.sin(rotation) + mouseY * Math.cos(rotation);
    const angle = Math.atan2(rotatedY, rotatedX);
    const eyeDistance = Math.min(Math.hypot(rotatedX, rotatedY) / 8, 15);
    const eyeDx = -eyeDistance * Math.cos(angle);
    const eyeDy = eyeDistance * Math.sin(angle);
    const headDx = Math.min(2, eyeDistance / 7.5) * Math.cos(angle);
    const headDy = Math.min(2, eyeDistance / 7.5) * Math.sin(angle);

    if (spineBones.rightEye) {
        spineBones.rightEye.x = spineBones.rightEyeX + eyeDx;
        spineBones.rightEye.y = spineBones.rightEyeY + eyeDy;
    }
    if (spineBones.leftEye) {
        spineBones.leftEye.x = spineBones.leftEyeX + eyeDx;
        spineBones.leftEye.y = spineBones.leftEyeY + eyeDy;
    }
    if (spineBones.frontHead) {
        spineBones.frontHead.x = spineBones.frontHeadX - headDx;
        spineBones.frontHead.y = spineBones.frontHeadY + headDy;
    }
    if (spineBones.backHead) {
        spineBones.backHead.x = spineBones.backHeadX + headDx * .5;
        spineBones.backHead.y = spineBones.backHeadY - headDy * .5;
    }
    spineBones.skeleton.updateWorldTransform();
}

function initializeAssistant(character: "arona" | "plana") {
    if (!assistantPlayer || !assistant) return;
    currentAssistant = character;
    window.localStorage.setItem("aypi-bluearchive-assistant-v1", character);
    const config = assistantConfigs[character];
    assistant.classList.remove("ready", "failed");
    assistant.setAttribute("aria-label", `Assistente ${character === "arona" ? "Arona" : "Plana"}`);
    assistantPlayer.setAttribute("aria-label", `Parla con ${character === "arona" ? "Arona" : "Plana"}`);
    if (assistantLabel) assistantLabel.textContent = `${character.toUpperCase()} // LOADING`;
    if (assistantBlinkTimer) clearTimeout(assistantBlinkTimer);
    assistantSpeaking = false;
    spineBones = null;
    spineAnimationState = null;
    try {
        spinePlayerInstance?.stopRendering?.();
    } catch {
        // Il runtime può essere ancora in fase di caricamento.
    }
    assistantPlayer.innerHTML = "";

    const spineRuntime = (window as any).spine;
    if (!spineRuntime?.SpinePlayer) {
        assistant.classList.add("failed");
        if (assistantLabel) assistantLabel.textContent = `${character.toUpperCase()} // OFFLINE`;
        showBubble("Runtime Spine non disponibile.");
        return;
    }

    spinePlayerInstance = new spineRuntime.SpinePlayer(assistantPlayer, {
        skelUrl: resolvePreviewAsset(config.skel),
        atlasUrl: resolvePreviewAsset(config.atlas),
        premultipliedAlpha: true,
        backgroundColor: "#00000000",
        alpha: true,
        showControls: false,
        success: (player: any) => {
            player.setAnimation(config.idle, true);
            spineAnimationState = player.animationState;
            const skeleton = player.skeleton;
            const rightEye = skeleton.findBone(config.rightEye);
            const leftEye = skeleton.findBone(config.leftEye);
            const frontHead = skeleton.findBone(config.frontHead);
            const backHead = skeleton.findBone(config.backHead);
            spineBones = {
                skeleton,
                rightEye,
                leftEye,
                frontHead,
                backHead,
                rightEyeX: rightEye?.data.x || 0,
                rightEyeY: rightEye?.data.y || 0,
                leftEyeX: leftEye?.data.x || 0,
                leftEyeY: leftEye?.data.y || 0,
                frontHeadX: frontHead?.data.x || 0,
                frontHeadY: frontHead?.data.y || 0,
                backHeadX: backHead?.data.x || 0,
                backHeadY: backHead?.data.y || 0,
            };
            assistant.classList.add("ready");
            if (assistantLabel) assistantLabel.textContent = `${character.toUpperCase()} // ONLINE`;
            scheduleAssistantBlink();
        },
        error: (_player: any, reason: unknown) => {
            console.error("Caricamento assistente Spine fallito:", reason);
            assistant.classList.add("failed");
            if (assistantLabel) assistantLabel.textContent = `${character.toUpperCase()} // OFFLINE`;
            showBubble("Non riesco a caricare il modello Spine.");
        },
    });
}

function playAssistantReaction() {
    if (assistantSpeaking || !spineAnimationState) return;
    const config = assistantConfigs[currentAssistant];
    const reaction = config.reactions[Math.floor(Math.random() * config.reactions.length)];
    assistantSpeaking = true;
    resetAssistantBones();
    showBubble(reaction.text, 3600);
    spineAnimationState.setAnimation(2, reaction.animation, false);

    const finish = () => {
        assistantSpeaking = false;
        spineAnimationState?.setEmptyAnimation(2, .15);
        bubble?.classList.remove("visible");
    };
    setTimeout(finish, 3600);
}

function burst(x: number, y: number) {
    if (!clickLayer) return;
    const colors = ["#26bff3", "#1689ed", "#79dcf5", "#17243d"];
    for (let index = 0; index < 10; index += 1) {
        const particle = document.createElement("i");
        particle.className = "click-particle";
        const angle = (Math.PI * 2 * index) / 10 + Math.random() * 0.25;
        const distance = 24 + Math.random() * 36;
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        particle.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
        particle.style.setProperty("--y", `${Math.sin(angle) * distance}px`);
        particle.style.setProperty("--particle-color", colors[index % colors.length]);
        clickLayer.appendChild(particle);
        particle.addEventListener("animationend", () => particle.remove(), { once: true });
    }
}

function bindCardInteractions() {
    document.querySelectorAll<HTMLElement>(".module-card").forEach((card) => {
        card.addEventListener("mousemove", (event) => {
            const rect = card.getBoundingClientRect();
            const rotateY = ((event.clientX - rect.left) / rect.width - 0.5) * 5;
            const rotateX = ((event.clientY - rect.top) / rect.height - 0.5) * -5;
            card.style.transform = `translateY(-4px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
        });
        card.addEventListener("mouseleave", () => {
            card.style.transform = "";
        });
        card.addEventListener("click", () => {
            showBubble(`${card.dataset.label}: collegamento disabilitato nella preview.`);
        });
    });
}

function renderActions(page: PageDefinition) {
    if (!pageContent) return;
    const tones = ["cyan", "blue", "white", "navy"];
    const icons = ["icon-doc", "icon-grid", "icon-search", "icon-chart"];
    pageContent.className = "module-grid";
    pageContent.innerHTML = (page.actions || []).map((action, index) => `
        <button class="module-card ${tones[index % tones.length]}" data-label="${action.label}">
            <span class="card-code">${page.code}-${String(index + 1).padStart(2, "0")}</span>
            <span class="card-icon ${icons[index % icons.length]}"><i></i></span>
            <span class="card-title">${action.label}</span>
            <span class="card-description">${action.description}</span>
            <span class="card-arrow">↗</span>
        </button>
    `).join("");
    bindCardInteractions();
}

function renderCalculator() {
    if (!pageContent) return;
    pageContent.className = "module-grid calculator-grid";
    pageContent.innerHTML = `
        <form class="calculator-panel" id="calculatorForm">
            <div class="calculator-fields">
                <div class="calculator-field">
                    <label for="diametro">Diametro utensile D (mm)</label>
                    <input type="number" id="diametro" step="0.01" min="0" placeholder="es. 12">
                </div>
                <div class="calculator-field">
                    <label for="taglienti">Numero taglienti z</label>
                    <input type="number" id="taglienti" step="1" min="1" placeholder="es. 4">
                </div>
                <div class="calculator-field">
                    <label for="vc">Velocità taglio Vc (m/min)</label>
                    <input type="number" id="vc" step="0.01" min="0" placeholder="es. 180">
                </div>
                <div class="calculator-field">
                    <label for="avanzamento">Avanzamento dente f (mm/g)</label>
                    <input type="number" id="avanzamento" step="0.001" min="0" placeholder="es. 0.08">
                </div>
                <div class="calculator-field">
                    <label for="riduzione">Riduzione % (opzionale)</label>
                    <input type="number" id="riduzione" step="0.1" min="0" max="100" placeholder="0">
                </div>
                <button class="calculator-action" type="submit">Calcola parametri</button>
            </div>
            <div class="calculator-result" aria-live="polite">
                <span class="result-label">RISULTATO CALCOLO</span>
                <div class="result-values" id="calculatorResult">Inserisci i parametri richiesti.</div>
            </div>
        </form>
    `;

    document.getElementById("calculatorForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const value = (id: string) => Number((document.getElementById(id) as HTMLInputElement | null)?.value);
        const diameter = value("diametro");
        const teeth = value("taglienti");
        const cuttingSpeed = value("vc");
        const feedPerTooth = value("avanzamento");
        const reduction = value("riduzione") || 0;
        const result = document.getElementById("calculatorResult");
        if (!result) return;

        if (diameter <= 0 || teeth <= 0 || cuttingSpeed <= 0 || feedPerTooth <= 0) {
            result.textContent = "Inserisci tutti i valori con numeri maggiori di zero.";
            return;
        }

        const factor = reduction > 0 ? (100 - Math.min(reduction, 100)) / 100 : 1;
        const rpm = ((1000 * cuttingSpeed) / (Math.PI * diameter)) * factor;
        const feed = feedPerTooth * teeth * rpm;
        result.innerHTML = `Numero di giri: <b>${rpm.toFixed(0)} rpm</b><br>Avanzamento: <b>${feed.toFixed(1)} mm/min</b>`;
        showBubble("Calcolo completato!");
    });
}

function renderPage(pageKey: string) {
    const page = pages[pageKey];
    if (!page) return;
    heroTitle!.textContent = `${page.title}.`;
    heroDescription!.textContent = page.description;
    sectionTitle!.textContent = page.heading;
    heroNumber!.textContent = page.title.charAt(0).toUpperCase();
    pageNumber!.textContent = String(pageOrder.indexOf(pageKey) + 1).padStart(2, "0");

    document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.page === pageKey);
    });

    if (page.calculator) renderCalculator();
    else renderActions(page);

    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
}

function updateClock() {
    const formattedTime = new Intl.DateTimeFormat("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(new Date());
    if (footerClock) footerClock.textContent = formattedTime;
    if (timerPanelClock) timerPanelClock.textContent = formattedTime;
}

function finishStartup() {
    if (!startupSequence || startupSequence.classList.contains("is-leaving")) return;
    startupSequence.classList.add("is-leaving");
    setTimeout(() => startupSequence.remove(), 480);
}

function formatStopwatch(milliseconds: number) {
    const safeMs = Math.max(0, milliseconds);
    const totalTenths = Math.floor(safeMs / 100);
    const tenths = totalTenths % 10;
    const totalSeconds = Math.floor(totalTenths / 10);
    const seconds = totalSeconds % 60;
    const minutes = Math.floor(totalSeconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function formatCountdown(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function currentStopwatchMs() {
    return stopwatchElapsedMs + (stopwatchRunning ? Date.now() - stopwatchStartedAt : 0);
}

function currentCountdownMs() {
    return Math.max(0, countdownRemainingMs - (countdownRunning ? Date.now() - countdownStartedAt : 0));
}

function updateTimeTools() {
    const stopwatchValue = currentStopwatchMs();
    if (stopwatchDisplay) stopwatchDisplay.textContent = formatStopwatch(stopwatchValue);
    if (stopwatchToggle) stopwatchToggle.textContent = stopwatchRunning ? "Pausa" : "Avvia";
    if (stopwatchStatus) stopwatchStatus.textContent = stopwatchRunning ? "IN ESECUZIONE" : stopwatchValue > 0 ? "IN PAUSA" : "PRONTO";
    stopwatchView?.classList.toggle("running", stopwatchRunning);

    const countdownValue = currentCountdownMs();
    if (countdownDisplay) countdownDisplay.textContent = formatCountdown(countdownValue);
    if (countdownToggle) countdownToggle.textContent = countdownRunning ? "Pausa" : countdownValue <= 0 ? "Riavvia" : "Avvia";
    if (countdownStatus) countdownStatus.textContent = countdownRunning ? "IN ESECUZIONE" : countdownValue <= 0 ? "COMPLETATO" : countdownValue < countdownInitialMs ? "IN PAUSA" : "PRONTO";
    countdownView?.classList.toggle("running", countdownRunning);
    countdownView?.classList.toggle("finished", countdownValue <= 0);

    if (countdownRunning && countdownValue <= 0) {
        countdownRunning = false;
        countdownRemainingMs = 0;
        if (!countdownFinishedNotified) {
            countdownFinishedNotified = true;
            showBubble("Timer completato, Sensei!", 4000);
        }
    }
}

function openTimerPanel() {
    if (!timerBackdrop) return;
    timerBackdrop.setAttribute("aria-hidden", "false");
    footerClock?.setAttribute("aria-expanded", "true");
    setTimeout(() => timerClose?.focus(), 40);
}

function closeTimerPanel() {
    timerBackdrop?.setAttribute("aria-hidden", "true");
    footerClock?.setAttribute("aria-expanded", "false");
    footerClock?.focus();
}

document.addEventListener("mousemove", (event) => {
    if (aura) {
        aura.classList.add("active");
        aura.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    }

    updateAssistantGaze(event);
});

document.addEventListener("mousedown", (event) => {
    aura?.classList.add("pressed");
    burst(event.clientX, event.clientY);
});
document.addEventListener("mouseup", () => aura?.classList.remove("pressed"));
document.addEventListener("mouseleave", () => aura?.classList.remove("active"));

document.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((item) => {
    item.addEventListener("click", () => renderPage(item.dataset.page || "moduli"));
});

menuToggle?.addEventListener("click", () => {
    const isOpen = menu?.classList.toggle("open") ?? false;
    menu?.setAttribute("aria-hidden", String(!isOpen));
});

document.getElementById("brandLink")?.addEventListener("click", (event) => {
    event.preventDefault();
    const url = "https://github.com/AGPress-Tech/AyPi";
    try {
        require("electron").shell.openExternal(url);
    } catch {
        window.open(url, "_blank", "noopener");
    }
});

footerClock?.addEventListener("click", () => {
    openTimerPanel();
});

document.getElementById("menuExcel")?.addEventListener("click", async () => {
    menu?.classList.remove("open");
    menu?.setAttribute("aria-hidden", "true");
    await installAddinFunction();
});

document.getElementById("menuWebsite")?.addEventListener("click", () => {
    menu?.classList.remove("open");
    menu?.setAttribute("aria-hidden", "true");
    const url = "https://data.agpress-srl.it/";
    try {
        require("electron").shell.openExternal(url);
    } catch {
        window.open(url, "_blank", "noopener");
    }
});

document.getElementById("menuQuit")?.addEventListener("click", () => {
    require("electron").ipcRenderer.send("quit-app");
});
timerClose?.addEventListener("click", closeTimerPanel);
timerBackdrop?.addEventListener("click", (event) => {
    if (event.target === timerBackdrop) closeTimerPanel();
});

document.querySelectorAll<HTMLButtonElement>(".timer-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        const viewName = tab.dataset.timeView;
        document.querySelectorAll(".timer-tab").forEach((node) => node.classList.toggle("active", node === tab));
        document.querySelectorAll<HTMLElement>(".time-view").forEach((view) => view.classList.toggle("active", view.dataset.view === viewName));
    });
});

stopwatchToggle?.addEventListener("click", () => {
    if (stopwatchRunning) {
        stopwatchElapsedMs += Date.now() - stopwatchStartedAt;
        stopwatchRunning = false;
    } else {
        stopwatchStartedAt = Date.now();
        stopwatchRunning = true;
    }
    updateTimeTools();
});

document.getElementById("stopwatchReset")?.addEventListener("click", () => {
    stopwatchRunning = false;
    stopwatchElapsedMs = 0;
    lapCount = 0;
    if (lapsList) lapsList.innerHTML = '<span class="laps-empty">Nessun giro registrato</span>';
    updateTimeTools();
});

document.getElementById("stopwatchLap")?.addEventListener("click", () => {
    const elapsed = currentStopwatchMs();
    if (elapsed <= 0 || !lapsList) return;
    lapCount += 1;
    lapsList.querySelector(".laps-empty")?.remove();
    const row = document.createElement("div");
    row.className = "lap-row";
    row.innerHTML = `<span>GIRO ${String(lapCount).padStart(2, "0")}</span><b>${formatStopwatch(elapsed)}</b>`;
    lapsList.prepend(row);
});

countdownToggle?.addEventListener("click", () => {
    const current = currentCountdownMs();
    if (countdownRunning) {
        countdownRemainingMs = current;
        countdownRunning = false;
    } else {
        if (current <= 0) countdownRemainingMs = countdownInitialMs;
        countdownStartedAt = Date.now();
        countdownRunning = true;
        countdownFinishedNotified = false;
    }
    updateTimeTools();
});

document.getElementById("countdownReset")?.addEventListener("click", () => {
    countdownRunning = false;
    countdownRemainingMs = countdownInitialMs;
    countdownFinishedNotified = false;
    updateTimeTools();
});

document.querySelectorAll<HTMLButtonElement>("[data-timer-minutes]").forEach((preset) => {
    preset.addEventListener("click", () => {
        const minutes = Number(preset.dataset.timerMinutes) || 5;
        countdownInitialMs = minutes * 60 * 1000;
        countdownRemainingMs = countdownInitialMs;
        countdownRunning = false;
        countdownFinishedNotified = false;
        document.querySelectorAll("[data-timer-minutes]").forEach((node) => node.classList.toggle("active", node === preset));
        updateTimeTools();
    });
});

assistantPlayer?.addEventListener("click", playAssistantReaction);
assistantPlayer?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        playAssistantReaction();
    }
});

assistantSwitch?.addEventListener("click", (event) => {
    event.stopPropagation();
    initializeAssistant(currentAssistant === "arona" ? "plana" : "arona");
});

startupSequence?.addEventListener("click", finishStartup);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && timerBackdrop?.getAttribute("aria-hidden") === "false") {
        closeTimerPanel();
    }
});

window.addEventListener("DOMContentLoaded", () => {
    renderPage("moduli");
    initializeAssistant(currentAssistant);
    updateClock();
    setInterval(updateClock, 1000);
    updateTimeTools();
    setInterval(updateTimeTools, 100);
    document.body.animate(
        [{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }],
        { duration: 500, easing: "ease-out" },
    );
    setTimeout(finishStartup, 1800);
    setTimeout(() => showBubble(phrases[0], 3200), 2200);
});

export {};
