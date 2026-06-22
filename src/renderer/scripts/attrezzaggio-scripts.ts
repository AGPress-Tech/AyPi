// @ts-nocheck
require("./shared/dev-guards");
const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const { createAsyncGuard } = require("./shared/async-guard");
const {
    resolveBackendRootUrl,
} = require("./shared/backend-client");

const REQUIRED_TOOL_FIELDS = ["nrUnita", "iso", "descrizione"];
const TOOL_ICON_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14];
const TOOL_ICON_TOOLTIPS = {
    1: "Utensile",
    2: "Attacco Base",
    3: "Adattatore",
    4: "Testa Multipla",
    5: "Pulegge",
    6: "Commutatore",
    7: "Arresto Positivo",
    8: "Sosta a Fine Corsa",
    9: "Riduzione Avanzamento 1 (non presente nella tabella)",
    10: "Regolatore Avanzamento 1",
    11: "Riduzione Avanzamento 2 (non presente nella tabella)",
    12: "Regolatore Avanzamento 2",
    13: "Posizione Cartesiana Unita",
    14: "Posizione Angolare Unita",
};
const ICON_DIR = path.join(__dirname, "..", "assets", "transfer-icons");
const PRINT_LOGO_PATH = path.join(
    __dirname,
    "..",
    "assets",
    "agpress-logo-generico.png",
);

let currentCode = null;
const iconDataByCol = {};
let printLogoData = "";
let formOrigin = "home";
let formReadOnly = false;

const homeView = document.getElementById("homeView");
const transferHomeView = document.getElementById("transferHomeView");
const haasHomeView = document.getElementById("haasHomeView");
const listView = document.getElementById("listView");
const haasListView = document.getElementById("haasListView");
const formView = document.getElementById("formView");
const haasFormView = document.getElementById("haasFormView");
const cardsList = document.getElementById("cardsList");
const haasCardsList = document.getElementById("haasCardsList");
const utensiliBody = document.getElementById("utensiliBody");
const haasBody = document.getElementById("haasBody");
const methodIdLabel = document.getElementById("methodIdLabel");
const listCount = document.getElementById("listCount");
const haasListCount = document.getElementById("haasListCount");
const filterCodiceArticolo = document.getElementById("filterCodiceArticolo");
const filterCodiceMacchina = document.getElementById("filterCodiceMacchina");
const filterText = document.getElementById("filterText");
const filterDescrizioneLavorazione = document.getElementById(
    "filterDescrizioneLavorazione",
);
const filterUtensile = document.getElementById("filterUtensile");
const haasFilterCodiceArticolo = document.getElementById("haasFilterCodiceArticolo");
const haasFilterMacchina = document.getElementById("haasFilterMacchina");
const haasFilterNumeroProgramma = document.getElementById("haasFilterNumeroProgramma");
const haasFilterText = document.getElementById("haasFilterText");
const attachmentsList = document.getElementById("attachmentsList");
const attachmentInput = document.getElementById("attachmentInput");
const haasAttachmentsList = document.getElementById("haasAttachmentsList");
const haasAttachmentInput = document.getElementById("haasAttachmentInput");
const imagePreviewOverlay = document.getElementById("imagePreviewOverlay");
const imagePreviewFull = document.getElementById("imagePreviewFull");

let allListItems = [];
let currentAttachments = [];
let pendingAttachments = [];
let currentHaasAttachments = [];
let pendingHaasAttachments = [];
let currentHaasCode = null;
let haasFormOrigin = "home";
let haasListItems = [];
const HAAS_ROW_FIELDS = [
    "t",
    "ciclo",
    "mandrinoCodice",
    "mandrinoRiduz",
    "mandrinoLunghezza",
    "codiceUtensile",
    "locazione",
    "sporgenzaUtensile",
    "diametroGambo",
];

const asyncGuard = createAsyncGuard({
    errorTitle: "Errore Schede Attrezzaggio Transfer.",
    promiseTitle: "Errore promessa non gestita (Schede Attrezzaggio Transfer).",
    report: (_message, detail) => {
        window.alert(detail || "Errore sconosciuto");
    },
});

asyncGuard.installGlobalHandlers();

function showView(name) {
    homeView.classList.toggle("hidden", name !== "home");
    transferHomeView?.classList.toggle("hidden", name !== "transfer-home");
    haasHomeView?.classList.toggle("hidden", name !== "haas-home");
    listView.classList.toggle("hidden", name !== "list");
    haasListView?.classList.toggle("hidden", name !== "haas-list");
    formView.classList.toggle("hidden", name !== "form");
    haasFormView?.classList.toggle("hidden", name !== "haas-form");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function setFormReadOnly(isReadOnly) {
    formReadOnly = !!isReadOnly;
    formView.classList.toggle("readonly-mode", formReadOnly);

    const editorSelectors = [
        "#codiceArticolo",
        "#fase",
        "#codiceMacchina",
        "#metodo",
        "#lavorazione",
        "#cicloLavorazione",
        "#spessori",
        "#vitiRondelle",
        "#spine",
        "#programmaRobot",
        "#mani",
        "#morsetti",
        "#note",
        "#utensiliBody input",
        "#utensiliBody textarea",
    ];
    editorSelectors.forEach((selector) => {
        formView.querySelectorAll(selector).forEach((el) => {
            (el as HTMLInputElement | HTMLTextAreaElement).readOnly =
                formReadOnly;
        });
    });

    const actionIds = ["addRowBtn", "saveFormBtn", "newFormBtn"];
    actionIds.forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = formReadOnly ? "none" : "";
    });

    formView
        .querySelectorAll("#utensiliBody td:last-child button")
        .forEach((btn) => {
            (btn as HTMLButtonElement).style.display = formReadOnly
                ? "none"
                : "";
        });
}

function getVal(id) {
    return (document.getElementById(id)?.value || "").trim();
}

function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value || "";
}

function getAttachmentUrl(storedName) {
    return `${resolveBackendRootUrl()}/api/transfer-attrezzaggio/attachments/${encodeURIComponent(storedName)}`;
}

function getHaasAttachmentUrl(storedName) {
    return `${resolveBackendRootUrl()}/api/haas-attrezzaggio/attachments/${encodeURIComponent(storedName)}`;
}

