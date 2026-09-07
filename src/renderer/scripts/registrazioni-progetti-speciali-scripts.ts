// @ts-nocheck
require("./shared/dev-guards");
const { showWarning, confirmDialog } = require("./shared/dialogs");

const specialFieldMap = {
    progettoNumero: "specialProgettoNumero",
    descrizioneProgetto: "specialDescrizioneProgetto",
    condizioniImpiego: "specialCondizioniImpiego",
    richiestoDa: "specialRichiestoDa",
    pesoStampato: "specialPesoStampato",
    pesoTornito: "specialPesoTornito",
    requisitiNormativi: "specialRequisitiNormativi",
    requisitiBrevetto: "specialRequisitiBrevetto",
    validazionePreseriePrevistaPer: "specialValidazionePreserie",
    inizioProduzionePrevistaPer: "specialInizioProduzione",
    dfmeaPfmeaNote: "specialDfmeaNote",
    rischioAlto: "specialRischioAlto",
    rischioMedio: "specialRischioMedio",
    rischioBasso: "specialRischioBasso",
    note: "specialNote",
    supportoEsternoNote: "specialSupportoEsternoNote",
    caratteristicheGenerali: "specialCaratteristicheGenerali",
    data: "specialData",
    emessoDa: "specialEmessoDa",
};
const validationQuestions = [
    "Prove di collaudo generali",
    "Verifica dei componenti previsti",
    "Verifica dei montaggi e confezionamenti",
    "Completezza dell'archivio dei disegni tecnici",
    "Conformità e omologazione delle attrezzature di produzione",
    "Completezza della documentazione tecnica di accompagnamento",
    "Rispetto di norme, brevetti o requisiti cliente",
];

const specialForm = document.getElementById("specialiForm");
const pairsContainer = document.getElementById("specialPairsContainer");
const validationsContainer = document.getElementById("specialValidationsContainer");
const progressList = document.getElementById("specialProgressList");
const baseAttachmentInput = document.getElementById("specialAttachmentInput") as HTMLInputElement;
const baseAttachmentsList = document.getElementById("specialAttachmentsList");

let currentCode = "";
let pairs: any[] = [];
let validations: any[] = [];
let currentAttachments: any[] = [];
let pendingAttachments: any[] = [];
let savedSnapshot = "";

