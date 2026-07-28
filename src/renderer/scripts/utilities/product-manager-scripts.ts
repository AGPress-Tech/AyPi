// @ts-nocheck
require("../shared/dev-guards");
import { ipcRenderer, shell } from "electron";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import * as sharedDialogs from "../shared/dialogs";
import { normalizeAdminEntry } from "../shared/admin-data";
import {
    isValidEmail,
    isValidItalianPhone as isValidPhone,
} from "../shared/validation";
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
    openReasonModal as openReasonModalUi,
    closeReasonModal as closeReasonModalUi,
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
    createCatalogSection,
} from "./product-manager/sections/catalog";
import {
    createInterventionsSection,
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
    renderCartStatusFilterOptions as renderCartStatusFilterOptionsUi,
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
    initReasonModal as initReasonModalUi,
    initAlertModal as initAlertModalUi,
    initImageModal as initImageModalUi,
} from "./product-manager/ui/basic-modals";
import { validators } from "./product-manager/data/schemas";
import {
    getCatalogImageSrc as getCatalogImageSrcSvc,
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
} from "./product-manager/data/normalize";
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
import { initBlueArchivePointerEffects } from "../shared/bluearchive-pointer-effects";
import { makeSplashSkippable } from "../shared/skippable-splash";
import { requestBackend, resolveBackendRootUrl } from "../shared/backend-client";
import { createAsyncGuard } from "../shared/async-guard";
import {
    buildRequestRecord as buildRequestRecordDomain,
    collectRequestPayload as collectRequestPayloadDomain,
    validateRequestPayload as validateRequestPayloadDomain,
} from "./product-manager/domain/request";
import {
    canAccessRequestLine,
    getRequestLineDenyReason,
} from "./product-manager/domain/request-access";
import {
    confirmRequestLine,
    deleteRequestLine,
    updateRequestLine,
} from "./product-manager/domain/cart-mutations";
import { createRequestStore } from "./product-manager/services/request-store";
import { createCollectionStore } from "./product-manager/services/collection-store";
import { normalizeAssigneesPayload } from "./shared/assignees-store";
import { createInterventionRequestLine } from "./product-manager/ui/intervention-request-line";
import { createPurchaseRequestLine } from "./product-manager/ui/purchase-request-line";
import { buildEditTagsMultiSelect as buildEditTagsMultiSelectUi } from "./product-manager/ui/edit-tags-multiselect";
import { createCartModals } from "./product-manager/ui/cart-modals";
import { createCartRowActions } from "./product-manager/ui/cart-row-actions";
import { validateModuleBindings as validateBindings } from "./product-manager/utils/module-bindings";
import { setupLogin as setupLoginUi } from "./product-manager/ui/login-controller";
import { createPasswordController } from "./product-manager/ui/password-controller";
import { createPurchasingBackupController } from "./product-manager/ui/backup-controller";
import { applyRequestModeUi } from "./product-manager/ui/request-mode";

const IS_BLUE_ARCHIVE_PURCHASING =
    new URLSearchParams(window.location.search).get("theme") === "bluearchive";

if (IS_BLUE_ARCHIVE_PURCHASING) {
    document.body.classList.add("bluearchive-purchasing", "fp-bluearchive");
}
initBlueArchivePointerEffects(IS_BLUE_ARCHIVE_PURCHASING);

function runBlueArchivePurchasingSplash() {
    if (!IS_BLUE_ARCHIVE_PURCHASING) return;
    if (!document.body.hasAttribute("data-pm-form")) return;
    const splash = document.getElementById("baPurchasingSplash");
    if (!splash) return;
    splash.setAttribute("aria-hidden", "false");
    const splashController = makeSplashSkippable(splash);
    const statusSteps = splash.querySelectorAll(".fp-ba-boot-status span");
    window.setTimeout(() => {
        if (!splashController.isFinished()) {
            statusSteps[1]?.classList.add("is-complete");
        }
    }, 1900);
    window.setTimeout(() => {
        if (!splashController.isFinished()) {
            statusSteps[2]?.classList.add("is-complete");
        }
    }, 2800);
    window.setTimeout(() => {
        if (!splashController.isFinished()) {
            statusSteps[3]?.classList.add("is-complete");
        }
    }, 3650);
    window.setTimeout(() => {
        if (!splashController.isFinished()) splash.classList.add("is-fading");
    }, 4550);
    window.setTimeout(splashController.finish, 5550);
}

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

