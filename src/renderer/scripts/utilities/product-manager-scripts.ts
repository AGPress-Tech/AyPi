// @ts-nocheck
require("../shared/dev-guards");
import { ipcRenderer, shell } from "electron";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import * as sharedDialogs from "../shared/dialogs";
import { NETWORK_PATHS } from "../../../main/config/paths";
import { createModalHelpers } from "./ferie-permessi/ui/modals";
import { createAdminModals } from "./ferie-permessi/ui/admin-modals";
import { UI_TEXTS } from "./ferie-permessi/utils/ui-texts";
import {
    isHashingAvailable,
    hashPassword,
    getAuthenticator,
    otpState,
    resetOtpState,
} from "./ferie-permessi/config/security";
import {
    GUIDE_URL,
    GUIDE_SEARCH_PARAM,
    OTP_EXPIRY_MS,
    OTP_RESEND_MS,
} from "./ferie-permessi/config/constants";
import { createGuideModal } from "./ferie-permessi/ui/guide-modal";
import { createOtpModals } from "./ferie-permessi/ui/otp-modals";
import { setMessage } from "./product-manager/ui/messages";
import {
    openMultiselectMenu,
    closeMultiselectMenu,
} from "./product-manager/ui/multiselect";
import {
    renderLoginSelectors as renderLoginSelectorsUi,
    renderAdminSelect as renderAdminSelectUi,
} from "./product-manager/ui/login-selectors";
import { initCustomSelects as initCustomSelectsUi } from "./product-manager/ui/custom-select";
import {
    buildProductCell as buildProductCellUi,
    buildUrlCell as buildUrlCellUi,
} from "./product-manager/ui/catalog-cells";
import {
    openImageModal as openImageModalUi,
    closeImageModal as closeImageModalUi,
} from "./product-manager/ui/image-viewer";
import {
    openLoginModal as openLoginModalUi,
    closeLoginModal as closeLoginModalUi,
    openLogoutModal as openLogoutModalUi,
    closeLogoutModal as closeLogoutModalUi,
} from "./product-manager/ui/auth-modals";
import {
    openConfirmModal as openConfirmModalUi,
    closeConfirmModal as closeConfirmModalUi,
    openAlertModal as openAlertModalUi,
    closeAlertModal as closeAlertModalUi,
} from "./product-manager/ui/confirm-alert";
import {
    showInfo as showInfoUi,
    showWarning as showWarningUi,
    showError as showErrorUi,
    requireLogin as requireLoginUi,
    requireAdminAccess as requireAdminAccessUi,
} from "./product-manager/ui/notifications";
import {
    renderCategoriesList as renderCategoriesListUi,
    renderInterventionTypesList as renderInterventionTypesListUi,
} from "./product-manager/ui/categories-lists";
import {
    renderDepartmentSelect as renderDepartmentSelectUi,
    renderDepartmentList as renderDepartmentListUi,
    renderEmployeesList as renderEmployeesListUi,
} from "./product-manager/ui/assignees-admin-ui";
import {
    normalizeHexColor as normalizeHexColorSection,
    loadCategoryColors as loadCategoryColorsSection,
    saveCategoryColors as saveCategoryColorsSection,
    hashCategoryToColor as hashCategoryToColorSection,
    getCategoryColor as getCategoryColorSection,
    getContrastText as getContrastTextSection,
    applyCategoryColor as applyCategoryColorSection,
    updateCategoryChipPreview as updateCategoryChipPreviewSection,
    openCategoryEditor as openCategoryEditorSection,
    closeCategoryEditor as closeCategoryEditorSection,
    loadCatalog as loadCatalogSection,
    saveCatalog as saveCatalogSection,
    loadCategories as loadCategoriesSection,
    saveCategories as saveCategoriesSection,
    renderCatalog as renderCatalogSection,
    openCatalogModal as openCatalogModalSection,
    closeCatalogModal as closeCatalogModalSection,
    clearCatalogForm as clearCatalogFormSection,
    saveCatalogItem as saveCatalogItemSection,
    openCategoriesModal as openCategoriesModalSection,
    closeCategoriesModal as closeCategoriesModalSection,
    addCategory as addCategorySection,
} from "./product-manager/sections/catalog";
import {
    getInterventionType as getInterventionTypeSection,
    getInterventionDescription as getInterventionDescriptionSection,
    loadInterventionTypes as loadInterventionTypesSection,
    saveInterventionTypes as saveInterventionTypesSection,
    openInterventionTypesModal as openInterventionTypesModalSection,
    closeInterventionTypesModal as closeInterventionTypesModalSection,
    addInterventionType as addInterventionTypeSection,
} from "./product-manager/sections/interventions";
import {
    updateGreeting as updateGreetingUi,
    updateLoginButton as updateLoginButtonUi,
    updateAdminControls as updateAdminControlsUi,
    syncSessionUI as syncSessionUi,
    applySharedSession as applySharedSessionUi,
} from "./product-manager/ui/session-ui";
import {
    renderCategoryOptions as renderCategoryOptionsUi,
    renderCatalogFilterOptions as renderCatalogFilterOptionsUi,
    renderInterventionTypeOptions as renderInterventionTypeOptionsUi,
    renderCartTagFilterOptions as renderCartTagFilterOptionsUi,
    renderCartUrgencyFilterOptions as renderCartUrgencyFilterOptionsUi,
} from "./product-manager/ui/filters";
import {
    syncCatalogControls as syncCatalogControlsUi,
    initCatalogFilters as initCatalogFiltersUi,
} from "./product-manager/ui/catalog-search";
import { renderCatalog as renderCatalogUi } from "./product-manager/ui/catalog-view";
import { initCartFilters as initCartFiltersUi } from "./product-manager/ui/cart-controls";
import { renderCartTable as renderCartTableUi } from "./product-manager/ui/cart-table";
import { initExportModal as initExportModalUi } from "./product-manager/ui/export";
import {
    initLogoutModal as initLogoutModalUi,
    initGuideModal as initGuideModalUi,
} from "./product-manager/ui/app-init";
import { setupHeaderButtons as setupHeaderButtonsUi } from "./product-manager/ui/header-buttons";
import { initSettingsModals as initSettingsModalsUi } from "./product-manager/ui/settings-modals";
import {
    initCategoriesModal as initCategoriesModalUi,
    initInterventionTypesModal as initInterventionTypesModalUi,
} from "./product-manager/ui/categories-modals";
import {
    initAddModal as initAddModalUi,
    initConfirmModal as initConfirmModalUi,
    initAlertModal as initAlertModalUi,
    initImageModal as initImageModalUi,
} from "./product-manager/ui/basic-modals";
import { validators } from "./product-manager/data/schemas";
import {
    getCatalogImagePath as getCatalogImagePathSvc,
    getCatalogImageSrc as getCatalogImageSrcSvc,
    ensureProductsDir as ensureProductsDirSvc,
    copyCatalogImage as copyCatalogImageSvc,
} from "./product-manager/services/catalog-images";
import {
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
} from "./product-manager/data/normalize";
import {
    ROOT_DIR,
    PURCHASING_DIR,
    REQUESTS_PATH,
    INTERVENTIONS_PATH,
    CATALOG_PATH,
    CATEGORIES_PATH,
    INTERVENTION_TYPES_PATH,
    PRODUCTS_DIR,
    REQUESTS_SHARDS_DIR,
    INTERVENTIONS_SHARDS_DIR,
} from "./product-manager/config/paths";
import {
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword,
    findAdminByName,
    isValidEmail,
    isValidPhone,
} from "./ferie-permessi/services/admins";
import {
    isMailerAvailable,
    getMailerError,
    sendOtpEmail,
} from "./ferie-permessi/services/otp-mail";
import {
    session,
    setSession,
    saveSession,
    loadSession,
    clearSession,
    applySharedSessionData,
    isAdmin,
    isEmployee,
    isLoggedIn,
} from "./product-manager/state/session";
import { uiState } from "./product-manager/state/ui";

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

