// @ts-nocheck
require("./shared/dev-guards");
const { ipcRenderer, webUtils, shell } = require("electron");
const { resolveBackendRootUrl } = require("./shared/backend-client");
const { createAsyncGuard } = require("./shared/async-guard");
const { withAttachmentSaveUi } = require("./shared/attachment-save-ui");
const { showInfo, showError, showWarning, confirmDialog } = require("./shared/dialogs");

type RegistrationType = "stampi" | "speciali";
const registrationTypes: Record<RegistrationType, { title: string; description: string }> = {
    stampi: {
        title: "Registrazioni Progettazione - Costruzione Stampi",
        description: "Gestione delle registrazioni dedicate alla progettazione e alla costruzione stampi.",
    },
    speciali: {
        title: "Registrazioni Progetti Speciali",
        description: "Elenco delle registrazioni dedicate ai progetti speciali.",
    },
};
const fieldIds = [
    "progettoNumero", "descrizioneProgetto", "tipologia", "codiceArticolo",
    "dimensioneStampo", "materialePrevisto", "pesoStampato",
    "consegnaRichiestaCliente", "sviluppoDaUltimareEntro",
    "dataTermineEffettiva", "dfmeaPfmeaNote", "rischioAlto", "rischioMedio",
    "rischioBasso", "note", "data", "emessoDa",
];
const radioNames = [
    "nuovoProgetto", "origineProgetto", "personalizzazioneCliente",
    "revisioneVecchioProgetto", "requisitiUniEn12420", "requisitiBrevetto",
];
const workflowPhases = [
    {
        key: "riesame1",
        number: "08",
        title: "1° Riesame del progetto",
        description: "Valutazione dei primi modelli o disegni realizzati.",
        participants: true,
        internalChecks: ["Riesame e verifica preliminare interna degli elaborati 2D e 3D"],
        clientChecks: ["Riesame del cliente rispetto ai requisiti di base e alla UNI EN 12420:2000 §6.10"],
    },
    {
        key: "verifica1",
        number: "09",
        title: "1ª Verifica del progetto",
        description: "Controllo tecnico-dimensionale del fascicolo tecnico di lay-out.",
        procurement: true,
        internalChecks: [
            "Riesame e verifica preliminare interna degli elaborati 2D e 3D",
            "Verifica tecnica della completezza del fascicolo di lay-out stampo",
        ],
        clientChecks: ["Verifica tecnica della completezza del fascicolo di lay-out stampo"],
    },
    {
        key: "verifica2",
        number: "10",
        title: "2ª Verifica del progetto",
        description: "Controllo tecnico-dimensionale dei percorsi utensile e degli zolfi.",
        internalChecks: [
            "Creazione dei percorsi utensile CAM e trasferimento al centro di lavoro",
            "Costruzione degli accessori, punzoni e slitte",
            "Controllo della geometria/forma tramite esecuzione degli zolfi",
        ],
        clientChecks: [
            "Creazione dei percorsi utensile CAM e trasferimento al centro di lavoro",
            "Costruzione degli accessori, punzoni e slitte",
            "Controllo della geometria/forma tramite esecuzione degli zolfi",
        ],
    },
    {
        key: "verifica3",
        number: "11",
        title: "3ª Verifica del progetto (eventuale)",
        description: "Controllo dei percorsi utensile e degli zolfi per il controllo tempra.",
        internalChecks: [
            "Trattamento termico di tempra secondo procedura interna",
            "Controllo della geometria/forma tramite esecuzione degli zolfi",
        ],
        clientChecks: [
            "Trattamento termico di tempra secondo procedura interna",
            "Controllo della geometria/forma tramite esecuzione degli zolfi",
        ],
    },
    {
        key: "riesame2",
        number: "12",
        title: "2° Riesame del progetto",
        description: "Valutazione dei risultati a fronte della prova di stampaggio.",
        participants: true,
        internalChecks: [
            "Verifica della corretta lucidatura",
            "Verifica dello scorrimento dei punzoni e delle slitte",
            "Prova di stampaggio con avvio manuale",
            "Verifica dimensionale delle lavorazioni secondo disegno tecnico",
        ],
        clientChecks: [
            "Verifica della corretta lucidatura",
            "Verifica dello scorrimento dei punzoni e delle slitte",
            "Prova di stampaggio con avvio manuale",
            "Riesame del cliente rispetto ai requisiti di base e alla UNI EN 12420:2000 §6.10",
        ],
    },
    {
        key: "validation",
        number: "13",
        title: "Validazione del progetto",
        description: "Check di controllo finale prima dell'avvio dello stampaggio a caldo.",
        validation: true,
        internalChecks: [
            "I disegni tecnici sono tutti disponibili, archiviati ed approvati?",
            "Il progetto è stato eseguito nei tempi previsti?",
            "Sono previste specifiche o istruzioni di lavoro per la produzione e/o il controllo dell'articolo?",
            "Conformità delle lavorazioni da macchina utensile (solo per lavorazioni eseguite internamente)",
        ],
        clientChecks: [
            "I disegni tecnici sono tutti disponibili, archiviati ed approvati?",
            "Il progetto è stato eseguito nei tempi previsti?",
            "Sono previste specifiche o istruzioni di lavoro per la produzione e/o il controllo dell'articolo?",
            "Conformità delle lavorazioni da macchina utensile (solo per lavorazioni eseguite internamente)",
        ],
    },
];