function uid(prefix: string) {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function textValue(id: string) {
    return String((document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement)?.value || "").trim();
}
function setTextValue(id: string, value: unknown) {
    const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
    if (input) input.value = String(value || "");
}
function radioValue(name: string) {
    return String(document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value || "");
}
function setRadio(name: string, value: unknown) {
    document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((input) => {
        input.checked = input.value === String(value || "");
    });
}
function escapeHtml(value: unknown) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function newPair() {
    return { id: uid("pair"), verifica: {}, riesame: {} };
}
function newValidation() {
    return { id: uid("validation"), answers: {}, note: "" };
}
function baseComplete() {
    return Boolean(textValue("specialData") && textValue("specialEmessoDa"));
}
function pairPartComplete(part: string, data: any) {
    if (part === "verifica") {
        return Boolean(data?.data && data?.firmaResponsabileTecnico && data?.firmaRgq);
    }
    return Boolean(
        data?.data && data?.firmaDirezioneCommerciale &&
        data?.firmaResponsabileTecnico && data?.firmaRgq,
    );
}
function pairPartStarted(pairId: string, part: string, data: any) {
    const scope = `pair:${pairId}:${part}`;
    return Object.values(data || {}).some((value) => Boolean(String(value || "").trim())) ||
        currentAttachments.some((item) => item.scopeKey === scope) ||
        pendingAttachments.some((item) => item.scopeKey === scope);
}
function validationSigned(attempt: any) {
    return Boolean(
        attempt?.data && attempt?.firmaProgettazione &&
        attempt?.firmaDirezioneProduzione && attempt?.firmaDirezioneCommerciale,
    );
}
function validationStarted(attempt: any) {
    const scope = `validation:${attempt?.id || ""}`;
    return Boolean(
        attempt?.superata || attempt?.data || attempt?.firmaProgettazione ||
        attempt?.firmaDirezioneProduzione || attempt?.firmaDirezioneCommerciale ||
        Object.values(attempt?.answers || {}).some(Boolean) ||
        attempt?.note ||
        currentAttachments.some((item) => item.scopeKey === scope) ||
        pendingAttachments.some((item) => item.scopeKey === scope),
    );
}
function allPairsComplete() {
    return pairs.length > 0 && pairs.every((pair) =>
        pairPartComplete("verifica", pair.verifica) && pairPartComplete("riesame", pair.riesame),
    );
}
function baseStarted() {
    return Object.values(specialFieldMap).some((id) => Boolean(textValue(id))) ||
        Boolean(radioValue("specialNuovoProgetto")) ||
        Boolean(radioValue("specialSupportoEsterno")) ||
        document.querySelectorAll<HTMLInputElement>('input[name="specialDfmeaPfmea"]:checked').length > 0 ||
        currentAttachments.some((item) => item.scopeKey === "base") ||
        pendingAttachments.some((item) => item.scopeKey === "base");
}
function stateOf(started: boolean, complete: boolean) {
    return complete ? "complete" : started ? "partial" : "empty";
}
function setControlsLocked(container: Element | null, locked: boolean) {
    container?.classList.toggle("is-locked", locked);
    container?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input, textarea, button")
        .forEach((control) => (control.disabled = locked));
}
function syncPairsFromDom() {
    pairs.forEach((pair) => {
        ["verifica", "riesame"].forEach((part) => {
            const section = pairsContainer?.querySelector<HTMLElement>(`[data-pair-id="${pair.id}"][data-pair-part="${part}"]`);
            if (!section) return;
            const data = pair[part];
            section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-special-field]").forEach((input) => {
                data[input.dataset.specialField || ""] = input.value.trim();
            });
        });
    });
}
function syncValidationsFromDom() {
    validations.forEach((attempt) => {
        const section = validationsContainer?.querySelector<HTMLElement>(`[data-validation-id="${attempt.id}"]`);
        if (!section) return;
        ["note", "data", "firmaProgettazione", "firmaDirezioneProduzione", "firmaDirezioneCommerciale"].forEach((field) => {
            const input = section.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-special-validation-field="${field}"]`);
            attempt[field] = input?.value.trim() || "";
        });
        attempt.superata = String(section.querySelector<HTMLInputElement>('input[data-special-validation-field="superata"]:checked')?.value || "");
        attempt.answers = {};
        section.querySelectorAll<HTMLInputElement>('input[data-special-validation-answer]:checked').forEach((input) => {
            attempt.answers[String(input.dataset.specialValidationAnswer || "")] = input.value;
        });
    });
}
function syncDynamicData() {
    syncPairsFromDom();
    syncValidationsFromDom();
}
function scopedItems(scopeKey: string) {
    return [
        ...currentAttachments.filter((item) => item.scopeKey === scopeKey).map((item) => ({ ...item, pending: false })),
        ...pendingAttachments.filter((item) => item.scopeKey === scopeKey).map((item) => ({ ...item, id: item.tempId, pending: true })),
    ];
}
function renderFileList(target: HTMLElement | null, scopeKey: string) {
    if (!target) return;
    target.innerHTML = "";
    const items = scopedItems(scopeKey);
    if (!items.length) {
        target.innerHTML = '<span class="phase-files-empty">Nessun allegato.</span>';
        return;
    }
    items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "phase-file";
        const name = document.createElement("span");
        name.textContent = item.originalName || "Allegato";
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Rimuovi";
        remove.addEventListener("click", () => {
            if (item.pending) pendingAttachments = pendingAttachments.filter((entry) => entry.tempId !== item.id);
            else currentAttachments = currentAttachments.filter((entry) => entry.id !== item.id);
            renderFileList(target, scopeKey);
            renderProgress();
        });
        row.append(name, remove);
        target.appendChild(row);
    });
}
async function addFiles(files: File[], scopeKey: string) {
    const next = await Promise.all(files.map(async (file) => ({
        tempId: uid("file"), originalName: file.name,
        dataBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
        mimeType: file.type || "application/octet-stream", size: Number(file.size || 0), scopeKey,
    })));
    pendingAttachments = [...pendingAttachments, ...next];
}
function pairPartHtml(pair: any, index: number, part: "verifica" | "riesame") {
    const isReview = part === "riesame";
    const data = pair[part] || {};
    const scope = `pair:${pair.id}:${part}`;
    const signatures = isReview ? `
        <label>Firma · Direzione commerciale<input data-special-field="firmaDirezioneCommerciale" type="text" value="${escapeHtml(data.firmaDirezioneCommerciale)}"></label>
        <label>Firma · Responsabile tecnico<input data-special-field="firmaResponsabileTecnico" type="text" value="${escapeHtml(data.firmaResponsabileTecnico)}"></label>
        <label>Firma · Responsabile RGQ<input data-special-field="firmaRgq" type="text" value="${escapeHtml(data.firmaRgq)}"></label>
    ` : `
        <label>Firma · Responsabile tecnico<input data-special-field="firmaResponsabileTecnico" type="text" value="${escapeHtml(data.firmaResponsabileTecnico)}"></label>
        <label>Firma · Responsabile RGQ<input data-special-field="firmaRgq" type="text" value="${escapeHtml(data.firmaRgq)}"></label>
    `;
    return `
        <section id="special-${part}-${pair.id}" class="form-section special-pair-part" data-pair-id="${pair.id}" data-pair-part="${part}">
            <div class="section-heading"><span class="section-number">${index + 1}</span><div>
                <h2>${isReview ? "Riesame" : "Verifica"} n°${index + 1} del progetto</h2>
                <p>${isReview ? "Valutazione dei risultati, problemi e azioni di miglioramento." : "Verifica tecnica del progetto."}</p>
            </div></div>
            <div class="special-record-grid">
                <label>Note<textarea data-special-field="note" rows="4">${escapeHtml(data.note)}</textarea></label>
                <div class="workflow-attachments">
                    <div class="workflow-attachments-head"><span>Allega</span><button type="button" data-special-add-files="${scope}">Aggiungi File</button></div>
                    <input type="file" data-special-file-input="${scope}" multiple hidden>
                    <div class="phase-files" data-special-files="${scope}"></div>
                </div>
            </div>
            <div class="workflow-issue ${isReview ? "special-review-signatures" : "special-check-signatures"}">
                <label>Data<input data-special-field="data" type="date" value="${escapeHtml(data.data)}"></label>${signatures}
            </div>
        </section>`;
}
function renderPairs() {
    if (!pairsContainer) return;
    syncPairsFromDom();
    pairsContainer.innerHTML = `
        <div class="special-dynamic-toolbar">
            <div><h2>Verifiche e Riesami</h2><p>Ogni coppia contiene sempre una verifica e il relativo riesame.</p></div>
            <button id="addSpecialPairBtn" type="button">Aggiungi Coppia Verifica/Riesame</button>
        </div>
        ${pairs.map((pair, index) => `
            <div class="special-pair" data-pair-wrapper="${pair.id}">
                <div class="special-pair-heading"><strong>Coppia ${index + 1}</strong><button type="button" data-remove-special-pair="${pair.id}" ${pairs.length === 1 ? "disabled" : ""}>Rimuovi Coppia</button></div>
                ${pairPartHtml(pair, index, "verifica")}${pairPartHtml(pair, index, "riesame")}
            </div>`).join("")}`;
    pairs.forEach((pair) => ["verifica", "riesame"].forEach((part) => {
        const scope = `pair:${pair.id}:${part}`;
        renderFileList(pairsContainer.querySelector<HTMLElement>(`[data-special-files="${scope}"]`), scope);
    }));
    pairsContainer.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-special-field]").forEach((input) =>
        input.addEventListener("input", () => { syncPairsFromDom(); updateLocks(); renderProgress(); }));
    pairsContainer.querySelectorAll<HTMLButtonElement>("[data-special-add-files]").forEach((button) => button.addEventListener("click", () =>
        pairsContainer.querySelector<HTMLInputElement>(`[data-special-file-input="${button.dataset.specialAddFiles}"]`)?.click()));
    pairsContainer.querySelectorAll<HTMLInputElement>("[data-special-file-input]").forEach((input) => input.addEventListener("change", async () => {
        const scope = input.dataset.specialFileInput || "";
        await addFiles(Array.from(input.files || []), scope);
        input.value = "";
        renderFileList(pairsContainer.querySelector<HTMLElement>(`[data-special-files="${scope}"]`), scope);
        renderProgress();
    }));
    document.getElementById("addSpecialPairBtn")?.addEventListener("click", () => {
        syncDynamicData(); pairs.push(newPair()); renderPairs(); renderValidations(); updateLocks(); renderProgress();
    });
    pairsContainer.querySelectorAll<HTMLButtonElement>("[data-remove-special-pair]").forEach((button) => button.addEventListener("click", async () => {
        if (pairs.length <= 1) { await showWarning("Deve rimanere almeno una coppia Verifica/Riesame."); return; }
        if (!(await confirmDialog("Rimuovere questa coppia Verifica/Riesame?", "Dati e allegati della coppia verranno rimossi al prossimo salvataggio."))) return;
        const id = button.dataset.removeSpecialPair || "";
        currentAttachments = currentAttachments.filter((item) => !String(item.scopeKey).startsWith(`pair:${id}:`));
        pendingAttachments = pendingAttachments.filter((item) => !String(item.scopeKey).startsWith(`pair:${id}:`));
        pairs = pairs.filter((pair) => pair.id !== id);
        renderPairs(); renderValidations(); updateLocks(); renderProgress();
    }));
}
function validationHtml(attempt: any, index: number) {
    const scope = `validation:${attempt.id}`;
    const questions = validationQuestions.map((question, questionIndex) => `
        <div class="validation-question"><span>${questionIndex + 1}. ${escapeHtml(question)}</span><div>
            <label><input type="radio" data-special-validation-answer="${questionIndex}" name="${attempt.id}-answer-${questionIndex}" value="si"> Sì</label>
            <label><input type="radio" data-special-validation-answer="${questionIndex}" name="${attempt.id}-answer-${questionIndex}" value="no"> No</label>
        </div></div>`).join("");
    return `
        <section id="special-validation-${attempt.id}" class="form-section special-validation" data-validation-id="${attempt.id}">
            <div class="section-heading"><span class="section-number">${index + 1}</span><div><h2>Validazione del progetto ${index > 0 ? `· Tentativo ${index + 1}` : ""}</h2><p>Prove finali prima dell'avvio della produzione.</p></div></div>
            <div class="validation-questions">${questions}</div>
            <div class="special-record-grid special-validation-records">
                <label>Note<textarea data-special-validation-field="note" rows="5">${escapeHtml(attempt.note)}</textarea></label>
                <div class="workflow-attachments">
                    <div class="workflow-attachments-head"><span>Allegati</span><button type="button" data-special-validation-add-files="${scope}">Aggiungi File</button></div>
                    <input type="file" data-special-validation-file-input="${scope}" multiple hidden>
                    <div class="phase-files" data-special-validation-files="${scope}"></div>
                </div>
            </div>
            <fieldset class="special-validation-result"><legend>Validazione Superata</legend>
                <label><input type="radio" data-special-validation-field="superata" name="${attempt.id}-superata" value="si"> Sì</label>
                <label><input type="radio" data-special-validation-field="superata" name="${attempt.id}-superata" value="no"> No</label>
            </fieldset>
            <div class="workflow-issue special-validation-signatures">
                <label>Data<input data-special-validation-field="data" type="date"></label>
                <label>Firma · Progettazione<input data-special-validation-field="firmaProgettazione" type="text"></label>
                <label>Firma · Direzione produzione<input data-special-validation-field="firmaDirezioneProduzione" type="text"></label>
                <label>Firma · Direzione commerciale<input data-special-validation-field="firmaDirezioneCommerciale" type="text"></label>
            </div>
        </section>`;
}
function fillValidation(attempt: any) {
    const section = validationsContainer?.querySelector<HTMLElement>(`[data-validation-id="${attempt.id}"]`);
    if (!section) return;
    section.querySelectorAll<HTMLInputElement>("[data-special-validation-answer]").forEach((input) => {
        input.checked = input.value === String(attempt.answers?.[input.dataset.specialValidationAnswer || ""] || "");
    });
    section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-special-validation-field]").forEach((input) => {
        const field = input.dataset.specialValidationField || "";
        if (input instanceof HTMLInputElement && input.type === "radio") input.checked = input.value === String(attempt[field] || "");
        else input.value = String(attempt[field] || "");
    });
}
function renderValidations() {
    if (!validationsContainer) return;
    syncValidationsFromDom();
    validationsContainer.innerHTML = validations.map(validationHtml).join("");
    validations.forEach(fillValidation);
    validations.forEach((attempt) => {
        const scope = `validation:${attempt.id}`;
        renderFileList(validationsContainer.querySelector<HTMLElement>(`[data-special-validation-files="${scope}"]`), scope);
    });
    validationsContainer.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((input) => input.addEventListener("input", async (event) => {
        event.stopPropagation();
        const section = input.closest<HTMLElement>("[data-validation-id]");
        const attemptIndex = validations.findIndex((entry) => entry.id === section?.dataset.validationId);
        const attempt = validations[attemptIndex];
        let structureChanged = false;
        if (input.dataset.specialValidationField === "superata" && input.value === "si" &&
            attempt?.superata === "no" && attemptIndex < validations.length - 1) {
            const confirmed = await confirmDialog(
                "Cambiare la validazione da No a Sì?",
                "Tutte le validazioni successive e i relativi allegati verranno eliminati.",
            );
            if (!confirmed) {
                fillValidation(attempt);
                updateLocks();
                renderProgress();
                return;
            }
            const removedIds = new Set(validations.slice(attemptIndex + 1).map((entry) => entry.id));
            currentAttachments = currentAttachments.filter((item) => !removedIds.has(String(item.scopeKey || "").replace(/^validation:/, "")));
            pendingAttachments = pendingAttachments.filter((item) => !removedIds.has(String(item.scopeKey || "").replace(/^validation:/, "")));
            validations = validations.slice(0, attemptIndex + 1);
            structureChanged = true;
        }
        syncValidationsFromDom();
        if (input.dataset.specialValidationField === "superata" && input.value === "no" && attemptIndex === validations.length - 1) {
            validations.push(newValidation());
            structureChanged = true;
        }
        if (structureChanged) renderValidations();
        updateLocks(); renderProgress();
    }));
    validationsContainer.querySelectorAll<HTMLButtonElement>("[data-special-validation-add-files]").forEach((button) => button.addEventListener("click", () =>
        validationsContainer.querySelector<HTMLInputElement>(`[data-special-validation-file-input="${button.dataset.specialValidationAddFiles}"]`)?.click()));
    validationsContainer.querySelectorAll<HTMLInputElement>("[data-special-validation-file-input]").forEach((input) => input.addEventListener("change", async (event) => {
        event.stopPropagation();
        const scope = input.dataset.specialValidationFileInput || "";
        await addFiles(Array.from(input.files || []), scope);
        input.value = "";
        renderFileList(validationsContainer.querySelector<HTMLElement>(`[data-special-validation-files="${scope}"]`), scope);
        renderProgress();
    }));
}
function updateLocks() {
    const pairsUnlocked = baseComplete();
    setControlsLocked(pairsContainer, !pairsUnlocked);
    const validationUnlocked = pairsUnlocked && allPairsComplete();
    validations.forEach((attempt, index) => {
        const section = validationsContainer?.querySelector(`[data-validation-id="${attempt.id}"]`);
        const previousAllows = index === 0 || validations[index - 1]?.superata === "no";
        setControlsLocked(section, !validationUnlocked || !previousAllows);
    });
}
function progressItem(target: string, number: string, title: string, state: string, locked = false, subtitle = "") {
    const status = locked ? "Bloccato" : subtitle || (state === "complete" ? "Completato" : state === "partial" ? "In compilazione" : "Non iniziato");
    return `<li class="progress-step ${locked ? "is-locked is-future" : ""}" data-state="${state}" data-special-progress-target="${target}" role="button" tabindex="0"><span class="progress-marker">${number}</span><div><strong>${escapeHtml(title)}</strong><small>${status}</small></div></li>`;
}
function renderProgress() {
    if (!progressList) return;
    syncDynamicData();
    const baseDone = baseComplete();
    const html = [progressItem("base", "1", "Requisiti di base", stateOf(baseStarted(), baseDone))];
    pairs.forEach((pair, index) => {
        ["verifica", "riesame"].forEach((part) => {
            const data = pair[part];
            html.push(progressItem(
                `${part}:${pair.id}`, String(html.length + 1), `${part === "verifica" ? "Verifica" : "Riesame"} n°${index + 1}`,
                stateOf(pairPartStarted(pair.id, part, data), pairPartComplete(part, data)), !baseDone,
            ));
        });
    });
    const validationUnlocked = baseDone && allPairsComplete();
    validations.forEach((attempt, index) => {
        const signed = validationSigned(attempt);
        const complete = signed && attempt.superata === "si";
        const failed = signed && attempt.superata === "no";
        html.push(progressItem(
            `validation:${attempt.id}`, String(html.length + 1), `Validazione${index ? ` · Tentativo ${index + 1}` : ""}`,
            stateOf(validationStarted(attempt), complete), !validationUnlocked || (index > 0 && validations[index - 1]?.superata !== "no"),
            failed ? "Non superata" : "",
        ));
    });
    progressList.innerHTML = html.join("");
    progressList.querySelectorAll<HTMLElement>("[data-special-progress-target]").forEach((step) => {
        const navigate = () => scrollToTarget(step.dataset.specialProgressTarget || "");
        step.addEventListener("click", navigate);
        step.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault(); navigate();
        });
    });
}
function scrollToTarget(targetKey: string) {
    if (!specialForm) return;
    let target: HTMLElement | null = null;
    if (targetKey === "base") target = document.getElementById("specialBaseSection");
    else if (targetKey.startsWith("validation:")) target = document.getElementById(`special-validation-${targetKey.slice(11)}`);
    else {
        const [part, id] = targetKey.split(":");
        target = document.getElementById(`special-${part}-${id}`);
    }
    if (!target) return;
    const formRect = specialForm.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    specialForm.scrollTo({ top: specialForm.scrollTop + targetRect.top - formRect.top, behavior: "smooth" });
}
function read() {
    syncDynamicData();
    const values: any = {};
    Object.entries(specialFieldMap).forEach(([key, id]) => values[key] = textValue(id));
    return {
        ...values, previousCode: currentCode,
        nuovoProgetto: radioValue("specialNuovoProgetto"),
        supportoEsterno: radioValue("specialSupportoEsterno"),
        dfmeaPfmea: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="specialDfmeaPfmea"]:checked')).map((input) => input.value),
        coppieVerificaRiesame: pairs, validazioni: validations,
        attachments: currentAttachments,
        newAttachments: pendingAttachments.map((item) => ({
            fileName: item.originalName, dataBase64: item.dataBase64,
            mimeType: item.mimeType, size: item.size, scopeKey: item.scopeKey,
        })),
    };
}
function snapshot() {
    const payload = read();
    return JSON.stringify({ ...payload,
        attachments: currentAttachments.map((item) => [item.id, item.scopeKey]),
        newAttachments: pendingAttachments.map((item) => [item.originalName, item.size, item.scopeKey]),
    });
}
function markSaved() { savedSnapshot = snapshot(); }
function reset() {
    currentCode = ""; currentAttachments = []; pendingAttachments = [];
    Object.values(specialFieldMap).forEach((id) => setTextValue(id, ""));
    setRadio("specialNuovoProgetto", ""); setRadio("specialSupportoEsterno", "");
    document.querySelectorAll<HTMLInputElement>('input[name="specialDfmeaPfmea"]').forEach((input) => input.checked = false);
    pairs = [newPair()]; validations = [newValidation()];
    renderFileList(baseAttachmentsList, "base"); renderPairs(); renderValidations(); updateLocks(); renderProgress(); markSaved();
}
function populate(item: any) {
    currentCode = String(item?.code || item?.progettoNumero || "").trim();
    Object.entries(specialFieldMap).forEach(([key, id]) => setTextValue(id, item?.[key]));
    setRadio("specialNuovoProgetto", item?.nuovoProgetto); setRadio("specialSupportoEsterno", item?.supportoEsterno);
    const dfmea = new Set(Array.isArray(item?.dfmeaPfmea) ? item.dfmeaPfmea : []);
    document.querySelectorAll<HTMLInputElement>('input[name="specialDfmeaPfmea"]').forEach((input) => input.checked = dfmea.has(input.value));
    pairs = Array.isArray(item?.coppieVerificaRiesame) && item.coppieVerificaRiesame.length ? item.coppieVerificaRiesame : [newPair()];
    validations = Array.isArray(item?.validazioni) && item.validazioni.length ? item.validazioni : [newValidation()];
    currentAttachments = Array.isArray(item?.attachments) ? item.attachments : []; pendingAttachments = [];
    renderFileList(baseAttachmentsList, "base"); renderPairs(); renderValidations(); updateLocks(); renderProgress(); markSaved();
}

specialForm?.addEventListener("input", (event) => {
    if ((event.target as Element)?.closest?.(".special-validation")) return;
    updateLocks(); renderProgress();
});
specialForm?.addEventListener("change", (event) => {
    if ((event.target as Element)?.closest?.(".special-validation")) return;
    updateLocks(); renderProgress();
});
document.getElementById("specialAddAttachmentBtn")?.addEventListener("click", () => baseAttachmentInput?.click());
baseAttachmentInput?.addEventListener("change", async () => {
    await addFiles(Array.from(baseAttachmentInput.files || []), "base");
    baseAttachmentInput.value = ""; renderFileList(baseAttachmentsList, "base"); renderProgress();
});

(globalThis as any).specialProjectsForm = {
    reset,
    populate,
    read,
    markSaved,
    hasUnsavedChanges: () => snapshot() !== savedSnapshot,
    getCurrentCode: () => currentCode,
};

reset();
export {};
