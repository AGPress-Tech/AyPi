const { ipcRenderer, shell } = require("electron");
const fs = require("fs");

const { showInfo, showWarning, showError, showDialog } = require("../shared/dialogs");
const { NETWORK_PATHS } = require("../../config/paths");
const { createModalHelpers } = require("./ferie-permessi/ui/modals");
const { createAssigneesModal } = require("./ferie-permessi/ui/assignees-modal");
const { createAdminModals } = require("./ferie-permessi/ui/admin-modals");
const { UI_TEXTS } = require("./ferie-permessi/utils/ui-texts");
const { isHashingAvailable, hashPassword } = require("./ferie-permessi/config/security");
const { REQUESTS_PATH, SESSION_PATH } = require("./product-manager/config/paths");
const {
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword,
    isValidEmail,
    isValidPhone,
} = require("./ferie-permessi/services/admins");

window.pmLoaded = true;

const ASSIGNEES_FALLBACK = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-assignees.json";
const SESSION_KEY = "pm-session";

let session = { role: "guest", adminName: "", department: "", employee: "" };
let assigneeGroups = {};
let assigneeOptions = [];
let editingDepartment = null;
let editingEmployee = null;
let adminCache = [];
let adminEditingIndex = -1;
let pendingPasswordAction = null;
let passwordFailCount = 0;
let requestLines = [];
let cartState = {
    search: "",
    urgency: "",
    sort: "created_desc",
    editingKey: null,
    editingRow: null,
};
let pendingConfirmResolve = null;
let pendingAddRow = null;

const { showModal, hideModal } = createModalHelpers({ document });

const URGENCY_OPTIONS = ["Alta", "Media", "Bassa"];

function createEmptyLine() {
    return {
        product: "",
        category: "",
        quantity: "",
        unit: "",
        urgency: "",
        url: "",
        note: "",
    };
}

function normalizePriceCad(value) {
    if (value === null || value === undefined) return "";
    const raw = String(value).replace(",", ".").replace(/[^\d.-]/g, "").trim();
    if (!raw) return "";
    const num = Number.parseFloat(raw);
    if (Number.isNaN(num)) return "";
    return num.toFixed(2);
}

function formatPriceCadDisplay(value) {
    const normalized = normalizePriceCad(value);
    if (!normalized) return "";
    return `? ${normalized}`;
}

function updateLineField(index, field, value) {
    if (!requestLines[index]) return;
    requestLines[index][field] = value;
}

function createLineElement(line, index) {
    const wrapper = document.createElement("div");
    wrapper.className = "pm-line";
    wrapper.dataset.index = String(index);

    const grid = document.createElement("div");
    grid.className = "pm-line-grid";

    const productField = document.createElement("div");
    productField.className = "pm-field";
    const productLabel = document.createElement("label");
    productLabel.textContent = "Prodotto";
    const productInput = document.createElement("input");
    productInput.type = "text";
    productInput.value = line.product;
    productInput.placeholder = "Nome prodotto";
    productInput.addEventListener("input", (event) =>
        updateLineField(index, "product", event.target.value)
    );
    productField.append(productLabel, productInput);

    const categoryField = document.createElement("div");
    categoryField.className = "pm-field";
    const categoryLabel = document.createElement("label");
    categoryLabel.textContent = "Tipologia";
    const categoryInput = document.createElement("input");
    categoryInput.type = "text";
    categoryInput.value = line.category;
    categoryInput.placeholder = "Tag (separati da virgola)";
    categoryInput.setAttribute("list", "pm-category-options");
    categoryInput.addEventListener("input", (event) =>
        updateLineField(index, "category", event.target.value)
    );
    categoryField.append(categoryLabel, categoryInput);

    const quantityField = document.createElement("div");
    quantityField.className = "pm-field";
    const quantityLabel = document.createElement("label");
    quantityLabel.textContent = "Quantità";
    const quantityInput = document.createElement("input");
    quantityInput.type = "number";
    quantityInput.min = "0";
    quantityInput.step = "1";
    quantityInput.value = line.quantity;
    quantityInput.placeholder = "0";
    quantityInput.addEventListener("input", (event) =>
        updateLineField(index, "quantity", event.target.value)
    );
    quantityField.append(quantityLabel, quantityInput);

    const unitField = document.createElement("div");
    unitField.className = "pm-field";
    const unitLabel = document.createElement("label");
    unitLabel.textContent = "UM";
    const unitInput = document.createElement("input");
    unitInput.type = "text";
    unitInput.value = line.unit;
    unitInput.placeholder = "Pezzi / Scatole";
    unitInput.addEventListener("input", (event) =>
        updateLineField(index, "unit", event.target.value)
    );
    unitField.append(unitLabel, unitInput);

    const urgencyField = document.createElement("div");
    urgencyField.className = "pm-field";
    const urgencyLabel = document.createElement("label");
    urgencyLabel.textContent = "Urgenza";
    const urgencySelect = document.createElement("select");
    const urgencyPlaceholder = document.createElement("option");
    urgencyPlaceholder.value = "";
    urgencyPlaceholder.textContent = "Seleziona urgenza";
    urgencyPlaceholder.disabled = true;
    urgencyPlaceholder.selected = !line.urgency;
    urgencySelect.appendChild(urgencyPlaceholder);
    URGENCY_OPTIONS.forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option;
        opt.textContent = option;
        if (line.urgency === option) opt.selected = true;
        urgencySelect.appendChild(opt);
    });
    urgencySelect.addEventListener("change", (event) =>
        updateLineField(index, "urgency", event.target.value)
    );
    urgencyField.append(urgencyLabel, urgencySelect);

    grid.append(productField, categoryField, quantityField, unitField, urgencyField);

    const secondary = document.createElement("div");
    secondary.className = "pm-line-grid pm-line-grid--secondary";

    const urlField = document.createElement("div");
    urlField.className = "pm-field";
    const urlLabel = document.createElement("label");
    urlLabel.textContent = "URL";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.value = line.url;
    urlInput.placeholder = "Link prodotto (opzionale)";
    urlInput.addEventListener("input", (event) =>
        updateLineField(index, "url", event.target.value)
    );
    urlField.append(urlLabel, urlInput);

    const noteField = document.createElement("div");
    noteField.className = "pm-field";
    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Note riga";
    const noteInput = document.createElement("input");
    noteInput.type = "text";
    noteInput.value = line.note;
    noteInput.placeholder = "Note specifiche";
    noteInput.addEventListener("input", (event) =>
        updateLineField(index, "note", event.target.value)
    );
    noteField.append(noteLabel, noteInput);

    const actionsField = document.createElement("div");
    actionsField.className = "pm-field";
    const actionLabel = document.createElement("label");
    actionLabel.textContent = "Azioni";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "pm-btn pm-btn--ghost";
    removeBtn.textContent = "Rimuovi";
    removeBtn.addEventListener("click", () => removeLine(index));
    actionsField.append(actionLabel, removeBtn);

    secondary.append(urlField, noteField, actionsField);

    wrapper.append(grid, secondary);
    return wrapper;
}