const ASSIGNEES_FALLBACK =
    "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-assignees.json";
const ROOT_SHARED_DIR = path.dirname(
    NETWORK_PATHS?.feriePermessiData || ASSIGNEES_FALLBACK,
);
const GENERAL_ASSIGNEES_PATH = path.join(
    ROOT_SHARED_DIR,
    "General",
    "amministrazione-assignees.json",
);
const ASSIGNEES_PATHS = [
    GENERAL_ASSIGNEES_PATH,
    NETWORK_PATHS?.amministrazioneAssignees || ASSIGNEES_FALLBACK,
];
// session handled by state/session
let assigneeGroups = {};
let assigneeOptions = [];
let assigneeEmails = {};
let editingDepartment = null;
let editingEmployee = null;
let adminCache = [];
let adminEditingIndex = -1;
let pendingPasswordAction = null;
let passwordFailCount = 0;
let adminLoginFailCount = 0;
let requestLines = [];
let catalogItems = [];
let catalogCategories = [];
let interventionTypes = [];
let categoryColors = {};
let catalogFilterTag = [];
let catalogSearch = "";
let catalogSort = "name_asc";
let cartState = {
    search: "",
    urgency: [],
    tag: [],
    sort: "created_desc",
    editingKey: null,
    editingRow: null,
};

const { showModal, hideModal } = createModalHelpers({ document });

function getCatalogSectionCtx() {
    return {
        document,
        window,
        uiState,
        shell,
        fs,
        path,
        pathToFileURL,
        CATEGORY_COLOR_STORAGE_KEY,
        DEFAULT_CATEGORY_COLORS,
        CATALOG_PATH,
        CATEGORIES_PATH,
        normalizeCatalogData,
        normalizeCategoriesData,
        validateWithAjv,
        validateCatalogSchema,
        validateCategoriesSchema,
        tryAutoCleanJson,
        renderCatalogUi,
        showWarning,
        showError,
        isAdmin,
        toTags,
        getCatalogImageSrc,
        PLACEHOLDER_IMAGE,
        openImageModal,
        applyCategoryColor,
        addLineFromCatalog,
        requireLogin,
        openConfirmModal,
        saveCatalog,
        renderCategoryOptions,
        renderCategoriesList,
        renderCatalogFilterOptions,
        renderCartTagFilterOptions,
        renderCatalog,
        renderCartTable,
        openCatalogModal,
        getCatalogItems: () => catalogItems,
        setCatalogItems: (next) => {
            catalogItems = next;
        },
        getCatalogCategories: () => catalogCategories,
        setCatalogCategories: (next) => {
            catalogCategories = next;
        },
        getCategoryColors: () => categoryColors,
        setCategoryColors: (next) => {
            categoryColors = next;
        },
        getCatalogFilterTag: () => catalogFilterTag,
        getCatalogSearch: () => catalogSearch,
        getCatalogSort: () => catalogSort,
        setCatalogFilterTag: (next) => {
            catalogFilterTag = next;
        },
        setCatalogSearch: (next) => {
            catalogSearch = next;
        },
        setCatalogSort: (next) => {
            catalogSort = next;
        },
        copyCatalogImage,
        saveCategories,
        saveCategoryColors,
        saveRequestsFile,
        readRequestsFile,
        getCategoryColor,
        getContrastText,
        openCategoryEditor,
        closeCategoryEditor,
        updateCategoryChipPreview,
        openCategoriesModal,
        closeCategoriesModal,
        addCategory,
    };
}

function getInterventionsSectionCtx() {
    return {
        document,
        fs,
        INTERVENTION_TYPES_PATH,
        normalizeInterventionTypesData,
        validateWithAjv,
        validateInterventionTypesSchema,
        tryAutoCleanJson,
        showWarning,
        showError,
        isAdmin,
        renderInterventionTypesList,
        renderCartTagFilterOptions,
        renderLines,
        getInterventionTypes: () => interventionTypes,
        setInterventionTypes: (next) => {
            interventionTypes = next;
        },
        normalizeString,
        saveInterventionTypes,
    };
}

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
    assertFn(
        "ui.categoriesLists.renderInterventionTypesList",
        renderInterventionTypesListUi,
    );
    assertFn(
        "ui.assigneesAdminUi.renderDepartmentSelect",
        renderDepartmentSelectUi,
    );
    assertFn(
        "ui.assigneesAdminUi.renderDepartmentList",
        renderDepartmentListUi,
    );
    assertFn("ui.assigneesAdminUi.renderEmployeesList", renderEmployeesListUi);
    assertFn("sections.catalog.normalizeHexColor", normalizeHexColorSection);
    assertFn("sections.catalog.loadCategoryColors", loadCategoryColorsSection);
    assertFn("sections.catalog.saveCategoryColors", saveCategoryColorsSection);
    assertFn(
        "sections.catalog.hashCategoryToColor",
        hashCategoryToColorSection,
    );
    assertFn("sections.catalog.getCategoryColor", getCategoryColorSection);
    assertFn("sections.catalog.getContrastText", getContrastTextSection);
    assertFn("sections.catalog.applyCategoryColor", applyCategoryColorSection);
    assertFn(
        "sections.catalog.updateCategoryChipPreview",
        updateCategoryChipPreviewSection,
    );
    assertFn("sections.catalog.openCategoryEditor", openCategoryEditorSection);
    assertFn(
        "sections.catalog.closeCategoryEditor",
        closeCategoryEditorSection,
    );
    assertFn("sections.catalog.loadCatalog", loadCatalogSection);
    assertFn("sections.catalog.saveCatalog", saveCatalogSection);
    assertFn("sections.catalog.loadCategories", loadCategoriesSection);
    assertFn("sections.catalog.saveCategories", saveCategoriesSection);
    assertFn("sections.catalog.renderCatalog", renderCatalogSection);
    assertFn("sections.catalog.openCatalogModal", openCatalogModalSection);
    assertFn("sections.catalog.closeCatalogModal", closeCatalogModalSection);
    assertFn("sections.catalog.clearCatalogForm", clearCatalogFormSection);
    assertFn("sections.catalog.saveCatalogItem", saveCatalogItemSection);
    assertFn(
        "sections.catalog.openCategoriesModal",
        openCategoriesModalSection,
    );
    assertFn(
        "sections.catalog.closeCategoriesModal",
        closeCategoriesModalSection,
    );
    assertFn("sections.catalog.addCategory", addCategorySection);
    assertFn(
        "sections.interventions.getInterventionType",
        getInterventionTypeSection,
    );
    assertFn(
        "sections.interventions.getInterventionDescription",
        getInterventionDescriptionSection,
    );
    assertFn(
        "sections.interventions.loadInterventionTypes",
        loadInterventionTypesSection,
    );
    assertFn(
        "sections.interventions.saveInterventionTypes",
        saveInterventionTypesSection,
    );
    assertFn(
        "sections.interventions.openInterventionTypesModal",
        openInterventionTypesModalSection,
    );
    assertFn(
        "sections.interventions.closeInterventionTypesModal",
        closeInterventionTypesModalSection,
    );
    assertFn(
        "sections.interventions.addInterventionType",
        addInterventionTypeSection,
    );
    assertFn("ui.sessionUi.updateGreeting", updateGreetingUi);
    assertFn("ui.sessionUi.updateLoginButton", updateLoginButtonUi);
    assertFn("ui.sessionUi.updateAdminControls", updateAdminControlsUi);
    assertFn("ui.sessionUi.syncSessionUI", syncSessionUi);
    assertFn("ui.sessionUi.applySharedSession", applySharedSessionUi);
    assertFn(
        "services.catalogImages.getCatalogImagePath",
        getCatalogImagePathSvc,
    );
    assertFn(
        "services.catalogImages.getCatalogImageSrc",
        getCatalogImageSrcSvc,
    );
    assertFn("services.catalogImages.ensureProductsDir", ensureProductsDirSvc);
    assertFn("services.catalogImages.copyCatalogImage", copyCatalogImageSvc);
    assertFn("ui.filters.renderCategoryOptions", renderCategoryOptionsUi);
    assertFn(
        "ui.filters.renderCatalogFilterOptions",
        renderCatalogFilterOptionsUi,
    );
    assertFn(
        "ui.filters.renderInterventionTypeOptions",
        renderInterventionTypeOptionsUi,
    );
    assertFn(
        "ui.filters.renderCartTagFilterOptions",
        renderCartTagFilterOptionsUi,
    );
    assertFn("ui.catalogControls.syncCatalogControls", syncCatalogControlsUi);
    assertFn("ui.catalogControls.initCatalogFilters", initCatalogFiltersUi);
    assertFn("ui.catalogView.renderCatalog", renderCatalogUi);
    assertFn("ui.cartControls.initCartFilters", initCartFiltersUi);
    assertFn("ui.cartTable.renderCartTable", renderCartTableUi);
    assertFn("ui.export.initExportModal", initExportModalUi);
    assertFn("ui.headerButtons.setupHeaderButtons", setupHeaderButtonsUi);
    assertFn("ui.settingsModals.initSettingsModals", initSettingsModalsUi);
    assertFn("ui.categoriesModals.initCategoriesModal", initCategoriesModalUi);
    assertFn(
        "ui.categoriesModals.initInterventionTypesModal",
        initInterventionTypesModalUi,
    );
    assertFn("ui.basicModals.initAddModal", initAddModalUi);
    assertFn("ui.basicModals.initConfirmModal", initConfirmModalUi);
    assertFn("ui.basicModals.initAlertModal", initAlertModalUi);
    assertFn("ui.basicModals.initImageModal", initImageModalUi);
}