const homeView = document.getElementById("homeView");
const listView = document.getElementById("listView");
const createView = document.getElementById("createView");
const stampiForm = document.getElementById("stampiForm");
const specialiForm = document.getElementById("specialiForm");
const listTitle = document.getElementById("listTitle");
const listDescription = document.getElementById("listDescription");
const createTitle = document.getElementById("createTitle");
const listCount = document.getElementById("listCount");
const registrationsList = document.getElementById("registrationsList");
const emptyList = document.getElementById("emptyList");
const attachmentInput = document.getElementById("attachmentInput") as HTMLInputElement;
const attachmentsList = document.getElementById("attachmentsList");
const blockStatus = document.getElementById("blockStatus");
const blockStatusText = document.getElementById("blockStatusText");
const saveFormBtn = document.getElementById("saveFormBtn");
const newFormBtn = document.getElementById("newFormBtn");
const successivePhases = document.getElementById("successivePhases");
const filterProjectNumber = document.getElementById("filterProjectNumber") as HTMLInputElement;
const filterSecondary = document.getElementById("filterSecondary") as HTMLInputElement;
const filterSecondaryLabel = document.getElementById("filterSecondaryLabel");
const filterClassificationLabel = document.getElementById("filterClassificationLabel");
const filterClassification = document.getElementById("filterClassification") as HTMLSelectElement;
const filterStatus = document.getElementById("filterStatus") as HTMLSelectElement;
const filterGeneral = document.getElementById("filterGeneral") as HTMLInputElement;
const listSort = document.getElementById("listSort") as HTMLSelectElement;

let activeType: RegistrationType = "stampi";
let listItems: any[] = [];
let currentCode = "";
let currentAttachments: any[] = [];
let pendingAttachments: any[] = [];
let currentLinkedPaths: any[] = [];
let savedSnapshot = "";
let successiveData: Record<string, Record<string, any>> = { interno: {}, cliente: {} };
let renderedOrigin = "";

function specialProjectsForm() {
    return (globalThis as any).specialProjectsForm;
}

function attachmentUrl(storedName: string) {
    const modulePath = activeType === "stampi"
        ? "registrazioni-progettazione-stampi"
        : "registrazioni-progetti-speciali";
    return `${resolveBackendRootUrl()}/api/${modulePath}/attachments/${encodeURIComponent(storedName)}`;
}

async function openStoredAttachment(item: any) {
    if (item.pending && item.dataFilePath) {
        const error = await shell.openPath(item.dataFilePath);
        if (error) await showError("Impossibile aprire l'allegato.", error);
        return;
    }
    if (!item.storedName) return;
    await shell.openExternal(attachmentUrl(item.storedName));
}

async function openLinkedPath(item: any) {
    const result = await ipcRenderer.invoke("registrazioni-progettazione-open-linked-path", { path: item.path });
    if (!result?.ok) await showError("Impossibile aprire il percorso collegato.", result?.error || "");
}

