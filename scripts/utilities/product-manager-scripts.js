const { ipcRenderer, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const sharedDialogs = require("../shared/dialogs");
const { NETWORK_PATHS } = require("../../config/paths");
const { createModalHelpers } = require("./ferie-permessi/ui/modals");
const { createAssigneesModal } = require("./ferie-permessi/ui/assignees-modal");
const { createAdminModals } = require("./ferie-permessi/ui/admin-modals");
const { UI_TEXTS } = require("./ferie-permessi/utils/ui-texts");
const { isHashingAvailable, hashPassword } = require("./ferie-permessi/config/security");
const { GUIDE_URL, GUIDE_SEARCH_PARAM } = require("./ferie-permessi/config/constants");
const { createGuideModal } = require("./ferie-permessi/ui/guide-modal");
const { setMessage } = require("./product-manager/ui/messages");
const { openMultiselectMenu, closeMultiselectMenu } = require("./product-manager/ui/multiselect");
const {
    renderLoginSelectors: renderLoginSelectorsUi,
    renderAdminSelect: renderAdminSelectUi,
} = require("./product-manager/ui/login-selectors");
const {
    buildProductCell: buildProductCellUi,
    buildUrlCell: buildUrlCellUi,
} = require("./product-manager/ui/catalog-cells");
const {
    openImageModal: openImageModalUi,
    closeImageModal: closeImageModalUi,
} = require("./product-manager/ui/image-viewer");
const {
    openLoginModal: openLoginModalUi,
    closeLoginModal: closeLoginModalUi,
    openLogoutModal: openLogoutModalUi,
    closeLogoutModal: closeLogoutModalUi,
} = require("./product-manager/ui/auth-modals");
const {
    openConfirmModal: openConfirmModalUi,
    closeConfirmModal: closeConfirmModalUi,
    openAlertModal: openAlertModalUi,
    closeAlertModal: closeAlertModalUi,
} = require("./product-manager/ui/confirm-alert");
const {
    showInfo: showInfoUi,
    showWarning: showWarningUi,
    showError: showErrorUi,
    requireLogin: requireLoginUi,
    requireAdminAccess: requireAdminAccessUi,
} = require("./product-manager/ui/notifications");
const {
    renderCategoriesList: renderCategoriesListUi,
    renderInterventionTypesList: renderInterventionTypesListUi,
} = require("./product-manager/ui/categories-lists");
const {
    renderDepartmentSelect: renderDepartmentSelectUi,
    renderDepartmentList: renderDepartmentListUi,
    renderEmployeesList: renderEmployeesListUi,
} = require("./product-manager/ui/assignees-admin-ui");
const {
    updateGreeting: updateGreetingUi,
    updateLoginButton: updateLoginButtonUi,
    updateAdminControls: updateAdminControlsUi,
    syncSessionUI: syncSessionUi,
    applySharedSession: applySharedSessionUi,
} = require("./product-manager/ui/session-ui");
const {
    renderCategoryOptions: renderCategoryOptionsUi,
    renderCatalogFilterOptions: renderCatalogFilterOptionsUi,
    renderInterventionTypeOptions: renderInterventionTypeOptionsUi,
    renderCartTagFilterOptions: renderCartTagFilterOptionsUi,
} = require("./product-manager/ui/filters");
const {
    syncCatalogControls: syncCatalogControlsUi,
    initCatalogFilters: initCatalogFiltersUi,
} = require("./product-manager/ui/catalog-search");
const { renderCatalog: renderCatalogUi } = require("./product-manager/ui/catalog-view");
const { initCartFilters: initCartFiltersUi } = require("./product-manager/ui/cart-controls");
const { renderCartTable: renderCartTableUi } = require("./product-manager/ui/cart-table");
const { initExportModal: initExportModalUi } = require("./product-manager/ui/export");
const { initLogoutModal: initLogoutModalUi, initGuideModal: initGuideModalUi } = require("./product-manager/ui/app-init");
const { setupHeaderButtons: setupHeaderButtonsUi } = require("./product-manager/ui/header-buttons");
const { initSettingsModals: initSettingsModalsUi } = require("./product-manager/ui/settings-modals");
const { initCategoriesModal: initCategoriesModalUi, initInterventionTypesModal: initInterventionTypesModalUi } = require("./product-manager/ui/categories-modals");
const { initAddModal: initAddModalUi, initConfirmModal: initConfirmModalUi, initAlertModal: initAlertModalUi, initImageModal: initImageModalUi } = require("./product-manager/ui/basic-modals");
const { validators } = require("./product-manager/data/schemas");
const {
    getCatalogImagePath: getCatalogImagePathSvc,
    getCatalogImageSrc: getCatalogImageSrcSvc,
    ensureProductsDir: ensureProductsDirSvc,
    copyCatalogImage: copyCatalogImageSvc,
} = require("./product-manager/services/catalog-images");
const {
    normalizePriceCad,
    formatPriceCadDisplay,
    normalizeString,
    normalizeRequestLine,
    normalizeRequestsData,
    normalizeCatalogData,
    normalizeCategoriesData,
    normalizeInterventionTypesData,
    validateWithAjv,
    tryAutoCleanJson,
} = require("./product-manager/data/normalize");
const {
    REQUESTS_PATH,
    INTERVENTIONS_PATH,
    CATALOG_PATH,
    CATEGORIES_PATH,
    INTERVENTION_TYPES_PATH,
    PRODUCTS_DIR,
} = require("./product-manager/config/paths");
const {
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword,
    isValidEmail,
    isValidPhone,
} = require("./ferie-permessi/services/admins");
const {
    session,
    setSession,
    saveSession,
    loadSession,
    clearSession,
    applySharedSessionData,
    isAdmin,
    isEmployee,
    isLoggedIn,
} = require("./product-manager/state/session");
const { uiState } = require("./product-manager/state/ui");

const {
    validateRequestsSchema,
    validateCatalogSchema,
    validateCategoriesSchema,
    validateInterventionTypesSchema,
} = validators;

let XLSX = null;
try {
    XLSX = require("xlsx");
} catch (err) {
    console.error("Modulo 'xlsx' non trovato. Esegui: npm install xlsx");
}

window.pmLoaded = true;

const ASSIGNEES_FALLBACK = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-assignees.json";
// session handled by state/session
let assigneeGroups = {};
let assigneeOptions = [];
let editingDepartment = null;
let editingEmployee = null;
let adminCache = [];
let adminEditingIndex = -1;
let pendingPasswordAction = null;
let passwordFailCount = 0;
let requestLines = [];
let catalogItems = [];
let catalogCategories = [];
let interventionTypes = [];
let categoryColors = {};
let catalogFilterTag = "";
let catalogSearch = "";
let catalogSort = "name_asc";
let cartState = {
    search: "",
    urgency: "",
    tag: "",
    sort: "created_desc",
    editingKey: null,
    editingRow: null,
};

const { showModal, hideModal } = createModalHelpers({ document });

function assertFn(label, value) {
    if (typeof value !== "function") {
        throw new Error(`Modulo mancante o non valido: ${label}`);
    }
}

function validateModuleBindings() {
    assertFn("ui.messages.setMessage", setMessage);
    assertFn("ui.multiselect.openMultiselectMenu", openMultiselectMenu);
    assertFn("ui.multiselect.closeMultiselectMenu", closeMultiselectMenu);
    assertFn("ui.loginSelectors.renderLoginSelectors", renderLoginSelectorsUi);
    assertFn("ui.loginSelectors.renderAdminSelect", renderAdminSelectUi);
    assertFn("ui.catalogCells.buildProductCell", buildProductCellUi);
    assertFn("ui.catalogCells.buildUrlCell", buildUrlCellUi);
    assertFn("ui.imageViewer.openImageModal", openImageModalUi);
    assertFn("ui.imageViewer.closeImageModal", closeImageModalUi);
    assertFn("ui.authModals.openLoginModal", openLoginModalUi);
    assertFn("ui.authModals.closeLoginModal", closeLoginModalUi);
    assertFn("ui.authModals.openLogoutModal", openLogoutModalUi);
    assertFn("ui.authModals.closeLogoutModal", closeLogoutModalUi);
    assertFn("ui.confirmAlert.openConfirmModal", openConfirmModalUi);
    assertFn("ui.confirmAlert.closeConfirmModal", closeConfirmModalUi);
    assertFn("ui.confirmAlert.openAlertModal", openAlertModalUi);
    assertFn("ui.confirmAlert.closeAlertModal", closeAlertModalUi);
    assertFn("ui.notifications.showInfo", showInfoUi);
    assertFn("ui.notifications.showWarning", showWarningUi);
    assertFn("ui.notifications.showError", showErrorUi);
    assertFn("ui.notifications.requireLogin", requireLoginUi);
    assertFn("ui.notifications.requireAdminAccess", requireAdminAccessUi);
    assertFn("ui.categoriesLists.renderCategoriesList", renderCategoriesListUi);
    assertFn("ui.categoriesLists.renderInterventionTypesList", renderInterventionTypesListUi);
    assertFn("ui.assigneesAdminUi.renderDepartmentSelect", renderDepartmentSelectUi);
    assertFn("ui.assigneesAdminUi.renderDepartmentList", renderDepartmentListUi);
    assertFn("ui.assigneesAdminUi.renderEmployeesList", renderEmployeesListUi);
    assertFn("ui.sessionUi.updateGreeting", updateGreetingUi);
    assertFn("ui.sessionUi.updateLoginButton", updateLoginButtonUi);
    assertFn("ui.sessionUi.updateAdminControls", updateAdminControlsUi);
    assertFn("ui.sessionUi.syncSessionUI", syncSessionUi);
    assertFn("ui.sessionUi.applySharedSession", applySharedSessionUi);
    assertFn("services.catalogImages.getCatalogImagePath", getCatalogImagePathSvc);
    assertFn("services.catalogImages.getCatalogImageSrc", getCatalogImageSrcSvc);
    assertFn("services.catalogImages.ensureProductsDir", ensureProductsDirSvc);
    assertFn("services.catalogImages.copyCatalogImage", copyCatalogImageSvc);
    assertFn("ui.filters.renderCategoryOptions", renderCategoryOptionsUi);
    assertFn("ui.filters.renderCatalogFilterOptions", renderCatalogFilterOptionsUi);
    assertFn("ui.filters.renderInterventionTypeOptions", renderInterventionTypeOptionsUi);
    assertFn("ui.filters.renderCartTagFilterOptions", renderCartTagFilterOptionsUi);
    assertFn("ui.catalogControls.syncCatalogControls", syncCatalogControlsUi);
    assertFn("ui.catalogControls.initCatalogFilters", initCatalogFiltersUi);
    assertFn("ui.catalogView.renderCatalog", renderCatalogUi);
    assertFn("ui.cartControls.initCartFilters", initCartFiltersUi);
    assertFn("ui.cartTable.renderCartTable", renderCartTableUi);
    assertFn("ui.export.initExportModal", initExportModalUi);
    assertFn("ui.headerButtons.setupHeaderButtons", setupHeaderButtonsUi);
    assertFn("ui.settingsModals.initSettingsModals", initSettingsModalsUi);
    assertFn("ui.categoriesModals.initCategoriesModal", initCategoriesModalUi);
    assertFn("ui.categoriesModals.initInterventionTypesModal", initInterventionTypesModalUi);
    assertFn("ui.basicModals.initAddModal", initAddModalUi);
    assertFn("ui.basicModals.initConfirmModal", initConfirmModalUi);
    assertFn("ui.basicModals.initAlertModal", initAlertModalUi);
    assertFn("ui.basicModals.initImageModal", initImageModalUi);
}

const guideLocalPath = path.resolve(__dirname, "..", "..", "Guida", "aypi-purchasing", "index.html");
const guideLocalUrl = fs.existsSync(guideLocalPath) ? `${pathToFileURL(guideLocalPath).toString()}?embed=1` : "";

const guideUi = createGuideModal({
    document,
    showModal,
    hideModal,
    setMessage,
    guideUrl: GUIDE_URL || guideLocalUrl,
    guideSearchParam: GUIDE_SEARCH_PARAM,
    getTheme: () => {
        try {
            return window.localStorage.getItem("pm-theme") || "light";
        } catch {
            return "light";
        }
    },
});

const URGENCY_OPTIONS = ["Alta", "Media", "Bassa"];
const PLACEHOLDER_IMAGE =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='240'><rect width='100%' height='100%' fill='%23f1f3f4'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%239aa0a6' font-family='Arial' font-size='14'>Nessuna immagine</text></svg>";
const CATEGORY_COLOR_STORAGE_KEY = "pm-category-colors";
const DEFAULT_CATEGORY_COLORS = [
    "#e8f0fe",
    "#e6f4ea",
    "#fce8e6",
    "#fef7e0",
    "#ede7f6",
    "#e0f2f1",
    "#fff3e0",
    "#f3e5f5",
];

const REQUEST_MODES = {
    PURCHASE: "purchase",
    INTERVENTION: "intervention",
};
const REQUEST_MODE_STORAGE_KEY = "pm-request-mode";
const DEFAULT_REQUEST_MODE = REQUEST_MODES.PURCHASE;
let currentRequestMode = DEFAULT_REQUEST_MODE;

function isFormPage() {
    return Boolean(document.getElementById("pm-request-form"));
}

function getListMode() {
    return document.body?.dataset?.pmListMode || DEFAULT_REQUEST_MODE;
}

function getActiveMode() {
    const listMode = document.body?.dataset?.pmListMode;
    return listMode || currentRequestMode;
}

function isInterventionMode(mode = getActiveMode()) {
    return mode === REQUEST_MODES.INTERVENTION;
}

function loadStoredRequestMode() {
    try {
        const stored = window.localStorage.getItem(REQUEST_MODE_STORAGE_KEY);
        if (stored === REQUEST_MODES.INTERVENTION) return REQUEST_MODES.INTERVENTION;
        return REQUEST_MODES.PURCHASE;
    } catch {
        return REQUEST_MODES.PURCHASE;
    }
}

function storeRequestMode(mode) {
    try {
        window.localStorage.setItem(REQUEST_MODE_STORAGE_KEY, mode);
    } catch {}
}

function applyRequestModeUI() {
    if (!isFormPage()) return;
    const isIntervention = isInterventionMode(currentRequestMode);
    document.body.classList.toggle("pm-mode-intervention", isIntervention);
    const formTitle = document.getElementById("pm-form-title");
    const toggleBtn = document.getElementById("pm-toggle-request");
    const notesLabel = document.getElementById("pm-notes-label");
    const addLineBtn = document.getElementById("pm-add-line");
    const saveBtn = document.getElementById("pm-request-save");
    const subtitle = document.getElementById("pm-header-subtitle");
    if (formTitle) formTitle.textContent = isIntervention ? "Richiesta intervento" : "Nuova richiesta";
    if (toggleBtn) toggleBtn.textContent = isIntervention ? "Richiedi acquisto" : "Richiedi Intervento";
    if (notesLabel) notesLabel.textContent = isIntervention ? "Note generali intervento" : "Note generali";
    if (addLineBtn) addLineBtn.textContent = isIntervention ? "+ Aggiungi intervento" : "+ Aggiungi prodotto";
    if (saveBtn) saveBtn.textContent = isIntervention ? "Invia intervento" : "Invia richiesta";
    if (subtitle) {
        subtitle.textContent = isIntervention ? "Quale intervento vuoi richiedere?" : "Cosa vuoi ordinare?";
    }
}

function setRequestMode(mode, { persist = true, reset = true } = {}) {
    if (mode !== REQUEST_MODES.INTERVENTION && mode !== REQUEST_MODES.PURCHASE) {
        return;
    }
    currentRequestMode = mode;
    if (persist) storeRequestMode(mode);
    applyRequestModeUI();
    renderCatalog();
    if (reset) {
        showFormMessage("", "info");
        requestLines = [];
        renderLines();
    }
}

function initRequestModeToggle() {
    const toggleBtn = document.getElementById("pm-toggle-request");
    if (!toggleBtn) return;
    toggleBtn.addEventListener("click", () => {
        const next = isInterventionMode(currentRequestMode) ? REQUEST_MODES.PURCHASE : REQUEST_MODES.INTERVENTION;
        setRequestMode(next, { persist: true, reset: true });
    });
}

function createEmptyLine(mode = getActiveMode()) {
    if (isInterventionMode(mode)) {
        return {
            interventionType: "",
            description: "",
            urgency: "",
        };
    }
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
    const categoryWrap = document.createElement("div");
    categoryWrap.className = "pm-multiselect";
    const categoryDisplay = document.createElement("button");
    categoryDisplay.type = "button";
    categoryDisplay.className = "pm-multiselect__button";
    categoryDisplay.textContent = "Seleziona tipologie";
    const dropdown = document.createElement("div");
    dropdown.className = "pm-multiselect__menu is-hidden";
    const selected = new Set(toTags(line.category || ""));
    catalogCategories.forEach((cat) => {
        const option = document.createElement("label");
        option.className = "pm-multiselect__option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = cat;
        if (selected.has(cat)) checkbox.checked = true;
        const span = document.createElement("span");
        span.textContent = cat;
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                selected.add(cat);
            } else {
                selected.delete(cat);
            }
            const values = Array.from(selected.values());
            updateLineField(index, "category", values.join(", "));
            categoryDisplay.textContent = values.length ? values.join(", ") : "Seleziona tipologie";
        });
        option.append(checkbox, span);
        dropdown.appendChild(option);
    });
    categoryDisplay.addEventListener("click", (event) => {
        event.stopPropagation();
        if (dropdown.classList.contains("is-hidden")) {
            openMultiselectMenu(dropdown, categoryDisplay, categoryWrap);
        } else {
            closeMultiselectMenu(dropdown, categoryWrap);
        }
    });
    document.addEventListener("click", (event) => {
        if (!categoryWrap.contains(event.target) && !dropdown.contains(event.target)) {
            closeMultiselectMenu(dropdown, categoryWrap);
        }
    });
    categoryDisplay.textContent = selected.size ? Array.from(selected.values()).join(", ") : "Seleziona tipologie";
    categoryWrap.append(categoryDisplay, dropdown);
    categoryField.append(categoryLabel, categoryWrap);

    const quantityField = document.createElement("div");
    quantityField.className = "pm-field";
    const quantityLabel = document.createElement("label");
    quantityLabel.textContent = "Quantità";
    const quantityInput = document.createElement("input");
    quantityInput.className = "pm-qty-input";
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