const guideLocalPath = path.resolve(
    __dirname,
    "..",
    "..",
    "Guida",
    "aypi-purchasing",
    "index.html",
);
const guideLocalUrl = fs.existsSync(guideLocalPath)
    ? `${pathToFileURL(guideLocalPath).toString()}?embed=1`
    : "";

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
const PURCHASING_BACKUP_ROOT_DIR = path.join(
    ROOT_DIR,
    "Backup AyPi Purchasing",
);

function isFormPage() {
    return Boolean(document.getElementById("pm-request-form"));
}

function ensureDir(targetDir) {
    if (!targetDir) return;
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
}

function copyDirectory(sourceDir, targetDir) {
    if (!sourceDir || !targetDir) return;
    ensureDir(targetDir);
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    entries.forEach((entry) => {
        const srcPath = path.join(sourceDir, entry.name);
        const dstPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            copyDirectory(srcPath, dstPath);
            return;
        }
        if (entry.isFile()) {
            ensureDir(path.dirname(dstPath));
            fs.copyFileSync(srcPath, dstPath);
        }
    });
}

function formatBackupDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function getPurchasingBackups() {
    if (!fs.existsSync(PURCHASING_BACKUP_ROOT_DIR)) return [];
    return fs
        .readdirSync(PURCHASING_BACKUP_ROOT_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const fullPath = path.join(PURCHASING_BACKUP_ROOT_DIR, entry.name);
            let mtime = 0;
            try {
                mtime = fs.statSync(fullPath).mtimeMs || 0;
            } catch (err) {
                mtime = 0;
            }
            return { name: entry.name, fullPath, mtime };
        })
        .sort((a, b) => b.mtime - a.mtime);
}

function prunePurchasingBackups(limit = 10) {
    const backups = getPurchasingBackups();
    if (backups.length <= limit) return;
    backups.slice(limit).forEach((entry) => {
        try {
            fs.rmSync(entry.fullPath, { recursive: true, force: true });
        } catch (err) {
            console.error(
                "Errore rimozione backup Purchasing:",
                entry.fullPath,
                err,
            );
        }
    });
}

function initPurchasingBackupModal() {
    const modal = document.getElementById("pm-backup-modal");
    const closeBtn = document.getElementById("pm-backup-close");
    const runBtn = document.getElementById("pm-backup-run");
    const restoreBtn = document.getElementById("pm-backup-restore");
    const messageEl = document.getElementById("pm-backup-message");

    const setBackupMessage = (text, type = "") => {
        if (!messageEl) return;
        setMessage(messageEl, text, type === "error");
    };

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            hideModal(modal);
        });
    }

    if (runBtn) {
        runBtn.addEventListener("click", () => {
            try {
                setBackupMessage("", "");
                ensureDir(PURCHASING_DIR);
                ensureDir(PURCHASING_BACKUP_ROOT_DIR);
                const dateLabel = formatBackupDate(new Date());
                let targetDir = path.join(
                    PURCHASING_BACKUP_ROOT_DIR,
                    dateLabel,
                );
                let suffix = 1;
                while (fs.existsSync(targetDir)) {
                    suffix += 1;
                    targetDir = path.join(
                        PURCHASING_BACKUP_ROOT_DIR,
                        `${dateLabel}-${suffix}`,
                    );
                }
                copyDirectory(PURCHASING_DIR, targetDir);
                prunePurchasingBackups(10);
                setBackupMessage(`Backup creato: ${targetDir}`, "success");
            } catch (err) {
                setBackupMessage(
                    `Errore creazione backup: ${err.message || String(err)}`,
                    "error",
                );
            }
        });
    }

    if (restoreBtn) {
        restoreBtn.addEventListener("click", async () => {
            try {
                setBackupMessage("", "");
                const ok = await openConfirmModal(
                    "Ripristinare un backup Purchasing? I file correnti verranno sovrascritti.",
                );
                if (!ok) return;
                const selected = await ipcRenderer.invoke("select-root-folder");
                if (!selected) return;
                ensureDir(PURCHASING_DIR);
                copyDirectory(selected, PURCHASING_DIR);
                renderCartTable();
                setBackupMessage("Ripristino completato.", "success");
            } catch (err) {
                setBackupMessage(
                    `Errore ripristino backup: ${err.message || String(err)}`,
                    "error",
                );
            }
        });
    }
}

function openPurchasingBackup() {
    requireAdminAccess(() => {
        const modal = document.getElementById("pm-backup-modal");
        const messageEl = document.getElementById("pm-backup-message");
        if (messageEl) setMessage(messageEl, "", "");
        if (modal) showModal(modal);
    });
}

function getActiveMode() {
    const listMode = document.body?.dataset?.pmListMode;
    return listMode || currentRequestMode;
}

function isInterventionMode(mode = getActiveMode()) {
    return mode === REQUEST_MODES.INTERVENTION;
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
    if (formTitle)
        formTitle.textContent = isIntervention
            ? "Richiesta intervento"
            : "Nuova richiesta";
    if (toggleBtn)
        toggleBtn.textContent = isIntervention
            ? "Richiedi acquisto"
            : "Richiedi Intervento";
    if (notesLabel)
        notesLabel.textContent = isIntervention
            ? "Note generali intervento"
            : "Note generali";
    if (addLineBtn)
        addLineBtn.textContent = isIntervention
            ? "+ Aggiungi intervento"
            : "+ Aggiungi prodotto";
    if (saveBtn)
        saveBtn.textContent = isIntervention
            ? "Invia intervento"
            : "Invia richiesta";
    if (subtitle) {
        subtitle.textContent = isIntervention
            ? "Quale intervento vuoi richiedere?"
            : "Cosa vuoi ordinare?";
    }
}