async function selectLinkedPaths(workflowKey = "") {
    const result = await ipcRenderer.invoke("registrazioni-progettazione-select-linked-paths");
    if (!result?.ok) {
        await showError("Impossibile selezionare il percorso.", result?.error || "");
        return;
    }
    const now = new Date().toISOString();
    for (const selectedPath of result.paths || []) {
        const normalized = String(selectedPath || "").trim();
        if (!normalized || currentLinkedPaths.some((item) => item.path === normalized && item.workflowKey === workflowKey)) continue;
        currentLinkedPaths.push({
            id: `path-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            name: normalized.split(/[\\/]/).filter(Boolean).pop() || normalized,
            path: normalized,
            workflowKey,
            createdAt: now,
        });
    }
}

const asyncGuard = createAsyncGuard({
    errorTitle: "Errore Registrazioni Progettazione.",
    promiseTitle: "Errore promessa non gestita (Registrazioni Progettazione).",
    report: async (_message, detail) => showError(detail || "Errore sconosciuto"),
});
asyncGuard.installGlobalHandlers();

function showView(name: "home" | "list" | "create") {
    homeView?.classList.toggle("hidden", name !== "home");
    listView?.classList.toggle("hidden", name !== "list");
    createView?.classList.toggle("hidden", name !== "create");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}
function inputValue(id: string) {
    return String((document.getElementById(id) as HTMLInputElement)?.value || "").trim();
}
function setInputValue(id: string, value: unknown) {
    const input = document.getElementById(id) as HTMLInputElement;
    if (input) input.value = String(value || "");
}
function radioValue(name: string) {
    return String(document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value || "");
}
function setRadioValue(name: string, value: unknown) {
    document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => {
        input.checked = input.value === String(value || "");
    });
}
function checkedValues(name: string) {
    return Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`))
        .map((input) => input.value);
}
function escapeHtml(value: unknown) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
function emptyWorkflowData() {
    return { interno: {}, cliente: {} };
}
function getPhaseData(origin: string, key: string) {
    if (!successiveData[origin]) successiveData[origin] = {};
    if (!successiveData[origin][key]) {
        successiveData[origin][key] = {
            checks: [],
            approvvigionamentoMateriaPrima: "",
            note: "",
            data: "",
            emessoDa: "",
            partecipantiProduzione: "",
            partecipantiStampaggio: "",
            partecipantiOfficina: "",
            responsabileLavorazioniInterpellato: "",
            firmaDirezioneProduzione: "",
            answers: {},
        };
    }
    return successiveData[origin][key];
}
function firstBlockComplete() {
    return Boolean(inputValue("data") && inputValue("emessoDa"));
}
function syncWorkflowDataFromDom() {
    if (!renderedOrigin || !successivePhases) return;
    workflowPhases.forEach((phase) => {
        const section = successivePhases.querySelector<HTMLElement>(`[data-phase="${phase.key}"]`);
        if (!section) return;
        const data = getPhaseData(renderedOrigin, phase.key);
        data.checks = Array.from(section.querySelectorAll<HTMLInputElement>('input[data-field="checks"]:checked'))
            .map((input) => input.value);
        [
            "note", "data", "emessoDa", "partecipantiProduzione",
            "partecipantiStampaggio", "partecipantiOfficina",
            "responsabileLavorazioniInterpellato", "firmaDirezioneProduzione",
        ].forEach((field) => {
            const input = section.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${field}"]`);
            if (input) data[field] = input.value.trim();
        });
        data.approvvigionamentoMateriaPrima = String(
            section.querySelector<HTMLInputElement>('input[data-field="approvvigionamentoMateriaPrima"]:checked')?.value || "",
        );
        data.answers = {};
        section.querySelectorAll<HTMLInputElement>('input[data-field="validationAnswer"]:checked').forEach((input) => {
            data.answers[String(input.dataset.question || "")] = input.value;
        });
    });
}
function phaseHasContent(origin: string, phase: any, data: any) {
    const workflowKey = phaseAttachmentKey(origin, phase.key);
    const hasAttachment = currentAttachments.some((item) => item.workflowKey === workflowKey) ||
        pendingAttachments.some((item) => item.workflowKey === workflowKey) ||
        currentLinkedPaths.some((item) => item.workflowKey === workflowKey);
    const scalarFields = [
        "approvvigionamentoMateriaPrima", "note", "data", "emessoDa",
        "partecipantiProduzione", "partecipantiStampaggio", "partecipantiOfficina",
        "responsabileLavorazioniInterpellato", "firmaDirezioneProduzione",
    ];
    return hasAttachment ||
        (Array.isArray(data.checks) && data.checks.length > 0) ||
        Object.values(data.answers || {}).some(Boolean) ||
        scalarFields.some((field) => Boolean(String(data[field] || "").trim()));
}
function phaseIsComplete(phase: any, data: any) {
    if (!data.data || !data.emessoDa) return false;
    if (phase.validation) return Boolean(data.firmaDirezioneProduzione);
    if (phase.participants) {
        return Boolean(
            data.partecipantiProduzione &&
            data.partecipantiStampaggio &&
            data.partecipantiOfficina
        );
    }
    return true;
}
function setProgressStep(key: string, locked: boolean, state: "empty" | "partial" | "complete") {
    const step = document.getElementById(`progress-${key}`);
    if (!step) return;
    step.classList.toggle("is-locked", locked);
    step.classList.toggle("is-future", locked);
    step.setAttribute("data-state", locked ? "empty" : state);
    const status = step.querySelector("small");
    if (status) status.textContent = locked
        ? "Bloccato"
        : state === "complete"
          ? "Completato"
          : state === "partial"
            ? "In compilazione"
            : "Non iniziato";
}
function updateWorkflowProgress() {
    const unlocked = firstBlockComplete();
    const origin = radioValue("origineProgetto");
    workflowPhases.forEach((phase) => {
        const data = origin ? getPhaseData(origin, phase.key) : {};
        const complete = phaseIsComplete(phase, data);
        const partial = origin ? phaseHasContent(origin, phase, data) : false;
        setProgressStep(
            phase.key,
            !unlocked || !origin,
            complete ? "complete" : partial ? "partial" : "empty",
        );
    });
}
function phaseAttachmentKey(origin: string, phaseKey: string) {
    return `${origin}:${phaseKey}`;
}
function renderPhaseAttachments(origin: string, phaseKey: string) {
    if (!successivePhases) return;
    const target = successivePhases.querySelector<HTMLElement>(`[data-phase-files="${phaseKey}"]`);
    if (!target) return;
    const workflowKey = phaseAttachmentKey(origin, phaseKey);
    const items = [
        ...currentAttachments.filter((item) => item.workflowKey === workflowKey).map((item) => ({ ...item, pending: false, linked: false })),
        ...pendingAttachments.filter((item) => item.workflowKey === workflowKey).map((item) => ({ ...item, id: item.tempId, pending: true, linked: false })),
        ...currentLinkedPaths.filter((item) => item.workflowKey === workflowKey).map((item) => ({ ...item, linked: true })),
    ];
    target.innerHTML = "";
    if (!items.length) {
        target.innerHTML = '<span class="phase-files-empty">Nessun allegato.</span>';
        return;
    }
    items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "phase-file";
        const name = document.createElement("span");
        name.textContent = item.linked ? `Percorso: ${item.name}` : (item.originalName || "Allegato");
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "Apri";
        open.dataset.attachmentOpen = "true";
        open.addEventListener("click", () => void (item.linked ? openLinkedPath(item) : openStoredAttachment(item)));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Rimuovi";
        remove.addEventListener("click", () => {
            if (item.linked) currentLinkedPaths = currentLinkedPaths.filter((entry) => entry.id !== item.id);
            else if (item.pending) pendingAttachments = pendingAttachments.filter((entry) => entry.tempId !== item.id);
            else currentAttachments = currentAttachments.filter((entry) => entry.id !== item.id);
            renderPhaseAttachments(origin, phaseKey);
            updateWorkflowProgress();
        });
        row.append(name, open, remove);
        target.appendChild(row);
    });
}
function workflowSectionHtml(phase: any, origin: string) {
    const checks = origin === "interno" ? phase.internalChecks : phase.clientChecks;
    const modelLabel = phase.validation
        ? "Validazione finale"
        : origin === "interno"
          ? "Progettazione Interna"
          : "Progettazione per Cliente";
    const checkHtml = phase.validation
        ? checks.map((label: string, index: number) => `
            <div class="validation-question">
                <span>${index + 1}. ${escapeHtml(label)}</span>
                <div>
                    <label><input type="radio" data-field="validationAnswer" data-question="${index}" name="${origin}-${phase.key}-question-${index}" value="si"> Sì</label>
                    <label><input type="radio" data-field="validationAnswer" data-question="${index}" name="${origin}-${phase.key}-question-${index}" value="no"> No</label>
                </div>
            </div>
        `).join("")
        : checks.map((label: string, index: number) => `
            <label><input type="checkbox" data-field="checks" value="${index}"> ${escapeHtml(label)}</label>
        `).join("");
    const procurementHtml = phase.procurement ? `
        <div class="workflow-procurement">
            <strong>Controllo approvvigionamento materia prima</strong>
            <label><input type="radio" data-field="approvvigionamentoMateriaPrima" name="${origin}-${phase.key}-approvvigionamento" value="si"> Sì</label>
            <label><input type="radio" data-field="approvvigionamentoMateriaPrima" name="${origin}-${phase.key}-approvvigionamento" value="no"> No</label>
        </div>
    ` : "";
    const participantsHtml = phase.participants ? `
        <div class="workflow-participants">
            <label>Partecipanti · Direzione di produzione<input data-field="partecipantiProduzione" type="text"></label>
            <label>Partecipanti · Responsabile stampaggio<input data-field="partecipantiStampaggio" type="text"></label>
            <label>Partecipanti · Responsabile Officina<input data-field="partecipantiOfficina" type="text"></label>
        </div>
    ` : "";
    const contentHtml = phase.validation ? `
        <div class="validation-questions">${checkHtml}</div>
    ` : `
        <div class="workflow-grid">
            <fieldset class="workflow-checks"><legend>Verifiche previste</legend>${checkHtml}${procurementHtml}</fieldset>
            <label class="workflow-notes">Note<textarea data-field="note" rows="4"></textarea></label>
            <div class="workflow-attachments">
                <div class="workflow-attachments-head"><span>Allega</span><button type="button" data-add-phase-file="${phase.key}">Aggiungi File</button><button type="button" data-link-phase-path="${phase.key}">Collega Percorso</button></div>
                <input type="file" data-phase-file-input="${phase.key}" multiple hidden>
                <div class="phase-files" data-phase-files="${phase.key}"></div>
            </div>
        </div>
    `;
    const directionSignature = phase.validation
        ? '<label>Firma · Direzione di produzione<input data-field="firmaDirezioneProduzione" type="text"></label>'
        : "";
    const responsibleField = phase.validation
        ? '<label><span>Responsabile delle lavorazioni interpellato <small>· Opzionale</small></span><input data-field="responsabileLavorazioniInterpellato" type="text"></label>'
        : "";
    return `
        <section class="form-section workflow-section" data-phase="${phase.key}">
            <div class="section-heading workflow-heading">
                <span class="section-number">${phase.number}</span>
                <div><h2>${escapeHtml(phase.title)}</h2><p>${escapeHtml(phase.description)}</p></div>
                <span class="model-badge">${modelLabel}</span>
            </div>
            ${contentHtml}
            ${participantsHtml}
            <div class="workflow-issue ${phase.validation ? "validation-issue" : ""}">
                ${responsibleField}
                <label>Data<input data-field="data" type="date"></label>
                <label>Firma · Emesso da<input data-field="emessoDa" type="text"><small>Responsabile qualità e progettazione</small></label>
                ${directionSignature}
            </div>
        </section>
    `;
}
function fillWorkflowSection(phase: any, origin: string) {
    if (!successivePhases) return;
    const section = successivePhases.querySelector<HTMLElement>(`[data-phase="${phase.key}"]`);
    if (!section) return;
    const data = getPhaseData(origin, phase.key);
    const selectedChecks = new Set(Array.isArray(data.checks) ? data.checks.map(String) : []);
    section.querySelectorAll<HTMLInputElement>('input[data-field="checks"]').forEach((input) => {
        input.checked = selectedChecks.has(input.value);
    });
    [
        "note", "data", "emessoDa", "partecipantiProduzione", "partecipantiStampaggio",
        "partecipantiOfficina", "responsabileLavorazioniInterpellato", "firmaDirezioneProduzione",
    ].forEach((field) => {
        const input = section.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${field}"]`);
        if (input) input.value = String(data[field] || "");
    });
    section.querySelectorAll<HTMLInputElement>('input[data-field="approvvigionamentoMateriaPrima"]').forEach((input) => {
        input.checked = input.value === String(data.approvvigionamentoMateriaPrima || "");
    });
    section.querySelectorAll<HTMLInputElement>('input[data-field="validationAnswer"]').forEach((input) => {
        input.checked = input.value === String(data.answers?.[String(input.dataset.question || "")] || "");
    });
    renderPhaseAttachments(origin, phase.key);
}
function updateWorkflowLock() {
    if (!successivePhases) return;
    const locked = !firstBlockComplete() || !renderedOrigin;
    successivePhases.classList.toggle("is-locked", locked);
    successivePhases.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input, textarea, button")
        .forEach((control) => { if (!control.dataset.attachmentOpen) control.disabled = locked; });
    updateWorkflowProgress();
}
function bindWorkflowEvents(origin: string) {
    if (!successivePhases) return;
    successivePhases.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[data-field], textarea[data-field]')
        .forEach((control) => control.addEventListener("input", () => {
            syncWorkflowDataFromDom();
            updateWorkflowProgress();
        }));
    successivePhases.querySelectorAll<HTMLButtonElement>("[data-add-phase-file]").forEach((button) => {
        button.addEventListener("click", () => {
            const key = button.dataset.addPhaseFile || "";
            successivePhases.querySelector<HTMLInputElement>(`[data-phase-file-input="${key}"]`)?.click();
        });
    });
    successivePhases.querySelectorAll<HTMLButtonElement>("[data-link-phase-path]").forEach((button) => {
        button.addEventListener("click", asyncGuard.wrap(async () => {
            const phaseKey = button.dataset.linkPhasePath || "";
            await selectLinkedPaths(phaseAttachmentKey(origin, phaseKey));
            renderPhaseAttachments(origin, phaseKey);
            updateWorkflowProgress();
        }));
    });
    successivePhases.querySelectorAll<HTMLInputElement>("[data-phase-file-input]").forEach((input) => {
        input.addEventListener("change", asyncGuard.wrap(async () => {
            const phaseKey = input.dataset.phaseFileInput || "";
            const files = Array.from(input.files || []);
            const next = await Promise.all(files.map(async (file) => ({
                tempId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                originalName: file.name,
                dataFilePath: webUtils.getPathForFile(file),
                mimeType: file.type || "application/octet-stream",
                size: Number(file.size || 0),
                workflowKey: phaseAttachmentKey(origin, phaseKey),
            })));
            pendingAttachments = [...pendingAttachments, ...next];
            input.value = "";
            renderPhaseAttachments(origin, phaseKey);
            updateWorkflowProgress();
        }));
    });
}
function renderSuccessivePhases() {
    if (!successivePhases) return;
    if (renderedOrigin) syncWorkflowDataFromDom();
    const origin = radioValue("origineProgetto");
    renderedOrigin = origin;
    if (!origin) {
        successivePhases.innerHTML = `
            <section class="workflow-waiting">
                <h2>Seleziona l'origine del progetto</h2>
                <p>Scegli “Progetto Interno” o “Progetto Cliente” nel primo blocco per predisporre riesami e verifiche.</p>
            </section>`;
        updateWorkflowProgress();
        return;
    }
    successivePhases.innerHTML = workflowPhases.map((phase) => workflowSectionHtml(phase, origin)).join("");
    workflowPhases.forEach((phase) => fillWorkflowSection(phase, origin));
    bindWorkflowEvents(origin);
    updateWorkflowLock();
}
function scrollToProgressSection(key: string) {
    if (!stampiForm) return;
    const target = key === "base"
        ? document.getElementById("baseProjectSection")
        : successivePhases?.querySelector<HTMLElement>(`[data-phase="${key}"]`) || successivePhases;
    if (!target) return;
    const workspaceRect = stampiForm.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    stampiForm.scrollTo({
        top: stampiForm.scrollTop + targetRect.top - workspaceRect.top,
        behavior: "smooth",
    });
}
function updateCompletionStatus() {
    const completed = Boolean(inputValue("data") && inputValue("emessoDa"));
    const started = fieldIds.some((id) => Boolean(inputValue(id))) ||
        radioNames.some((name) => Boolean(radioValue(name))) ||
        checkedValues("dfmeaPfmea").length > 0 ||
        currentAttachments.some((item) => !item.workflowKey) ||
        pendingAttachments.some((item) => !item.workflowKey) ||
        currentLinkedPaths.some((item) => !item.workflowKey);
    const state = completed ? "complete" : started ? "partial" : "empty";
    blockStatus?.setAttribute("data-state", state);
    if (blockStatusText) blockStatusText.textContent = completed
        ? "Primo blocco completato"
        : started
          ? "In compilazione"
          : "Non iniziato";
    updateWorkflowLock();
}
function readForm() {
    syncWorkflowDataFromDom();
    const values: Record<string, string> = {};
    fieldIds.forEach((id) => (values[id] = inputValue(id)));
    radioNames.forEach((name) => (values[name] = radioValue(name)));
    return {
        ...values,
        previousCode: currentCode,
        dfmeaPfmea: checkedValues("dfmeaPfmea"),
        fasiSuccessive: successiveData,
        attachments: currentAttachments,
        linkedPaths: currentLinkedPaths,
        newAttachments: pendingAttachments.map((item) => ({
            fileName: item.originalName,
            dataFilePath: item.dataFilePath,
            mimeType: item.mimeType,
            size: item.size,
            workflowKey: item.workflowKey || "",
        })),
    };
}
function snapshot() {
    const payload = readForm();
    return JSON.stringify({
        ...payload,
        attachments: currentAttachments.map((item) => [item.id, item.workflowKey || ""]),
        linkedPaths: currentLinkedPaths.map((item) => [item.id, item.path, item.workflowKey || ""]),
        newAttachments: pendingAttachments.map((item) => [item.originalName, item.size, item.workflowKey || ""]),
    });
}
function markSaved() {
    savedSnapshot = snapshot();
}
function hasUnsavedChanges() {
    if (activeType === "speciali") {
        return !specialiForm?.classList.contains("hidden") &&
            Boolean(specialProjectsForm()?.hasUnsavedChanges?.());
    }
    return !stampiForm?.classList.contains("hidden") && snapshot() !== savedSnapshot;
}
async function confirmDiscardChanges() {
    if (!hasUnsavedChanges()) return true;
    return confirmDialog(
        "Uscire senza salvare le modifiche?",
        "Le modifiche apportate alla registrazione andranno perse.",
    );
}
function resetForm() {
    currentCode = "";
    currentAttachments = [];
    pendingAttachments = [];
    currentLinkedPaths = [];
    successiveData = emptyWorkflowData();
    renderedOrigin = "";
    fieldIds.forEach((id) => setInputValue(id, ""));
    radioNames.forEach((name) => setRadioValue(name, ""));
    document.querySelectorAll<HTMLInputElement>('input[name="dfmeaPfmea"]').forEach((input) => {
        input.checked = false;
    });
    renderAttachments();
    renderSuccessivePhases();
    updateCompletionStatus();
    markSaved();
}
function populateForm(item: any) {
    renderedOrigin = "";
    successiveData = item?.fasiSuccessive && typeof item.fasiSuccessive === "object"
        ? item.fasiSuccessive
        : emptyWorkflowData();
    currentCode = String(item?.code || item?.progettoNumero || "").trim();
    fieldIds.forEach((id) => setInputValue(id, item?.[id]));
    radioNames.forEach((name) => setRadioValue(name, item?.[name]));
    const dfmeaValues = new Set(Array.isArray(item?.dfmeaPfmea) ? item.dfmeaPfmea : []);
    document.querySelectorAll<HTMLInputElement>('input[name="dfmeaPfmea"]').forEach((input) => {
        input.checked = dfmeaValues.has(input.value);
    });
    currentAttachments = Array.isArray(item?.attachments) ? item.attachments : [];
    currentLinkedPaths = Array.isArray(item?.linkedPaths) ? item.linkedPaths : [];
    pendingAttachments = [];
    renderAttachments();
    renderSuccessivePhases();
    updateCompletionStatus();
    markSaved();
}
function renderAttachments() {
    if (!attachmentsList) return;
    attachmentsList.innerHTML = "";
    const items = [
        ...currentAttachments.filter((item) => !item.workflowKey).map((item) => ({ ...item, pending: false, linked: false })),
        ...pendingAttachments.filter((item) => !item.workflowKey).map((item) => ({ ...item, id: item.tempId, pending: true, linked: false })),
        ...currentLinkedPaths.filter((item) => !item.workflowKey).map((item) => ({ ...item, linked: true })),
    ];
    if (!items.length) {
        attachmentsList.innerHTML = '<p class="attachment-empty">Nessun allegato inserito.</p>';
        return;
    }
    items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "document-attachment";
        const info = document.createElement("div");
        info.className = "document-attachment-info";
        const name = document.createElement("strong");
        name.textContent = item.linked ? `Percorso: ${item.name}` : (item.originalName || "Allegato");
        const size = document.createElement("span");
        size.textContent = item.linked ? item.path : `${(Number(item.size || 0) / 1024).toFixed(1)} KB${item.pending ? " · da salvare" : ""}`;
        info.append(name, size);
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "Apri";
        open.dataset.attachmentOpen = "true";
        open.addEventListener("click", () => void (item.linked ? openLinkedPath(item) : openStoredAttachment(item)));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Rimuovi";
        remove.addEventListener("click", () => {
            if (item.linked) currentLinkedPaths = currentLinkedPaths.filter((entry) => entry.id !== item.id);
            else if (item.pending) pendingAttachments = pendingAttachments.filter((entry) => entry.tempId !== item.id);
            else currentAttachments = currentAttachments.filter((entry) => entry.id !== item.id);
            renderAttachments();
            updateCompletionStatus();
        });
        row.append(info, open, remove);
        attachmentsList.appendChild(row);
    });
}
function updateTypeContent() {
    const current = registrationTypes[activeType];
    if (listTitle) listTitle.textContent = current.title;
    if (listDescription) listDescription.textContent = current.description;
    if (createTitle) createTitle.textContent = current.title;
    if (filterSecondaryLabel) filterSecondaryLabel.textContent = activeType === "stampi" ? "Codice Articolo" : "Richiesto da";
    if (filterClassificationLabel) filterClassificationLabel.textContent = activeType === "stampi" ? "Progetto Interno/Cliente" : "Supporto esterno";
    if (filterClassification) filterClassification.innerHTML = activeType === "stampi"
        ? '<option value="">Tutti</option><option value="interno">Progetto Interno</option><option value="cliente">Progetto Cliente</option>'
        : '<option value="">Tutti</option><option value="si">Con supporto esterno</option><option value="no">Senza supporto esterno</option>';
}
function formatDate(value: unknown) {
    const date = new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("it-IT");
}
function normalizedSearch(value: unknown) {
    return String(value || "").trim().toLocaleLowerCase("it-IT");
}
function filteredListItems() {
    const project = normalizedSearch(filterProjectNumber?.value);
    const secondary = normalizedSearch(filterSecondary?.value);
    const classification = normalizedSearch(filterClassification?.value);
    const status = filterStatus?.value || "";
    const general = normalizedSearch(filterGeneral?.value);
    const filtered = listItems.filter((item) => {
        const projectValue = normalizedSearch(item.progettoNumero || item.code);
        const secondaryValue = normalizedSearch(activeType === "stampi" ? item.codiceArticolo : item.richiestoDa);
        const classificationValue = normalizedSearch(activeType === "stampi" ? item.origineProgetto : item.supportoEsterno);
        const searchable = normalizedSearch([
            item.progettoNumero, item.code, item.descrizioneProgetto, item.tipologia,
            item.codiceArticolo, item.richiestoDa, item.note, item.dfmeaPfmeaNote,
            item.caratteristicheGenerali, item.condizioniImpiego,
        ].filter(Boolean).join(" "));
        return (!project || projectValue.includes(project)) &&
            (!secondary || secondaryValue.includes(secondary)) &&
            (!classification || classificationValue === classification) &&
            (!status || (status === "complete" ? Boolean(item.completato) : !item.completato)) &&
            (!general || searchable.includes(general));
    });
    const direction = listSort?.value || "updated-desc";
    return filtered.sort((a, b) => {
        if (direction.startsWith("project")) {
            const comparison = String(a.progettoNumero || a.code || "").localeCompare(String(b.progettoNumero || b.code || ""), "it", { numeric: true });
            return direction === "project-desc" ? -comparison : comparison;
        }
        const comparison = new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime();
        return direction === "updated-asc" ? comparison : -comparison;
    });
}
function renderList() {
    if (!registrationsList || !listCount || !emptyList) return;
    registrationsList.innerHTML = "";
    const items = filteredListItems();
    listCount.textContent = items.length === listItems.length
        ? `${items.length} ${items.length === 1 ? "registrazione" : "registrazioni"}`
        : `${items.length} visualizzate su ${listItems.length}`;
    emptyList.classList.toggle("hidden", items.length > 0);
    const emptyTitle = emptyList.querySelector("h3");
    const emptyText = emptyList.querySelector("p");
    const hasFilters = Boolean(filterProjectNumber?.value || filterSecondary?.value || filterClassification?.value || filterStatus?.value || filterGeneral?.value);
    if (emptyTitle) emptyTitle.textContent = hasFilters ? "Nessun risultato" : "Nessuna registrazione presente";
    if (emptyText) emptyText.textContent = hasFilters ? "Nessuna registrazione corrisponde ai filtri impostati." : "Le registrazioni create compariranno in questo elenco.";
    items.forEach((item) => {
        const li = document.createElement("li");
        const details = document.createElement("div");
        details.className = "card-details";
        const code = document.createElement("span");
        code.className = "code";
        code.textContent = item.progettoNumero || item.code || "Senza numero";
        code.addEventListener("click", () => void openExisting(item.code, "view"));
        const meta = document.createElement("span");
        meta.className = "code-meta";
        const context = activeType === "stampi"
            ? `Articolo: ${item.codiceArticolo || "-"} | Origine: ${item.origineProgetto === "interno" ? "Interno" : item.origineProgetto === "cliente" ? "Cliente" : "-"}`
            : `Richiesto da: ${item.richiestoDa || "-"} | Supporto esterno: ${item.supportoEsterno === "si" ? "Sì" : item.supportoEsterno === "no" ? "No" : "-"}`;
        meta.textContent = `${item.descrizioneProgetto || "Nessuna descrizione"} | ${context} | Agg.: ${formatDate(item.updatedAt)}`;
        const completion = document.createElement("span");
        completion.className = `registration-completion ${item.completato ? "is-complete" : ""}`;
        completion.textContent = item.completato ? "Registrazione completata" : "Registrazione in compilazione";
        details.append(code, meta, completion);
        const actions = document.createElement("div");
        actions.className = "card-actions";
        const consult = document.createElement("button");
        consult.type = "button";
        consult.textContent = "Consulta";
        consult.addEventListener("click", () => void openExisting(item.code, "view"));
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Modifica";
        edit.addEventListener("click", () => void openExisting(item.code, "edit"));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Elimina";
        remove.addEventListener("click", () => void deleteItem(item.code));
        actions.append(consult, edit, remove);
        li.append(details, actions);
        registrationsList.appendChild(li);
    });
}
async function loadList() {
    const channel = activeType === "stampi"
        ? "registrazioni-progettazione-stampi-list"
        : "registrazioni-progetti-speciali-list";
    const result = await ipcRenderer.invoke(channel);
    if (!result?.ok) {
        listItems = [];
        renderList();
        await showError("Impossibile caricare le registrazioni.", result?.error || "");
        return;
    }
    listItems = Array.isArray(result.items) ? result.items : [];
    renderList();
}
async function openList(type: RegistrationType) {
    activeType = type;
    [filterProjectNumber, filterSecondary, filterGeneral].forEach((input) => { if (input) input.value = ""; });
    [filterClassification, filterStatus].forEach((select) => { if (select) select.value = ""; });
    if (listSort) listSort.value = "updated-desc";
    updateTypeContent();
    showView("list");
    await loadList();
}
function openCreateView() {
    updateTypeContent();
    const isStampi = activeType === "stampi";
    stampiForm?.classList.toggle("hidden", !isStampi);
    specialiForm?.classList.toggle("hidden", isStampi);
    applyFormMode(false);
    if (isStampi) resetForm();
    else specialProjectsForm()?.reset?.();
    showView("create");
}
function applyFormMode(readOnly: boolean) {
    saveFormBtn?.classList.toggle("hidden", readOnly);
    newFormBtn?.classList.toggle("hidden", readOnly);
    stampiForm?.classList.toggle("is-read-only", readOnly);
    specialiForm?.classList.toggle("is-read-only", readOnly);
    stampiForm?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>("input, textarea, select, button")
        .forEach((control) => { if (!control.dataset.attachmentOpen) control.disabled = readOnly; });
    specialProjectsForm()?.setReadOnly?.(readOnly);
    if (!readOnly) updateWorkflowLock();
}
async function openExisting(code: string, mode: "view" | "edit" = "view") {
    const channel = activeType === "stampi"
        ? "registrazioni-progettazione-stampi-load"
        : "registrazioni-progetti-speciali-load";
    const result = await ipcRenderer.invoke(channel, { code });
    if (!result?.ok || !result.item) {
        await showError("Impossibile aprire la registrazione.", result?.error || "");
        return;
    }
    updateTypeContent();
    const isStampi = activeType === "stampi";
    stampiForm?.classList.toggle("hidden", !isStampi);
    specialiForm?.classList.toggle("hidden", isStampi);
    if (isStampi) populateForm(result.item);
    else specialProjectsForm()?.populate?.(result.item);
    applyFormMode(mode === "view");
    showView("create");
}
async function saveForm() {
    const isStampi = activeType === "stampi";
    const payload = isStampi ? readForm() : specialProjectsForm()?.read?.();
    if (!payload.progettoNumero) {
        await showWarning("Inserire il numero del progetto.");
        (document.getElementById(isStampi ? "progettoNumero" : "specialProgettoNumero") as HTMLInputElement)?.focus();
        return;
    }
    const channel = isStampi
        ? "registrazioni-progettazione-stampi-save"
        : "registrazioni-progetti-speciali-save";
    const result = await withAttachmentSaveUi(() => ipcRenderer.invoke(channel, payload));
    if (!result?.ok) {
        await showError("Impossibile salvare la registrazione.", result?.error || "");
        return;
    }
    if (isStampi) populateForm(result.item || { ...payload, code: result.code, newAttachments: [] });
    else specialProjectsForm()?.populate?.(result.item || { ...payload, code: result.code, newAttachments: [] });
    await showInfo(`Registrazione salvata: ${result.code}`);
}
async function deleteItem(code: string) {
    const confirmed = await confirmDialog(
        `Eliminare la registrazione ${code}?`,
        "La registrazione e i relativi allegati verranno rimossi.",
    );
    if (!confirmed) return;
    const channel = activeType === "stampi"
        ? "registrazioni-progettazione-stampi-delete"
        : "registrazioni-progetti-speciali-delete";
    const result = await ipcRenderer.invoke(channel, { code });
    if (!result?.ok) {
        await showError("Impossibile eliminare la registrazione.", result?.error || "");
        return;
    }
    await loadList();
}