function createInterventionLineElement(line, index) {
    const wrapper = document.createElement("div");
    wrapper.className = "pm-line";
    wrapper.dataset.index = String(index);

    const grid = document.createElement("div");
    grid.className = "pm-line-grid pm-line-grid--intervention";

    const typeField = document.createElement("div");
    typeField.className = "pm-field";
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Tipologia di intervento";
    const { wrap, selectedSet, button } = renderInterventionTypeOptions(
        toTags(line.interventionType || "")
    );
    const syncTypes = () => {
        const values = Array.from(selectedSet.values());
        updateLineField(index, "interventionType", values.join(", "));
        button.textContent = values.length ? values.join(", ") : "Seleziona tipologie";
    };
    wrap.addEventListener("change", syncTypes);
    typeField.append(typeLabel, wrap);

    const descField = document.createElement("div");
    descField.className = "pm-field";
    const descLabel = document.createElement("label");
    descLabel.textContent = "Descrizione";
    const descInput = document.createElement("textarea");
    descInput.rows = 2;
    descInput.value = line.description || "";
    descInput.placeholder = "Descrizione intervento";
    descInput.addEventListener("input", (event) =>
        updateLineField(index, "description", event.target.value)
    );
    descField.append(descLabel, descInput);

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

    grid.append(typeField, descField, urgencyField);

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

    wrapper.append(grid, actionsField);
    return wrapper;
}