function setRequestMode(mode, { persist = true, reset = true } = {}) {
    if (
        mode !== REQUEST_MODES.INTERVENTION &&
        mode !== REQUEST_MODES.PURCHASE
    ) {
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
        const next = isInterventionMode(currentRequestMode)
            ? REQUEST_MODES.PURCHASE
            : REQUEST_MODES.INTERVENTION;
        setRequestMode(next, { persist: true, reset: true });
    });
}

function createEmptyLine(mode = getActiveMode()) {
    if (isInterventionMode(mode)) {
        return {
            interventionType: "",
            description: "",
            urgency: "Bassa",
        };
    }
    return {
        product: "",
        category: "",
        quantity: "",
        unit: "",
        urgency: "Bassa",
        supplier: "",
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
        updateLineField(index, "product", event.target.value),
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
    const updateCategoryDisplay = (values) => {
        if (!values.length) {
            categoryDisplay.textContent = "Seleziona tipologie";
            return;
        }
        if (values.length > 2) {
            categoryDisplay.textContent = `${values.slice(0, 2).join(", ")} +${values.length - 2} more`;
            return;
        }
        categoryDisplay.textContent = values.join(", ");
    };
    updateCategoryDisplay([]);
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
            updateCategoryDisplay(values);
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
        if (
            !categoryWrap.contains(event.target) &&
            !dropdown.contains(event.target)
        ) {
            closeMultiselectMenu(dropdown, categoryWrap);
        }
    });
    updateCategoryDisplay(Array.from(selected.values()));
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
        updateLineField(index, "quantity", event.target.value),
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
        updateLineField(index, "unit", event.target.value),
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
        updateLineField(index, "urgency", event.target.value),
    );
    urgencyField.append(urgencyLabel, urgencySelect);

    grid.append(
        productField,
        categoryField,
        quantityField,
        unitField,
        urgencyField,
    );

    const secondary = document.createElement("div");
    secondary.className = "pm-line-grid pm-line-grid--secondary";

    const supplierField = document.createElement("div");
    supplierField.className = "pm-field";
    const supplierLabel = document.createElement("label");
    supplierLabel.textContent = "Fornitore";
    const supplierInput = document.createElement("input");
    supplierInput.type = "text";
    supplierInput.value = line.supplier || "";
    supplierInput.placeholder = "Nome fornitore (opzionale)";
    supplierInput.addEventListener("input", (event) =>
        updateLineField(index, "supplier", event.target.value),
    );
    supplierField.append(supplierLabel, supplierInput);

    const urlField = document.createElement("div");
    urlField.className = "pm-field";
    const urlLabel = document.createElement("label");
    urlLabel.textContent = "URL";
    const urlInput = document.createElement("input");
    urlInput.type = "text";
    urlInput.value = line.url;
    urlInput.placeholder = "Link prodotto (opzionale)";
    urlInput.addEventListener("input", (event) =>
        updateLineField(index, "url", event.target.value),
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
        updateLineField(index, "note", event.target.value),
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

    secondary.append(supplierField, urlField, noteField, actionsField);

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
    const { wrap } = renderInterventionTypeOptions(
        toTags(line.interventionType || ""),
        (values) => {
            updateLineField(index, "interventionType", values.join(", "));
        },
    );
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
        updateLineField(index, "description", event.target.value),
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
        updateLineField(index, "urgency", event.target.value),
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
    initCustomSelectsUi({ document, selector: "#pm-lines select" });
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
        urgency: "Bassa",
        supplier: item.supplier || "",
        url: item.url || "",
        note: "",
    });
    renderLines();
}

function renderCatalog() {
    return renderCatalogSection(getCatalogSectionCtx());
}

function openCatalogModal(item = null) {
    return openCatalogModalSection(getCatalogSectionCtx(), item);
}

function closeCatalogModal() {
    return closeCatalogModalSection(getCatalogSectionCtx());
}

function clearCatalogForm() {
    return clearCatalogFormSection(getCatalogSectionCtx());
}

function saveCatalogItem() {
    return saveCatalogItemSection(getCatalogSectionCtx());
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
    return mode === REQUEST_MODES.INTERVENTION
        ? INTERVENTIONS_PATH
        : REQUESTS_PATH;
}

const REQUESTS_SHARD_REGEX = /^requests-(\d{4}|undated)\.json$/i;
const INTERVENTIONS_SHARD_REGEX = /^interventions-(\d{4}|undated)\.json$/i;

function getRequestYearKey(request) {
    const value = String(request?.createdAt || request?.updatedAt || "").trim();
    if (!value) return "undated";
    const direct = /^(\d{4})/.exec(value);
    if (direct) return direct[1];
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return String(date.getFullYear());
    return "undated";
}

function getInterventionYearKey(request) {
    const value = String(request?.createdAt || request?.updatedAt || "").trim();
    if (!value) return "undated";
    const direct = /^(\d{4})/.exec(value);
    if (direct) return direct[1];
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return String(date.getFullYear());
    return "undated";
}

function getShardLatestMtimeMs() {
    try {
        if (!fs.existsSync(REQUESTS_SHARDS_DIR)) return 0;
        const files = fs
            .readdirSync(REQUESTS_SHARDS_DIR)
            .filter((name) => REQUESTS_SHARD_REGEX.test(name));
        let latest = 0;
        files.forEach((name) => {
            try {
                const ms =
                    Number(
                        fs.statSync(path.join(REQUESTS_SHARDS_DIR, name))
                            .mtimeMs,
                    ) || 0;
                if (ms > latest) latest = ms;
            } catch {}
        });
        return latest;
    } catch {
        return 0;
    }
}

function getInterventionShardLatestMtimeMs() {
    try {
        if (!fs.existsSync(INTERVENTIONS_SHARDS_DIR)) return 0;
        const files = fs
            .readdirSync(INTERVENTIONS_SHARDS_DIR)
            .filter((name) => INTERVENTIONS_SHARD_REGEX.test(name));
        let latest = 0;
        files.forEach((name) => {
            try {
                const ms =
                    Number(
                        fs.statSync(path.join(INTERVENTIONS_SHARDS_DIR, name))
                            .mtimeMs,
                    ) || 0;
                if (ms > latest) latest = ms;
            } catch {}
        });
        return latest;
    } catch {
        return 0;
    }
}

function hasPurchasingShards() {
    try {
        if (!fs.existsSync(REQUESTS_SHARDS_DIR)) return false;
        return fs
            .readdirSync(REQUESTS_SHARDS_DIR)
            .some((name) => REQUESTS_SHARD_REGEX.test(name));
    } catch {
        return false;
    }
}

function hasInterventionShards() {
    try {
        if (!fs.existsSync(INTERVENTIONS_SHARDS_DIR)) return false;
        return fs
            .readdirSync(INTERVENTIONS_SHARDS_DIR)
            .some((name) => INTERVENTIONS_SHARD_REGEX.test(name));
    } catch {
        return false;
    }
}

function readRequestsFromShards() {
    try {
        if (!fs.existsSync(REQUESTS_SHARDS_DIR)) return null;
        const files = fs
            .readdirSync(REQUESTS_SHARDS_DIR)
            .filter((name) => REQUESTS_SHARD_REGEX.test(name))
            .sort();
        if (!files.length) return null;
        const out = [];
        files.forEach((name) => {
            const raw = fs.readFileSync(
                path.join(REQUESTS_SHARDS_DIR, name),
                "utf8",
            );
            const parsed = JSON.parse(raw);
            normalizeRequestsData(parsed).forEach((row) => out.push(row));
        });
        return out;
    } catch (err) {
        showError(
            "Errore lettura shard richieste.",
            err.message || String(err),
        );
        return null;
    }
}