const asyncGuard = createAsyncGuard({
    errorTitle: "Errore Product Manager.",
    promiseTitle: "Errore Product Manager (Promise).",
    report: (message, detail) => {
        showErrorUi(message, detail);
    },
});

asyncGuard.installGlobalHandlers();

// session handled by state/session
let assigneeGroups = {};
let assigneeOptions = [];
let assigneeEmails = {};
let editingDepartment = null;
let editingEmployee = null;
let adminCache = [];
let purchasingRequestsCache = [];
let interventionsCache = [];
let adminEditingIndex = -1;
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
    status: [],
    sort: "created_desc",
    retentionConfirmedDays: 7,
    retentionDeletedDays: 7,
    editingKey: null,
    editingRow: null,
};

const RETENTION_SETTINGS_KEY = "pm-retention-settings";
const DEFAULT_RETENTION_SETTINGS = { confirmedDays: 7, deletedDays: 7 };

function loadAdminCredentialsRemote() {
    return Array.isArray(adminCache) ? adminCache.map(normalizeAdminEntry) : [];
}

async function hydrateAdminCacheRemote() {
    const payload = await requestBackend("/api/shared/admins");
    adminCache = Array.isArray(payload?.admins)
        ? payload.admins.map(normalizeAdminEntry)
        : [];
    return loadAdminCredentialsRemote();
}

async function saveAdminCredentialsRemote(admins) {
    const payload = await requestBackend("/api/shared/admins", {
        method: "PUT",
        body: { admins: Array.isArray(admins) ? admins : [] },
    });
    adminCache = Array.isArray(payload?.admins)
        ? payload.admins.map(normalizeAdminEntry)
        : [];
    return loadAdminCredentialsRemote();
}

async function verifyAdminPasswordRemote(password, targetName) {
    const payload = await requestBackend("/api/shared/admins/verify", {
        method: "POST",
        body: {
            password,
            targetName: targetName || null,
        },
    });
    if (!payload?.ok || !payload?.admin) return null;
    const admin = normalizeAdminEntry(payload.admin);
    if (!adminCache.find((item) => item.name === admin.name)) {
        adminCache = [...adminCache, admin];
    }
    return {
        admin,
        admins: loadAdminCredentialsRemote(),
    };
}

function findAdminByNameRemote(name) {
    const lower = String(name || "").trim().toLowerCase();
    return (
        loadAdminCredentialsRemote().find(
            (admin) => admin.name.trim().toLowerCase() === lower,
        ) || null
    );
}

async function hydrateAssigneesRemote() {
    const payload = await requestBackend("/api/shared/assignees");
    const normalized = normalizeAssigneesPayload(payload);
    assigneeGroups = normalized.groups;
    assigneeEmails = normalized.emails;
    assigneeOptions = normalized.options;
    return {
        groups: assigneeGroups,
        emails: assigneeEmails,
        options: assigneeOptions,
    };
}

async function saveAssigneesRemote() {
    const payload = await requestBackend("/api/shared/assignees", {
        method: "PUT",
        body: {
            groups: assigneeGroups,
            emails: assigneeEmails || {},
        },
    });
    if (payload?.data) {
        const normalized = normalizeAssigneesPayload(payload.data);
        assigneeGroups = normalized.groups;
        assigneeEmails = normalized.emails;
        assigneeOptions = normalized.options;
    }
}

async function hydrateProductManagerData() {
    const payload = await requestBackend("/api/product-manager/bootstrap");
    purchasingRequestsCache = Array.isArray(payload?.requests) ? payload.requests : [];
    interventionsCache = Array.isArray(payload?.interventions)
        ? payload.interventions
        : [];
    catalogItems = Array.isArray(payload?.catalog) ? payload.catalog : [];
    catalogCategories = Array.isArray(payload?.categories) ? payload.categories : [];
    interventionTypes = Array.isArray(payload?.interventionTypes)
        ? payload.interventionTypes
        : [];
    if (payload?.assignees) {
        const normalized = normalizeAssigneesPayload(payload.assignees);
        assigneeGroups = normalized.groups;
        assigneeEmails = normalized.emails;
        assigneeOptions = normalized.options;
    }
}