function escapeAttr(v) {
    return escapeHtml(v).replace(/"/g, "&quot;");
}

function openImagePreview(src, alt) {
    if (!imagePreviewOverlay || !imagePreviewFull) return;
    imagePreviewFull.src = src || "";
    imagePreviewFull.alt = alt || "Anteprima allegato";
    imagePreviewOverlay.classList.remove("hidden");
}

function closeImagePreview() {
    if (!imagePreviewOverlay || !imagePreviewFull) return;
    imagePreviewOverlay.classList.add("hidden");
    imagePreviewFull.src = "";
}

function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function renderAttachments() {
    if (!attachmentsList) return;
    attachmentsList.innerHTML = "";
    const items = [
        ...currentAttachments.map((item) => ({
            ...item,
            previewUrl: getAttachmentUrl(item.storedName),
            isPending: false,
        })),
        ...pendingAttachments.map((item) => ({
            ...item,
            previewUrl: item.previewUrl,
            isPending: true,
        })),
    ];
    if (!items.length) {
        attachmentsList.innerHTML =
            '<div class="attachment-name">Nessun allegato immagine.</div>';
        return;
    }
    items.forEach((item) => {
        const card = document.createElement("article");
        card.className = "attachment-card";

        const thumb = document.createElement("button");
        thumb.type = "button";
        thumb.className = "attachment-thumb";
        thumb.title = "Apri anteprima";
        thumb.innerHTML = `<img src="${escapeAttr(item.previewUrl)}" alt="${escapeAttr(item.originalName || "Immagine")}">`;
        thumb.addEventListener("click", () =>
            openImagePreview(item.previewUrl, item.originalName),
        );

        const name = document.createElement("div");
        name.className = "attachment-name";
        name.textContent = item.originalName || "Immagine";

        const actions = document.createElement("div");
        actions.className = "attachment-actions";

        const previewBtn = document.createElement("button");
        previewBtn.type = "button";
        previewBtn.textContent = "Anteprima";
        previewBtn.addEventListener("click", () =>
            openImagePreview(item.previewUrl, item.originalName),
        );

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "Rimuovi";
        removeBtn.className = "attachment-remove-btn";
        removeBtn.addEventListener("click", () => {
            if (item.isPending) {
                if (item.previewUrl) {
                    URL.revokeObjectURL(item.previewUrl);
                }
                pendingAttachments = pendingAttachments.filter(
                    (entry) => entry.tempId !== item.tempId,
                );
            } else {
                currentAttachments = currentAttachments.filter(
                    (entry) => entry.id !== item.id,
                );
            }
            renderAttachments();
        });

        actions.appendChild(previewBtn);
        actions.appendChild(removeBtn);
        card.appendChild(thumb);
        card.appendChild(name);
        card.appendChild(actions);
        attachmentsList.appendChild(card);
    });
}

function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function buildAttachmentPrintPages(card) {
    const attachments = Array.isArray(card.attachments) ? card.attachments : [];
    if (!attachments.length) return "";
    const pages = chunkArray(attachments, 4);
    const positions = ["top-left", "top-right", "bottom-left", "bottom-right"];
    return pages
        .map((pageItems) => {
            const slots = positions
                .map((position, index) => {
                    const item = pageItems[index];
                    if (!item) {
                        return `<div class="attachment-slot attachment-slot-${position}"></div>`;
                    }
                    const src = item.previewUrl || getAttachmentUrl(item.storedName);
                    return `
                        <div class="attachment-slot attachment-slot-${position}">
                            <img src="${escapeAttr(src)}" alt="${escapeAttr(item.originalName || "Immagine")}">
                            <div class="attachment-caption">${escapeHtml(item.originalName || "")}</div>
                        </div>
                    `;
                })
                .join("");
            return `<section class="attachments-print-page">${slots}</section>`;
        })
        .join("");
}

function renderHaasAttachments() {
    if (!haasAttachmentsList) return;
    haasAttachmentsList.innerHTML = "";
    const items = [
        ...currentHaasAttachments.map((item) => ({
            ...item,
            previewUrl: item.previewUrl || item.dataUrl || getHaasAttachmentUrl(item.storedName),
            isPending: false,
        })),
        ...pendingHaasAttachments.map((item) => ({
            ...item,
            previewUrl: item.previewUrl,
            isPending: true,
        })),
    ];
    if (!items.length) {
        haasAttachmentsList.innerHTML =
            '<div class="attachment-name">Nessun allegato immagine.</div>';
        return;
    }
    items.forEach((item) => {
        const card = document.createElement("article");
        card.className = "attachment-card";

        const thumb = document.createElement("button");
        thumb.type = "button";
        thumb.className = "attachment-thumb";
        thumb.title = "Apri anteprima";
        thumb.innerHTML = `<img src="${escapeAttr(item.previewUrl)}" alt="${escapeAttr(item.originalName || "Immagine")}">`;
        thumb.addEventListener("click", () =>
            openImagePreview(item.previewUrl, item.originalName),
        );

        const name = document.createElement("div");
        name.className = "attachment-name";
        name.textContent = item.originalName || "Immagine";

        const actions = document.createElement("div");
        actions.className = "attachment-actions";

        const previewBtn = document.createElement("button");
        previewBtn.type = "button";
        previewBtn.textContent = "Anteprima";
        previewBtn.addEventListener("click", () =>
            openImagePreview(item.previewUrl, item.originalName),
        );

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "Rimuovi";
        removeBtn.className = "attachment-remove-btn";
        removeBtn.addEventListener("click", () => {
            if (item.isPending) {
                if (item.previewUrl) {
                    URL.revokeObjectURL(item.previewUrl);
                }
                pendingHaasAttachments = pendingHaasAttachments.filter(
                    (entry) => entry.tempId !== item.tempId,
                );
            } else {
                currentHaasAttachments = currentHaasAttachments.filter(
                    (entry) => entry.id !== item.id,
                );
            }
            renderHaasAttachments();
        });

        actions.appendChild(previewBtn);
        actions.appendChild(removeBtn);
        card.appendChild(thumb);
        card.appendChild(name);
        card.appendChild(actions);
        haasAttachmentsList.appendChild(card);
    });
}

function buildHaasAttachmentPrintPages(card) {
    const attachments = Array.isArray(card.attachments) ? card.attachments : [];
    if (!attachments.length) return "";
    return attachments
        .map((item) => {
            const src = item.previewUrl || item.dataUrl || "";
            return `
                <section class="haas-attachment-print-page">
                    <div class="haas-attachment-print-frame">
                        <img src="${escapeAttr(src)}" alt="${escapeAttr(item.originalName || "Immagine")}">
                        <div class="haas-attachment-print-caption">${escapeHtml(item.originalName || "")}</div>
                    </div>
                </section>
            `;
        })
        .join("");
}

function updateCodeLabel() {
    const articolo = getVal("codiceArticolo");
    const fase = getVal("fase");
    const macchina = getVal("codiceMacchina");
    const metodo = getVal("metodo");
    const draft = `${articolo} - Fase: ${fase} - ${macchina} - ${metodo}`;
    methodIdLabel.textContent = `Codice: ${currentCode || draft}`;
}

function buildHaasCode(item) {
    const art = item?.codiceArticolo || "";
    const macchina = item?.macchina || "";
    const programma = item?.numeroProgramma || "";
    const metodo = item?.metodo || "";
    return [art, macchina, programma, metodo].filter(Boolean).join(" - ");
}

function escapeHtml(v) {
    return String(v || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildCodeHtml(item) {
    const art = item?.codiceArticolo || "";
    const fase = item?.fase || "";
    const mac = item?.codiceMacchina || "";
    const met = item?.metodo || "";
    if (art || fase || mac || met) {
        return `<strong>${escapeHtml(art)}</strong> - Fase: ${escapeHtml(fase)} - ${escapeHtml(mac)} - ${escapeHtml(met)}`;
    }
    return escapeHtml(item?.code || "");
}

function addRow(row = {}) {
    const tr = document.createElement("tr");
    ["nrUnita", "iso", "descrizione"].forEach((key) => {
        const td = document.createElement("td");
        if (key === "descrizione") {
            const input = document.createElement("textarea");
            input.dataset.key = key;
            input.rows = 1;
            input.value = row[key] || "";
            input.className = "cell-textarea";
            input.addEventListener("input", () => autoGrowTextarea(input));
            td.appendChild(input);
        } else {
            const input = document.createElement("input");
            input.type = "text";
            input.dataset.key = key;
            input.value = row[key] || "";
            td.appendChild(input);
        }
        tr.appendChild(td);
    });
    TOOL_ICON_COLUMNS.forEach((i) => {
        const td = document.createElement("td");
        const input = document.createElement("textarea");
        input.dataset.key = `col${i}`;
        input.rows = 1;
        input.value = row[`col${i}`] || "";
        input.className = "cell-textarea";
        input.addEventListener("input", () => autoGrowTextarea(input));
        td.appendChild(input);
        tr.appendChild(td);
    });
    const tdAction = document.createElement("td");
    const del = document.createElement("button");
    del.textContent = "Rimuovi";
    del.type = "button";
    del.addEventListener("click", () => tr.remove());
    if (formReadOnly) del.style.display = "none";
    tdAction.appendChild(del);
    tr.appendChild(tdAction);
    utensiliBody.appendChild(tr);
    requestAnimationFrame(() => {
        tr.querySelectorAll("textarea.cell-textarea").forEach((el) => {
            autoGrowTextarea(el as HTMLTextAreaElement);
        });
    });
}

function autoGrowTextarea(el) {
    el.style.height = "auto";
    const minHeight = el.closest("#haasTable") ? 18 : 28;
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
}

function refreshTableAutoGrow() {
    requestAnimationFrame(() => {
        utensiliBody
            .querySelectorAll("textarea.cell-textarea")
            .forEach((el) => {
                autoGrowTextarea(el as HTMLTextAreaElement);
            });
    });
}

function addHaasRow(row = {}) {
    if (!haasBody) return;
    const trTop = document.createElement("tr");
    const trBottom = document.createElement("tr");
    trTop.className = "haas-data-row haas-data-row-top";
    trBottom.className = "haas-data-row haas-data-row-bottom";

    [
        { key: "t", textarea: false },
        { key: "ciclo", textarea: true },
    ].forEach(({ key, textarea }) => {
        const td = document.createElement("td");
        td.rowSpan = 2;
        td.className = "haas-merged-cell";
        const wrap = document.createElement("div");
        wrap.className = "haas-merged-input-wrap";
        const input = textarea
            ? document.createElement("textarea")
            : document.createElement("input");
        if (input instanceof HTMLInputElement) {
            input.type = "text";
        } else {
            input.rows = 1;
            input.className = "cell-textarea";
            input.addEventListener("input", () => autoGrowTextarea(input));
        }
        input.dataset.key = key;
        input.value = row[key] || "";
        wrap.appendChild(input);
        td.appendChild(wrap);
        trTop.appendChild(td);
    });

    const mandrinoTopCell = document.createElement("td");
    mandrinoTopCell.colSpan = 2;
    const mandrinoTopWrap = document.createElement("div");
    mandrinoTopWrap.className = "haas-cell-input-wrap";
    const mandrinoTopInput = document.createElement("input");
    mandrinoTopInput.type = "text";
    mandrinoTopInput.dataset.key = "mandrinoCodice";
    mandrinoTopInput.value = row.mandrinoCodice || "";
    mandrinoTopWrap.appendChild(mandrinoTopInput);
    mandrinoTopCell.appendChild(mandrinoTopWrap);
    trTop.appendChild(mandrinoTopCell);

    const codiceUtensileCell = document.createElement("td");
    const codiceUtensileWrap = document.createElement("div");
    codiceUtensileWrap.className = "haas-cell-input-wrap";
    const codiceUtensileInput = document.createElement("textarea");
    codiceUtensileInput.rows = 1;
    codiceUtensileInput.className = "cell-textarea";
    codiceUtensileInput.dataset.key = "codiceUtensile";
    codiceUtensileInput.value = row.codiceUtensile || "";
    codiceUtensileInput.addEventListener("input", () =>
        autoGrowTextarea(codiceUtensileInput),
    );
    codiceUtensileWrap.appendChild(codiceUtensileInput);
    codiceUtensileCell.appendChild(codiceUtensileWrap);
    trTop.appendChild(codiceUtensileCell);

    [
        "sporgenzaUtensile",
        "diametroGambo",
    ].forEach((key) => {
        const td = document.createElement("td");
        td.rowSpan = 2;
        td.className = "haas-merged-cell";
        const wrap = document.createElement("div");
        wrap.className = "haas-merged-input-wrap";
        const input = document.createElement("input");
        input.type = "text";
        input.dataset.key = key;
        input.value = row[key] || "";
        wrap.appendChild(input);
        td.appendChild(wrap);
        trTop.appendChild(td);
    });

    const tdAction = document.createElement("td");
    tdAction.className = "haas-inline-action";
    tdAction.rowSpan = 2;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "haas-delete-btn";
    del.textContent = "🗑";
    del.title = "Rimuovi riga";
    del.setAttribute("aria-label", "Rimuovi riga");
    del.addEventListener("click", () => {
        trTop.remove();
        trBottom.remove();
    });
    tdAction.appendChild(del);
    trTop.appendChild(tdAction);

    [
        "mandrinoRiduz",
        "mandrinoLunghezza",
    ].forEach((key) => {
        const td = document.createElement("td");
        const wrap = document.createElement("div");
        wrap.className = "haas-cell-input-wrap";
        const input = document.createElement("input");
        input.type = "text";
        input.dataset.key = key;
        input.value = row[key] || "";
        wrap.appendChild(input);
        td.appendChild(wrap);
        trBottom.appendChild(td);
    });

    const locazioneCell = document.createElement("td");
    const locazioneWrap = document.createElement("div");
    locazioneWrap.className = "haas-cell-input-wrap";
    const locazioneInput = document.createElement("textarea");
    locazioneInput.rows = 1;
    locazioneInput.className = "cell-textarea";
    locazioneInput.dataset.key = "locazione";
    locazioneInput.value = row.locazione || "";
    locazioneInput.addEventListener("input", () =>
        autoGrowTextarea(locazioneInput),
    );
    locazioneWrap.appendChild(locazioneInput);
    locazioneCell.appendChild(locazioneWrap);
    trBottom.appendChild(locazioneCell);

    haasBody.appendChild(trTop);
    haasBody.appendChild(trBottom);

    requestAnimationFrame(() => {
        [trTop, trBottom].forEach((tr) => {
            tr.querySelectorAll("textarea").forEach((el) => {
            autoGrowTextarea(el as HTMLTextAreaElement);
            });
        });
    });
}

function resetHaasForm() {
    currentHaasCode = null;
    currentHaasAttachments = [];
    pendingHaasAttachments.forEach((item) => {
        if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    pendingHaasAttachments = [];
    [
        "haasCodiceArticolo",
        "haasDenominazioneArticolo",
        "haasNumeroProgramma",
        "haasMacchina",
        "haasCicloLavoro",
        "haasMetodo",
        "haasNote",
    ].forEach((id) => setVal(id, ""));
    if (haasBody) {
        haasBody.innerHTML = "";
    }
    addHaasRow();
    renderHaasAttachments();
}

function getHaasVal(id) {
    return (document.getElementById(id)?.value || "").trim();
}

function readHaasRows() {
    if (!haasBody) return [];
    const rows = [];
    const trList = Array.from(haasBody.querySelectorAll("tr"));
    for (let index = 0; index < trList.length; index += 2) {
        const row = {};
        [trList[index], trList[index + 1]].forEach((tr) => {
            if (!tr) return;
            tr.querySelectorAll("[data-key]").forEach((el) => {
                const input = el as HTMLInputElement | HTMLTextAreaElement;
                row[input.dataset.key] = (input.value || "").trim();
            });
        });
        if (Object.values(row).some(Boolean)) {
            rows.push(row);
        }
    }
    return rows;
}

function collectHaasFormData() {
    return {
        code: currentHaasCode || buildHaasCode({
            codiceArticolo: getHaasVal("haasCodiceArticolo"),
            macchina: getHaasVal("haasMacchina"),
            numeroProgramma: getHaasVal("haasNumeroProgramma"),
        }),
        codiceArticolo: getHaasVal("haasCodiceArticolo"),
        denominazioneArticolo: getHaasVal("haasDenominazioneArticolo"),
        numeroProgramma: getHaasVal("haasNumeroProgramma"),
        macchina: getHaasVal("haasMacchina"),
        metodo: getHaasVal("haasMetodo"),
        cicloLavoro: getHaasVal("haasCicloLavoro"),
        note: getHaasVal("haasNote"),
        attachments: [
            ...currentHaasAttachments.map((item) => ({
                ...item,
                previewUrl:
                    item.previewUrl || item.dataUrl || getHaasAttachmentUrl(item.storedName),
            })),
            ...pendingHaasAttachments.map((item) => ({
                id: item.tempId,
                originalName: item.originalName,
                previewUrl: item.previewUrl,
                dataUrl: `data:${item.mimeType};base64,${item.dataBase64}`,
                mimeType: item.mimeType,
                size: item.size,
            })),
        ],
        utensili: readHaasRows(),
    };
}

function loadHaasItemIntoForm(item) {
    currentHaasCode = item.code || null;
    setVal("haasCodiceArticolo", item.codiceArticolo || "");
    setVal("haasDenominazioneArticolo", item.denominazioneArticolo || "");
    setVal("haasNumeroProgramma", item.numeroProgramma || "");
    setVal("haasMacchina", item.macchina || "");
    setVal("haasMetodo", item.metodo || "");
    setVal("haasCicloLavoro", item.cicloLavoro || "");
    setVal("haasNote", item.note || "");
    currentHaasAttachments = Array.isArray(item.attachments)
        ? item.attachments
        : [];
    pendingHaasAttachments.forEach((entry) => {
        if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    });
    pendingHaasAttachments = [];
    if (haasBody) {
        haasBody.innerHTML = "";
    }
    (item.utensili || []).forEach(addHaasRow);
    if (!(item.utensili || []).length) {
        addHaasRow();
    }
    renderHaasAttachments();
}

async function loadHaasCardAndOpenForm(code) {
    const loaded = await ipcRenderer.invoke("haas-attrezzaggio-load", {
        code,
    });
    if (!loaded?.ok) {
        window.alert(loaded?.error || "Errore caricamento scheda HAAS");
        return false;
    }
    loadHaasItemIntoForm(loaded.item || {});
    return true;
}

async function loadHaasList() {
    const res = await ipcRenderer.invoke("haas-attrezzaggio-list");
    if (!res?.ok) {
        window.alert(res?.error || "Errore caricamento lista HAAS");
        return;
    }
    haasListItems = Array.isArray(res.items) ? res.items : [];
    renderHaasListFiltered();
}

function matchesHaasFilters(item) {
    const fArt = normalize(haasFilterCodiceArticolo?.value);
    const fMac = normalize(haasFilterMacchina?.value);
    const fProg = normalize(haasFilterNumeroProgramma?.value);
    const fText = normalize(haasFilterText?.value);

    const codiceArticolo = normalize(item?.codiceArticolo);
    const macchina = normalize(item?.macchina);
    const numeroProgramma = normalize(item?.numeroProgramma);
    const cicloLavoro = normalize(item?.cicloLavoro);
    const note = normalize(item?.note);
    const utensili = Array.isArray(item?.utensili)
        ? item.utensili
              .map((row) =>
                  [
                      row.ciclo,
                      row.mandrinoCodice,
                      row.codiceUtensile,
                      row.locazione,
                      row.sporgenzaUtensile,
                      row.diametroGambo,
                  ]
                      .filter(Boolean)
                      .join(" "),
              )
              .join(" | ")
        : "";

    if (fArt && !codiceArticolo.includes(fArt)) return false;
    if (fMac && !macchina.includes(fMac)) return false;
    if (fProg && !numeroProgramma.includes(fProg)) return false;
    if (
        fText &&
        !(
            cicloLavoro.includes(fText) ||
            note.includes(fText) ||
            normalize(utensili).includes(fText)
        )
    ) {
        return false;
    }
    return true;
}

function renderHaasListFiltered() {
    if (!haasCardsList) return;
    haasCardsList.innerHTML = "";
    const filtered = haasListItems.filter(matchesHaasFilters);
    if (haasListCount) {
        haasListCount.textContent = `${filtered.length} schede trovate su ${haasListItems.length}`;
    }

    filtered.forEach((item) => {
        const li = document.createElement("li");
        const details = document.createElement("div");
        details.className = "card-details";

        const code = document.createElement("span");
        code.className = "code";
        code.innerHTML = `<strong>${escapeHtml(item.codiceArticolo || "-")}</strong> - ${escapeHtml(item.macchina || "-")} - ${escapeHtml(item.numeroProgramma || "-")} - ${escapeHtml(item.metodo || "-")}`;
        code.title = "Apri scheda";
        code.addEventListener("click", asyncGuard.wrap(async () => {
            const ok = await loadHaasCardAndOpenForm(item.code);
            if (!ok) return;
            haasFormOrigin = "list";
            showView("haas-form");
        }));

        const meta = document.createElement("span");
        meta.className = "code-meta";
        meta.textContent = `Metodo: ${item.metodo || "-"} | Denominazione: ${item.denominazioneArticolo || "-"} | Ciclo: ${item.cicloLavoro || "-"} | Utensili: ${(item.utensili || []).length} | Allegati: ${(item.attachments || []).length} | Agg.: ${formatDateTs(item.updatedAt)}`;

        const tools = document.createElement("span");
        tools.className = "tools-meta";
        tools.textContent = (item.utensili || []).length
            ? (item.utensili || [])
                  .map(
                      (row) =>
                          `${row.ciclo || "-"} - ${row.codiceUtensile || row.locazione || "-"}`,
                  )
                  .join(" | ")
            : "Nessuna riga utensile";

        details.appendChild(code);
        details.appendChild(meta);
        details.appendChild(tools);

        const edit = document.createElement("button");
        edit.textContent = "Modifica";
        edit.addEventListener("click", asyncGuard.wrap(async () => {
            const ok = await loadHaasCardAndOpenForm(item.code);
            if (!ok) return;
            haasFormOrigin = "list";
            showView("haas-form");
        }));

        const print = document.createElement("button");
        print.textContent = "Stampa";
        print.addEventListener("click", asyncGuard.wrap(async () => {
            const ok = await loadHaasCardAndOpenForm(item.code);
            if (!ok) return;
            printHaasForm();
        }));

        const del = document.createElement("button");
        del.textContent = "Elimina";
        del.addEventListener("click", asyncGuard.wrap(async () => {
            const ok = window.confirm(`Eliminare la scheda ${item.code || buildHaasCode(item)}?`);
            if (!ok) return;
            const res = await ipcRenderer.invoke("haas-attrezzaggio-delete", {
                code: item.code,
            });
            if (!res?.ok) {
                window.alert(res?.error || "Errore eliminazione scheda HAAS");
                return;
            }
            await loadHaasList();
        }));

        li.appendChild(details);
        li.appendChild(edit);
        li.appendChild(print);
        li.appendChild(del);
        haasCardsList.appendChild(li);
    });
}

async function saveHaasForm() {
    const payload = collectHaasFormData();
    if (
        !payload.codiceArticolo ||
        !payload.numeroProgramma ||
        !payload.macchina
    ) {
        window.alert("Compila Codice Articolo, N° Programma e Macchina.");
        return;
    }
    if (!payload.utensili.length) {
        window.alert("Inserisci almeno una riga utensile.");
        return;
    }
    const nextCode = payload.code || buildHaasCode(payload);
    if (!nextCode) {
        window.alert("Impossibile generare il codice scheda.");
        return;
    }

    const res = await ipcRenderer.invoke("haas-attrezzaggio-save", {
        ...payload,
        previousCode: currentHaasCode,
    });
    if (!res?.ok) {
        window.alert(res?.error || "Errore salvataggio scheda HAAS");
        return;
    }
    currentHaasCode = res.code || nextCode;
    pendingHaasAttachments.forEach((item) => {
        if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    pendingHaasAttachments = [];
    currentHaasAttachments = Array.isArray(res.item?.attachments)
        ? res.item.attachments
        : [];
    renderHaasAttachments();
    await loadHaasList();
    window.alert(`Scheda HAAS salvata: ${currentHaasCode}`);
}

function printHaasForm() {
    const card = collectHaasFormData();
    const attachmentPages = buildHaasAttachmentPrintPages(card);
    const filledRows = readHaasRows()
        .map(
            (row) => `
                <tr>
                    <td rowspan="2">${escapeHtml(row.t)}</td>
                    <td rowspan="2">${escapeHtml(row.ciclo)}</td>
                    <td colspan="2">${escapeHtml(row.mandrinoCodice)}</td>
                    <td>${escapeHtml(row.codiceUtensile)}</td>
                    <td rowspan="2">${escapeHtml(row.sporgenzaUtensile)}</td>
                    <td rowspan="2">${escapeHtml(row.diametroGambo)}</td>
                </tr>
                <tr>
                    <td>${escapeHtml(row.mandrinoRiduz)}</td>
                    <td>${escapeHtml(row.mandrinoLunghezza)}</td>
                    <td>${escapeHtml(row.locazione)}</td>
                </tr>
            `,
        )
        .join("");
    const rows = filledRows;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
        <html>
        <head>
            <title>Scheda Attrezzaggio HAAS</title>
            <style>
                @page { size: A4 portrait; margin: 10mm; }
                html, body { margin: 0; padding: 0; background: #d9dde3; }
                body { font-family: Segoe UI, Tahoma, sans-serif; font-size: 11px; }
                .preview-shell { padding: 18px; }
                .toolbar { padding: 0 0 12px; width: 190mm; margin: 0 auto; }
                .toolbar button { padding: 6px 10px; border: 1px solid #777; background: #fff; cursor: pointer; }
                .sheet { width: 190mm; min-height: 277mm; margin: 0 auto; background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,0.12); padding: 0; box-sizing: border-box; display: flex; flex-direction: column; }
                .top-frame { border: 1px solid #222; }
                .header { display:grid; grid-template-columns: 1.1fr 2.1fr 1.1fr; border: 0; border-bottom: 1px solid #222; }
                .header > div { min-height: 44px; display:flex; align-items:center; justify-content:center; font-weight:700; text-align:center; }
                .header > div { border-right: 1px solid #222; }
                .header > div:first-child { color: #d0911c; }
                .header > div:last-child { border-right: 0; color: #4f5e70; font-size: 11px; padding: 0 8px; }
                .header-logo img { max-width: 160px; max-height: 34px; object-fit: contain; }
                .meta { display:grid; grid-template-columns: 1.1fr 1.4fr 1.1fr 2fr; border:0; }
                .meta > div { min-height: 28px; border-right:1px solid #222; border-bottom:1px solid #222; display:flex; align-items:center; box-sizing:border-box; }
                .meta > div:nth-child(4n) { border-right:0; }
                .meta > div:nth-last-child(-n + 2) { border-bottom: 0; }
                .label { padding: 4px 6px; font-weight:700; background:#fafafa; }
                .value { padding: 4px 6px; }
                .span-3 { grid-column: span 1; }
                .span-5 { grid-column: span 3; border-right:0 !important; }
                .table-frame { border:1px solid #222; overflow:hidden; }
                table { width:100%; border-collapse:collapse; table-layout:fixed; border:0; }
                th, td { border:1px solid #222; padding:2px 3px; text-align:center; vertical-align:middle; font-size:10px; line-height:1.08; }
                thead tr:first-child th { border-top:0; }
                tbody tr:last-child td { border-bottom:0; }
                table tr th:first-child, table tr td:first-child { border-left:0; }
                table tr th:last-child, table tr td:last-child { border-right:0; }
                th { font-weight: 700; }
                thead th { font-weight: 700; }
                tbody tr { height: 5.2mm; }
                .notes { margin-top: 14px; border:1px solid #222; }
                .notes-title { border-bottom:1px solid #222; text-align:center; font-weight:700; padding:4px 8px; }
                .notes-body { min-height: 32mm; padding:8px; white-space:pre-wrap; }
                .haas-attachment-print-page { page-break-before: always; width: 190mm; min-height: 277mm; margin: 0 auto; background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,0.12); padding: 0; box-sizing: border-box; display:flex; align-items:center; justify-content:center; }
                .haas-attachment-print-frame { width: 100%; height: 277mm; border: 1px solid #222; display:flex; flex-direction:column; background:#fff; box-sizing: border-box; }
                .haas-attachment-print-frame img { width: 100%; height: calc(100% - 14mm); object-fit: contain; object-position: center; display:block; background:#fff; }
                .haas-attachment-print-caption { min-height: 14mm; padding: 4mm 3mm; text-align:center; font-size: 11px; line-height: 1.2; word-break: break-word; border-top: 1px solid #222; box-sizing: border-box; }
                @media print {
                    html, body { background: #fff; }
                    .preview-shell { padding: 0; }
                    .toolbar { display:none; }
                    .sheet { width: 189mm; min-height: 0; margin: 0 auto; box-shadow: none; padding: 0; }
                    .haas-attachment-print-page { width: 189mm; min-height: 0; margin: 0 auto; box-shadow: none; padding: 0; page-break-before: always; }
                    .haas-attachment-print-frame { height: 276mm; }
                }
            </style>
        </head>
        <body>
            <div class="preview-shell">
                <div class="toolbar"><button onclick="window.print()">Stampa</button></div>
                <div class="sheet">
                    <div class="top-frame">
                        <div class="header">
                            <div class="header-logo">${printLogoData ? `<img src="${printLogoData}" alt="A.G.PRESS">` : "A.G.PRESS"}</div>
                            <div><div>METODO DI ATTREZZAGGIO<br>CENTRI DI LAVORO</div></div>
                            <div>Metodo: ${escapeHtml(getHaasVal("haasMetodo") || "-")}</div>
                        </div>
                        <div class="meta">
                            <div class="label">CODICE ART.</div>
                            <div class="value">${escapeHtml(getHaasVal("haasCodiceArticolo"))}</div>
                            <div class="label">DENOMINAZIONE ART.</div>
                            <div class="value">${escapeHtml(getHaasVal("haasDenominazioneArticolo"))}</div>
                            <div class="label">N° PROGRAMMA</div>
                            <div class="value">${escapeHtml(getHaasVal("haasNumeroProgramma"))}</div>
                            <div class="label">MACCHINA</div>
                            <div class="value">${escapeHtml(getHaasVal("haasMacchina"))}</div>
                            <div class="label span-3">CICLO DI LAVORO</div>
                            <div class="value span-5">${escapeHtml(getHaasVal("haasCicloLavoro"))}</div>
                        </div>
                    </div>
                    <div class="table-frame">
                        <table>
                            <thead>
                                <tr>
                                    <th rowspan="2" style="width:4%;"><div style="font-size:18px;line-height:1.1;">T</div></th>
                                    <th rowspan="2" style="width:28%;">CICLO DI LAVORAZIONE</th>
                                    <th colspan="2" style="width:16%;">TIPO MANDRINO<br>(CODICE)</th>
                                    <th style="width:28%;">CODICE UTENSILE</th>
                                    <th rowspan="2" style="width:13%;">SPORGENZA UTENSILE</th>
                                    <th rowspan="2" style="width:8%;">Ø GAMBO</th>
                                </tr>
                                <tr>
                                    <th style="width:8%;">ER WELDON</th>
                                    <th style="width:8%;">LUN.</th>
                                    <th style="width:28%; font-weight:700;">LOCAZIONE</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                    <div class="notes">
                        <div class="notes-title">NOTE ATTREZZAGGIO</div>
                        <div class="notes-body">${escapeHtml(getHaasVal("haasNote"))}</div>
                    </div>
                </div>
                ${attachmentPages}
            </div>
        </body>
        </html>
    `);
    win.document.close();
}

function readRows() {
    return Array.from(utensiliBody.querySelectorAll("tr"))
        .map((tr) => {
            const data = {};
            tr.querySelectorAll("[data-key]").forEach((el) => {
                const input = el as HTMLInputElement | HTMLTextAreaElement;
                data[input.dataset.key] = (input.value || "").trim();
            });
            return data;
        })
        .filter((r) => Object.values(r).some(Boolean));
}

function resetForm() {
    currentCode = null;
    currentAttachments = [];
    pendingAttachments.forEach((item) => {
        if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    pendingAttachments = [];
    [
        "codiceArticolo",
        "fase",
        "codiceMacchina",
        "metodo",
        "lavorazione",
        "cicloLavorazione",
        "spessori",
        "vitiRondelle",
        "spine",
        "programmaRobot",
        "mani",
        "morsetti",
        "note",
    ].forEach((id) => setVal(id, ""));
    utensiliBody.innerHTML = "";
    addRow();
    renderAttachments();
    updateCodeLabel();
    setFormReadOnly(false);
}

function applyHeaderIcons() {
    TOOL_ICON_COLUMNS.forEach((i) => {
        const img = document.querySelector(`img[data-col-icon=\"${i}\"]`);
        if (!img) return;
        if (iconDataByCol[i]) img.src = iconDataByCol[i];
        const tip = TOOL_ICON_TOOLTIPS[i] || `Colonna ${i}`;
        img.title = tip;
        img.setAttribute("aria-label", tip);
    });
}

function loadHeaderIcons() {
    TOOL_ICON_COLUMNS.forEach((i) => {
        const p = path.join(ICON_DIR, `${i}.png`);
        if (fs.existsSync(p)) {
            const b64 = fs.readFileSync(p).toString("base64");
            iconDataByCol[i] = `data:image/png;base64,${b64}`;
        }
    });
    applyHeaderIcons();
}

function loadPrintLogo() {
    if (!fs.existsSync(PRINT_LOGO_PATH)) return;
    const b64 = fs.readFileSync(PRINT_LOGO_PATH).toString("base64");
    printLogoData = `data:image/png;base64,${b64}`;
    const haasLogo = document.getElementById("haasPrintLogo");
    if (haasLogo) {
        haasLogo.src = printLogoData;
    }
}

function printCard(card) {
    const metodo = card.metodo || card.metodoVariante || "";
    const attachmentPages = buildAttachmentPrintPages(card);
    const cols = TOOL_ICON_COLUMNS.slice();
    const headerIcons = cols.map((idx) =>
        iconDataByCol[idx]
            ? `<img src=\"${iconDataByCol[idx]}\" style=\"width:34px;height:34px;object-fit:contain;\">`
            : `${idx}`,
    );
    const rows = (card.utensili || [])
        .map((r) => {
            const base = [r.nrUnita || "", r.iso || "", r.descrizione || ""];
            const opz = cols.map((c) => r[`col${c}`] || "");
            return `<tr>${[...base, ...opz].map((v) => `<td>${String(v || "")}</td>`).join("")}</tr>`;
        })
        .join("");

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
        <html><head><title>${card.code}</title>
        <style>
            @page { size: A3 landscape; margin: 10mm; }
            body { font-family: Segoe UI, Tahoma, sans-serif; font-size: 12px; }
            .preview-toolbar { position: sticky; top: 0; z-index: 10; background: #fff; border-bottom: 1px solid #ccc; padding: 8px; margin: -8px -8px 10px -8px; }
            .preview-toolbar button { padding: 6px 10px; border: 1px solid #888; background: #fff; cursor: pointer; }
            .head { display:flex; align-items:flex-start; gap:12px; margin-bottom:8px; }
            .head img { width: 220px; max-height: 60px; object-fit: contain; object-position: left top; }
            .head h3 { margin: 0; font-size: 24px; line-height: 1.1; }
            .head .code-line { font-size: 18px; line-height: 1.15; }
            .meta { display:grid; gap:6px; margin-bottom:8px; }
            .meta.meta-primary { grid-template-columns: repeat(5,1fr); }
            .meta.meta-detail-top { grid-template-columns: repeat(4,1fr); }
            .meta.meta-detail-bottom { grid-template-columns: repeat(3,1fr); }
            .meta.meta-single { grid-template-columns: 1fr; }
            .meta div { border:1px solid #333; padding:6px; min-height:30px; font-size: 16px; line-height: 1.25; }
            .meta div strong { font-size: 18px; }
            table { width:100%; border-collapse:collapse; table-layout:fixed; }
            th,td { border:1px solid #333; padding:4px; text-align:center; vertical-align:middle; font-size: 14px; }
            th { background:#ffffff; }
            td:nth-child(3), th:nth-child(3) { text-align:left; }
            .desc { width:18%; }
            .attachments-print-page { page-break-before: always; height: 257mm; display:grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 0; align-items: stretch; }
            .attachment-slot { border: 1px solid #333; padding: 0; display:flex; flex-direction:column; justify-content:space-between; overflow:hidden; min-height: 0; }
            .attachment-slot img { width: 100%; height: calc(100% - 8mm); object-fit: contain; object-position: center; display:block; background: #fff; }
            .attachment-slot-top-left { grid-column: 1; grid-row: 1; }
            .attachment-slot-top-right { grid-column: 2; grid-row: 1; }
            .attachment-slot-bottom-left { grid-column: 1; grid-row: 2; }
            .attachment-slot-bottom-right { grid-column: 2; grid-row: 2; }
            .attachment-caption { margin: 0; padding: 2mm 3mm; font-size: 11px; line-height: 1.2; text-align: center; word-break: break-word; }
            @media print { .preview-toolbar { display:none; } }
        </style></head><body>
        <div class="preview-toolbar">
          <button onclick="window.print()">Stampa</button>
        </div>
        <div class="head">
          ${printLogoData ? `<img src="${printLogoData}" alt="A.G.PRESS">` : ""}
          <div>
            <h3>METODO DI ATTREZZAGGIO TRANSFER</h3>
            <div class="code-line"><strong>Codice:</strong> ${card.code}</div>
          </div>
        </div>
        <div class="meta meta-primary">
          <div><strong>Codice Articolo</strong><br>${card.codiceArticolo || ""}</div>
          <div><strong>Fase</strong><br>${card.fase || ""}</div>
          <div><strong>Codice Macchina</strong><br>${card.codiceMacchina || ""}</div>
          <div><strong>Ciclo (s)</strong><br>${card.cicloLavorazione || ""}</div>
          <div><strong>Metodo</strong><br>${metodo}</div>
        </div>
        <div class="meta meta-detail-top">
          <div><strong>Morsetti</strong><br>${card.morsetti || ""}</div>
          <div><strong>Spessori</strong><br>${card.spessori || ""}</div>
          <div><strong>Viti/Rondelle</strong><br>${card.vitiRondelle || ""}</div>
          <div><strong>Spine</strong><br>${card.spine || ""}</div>
        </div>
        <div class="meta meta-detail-bottom">
          <div><strong>Programma Robot</strong><br>${card.programmaRobot || ""}</div>
          <div><strong>Mani</strong><br>${card.mani || ""}</div>
          <div><strong>Lavorazione</strong><br>${card.lavorazione || ""}</div>
        </div>
        <div class="meta meta-single">
          <div><strong>Note</strong><br>${card.note || ""}</div>
        </div>
        <table>
            <thead><tr><th>Nr Unita</th><th>ISO</th><th class="desc">Descrizione Lavorazione</th>${headerIcons.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
            <tbody>${rows}</tbody>
        </table>
        ${attachmentPages}
        </body></html>
    `);
    win.document.close();
}

async function loadCardAndOpenForm(code, options = { readOnly: false }) {
    const loaded = await ipcRenderer.invoke("transfer-attrezzaggio-load", {
        code,
    });
    if (!loaded?.ok) {
        window.alert(loaded?.error || "Errore caricamento scheda");
        return;
    }
    const card = loaded.item;
    currentCode = card.code;
    setVal("codiceArticolo", card.codiceArticolo);
    setVal("fase", card.fase);
    setVal("codiceMacchina", card.codiceMacchina);
    setVal("metodo", card.metodo || card.metodoVariante);
    setVal("lavorazione", card.lavorazione);
    setVal("cicloLavorazione", card.cicloLavorazione);
    setVal("spessori", card.spessori);
    setVal("vitiRondelle", card.vitiRondelle);
    setVal("spine", card.spine);
    setVal("programmaRobot", card.programmaRobot);
    setVal("mani", card.mani);
    setVal("morsetti", card.morsetti);
    setVal("note", card.note);
    currentAttachments = Array.isArray(card.attachments) ? card.attachments : [];
    pendingAttachments = [];
    renderAttachments();
    utensiliBody.innerHTML = "";
    (card.utensili || []).forEach(addRow);
    if (!(card.utensili || []).length) addRow();
    refreshTableAutoGrow();
    updateCodeLabel();
    formOrigin = "list";
    setFormReadOnly(!!options?.readOnly);
    showView("form");
}

async function loadList() {
    const res = await ipcRenderer.invoke("transfer-attrezzaggio-list");
    if (!res?.ok) {
        window.alert(res?.error || "Errore caricamento lista");
        return;
    }
    allListItems = Array.isArray(res.items) ? res.items : [];
    renderListFiltered();
}

function normalize(v) {
    return String(v || "")
        .toLowerCase()
        .trim();
}

function formatDateTs(ms) {
    const n = Number(ms || 0);
    if (!n) return "-";
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString("it-IT");
}

function matchesFilters(item) {
    const fArt = normalize(filterCodiceArticolo?.value);
    const fMac = normalize(filterCodiceMacchina?.value);
    const fText = normalize(filterText?.value);
    const fDescLav = normalize(filterDescrizioneLavorazione?.value);
    const fUte = normalize(filterUtensile?.value);

    const codiceArticolo = normalize(item?.codiceArticolo);
    const codiceMacchina = normalize(item?.codiceMacchina);
    const lavorazione = normalize(item?.lavorazione);
    const note = normalize(item?.note);
    const descrLavorazioni = Array.isArray(item?.utensiliDescrizioni)
        ? item.utensiliDescrizioni.map(normalize).join(" | ")
        : "";
    const utensili = Array.isArray(item?.utensiliCol1)
        ? item.utensiliCol1.map(normalize).join(" | ")
        : "";

    if (fArt && !codiceArticolo.includes(fArt)) return false;
    if (fMac && !codiceMacchina.includes(fMac)) return false;
    if (fText && !(lavorazione.includes(fText) || note.includes(fText)))
        return false;
    if (fDescLav && !descrLavorazioni.includes(fDescLav)) return false;
    if (fUte && !utensili.includes(fUte)) return false;
    return true;
}

function renderListFiltered() {
    cardsList.innerHTML = "";
    const filtered = allListItems.filter(matchesFilters);
    if (listCount)
        listCount.textContent = `${filtered.length} schede trovate su ${allListItems.length}`;

    filtered.forEach((item) => {
        const li = document.createElement("li");
        const details = document.createElement("div");
        details.className = "card-details";
        const code = document.createElement("span");
        code.className = "code";
        code.innerHTML = buildCodeHtml(item);
        code.addEventListener("click", () =>
            loadCardAndOpenForm(item.code, { readOnly: true }),
        );
        code.title = "Apri scheda in sola visualizzazione";
        const meta = document.createElement("span");
        meta.className = "code-meta";
        meta.textContent = `Articolo: ${item.codiceArticolo || "-"} | Fase: ${item.fase || "-"} | Macchina: ${item.codiceMacchina || "-"} | Metodo: ${item.metodo || "-"} | Lavorazione: ${item.lavorazione || "-"} | Ciclo(s): ${item.cicloLavorazione || "-"} | Utensili: ${item.utensiliCount || 0} | Allegati: ${item.attachmentsCount || 0} | Agg.: ${formatDateTs(item.updatedAt)}`;
        const tools = document.createElement("span");
        tools.className = "tools-meta";
        const descList = Array.isArray(item.utensiliDescrizioni)
            ? item.utensiliDescrizioni.filter(Boolean)
            : [];
        const toolList = Array.isArray(item.utensiliCol1)
            ? item.utensiliCol1.filter(Boolean)
            : [];
        const maxLen = Math.max(descList.length, toolList.length);
        const pairs = [];
        for (let i = 0; i < maxLen; i += 1) {
            const desc = descList[i] || "-";
            const tool = toolList[i] || "-";
            pairs.push(`${desc} - ${tool}`);
        }
        tools.textContent = pairs.length
            ? `Descrizione lavorazione - Utensile: ${pairs.join(" | ")}`
            : "Descrizione lavorazione - Utensile: -";
        details.appendChild(code);
        details.appendChild(meta);
        details.appendChild(tools);
        const edit = document.createElement("button");
        edit.textContent = "Modifica";
        edit.addEventListener("click", () =>
            loadCardAndOpenForm(item.code, { readOnly: false }),
        );
        const print = document.createElement("button");
        print.textContent = "Stampa";
        print.addEventListener(
            "click",
            asyncGuard.wrap(async () => {
            const loaded = await ipcRenderer.invoke(
                "transfer-attrezzaggio-load",
                { code: item.code },
            );
            if (!loaded?.ok) return;
            printCard(loaded.item);
            }),
        );
        const del = document.createElement("button");
        del.textContent = "Elimina";
        del.addEventListener(
            "click",
            asyncGuard.wrap(async () => {
            const ok = window.confirm(`Eliminare la scheda ${item.code}?`);
            if (!ok) return;
            let resDel;
            try {
                resDel = await ipcRenderer.invoke(
                    "transfer-attrezzaggio-delete",
                    { code: item.code },
                );
            } catch (err) {
                window.alert(
                    "Funzione elimina non disponibile nella sessione corrente. Riavvia AyPi e riprova.",
                );
                return;
            }
            if (!resDel?.ok) {
                window.alert(resDel?.error || "Errore eliminazione scheda");
                return;
            }
            await loadList();
            }),
        );
        li.appendChild(details);
        li.appendChild(edit);
        li.appendChild(print);
        li.appendChild(del);
        cardsList.appendChild(li);
    });
}

async function saveForm() {
    const payload = {
        code: currentCode,
        previousCode: currentCode,
        codiceArticolo: getVal("codiceArticolo"),
        fase: getVal("fase"),
        codiceMacchina: getVal("codiceMacchina"),
        metodo: getVal("metodo"),
        metodoVariante: getVal("metodo"),
        lavorazione: getVal("lavorazione"),
        cicloLavorazione: getVal("cicloLavorazione"),
        spessori: getVal("spessori"),
        vitiRondelle: getVal("vitiRondelle"),
        spine: getVal("spine"),
        programmaRobot: getVal("programmaRobot"),
        mani: getVal("mani"),
        morsetti: getVal("morsetti"),
        note: getVal("note"),
        attachments: currentAttachments,
        newAttachments: pendingAttachments.map((item) => ({
            fileName: item.originalName,
            dataBase64: item.dataBase64,
            mimeType: item.mimeType,
            size: item.size,
        })),
        utensili: readRows(),
    };

    if (
        !payload.codiceArticolo ||
        !payload.fase ||
        !payload.codiceMacchina ||
        !payload.metodo
    ) {
        window.alert(
            "Compila Codice Articolo, Fase, Codice Macchina e Metodo/Variante.",
        );
        return;
    }
    if (!payload.utensili.length) {
        window.alert("Inserisci almeno una riga utensile.");
        return;
    }
    const invalid = payload.utensili.find((r) =>
        REQUIRED_TOOL_FIELDS.some((f) => !r[f]),
    );
    if (invalid) {
        window.alert(
            "Ogni riga utensile deve avere Nr Unita, ISO e Descrizione.",
        );
        return;
    }

    const res = await ipcRenderer.invoke("transfer-attrezzaggio-save", payload);
    if (!res?.ok) {
        window.alert(res?.error || "Errore salvataggio");
        return;
    }
    currentCode = res.code;
    if (payload.code !== res.code) {
        currentAttachments = [];
    }
    pendingAttachments = [];
    if (res.item?.attachments) {
        currentAttachments = res.item.attachments;
    }
    renderAttachments();
    updateCodeLabel();
    window.alert(`Scheda salvata: ${res.code}`);
}

document
    .getElementById("openTransferTypeBtn")
    ?.addEventListener("click", () => showView("transfer-home"));
document
    .getElementById("openHaasTypeBtn")
    ?.addEventListener("click", () => showView("haas-home"));
document
    .getElementById("showHaasListBtn")
    ?.addEventListener("click", asyncGuard.wrap(async () => {
        showView("haas-list");
        await loadHaasList();
    }));
document
    .getElementById("showCreateHaasBtn")
    ?.addEventListener("click", () => {
        resetHaasForm();
        haasFormOrigin = "home";
        showView("haas-form");
    });
document
    .getElementById("showListBtn")
    ?.addEventListener(
        "click",
        asyncGuard.wrap(async () => {
            showView("list");
            await loadList();
        }),
    );
document.getElementById("showCreateBtn")?.addEventListener("click", () => {
    resetForm();
    formOrigin = "home";
    setFormReadOnly(false);
    showView("form");
});
document
    .getElementById("closeWindowBtn")
    ?.addEventListener("click", () => window.close());
document
    .getElementById("backToTypesBtn")
    ?.addEventListener("click", () => showView("home"));
document
    .getElementById("backFromHaasHomeBtn")
    ?.addEventListener("click", () => showView("home"));
document
    .getElementById("backFromHaasBtn")
    ?.addEventListener("click", asyncGuard.wrap(async () => {
        if (haasFormOrigin === "list") {
            showView("haas-list");
            await loadHaasList();
            return;
        }
        showView("haas-home");
    }));
document
    .getElementById("backFromListBtn")
    ?.addEventListener("click", () => showView("transfer-home"));
document
    .getElementById("backFromHaasListBtn")
    ?.addEventListener("click", () => showView("haas-home"));
document
    .getElementById("newHaasFormBtn")
    ?.addEventListener("click", resetHaasForm);
document
    .getElementById("saveHaasFormBtn")
    ?.addEventListener("click", asyncGuard.wrap(saveHaasForm));
document.getElementById("addHaasAttachmentBtn")?.addEventListener("click", () => {
    haasAttachmentInput?.click();
});
document
    .getElementById("addHaasRowBtn")
    ?.addEventListener("click", () => addHaasRow());
document
    .getElementById("printHaasFormBtn")
    ?.addEventListener("click", printHaasForm);
document
    .getElementById("refreshHaasListBtn")
    ?.addEventListener("click", asyncGuard.wrap(loadHaasList));
document.getElementById("refreshListBtn")?.addEventListener("click", loadList);
document.getElementById("clearHaasFiltersBtn")?.addEventListener("click", () => {
    [
        haasFilterCodiceArticolo,
        haasFilterMacchina,
        haasFilterNumeroProgramma,
        haasFilterText,
    ].forEach((el) => {
        if (el) el.value = "";
    });
    renderHaasListFiltered();
});
document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
    [
        filterCodiceArticolo,
        filterCodiceMacchina,
        filterText,
        filterDescrizioneLavorazione,
        filterUtensile,
    ].forEach((el) => {
        if (el) el.value = "";
    });
    renderListFiltered();
});
document
    .getElementById("backFromFormBtn")
    ?.addEventListener(
        "click",
        asyncGuard.wrap(async () => {
            if (formOrigin === "list") {
                showView("list");
                if (!allListItems.length) await loadList();
                else renderListFiltered();
                return;
            }
            showView("transfer-home");
        }),
    );
document.getElementById("newFormBtn")?.addEventListener("click", resetForm);
document
    .getElementById("saveFormBtn")
    ?.addEventListener("click", asyncGuard.wrap(saveForm));
document.getElementById("addAttachmentBtn")?.addEventListener("click", () => {
    attachmentInput?.click();
});
attachmentInput?.addEventListener(
    "change",
    asyncGuard.wrap(async (event) => {
        const files = Array.from(event?.target?.files || []);
        if (!files.length) return;
        const imageFiles = files.filter((file) =>
            String(file.type || "").startsWith("image/"),
        );
        const nextItems = await Promise.all(
            imageFiles.map(async (file) => {
                const buffer = await file.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                return {
                    tempId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    originalName: file.name,
                    previewUrl: URL.createObjectURL(file),
                    dataBase64: bytesToBase64(bytes),
                    mimeType: file.type || "image/png",
                    size: Number(file.size || 0) || 0,
                };
            }),
        );
        pendingAttachments = [...pendingAttachments, ...nextItems];
        attachmentInput.value = "";
        renderAttachments();
    }),
);
haasAttachmentInput?.addEventListener(
    "change",
    asyncGuard.wrap(async (event) => {
        const files = Array.from(event?.target?.files || []);
        if (!files.length) return;
        const imageFiles = files.filter((file) =>
            String(file.type || "").startsWith("image/"),
        );
        const nextItems = await Promise.all(
            imageFiles.map(async (file) => {
                const buffer = await file.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                return {
                    tempId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    originalName: file.name,
                    previewUrl: URL.createObjectURL(file),
                    dataBase64: bytesToBase64(bytes),
                    mimeType: file.type || "image/png",
                    size: Number(file.size || 0) || 0,
                };
            }),
        );
        pendingHaasAttachments = [...pendingHaasAttachments, ...nextItems];
        haasAttachmentInput.value = "";
        renderHaasAttachments();
    }),
);
document.getElementById("printFormBtn")?.addEventListener("click", () => {
    const card = {
        code:
            currentCode ||
            `${getVal("codiceArticolo")} - Fase: ${getVal("fase")} - ${getVal("codiceMacchina")} - ${getVal("metodo")}`,
        codiceArticolo: getVal("codiceArticolo"),
        fase: getVal("fase"),
        codiceMacchina: getVal("codiceMacchina"),
        metodo: getVal("metodo"),
        metodoVariante: getVal("metodo"),
        lavorazione: getVal("lavorazione"),
        cicloLavorazione: getVal("cicloLavorazione"),
        spessori: getVal("spessori"),
        vitiRondelle: getVal("vitiRondelle"),
        spine: getVal("spine"),
        programmaRobot: getVal("programmaRobot"),
        mani: getVal("mani"),
        morsetti: getVal("morsetti"),
        note: getVal("note"),
        attachments: [
            ...currentAttachments,
            ...pendingAttachments.map((item) => ({
                id: item.tempId,
                originalName: item.originalName,
                storedName: "",
                previewUrl: item.previewUrl,
                mimeType: item.mimeType,
                size: item.size,
            })),
        ],
        utensili: readRows(),
    };
    printCard(card);
});
document
    .getElementById("closeImagePreviewBtn")
    ?.addEventListener("click", closeImagePreview);
imagePreviewOverlay?.addEventListener("click", (event) => {
    if (event.target === imagePreviewOverlay) closeImagePreview();
});
document.getElementById("addRowBtn")?.addEventListener("click", () => addRow());
["codiceArticolo", "fase", "codiceMacchina", "metodo"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateCodeLabel);
});
[
    filterCodiceArticolo,
    filterCodiceMacchina,
    filterText,
    filterDescrizioneLavorazione,
    filterUtensile,
].forEach((el) => {
    el?.addEventListener("input", renderListFiltered);
});
[
    haasFilterCodiceArticolo,
    haasFilterMacchina,
    haasFilterNumeroProgramma,
    haasFilterText,
].forEach((el) => {
    el?.addEventListener("input", renderHaasListFiltered);
});

loadHeaderIcons();
loadPrintLogo();
resetForm();
resetHaasForm();
showView("home");