function renderLines() {
    const container = document.getElementById("pm-lines");
    if (!container) return;
    container.innerHTML = "";
    requestLines.forEach((line, index) => {
        container.appendChild(createLineElement(line, index));
    });
}

function addLine() {
    requestLines.push(createEmptyLine());
    renderLines();
}

function removeLine(index) {
    if (requestLines.length <= 1) {
        requestLines = [createEmptyLine()];
    } else {
        requestLines.splice(index, 1);
    }
    renderLines();
}

function readRequestsFile() {
    try {
        if (!fs.existsSync(REQUESTS_PATH)) return [];
        const raw = fs.readFileSync(REQUESTS_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        showError("Errore lettura richieste.", err.message || String(err));
        return [];
    }
}

function saveRequestsFile(payload) {
    try {
        fs.writeFileSync(REQUESTS_PATH, JSON.stringify(payload, null, 2), "utf8");
        return true;
    } catch (err) {
        showError("Errore salvataggio richieste.", err.message || String(err));
        return false;
    }
}

function collectRequestPayload() {
    const notes = document.getElementById("pm-notes")?.value?.trim() || "";
    const cleanedLines = requestLines
        .map((line) => ({
            product: (line.product || "").trim(),
            category: (line.category || "").trim(),
            quantity: (line.quantity || "").toString().trim(),
            unit: (line.unit || "").trim(),
            urgency: (line.urgency || "").trim(),
            url: (line.url || "").trim(),
            note: (line.note || "").trim(),
        }))
        .filter((line) => line.product || line.quantity || line.unit || line.category || line.urgency);

    return {
        notes,
        lines: cleanedLines,
    };
}

function validateRequestPayload(payload) {
    if (!payload.lines.length) return "Aggiungi almeno un prodotto.";
    const invalidLine = payload.lines.find(
        (line) => !line.product || !line.quantity || !line.unit || !line.urgency
    );
    if (invalidLine) {
        return "Compila prodotto, quantità, UM e urgenza per ogni riga.";
    }
    return "";
}

function buildRequestRecord(payload) {
    const now = new Date().toISOString();
    const id = `REQ-${Date.now()}`;
    const employeeName =
        session.employee || (session.role === "admin" ? session.adminName || "Admin" : "");
    return {
        id,
        createdAt: now,
        status: "pending",
        department: session.department || "",
        employee: employeeName,
        createdBy: session.role,
        adminName: session.adminName || "",
        notes: payload.notes,
        lines: payload.lines,
        history: [
            {
                at: now,
                by: session.role,
                adminName: session.adminName || "",
                action: "created",
            },
        ],
    };
}

function showFormMessage(text, type = "info") {
    const message = document.getElementById("pm-form-message");
    if (!message) return;
    message.textContent = text;
    message.classList.remove("is-hidden", "pm-message--error", "pm-message--success");
    if (type === "error") message.classList.add("pm-message--error");
    if (type === "success") message.classList.add("pm-message--success");
}

function clearForm() {
    const notes = document.getElementById("pm-notes");
    if (notes) notes.value = "";
    requestLines = [createEmptyLine()];
    renderLines();
}

function toTags(raw) {
    if (!raw) return [];
    return raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function buildProductCell(productName, tags) {
    const wrapper = document.createElement("div");
    wrapper.className = "pm-product-cell";
    const title = document.createElement("div");
    title.className = "pm-product-title";
    title.textContent = productName || "-";
    wrapper.appendChild(title);
    if (tags.length) {
        const tagWrap = document.createElement("div");
        tagWrap.className = "pm-tag-list";
        tags.forEach((tag) => {
            const pill = document.createElement("span");
            pill.className = "pm-pill";
            pill.textContent = tag;
            tagWrap.appendChild(pill);
        });
        wrapper.appendChild(tagWrap);
    }
    return wrapper;
}

function buildUrlCell(url) {
    const wrapper = document.createElement("div");
    wrapper.className = "pm-url-cell";
    if (!url) {
        wrapper.textContent = "-";
        return wrapper;
    }
    const shortUrl = url.length > 45 ? `${url.slice(0, 42)}...` : url;
    const link = document.createElement("a");
    link.href = url;
    link.textContent = shortUrl;
    link.className = "pm-link";
    link.title = url;
    link.addEventListener("click", (event) => {
        event.preventDefault();
        if (shell && shell.openExternal) {
            shell.openExternal(url);
        }
    });
    wrapper.appendChild(link);
    return wrapper;
}

function renderCartTable() {
    const list = document.getElementById("pm-requests-list");
    if (!list) return;
    const requests = readRequestsFile();
    const rows = [];
    let needsSave = false;
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    requests.forEach((request, requestIndex) => {
        const requester = [request.employee, request.department]
            .filter(Boolean)
            .join(" - ");
        const nextLines = [];
        (request.lines || []).forEach((line, lineIndex) => {
            const deletedAt = line.deletedAt ? new Date(line.deletedAt).getTime() : 0;
            if (deletedAt && now - deletedAt >= weekMs) {
                needsSave = true;
                return;
            }
            nextLines.push(line);
            const nextIndex = nextLines.length - 1;
            const confirmedAt = line.confirmedAt ? new Date(line.confirmedAt).getTime() : 0;
            if (confirmedAt && now - confirmedAt >= monthMs) {
                return;
            }
            rows.push({
                key: `${request.id || requestIndex}-${nextIndex}`,
                requestIndex,
                lineIndex: nextIndex,
                product: line.product || "",
                category: line.category || "",
                tags: toTags(line.category || ""),
                quantity: line.quantity || "",
                unit: line.unit || "",
                urgency: line.urgency || "",
                url: line.url || "",
                priceCad: line.priceCad || "",
                confirmed: Boolean(line.confirmed),
                confirmedAt: line.confirmedAt || "",
                deletedAt: line.deletedAt || "",
                requester,
                createdAt: request.createdAt || "",
            });
        });
        if (nextLines.length !== (request.lines || []).length) {
            request.lines = nextLines;
        }
    });
    if (needsSave) {
        const cleaned = requests.filter((request) => Array.isArray(request.lines) && request.lines.length);
        saveRequestsFile(cleaned);
    }

    const filtered = rows.filter((row) => {
        if (cartState.urgency && row.urgency !== cartState.urgency) return false;
        if (cartState.search) {
            const haystack = [
                row.product,
                row.tags.join(" "),
                row.requester,
                row.url,
                row.unit,
                row.urgency,
                row.priceCad,
            ]
                .join(" ")
                .toLowerCase();
            if (!haystack.includes(cartState.search.toLowerCase())) return false;
        }
        return true;
    });

    const sortKey = cartState.sort || "created_desc";
    filtered.sort((a, b) => {
        if (sortKey === "created_asc") return String(a.createdAt).localeCompare(String(b.createdAt));
        if (sortKey === "created_desc") return String(b.createdAt).localeCompare(String(a.createdAt));
        if (sortKey === "product_asc") return a.product.localeCompare(b.product);
        if (sortKey === "product_desc") return b.product.localeCompare(a.product);
        if (sortKey === "urgency_desc") {
            const order = { Alta: 3, Media: 2, Bassa: 1, "": 0 };
            return (order[b.urgency] || 0) - (order[a.urgency] || 0);
        }
        if (sortKey === "requester_asc") return a.requester.localeCompare(b.requester);
        return 0;
    });

    if (!filtered.length) {
        list.innerHTML = "<div class=\"pm-message\">Nessun prodotto in lista.</div>";
        return;
    }

    const table = document.createElement("div");
    table.className = "pm-table";

    const header = document.createElement("div");
    header.className = "pm-table__row pm-table__row--header";
    ["", "Prodotto", "Quantità", "UM", "Priorità", "URL", "Prezzo C.A.D", "Richiesto da", "Azioni"].forEach((title) => {
        const cell = document.createElement("div");
        cell.className = "pm-table__cell";
        cell.textContent = title;
        header.appendChild(cell);
    });
    table.appendChild(header);

    filtered.forEach((row) => {
        const tr = document.createElement("div");
        tr.className = "pm-table__row";
        if (row.confirmedAt || row.confirmed) tr.classList.add("pm-table__row--confirmed");
        if (row.deletedAt) tr.classList.add("pm-table__row--deleted");

        const statusCell = document.createElement("div");
        statusCell.className = "pm-table__cell pm-table__cell--icons";
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "pm-icon-btn pm-icon-btn--danger";
        deleteBtn.title = "Elimina";
        deleteBtn.disabled = !isAdmin() || Boolean(row.deletedAt);
        deleteBtn.addEventListener("click", () => deleteCartRow(row));
        const deleteIcon = document.createElement("span");
        deleteIcon.className = "material-icons";
        deleteIcon.textContent = "close";
        deleteBtn.appendChild(deleteIcon);

        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "pm-icon-btn pm-icon-btn--success";
        confirmBtn.title = "Convalida";
        confirmBtn.disabled = !isAdmin() || Boolean(row.confirmed) || Boolean(row.deletedAt);
        confirmBtn.addEventListener("click", () => confirmCartRow(row));
        const confirmIcon = document.createElement("span");
        confirmIcon.className = "material-icons";
        confirmIcon.textContent = "check";
        confirmBtn.appendChild(confirmIcon);

        statusCell.append(deleteBtn, confirmBtn);

        const admin = isAdmin();

        const productCell = document.createElement("div");
        productCell.className = "pm-table__cell";
        productCell.appendChild(buildProductCell(row.product, row.tags));

        const quantityCell = document.createElement("div");
        quantityCell.className = "pm-table__cell";
        quantityCell.textContent = row.quantity || "-";

        const unitCell = document.createElement("div");
        unitCell.className = "pm-table__cell";
        unitCell.textContent = row.unit || "-";

        const urgencyCell = document.createElement("div");
        urgencyCell.className = "pm-table__cell";
        urgencyCell.textContent = row.urgency || "-";

        const urlCell = document.createElement("div");
        urlCell.className = "pm-table__cell";
        urlCell.appendChild(buildUrlCell(row.url));

        const priceCell = document.createElement("div");
        priceCell.className = "pm-table__cell";
        priceCell.textContent = row.priceCad ? formatPriceCadDisplay(row.priceCad) : "-";

        const requesterCell = document.createElement("div");
        requesterCell.className = "pm-table__cell";
        requesterCell.textContent = row.requester || "-";

        const actionsCell = document.createElement("div");
        actionsCell.className = "pm-table__cell pm-table__actions";
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "pm-btn pm-btn--ghost";
        addBtn.textContent = "Aggiungi";
        addBtn.addEventListener("click", () => openAddModal(row));
        actionsCell.appendChild(addBtn);
        if (row.deletedAt) {
            addBtn.disabled = true;
        }
        if (admin) {
            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "pm-btn pm-btn--ghost";
            editBtn.textContent = "Modifica";
            editBtn.addEventListener("click", () => openEditModal(row));
            if (row.deletedAt) editBtn.disabled = true;
            actionsCell.append(editBtn);
        } else if (!isLoggedIn()) {
            addBtn.disabled = true;
        }

        tr.append(
            statusCell,
            productCell,
            quantityCell,
            unitCell,
            urgencyCell,
            urlCell,
            priceCell,
            requesterCell,
            actionsCell
        );
        table.appendChild(tr);
    });

    list.innerHTML = "";
    list.appendChild(table);
}

function getEditFieldValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : "";
}

function openEditModal(row) {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono modificare.");
        return;
    }
    cartState.editingRow = row;
    const modal = document.getElementById("pm-edit-modal");
    if (!modal) return;
    const product = document.getElementById("pm-edit-product");
    const tags = document.getElementById("pm-edit-tags");
    const quantity = document.getElementById("pm-edit-quantity");
    const unit = document.getElementById("pm-edit-unit");
    const urgency = document.getElementById("pm-edit-urgency");
    const url = document.getElementById("pm-edit-url");
    const price = document.getElementById("pm-edit-price");
    const note = document.getElementById("pm-edit-note");
    if (product) product.value = row.product || "";
    if (tags) tags.value = row.tags.join(", ");
    if (quantity) quantity.value = row.quantity || "";
    if (unit) unit.value = row.unit || "";
    if (urgency) urgency.value = row.urgency || "";
    if (url) url.value = row.url || "";
    if (price) price.value = row.priceCad ? String(row.priceCad).replace(/[^\d.,-]/g, "") : "";
    if (note) note.value = row.note || "";
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeEditModal() {
    const modal = document.getElementById("pm-edit-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
    cartState.editingRow = null;
}

function saveEditModal() {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono modificare.");
        return;
    }
    const row = cartState.editingRow;
    if (!row) return;
    if (!isAdmin()) {
        showWarning("Solo gli admin possono modificare.");
        return;
    }
    const requests = readRequestsFile();
    const request = requests[row.requestIndex];
    if (!request || !request.lines || !request.lines[row.lineIndex]) {
        showError("Elemento non trovato.", "La riga potrebbe essere stata modificata da un altro utente.");
        return;
    }
    const line = request.lines[row.lineIndex];
    line.product = getEditFieldValue("pm-edit-product").trim();
    line.category = getEditFieldValue("pm-edit-tags").trim();
    line.quantity = getEditFieldValue("pm-edit-quantity").toString().trim();
    line.unit = getEditFieldValue("pm-edit-unit").trim();
    line.urgency = getEditFieldValue("pm-edit-urgency").trim();
    line.url = getEditFieldValue("pm-edit-url").trim();
    line.priceCad = normalizePriceCad(getEditFieldValue("pm-edit-price"));
    line.note = getEditFieldValue("pm-edit-note").trim();
    request.history = Array.isArray(request.history) ? request.history : [];
    request.history.push({
        at: new Date().toISOString(),
        by: "admin",
        adminName: session.adminName || "",
        action: "line-updated",
    });
    if (saveRequestsFile(requests)) {
        closeEditModal();
        renderCartTable();
    }
}

function openAddModal(row) {
    if (!requireLogin()) return;
    pendingAddRow = row;
    const modal = document.getElementById("pm-add-modal");
    const qty = document.getElementById("pm-add-quantity");
    if (!modal) return;
    if (qty) qty.value = "";
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeAddModal() {
    const modal = document.getElementById("pm-add-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
    pendingAddRow = null;
}

function saveAddModal() {
    if (!pendingAddRow) {
        closeAddModal();
        return;
    }
    if (!isLoggedIn()) {
        showWarning("Accesso richiesto.", "Per continuare effettua il login.");
        openLoginModal();
        return;
    }
    const qtyRaw = document.getElementById("pm-add-quantity")?.value || "";
    const qty = qtyRaw.toString().trim();
    if (!qty || Number.parseFloat(qty) <= 0) {
        showWarning("Quantità non valida.");
        return;
    }

    const baseLine = pendingAddRow;
    const newLine = {
        product: baseLine.product || "",
        category: baseLine.tags ? baseLine.tags.join(", ") : baseLine.category || "",
        quantity: qty,
        unit: baseLine.unit || "",
        urgency: baseLine.urgency || "",
        url: baseLine.url || "",
        note: "",
    };
    const record = buildRequestRecord({ notes: "", lines: [newLine] });
    const requests = readRequestsFile();
    requests.push(record);
    if (saveRequestsFile(requests)) {
        closeAddModal();
        renderCartTable();
    }
}

async function confirmCartRow(row) {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono convalidare.");
        return;
    }
    const ok = await openConfirmModal("Vuoi convalidare questo elemento?");
    if (!ok) return;
    const requests = readRequestsFile();
    const request = requests[row.requestIndex];
    if (!request || !request.lines || !request.lines[row.lineIndex]) {
        showError("Elemento non trovato.", "La riga potrebbe essere stata modificata da un altro utente.");
        return;
    }
    const line = request.lines[row.lineIndex];
    if (line.deletedAt) return;
    if (line.confirmed) return;
    line.confirmed = true;
    line.confirmedAt = new Date().toISOString();
    line.confirmedBy = session.adminName || "";
    request.history = Array.isArray(request.history) ? request.history : [];
    request.history.push({
        at: line.confirmedAt,
        by: "admin",
        adminName: session.adminName || "",
        action: "line-confirmed",
    });
    if (saveRequestsFile(requests)) renderCartTable();
}

async function deleteCartRow(row) {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono eliminare.");
        return;
    }
    const ok = await openConfirmModal("Vuoi eliminare questo elemento?");
    if (!ok) return;
    const requests = readRequestsFile();
    const request = requests[row.requestIndex];
    if (!request || !request.lines || !request.lines[row.lineIndex]) {
        showError("Elemento non trovato.", "La riga potrebbe essere stata modificata da un altro utente.");
        return;
    }
    const line = request.lines[row.lineIndex];
    if (line.deletedAt) return;
    line.deletedAt = new Date().toISOString();
    line.deletedBy = session.adminName || "";
    request.history = Array.isArray(request.history) ? request.history : [];
    request.history.push({
        at: line.deletedAt,
        by: "admin",
        adminName: session.adminName || "",
        action: "line-deleted",
    });
    if (saveRequestsFile(requests)) renderCartTable();
}

function initCartFilters() {
    const searchInput = document.getElementById("pm-cart-search");
    const urgencySelect = document.getElementById("pm-cart-filter-urgency");
    const sortSelect = document.getElementById("pm-cart-sort");
    if (searchInput) {
        searchInput.addEventListener("input", (event) => {
            cartState.search = event.target.value || "";
            renderCartTable();
        });
    }
    if (urgencySelect) {
        urgencySelect.addEventListener("change", (event) => {
            cartState.urgency = event.target.value || "";
            renderCartTable();
        });
    }
    if (sortSelect) {
        sortSelect.addEventListener("change", (event) => {
            cartState.sort = event.target.value || "created_desc";
            renderCartTable();
        });
    }
}

function normalizeAssigneesPayload(parsed) {
    if (parsed && typeof parsed === "object") {
        const rawGroups = parsed.groups && typeof parsed.groups === "object" ? parsed.groups : parsed;
        const groups = {};
        Object.keys(rawGroups).forEach((key) => {
            const list = Array.isArray(rawGroups[key]) ? rawGroups[key] : [];
            groups[key] = list.map((name) => String(name));
        });
        const options = Object.values(groups).flat();
        return { groups, options };
    }
    return { groups: {}, options: [] };
}

function loadAssignees() {
    const pathHint = NETWORK_PATHS?.amministrazioneAssignees || ASSIGNEES_FALLBACK;
    try {
        if (!fs.existsSync(pathHint)) return { groups: {}, options: [] };
        const raw = fs.readFileSync(pathHint, "utf8");
        const parsed = JSON.parse(raw);
        return normalizeAssigneesPayload(parsed);
    } catch (err) {
        console.error("Errore lettura assignees:", err);
        return { groups: {}, options: [] };
    }
}

function saveAssignees() {
    const pathHint = NETWORK_PATHS?.amministrazioneAssignees || ASSIGNEES_FALLBACK;
    try {
        fs.writeFileSync(pathHint, JSON.stringify(assigneeGroups, null, 2), "utf8");
    } catch (err) {
        showError("Errore salvataggio dipendenti.", err.message || String(err));
    }
}

function syncAssignees() {
    const payload = loadAssignees();
    assigneeGroups = payload.groups || {};
    assigneeOptions = payload.options || [];
    if (!Object.keys(assigneeGroups).length) {
        showWarning(
            "Elenco dipendenti non disponibile.",
            "Impossibile leggere amministrazione-assignees.json dal server."
        );
    }
}

function saveSession() {
    try {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (err) {
        console.error("Errore salvataggio sessione:", err);
    }
    try {
        fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), "utf8");
    } catch (err) {
        console.error("Errore salvataggio sessione file:", err);
    }
}