function getBackendCatalogImageUrl(fileName) {
    return `${resolveBackendRootUrl()}/api/product-manager/catalog-image/${encodeURIComponent(
        String(fileName || ""),
    )}`;
}

function uploadCatalogImageToBackend(filePath, catalogId) {
    if (!filePath || !catalogId) return "";
    const ext = path.extname(filePath) || ".png";
    const fileName = `${catalogId}${ext}`;
    try {
        const buffer = fs.readFileSync(filePath);
        requestBackend("/api/product-manager/catalog-image", {
            method: "POST",
            body: {
                catalogId,
                fileName: path.basename(filePath),
                dataBase64: buffer.toString("base64"),
            },
        }).catch((err) => {
            showError(
                "Errore upload immagine catalogo.",
                err?.message || String(err),
            );
        });
        return fileName;
    } catch (err) {
        showError(
            "Errore lettura immagine catalogo.",
            err?.message || String(err),
        );
        return "";
    }
}

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
        normalizeCatalogData,
        normalizeCategoriesData,
        validateWithAjv,
        validateCatalogSchema,
        validateCategoriesSchema,
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
        renderInterventionTypesList,
        renderCatalogFilterOptions,
        renderCartTagFilterOptions,
        renderCatalog,
        renderCartTable,
        openCatalogModal,
        closeCatalogModal,
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
        getBackendCatalogImageUrl,
        uploadCatalogImage: uploadCatalogImageToBackend,
    };
}