function readInterventionsFromShards() {
    try {
        if (!fs.existsSync(INTERVENTIONS_SHARDS_DIR)) return null;
        const files = fs
            .readdirSync(INTERVENTIONS_SHARDS_DIR)
            .filter((name) => INTERVENTIONS_SHARD_REGEX.test(name))
            .sort();
        if (!files.length) return null;
        const out = [];
        files.forEach((name) => {
            const raw = fs.readFileSync(
                path.join(INTERVENTIONS_SHARDS_DIR, name),
                "utf8",
            );
            const parsed = JSON.parse(raw);
            normalizeRequestsData(parsed).forEach((row) => out.push(row));
        });
        return out;
    } catch (err) {
        showError(
            "Errore lettura shard interventi.",
            err.message || String(err),
        );
        return null;
    }
}

function writeRequestsShards(payload) {
    const normalized = normalizeRequestsData(payload);
    try {
        if (!fs.existsSync(REQUESTS_SHARDS_DIR)) {
            fs.mkdirSync(REQUESTS_SHARDS_DIR, { recursive: true });
        }
        const buckets = {};
        normalized.forEach((item) => {
            const year = getRequestYearKey(item);
            if (!buckets[year]) buckets[year] = [];
            buckets[year].push(item);
        });
        const expected = new Set();
        Object.keys(buckets).forEach((year) => {
            const fileName = `requests-${year}.json`;
            expected.add(fileName.toLowerCase());
            fs.writeFileSync(
                path.join(REQUESTS_SHARDS_DIR, fileName),
                JSON.stringify(buckets[year], null, 2),
                "utf8",
            );
        });
        const existing = fs.readdirSync(REQUESTS_SHARDS_DIR);
        existing.forEach((name) => {
            if (!REQUESTS_SHARD_REGEX.test(name)) return;
            if (expected.has(name.toLowerCase())) return;
            fs.unlinkSync(path.join(REQUESTS_SHARDS_DIR, name));
        });
    } catch (err) {
        showError(
            "Errore salvataggio shard richieste.",
            err.message || String(err),
        );
    }
}

function writeInterventionsShards(payload) {
    const normalized = normalizeRequestsData(payload);
    try {
        if (!fs.existsSync(INTERVENTIONS_SHARDS_DIR)) {
            fs.mkdirSync(INTERVENTIONS_SHARDS_DIR, { recursive: true });
        }
        const buckets = {};
        normalized.forEach((item) => {
            const year = getInterventionYearKey(item);
            if (!buckets[year]) buckets[year] = [];
            buckets[year].push(item);
        });
        const expected = new Set();
        Object.keys(buckets).forEach((year) => {
            const fileName = `interventions-${year}.json`;
            expected.add(fileName.toLowerCase());
            fs.writeFileSync(
                path.join(INTERVENTIONS_SHARDS_DIR, fileName),
                JSON.stringify(buckets[year], null, 2),
                "utf8",
            );
        });
        const existing = fs.readdirSync(INTERVENTIONS_SHARDS_DIR);
        existing.forEach((name) => {
            if (!INTERVENTIONS_SHARD_REGEX.test(name)) return;
            if (expected.has(name.toLowerCase())) return;
            fs.unlinkSync(path.join(INTERVENTIONS_SHARDS_DIR, name));
        });
    } catch (err) {
        showError(
            "Errore salvataggio shard interventi.",
            err.message || String(err),
        );
    }
}

function readRequestsFile(mode = getActiveMode()) {
    const filePath = getRequestsPath(mode);
    try {
        if (mode === REQUEST_MODES.INTERVENTION) {
            const candidates = [];
            if (filePath && fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, "utf8");
                const parsed = JSON.parse(raw);
                const normalized = normalizeRequestsData(parsed);
                const ms = Number(fs.statSync(filePath).mtimeMs) || 0;
                if (normalized.length)
                    candidates.push({ data: normalized, ms });
            }
            const shardData = readInterventionsFromShards();
            const shardHasItems =
                Array.isArray(shardData) && shardData.length > 0;
            if (shardHasItems) {
                const ms = getInterventionShardLatestMtimeMs();
                candidates.push({ data: shardData, ms });
            }
            if (!candidates.length) {
                return [];
            }
            const best = candidates.sort((a, b) => b.ms - a.ms)[0];
            validateWithAjv(validateRequestsSchema, best.data, "richieste", {
                showWarning,
                showError,
            });
            return best.data;
        }

        const primaryExists = filePath && fs.existsSync(filePath);
        const primaryData = primaryExists
            ? normalizeRequestsData(
                  JSON.parse(fs.readFileSync(filePath, "utf8")),
              )
            : null;
        const primaryHasItems =
            Array.isArray(primaryData) && primaryData.length > 0;
        const shardData = readRequestsFromShards();
        const shardHasItems = Array.isArray(shardData) && shardData.length > 0;
        const candidates = [];
        if (primaryHasItems) {
            const ms = Number(fs.statSync(filePath).mtimeMs) || 0;
            candidates.push({ data: primaryData, ms });
        }
        if (shardHasItems) {
            const ms = getShardLatestMtimeMs();
            candidates.push({ data: shardData, ms });
        }
        if (!candidates.length) {
            return [];
        }
        const best = candidates.sort((a, b) => b.ms - a.ms)[0];
        validateWithAjv(validateRequestsSchema, best.data, "richieste", {
            showWarning,
            showError,
        });
        return best.data;
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
        if (mode === REQUEST_MODES.INTERVENTION) {
            fs.writeFileSync(
                filePath,
                JSON.stringify(normalized, null, 2),
                "utf8",
            );
            writeInterventionsShards(normalized);
        } else {
            fs.writeFileSync(
                filePath,
                JSON.stringify(normalized, null, 2),
                "utf8",
            );
            writeRequestsShards(normalized);
        }
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
                interventionType: (
                    line.interventionType ||
                    line.type ||
                    ""
                ).trim(),
                description: (line.description || line.details || "").trim(),
                urgency: (line.urgency || "").trim(),
            }))
            .filter(
                (line) =>
                    line.interventionType || line.description || line.urgency,
            );

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
            supplier: (line.supplier || "").trim(),
            url: (line.url || "").trim(),
            note: (line.note || "").trim(),
        }))
        .filter(
            (line) =>
                line.product ||
                line.quantity ||
                line.unit ||
                line.category ||
                line.urgency,
        );

    return {
        notes,
        lines: cleanedLines,
    };
}