function loadSession() {
    try {
        const raw = window.localStorage.getItem(SESSION_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                session = {
                    role: parsed.role || "guest",
                    adminName: parsed.adminName || "",
                    department: parsed.department || "",
                    employee: parsed.employee || "",
                };
                return;
            }
        }
    } catch (err) {
        console.error("Errore lettura sessione:", err);
    }
    try {
        if (fs.existsSync(SESSION_PATH)) {
            const rawFile = fs.readFileSync(SESSION_PATH, "utf8");
            const parsed = JSON.parse(rawFile);
            if (parsed && typeof parsed === "object") {
                session = {
                    role: parsed.role || "guest",
                    adminName: parsed.adminName || "",
                    department: parsed.department || "",
                    employee: parsed.employee || "",
                };
                return;
            }
        }
    } catch (err) {
        console.error("Errore lettura sessione file:", err);
    }
    session = { role: "guest", adminName: "", department: "", employee: "" };
}

function clearSession() {
    session = { role: "guest", adminName: "", department: "", employee: "" };
    try {
        window.localStorage.removeItem(SESSION_KEY);
    } catch (err) {
        console.error("Errore clear session:", err);
    }
    try {
        if (fs.existsSync(SESSION_PATH)) {
            fs.unlinkSync(SESSION_PATH);
        }
    } catch (err) {
        console.error("Errore clear session file:", err);
    }
}