function renderLines() {
    const container = document.getElementById("pm-lines");
    if (!container) return;
    container.innerHTML = "";
    if (!requestLines.length) {
        const emptyMessage = isInterventionMode()
            ? "Aggiungi un intervento per iniziare."
            : "Aggiungi un prodotto per iniziare.";
        container.innerHTML = `<div class="pm-message">${emptyMessage}</div>`;
        return;
    }
    requestLines.forEach((line, index) => {
        if (isInterventionMode()) {
            container.appendChild(createInterventionLineElement(line, index));
        } else {
            container.appendChild(createLineElement(line, index));
        }
    });
}

function addLine() {
    if (!requestLines.length) {
        requestLines = [];
    }
    requestLines.push(createEmptyLine());
    renderLines();
}

function addLineFromCatalog(item, quantity) {
    if (isInterventionMode()) {
        return;
    }
    if (!requestLines.length) {
        requestLines = [];
    }
    requestLines.push({
        product: item.name || "",
        category: item.category || "",
        quantity: quantity || "",
        unit: item.unit || "",
        urgency: "",
        url: item.url || "",
        note: "",
    });
    renderLines();
}

function renderCatalog() {
    renderCatalogUi({
        document,
        shell,
        isAdmin,
        catalogItems,
        catalogFilterTag,
        catalogSearch,
        catalogSort,
        toTags,
        getCatalogImageSrc,
        PLACEHOLDER_IMAGE,
        openImageModal,
        applyCategoryColor,
        addLineFromCatalog,
        requireLogin,
        showWarning,
        openConfirmModal,
        saveCatalog,
        setCatalogItems: (next) => {
            catalogItems = next;
        },
        rerenderCatalog: renderCatalog,
        openCatalogModal,
    });
}