function validateRequestPayload(payload) {
    if (isInterventionMode()) {
        if (!payload.lines.length) return "Aggiungi almeno un intervento.";
        const invalidLine = payload.lines.find(
            (line) =>
                !line.interventionType || !line.description || !line.urgency,
        );
        if (invalidLine) {
            return "Compila tipologia, descrizione e urgenza per ogni riga.";
        }
        return "";
    }
    if (!payload.lines.length) return "Aggiungi almeno un prodotto.";
    const invalidLine = payload.lines.find(
        (line) =>
            !line.product || !line.quantity || !line.unit || !line.urgency,
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
        session.employee ||
        (session.role === "admin" ? session.adminName || "Admin" : "");
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
    message.classList.remove(
        "is-hidden",
        "pm-message--error",
        "pm-message--success",
    );
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
    return getInterventionTypeSection(getInterventionsSectionCtx(), line);
}

function getInterventionDescription(line) {
    return getInterventionDescriptionSection(
        getInterventionsSectionCtx(),
        line,
    );
}

function normalizeHexColor(value, fallback) {
    return normalizeHexColorSection(getCatalogSectionCtx(), value, fallback);
}

function loadCategoryColors() {
    return loadCategoryColorsSection(getCatalogSectionCtx());
}

function saveCategoryColors(next) {
    return saveCategoryColorsSection(getCatalogSectionCtx(), next);
}

function hashCategoryToColor(value) {
    return hashCategoryToColorSection(getCatalogSectionCtx(), value);
}

function getCategoryColor(value) {
    return getCategoryColorSection(getCatalogSectionCtx(), value);
}

function getContrastText(hex) {
    return getContrastTextSection(getCatalogSectionCtx(), hex);
}

function applyCategoryColor(pill, tag) {
    return applyCategoryColorSection(getCatalogSectionCtx(), pill, tag);
}

function buildProductCell(productName, tags) {
    return buildProductCellUi(
        { document, applyCategoryColor },
        productName,
        tags,
    );
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
    const descInput = document.getElementById(
        "pm-intervention-edit-description",
    );
    const urgencyInput = document.getElementById(
        "pm-intervention-edit-urgency",
    );
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
        showError(
            "Elemento non trovato.",
            "La riga potrebbe essere stata modificata da un altro utente.",
        );
        return;
    }
    const line = request.lines[row.lineIndex];
    line.interventionType = getEditFieldValue(
        "pm-intervention-edit-type",
    ).trim();
    line.description = getEditFieldValue(
        "pm-intervention-edit-description",
    ).trim();
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
    const supplier = document.getElementById("pm-edit-supplier");
    const url = document.getElementById("pm-edit-url");
    const price = document.getElementById("pm-edit-price");
    const note = document.getElementById("pm-edit-note");
    if (product) product.value = row.product || "";
    if (tags) tags.value = row.tags.join(", ");
    if (quantity) quantity.value = row.quantity || "";
    if (unit) unit.value = row.unit || "";
    if (urgency) urgency.value = row.urgency || "";
    if (supplier) supplier.value = row.supplier || "";
    if (url) url.value = row.url || "";
    if (price)
        price.value = row.priceCad
            ? String(row.priceCad).replace(/[^\d.,-]/g, "")
            : "";
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
        showError(
            "Elemento non trovato.",
            "La riga potrebbe essere stata modificata da un altro utente.",
        );
        return;
    }
    const line = request.lines[row.lineIndex];
    line.product = getEditFieldValue("pm-edit-product").trim();
    line.category = getEditFieldValue("pm-edit-tags").trim();
    line.quantity = getEditFieldValue("pm-edit-quantity").toString().trim();
    line.unit = getEditFieldValue("pm-edit-unit").trim();
    line.urgency = getEditFieldValue("pm-edit-urgency").trim();
    line.supplier = getEditFieldValue("pm-edit-supplier").trim();
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
        showWarning("QuantitÃƒÂ  non valida.");
        return;
    }

    const baseLine = uiState.pendingAddRow;
    const newLine = {
        product: baseLine.product || "",
        category: baseLine.tags
            ? baseLine.tags.join(", ")
            : baseLine.category || "",
        quantity: qty,
        unit: baseLine.unit || "",
        urgency: baseLine.urgency || "",
        supplier: baseLine.supplier || "",
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
        showError(
            "Elemento non trovato.",
            "La riga potrebbe essere stata modificata da un altro utente.",
        );
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
        showError(
            "Elemento non trovato.",
            "La riga potrebbe essere stata modificata da un altro utente.",
        );
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
        const rawGroups =
            parsed.groups && typeof parsed.groups === "object"
                ? parsed.groups
                : parsed;
        const rawEmails =
            parsed.emails && typeof parsed.emails === "object"
                ? parsed.emails
                : {};
        const groups = {};
        const emails = {};
        Object.keys(rawGroups).forEach((key) => {
            const list = Array.isArray(rawGroups[key]) ? rawGroups[key] : [];
            const names = [];
            list.forEach((entry) => {
                if (typeof entry === "string") {
                    const name = entry.trim();
                    if (!name) return;
                    names.push(name);
                    return;
                }
                if (entry && typeof entry === "object") {
                    const name = String(entry.name || "").trim();
                    const email = String(entry.email || "").trim();
                    if (!name) return;
                    names.push(name);
                    if (email) emails[`${key}|${name}`] = email;
                }
            });
            groups[key] = names;
        });
        Object.keys(rawEmails).forEach((k) => {
            const value = String(rawEmails[k] || "").trim();
            if (!value) return;
            if (!emails[k]) emails[k] = value;
        });
        const options = Object.values(groups).flat();
        return { groups, options, emails };
    }
    return { groups: {}, options: [], emails: {} };
}

function loadAssignees() {
    const pathHint =
        ASSIGNEES_PATHS.find((item) => item && fs.existsSync(item)) ||
        ASSIGNEES_PATHS[0];
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
    try {
        const payload = JSON.stringify(
            {
                groups: assigneeGroups,
                emails: assigneeEmails || {},
            },
            null,
            2,
        );
        ASSIGNEES_PATHS.forEach((pathHint) => {
            if (!pathHint) return;
            const dir = path.dirname(pathHint);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(pathHint, payload, "utf8");
        });
    } catch (err) {
        showError("Errore salvataggio dipendenti.", err.message || String(err));
    }
}

function syncAssignees() {
    const payload = loadAssignees();
    assigneeGroups = payload.groups || {};
    assigneeOptions = payload.options || [];
    assigneeEmails = payload.emails || {};
    if (!Object.keys(assigneeGroups).length) {
        showWarning(
            "Elenco dipendenti non disponibile.",
            "Impossibile leggere amministrazione-assignees.json dal server.",
        );
    }
}

function loadCatalog() {
    return loadCatalogSection(getCatalogSectionCtx());
}

function saveCatalog(list) {
    return saveCatalogSection(getCatalogSectionCtx(), list);
}

function loadCategories() {
    return loadCategoriesSection(getCatalogSectionCtx());
}

function saveCategories(list) {
    return saveCategoriesSection(getCatalogSectionCtx(), list);
}

function loadInterventionTypes() {
    return loadInterventionTypesSection(getInterventionsSectionCtx());
}

function saveInterventionTypes(list) {
    return saveInterventionTypesSection(getInterventionsSectionCtx(), list);
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
        openMultiselectMenu,
        closeMultiselectMenu,
        onChange: (values) => {
            catalogFilterTag = values;
            renderCatalog();
        },
    });
}

function renderInterventionTypeOptions(selected = [], onChange) {
    return renderInterventionTypeOptionsUi({
        document,
        interventionTypes,
        openMultiselectMenu,
        closeMultiselectMenu,
        selected,
        onChange,
    });
}

function syncCatalogControls() {
    syncCatalogControlsUi({
        document,
        isInterventionMode,
        catalogSearch,
        catalogSort,
    });
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
        openMultiselectMenu,
        closeMultiselectMenu,
        onChange: (values) => {
            cartState.tag = Array.isArray(values)
                ? values.filter((value) => value)
                : [];
            renderCartTable();
        },
    });
}

function renderCartUrgencyFilterOptions() {
    renderCartUrgencyFilterOptionsUi({
        document,
        cartState,
        openMultiselectMenu,
        closeMultiselectMenu,
        onChange: (values) => {
            cartState.urgency = Array.isArray(values)
                ? values.filter((value) => value)
                : [];
            renderCartTable();
        },
    });
}

function ensureProductsDir() {
    ensureProductsDirSvc({
        fs,
        PRODUCTS_DIR,
    });
}

function copyCatalogImage(filePath, catalogId) {
    return copyCatalogImageSvc(
        {
            fs,
            path,
            PRODUCTS_DIR,
            showError,
        },
        filePath,
        catalogId,
    );
}