function isAdmin() {
    return session.role === "admin";
}

function isEmployee() {
    return session.role === "employee";
}

function isLoggedIn() {
    return isAdmin() || isEmployee();
}

function updateGreeting() {
    const greeting = document.getElementById("pm-greeting");
    if (!greeting) return;
    if (isEmployee()) {
        greeting.textContent = `Buongiorno, ${session.employee}!`;
        return;
    }
    if (isAdmin()) {
        greeting.textContent = `Buongiorno, ${session.adminName}!`;
        return;
    }
    greeting.textContent = "Buongiorno";
}

function updateLoginButton() {
    const btn = document.getElementById("pm-login-toggle");
    if (!btn) return;
    if (isAdmin()) {
        btn.textContent = `Admin: ${session.adminName}`;
        return;
    }
    if (isEmployee()) {
        btn.textContent = `Dipendente: ${session.employee}`;
        return;
    }
    btn.textContent = "Login";
}

function fillSelectOptions(selectEl, options, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    if (placeholder) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = placeholder;
        opt.disabled = true;
        opt.selected = true;
        selectEl.appendChild(opt);
    }
    options.forEach((value) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        selectEl.appendChild(opt);
    });
}

function renderLoginSelectors() {
    const deptSelect = document.getElementById("pm-login-department");
    const empSelect = document.getElementById("pm-login-employee-name");

    const departments = Object.keys(assigneeGroups || {}).sort();
    fillSelectOptions(deptSelect, departments, "Seleziona reparto");
    fillSelectOptions(empSelect, [], "Seleziona dipendente");

    if (deptSelect) {
        deptSelect.addEventListener("change", () => {
            const list = assigneeGroups[deptSelect.value] || [];
            fillSelectOptions(empSelect, list, "Seleziona dipendente");
        });
    }
}