function getInterventionsSectionCtx() {
    return {
        document,
        normalizeInterventionTypesData,
        validateWithAjv,
        validateInterventionTypesSchema,
        showWarning,
        showError,
        isAdmin,
        renderInterventionTypesList,
        renderCategoriesList,
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

const {
    normalizeHexColor,
    loadCategoryColors,
    saveCategoryColors,
    hashCategoryToColor,
    getCategoryColor,
    getContrastText,
    applyCategoryColor,
    updateCategoryChipPreview,
    openCategoryEditor,
    closeCategoryEditor,
    renderCatalog,
    openCatalogModal,
    closeCatalogModal,
    clearCatalogForm,
    saveCatalogItem,
    openCategoriesModal,
    closeCategoriesModal,
    addCategory,
} = createCatalogSection(getCatalogSectionCtx);

const {
    getInterventionType,
    getInterventionDescription,
    openInterventionTypesModal,
    closeInterventionTypesModal,
    addInterventionType,
} = createInterventionsSection(getInterventionsSectionCtx);

function validateModuleBindings() {
    validateBindings([
        ["ui.messages", { setMessage }],
        [
            "ui.multiselect",
            { openMultiselectMenu, closeMultiselectMenu },
        ],
        [
            "ui.loginSelectors",
            {
                renderLoginSelectors: renderLoginSelectorsUi,
                renderAdminSelect: renderAdminSelectUi,
            },
        ],
        [
            "ui.catalogCells",
            {
                buildProductCell: buildProductCellUi,
                buildUrlCell: buildUrlCellUi,
            },
        ],
        [
            "ui.imageViewer",
            {
                openImageModal: openImageModalUi,
                closeImageModal: closeImageModalUi,
            },
        ],
        [
            "ui.authModals",
            {
                openLoginModal: openLoginModalUi,
                closeLoginModal: closeLoginModalUi,
                openLogoutModal: openLogoutModalUi,
                closeLogoutModal: closeLogoutModalUi,
            },
        ],
        [
            "ui.confirmAlert",
            {
                openConfirmModal: openConfirmModalUi,
                closeConfirmModal: closeConfirmModalUi,
                openReasonModal: openReasonModalUi,
                closeReasonModal: closeReasonModalUi,
                openAlertModal: openAlertModalUi,
                closeAlertModal: closeAlertModalUi,
            },
        ],
        [
            "ui.notifications",
            {
                showInfo: showInfoUi,
                showWarning: showWarningUi,
                showError: showErrorUi,
                requireLogin: requireLoginUi,
                requireAdminAccess: requireAdminAccessUi,
            },
        ],
        [
            "ui.categoriesLists",
            {
                renderCategoriesList: renderCategoriesListUi,
                renderInterventionTypesList:
                    renderInterventionTypesListUi,
            },
        ],
        [
            "ui.assigneesAdminUi",
            {
                renderDepartmentSelect: renderDepartmentSelectUi,
                renderDepartmentList: renderDepartmentListUi,
                renderEmployeesList: renderEmployeesListUi,
            },
        ],
        [
            "sections.catalog",
            {
                normalizeHexColor,
                loadCategoryColors,
                saveCategoryColors,
                hashCategoryToColor,
                getCategoryColor,
                getContrastText,
                applyCategoryColor,
                updateCategoryChipPreview,
                openCategoryEditor,
                closeCategoryEditor,
                renderCatalog,
                openCatalogModal,
                closeCatalogModal,
                clearCatalogForm,
                saveCatalogItem,
                openCategoriesModal,
                closeCategoriesModal,
                addCategory,
            },
        ],
        [
            "sections.interventions",
            {
                getInterventionType,
                getInterventionDescription,
                openInterventionTypesModal,
                closeInterventionTypesModal,
                addInterventionType,
            },
        ],
        [
            "ui.sessionUi",
            {
                updateGreeting: updateGreetingUi,
                updateLoginButton: updateLoginButtonUi,
                updateAdminControls: updateAdminControlsUi,
                syncSessionUI: syncSessionUi,
                applySharedSession: applySharedSessionUi,
            },
        ],
        [
            "services.catalogImages",
            {
                getCatalogImageSrc: getCatalogImageSrcSvc,
                copyCatalogImage: copyCatalogImageSvc,
            },
        ],
        [
            "ui.filters",
            {
                renderCategoryOptions: renderCategoryOptionsUi,
                renderCatalogFilterOptions:
                    renderCatalogFilterOptionsUi,
                renderInterventionTypeOptions:
                    renderInterventionTypeOptionsUi,
                renderCartTagFilterOptions:
                    renderCartTagFilterOptionsUi,
                renderCartStatusFilterOptions:
                    renderCartStatusFilterOptionsUi,
            },
        ],
        [
            "ui.catalogControls",
            {
                syncCatalogControls: syncCatalogControlsUi,
                initCatalogFilters: initCatalogFiltersUi,
            },
        ],
        ["ui.catalogView", { renderCatalog: renderCatalogUi }],
        ["ui.cartControls", { initCartFilters: initCartFiltersUi }],
        ["ui.cartTable", { renderCartTable: renderCartTableUi }],
        ["ui.export", { initExportModal: initExportModalUi }],
        [
            "ui.headerButtons",
            { setupHeaderButtons: setupHeaderButtonsUi },
        ],
        [
            "ui.settingsModals",
            { initSettingsModals: initSettingsModalsUi },
        ],
        [
            "ui.categoriesModals",
            {
                initCategoriesModal: initCategoriesModalUi,
                initInterventionTypesModal:
                    initInterventionTypesModalUi,
            },
        ],
        [
            "ui.basicModals",
            {
                initAddModal: initAddModalUi,
                initConfirmModal: initConfirmModalUi,
                initAlertModal: initAlertModalUi,
                initImageModal: initImageModalUi,
            },
        ],
    ]);
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
const requestStore = createRequestStore({
    interventionMode: REQUEST_MODES.INTERVENTION,
    normalize: normalizeRequestsData,
    validate: (payload) =>
        validateWithAjv(validateRequestsSchema, payload, "richieste", {
            showWarning,
            showError,
        }),
    request: requestBackend,
    getPurchasingRequests: () => purchasingRequestsCache,
    setPurchasingRequests: (requests) => {
        purchasingRequestsCache = requests;
    },
    getInterventions: () => interventionsCache,
    setInterventions: (requests) => {
        interventionsCache = requests;
    },
    showError,
});
const catalogStore = createCollectionStore({
    normalize: normalizeCatalogData,
    validate: (payload) =>
        validateWithAjv(validateCatalogSchema, payload, "catalogo", {
            showWarning,
            showError,
        }),
    getCached: () => catalogItems,
    setCached: (payload) => {
        catalogItems = payload;
    },
    request: requestBackend,
    endpoint: "/api/product-manager/catalog",
    backendErrorMessage: "Errore salvataggio catalogo backend.",
    saveErrorMessage: "Errore salvataggio catalogo.",
    showError,
});
const categoriesStore = createCollectionStore({
    normalize: normalizeCategoriesData,
    validate: (payload) =>
        validateWithAjv(validateCategoriesSchema, payload, "categorie", {
            showWarning,
            showError,
        }),
    getCached: () => catalogCategories,
    setCached: (payload) => {
        catalogCategories = payload;
    },
    request: requestBackend,
    endpoint: "/api/product-manager/categories",
    backendErrorMessage: "Errore salvataggio categorie backend.",
    saveErrorMessage: "Errore salvataggio categorie.",
    showError,
});
const interventionTypesStore = createCollectionStore({
    normalize: normalizeInterventionTypesData,
    validate: (payload) =>
        validateWithAjv(
            validateInterventionTypesSchema,
            payload,
            "tipologie interventi",
            { showWarning, showError },
        ),
    getCached: () => interventionTypes,
    setCached: (payload) => {
        interventionTypes = payload;
    },
    request: requestBackend,
    endpoint: "/api/product-manager/intervention-types",
    backendErrorMessage: "Errore salvataggio tipologie backend.",
    saveErrorMessage: "Errore salvataggio tipologie interventi.",
    showError,
});
const cartModals = createCartModals({
    document,
    uiState,
    cartState,
    requestModes: REQUEST_MODES,
    readRequests: (...args) => readRequestsFile(...args),
    saveRequests: (...args) => saveRequestsFile(...args),
    canEditLine,
    showError,
    showWarning,
    getSession: () => session,
    updateRequestLine,
    renderCart: renderCartTable,
    toTags,
    getCatalogCategories: () => catalogCategories,
    buildTagsSelect: buildEditTagsMultiSelectUi,
    openMultiselectMenu,
    closeMultiselectMenu,
    normalizePrice: normalizePriceCad,
    requireLogin,
    isLoggedIn,
    openLoginModal,
    buildRequestRecord,
});
const cartRowActions = createCartRowActions({
    readRequests: (...args) => readRequestsFile(...args),
    saveRequests: (...args) => saveRequestsFile(...args),
    isAdmin,
    canDeleteLine,
    openConfirmModal,
    openReasonModal,
    showWarning,
    showError,
    normalizeString,
    confirmRequestLine,
    deleteRequestLine,
    getSession: () => session,
    renderCart: renderCartTable,
});
const purchasingBackupController = createPurchasingBackupController({
    document,
    window,
    setMessage,
    showModal,
    hideModal,
    request: requestBackend,
    asyncGuard,
    openConfirmModal,
    hydrate: hydrateProductManagerData,
    requireAdminAccess,
    refreshViews: () => {
        renderCartTable();
        renderCatalog();
        renderCategoryOptions();
        renderCatalogFilterOptions();
        renderCartTagFilterOptions();
    },
});
const REQUEST_MODE_STORAGE_KEY = "pm-request-mode";
const DEFAULT_REQUEST_MODE = REQUEST_MODES.PURCHASE;
let currentRequestMode = DEFAULT_REQUEST_MODE;

function isFormPage() {
    return Boolean(document.getElementById("pm-request-form"));
}

function initPurchasingBackupModal() {
    return purchasingBackupController.init();
}

function openPurchasingBackup() {
    return purchasingBackupController.open();
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
    applyRequestModeUi(
        document,
        isInterventionMode(currentRequestMode),
    );
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
    return createPurchaseRequestLine(
        {
            document,
            catalogCategories,
            urgencyOptions: URGENCY_OPTIONS,
            toTags,
            openMultiselectMenu,
            closeMultiselectMenu,
            updateLineField,
            removeLine,
        },
        line,
        index,
    );
}

function createInterventionLineElement(line, index) {
    return createInterventionRequestLine(
        {
            document,
            urgencyOptions: URGENCY_OPTIONS,
            toTags,
            renderInterventionTypeOptions,
            updateLineField,
            removeLine,
        },
        line,
        index,
    );
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

function removeLine(index) {
    if (!requestLines.length) return;
    if (requestLines.length <= 1) {
        requestLines = [];
    } else {
        requestLines.splice(index, 1);
    }
    renderLines();
}

function readRequestsFile(mode = getActiveMode()) {
    return requestStore.read(mode);
}

function saveRequestsFile(payload, mode = getActiveMode()) {
    return requestStore.save(payload, mode);
}

function collectRequestPayload() {
    return collectRequestPayloadDomain({
        notes: document.getElementById("pm-notes")?.value || "",
        lines: requestLines,
        mode: isInterventionMode() ? "intervention" : "purchase",
    });
}

function validateRequestPayload(payload) {
    return validateRequestPayloadDomain(
        payload,
        isInterventionMode() ? "intervention" : "purchase",
    );
}

function buildRequestRecord(payload) {
    return buildRequestRecordDomain(payload, session);
}

function getRequestAccessSession() {
    return {
        loggedIn: isLoggedIn(),
        admin: isAdmin(),
        employee: isEmployee(),
        employeeName: session.employee,
        department: session.department,
    };
}

function canEditLine(request, line) {
    return canAccessRequestLine(
        request,
        line,
        getRequestAccessSession(),
    );
}

function canDeleteLine(request, line) {
    return canAccessRequestLine(
        request,
        line,
        getRequestAccessSession(),
    );
}

function getEditDenyReason(request, line) {
    return getRequestLineDenyReason(
        "edit",
        request,
        line,
        getRequestAccessSession(),
    );
}

function getDeleteDenyReason(request, line) {
    return getRequestLineDenyReason(
        "delete",
        request,
        line,
        getRequestAccessSession(),
    );
}

function showFormMessage(text, type = "info") {
    const message = document.getElementById("pm-form-message");
    if (!message) return;
    const normalizedText = String(text || "").trim();
    message.textContent = normalizedText;
    message.classList.remove(
        "pm-message--error",
        "pm-message--success",
    );
    if (!normalizedText) {
        message.classList.add("is-hidden");
        return;
    }
    message.classList.remove("is-hidden");
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
    canEditRow: ({ request, line }) => canEditLine(request, line),
    canDeleteRow: ({ request, line }) => canDeleteLine(request, line),
    canEditReason: ({ request, line }) => getEditDenyReason(request, line),
    canDeleteReason: ({ request, line }) => getDeleteDenyReason(request, line),
    });
}

function openInterventionEditModal(row) {
    return cartModals.openInterventionEdit(row);
}

function closeInterventionEditModal() {
    return cartModals.closeInterventionEdit();
}

function saveInterventionEditModal() {
    return cartModals.saveInterventionEdit();
}

function openEditModal(row) {
    return cartModals.openPurchaseEdit(row);
}

function closeEditModal() {
    return cartModals.closePurchaseEdit();
}

function saveEditModal() {
    return cartModals.savePurchaseEdit();
}

function openAddModal(row) {
    return cartModals.openAdd(row);
}

function closeAddModal() {
    return cartModals.closeAdd();
}

function saveAddModal() {
    return cartModals.saveAdd();
}

async function confirmCartRow(row) {
    return cartRowActions.confirm(row);
}

async function deleteCartRow(row) {
    return cartRowActions.remove(row);
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

function loadAssignees() {
    return {
        groups: assigneeGroups || {},
        options: assigneeOptions || [],
        emails: assigneeEmails || {},
    };
}

function saveAssignees() {
    saveAssigneesRemote().catch((err) => {
        showError("Errore salvataggio dipendenti.", err.message || String(err));
    });
}

function syncAssignees() {
    const payload = loadAssignees();
    assigneeGroups = payload.groups || {};
    assigneeOptions = payload.options || [];
    assigneeEmails = payload.emails || {};
    if (!Object.keys(assigneeGroups).length) {
        showWarning(
            "Elenco dipendenti non disponibile.",
            "Impossibile caricare l'elenco dipendenti dal backend.",
        );
    }
}

function loadCatalog() {
    return catalogStore.load();
}

function saveCatalog(list) {
    return catalogStore.save(list);
}

function loadCategories() {
    return categoriesStore.load();
}

function saveCategories(list) {
    return categoriesStore.save(list);
}

function loadInterventionTypes() {
    return interventionTypesStore.load();
}

function saveInterventionTypes(list) {
    return interventionTypesStore.save(list);
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

function renderCartStatusFilterOptions() {
    renderCartStatusFilterOptionsUi({
        document,
        cartState,
        openMultiselectMenu,
        closeMultiselectMenu,
        onChange: (values) => {
            cartState.status = Array.isArray(values)
                ? values.filter((value) => value)
                : [];
            renderCartTable();
        },
    });
}

function copyCatalogImage(filePath, catalogId) {
    return copyCatalogImageSvc(
        {
            getBackendCatalogImageUrl,
            uploadCatalogImage: uploadCatalogImageToBackend,
        },
        filePath,
        catalogId,
    );
}

function getCatalogImageSrc(item) {
    return getCatalogImageSrcSvc(
        {
            getBackendCatalogImageUrl,
            uploadCatalogImage: uploadCatalogImageToBackend,
        },
        item,
    );
}

function openImageModal(imageSrc, link, title) {
    openImageModalUi({ document, PLACEHOLDER_IMAGE }, imageSrc, link, title);
}

function closeImageModal() {
    closeImageModalUi({ document });
}

function renderCategoriesList() {
    renderCategoriesListUi({
        document,
        uiState,
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
        uiState,
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
        loadAdminCredentials: loadAdminCredentialsRemote,
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

function openReasonModal(options = {}) {
    return openReasonModalUi({ document, uiState }, options);
}

function closeReasonModal(result = null) {
    closeReasonModalUi({ document, uiState }, result);
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

function loadRetentionSettings() {
    try {
        const raw = window.localStorage.getItem(RETENTION_SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_RETENTION_SETTINGS };
        const parsed = JSON.parse(raw);
        const confirmed = Number(parsed?.confirmedDays);
        const deleted = Number(parsed?.deletedDays);
        const confirmedDays =
            Number.isFinite(confirmed) && confirmed >= 1 ? Math.floor(confirmed) : DEFAULT_RETENTION_SETTINGS.confirmedDays;
        const deletedDays =
            Number.isFinite(deleted) && deleted >= 1 ? Math.floor(deleted) : DEFAULT_RETENTION_SETTINGS.deletedDays;
        return { confirmedDays, deletedDays };
    } catch {
        return { ...DEFAULT_RETENTION_SETTINGS };
    }
}

function saveRetentionSettings(next) {
    try {
        window.localStorage.setItem(RETENTION_SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
        console.error("Errore salvataggio retention:", err);
    }
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
    return passwordController.open(action);
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
    findAdminByName: findAdminByNameRemote,
    getAdminCache,
    loadAdminCredentials: loadAdminCredentialsRemote,
    saveAdminCredentials: saveAdminCredentialsRemote,
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

const passwordController = createPasswordController({
    document,
    showModal,
    hideModal,
    verifyAdminPassword: verifyAdminPasswordRemote,
    getAdminCache,
    setAdminCache,
    loadAdminCredentials: loadAdminCredentialsRemote,
    saveAdminCredentials: saveAdminCredentialsRemote,
    setAdminMessage,
    adminMinRequiredText: UI_TEXTS.adminMinRequired,
    adminRemovedText: UI_TEXTS.adminRemoved,
    openAdminModal: () => adminUi.openAdminModal(),
    renderAdminList: () => adminUi.renderAdminList(),
    openOtpModal,
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
    loadAdminCredentials: loadAdminCredentialsRemote,
    saveAdminCredentials: saveAdminCredentialsRemote,
    verifyAdminPassword: verifyAdminPasswordRemote,
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
    setupLoginUi({
        document,
        isLoggedIn,
        openLogoutModal,
        openLoginModal,
        closeLoginModal,
        showWarning,
        setSession,
        saveSession,
        syncSessionUI,
        asyncGuard,
        verifyAdminPassword: verifyAdminPasswordRemote,
        openOtpModal,
    });
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
        browseBtn.addEventListener("click", asyncGuard.wrap(async () => {
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
        }));
    }
    if (removeBtn) {
        removeBtn.addEventListener("click", asyncGuard.wrap(async () => {
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
        }));
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

function initReasonModal() {
    initReasonModalUi({
        document,
        closeReasonModal,
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

function initRetentionModal() {
    const openBtn = document.getElementById("pm-retention-open");
    const modal = document.getElementById("pm-retention-modal");
    const saveBtn = document.getElementById("pm-retention-save");
    const cancelBtn = document.getElementById("pm-retention-cancel");
    const confirmedInput = document.getElementById("pm-retention-confirmed");
    const deletedInput = document.getElementById("pm-retention-deleted");
    if (!openBtn || !modal) return;
    const openModal = () => {
        if (!isAdmin()) {
            showWarning("Solo gli admin possono modificare la durata.");
            return;
        }
        const settings = loadRetentionSettings();
        if (confirmedInput) confirmedInput.value = String(settings.confirmedDays);
        if (deletedInput) deletedInput.value = String(settings.deletedDays);
        modal.classList.remove("is-hidden");
        modal.setAttribute("aria-hidden", "false");
        setTimeout(() => confirmedInput && confirmedInput.focus(), 0);
    };
    const closeModal = () => {
        modal.classList.add("is-hidden");
        modal.setAttribute("aria-hidden", "true");
    };
    openBtn.addEventListener("click", openModal);
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeModal());
    if (saveBtn) {
        saveBtn.addEventListener("click", () => {
            const confirmed = Number(confirmedInput?.value || "");
            const deleted = Number(deletedInput?.value || "");
            if (!Number.isFinite(confirmed) || confirmed < 1 || confirmed > 365) {
                showWarning("Inserisci un valore valido per i convalidati (1-365).");
                return;
            }
            if (!Number.isFinite(deleted) || deleted < 1 || deleted > 365) {
                showWarning("Inserisci un valore valido per i rifiutati/eliminati (1-365).");
                return;
            }
            const next = { confirmedDays: Math.floor(confirmed), deletedDays: Math.floor(deleted) };
            saveRetentionSettings(next);
            cartState.retentionConfirmedDays = next.confirmedDays;
            cartState.retentionDeletedDays = next.deletedDays;
            closeModal();
            renderCartTable();
        });
    }
    modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
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
                ipcRenderer.send("pm-open-calendar-assignees", {
                    theme: IS_BLUE_ARCHIVE_PURCHASING
                        ? "bluearchive"
                        : "standard",
                });
            } catch (err) {
                showError(
                    "Apertura gestione dipendenti non disponibile.",
                    err.message || String(err),
                );
            }
        },
        openCalendarAdmins: () => {
            try {
                ipcRenderer.send("pm-open-calendar-admins", {
                    theme: IS_BLUE_ARCHIVE_PURCHASING
                        ? "bluearchive"
                        : "standard",
                });
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
    runBlueArchivePurchasingSplash();
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
    const retentionSettings = loadRetentionSettings();
    cartState.retentionConfirmedDays = retentionSettings.confirmedDays;
    cartState.retentionDeletedDays = retentionSettings.deletedDays;
    await hydrateAdminCacheRemote();
    await hydrateProductManagerData();
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
    renderCartStatusFilterOptions();
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
    initReasonModal();
    initAlertModal();
    initCatalogModal();
    initCatalogFilters();
    initCategoriesModal();
    initInterventionTypesModal();
    initImageModal();
    initRetentionModal();
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

window.addEventListener(
    "DOMContentLoaded",
    asyncGuard.wrap(async () => {
        await init();
    }, "Errore inizializzazione Product Manager."),
);

async function refreshSessionFromMain() {
    try {
        const shared = await ipcRenderer.invoke("pm-session-get");
        applySharedSession(shared);
    } catch (err) {
        console.error("Errore sync sessione:", err);
    }
}

window.addEventListener("focus", () => {
    void asyncGuard.wrap(refreshSessionFromMain)();
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        void asyncGuard.wrap(refreshSessionFromMain)();
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

let realtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeRefreshInFlight = false;

async function refreshProductManagerRealtime(includeShared: boolean) {
    if (realtimeRefreshInFlight) return;
    realtimeRefreshInFlight = true;
    try {
        await hydrateProductManagerData();
        if (includeShared) {
            await hydrateAdminCacheRemote();
        }
        syncAssignees();
        renderLoginSelectors();
        renderAdminSelect();
        renderCatalog();
        renderCategoryOptions();
        renderCatalogFilterOptions();
        renderCartTagFilterOptions();
        renderCartUrgencyFilterOptions();
        renderCartStatusFilterOptions();
        renderCartTable();
    } catch (error) {
        console.error("[realtime] Aggiornamento Product Manager fallito:", error);
    } finally {
        realtimeRefreshInFlight = false;
    }
}

ipcRenderer.on("aypi-realtime-event", (_event, realtimeEvent) => {
    if (
        realtimeEvent?.module !== "purchasing" &&
        realtimeEvent?.module !== "shared" &&
        realtimeEvent?.module !== "*"
    ) {
        return;
    }
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = setTimeout(() => {
        realtimeRefreshTimer = null;
        void refreshProductManagerRealtime(
            realtimeEvent?.module === "shared" ||
                realtimeEvent?.module === "*",
        );
    }, 180);
});