function getCatalogImagePath(item) {
    return getCatalogImagePathSvc(
        {
            fs,
            path,
            PRODUCTS_DIR,
        },
        item,
    );
}

function getCatalogImageSrc(item) {
    return getCatalogImageSrcSvc(
        { fs, pathToFileURL, path, PRODUCTS_DIR },
        item,
    );
}

function openImageModal(imageSrc, link, title) {
    openImageModalUi({ document, PLACEHOLDER_IMAGE }, imageSrc, link, title);
}

function closeImageModal() {
    closeImageModalUi({ document });
}

function openCategoryEditor(category) {
    return openCategoryEditorSection(getCatalogSectionCtx(), category);
}

function closeCategoryEditor(revert) {
    return closeCategoryEditorSection(getCatalogSectionCtx(), revert);
}

function updateCategoryChipPreview(name, color) {
    return updateCategoryChipPreviewSection(
        getCatalogSectionCtx(),
        name,
        color,
    );
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
    return openInterventionTypesModalSection(getInterventionsSectionCtx());
}

function closeInterventionTypesModal() {
    return closeInterventionTypesModalSection(getInterventionsSectionCtx());
}

function addInterventionType() {
    return addInterventionTypeSection(getInterventionsSectionCtx());
}

function openCategoriesModal() {
    return openCategoriesModalSection(getCatalogSectionCtx());
}

function closeCategoriesModal() {
    return closeCategoriesModalSection(getCatalogSectionCtx());
}

function addCategory() {
    return addCategorySection(getCatalogSectionCtx());
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
    applySharedSessionUi(
        {
            applySharedSessionData,
            closeLoginModal,
            closeLogoutModal,
            syncSessionUI,
            isLoggedIn,
            openLoginModal,
            document,
        },
        payload,
    );
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
        detail,
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
    return showInfoUi(
        { document, sharedDialogs, openAlertModal },
        message,
        detail,
    );
}

function showWarning(message, detail = "") {
    return showWarningUi(
        { document, sharedDialogs, openAlertModal },
        message,
        detail,
    );
}

function showError(message, detail = "") {
    return showErrorUi(
        { document, sharedDialogs, openAlertModal },
        message,
        detail,
    );
}

function requireLogin() {
    return requireLoginUi({ isLoggedIn, showWarning, openLoginModal });
}

function requireAdminAccess(action) {
    return requireAdminAccessUi(
        { isAdmin, showWarning, openLoginModal },
        action,
    );
}

function openPasswordModal(action) {
    pendingPasswordAction = action || null;
    const modal = document.getElementById("fp-approve-modal");
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const recover = document.getElementById("fp-approve-recover");
    const title = document.getElementById("fp-approve-title");
    const desc = document.getElementById("fp-approve-desc");
    if (!modal || !input) return;
    if (title && action?.title) title.textContent = action.title;
    if (desc && action?.description) desc.textContent = action.description;
    showModal(modal);
    if (error) error.classList.add("is-hidden");
    if (recover) recover.classList.add("is-hidden");
    input.value = "";
    setTimeout(() => {
        input.focus();
        input.select?.();
    }, 0);
}

async function confirmPassword() {
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const recover = document.getElementById("fp-approve-recover");
    const password = input ? input.value : "";
    const action = pendingPasswordAction;
    if (!action) {
        if (error) error.classList.add("is-hidden");
        if (recover) recover.classList.add("is-hidden");
        return;
    }
    const targetName = action?.adminName || action?.id || "";
    const shouldCheckAny = action.type === "admin-access";
    const result = await verifyAdminPassword(
        password,
        shouldCheckAny ? undefined : targetName || undefined,
    );
    if (!result || !result.admin) {
        if (error) error.classList.remove("is-hidden");
        passwordFailCount += 1;
        if (recover && passwordFailCount >= 3) {
            recover.classList.remove("is-hidden");
        }
        return;
    }
    passwordFailCount = 0;
    if (error) error.classList.add("is-hidden");
    if (recover) recover.classList.add("is-hidden");
    hideModal(document.getElementById("fp-approve-modal"));

    if (action.type === "admin-access") {
        adminUi.openAdminModal();
        return;
    }
    if (action.type === "admin-delete") {
        const adminName = action.adminName || "";
        adminCache = adminCache.length ? adminCache : loadAdminCredentials();
        if (adminCache.length <= 1) {
            setAdminMessage(
                "fp-admin-message",
                UI_TEXTS.adminMinRequired,
                true,
            );
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
    const recover = document.getElementById("fp-approve-recover");
    const input = document.getElementById("fp-approve-password");
    if (cancel)
        cancel.addEventListener("click", () =>
            hideModal(document.getElementById("fp-approve-modal")),
        );
    if (confirm) confirm.addEventListener("click", confirmPassword);
    if (input) {
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                confirmPassword();
            } else if (event.key === "Escape") {
                event.preventDefault();
                hideModal(document.getElementById("fp-approve-modal"));
            }
        });
    }
    if (recover) {
        recover.addEventListener("click", () => {
            hideModal(document.getElementById("fp-approve-modal"));
            openOtpModal();
        });
    }
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
        getAssigneeEmails: () => ({ ...(assigneeEmails || {}) }),
        setAssigneeEmails: (next) => {
            assigneeEmails =
                next && typeof next === "object" ? { ...next } : {};
        },
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
        getAssigneeEmails: () => ({ ...(assigneeEmails || {}) }),
        setAssigneeEmails: (next) => {
            assigneeEmails =
                next && typeof next === "object" ? { ...next } : {};
        },
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

const otpUi = createOtpModals({
    document,
    showModal,
    hideModal,
    setMessage,
    showDialog: sharedDialogs.showDialog,
    isMailerAvailable,
    getMailerError,
    sendOtpEmail,
    findAdminByName,
    getAdminCache,
    saveAdminCredentials,
    getAuthenticator,
    otpState,
    resetOtpState,
    isHashingAvailable,
    hashPassword,
    OTP_EXPIRY_MS,
    OTP_RESEND_MS,
});