function openCatalogModal(item = null) {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono aggiungere prodotti.");
        return;
    }
    const modal = document.getElementById("pm-catalog-modal");
    if (!modal) return;
    const title = document.getElementById("pm-catalog-title");
    const saveBtn = document.getElementById("pm-catalog-save");
    const idInput = document.getElementById("pm-catalog-id");
    const name = document.getElementById("pm-catalog-name");
    const desc = document.getElementById("pm-catalog-description");
    const category = document.getElementById("pm-catalog-category");
    const unit = document.getElementById("pm-catalog-unit");
    const url = document.getElementById("pm-catalog-url");
    const imageUrl = document.getElementById("pm-catalog-image-url");
    const image = document.getElementById("pm-catalog-image");
    const removeBtn = document.getElementById("pm-catalog-remove-image");
    const selectedTags = item ? toTags(item.category || "") : [];
    renderCategoryOptions(selectedTags);
    if (item) {
        if (title) title.textContent = "Modifica prodotto catalogo";
        if (saveBtn) saveBtn.textContent = "Salva modifiche";
        if (idInput) idInput.value = item.id || "";
        if (name) name.value = item.name || "";
        if (desc) desc.value = item.description || "";
        if (category) category.dataset.value = item.category || "";
        if (unit) unit.value = item.unit || "";
        if (url) url.value = item.url || "";
        if (imageUrl) imageUrl.value = item.imageUrl || "";
        if (image) {
            image.value = item.imageFile ? "Immagine presente" : "";
            image.dataset.path = "";
        }
        if (removeBtn) removeBtn.style.display = item.imageFile || item.imageUrl ? "inline-flex" : "none";
    } else {
        if (title) title.textContent = "Nuovo prodotto catalogo";
        if (saveBtn) saveBtn.textContent = "Salva prodotto";
        if (idInput) idInput.value = "";
        if (name) name.value = "";
        if (desc) desc.value = "";
        if (category) category.dataset.value = "";
        if (unit) unit.value = "";
        if (url) url.value = "";
        if (imageUrl) imageUrl.value = "";
        if (image) image.value = "";
        if (removeBtn) removeBtn.style.display = "none";
    }
    uiState.catalogRemoveImage = false;
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeCatalogModal() {
    const modal = document.getElementById("pm-catalog-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

function clearCatalogForm() {
    const ids = [
        "pm-catalog-id",
        "pm-catalog-name",
        "pm-catalog-description",
        "pm-catalog-category",
        "pm-catalog-unit",
        "pm-catalog-url",
        "pm-catalog-image-url",
        "pm-catalog-image",
    ];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
}

function saveCatalogItem() {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono aggiungere prodotti.");
        return;
    }
    const idInput = document.getElementById("pm-catalog-id");
    const name = document.getElementById("pm-catalog-name")?.value?.trim() || "";
    if (!name) {
        showWarning("Inserisci il nome prodotto.");
        return;
    }
    const categoryContainer = document.getElementById("pm-catalog-category");
    const category =
        categoryContainer && categoryContainer.querySelector(".pm-multiselect__button")
            ? categoryContainer.querySelector(".pm-multiselect__button").textContent
            : "";
    const imageInput = document.getElementById("pm-catalog-image");
    const imageUrlInput = document.getElementById("pm-catalog-image-url");
    const imageSource = imageInput && imageInput.dataset ? imageInput.dataset.path || "" : "";
    const existingId = idInput?.value?.trim() || "";
    const targetId = existingId || `CAT-${Date.now()}`;
    let imageFileName = "";
    if (imageSource) {
        imageFileName = copyCatalogImage(imageSource, targetId);
    }
    const item = {
        id: targetId,
        name,
        description: document.getElementById("pm-catalog-description")?.value?.trim() || "",
        category,
        unit: document.getElementById("pm-catalog-unit")?.value?.trim() || "",
        url: document.getElementById("pm-catalog-url")?.value?.trim() || "",
        imageUrl: imageUrlInput?.value?.trim() || "",
        imageFile: imageFileName,
        createdAt: new Date().toISOString(),
    };
    if (existingId) {
        catalogItems = catalogItems.map((entry) => {
            if (entry.id !== existingId) return entry;
            return {
                ...entry,
                ...item,
                imageUrl: item.imageUrl || entry.imageUrl || "",
                imageFile: uiState.catalogRemoveImage ? "" : imageFileName || entry.imageFile || "",
            };
        });
    } else {
        catalogItems.push(item);
    }
    if (saveCatalog(catalogItems)) {
        renderCatalog();
        clearCatalogForm();
        closeCatalogModal();
    }
}



function removeLine(index) {
    if (!requestLines.length) return;
    if (requestLines.length <= 1) {
        requestLines = [];
    } else {
        requestLines.splice(index, 1);
    }
    renderLines();
}

function getRequestsPath(mode) {
    return mode === REQUEST_MODES.INTERVENTION ? INTERVENTIONS_PATH : REQUESTS_PATH;
}

function readRequestsFile(mode = getActiveMode()) {
    const filePath = getRequestsPath(mode);
    try {
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        const normalized = normalizeRequestsData(parsed);
        validateWithAjv(validateRequestsSchema, normalized, "richieste", { showWarning, showError });
        tryAutoCleanJson(filePath, parsed, normalized, validateRequestsSchema, "richieste", {
            showWarning,
            showError,
        });
        return normalized;
    } catch (err) {
        showError("Errore lettura richieste.", err.message || String(err));
        return [];
    }
}

function saveRequestsFile(payload, mode = getActiveMode()) {
    const filePath = getRequestsPath(mode);
    try {
        const normalized = normalizeRequestsData(payload);
        if (
            !validateWithAjv(validateRequestsSchema, normalized, "richieste", {
                showWarning,
                showError,
            }).ok
        )
            return false;
        fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8");
        return true;
    } catch (err) {
        showError("Errore salvataggio richieste.", err.message || String(err));
        return false;
    }
}

function collectRequestPayload() {
    const notes = document.getElementById("pm-notes")?.value?.trim() || "";
    if (isInterventionMode()) {
        const cleanedLines = requestLines
            .map((line) => ({
                interventionType: (line.interventionType || line.type || "").trim(),
                description: (line.description || line.details || "").trim(),
                urgency: (line.urgency || "").trim(),
            }))
            .filter((line) => line.interventionType || line.description || line.urgency);

        return {
            notes,
            lines: cleanedLines,
        };
    }

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
    if (isInterventionMode()) {
        if (!payload.lines.length) return "Aggiungi almeno un intervento.";
        const invalidLine = payload.lines.find(
            (line) => !line.interventionType || !line.description || !line.urgency
        );
        if (invalidLine) {
            return "Compila tipologia, descrizione e urgenza per ogni riga.";
        }
        return "";
    }
    if (!payload.lines.length) return "Aggiungi almeno un prodotto.";
    const invalidLine = payload.lines.find(
        (line) => !line.product || !line.quantity || !line.unit || !line.urgency
    );
    if (invalidLine) {
        return "Compila prodotto, quantita, UM e urgenza per ogni riga.";
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
    requestLines = [];
    renderLines();
}

function toTags(raw) {
    if (!raw) return [];
    return raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function getInterventionType(line) {
    if (!line) return "";
    return normalizeString(line.interventionType || line.type);
}

function getInterventionDescription(line) {
    if (!line) return "";
    return normalizeString(line.description || line.details);
}

function normalizeHexColor(value, fallback) {
    if (!value || typeof value !== "string") return fallback || "#1a73e8";
    let next = value.trim().toLowerCase();
    if (!next.startsWith("#")) next = `#${next}`;
    if (/^#([0-9a-f]{3}){1,2}$/i.test(next)) {
        if (next.length === 4) {
            next = `#${next[1]}${next[1]}${next[2]}${next[2]}${next[3]}${next[3]}`;
        }
        return next;
    }
    return fallback || "#1a73e8";
}

function loadCategoryColors() {
    try {
        if (!window.localStorage) return {};
        const raw = window.localStorage.getItem(CATEGORY_COLOR_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        const cleaned = {};
        Object.keys(parsed).forEach((key) => {
            cleaned[key] = normalizeHexColor(parsed[key]);
        });
        return cleaned;
    } catch (err) {
        console.error("Errore lettura colori categorie:", err);
        return {};
    }
}

function saveCategoryColors(next) {
    try {
        if (!window.localStorage) return;
        window.localStorage.setItem(CATEGORY_COLOR_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
        console.error("Errore salvataggio colori categorie:", err);
    }
}

function hashCategoryToColor(value) {
    if (!value) return DEFAULT_CATEGORY_COLORS[0];
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) % DEFAULT_CATEGORY_COLORS.length;
    }
    return DEFAULT_CATEGORY_COLORS[Math.abs(hash) % DEFAULT_CATEGORY_COLORS.length];
}

function getCategoryColor(value) {
    if (!value) return DEFAULT_CATEGORY_COLORS[0];
    const stored = categoryColors[value];
    return stored || hashCategoryToColor(value);
}

function getContrastText(hex) {
    const clean = normalizeHexColor(hex, "#ffffff").replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 160 ? "#2b2b2b" : "#ffffff";
}

function applyCategoryColor(pill, tag) {
    const color = getCategoryColor(tag);
    pill.style.background = color;
    pill.style.color = getContrastText(color);
}

function buildProductCell(productName, tags) {
    return buildProductCellUi({ document, applyCategoryColor }, productName, tags);
}

function buildUrlCell(url, productName) {
    return buildUrlCellUi({ document, shell }, url, productName);
}

function formatDateDisplay(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("it-IT");
}

function renderCartTable() {
    renderCartTableUi({
        document,
        isAdmin,
        isInterventionMode,
        cartState,
        toTags,
        readRequestsFile,
        saveRequestsFile,
        REQUEST_MODES,
        formatPriceCadDisplay,
        formatDateDisplay,
        buildProductCell,
        buildUrlCell,
        getInterventionType,
        getInterventionDescription,
        openConfirmModal,
        confirmCartRow,
        deleteCartRow,
        openEditModal,
        openInterventionEditModal,
        openAddModal,
        isLoggedIn,
        renderCatalog,
        saveCatalog,
        catalogItems,
    });
}

function getEditFieldValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : "";
}

function openInterventionEditModal(row) {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono modificare.");
        return;
    }
    uiState.interventionEditingRow = row;
    const modal = document.getElementById("pm-intervention-edit-modal");
    if (!modal) return;
    const typeInput = document.getElementById("pm-intervention-edit-type");
    const descInput = document.getElementById("pm-intervention-edit-description");
    const urgencyInput = document.getElementById("pm-intervention-edit-urgency");
    if (typeInput) typeInput.value = row.interventionType || "";
    if (descInput) descInput.value = row.description || "";
    if (urgencyInput) urgencyInput.value = row.urgency || "";
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeInterventionEditModal() {
    const modal = document.getElementById("pm-intervention-edit-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
    uiState.interventionEditingRow = null;
}

function saveInterventionEditModal() {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono modificare.");
        return;
    }
    const row = uiState.interventionEditingRow;
    if (!row) return;
    const requests = readRequestsFile(REQUEST_MODES.INTERVENTION);
    const request = requests[row.requestIndex];
    if (!request || !request.lines || !request.lines[row.lineIndex]) {
        showError("Elemento non trovato.", "La riga potrebbe essere stata modificata da un altro utente.");
        return;
    }
    const line = request.lines[row.lineIndex];
    line.interventionType = getEditFieldValue("pm-intervention-edit-type").trim();
    line.description = getEditFieldValue("pm-intervention-edit-description").trim();
    line.urgency = getEditFieldValue("pm-intervention-edit-urgency").trim();
    request.history = Array.isArray(request.history) ? request.history : [];
    request.history.push({
        at: new Date().toISOString(),
        by: "admin",
        adminName: session.adminName || "",
        action: "line-updated",
    });
    if (saveRequestsFile(requests, REQUEST_MODES.INTERVENTION)) {
        closeInterventionEditModal();
        renderCartTable();
    }
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
    uiState.pendingAddRow = row;
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
    uiState.pendingAddRow = null;
}

function saveAddModal() {
    if (!uiState.pendingAddRow) {
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
        showWarning("QuantitÃ  non valida.");
        return;
    }

    const baseLine = uiState.pendingAddRow;
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
    initCartFiltersUi({
        document,
        cartState,
        renderCartTable,
        isAdmin,
        showWarning,
        openConfirmModal,
        getActiveMode,
        readRequestsFile,
        saveRequestsFile,
    });
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

function loadCatalog() {
    try {
        if (!fs.existsSync(CATALOG_PATH)) return [];
        const raw = fs.readFileSync(CATALOG_PATH, "utf8");
        const parsed = JSON.parse(raw);
        const normalized = normalizeCatalogData(parsed);
        validateWithAjv(validateCatalogSchema, normalized, "catalogo", { showWarning, showError });
        tryAutoCleanJson(CATALOG_PATH, parsed, normalized, validateCatalogSchema, "catalogo", {
            showWarning,
            showError,
        });
        return normalized;
    } catch (err) {
        console.error("Errore lettura catalogo:", err);
        return [];
    }
}

function saveCatalog(list) {
    try {
        const normalized = normalizeCatalogData(list);
        if (
            !validateWithAjv(validateCatalogSchema, normalized, "catalogo", {
                showWarning,
                showError,
            }).ok
        )
            return false;
        fs.writeFileSync(CATALOG_PATH, JSON.stringify(normalized, null, 2), "utf8");
        return true;
    } catch (err) {
        showError("Errore salvataggio catalogo.", err.message || String(err));
        return false;
    }
}

function loadCategories() {
    try {
        if (!fs.existsSync(CATEGORIES_PATH)) return [];
        const raw = fs.readFileSync(CATEGORIES_PATH, "utf8");
        const parsed = JSON.parse(raw);
        const normalized = normalizeCategoriesData(parsed);
        validateWithAjv(validateCategoriesSchema, normalized, "categorie", { showWarning, showError });
        tryAutoCleanJson(CATEGORIES_PATH, parsed, normalized, validateCategoriesSchema, "categorie", {
            showWarning,
            showError,
        });
        return normalized;
    } catch (err) {
        console.error("Errore lettura categorie:", err);
        return [];
    }
}

function saveCategories(list) {
    try {
        const normalized = normalizeCategoriesData(list);
        if (
            !validateWithAjv(validateCategoriesSchema, normalized, "categorie", {
                showWarning,
                showError,
            }).ok
        )
            return false;
        fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(normalized, null, 2), "utf8");
        return true;
    } catch (err) {
        showError("Errore salvataggio categorie.", err.message || String(err));
        return false;
    }
}

function loadInterventionTypes() {
    try {
        if (!fs.existsSync(INTERVENTION_TYPES_PATH)) return [];
        const raw = fs.readFileSync(INTERVENTION_TYPES_PATH, "utf8");
        const parsed = JSON.parse(raw);
        const normalized = normalizeInterventionTypesData(parsed);
        validateWithAjv(validateInterventionTypesSchema, normalized, "tipologie interventi", {
            showWarning,
            showError,
        });
        tryAutoCleanJson(
            INTERVENTION_TYPES_PATH,
            parsed,
            normalized,
            validateInterventionTypesSchema,
            "tipologie interventi",
            { showWarning, showError }
        );
        return normalized;
    } catch (err) {
        console.error("Errore lettura tipologie interventi:", err);
        return [];
    }
}

function saveInterventionTypes(list) {
    try {
        const normalized = normalizeInterventionTypesData(list);
        if (
            !validateWithAjv(validateInterventionTypesSchema, normalized, "tipologie interventi", {
                showWarning,
                showError,
            }).ok
        )
            return false;
        fs.writeFileSync(INTERVENTION_TYPES_PATH, JSON.stringify(normalized, null, 2), "utf8");
        return true;
    } catch (err) {
        showError("Errore salvataggio tipologie interventi.", err.message || String(err));
        return false;
    }
}

function renderCategoryOptions(selected = []) {
    renderCategoryOptionsUi({ document, catalogCategories, selected });
}

function renderCatalogFilterOptions() {
    renderCatalogFilterOptionsUi({
        document,
        isInterventionMode,
        catalogCategories,
        catalogFilterTag,
    });
}

function renderInterventionTypeOptions(selected = []) {
    return renderInterventionTypeOptionsUi({
        document,
        interventionTypes,
        openMultiselectMenu,
        closeMultiselectMenu,
        selected,
    });
}

function syncCatalogControls() {
    syncCatalogControlsUi({ document, isInterventionMode, catalogSearch, catalogSort });
}

function renderCartTagFilterOptions() {
    renderCartTagFilterOptionsUi({
        document,
        isInterventionMode,
        interventionTypes,
        catalogCategories,
        cartState,
        readRequestsFile,
        REQUEST_MODES,
        toTags,
        getInterventionType,
    });
}

function ensureProductsDir() {
    ensureProductsDirSvc({ fs, PRODUCTS_DIR });
}

function copyCatalogImage(filePath, catalogId) {
    return copyCatalogImageSvc({ fs, path, PRODUCTS_DIR, showError }, filePath, catalogId);
}

function getCatalogImagePath(item) {
    return getCatalogImagePathSvc({ path, PRODUCTS_DIR }, item);
}

function getCatalogImageSrc(item) {
    return getCatalogImageSrcSvc({ pathToFileURL, path, PRODUCTS_DIR }, item);
}

function findCatalogItemByName(name) {
    if (!name) return null;
    const lower = name.toLowerCase();
    return catalogItems.find((item) => (item.name || "").toLowerCase() === lower) || null;
}

function openImageModal(imageSrc, link, title) {
    openImageModalUi({ document, PLACEHOLDER_IMAGE }, imageSrc, link, title);
}

function closeImageModal() {
    closeImageModalUi({ document });
}

function openCategoryEditor(category) {
    const editor = document.getElementById("pm-category-editor");
    const title = document.getElementById("pm-category-editor-title");
    const colorInput = document.getElementById("pm-category-color-input");
    if (!editor || !colorInput) return;
    uiState.categoryEditingName = category;
    uiState.categoryColorSnapshot = { ...categoryColors };
    colorInput.value = getCategoryColor(category);
    if (title) title.textContent = `Colore ${category}`;
    editor.classList.remove("is-hidden");
}

function closeCategoryEditor(revert) {
    const editor = document.getElementById("pm-category-editor");
    if (!editor) return;
    editor.classList.add("is-hidden");
    if (revert && uiState.categoryColorSnapshot) {
        categoryColors = { ...uiState.categoryColorSnapshot };
        saveCategoryColors(categoryColors);
        renderCatalog();
        renderCartTable();
        renderCategoriesList();
    }
    uiState.categoryEditingName = null;
    uiState.categoryColorSnapshot = null;
}

function updateCategoryChipPreview(name, color) {
    const list = document.getElementById("pm-categories-list");
    if (!list) return;
    const chips = Array.from(list.querySelectorAll(".pm-category-chip"));
    const chip = chips.find((item) => item.dataset.category === name);
    if (!chip) return;
    chip.style.background = color;
    const dot = chip.querySelector(".pm-category-chip__dot");
    if (dot) dot.style.background = getContrastText(color);
}

function renderCategoriesList() {
    renderCategoriesListUi({
        document,
        catalogCategories: () => catalogCategories,
        getCategoryColors: () => categoryColors,
        getCategoryColor,
        getContrastText,
        openCategoryEditor,
        closeCategoriesModal,
        openConfirmModal,
        showWarning,
        saveCategories,
        saveCatalog,
        saveRequestsFile,
        readRequestsFile,
        toTags,
        renderCategoryOptions,
        renderCatalogFilterOptions,
        renderCartTagFilterOptions,
        renderCatalog,
        renderCartTable,
        setCatalogCategories: (next) => {
            catalogCategories = next;
        },
        setCategoryColors: (next) => {
            categoryColors = next;
        },
        getCatalogItems: () => catalogItems,
        setCatalogItems: (next) => {
            catalogItems = next;
        },
        saveCategoryColors,
    });
}

function renderInterventionTypesList() {
    renderInterventionTypesListUi({
        document,
        interventionTypes: () => interventionTypes,
        showWarning,
        closeInterventionTypesModal,
        openConfirmModal,
        readRequestsFile,
        saveRequestsFile,
        saveInterventionTypes,
        renderCartTagFilterOptions,
        renderLines,
        renderCartTable,
        getInterventionType,
        REQUEST_MODES,
        toTags,
        setInterventionTypes: (next) => {
            interventionTypes = next;
        },
    });
}

function openInterventionTypesModal() {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono gestire le tipologie.");
        return;
    }
    const modal = document.getElementById("pm-intervention-types-modal");
    if (!modal) return;
    renderInterventionTypesList();
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeInterventionTypesModal() {
    const modal = document.getElementById("pm-intervention-types-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

function addInterventionType() {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono gestire le tipologie.");
        return;
    }
    const input = document.getElementById("pm-intervention-type-name");
    const value = input?.value?.trim() || "";
    if (!value) return;
    if (interventionTypes.includes(value)) {
        showWarning("Tipologia giÃ  esistente.");
        return;
    }
    interventionTypes.push(value);
    if (saveInterventionTypes(interventionTypes)) {
        if (input) input.value = "";
        renderInterventionTypesList();
        renderCartTagFilterOptions();
        renderLines();
    }
}

function openCategoriesModal() {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono gestire le categorie.");
        return;
    }
    const modal = document.getElementById("pm-categories-modal");
    if (!modal) return;
    renderCategoriesList();
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeCategoriesModal() {
    const modal = document.getElementById("pm-categories-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
    closeCategoryEditor(true);
}

function addCategory() {
    if (!isAdmin()) {
        showWarning("Solo gli admin possono gestire le categorie.");
        return;
    }
    const input = document.getElementById("pm-category-name");
    const value = input?.value?.trim() || "";
    if (!value) return;
    if (catalogCategories.includes(value)) {
        showWarning("Categoria giÃ  esistente.");
        return;
    }
    catalogCategories.push(value);
    if (saveCategories(catalogCategories)) {
        if (input) input.value = "";
        renderCategoriesList();
        renderCategoryOptions();
    }
}

function updateGreeting() {
    updateGreetingUi({ document, isEmployee, isAdmin, session });
}

function updateLoginButton() {
    updateLoginButtonUi({ document, isAdmin, isEmployee, session });
}

function updateAdminControls() {
    updateAdminControlsUi({ document, isAdmin });
}

function syncSessionUI() {
    syncSessionUi({
        updateGreeting,
        updateLoginButton,
        updateAdminControls,
        renderCatalog,
        renderCategoryOptions,
        renderCatalogFilterOptions,
        renderCartTagFilterOptions,
        renderCartTable,
        renderLines,
    });
}

function applySharedSession(payload) {
    applySharedSessionUi({
        applySharedSessionData,
        closeLoginModal,
        closeLogoutModal,
        syncSessionUI,
        isLoggedIn,
        openLoginModal,
        document,
    }, payload);
}

function renderLoginSelectors() {
    renderLoginSelectorsUi({
        document,
        getAssigneeGroups: () => ({ ...assigneeGroups }),
    });
}

function renderAdminSelect() {
    renderAdminSelectUi({
        document,
        loadAdminCredentials,
    });
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
    openLoginModalUi({ document });
}

function closeLoginModal() {
    closeLoginModalUi({ document });
}

function openLogoutModal() {
    openLogoutModalUi({ document });
}

function closeLogoutModal() {
    closeLogoutModalUi({ document });
}

function openConfirmModal(message) {
    return openConfirmModalUi({ document, uiState }, message);
}

function closeConfirmModal(result = false) {
    closeConfirmModalUi({ document, uiState }, result);
}

let pendingAlertResolve = null;

function openAlertModal(title, message, detail = "") {
    return openAlertModalUi(
        {
            document,
            pendingAlertResolveSetter: (next) => {
                pendingAlertResolve = next;
            },
        },
        title,
        message,
        detail
    );
}

function closeAlertModal() {
    closeAlertModalUi({
        document,
        pendingAlertResolveGetter: () => pendingAlertResolve,
        pendingAlertResolveSetter: (next) => {
            pendingAlertResolve = next;
        },
    });
}

function showInfo(message, detail = "") {
    return showInfoUi({ document, sharedDialogs, openAlertModal }, message, detail);
}

function showWarning(message, detail = "") {
    return showWarningUi({ document, sharedDialogs, openAlertModal }, message, detail);
}

function showError(message, detail = "") {
    return showErrorUi({ document, sharedDialogs, openAlertModal }, message, detail);
}

function requireLogin() {
    return requireLoginUi({ isLoggedIn, showWarning, openLoginModal });
}

function requireAdminAccess(action) {
    return requireAdminAccessUi({ isAdmin, showWarning, openLoginModal }, action);
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
    renderDepartmentSelectUi({
        document,
        getAssigneeGroups: () => ({ ...assigneeGroups }),
    });
}

function renderDepartmentList() {
    renderDepartmentListUi({
        document,
        getAssigneeGroups: () => ({ ...assigneeGroups }),
        editingDepartment: () => editingDepartment,
        setEditingDepartment: (next) => {
            editingDepartment = next;
        },
        setAssigneeGroups: (next) => {
            assigneeGroups = { ...next };
        },
        saveAssignees,
        renderEmployeesList,
        renderDepartmentSelect,
        UI_TEXTS,
    });
}

function renderEmployeesList() {
    renderEmployeesListUi({
        document,
        getAssigneeGroups: () => ({ ...assigneeGroups }),
        editingEmployee: () => editingEmployee,
        setEditingEmployee: (next) => {
            editingEmployee = next;
        },
        saveAssignees,
        renderDepartmentSelect,
        renderLoginSelectors,
        UI_TEXTS,
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
    showDialog: sharedDialogs.showDialog,
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
            setSession({ role: "employee", adminName: "", department: dept, employee: emp });
            saveSession();
            syncSessionUI();
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
            setSession({ role: "admin", adminName: verified.admin.name, department: "", employee: "" });
            saveSession();
            syncSessionUI();
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

function initInterventionEditModal() {
    const closeBtn = document.getElementById("pm-intervention-edit-close");
    const cancelBtn = document.getElementById("pm-intervention-edit-cancel");
    const saveBtn = document.getElementById("pm-intervention-edit-save");
    if (closeBtn) closeBtn.addEventListener("click", () => closeInterventionEditModal());
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeInterventionEditModal());
    if (saveBtn) saveBtn.addEventListener("click", () => saveInterventionEditModal());
}

function initCatalogModal() {
    const openBtn = document.getElementById("pm-catalog-add");
    const closeBtn = document.getElementById("pm-catalog-close");
    const cancelBtn = document.getElementById("pm-catalog-cancel");
    const saveBtn = document.getElementById("pm-catalog-save");
    const browseBtn = document.getElementById("pm-catalog-browse");
    const imageInput = document.getElementById("pm-catalog-image");
    const removeBtn = document.getElementById("pm-catalog-remove-image");
    if (openBtn) openBtn.addEventListener("click", () => openCatalogModal());
    if (closeBtn) closeBtn.addEventListener("click", () => closeCatalogModal());
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeCatalogModal());
    if (saveBtn) saveBtn.addEventListener("click", () => saveCatalogItem());
    if (browseBtn) {
        browseBtn.addEventListener("click", async () => {
            try {
                const selected = await ipcRenderer.invoke("pm-select-image");
                if (selected && imageInput) {
                    imageInput.value = selected;
                    imageInput.dataset.path = selected;
                    uiState.catalogRemoveImage = false;
                }
            } catch (err) {
                showError(
                    "Selezione immagine non disponibile.",
                    "Riavvia AyPi per attivare il selettore immagini."
                );
            }
        });
    }
    if (removeBtn) {
        removeBtn.addEventListener("click", async () => {
            const confirmed = await openConfirmModal("Vuoi rimuovere l'immagine da questo prodotto?");
            if (!confirmed) return;
            if (imageInput) {
                imageInput.value = "";
                imageInput.dataset.path = "";
            }
            if (imageUrlInput) {
                imageUrlInput.value = "";
            }
            uiState.catalogRemoveImage = true;
        });
    }
}

function initCatalogFilters() {
    initCatalogFiltersUi({
        document,
        isInterventionMode,
        renderCatalog,
        getCatalogFilterTag: () => catalogFilterTag,
        setCatalogFilterTag: (value) => {
            catalogFilterTag = value;
        },
        getCatalogSearch: () => catalogSearch,
        setCatalogSearch: (value) => {
            catalogSearch = value;
        },
        getCatalogSort: () => catalogSort,
        setCatalogSort: (value) => {
            catalogSort = value;
        },
    });
}

function initCategoriesModal() {
    initCategoriesModalUi({
        document,
        normalizeHexColor,
        getCategoryColor,
        hashCategoryToColor,
        updateCategoryChipPreview,
        saveCategoryColors,
        closeCategoryEditor,
        renderCatalog,
        renderCartTable,
        uiState,
        openCategoriesModal,
        closeCategoriesModal,
        addCategory,
        categoryColors: () => categoryColors,
        setCategoryColors: (next) => {
            categoryColors = next;
        },
    });
}

function initInterventionTypesModal() {
    initInterventionTypesModalUi({
        document,
        openInterventionTypesModal,
        closeInterventionTypesModal,
        addInterventionType,
    });
}

function initAddModal() {
    initAddModalUi({
        document,
        closeAddModal,
        saveAddModal,
    });
}

function initConfirmModal() {
    initConfirmModalUi({
        document,
        closeConfirmModal,
    });
}

function initAlertModal() {
    initAlertModalUi({
        document,
        closeAlertModal,
    });
}

function initImageModal() {
    initImageModalUi({
        document,
        closeImageModal,
    });
}

function setupHeaderButtons() {
    setupHeaderButtonsUi({
        document,
        ipcRenderer,
        showError,
        requireLogin,
        syncAssignees,
        renderLoginSelectors,
        loadCatalog,
        loadCategories,
        loadInterventionTypes,
        renderCatalog,
        renderCatalogFilterOptions,
        syncCatalogControls,
        renderCartTagFilterOptions,
        renderCartTable,
        renderLines,
        isInterventionMode,
        collectRequestPayload,
        validateRequestPayload,
        showFormMessage,
        openConfirmModal,
        readRequestsFile,
        buildRequestRecord,
        saveRequestsFile,
        clearForm,
        addLine,
        setCatalogItems: (next) => {
            catalogItems = next;
        },
        setCatalogCategories: (next) => {
            catalogCategories = next;
        },
        setInterventionTypes: (next) => {
            interventionTypes = next;
        },
    });
}

function initSettingsModals() {
    initSettingsModalsUi({
        document,
        requireAdminAccess,
        assigneesUi,
        adminUi,
        initPasswordModal,
        openPasswordModal,
        UI_TEXTS,
    });
}

function initExportModal() {
    initExportModalUi({
        document,
        ipcRenderer,
        XLSX,
        isInterventionMode,
        getActiveMode,
        REQUEST_MODES,
        readRequestsFile,
        toTags,
        getInterventionType,
        getInterventionDescription,
        openMultiselectMenu,
        closeMultiselectMenu,
        showError,
        catalogCategories,
        interventionTypes,
    });
}

function initLogoutModal() {
    initLogoutModalUi({
        document,
        clearSession,
        syncSessionUI,
        closeLogoutModal,
    });
}

function initGuideModal() {
    initGuideModalUi({ guideUi });
}

async function init() {
    try {
        validateModuleBindings();
    } catch (err) {
        const detail = err && err.message ? err.message : String(err);
        showError("Errore caricamento moduli Product Manager.", detail);
        throw err;
    }
    const warning = document.getElementById("pm-js-warning");
    if (warning) warning.classList.add("is-hidden");
    await loadSession();
    syncAssignees();
    renderLoginSelectors();
    renderAdminSelect();
    catalogItems = loadCatalog();
    catalogCategories = loadCategories();
    interventionTypes = loadInterventionTypes();
    categoryColors = loadCategoryColors();
    renderCatalog();
    renderCategoryOptions();
    renderCatalogFilterOptions();
    syncCatalogControls();
    renderCartTagFilterOptions();
    if (isFormPage()) {
        currentRequestMode = REQUEST_MODES.PURCHASE;
        storeRequestMode(REQUEST_MODES.PURCHASE);
        applyRequestModeUI();
        renderCatalog();
        initRequestModeToggle();
    }
    requestLines = [];
    renderLines();
    renderCartTable();
    initCartFilters();
    initEditModal();
    initInterventionEditModal();
    initAddModal();
    initConfirmModal();
    initAlertModal();
    initCatalogModal();
    initCatalogFilters();
    initCategoriesModal();
    initInterventionTypesModal();
    initImageModal();
    initExportModal();
    setupLogin();
    setupHeaderButtons();
    initSettingsModals();
    initLogoutModal();
    initGuideModal();
    updateGreeting();
    updateLoginButton();
    updateAdminControls();
    if (document.getElementById("pm-request-form") && !isLoggedIn()) {
        openLoginModal();
    }
}

window.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => {
        showError("Errore inizializzazione Product Manager.", err.message || String(err));
    });
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

async function refreshSessionFromMain() {
    try {
        const shared = await ipcRenderer.invoke("pm-session-get");
        applySharedSession(shared);
    } catch (err) {
        console.error("Errore sync sessione:", err);
    }
}

window.addEventListener("focus", () => {
    refreshSessionFromMain();
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        refreshSessionFromMain();
    }
});

window.addEventListener("message", (event) => {
    if (!event || !event.data) return;
    if (event.data.type === "guide-close") {
        const modal = document.getElementById("fp-guide-modal");
        if (modal) hideModal(modal);
    }
});

ipcRenderer.on("pm-force-logout", (_event, shouldLogout) => {
    if (!shouldLogout) return;
    clearSession();
    syncSessionUI();
    if (document.getElementById("pm-request-form")) {
        openLoginModal();
    }
});

ipcRenderer.on("pm-session-updated", (_event, payload) => {
    applySharedSession(payload);
});

