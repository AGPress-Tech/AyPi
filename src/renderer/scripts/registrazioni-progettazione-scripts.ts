// @ts-nocheck
require("./shared/dev-guards");
const { ipcRenderer } = require("electron");
const { createAsyncGuard } = require("./shared/async-guard");
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

const homeView = document.getElementById("homeView");
const listView = document.getElementById("listView");
const createView = document.getElementById("createView");
const stampiForm = document.getElementById("stampiForm");
const specialiPlaceholder = document.getElementById("specialiPlaceholder");
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

let activeType: RegistrationType = "stampi";
let listItems: any[] = [];
let currentCode = "";
let currentAttachments: any[] = [];
let pendingAttachments: any[] = [];
let savedSnapshot = "";

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
function updateCompletionStatus() {
    const completed = Boolean(inputValue("data") && inputValue("emessoDa"));
    blockStatus?.setAttribute("data-complete", completed ? "true" : "false");
    if (blockStatusText) blockStatusText.textContent = completed
        ? "Primo blocco completato"
        : "Blocco da completare";
}
function readForm() {
    const values: Record<string, string> = {};
    fieldIds.forEach((id) => (values[id] = inputValue(id)));
    radioNames.forEach((name) => (values[name] = radioValue(name)));
    return {
        ...values,
        previousCode: currentCode,
        dfmeaPfmea: checkedValues("dfmeaPfmea"),
        attachments: currentAttachments,
        newAttachments: pendingAttachments.map((item) => ({
            fileName: item.originalName,
            dataBase64: item.dataBase64,
            mimeType: item.mimeType,
            size: item.size,
        })),
    };
}
function snapshot() {
    const payload = readForm();
    return JSON.stringify({
        ...payload,
        attachments: currentAttachments.map((item) => item.id),
        newAttachments: pendingAttachments.map((item) => [item.originalName, item.size]),
    });
}
function markSaved() {
    savedSnapshot = snapshot();
}
function hasUnsavedChanges() {
    return activeType === "stampi" &&
        !stampiForm?.classList.contains("hidden") && snapshot() !== savedSnapshot;
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
    fieldIds.forEach((id) => setInputValue(id, ""));
    radioNames.forEach((name) => setRadioValue(name, ""));
    document.querySelectorAll<HTMLInputElement>('input[name="dfmeaPfmea"]').forEach((input) => {
        input.checked = false;
    });
    renderAttachments();
    updateCompletionStatus();
    markSaved();
}
function populateForm(item: any) {
    currentCode = String(item?.code || item?.progettoNumero || "").trim();
    fieldIds.forEach((id) => setInputValue(id, item?.[id]));
    radioNames.forEach((name) => setRadioValue(name, item?.[name]));
    const dfmeaValues = new Set(Array.isArray(item?.dfmeaPfmea) ? item.dfmeaPfmea : []);
    document.querySelectorAll<HTMLInputElement>('input[name="dfmeaPfmea"]').forEach((input) => {
        input.checked = dfmeaValues.has(input.value);
    });
    currentAttachments = Array.isArray(item?.attachments) ? item.attachments : [];
    pendingAttachments = [];
    renderAttachments();
    updateCompletionStatus();
    markSaved();
}
function renderAttachments() {
    if (!attachmentsList) return;
    attachmentsList.innerHTML = "";
    const items = [
        ...currentAttachments.map((item) => ({ ...item, pending: false })),
        ...pendingAttachments.map((item) => ({ ...item, id: item.tempId, pending: true })),
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
        name.textContent = item.originalName || "Allegato";
        const size = document.createElement("span");
        size.textContent = `${(Number(item.size || 0) / 1024).toFixed(1)} KB${item.pending ? " · da salvare" : ""}`;
        info.append(name, size);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Rimuovi";
        remove.addEventListener("click", () => {
            if (item.pending) pendingAttachments = pendingAttachments.filter((entry) => entry.tempId !== item.id);
            else currentAttachments = currentAttachments.filter((entry) => entry.id !== item.id);
            renderAttachments();
        });
        row.append(info, remove);
        attachmentsList.appendChild(row);
    });
}
function updateTypeContent() {
    const current = registrationTypes[activeType];
    if (listTitle) listTitle.textContent = current.title;
    if (listDescription) listDescription.textContent = current.description;
    if (createTitle) createTitle.textContent = current.title;
}
function formatDate(value: unknown) {
    const date = new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("it-IT");
}
function renderList() {
    if (!registrationsList || !listCount || !emptyList) return;
    registrationsList.innerHTML = "";
    const items = activeType === "stampi" ? listItems : [];
    listCount.textContent = `${items.length} ${items.length === 1 ? "registrazione" : "registrazioni"}`;
    emptyList.classList.toggle("hidden", items.length > 0);
    items.forEach((item) => {
        const li = document.createElement("li");
        const details = document.createElement("div");
        details.className = "card-details";
        const code = document.createElement("span");
        code.className = "code";
        code.textContent = item.progettoNumero || item.code || "Senza numero";
        code.addEventListener("click", () => void openExisting(item.code));
        const meta = document.createElement("span");
        meta.className = "code-meta";
        meta.textContent = `${item.descrizioneProgetto || "Nessuna descrizione"} | Articolo: ${item.codiceArticolo || "-"} | Agg.: ${formatDate(item.updatedAt)}`;
        const completion = document.createElement("span");
        completion.className = `registration-completion ${item.completato ? "is-complete" : ""}`;
        completion.textContent = item.completato ? "Primo blocco completato" : "Primo blocco da completare";
        details.append(code, meta, completion);
        const actions = document.createElement("div");
        actions.className = "card-actions";
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "Apri";
        open.addEventListener("click", () => void openExisting(item.code));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Elimina";
        remove.addEventListener("click", () => void deleteItem(item.code));
        actions.append(open, remove);
        li.append(details, actions);
        registrationsList.appendChild(li);
    });
}
async function loadList() {
    if (activeType !== "stampi") {
        listItems = [];
        renderList();
        return;
    }
    const result = await ipcRenderer.invoke("registrazioni-progettazione-stampi-list");
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
    updateTypeContent();
    showView("list");
    await loadList();
}
function openCreateView() {
    updateTypeContent();
    const isStampi = activeType === "stampi";
    stampiForm?.classList.toggle("hidden", !isStampi);
    specialiPlaceholder?.classList.toggle("hidden", isStampi);
    saveFormBtn?.classList.toggle("hidden", !isStampi);
    newFormBtn?.classList.toggle("hidden", !isStampi);
    if (isStampi) resetForm();
    showView("create");
}
async function openExisting(code: string) {
    const result = await ipcRenderer.invoke("registrazioni-progettazione-stampi-load", { code });
    if (!result?.ok || !result.item) {
        await showError("Impossibile aprire la registrazione.", result?.error || "");
        return;
    }
    activeType = "stampi";
    updateTypeContent();
    stampiForm?.classList.remove("hidden");
    specialiPlaceholder?.classList.add("hidden");
    saveFormBtn?.classList.remove("hidden");
    newFormBtn?.classList.remove("hidden");
    populateForm(result.item);
    showView("create");
}
async function saveForm() {
    const payload = readForm();
    if (!payload.progettoNumero) {
        await showWarning("Inserire il numero del progetto.");
        (document.getElementById("progettoNumero") as HTMLInputElement)?.focus();
        return;
    }
    const result = await ipcRenderer.invoke("registrazioni-progettazione-stampi-save", payload);
    if (!result?.ok) {
        await showError("Impossibile salvare la registrazione.", result?.error || "");
        return;
    }
    populateForm(result.item || { ...payload, code: result.code, newAttachments: [] });
    await showInfo(`Registrazione salvata: ${result.code}`);
}
async function deleteItem(code: string) {
    const confirmed = await confirmDialog(
        `Eliminare la registrazione ${code}?`,
        "La registrazione e i relativi allegati verranno rimossi.",
    );
    if (!confirmed) return;
    const result = await ipcRenderer.invoke("registrazioni-progettazione-stampi-delete", { code });
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
    resetForm();
}));
saveFormBtn?.addEventListener("click", asyncGuard.wrap(saveForm));
document.getElementById("addAttachmentBtn")?.addEventListener("click", () => attachmentInput?.click());
attachmentInput?.addEventListener("change", asyncGuard.wrap(async (event) => {
    const files = Array.from(event?.target?.files || []);
    const next = await Promise.all(files.map(async (file: File) => ({
        tempId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        originalName: file.name,
        dataBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
        mimeType: file.type || "application/octet-stream",
        size: Number(file.size || 0),
    })));
    pendingAttachments = [...pendingAttachments, ...next];
    attachmentInput.value = "";
    renderAttachments();
}));
document.getElementById("data")?.addEventListener("input", updateCompletionStatus);
document.getElementById("emessoDa")?.addEventListener("input", updateCompletionStatus);

resetForm();
showView("home");