function renderAdminSelect() {
    const adminSelect = document.getElementById("pm-login-admin-name");
    if (!adminSelect) return;
    const names = loadAdminCredentials().map((admin) => admin.name).filter(Boolean);
    fillSelectOptions(adminSelect, names, "Seleziona admin");
}

function setAdminMessage(id, text, isError = false) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!text) {
        el.classList.add("is-hidden");
        el.textContent = "";
        el.classList.remove("fp-message--error");
        return;
    }
    el.textContent = text;
    el.classList.remove("is-hidden");
    if (isError) {
        el.classList.add("fp-message--error");
    } else {
        el.classList.remove("fp-message--error");
    }
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function openLoginModal() {
    const modal = document.getElementById("pm-login-modal");
    const employeePanel = document.getElementById("pm-login-employee-panel");
    const adminPanel = document.getElementById("pm-login-admin-panel");
    const choiceEmployee = document.getElementById("pm-login-choice-employee");
    const choiceAdmin = document.getElementById("pm-login-choice-admin");
    if (!modal) return;
    if (employeePanel) employeePanel.classList.remove("is-hidden");
    if (adminPanel) adminPanel.classList.add("is-hidden");
    if (choiceEmployee) choiceEmployee.classList.add("is-active");
    if (choiceAdmin) choiceAdmin.classList.remove("is-active");
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeLoginModal() {
    const modal = document.getElementById("pm-login-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

function openLogoutModal() {
    const modal = document.getElementById("pm-logout-modal");
    if (!modal) return;
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeLogoutModal() {
    const modal = document.getElementById("pm-logout-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

function openConfirmModal(message) {
    const modal = document.getElementById("pm-confirm-modal");
    const desc = document.getElementById("pm-confirm-message");
    if (!modal || !desc) return Promise.resolve(false);
    desc.textContent = message || "";
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
    return new Promise((resolve) => {
        pendingConfirmResolve = resolve;
    });
}

function closeConfirmModal(result = false) {
    const modal = document.getElementById("pm-confirm-modal");
    if (modal) {
        modal.classList.add("is-hidden");
        modal.setAttribute("aria-hidden", "true");
    }
    if (typeof pendingConfirmResolve === "function") {
        const resolver = pendingConfirmResolve;
        pendingConfirmResolve = null;
        resolver(result);
    }
}

function requireLogin() {
    if (isLoggedIn()) return true;
    showWarning("Accesso richiesto.", "Per continuare effettua il login.");
    openLoginModal();
    return false;
}

function requireAdminAccess(action) {
    if (isAdmin()) {
        if (typeof action === "function") action();
        return;
    }
    showWarning("Accesso admin richiesto.", "Effettua il login come admin per continuare.");
    openLoginModal();
}

function openPasswordModal(action) {
    pendingPasswordAction = action || null;
    const modal = document.getElementById("fp-approve-modal");
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const title = document.getElementById("fp-approve-title");
    const desc = document.getElementById("fp-approve-desc");
    if (!modal || !input) return;
    if (title && action?.title) title.textContent = action.title;
    if (desc && action?.description) desc.textContent = action.description;
    showModal(modal);
    if (error) error.classList.add("is-hidden");
    input.value = "";
    setTimeout(() => {
        input.focus();
        input.select?.();
    }, 0);
}

async function confirmPassword() {
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const password = input ? input.value : "";
    const action = pendingPasswordAction;
    if (!action) {
        if (error) error.classList.add("is-hidden");
        return;
    }
    const targetName = action?.adminName || action?.id || "";
    const shouldCheckAny = action.type === "admin-access";
    const result = await verifyAdminPassword(password, shouldCheckAny ? undefined : (targetName || undefined));
    if (!result || !result.admin) {
        if (error) error.classList.remove("is-hidden");
        passwordFailCount += 1;
        return;
    }
    passwordFailCount = 0;
    if (error) error.classList.add("is-hidden");
    hideModal(document.getElementById("fp-approve-modal"));

    if (action.type === "admin-access") {
        adminUi.openAdminModal();
        return;
    }
    if (action.type === "admin-delete") {
        const adminName = action.adminName || "";
        adminCache = adminCache.length ? adminCache : loadAdminCredentials();
        if (adminCache.length <= 1) {
            setAdminMessage("fp-admin-message", UI_TEXTS.adminMinRequired, true);
            return;
        }
        adminCache = adminCache.filter((item) => item.name !== adminName);
        setAdminCache(adminCache);
        saveAdminCredentials(adminCache);
        adminUi.renderAdminList();
        setAdminMessage("fp-admin-message", UI_TEXTS.adminRemoved, false);
    }
}

function initPasswordModal() {
    const cancel = document.getElementById("fp-approve-cancel");
    const confirm = document.getElementById("fp-approve-confirm");
    if (cancel) cancel.addEventListener("click", () => hideModal(document.getElementById("fp-approve-modal")));
    if (confirm) confirm.addEventListener("click", confirmPassword);
}

function renderDepartmentSelect() {
    const select = document.getElementById("fp-employee-department");
    if (!select) return;
    select.innerHTML = "";
    Object.keys(assigneeGroups).sort((a, b) => a.localeCompare(b)).forEach((group) => {
        const option = document.createElement("option");
        option.value = group;
        option.textContent = group;
        select.appendChild(option);
    });
}

function renderDepartmentList() {
    const list = document.getElementById("fp-departments-list");
    if (!list) return;
    list.innerHTML = "";
    const groups = Object.keys(assigneeGroups).sort((a, b) => a.localeCompare(b));
    if (!groups.length) {
        list.textContent = UI_TEXTS.emptyDepartment;
        return;
    }
    groups.forEach((group) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row";
        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        if (editingDepartment === group) {
            const input = document.createElement("input");
            input.className = "fp-field__input";
            input.value = group;

            const save = document.createElement("button");
            save.type = "button";
            save.className = "fp-assignees-link";
            save.textContent = "Salva";
            save.addEventListener("click", () => {
                const next = input.value.trim();
                if (!next) return;
                if (assigneeGroups[next] && next !== group) return;
                const copy = { ...assigneeGroups };
                const employees = copy[group] || [];
                delete copy[group];
                copy[next] = employees;
                assigneeGroups = copy;
                editingDepartment = null;
                saveAssignees();
                renderDepartmentList();
                renderEmployeesList();
                renderDepartmentSelect();
            });

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "fp-assignees-link fp-assignees-link--danger";
            cancel.textContent = "Annulla";
            cancel.addEventListener("click", () => {
                editingDepartment = null;
                renderDepartmentList();
            });

            row.appendChild(input);
            actions.appendChild(save);
            actions.appendChild(cancel);
        } else {
            const name = document.createElement("div");
            name.textContent = group;

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "fp-assignees-link";
            edit.textContent = "Modifica";
            edit.addEventListener("click", () => {
                editingDepartment = group;
                renderDepartmentList();
            });

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "fp-assignees-link fp-assignees-link--danger";
            remove.textContent = "Rimuovi";
            remove.addEventListener("click", () => {
                delete assigneeGroups[group];
                saveAssignees();
                renderDepartmentList();
                renderEmployeesList();
                renderDepartmentSelect();
            });

            row.appendChild(name);
            actions.appendChild(edit);
            actions.appendChild(remove);
        }

        row.appendChild(actions);
        list.appendChild(row);
    });
}

function renderEmployeesList() {
    const list = document.getElementById("fp-employees-list");
    if (!list) return;
    list.innerHTML = "";
    const employees = Object.entries(assigneeGroups)
        .flatMap(([dept, names]) => (names || []).map((name) => ({ name, dept })))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (!employees.length) {
        list.textContent = UI_TEXTS.emptyAssignee;
        return;
    }

    employees.forEach((emp) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row";
        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        if (editingEmployee && editingEmployee.name === emp.name && editingEmployee.dept === emp.dept) {
            const input = document.createElement("input");
            input.className = "fp-field__input";
            input.value = emp.name;

            const save = document.createElement("button");
            save.type = "button";
            save.className = "fp-assignees-link";
            save.textContent = "Salva";
            save.addEventListener("click", () => {
                const next = input.value.trim();
                if (!next) return;
                const listForDept = assigneeGroups[emp.dept] || [];
                const idx = listForDept.indexOf(emp.name);
                if (idx >= 0) listForDept[idx] = next;
                assigneeGroups[emp.dept] = Array.from(new Set(listForDept)).sort((a, b) => a.localeCompare(b));
                editingEmployee = null;
                saveAssignees();
                renderEmployeesList();
                renderDepartmentList();
            });

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "fp-assignees-link fp-assignees-link--danger";
            cancel.textContent = "Annulla";
            cancel.addEventListener("click", () => {
                editingEmployee = null;
                renderEmployeesList();
            });

            row.appendChild(input);
            actions.appendChild(save);
            actions.appendChild(cancel);
        } else {
            const name = document.createElement("div");
            name.textContent = `${emp.name} (${emp.dept})`;

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "fp-assignees-link";
            edit.textContent = "Modifica";
            edit.addEventListener("click", () => {
                editingEmployee = { name: emp.name, dept: emp.dept };
                renderEmployeesList();
            });

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "fp-assignees-link fp-assignees-link--danger";
            remove.textContent = "Rimuovi";
            remove.addEventListener("click", () => {
                assigneeGroups[emp.dept] = (assigneeGroups[emp.dept] || []).filter((n) => n !== emp.name);
                saveAssignees();
                renderEmployeesList();
                renderDepartmentList();
            });

            row.appendChild(name);
            actions.appendChild(edit);
            actions.appendChild(remove);
        }

        row.appendChild(actions);
        list.appendChild(row);
    });
}

function getAssigneeGroups() {
    return { ...assigneeGroups };
}

function setAssigneeGroups(next) {
    assigneeGroups = { ...next };
}

function setAssigneeOptions(next) {
    assigneeOptions = Array.isArray(next) ? [...next] : [];
}

function setEditingDepartment(next) {
    editingDepartment = next;
}

function setEditingEmployee(next) {
    editingEmployee = next;
}

function getAdminCache() {
    return adminCache;
}

function setAdminCache(next) {
    adminCache = Array.isArray(next) ? [...next] : [];
}

function getAdminEditingIndex() {
    return adminEditingIndex;
}

function setAdminEditingIndex(next) {
    adminEditingIndex = next;
}

function openOtpModal() {
    showInfo("Recupero password", "Funzione OTP non configurata in Product Manager.");
}

const assigneesUi = createAssigneesModal({
    document,
    showModal,
    hideModal,
    renderDepartmentList,
    renderEmployeesList,
    renderDepartmentSelect,
    populateEmployees: renderDepartmentSelect,
    saveAssigneeOptions: saveAssignees,
    syncBalancesAfterAssignees: null,
    getAssigneeGroups,
    setAssigneeGroups,
    setAssigneeOptions,
    setEditingDepartment,
    setEditingEmployee,
    onOpenAttempt: () => requireAdminAccess(() => assigneesUi.openAssigneesModal()),
});

const adminUi = createAdminModals({
    document,
    showModal,
    hideModal,
    setAdminMessage,
    openConfirmModal,
    escapeHtml,
    openPasswordModal,
    openOtpModal,
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword,
    hashPassword,
    isHashingAvailable,
    isValidEmail,
    isValidPhone,
    showDialog,
    getAdminCache,
    setAdminCache,
    getAdminEditingIndex,
    setAdminEditingIndex,
    isInitialSetupActive: () => false,
    onInitialSetupComplete: () => {},
});

function setupLogin() {
    const loginBtn = document.getElementById("pm-login-toggle");
    const loginClose = document.getElementById("pm-login-close");
    const choiceEmployee = document.getElementById("pm-login-choice-employee");
    const choiceAdmin = document.getElementById("pm-login-choice-admin");
    const employeePanel = document.getElementById("pm-login-employee-panel");
    const adminPanel = document.getElementById("pm-login-admin-panel");
    const employeeConfirm = document.getElementById("pm-login-employee-confirm");
    const adminConfirm = document.getElementById("pm-login-admin-confirm");
    const adminError = document.getElementById("pm-login-admin-error");

    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            if (isLoggedIn()) {
                openLogoutModal();
                return;
            }
            openLoginModal();
        });
    }

    if (loginClose) {
        loginClose.addEventListener("click", () => closeLoginModal());
    }

    if (choiceEmployee) {
        choiceEmployee.addEventListener("click", () => {
            if (employeePanel) employeePanel.classList.remove("is-hidden");
            if (adminPanel) adminPanel.classList.add("is-hidden");
            choiceEmployee.classList.add("is-active");
            if (choiceAdmin) choiceAdmin.classList.remove("is-active");
        });
    }

    if (choiceAdmin) {
        choiceAdmin.addEventListener("click", () => {
            if (adminPanel) adminPanel.classList.remove("is-hidden");
            if (employeePanel) employeePanel.classList.add("is-hidden");
            choiceAdmin.classList.add("is-active");
            if (choiceEmployee) choiceEmployee.classList.remove("is-active");
        });
    }

    if (employeeConfirm) {
        employeeConfirm.addEventListener("click", () => {
            const dept = document.getElementById("pm-login-department")?.value || "";
            const emp = document.getElementById("pm-login-employee-name")?.value || "";
            if (!dept || !emp) {
                showWarning("Seleziona reparto e dipendente per accedere.");
                return;
            }
            session = { role: "employee", adminName: "", department: dept, employee: emp };
            saveSession();
            updateGreeting();
            updateLoginButton();
            renderCartTable();
            closeLoginModal();
        });
    }

    if (adminConfirm) {
        adminConfirm.addEventListener("click", async () => {
            const adminName = document.getElementById("pm-login-admin-name")?.value || "";
            const password = document.getElementById("pm-login-admin-password")?.value || "";
            if (adminError) adminError.classList.add("is-hidden");
            if (!adminName || !password) {
                if (adminError) adminError.classList.remove("is-hidden");
                return;
            }
            const verified = await verifyAdminPassword(password, adminName);
            if (!verified || !verified.admin) {
                if (adminError) adminError.classList.remove("is-hidden");
                return;
            }
            session = { role: "admin", adminName: verified.admin.name, department: "", employee: "" };
            saveSession();
            updateGreeting();
            updateLoginButton();
            renderCartTable();
            closeLoginModal();
        });
    }
}

function initEditModal() {
    const closeBtn = document.getElementById("pm-edit-close");
    const cancelBtn = document.getElementById("pm-edit-cancel");
    const saveBtn = document.getElementById("pm-edit-save");
    if (closeBtn) closeBtn.addEventListener("click", () => closeEditModal());
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeEditModal());
    if (saveBtn) saveBtn.addEventListener("click", () => saveEditModal());
}