function openOtpModal() {
    otpUi.openOtpModal();
}

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
    const employeeConfirm = document.getElementById(
        "pm-login-employee-confirm",
    );
    const adminConfirm = document.getElementById("pm-login-admin-confirm");
    const adminError = document.getElementById("pm-login-admin-error");
    const adminRecover = document.getElementById("pm-login-admin-recover");
    const employeeDepartment = document.getElementById("pm-login-department");
    const employeeName = document.getElementById("pm-login-employee-name");
    const adminNameInput = document.getElementById("pm-login-admin-name");
    const adminPasswordInput = document.getElementById(
        "pm-login-admin-password",
    );

    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            if (isLoggedIn()) {
                openLogoutModal();
                return;
            }
            openLoginModal();
            adminLoginFailCount = 0;
            if (adminError) adminError.classList.add("is-hidden");
            if (adminRecover) adminRecover.classList.add("is-hidden");
        });
    }

    if (loginClose) {
        loginClose.addEventListener("click", () => {
            closeLoginModal();
            adminLoginFailCount = 0;
            if (adminError) adminError.classList.add("is-hidden");
            if (adminRecover) adminRecover.classList.add("is-hidden");
        });
    }

    if (choiceEmployee) {
        choiceEmployee.addEventListener("click", () => {
            if (employeePanel) employeePanel.classList.remove("is-hidden");
            if (adminPanel) adminPanel.classList.add("is-hidden");
            choiceEmployee.classList.add("is-active");
            if (choiceAdmin) choiceAdmin.classList.remove("is-active");
            adminLoginFailCount = 0;
            if (adminError) adminError.classList.add("is-hidden");
            if (adminRecover) adminRecover.classList.add("is-hidden");
        });
    }

    if (choiceAdmin) {
        choiceAdmin.addEventListener("click", () => {
            if (adminPanel) adminPanel.classList.remove("is-hidden");
            if (employeePanel) employeePanel.classList.add("is-hidden");
            choiceAdmin.classList.add("is-active");
            if (choiceEmployee) choiceEmployee.classList.remove("is-active");
            adminLoginFailCount = 0;
            if (adminError) adminError.classList.add("is-hidden");
            if (adminRecover) adminRecover.classList.add("is-hidden");
        });
    }

    if (employeeConfirm) {
        employeeConfirm.addEventListener("click", () => {
            const dept =
                document.getElementById("pm-login-department")?.value || "";
            const emp =
                document.getElementById("pm-login-employee-name")?.value || "";
            if (!dept || !emp) {
                showWarning("Seleziona reparto e dipendente per accedere.");
                return;
            }
            setSession({
                role: "employee",
                adminName: "",
                department: dept,
                employee: emp,
            });
            saveSession();
            syncSessionUI();
            closeLoginModal();
        });
    }
    [employeeDepartment, employeeName].forEach((field) => {
        if (!field || !employeeConfirm) return;
        field.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            if (employeePanel && employeePanel.classList.contains("is-hidden"))
                return;
            event.preventDefault();
            employeeConfirm.click();
        });
    });

    if (adminConfirm) {
        adminConfirm.addEventListener("click", async () => {
            const adminName =
                document.getElementById("pm-login-admin-name")?.value || "";
            const password =
                document.getElementById("pm-login-admin-password")?.value || "";
            if (adminError) adminError.classList.add("is-hidden");
            if (adminRecover) adminRecover.classList.add("is-hidden");
            if (!adminName || !password) {
                if (adminError) adminError.classList.remove("is-hidden");
                adminLoginFailCount += 1;
                if (adminRecover && adminLoginFailCount >= 3) {
                    adminRecover.classList.remove("is-hidden");
                }
                return;
            }
            const verified = await verifyAdminPassword(password, adminName);
            if (!verified || !verified.admin) {
                if (adminError) adminError.classList.remove("is-hidden");
                adminLoginFailCount += 1;
                if (adminRecover && adminLoginFailCount >= 3) {
                    adminRecover.classList.remove("is-hidden");
                }
                return;
            }
            adminLoginFailCount = 0;
            if (adminRecover) adminRecover.classList.add("is-hidden");
            setSession({
                role: "admin",
                adminName: verified.admin.name,
                department: "",
                employee: "",
            });
            saveSession();
            syncSessionUI();
            closeLoginModal();
        });
    }
    [adminNameInput, adminPasswordInput].forEach((field) => {
        if (!field || !adminConfirm) return;
        field.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            if (adminPanel && adminPanel.classList.contains("is-hidden"))
                return;
            event.preventDefault();
            adminConfirm.click();
        });
    });

    if (adminRecover) {
        adminRecover.addEventListener("click", () => {
            openOtpModal();
        });
    }
}

function initEditModal() {
    const closeBtn = document.getElementById("pm-edit-close");
    const cancelBtn = document.getElementById("pm-edit-cancel");
    const saveBtn = document.getElementById("pm-edit-save");
    const modal = document.getElementById("pm-edit-modal");
    if (closeBtn) closeBtn.addEventListener("click", () => closeEditModal());
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeEditModal());
    if (saveBtn) saveBtn.addEventListener("click", () => saveEditModal());
    if (modal) {
        const fields = modal.querySelectorAll("input, select");
        fields.forEach((field) => {
            field.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                if (modal.classList.contains("is-hidden")) return;
                event.preventDefault();
                saveEditModal();
            });
        });
    }
}

function initInterventionEditModal() {
    const closeBtn = document.getElementById("pm-intervention-edit-close");
    const cancelBtn = document.getElementById("pm-intervention-edit-cancel");
    const saveBtn = document.getElementById("pm-intervention-edit-save");
    const modal = document.getElementById("pm-intervention-edit-modal");
    if (closeBtn)
        closeBtn.addEventListener("click", () => closeInterventionEditModal());
    if (cancelBtn)
        cancelBtn.addEventListener("click", () => closeInterventionEditModal());
    if (saveBtn)
        saveBtn.addEventListener("click", () => saveInterventionEditModal());
    if (modal) {
        const fields = modal.querySelectorAll("input, select");
        fields.forEach((field) => {
            field.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                if (modal.classList.contains("is-hidden")) return;
                event.preventDefault();
                saveInterventionEditModal();
            });
        });
    }
}

function initCatalogModal() {
    const modal = document.getElementById("pm-catalog-modal");
    const openBtn = document.getElementById("pm-catalog-add");
    const closeBtn = document.getElementById("pm-catalog-close");
    const cancelBtn = document.getElementById("pm-catalog-cancel");
    const saveBtn = document.getElementById("pm-catalog-save");
    const browseBtn = document.getElementById("pm-catalog-browse");
    const imageInput = document.getElementById("pm-catalog-image");
    const removeBtn = document.getElementById("pm-catalog-remove-image");
    if (openBtn) openBtn.addEventListener("click", () => openCatalogModal());
    if (closeBtn) closeBtn.addEventListener("click", () => closeCatalogModal());
    if (cancelBtn)
        cancelBtn.addEventListener("click", () => closeCatalogModal());
    if (saveBtn) saveBtn.addEventListener("click", () => saveCatalogItem());
    if (modal) {
        const fields = modal.querySelectorAll("input, select");
        fields.forEach((field) => {
            field.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                if (modal.classList.contains("is-hidden")) return;
                event.preventDefault();
                saveCatalogItem();
            });
        });
    }
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
                    "Riavvia AyPi per attivare il selettore immagini.",
                );
            }
        });
    }
    if (removeBtn) {
        removeBtn.addEventListener("click", async () => {
            const confirmed = await openConfirmModal(
                "Vuoi rimuovere l'immagine da questo prodotto?",
            );
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
        openPurchasingBackup,
    });
}

function initSettingsModals() {
    initSettingsModalsUi({
        document,
        requireAdminAccess,
        openPurchasingBackup,
        openCalendarAssignees: () => {
            try {
                ipcRenderer.send("pm-open-calendar-assignees");
            } catch (err) {
                showError(
                    "Apertura gestione dipendenti non disponibile.",
                    err.message || String(err),
                );
            }
        },
        openCalendarAdmins: () => {
            try {
                ipcRenderer.send("open-admin-manager-window");
            } catch (err) {
                showError(
                    "Apertura gestione admin non disponibile.",
                    err.message || String(err),
                );
            }
        },
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
    initGuideModalUi({ document, guideUi });
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
    renderCartUrgencyFilterOptions();
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
    initPurchasingBackupModal();
    setupLogin();
    setupHeaderButtons();
    initSettingsModals();
    initLogoutModal();
    initGuideModal();
    otpUi.initOtpModals();
    initCustomSelectsUi({ document, selector: "select" });
    updateGreeting();
    updateLoginButton();
    updateAdminControls();
    if (document.getElementById("pm-request-form") && !isLoggedIn()) {
        openLoginModal();
    }
}

window.addEventListener("DOMContentLoaded", () => {
    init().catch((err) => {
        showError(
            "Errore inizializzazione Product Manager.",
            err.message || String(err),
        );
    });
});

window.addEventListener("error", (event) => {
    const detail =
        event?.error?.stack || event?.message || "Errore sconosciuto";
    showError("Errore Product Manager.", detail);
});

window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const detail =
        reason?.stack ||
        reason?.message ||
        String(reason || "Errore sconosciuto");
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