document.getElementById("openStampiBtn")?.addEventListener("click", asyncGuard.wrap(() => openList("stampi")));
document.getElementById("openSpecialiBtn")?.addEventListener("click", asyncGuard.wrap(() => openList("speciali")));
document.getElementById("closeWindowBtn")?.addEventListener("click", () => window.close());
document.getElementById("backFromListBtn")?.addEventListener("click", () => showView("home"));
["createBtn", "createEmptyBtn"].forEach((id) => document.getElementById(id)?.addEventListener("click", openCreateView));
document.getElementById("returnToListBtn")?.addEventListener("click", () => showView("list"));
document.getElementById("backFromCreateBtn")?.addEventListener("click", asyncGuard.wrap(async () => {
    if (!(await confirmDiscardChanges())) return;
    showView("list");
    await loadList();
}));
newFormBtn?.addEventListener("click", asyncGuard.wrap(async () => {
    if (!(await confirmDiscardChanges())) return;
    if (activeType === "stampi") resetForm();
    else specialProjectsForm()?.reset?.();
}));
saveFormBtn?.addEventListener("click", asyncGuard.wrap(saveForm));
document.getElementById("addAttachmentBtn")?.addEventListener("click", () => attachmentInput?.click());
document.getElementById("linkAttachmentPathBtn")?.addEventListener("click", asyncGuard.wrap(async () => {
    await selectLinkedPaths("");
    renderAttachments();
    updateCompletionStatus();
}));
attachmentInput?.addEventListener("change", asyncGuard.wrap(async (event) => {
    const files = Array.from(event?.target?.files || []);
    const next = await Promise.all(files.map(async (file: File) => ({
        tempId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        originalName: file.name,
        dataFilePath: webUtils.getPathForFile(file),
        mimeType: file.type || "application/octet-stream",
        size: Number(file.size || 0),
    })));
    pendingAttachments = [...pendingAttachments, ...next];
    attachmentInput.value = "";
    renderAttachments();
    updateCompletionStatus();
}));
stampiForm?.addEventListener("input", (event) => {
    if (successivePhases?.contains(event.target as Node)) return;
    updateCompletionStatus();
});
stampiForm?.addEventListener("change", (event) => {
    if (successivePhases?.contains(event.target as Node)) return;
    updateCompletionStatus();
});
document.querySelectorAll<HTMLInputElement>('input[name="origineProgetto"]').forEach((input) => {
    input.addEventListener("change", renderSuccessivePhases);
});
document.querySelectorAll<HTMLElement>("[data-progress-target]").forEach((step) => {
    step.setAttribute("role", "button");
    step.tabIndex = 0;
    const navigate = () => scrollToProgressSection(step.dataset.progressTarget || "");
    step.addEventListener("click", navigate);
    step.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        navigate();
    });
});
[filterProjectNumber, filterSecondary, filterGeneral].forEach((input) => input?.addEventListener("input", renderList));
[filterClassification, filterStatus, listSort].forEach((select) => select?.addEventListener("change", renderList));
document.getElementById("clearRegistrationFiltersBtn")?.addEventListener("click", () => {
    [filterProjectNumber, filterSecondary, filterGeneral].forEach((input) => { if (input) input.value = ""; });
    [filterClassification, filterStatus].forEach((select) => { if (select) select.value = ""; });
    if (listSort) listSort.value = "updated-desc";
    renderList();
});

resetForm();
showView("home");