function initAddModal() {
    const closeBtn = document.getElementById("pm-add-close");
    const cancelBtn = document.getElementById("pm-add-cancel");
    const saveBtn = document.getElementById("pm-add-save");
    if (closeBtn) closeBtn.addEventListener("click", () => closeAddModal());
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeAddModal());
    if (saveBtn) saveBtn.addEventListener("click", () => saveAddModal());
}

function initConfirmModal() {
    const cancelBtn = document.getElementById("pm-confirm-cancel");
    const okBtn = document.getElementById("pm-confirm-ok");
    const modal = document.getElementById("pm-confirm-modal");
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeConfirmModal(false));
    if (okBtn) okBtn.addEventListener("click", () => closeConfirmModal(true));
    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeConfirmModal(false);
        });
    }
}

function setupHeaderButtons() {
    const refreshBtn = document.getElementById("pm-refresh");
    const settingsBtn = document.getElementById("pm-settings");
    const cartBtn = document.getElementById("pm-open-cart");
    const addLineBtn = document.getElementById("pm-add-line");
    const saveBtn = document.getElementById("pm-request-save");
    const closeCartBtn = document.getElementById("pm-close-cart");

    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            syncAssignees();
            renderLoginSelectors();
            renderCartTable();
        });
    }

    if (settingsBtn) {
        settingsBtn.addEventListener("click", () => {
            if (!requireLogin()) return;
            const modal = document.getElementById("pm-settings-modal");
            if (modal) {
                modal.classList.remove("is-hidden");
                modal.setAttribute("aria-hidden", "false");
            }
        });
    }

    if (cartBtn) {
        cartBtn.addEventListener("click", () => {
            if (!requireLogin()) return;
            ipcRenderer.send("open-product-manager-cart-window");
            if (document.getElementById("pm-request-form")) {
                window.close();
            }
        });
    }

    if (closeCartBtn) {
        closeCartBtn.addEventListener("click", () => {
            saveSession();
            ipcRenderer.send("open-product-manager-window");
            window.close();
        });
    }

    if (addLineBtn) {
        addLineBtn.addEventListener("click", (event) => {
            if (!requireLogin()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            addLine();
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", async (event) => {
            if (!requireLogin()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const payload = collectRequestPayload();
            const validationError = validateRequestPayload(payload);
            if (validationError) {
                showFormMessage(validationError, "error");
                return;
            }
            const ok = await openConfirmModal("Vuoi inviare la richiesta?");
            if (!ok) return;
            const requests = readRequestsFile();
            const record = buildRequestRecord(payload);
            requests.push(record);
            if (saveRequestsFile(requests)) {
                showFormMessage("Richiesta inviata correttamente.", "success");
                clearForm();
            }
        });
    }
}

function initSettingsModals() {
    const settingsClose = document.getElementById("pm-settings-close");
    if (settingsClose) settingsClose.addEventListener("click", () => {
        const modal = document.getElementById("pm-settings-modal");
        if (modal) {
            modal.classList.add("is-hidden");
            modal.setAttribute("aria-hidden", "true");
        }
    });

    const themeOpen = document.getElementById("pm-theme-open");
    const themeClose = document.getElementById("pm-theme-close");
    const themeModal = document.getElementById("pm-theme-modal");
    if (themeOpen && themeModal) {
        themeOpen.addEventListener("click", () => {
            themeModal.classList.remove("is-hidden");
            themeModal.setAttribute("aria-hidden", "false");
        });
    }
    if (themeClose && themeModal) {
        themeClose.addEventListener("click", () => {
            themeModal.classList.add("is-hidden");
            themeModal.setAttribute("aria-hidden", "true");
        });
    }

    const setTheme = (theme) => {
        document.body.classList.remove("fp-dark", "fp-aypi");
        if (theme === "dark") document.body.classList.add("fp-dark");
        if (theme === "aypi") document.body.classList.add("fp-aypi");
        try {
            window.localStorage.setItem("pm-theme", theme);
        } catch {}
    };
    const themeLight = document.getElementById("pm-theme-light");
    const themeDark = document.getElementById("pm-theme-dark");
    const themeAyPi = document.getElementById("pm-theme-aypi");
    if (themeLight) themeLight.addEventListener("click", () => setTheme("light"));
    if (themeDark) themeDark.addEventListener("click", () => setTheme("dark"));
    if (themeAyPi) themeAyPi.addEventListener("click", () => setTheme("aypi"));
    try {
        const saved = window.localStorage.getItem("pm-theme");
        if (saved) {
            setTheme(saved);
        } else {
            setTheme("light");
        }
    } catch {}

    const assigneesOpen = document.getElementById("pm-assignees-open");
    if (assigneesOpen) {
        assigneesOpen.addEventListener("click", () => {
            const modal = document.getElementById("pm-settings-modal");
            if (modal) modal.classList.add("is-hidden");
            requireAdminAccess(() => assigneesUi.openAssigneesModal());
        });
    }

    const adminOpen = document.getElementById("pm-admin-open");
    if (adminOpen) {
        adminOpen.addEventListener("click", () => {
            const modal = document.getElementById("pm-settings-modal");
            if (modal) modal.classList.add("is-hidden");
            requireAdminAccess(() => {
                openPasswordModal({
                    type: "admin-access",
                    id: "admin-access",
                    title: "Gestione admin",
                    description: UI_TEXTS.adminAccessDescription,
                });
            });
        });
    }

    adminUi.initAdminModals();
    assigneesUi.initAssigneesModal();
    initPasswordModal();
}

function initLogoutModal() {
    const logoutCancel = document.getElementById("pm-logout-cancel");
    const logoutConfirm = document.getElementById("pm-logout-confirm");
    if (logoutCancel) logoutCancel.addEventListener("click", () => closeLogoutModal());
    if (logoutConfirm) {
        logoutConfirm.addEventListener("click", () => {
            clearSession();
            updateGreeting();
            updateLoginButton();
            renderCartTable();
            closeLogoutModal();
        });
    }
}

function init() {
    const warning = document.getElementById("pm-js-warning");
    if (warning) warning.classList.add("is-hidden");
    loadSession();
    syncAssignees();
    renderLoginSelectors();
    renderAdminSelect();
    requestLines = [createEmptyLine()];
    renderLines();
    renderCartTable();
    initCartFilters();
    initEditModal();
    initAddModal();
    initConfirmModal();
    setupLogin();
    setupHeaderButtons();
    initSettingsModals();
    initLogoutModal();
    updateGreeting();
    updateLoginButton();
    if (document.getElementById("pm-request-form") && !isLoggedIn()) {
        openLoginModal();
    }
}

window.addEventListener("DOMContentLoaded", () => {
    try {
        init();
    } catch (err) {
        showError("Errore inizializzazione Product Manager.", err.message || String(err));
    }
});

window.addEventListener("error", (event) => {
    const detail = event?.error?.stack || event?.message || "Errore sconosciuto";
    showError("Errore Product Manager.", detail);
});

window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const detail = reason?.stack || reason?.message || String(reason || "Errore sconosciuto");
    showError("Errore Product Manager (Promise).", detail);
});
