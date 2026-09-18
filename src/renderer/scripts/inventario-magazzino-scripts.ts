// @ts-nocheck
require("./shared/dev-guards");
const { requestBackend } = require("./shared/backend-client");
const { ipcRenderer } = require("electron");
const WAREHOUSE_LOGIN_REQUIRED = new URLSearchParams(window.location.search).get("warehouseRequireLogin") === "1";

function defaultInvertedSides(code) {
    return (code.charCodeAt(0) - "A".charCodeAt(0) + 1) % 2 === 0;
}

let warehouseRows = ["A", "B", "C", "D", "E"].map((code) => ({
    code,
    capacity: 96,
    invertedSides: defaultInvertedSides(code),
}));
const LEVELS = [
    { code: "c", label: "alto", order: 3 },
    { code: "b", label: "intermedio", order: 2 },
    { code: "a", label: "basso", order: 1 },
];
const SLOT_PATTERN = /^([A-Z])(\d{1,3})([a-c])$/i;
const STAGING_AREA_LABEL = "In Attesa/Preparazione/Montaggio";

function rowCodes() {
    return warehouseRows.map((row) => row.code);
}

function rowConfiguration(code) {
    return warehouseRows.find((row) => row.code === code);
}

function physicalColumnsForRow(code) {
    return Math.max(1, Math.floor((rowConfiguration(code)?.capacity || 6) / 6));
}

function maximumPositionForRow(code) {
    return physicalColumnsForRow(code) * 2;
}

function totalSlots() {
    return warehouseRows.reduce((total, row) => total + row.capacity, 0);
}

// La sorgente effettiva viene caricata dalle tabelle SQLite del backend.
const inventory = new Map();

let selectedRow = "A";
let selectedSlot = null;
const displayFields = new Set(["location", "article", "pieces"]);
let slotRangeMode = "all";
let slotPage = 0;
let slotPageDirection = null;
let slotPreviewTimer = null;
let slotLabelFitFrame = null;
let contextSlotCode = null;
let currentSearchResults = [];
const selectedReportLocations = new Set();
const rowRestrictions = new Map();
const slotRestrictions = new Map();
let selectedRestrictionRow = "A";
const operationGroups = { load: [], unload: [] };
const operationGroupStages = { load: "compose", unload: "compose" };
let operationGroupMode = "load";
let editingOperationLineIndex = null;
let nextOperationLineId = 1;
const movementHistory = [];
const unloadZone = [];
const warehouseSession = { role: "guest", adminName: "", department: "", employee: "" };
let warehouseAssigneeGroups = {};
let warehouseAdmins = [];
let warehouseStorageUnavailable = true;
let movementHighlight = null;
let movementHighlightTimer = null;
let contextMovementId = null;
let contextUnloadZoneUnitId = null;
let unloadZoneReloadPreview = null;
let manualMovementMode = "load";
const selectedSlotCodes = new Set();
let relocationSourceCode = null;
let restrictionBatchTargets = null;
let completedOperationMovement = null;
let operationPreviewPlan = null;
let warehouseOptimizationPreview = null;
let activeCrateSortingProfile = null;
let activeOptimizationScope = null;
let optimizerSelectedRows = null;
const optimizerFilters = {
    articles: { include: new Set(), exclude: new Set() },
    customers: { include: new Set(), exclude: new Set() },
};
let suppressSlotClickUntil = 0;
let warehouseRevision = 0;
let warehousePersistenceReady = false;
let warehousePersistenceQueue = Promise.resolve();
const warehouseDialogOrigins = new WeakMap();
const warehouseDialogFocusTargets = new WeakMap();
const warehouseDialogStack = [];
let warehouseConfirmResolver = null;
let warehouseFocusRecoveryPending = false;
let queuedWarehouseFocus = null;
function warehouseStorageLabel() {
    return "SQLite server condiviso";
}

function setupWarehouseSplash() {
    const splash = document.getElementById("warehouseSplash");
    const parameters = new URLSearchParams(window.location.search);
    const enabled = parameters.get("warehouseSplash") === "1";
    const blueArchive = parameters.get("theme") === "bluearchive";
    document.body.classList.toggle("warehouse-bluearchive", blueArchive);
    if (!enabled || !splash) {
        document.body.classList.add("warehouse-ready");
        splash?.remove();
        return;
    }
    document.body.classList.add("warehouse-splash-active");
    splash.setAttribute("aria-hidden", "false");
    splash.setAttribute("role", "button");
    splash.setAttribute("tabindex", "0");
    splash.setAttribute("aria-label", "Clicca per saltare la schermata iniziale");
    const finish = (immediate = false) => {
        if (splash.classList.contains("is-leaving")) return;
        splash.classList.add("is-leaving");
        splash.setAttribute("aria-hidden", "true");
        if (immediate) {
            document.body.classList.remove("warehouse-splash-active");
            document.body.classList.add("warehouse-ready");
            splash.remove();
            return;
        }
        window.setTimeout(() => {
            document.body.classList.remove("warehouse-splash-active");
            document.body.classList.add("warehouse-ready");
            splash.remove();
        }, 800);
    };
    splash.addEventListener("click", () => finish(true), { once: true });
    splash.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        finish(true);
    });
    if (blueArchive) {
        const steps = splash.querySelectorAll(".warehouse-ba-boot__status span");
        window.setTimeout(() => steps[1]?.classList.add("is-complete"), 1750);
        window.setTimeout(() => steps[2]?.classList.add("is-complete"), 2650);
        window.setTimeout(() => steps[3]?.classList.add("is-complete"), 3500);
        window.setTimeout(finish, 4850);
    } else {
        window.setTimeout(finish, 4200);
    }
}

function isWarehouseLoggedIn() {
    return !WAREHOUSE_LOGIN_REQUIRED || warehouseSession.role === "employee" || warehouseSession.role === "admin";
}

function isWarehouseAdmin() {
    return !WAREHOUSE_LOGIN_REQUIRED || warehouseSession.role === "admin";
}

function isExclusiveTestDatabaseAdmin() {
    return WAREHOUSE_LOGIN_REQUIRED
        && warehouseSession.role === "admin"
        && String(warehouseSession.adminName || "").trim().localeCompare("Ayrton Pizzi", "it", { sensitivity: "base" }) === 0;
}

function warehouseActorSnapshot() {
    if (!WAREHOUSE_LOGIN_REQUIRED) {
        return {
            role: "test",
            adminName: "",
            department: "Sviluppo",
            employee: "Operatore test",
            displayName: "Operatore test",
        };
    }
    const displayName = warehouseSession.role === "admin"
        ? warehouseSession.adminName
        : warehouseSession.employee;
    return {
        role: warehouseSession.role,
        adminName: warehouseSession.adminName || "",
        department: warehouseSession.department || "",
        employee: warehouseSession.employee || "",
        displayName: displayName || "Operatore AyPi",
    };
}

function syncWarehouseSessionUi() {
    const button = document.getElementById("warehouseLoginToggle");
    if (button) {
        button.hidden = !WAREHOUSE_LOGIN_REQUIRED;
        const name = warehouseSession.role === "admin" ? warehouseSession.adminName : warehouseSession.employee;
        button.classList.toggle("is-authenticated", isWarehouseLoggedIn());
        button.querySelector("strong").textContent = isWarehouseLoggedIn()
            ? `${warehouseSession.role === "admin" ? "Admin" : "Operatore"}: ${name}`
            : "Login";
        button.title = isWarehouseLoggedIn() ? "Clicca per disconnettere l'operatore" : "Accedi per abilitare carico e scarico";
    }
    const disabled = warehouseStorageUnavailable || !isWarehouseLoggedIn();
    ["openLoadButton", "openUnloadButton", "openManualMovementButton", "openWarehouseOptimizer"].forEach((id) => {
        const control = document.getElementById(id);
        if (!control) return;
        control.disabled = disabled;
        control.title = !isWarehouseLoggedIn() ? "Login operatore richiesto" : disabled ? "Database non disponibile" : "";
    });
    document.querySelectorAll("[data-admin-only]").forEach((section) => {
        const locked = !isWarehouseAdmin();
        section.classList.toggle("is-admin-locked", locked);
        section.hidden = locked;
        section.title = locked ? "Accesso amministratore richiesto" : "";
    });
    const testDatabaseActions = document.getElementById("testDatabaseActions");
    const canManageTestDatabase = isExclusiveTestDatabaseAdmin();
    if (testDatabaseActions) testDatabaseActions.hidden = !canManageTestDatabase;
    setTestDatabaseButtonsDisabled(warehouseStorageUnavailable);
    if (!canManageTestDatabase) closePseudoPopulateDialog();
    if (!isWarehouseAdmin()) {
        closeRestrictionDialog();
        closeWarehouseOptimizer();
    }
    renderUnloadZone();
}

function applyWarehouseSession(payload) {
    Object.assign(warehouseSession, { role: "guest", adminName: "", department: "", employee: "" },
        payload && ["employee", "admin"].includes(payload.role) ? payload : {});
    syncWarehouseSessionUi();
    broadcastWarehouse3dState();
}

async function saveWarehouseSession(payload) {
    applyWarehouseSession(payload);
    await ipcRenderer.invoke("pm-session-set", warehouseSession);
}

function fillWarehouseSelect(select, values, placeholder) {
    if (!select) return;
    select.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);
    values.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    });
}

function visibleDialogFocusTarget(dialog) {
    const preferred = warehouseDialogFocusTargets.get(dialog);
    if (preferred?.isConnected && !preferred.disabled && !preferred.hidden && preferred.offsetParent !== null) return preferred;
    const candidates = Array.from(dialog?.querySelectorAll?.("[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])") || []);
    return candidates.find((control) => !control.hidden && control.offsetParent !== null) || null;
}

async function focusWarehouseElement(target, selectText = false) {
    if (warehouseFocusRecoveryPending) {
        queuedWarehouseFocus = { target, selectText };
        return;
    }
    warehouseFocusRecoveryPending = true;
    try {
        try {
            await ipcRenderer.invoke("warehouse-inventory-focus-window");
        } catch {
            window.focus();
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (target?.isConnected && !target.disabled && !target.hidden && target.offsetParent !== null) {
            target.focus({ preventScroll: true });
            if (selectText && typeof target.select === "function") target.select();
        }
    } finally {
        warehouseFocusRecoveryPending = false;
        const queued = queuedWarehouseFocus;
        queuedWarehouseFocus = null;
        if (queued) void focusWarehouseElement(queued.target, queued.selectText);
    }
}

function openWarehouseDialog(dialog, focusTarget = null, selectText = false) {
    if (!dialog) return;
    if (!dialog.classList.contains("is-open")) warehouseDialogOrigins.set(dialog, document.activeElement);
    if (focusTarget) warehouseDialogFocusTargets.set(dialog, focusTarget);
    dialog.inert = false;
    dialog.classList.add("is-open");
    dialog.setAttribute("aria-hidden", "false");
    const previousIndex = warehouseDialogStack.indexOf(dialog);
    if (previousIndex >= 0) warehouseDialogStack.splice(previousIndex, 1);
    warehouseDialogStack.push(dialog);
    void focusWarehouseElement(focusTarget || visibleDialogFocusTarget(dialog), selectText);
}

function closeWarehouseDialog(dialog, restoreFocus = true) {
    if (!dialog) return;
    dialog.classList.remove("is-open");
    dialog.setAttribute("aria-hidden", "true");
    dialog.inert = true;
    const stackIndex = warehouseDialogStack.indexOf(dialog);
    if (stackIndex >= 0) warehouseDialogStack.splice(stackIndex, 1);
    const origin = warehouseDialogOrigins.get(dialog);
    warehouseDialogOrigins.delete(dialog);
    warehouseDialogFocusTargets.delete(dialog);
    if (restoreFocus && origin?.isConnected && !origin.disabled && !origin.hidden) void focusWarehouseElement(origin);
}

function topmostWarehouseDialog() {
    return warehouseDialogStack[warehouseDialogStack.length - 1] || null;
}

function settleWarehouseConfirm(confirmed) {
    const resolver = warehouseConfirmResolver;
    warehouseConfirmResolver = null;
    closeWarehouseDialog(document.getElementById("warehouseConfirmDialog"));
    resolver?.(confirmed);
}

function showWarehouseConfirm({ title = "Conferma operazione", message, confirmLabel = "Conferma", danger = false }) {
    if (warehouseConfirmResolver) settleWarehouseConfirm(false);
    document.getElementById("warehouseConfirmTitle").textContent = title;
    document.getElementById("warehouseConfirmMessage").textContent = message;
    const accept = document.getElementById("warehouseConfirmAccept");
    accept.textContent = confirmLabel;
    accept.classList.toggle("is-danger", danger);
    openWarehouseDialog(document.getElementById("warehouseConfirmDialog"), accept);
    return new Promise((resolve) => { warehouseConfirmResolver = resolve; });
}

function setupWarehouseDialogFocus() {
    document.getElementById("warehouseConfirmCancel")?.addEventListener("click", () => settleWarehouseConfirm(false));
    document.getElementById("warehouseConfirmAccept")?.addEventListener("click", () => settleWarehouseConfirm(true));
    window.addEventListener("focus", () => {
        const dialog = topmostWarehouseDialog();
        if (dialog) void focusWarehouseElement(dialog.contains(document.activeElement) ? document.activeElement : visibleDialogFocusTarget(dialog));
    });
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        const dialog = topmostWarehouseDialog();
        if (dialog) void focusWarehouseElement(dialog.contains(document.activeElement) ? document.activeElement : visibleDialogFocusTarget(dialog));
    });
    document.addEventListener("pointerdown", (event) => {
        if (event.target.closest?.(".restriction-backdrop.is-open")) void ipcRenderer.invoke("warehouse-inventory-focus-window").catch(() => window.focus());
    }, true);
    document.addEventListener("keydown", (event) => {
        const dialog = topmostWarehouseDialog();
        if (!dialog) return;
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopImmediatePropagation();
            const closeByDialog = {
                warehouseConfirmDialog: () => settleWarehouseConfirm(false),
                operationGroupDialog: closeOperationDialog,
                manualMovementDialog: closeManualMovementDialog,
                warehouseOptimizerDialog: closeWarehouseOptimizer,
                movementHistoryDialog: closeMovementHistoryDialog,
                unloadZoneDialog: closeUnloadZoneDialog,
                unloadReloadDialog: closeUnloadReloadDialog,
                inventorySearchDialog: closeInventorySearchDialog,
                restrictionDialog: closeRestrictionDialog,
                pseudoPopulateDialog: closePseudoPopulateDialog,
                articleAnalysisDialog: closeArticleAnalysis,
                warehouseLoginDialog: closeWarehouseLogin,
            };
            closeByDialog[dialog.id]?.();
            return;
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(dialog.querySelectorAll("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])"))
            .filter((control) => control.offsetParent !== null && !control.hidden);
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }, true);
}

function openWarehouseLogin() {
    const dialog = document.getElementById("warehouseLoginDialog");
    openWarehouseDialog(dialog, document.getElementById("warehouseLoginDepartment"));
}

function closeWarehouseLogin() {
    closeWarehouseDialog(document.getElementById("warehouseLoginDialog"));
}

function renderWarehouseLoginSources() {
    const departments = Object.keys(warehouseAssigneeGroups).sort((a, b) => a.localeCompare(b, "it"));
    fillWarehouseSelect(document.getElementById("warehouseLoginDepartment"), departments, "Seleziona reparto");
    fillWarehouseSelect(document.getElementById("warehouseLoginEmployee"), [], "Seleziona reparto");
    fillWarehouseSelect(document.getElementById("warehouseLoginAdmin"), warehouseAdmins, "Seleziona admin");
}

async function initializeWarehouseAuthentication() {
    if (!WAREHOUSE_LOGIN_REQUIRED) {
        applyWarehouseSession(null);
        closeWarehouseLogin();
        return;
    }
    try {
        applyWarehouseSession(await ipcRenderer.invoke("pm-session-get"));
    } catch {
        applyWarehouseSession(null);
    }
    if (!isWarehouseLoggedIn()) openWarehouseLogin();
    const [assignees, admins] = await Promise.allSettled([
        requestBackend("/api/shared/assignees"),
        requestBackend("/api/shared/admins"),
    ]);
    if (assignees.status === "fulfilled") {
        const payload = assignees.value || {};
        warehouseAssigneeGroups = payload.groups && typeof payload.groups === "object" ? payload.groups : {};
    }
    if (admins.status === "fulfilled") {
        warehouseAdmins = (admins.value?.admins || []).map((admin) => String(admin?.name || "").trim()).filter(Boolean);
    }
    renderWarehouseLoginSources();
}

function loadPersistedWarehouseData() {
    return requestBackend("/api/warehouse-inventory/state");
}

function savePersistedWarehouseData(snapshot) {
    return requestBackend("/api/warehouse-inventory/state", { method: "PUT", body: snapshot });
}

function setWarehouseDatabaseStatus(state, message) {
    const status = document.getElementById("warehouseDatabaseStatus");
    if (!status) return;
    status.classList.remove("is-saving", "is-ready", "is-error");
    if (state) status.classList.add(`is-${state}`);
    const indicator = status.querySelector("i");
    status.replaceChildren();
    if (indicator) status.appendChild(indicator);
    status.append(document.createTextNode(` ${message}`));
}

function serializeWarehouseInventory() {
    return Array.from(inventory.values()).map((item) => ({
        ...item,
        tags: Array.isArray(item.tags) ? [...item.tags] : [],
        pairedLocation: item.pairedLocation || null,
    }));
}

function warehouse3dStateSnapshot() {
    return {
        rows: warehouseRows.map((row) => ({ ...row })),
        inventory: serializeWarehouseInventory(),
        actor: warehouseActorSnapshot(),
        selectedLocation: selectedSlot?.code || "",
        displayFields: Array.from(displayFields),
        revision: warehouseRevision,
        generatedAt: new Date().toISOString(),
    };
}

function broadcastWarehouse3dState() {
    ipcRenderer.send("warehouse-3d-update", warehouse3dStateSnapshot());
}

function setupWarehouse3dViewer() {
    document.getElementById("openWarehouse3d")?.addEventListener("click", async () => {
        const button = document.getElementById("openWarehouse3d");
        button.disabled = true;
        try {
            const opened = await ipcRenderer.invoke("warehouse-3d-open-window", warehouse3dStateSnapshot());
            if (!opened) throw new Error("Il processo principale non ha creato la finestra.");
        } catch (error) {
            showWarehouseToast(`Vista 3D non disponibile: ${error.message}. Chiudi completamente AyPi e riavvialo.`, true);
        } finally {
            button.disabled = false;
        }
    });
    ipcRenderer.on("warehouse-3d-slot-selected", (_event, location) => {
        const parsed = parseSlotCode(location);
        if (!parsed) return;
        selectedRow = parsed.row;
        selectedSlot = parsed;
        selectedSlotCodes.clear();
        selectedSlotCodes.add(parsed.code);
        renderTabs();
        renderMap();
        renderDetails();
    });
}

function cloneUnloadZoneUnits(units = unloadZone) {
    return (units || []).map((item) => ({
        ...item,
        tags: [...(item.tags || [])],
        originalLocations: [...(item.originalLocations || [])],
    }));
}

function serializeWarehouseMovements() {
    return movementHistory.map(cloneWarehouseMovement);
}

function cloneWarehouseRows(rows) {
    return (rows || []).map((item) => ({ ...item, tags: [...(item.tags || [])] }));
}

function cloneWarehouseMovement(movement) {
    return {
        ...movement,
        actor: movement.actor ? { ...movement.actor } : null,
        lines: (movement.lines || []).map((line) => ({ ...line, locations: [...(line.locations || [])] })),
        operationalSteps: (movement.operationalSteps || []).map((step) => ({
            ...step,
            from: [...(step.from || [])],
            to: [...(step.to || [])],
            units: (step.units || []).map((unit) => ({ ...unit })),
        })),
        beforeState: cloneWarehouseRows(movement.beforeState),
        afterState: cloneWarehouseRows(movement.afterState),
        changes: movement.changes ? {
            loaded: (movement.changes.loaded || []).map((entry) => ({ ...entry, from: [...(entry.from || [])], to: [...(entry.to || [])] })),
            unloaded: (movement.changes.unloaded || []).map((entry) => ({ ...entry, from: [...(entry.from || [])], to: [...(entry.to || [])] })),
            shifted: (movement.changes.shifted || []).map((entry) => ({ ...entry, from: [...(entry.from || [])], to: [...(entry.to || [])] })),
            adjusted: (movement.changes.adjusted || []).map((entry) => ({ ...entry })),
        } : null,
    };
}

function legacyMovementUnit(movement, article, locations, sequence) {
    const pallet = locations.length === 2
        && locations.every((location) => parseSlotCode(location)?.level === "a");
    const id = `legacy-${movement.id}-${sequence}`;
    return locations.map((location, index) => ({
        id,
        location,
        article,
        customer: "",
        orderReference: "",
        tags: ["ricostruzione storica"],
        inMovement: false,
        type: pallet ? "pallet" : "crate",
        pairedLocation: pallet ? locations[index === 0 ? 1 : 0] : null,
        receivedAt: movement.timestamp,
    }));
}

function backfillLegacyMovementSnapshots() {
    let workingState = serializeWarehouseInventory();
    movementHistory.forEach((movement) => {
        if (movement.beforeState?.length || movement.afterState?.length || movement.changes) {
            workingState = cloneWarehouseRows(movement.beforeState);
            return;
        }
        const afterState = cloneWarehouseRows(workingState);
        const previousByLocation = new Map(afterState.map((item) => [item.location, { ...item, tags: [...(item.tags || [])] }]));
        if (movement.type === "load") {
            const removedIds = new Set();
            (movement.lines || []).forEach((line) => {
                (line.locations || []).forEach((entry) => {
                    const locations = String(entry || "").split(/\s*\+\s*/).filter((location) => parseSlotCode(location));
                    const exact = locations.map((location) => previousByLocation.get(location)).find((item) => item?.article === line.article);
                    const fallback = Array.from(previousByLocation.values()).find((item) => item.article === line.article && !removedIds.has(item.id));
                    const target = exact || fallback;
                    if (!target) return;
                    removedIds.add(target.id);
                    Array.from(previousByLocation.entries()).forEach(([location, item]) => {
                        if (item.id === target.id) previousByLocation.delete(location);
                    });
                });
            });
        } else {
            let sequence = 0;
            (movement.lines || []).forEach((line) => {
                (line.locations || []).forEach((entry) => {
                    const locations = String(entry || "").split(/\s*\+\s*/).filter((location) => parseSlotCode(location));
                    legacyMovementUnit(movement, line.article, locations, sequence++).forEach((item) => {
                        if (!previousByLocation.has(item.location)) previousByLocation.set(item.location, item);
                    });
                });
            });
        }
        const beforeState = Array.from(previousByLocation.values());
        movement.beforeState = cloneWarehouseRows(beforeState);
        movement.afterState = cloneWarehouseRows(afterState);
        movement.changes = buildMovementChanges(beforeState, afterState);
        movement.reconstructed = true;
        movement.actor = movement.actor || {
            role: "legacy",
            displayName: "Operatore storico non registrato",
            adminName: "",
            department: "",
            employee: "",
        };
        workingState = beforeState;
    });
}

function hydrateWarehouseSnapshot(snapshot) {
    inventory.clear();
    (snapshot?.inventory || []).forEach((item) => {
        if (!item?.location || !item?.id) return;
        const pieceCount = Math.max(1, Number(item.pieceCount) || 1);
        const { partial: _legacyPartial, ...warehouseItem } = item;
        inventory.set(item.location, {
            ...warehouseItem,
            weighingCode: String(item.weighingCode || "").trim(),
            pieceCount,
            maxPieceCapacity: Math.max(pieceCount, Number(item.maxPieceCapacity) || pieceCount),
            tags: Array.isArray(item.tags) ? [...item.tags] : [],
            pairedLocation: item.pairedLocation || null,
        });
    });
    unloadZone.splice(0, unloadZone.length, ...cloneUnloadZoneUnits(snapshot?.unloadZone || []).map((item) => {
        const { partial: _legacyPartial, ...warehouseItem } = item;
        const pieceCount = Math.max(1, Number(item.pieceCount) || 1);
        return {
            ...warehouseItem,
            weighingCode: String(item.weighingCode || "").trim(),
            pieceCount,
            maxPieceCapacity: Math.max(pieceCount, Number(item.maxPieceCapacity) || pieceCount),
        };
    }));
    movementHistory.splice(0, movementHistory.length, ...(snapshot?.movements || []).map(cloneWarehouseMovement));
    backfillLegacyMovementSnapshots();
    warehouseRevision = Number(snapshot?.revision) || 0;
}

function refreshWarehouseDataViews() {
    selectedSlotCodes.clear();
    selectedReportLocations.clear();
    selectedSlot = null;
    selectedAnalysisLocation = null;
    renderTabs();
    renderMap();
    refreshInventorySearch();
    renderDetails();
    renderMovementHistory();
    renderUnloadZone();
    updateSummary();
    if (!document.getElementById("analysisView")?.hidden) renderAnalysisTable();
    broadcastWarehouse3dState();
}

function setTestDatabaseButtonsDisabled(disabled) {
    const inaccessible = !isExclusiveTestDatabaseAdmin();
    document.getElementById("populateWarehouseDatabase").disabled = disabled || inaccessible;
    document.getElementById("clearWarehouseDatabase").disabled = disabled || inaccessible;
}

function setWarehouseOperationsDisabled(disabled) {
    warehouseStorageUnavailable = disabled;
    syncWarehouseSessionUi();
}

async function initializeWarehousePersistence() {
    setTestDatabaseButtonsDisabled(true);
    setWarehouseOperationsDisabled(true);
    setWarehouseDatabaseStatus("saving", "Caricamento database…");
    try {
        const snapshot = await loadPersistedWarehouseData();
        hydrateWarehouseSnapshot(snapshot);
        warehousePersistenceReady = true;
        refreshWarehouseDataViews();
        setWarehouseDatabaseStatus("ready", `${warehouseStorageLabel()} · ${inventory.size} slot occupati`);
    } catch (error) {
        warehousePersistenceReady = false;
        setWarehouseDatabaseStatus("error", "Database non raggiungibile");
        showWarehouseToast(`Impossibile caricare il database: ${error.message}`, true);
    } finally {
        setTestDatabaseButtonsDisabled(!warehousePersistenceReady);
        setWarehouseOperationsDisabled(!warehousePersistenceReady);
    }
}

function persistWarehouseData(
    inventorySnapshot = serializeWarehouseInventory(),
    movementSnapshot = serializeWarehouseMovements(),
    unloadZoneSnapshot = cloneUnloadZoneUnits(),
) {
    const snapshot = {
        inventory: inventorySnapshot,
        movements: movementSnapshot,
        unloadZone: unloadZoneSnapshot,
    };
    warehousePersistenceQueue = warehousePersistenceQueue.catch(() => undefined).then(async () => {
        if (!warehousePersistenceReady) throw new Error("Database del magazzino non connesso.");
        setWarehouseDatabaseStatus("saving", "Salvataggio SQLite…");
        try {
            const saved = await savePersistedWarehouseData({ ...snapshot, baseRevision: warehouseRevision });
            warehouseRevision = Number(saved?.revision) || warehouseRevision + 1;
            setWarehouseDatabaseStatus("ready", `${warehouseStorageLabel()} salvato · ${snapshot.inventory.length} slot occupati`);
            broadcastWarehouse3dState();
            return saved;
        } catch (error) {
            setWarehouseDatabaseStatus("error", "Salvataggio non riuscito");
            showWarehouseToast(`Dati modificati localmente ma non salvati: ${error.message}`, true);
            throw error;
        }
    });
    return warehousePersistenceQueue;
}

function normalizeCustomer(value) {
    return String(value || "").trim().toUpperCase();
}

function parseCustomerList(value) {
    return Array.from(
        new Set(
            String(value || "")
                .split(/[,;\n]+/)
                .map(normalizeCustomer)
                .filter(Boolean),
        ),
    );
}

function hasRestriction(rule) {
    return Boolean(rule && (rule.whitelist.length || rule.blacklist.length));
}

function restrictionLabel(rule) {
    if (!hasRestriction(rule)) return "—";
    const parts = [];
    if (rule.whitelist.length) parts.push(`Solo: ${rule.whitelist.join(", ")}`);
    if (rule.blacklist.length) parts.push(`Esclusi: ${rule.blacklist.join(", ")}`);
    return parts.join(" · ");
}

function ruleAllowsCustomer(rule, customer) {
    if (!hasRestriction(rule)) return true;
    const normalized = normalizeCustomer(customer);
    if (rule.whitelist.length && !rule.whitelist.includes(normalized)) return false;
    if (rule.blacklist.includes(normalized)) return false;
    return true;
}

function evaluateCustomerForSlot(location, customer) {
    const parsed = parseSlotCode(location);
    const rowRule = rowRestrictions.get(parsed?.row);
    if (!ruleAllowsCustomer(rowRule, customer)) return { allowed: false, source: "fila" };
    const slotRule = slotRestrictions.get(location);
    if (!ruleAllowsCustomer(slotRule, customer)) return { allowed: false, source: "slot" };
    return { allowed: true, source: null };
}

function validateRestriction(rule) {
    const overlap = rule.whitelist.filter((customer) => rule.blacklist.includes(customer));
    return overlap.length ? `Cliente presente sia in whitelist sia in blacklist: ${overlap.join(", ")}` : "";
}

function slotCode(row, columnIndex, side, level) {
    const inverted = Boolean(rowConfiguration(row)?.invertedSides);
    const oddNumberSide = inverted ? "rear" : "front";
    const number = columnIndex * 2 + (side === oddNumberSide ? 1 : 2);
    return `${row}${number}${level}`;
}

function sideForPosition(row, number) {
    const inverted = Boolean(rowConfiguration(row)?.invertedSides);
    const oddPosition = number % 2 !== 0;
    return oddPosition === inverted ? "rear" : "front";
}

function parseSlotCode(value) {
    const normalized = String(value || "").trim().toUpperCase();
    const match = SLOT_PATTERN.exec(normalized);
    if (!match) return null;
    const number = Number(match[2]);
    const row = match[1].toUpperCase();
    if (!rowConfiguration(row) || number < 1 || number > maximumPositionForRow(row)) return null;
    return {
        code: `${row}${number}${match[3].toLowerCase()}`,
        row,
        number,
        level: match[3].toLowerCase(),
        side: sideForPosition(row, number),
        physicalColumn: Math.ceil(number / 2),
    };
}

function palletBlockingSlot(location) {
    const parsed = typeof location === "string" ? parseSlotCode(location) : location;
    if (!parsed || parsed.level === "a") return null;
    const frontGround = `${parsed.row}${parsed.physicalColumn * 2 - 1}a`;
    const rearGround = `${parsed.row}${parsed.physicalColumn * 2}a`;
    const pallet = [frontGround, rearGround]
        .map((code) => inventory.get(code))
        .find((item) => item?.type === "pallet");
    return pallet?.id || null;
}

function blockedSlotCount() {
    return allWarehouseSlots().filter((slot) => !slot.item && palletBlockingSlot(slot)).length;
}

function itemMatchesSelection(item) {
    if (!selectedSlot || !item) return false;
    const selectedItem = inventory.get(selectedSlot.code);
    if (!selectedItem) return false;
    if (displayFields.has("article")) return item.article === selectedItem.article;
    if (displayFields.has("customer")) return item.customer === selectedItem.customer;
    if (displayFields.has("order")) return item.orderReference === selectedItem.orderReference;
    if (displayFields.has("weighing")) return Boolean(selectedItem.weighingCode)
        && normalizeCustomer(item.weighingCode) === normalizeCustomer(selectedItem.weighingCode);
    return item.article === selectedItem.article;
}

function slotDisplayLines(code, item) {
    const values = {
        location: [code, "location"],
        article: [item.article || "Articolo —", "article"],
        pieces: [`${warehouseItemPieces(item)} pezzi`, "quantity"],
        customer: [item.customer || "Cliente —", "customer"],
        order: [item.orderReference || "Ordine —", "order"],
        weighing: [item.weighingCode ? `Pesata ${item.weighingCode}` : "Pesata —", "weighing"],
        type: [item.type === "pallet" ? "Pallet" : "Cassone", "type"],
        tags: [item.tags?.length ? item.tags.map((tag) => `#${tag}`).join(" ") : "Tag —", "tags"],
        receivedAt: [item.receivedAt
            ? `Ingresso ${new Date(item.receivedAt).toLocaleDateString("it-IT")}`
            : "Ingresso —", "receivedAt"],
    };
    return Array.from(displayFields, (field) => values[field]).filter(Boolean);
}

function renderCellLabel(button, code, item) {
    button.replaceChildren();
    if (!item) {
        button.textContent = displayFields.has("location") ? code : "Libero";
        return;
    }
    slotDisplayLines(code, item).forEach(([text, type]) => {
        const line = document.createElement("span");
        line.className = `slot__line slot__line--${type}`;
        line.textContent = text;
        button.appendChild(line);
    });
}

function fitSlotButtonLabel(button) {
    const combined = Boolean(button.querySelector(".slot__line"));
    const lineCount = button.querySelectorAll(".slot__line").length;
    let size = slotRangeMode === "paged" ? (lineCount > 3 ? 12 : 14) : lineCount > 3 ? 10.5 : 12;
    const minimum = slotRangeMode === "paged" ? 10 : 8.5;
    button.style.fontSize = `${size}px`;

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const contentNodes = combined ? Array.from(button.querySelectorAll(".slot__line")) : [button];
        const widthRatio = Math.max(...contentNodes.map((node) => {
            const availableWidth = combined ? node.clientWidth : button.clientWidth;
            return availableWidth > 0 ? node.scrollWidth / availableWidth : 1;
        }));
        const ratio = widthRatio;
        if (ratio <= 1.01) break;
        const nextSize = Math.max(minimum, Math.floor((size / ratio) * 10) / 10);
        if (nextSize >= size) break;
        size = nextSize;
        button.style.fontSize = `${size}px`;
    }
}

function scheduleSlotLabelFit() {
    if (slotLabelFitFrame) cancelAnimationFrame(slotLabelFitFrame);
    slotLabelFitFrame = requestAnimationFrame(() => {
        document.querySelectorAll("#warehouseLevels .slot").forEach(fitSlotButtonLabel);
        slotLabelFitFrame = null;
    });
}

function createSlotButton(row, columnIndex, side, level) {
    const code = slotCode(row, columnIndex, side, level);
    const item = inventory.get(code);
    const blockingPalletId = !item ? palletBlockingSlot(code) : null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slot slot--${side}`;
    button.dataset.slot = code;
    renderCellLabel(button, code, item);
    button.setAttribute("aria-label", blockingPalletId
        ? `${code}, bloccato dal pallet ${blockingPalletId}`
        : item ? `${code}, articolo ${item.article}` : `${code}, libero`);
    button.disabled = Boolean(blockingPalletId);
    button.classList.toggle("is-occupied", Boolean(item));
    button.classList.toggle("is-pallet", item?.type === "pallet");
    button.classList.toggle("is-pallet-blocked", Boolean(blockingPalletId));
    button.classList.toggle("is-match", code !== selectedSlot?.code && itemMatchesSelection(item));
    button.classList.toggle("is-search-match", currentSearchResults.some((result) => result.location === code));
    button.classList.toggle("is-selected", code === selectedSlot?.code);
    button.classList.toggle("is-multi-selected", selectedSlotCodes.has(code));
    button.classList.toggle("is-relocation-source", code === relocationSourceCode);
    const highlightedUnitId = item?.id || null;
    button.classList.toggle("is-movement-loaded", Boolean(movementHighlight && (
        movementHighlight.loadedIds.has(highlightedUnitId) || movementHighlight.loadedLocations.has(code)
    )));
    button.classList.toggle("is-movement-shifted", Boolean(movementHighlight && (
        movementHighlight.shiftedIds.has(highlightedUnitId) || movementHighlight.shiftedLocations.has(code)
    )));
    button.classList.toggle(
        "has-customer-conflict",
        Boolean(item && !evaluateCustomerForSlot(code, item.customer).allowed),
    );
    button.addEventListener("pointerenter", () => scheduleSlotPreview(code, button));
    button.addEventListener("pointerleave", hideSlotPreview);
    button.addEventListener("focus", () => scheduleSlotPreview(code, button, 0));
    button.addEventListener("blur", hideSlotPreview);
    button.addEventListener("click", (event) => {
        if (Date.now() < suppressSlotClickUntil) return;
        if (event.ctrlKey || event.metaKey) toggleSlotSelection(code);
        else {
            selectedSlotCodes.clear();
            selectSlot(code);
        }
    });
    button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (!(selectedSlotCodes.size > 1 && selectedSlotCodes.has(code))) {
            selectedSlotCodes.clear();
            selectSlot(code, false);
        }
        openContextMenu(code, event.clientX, event.clientY);
    });
    return button;
}

function createSideRow(row, side, level) {
    const container = document.createElement("div");
    container.className = "side-row";
    const label = document.createElement("div");
    label.className = "side-label";
    label.textContent = side === "rear" ? "Posteriore" : "Anteriore";
    container.appendChild(label);
    const columns = physicalColumnsForRow(row);
    const firstHalfColumns = Math.ceil(columns / 2);
    const firstIndex = slotRangeMode === "paged" && slotPage === 1 ? firstHalfColumns : 0;
    const lastIndex = slotRangeMode === "paged"
        ? slotPage === 0 ? firstHalfColumns : columns
        : columns;
    for (let index = firstIndex; index < lastIndex; index += 1) {
        container.appendChild(createSlotButton(row, index, side, level));
    }
    return container;
}

function updateSlotPager() {
    const pager = document.getElementById("slotPager");
    const previous = document.getElementById("previousSlotPage");
    const next = document.getElementById("nextSlotPage");
    if (!pager || !previous || !next) return;

    pager.dataset.rangeMode = slotRangeMode;
    const columns = physicalColumnsForRow(selectedRow);
    const firstHalfColumns = Math.ceil(columns / 2);
    const visibleColumns = slotRangeMode === "all"
        ? columns
        : slotPage === 0 ? firstHalfColumns : columns - firstHalfColumns;
    pager.style.setProperty("--visible-columns", String(Math.max(visibleColumns, 1)));
    const firstRangeEnd = firstHalfColumns * 2;
    const maximumPosition = columns * 2;
    const hasSecondHalf = columns > firstHalfColumns;
    previous.querySelector("small").textContent = `1–${firstRangeEnd}`;
    next.querySelector("small").textContent = hasSecondHalf ? `${firstRangeEnd + 1}–${maximumPosition}` : "—";
    document.getElementById("pagedRangeDescription").textContent = hasSecondHalf
        ? `Posizioni 1–${firstRangeEnd} e ${firstRangeEnd + 1}–${maximumPosition}`
        : `Posizioni 1–${maximumPosition} · fila non divisibile`;
    document.getElementById("allRangeDescription").textContent = `Tutte le posizioni 1–${maximumPosition}`;
    previous.setAttribute("aria-label", `Mostra slot da 1 a ${firstRangeEnd}`);
    next.setAttribute("aria-label", `Mostra slot da ${firstRangeEnd + 1} a ${maximumPosition}`);
    document.querySelectorAll("[data-slot-range]").forEach((button) => {
        const active = button.dataset.slotRange === slotRangeMode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
    });
    previous.disabled = slotRangeMode === "all" || slotPage === 0;
    next.disabled = slotRangeMode === "all" || slotPage === 1 || !hasSecondHalf;
    previous.title = `Mostra le posizioni da 1 a ${firstRangeEnd}`;
    next.title = `Mostra le posizioni da ${firstRangeEnd + 1} a ${maximumPosition}`;
    previous.classList.remove("has-selected-target");
    next.classList.remove("has-selected-target");

    const selectedItem = selectedSlot ? inventory.get(selectedSlot.code) : null;
    if (slotRangeMode !== "paged" || !selectedItem || selectedSlot.row !== selectedRow) return;
    const selectedPage = selectedSlot.number <= firstRangeEnd ? 0 : 1;
    if (selectedPage === slotPage) return;
    const targetArrow = selectedPage === 0 ? previous : next;
    targetArrow.classList.add("has-selected-target");
    targetArrow.title = `La posizione selezionata ${selectedSlot.code} si trova in questa metà`;
}

function renderMap() {
    hideSlotPreview();
    const levelsContainer = document.getElementById("warehouseLevels");
    const rowTitle = document.getElementById("rowTitle");
    if (!levelsContainer || !rowTitle) return;
    rowTitle.textContent = `Fila ${selectedRow}`;
    levelsContainer.dataset.displayMode = "multi";
    levelsContainer.dataset.fieldCount = String(displayFields.size);
    levelsContainer.style.setProperty("--slot-content-height", `${Math.min(122, 42 + Math.max(0, displayFields.size - 1) * 16)}px`);
    levelsContainer.classList.remove("slide-next", "slide-previous");
    levelsContainer.replaceChildren();

    LEVELS.forEach((level) => {
        const section = document.createElement("section");
        section.className = "level";
        section.dataset.level = level.code;
        const heading = document.createElement("div");
        heading.className = "level__heading";
        const title = document.createElement("strong");
        title.textContent = `Livello ${level.code}`;
        const description = document.createElement("span");
        description.textContent = `${level.label} · piano ${level.order}`;
        heading.append(title, description);
        section.appendChild(heading);
        section.appendChild(createSideRow(selectedRow, "rear", level.code));
        section.appendChild(createSideRow(selectedRow, "front", level.code));
        levelsContainer.appendChild(section);
    });
    if (slotPageDirection) {
        levelsContainer.classList.add(`slide-${slotPageDirection}`);
        slotPageDirection = null;
    }
    updateTabs();
    updateSlotPager();
    scheduleSlotLabelFit();
}

function rowContainsMatch(row) {
    if (!selectedSlot || !inventory.get(selectedSlot.code)) return false;
    return Array.from(inventory.values()).some(
        (item) => item.location.startsWith(row) && item.location !== selectedSlot.code && itemMatchesSelection(item),
    );
}

function rowContainsSearchMatch(row) {
    return currentSearchResults.some((item) => item.location.startsWith(row));
}

function updateTabs() {
    document.querySelectorAll(".row-tabs button").forEach((button) => {
        const row = button.dataset.row;
        const active = row === selectedRow;
        const hasMatch = rowContainsMatch(row);
        const hasSearchMatch = rowContainsSearchMatch(row);
        const hasMovementHighlight = Boolean(movementHighlight && Array.from(inventory.entries()).some(([location, item]) =>
            location.startsWith(row) && (movementHighlight.loadedIds.has(item.id)
                || movementHighlight.shiftedIds.has(item.id)
                || movementHighlight.loadedLocations.has(location)
                || movementHighlight.shiftedLocations.has(location))));
        button.classList.toggle("is-active", active);
        button.classList.toggle("has-match", hasMatch);
        button.classList.toggle("has-search-match", hasSearchMatch);
        button.classList.toggle("has-movement-highlight", hasMovementHighlight);
        button.setAttribute("aria-pressed", String(active));
        const indicators = [];
        if (hasMatch) indicators.push("corrispondenze");
        if (hasSearchMatch) indicators.push("risultati di ricerca");
        if (hasMovementHighlight) indicators.push("unità del movimento evidenziato");
        button.title = indicators.length ? `Fila ${row}: contiene ${indicators.join(" e ")}` : `Fila ${row}`;
    });
}

function renderTabs() {
    const tabs = document.getElementById("rowTabs");
    if (!tabs) return;
    tabs.replaceChildren();
    rowCodes().forEach((row) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = row;
        button.dataset.row = row;
        button.addEventListener("click", () => {
            selectedRow = row;
            renderMap();
        });
        tabs.appendChild(button);
    });
    updateTabs();
}

function setDetailRowVisibility(id, visible) {
    const row = document.getElementById(id);
    if (row) row.hidden = !visible;
}

function renderDetails(detailSlot = selectedSlot) {
    if (!detailSlot) return;
    const item = inventory.get(detailSlot.code);
    const blockingPalletId = !item ? palletBlockingSlot(detailSlot) : null;
    document.getElementById("detailCode").textContent = detailSlot.code;
    document.getElementById("detailRow").textContent = detailSlot.row;
    document.getElementById("detailColumn").textContent = String(detailSlot.physicalColumn);
    document.getElementById("detailSide").textContent = detailSlot.side === "rear" ? "Posteriore" : "Anteriore";
    const level = LEVELS.find((entry) => entry.code === detailSlot.level);
    document.getElementById("detailLevel").textContent = `${detailSlot.level} · ${level?.label || ""}`;

    const status = document.getElementById("detailStatus");
    status.className = blockingPalletId ? "blocked-badge" : item ? "occupied-badge" : "free-badge";
    status.textContent = blockingPalletId ? "Bloccato da pallet" : item ? "Occupato" : "Libero";
    setDetailRowVisibility("detailTypeRow", Boolean(item));
    setDetailRowVisibility("detailPairRow", item?.type === "pallet");
    setDetailRowVisibility("detailArticleRow", Boolean(item));
    setDetailRowVisibility("detailCustomerRow", Boolean(item));
    setDetailRowVisibility("detailOrderRow", Boolean(item));
    setDetailRowVisibility("detailWeighingRow", Boolean(item));
    setDetailRowVisibility("detailPiecesRow", Boolean(item));
    setDetailRowVisibility("detailTagsRow", Boolean(item?.tags?.length));
    setDetailRowVisibility("detailMovementRow", Boolean(item?.inMovement));
    const rowRule = rowRestrictions.get(detailSlot.row);
    const slotRule = slotRestrictions.get(detailSlot.code);
    const hasCustomerRule = hasRestriction(rowRule) || hasRestriction(slotRule);
    setDetailRowVisibility("detailRestrictionRow", hasCustomerRule);
    setDetailRowVisibility("detailComplianceRow", Boolean(item && hasCustomerRule));
    if (item) {
        document.getElementById("detailType").textContent = item.type === "pallet" ? "Pallet" : "Cassone";
        if (item.type === "pallet") {
            document.getElementById("detailPair").textContent = `${item.location} + ${item.pairedLocation}`;
        }
        document.getElementById("detailArticle").textContent = item.article;
        document.getElementById("detailCustomer").textContent = item.customer;
        document.getElementById("detailOrder").textContent = item.orderReference || "—";
        document.getElementById("detailWeighing").textContent = item.weighingCode || "—";
        document.getElementById("detailPieces").textContent = `${item.pieceCount} / ${item.maxPieceCapacity}`;
        document.getElementById("detailTags").textContent = item.tags.length ? item.tags.join(", ") : "—";
        document.getElementById("detailMovement").textContent = item.inMovement ? "In movimento" : "—";
    }
    if (hasCustomerRule) {
        const parts = [];
        if (hasRestriction(rowRule)) parts.push(`Fila: ${restrictionLabel(rowRule)}`);
        if (hasRestriction(slotRule)) parts.push(`Slot: ${restrictionLabel(slotRule)}`);
        document.getElementById("detailRestriction").textContent = parts.join(" · ");
    }
    if (item && hasCustomerRule) {
        const customerCheck = evaluateCustomerForSlot(detailSlot.code, item.customer);
        const compliance = document.getElementById("detailCompliance");
        compliance.textContent = customerCheck.allowed ? "Conforme" : `Conflitto · ${customerCheck.source}`;
        compliance.className = customerCheck.allowed ? "table-status--allowed" : "table-status--conflict";
    }
    document.getElementById("detailNote").textContent = blockingPalletId
        ? `Posizione non utilizzabile: la colonna è riservata al pallet ${blockingPalletId} collocato a terra.`
        : item
        ? "Contenuto registrato. Il dettaglio mostra pezzi correnti e capienza iniziale."
        : "Slot libero. I flussi di carico saranno aggiunti nelle fasi successive.";
}

function hideSlotPreview() {
    if (slotPreviewTimer) clearTimeout(slotPreviewTimer);
    slotPreviewTimer = null;
    const card = document.getElementById("slotHoverCard");
    if (card) card.hidden = true;
}

function scheduleSlotPreview(code, anchor, delay = 1000) {
    hideSlotPreview();
    slotPreviewTimer = setTimeout(() => {
        const parsed = parseSlotCode(code);
        const card = document.getElementById("slotHoverCard");
        if (!parsed || !card || !anchor.isConnected) return;
        renderDetails(parsed);
        card.hidden = false;
        const anchorRect = anchor.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        let left = anchorRect.right + 10;
        if (left + cardRect.width > window.innerWidth - 8) left = anchorRect.left - cardRect.width - 10;
        const top = Math.max(8, Math.min(anchorRect.top, window.innerHeight - cardRect.height - 8));
        card.style.left = `${Math.max(8, left)}px`;
        card.style.top = `${top}px`;
        slotPreviewTimer = null;
    }, delay);
}

function selectSlot(code, scroll = true) {
    const parsed = parseSlotCode(code);
    if (!parsed) return;
    selectedSlot = parsed;
    selectedRow = parsed.row;
    renderMap();
    renderDetails();
    broadcastWarehouse3dState();
    if (scroll) {
        document.querySelector(`[data-slot="${parsed.code}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
}

function toggleSlotSelection(code) {
    if (selectedSlotCodes.has(code)) selectedSlotCodes.delete(code);
    else selectedSlotCodes.add(code);
    selectedSlot = parseSlotCode(code);
    document.querySelectorAll(".slot").forEach((button) => {
        button.classList.toggle("is-multi-selected", selectedSlotCodes.has(button.dataset.slot));
    });
    renderDetails();
    broadcastWarehouse3dState();
}

let warehouseToastTimer = null;
function showWarehouseToast(message, error = false) {
    const toast = document.getElementById("warehouseToast");
    if (!toast) return;
    if (warehouseToastTimer) clearTimeout(warehouseToastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.toggle("is-error", error);
    warehouseToastTimer = setTimeout(() => {
        toast.hidden = true;
        warehouseToastTimer = null;
    }, 4200);
}

function refreshWarehouseAfterManualChange() {
    refreshInventorySearch();
    renderDetails();
    updateSummary();
    if (!document.getElementById("analysisView")?.hidden) renderAnalysisTable();
}

function closeContextMenu() {
    const menu = document.getElementById("slotContextMenu");
    menu?.classList.remove("is-open");
    menu?.setAttribute("aria-hidden", "true");
    contextSlotCode = null;
}

function openContextMenu(code, x, y) {
    const menu = document.getElementById("slotContextMenu");
    const hint = document.getElementById("contextMenuHint");
    const item = inventory.get(code);
    if (!menu || !hint) return;
    menu.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    contextSlotCode = code;
    const multiSelection = selectedSlotCodes.size > 1 && selectedSlotCodes.has(code);
    document.getElementById("contextSlotCode").textContent = multiSelection ? `${selectedSlotCodes.size} posizioni selezionate` : code;
    const relocate = document.getElementById("startRelocationButton");
    const place = document.getElementById("placeRelocationButton");
    const swap = document.getElementById("swapRelocationButton");
    const manualLoad = document.getElementById("manualLoadHereButton");
    const manualUnload = document.getElementById("manualUnloadHereButton");
    relocate.hidden = multiSelection || Boolean(relocationSourceCode);
    relocate.disabled = !item || item.type !== "crate";
    place.hidden = multiSelection || !relocationSourceCode || Boolean(item);
    swap.hidden = multiSelection || !relocationSourceCode || !item || code === relocationSourceCode;
    manualLoad.hidden = multiSelection || Boolean(relocationSourceCode) || Boolean(item);
    manualUnload.hidden = multiSelection || Boolean(relocationSourceCode) || !item;
    manualUnload.disabled = item?.type !== "crate";
    document.getElementById("manageSlotRestrictionsButton").hidden = multiSelection || !isWarehouseAdmin();
    document.getElementById("applySelectionRestrictions").hidden = !multiSelection || !isWarehouseAdmin();
    if (!warehousePersistenceReady) {
        menu.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    }
    hint.textContent = multiSelection
        ? `Le azioni massive interessano ${selectedSlotCodes.size} slot; la riallocazione resta disponibile soltanto per un cassone.`
        : relocationSourceCode
          ? `Riallocazione di ${relocationSourceCode}: scegli uno slot libero oppure occupato.`
          : item ? "Azioni sul contenuto e sulla singola ubicazione." : "Slot libero: puoi gestire il vincolo cliente o completare una riallocazione.";
    menu.classList.add("is-open");
    menu.setAttribute("aria-hidden", "false");
    const left = Math.min(x, window.innerWidth - menu.offsetWidth - 8);
    const top = Math.min(y, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
}

function applyInventoryState(state) {
    inventory.clear();
    state.forEach((item, location) => inventory.set(location, item));
    refreshWarehouseAfterManualChange();
    void persistWarehouseData().catch(() => {});
}

function validFrontRearModule(state, location) {
    const parsed = parseSlotCode(location);
    if (!parsed) return false;
    const frontNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "front", "a")).number;
    const rearNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "rear", "a")).number;
    const frontOccupied = ["a", "b", "c"].some((level) => state.has(`${parsed.row}${frontNumber}${level}`));
    const rearFull = ["a", "b", "c"].every((level) => state.has(`${parsed.row}${rearNumber}${level}`));
    return !frontOccupied || rearFull;
}

function relocateCrate(sourceCode, targetCode, swap = false) {
    const source = inventory.get(sourceCode);
    const target = inventory.get(targetCode);
    if (!source || source.type !== "crate") return { error: "La riallocazione manuale è disponibile soltanto per un cassone." };
    if (swap) {
        if (!target || target.type !== "crate") return { error: "Lo scambio richiede due cassoni standard." };
        if (!evaluateCustomerForSlot(targetCode, source.customer).allowed || !evaluateCustomerForSlot(sourceCode, target.customer).allowed) {
            return { error: "Scambio non conforme ai vincoli cliente di una delle due ubicazioni." };
        }
        const state = cloneInventoryState();
        const left = state.get(sourceCode);
        const right = state.get(targetCode);
        left.location = targetCode;
        right.location = sourceCode;
        state.set(sourceCode, right);
        state.set(targetCode, left);
        applyInventoryState(state);
        return { message: `${sourceCode} e ${targetCode} scambiati. Operazione manuale non inserita nello storico.` };
    }
    const state = cloneInventoryState();
    state.delete(sourceCode);
    compactCrateStacks(state);
    const parsed = parseSlotCode(targetCode);
    if (!validCrateDestination(state, parsed, source.customer)) {
        return { error: `${targetCode} non è una destinazione valida per vincoli fisici o cliente.` };
    }
    const moved = { ...source, tags: [...source.tags], location: targetCode };
    state.set(targetCode, moved);
    if (!validFrontRearModule(state, sourceCode) || !validFrontRearModule(state, targetCode)) {
        return { error: "Riallocazione non conforme: lascerebbe una pila anteriore davanti a un posteriore non completo." };
    }
    applyInventoryState(state);
    return { message: `${sourceCode} riallocato in ${targetCode}. Operazione manuale non inserita nello storico.` };
}

function setupContextMenu() {
    document.getElementById("startRelocationButton")?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!contextSlotCode || inventory.get(contextSlotCode)?.type !== "crate") return;
        relocationSourceCode = contextSlotCode;
        selectedSlotCodes.clear();
        renderMap();
        closeContextMenu();
        showWarehouseToast(`Riallocazione avviata da ${relocationSourceCode}. Scegli la destinazione con il tasto destro.`);
    });
    const completeRelocation = (swap) => {
        if (!relocationSourceCode || !contextSlotCode) return;
        const source = relocationSourceCode;
        const result = relocateCrate(source, contextSlotCode, swap);
        if (!result.error) relocationSourceCode = null;
        renderMap();
        closeContextMenu();
        showWarehouseToast(result.error || result.message, Boolean(result.error));
    };
    document.getElementById("placeRelocationButton")?.addEventListener("click", (event) => {
        event.stopPropagation();
        completeRelocation(false);
    });
    document.getElementById("swapRelocationButton")?.addEventListener("click", (event) => {
        event.stopPropagation();
        completeRelocation(true);
    });
    document.getElementById("manualLoadHereButton")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const location = contextSlotCode;
        closeContextMenu();
        if (location) openManualMovementDialog("load", location);
    });
    document.getElementById("manualUnloadHereButton")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const location = contextSlotCode;
        closeContextMenu();
        if (location) openManualMovementDialog("unload", location);
    });
    document.getElementById("manageSlotRestrictionsButton")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = contextSlotCode;
        closeContextMenu();
        openRestrictionDialog(target ? [target] : null);
    });
    document.getElementById("applySelectionRestrictions")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const targets = Array.from(selectedSlotCodes);
        closeContextMenu();
        openRestrictionDialog(targets);
    });
    document.addEventListener("click", closeContextMenu);
    window.addEventListener("blur", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeContextMenu();
            if (relocationSourceCode) {
                relocationSourceCode = null;
                renderMap();
                showWarehouseToast("Riallocazione annullata.");
            }
        }
    });
}

function setupSlotAreaSelection() {
    let drag = null;
    const rectangle = document.getElementById("slotSelectionRectangle");
    document.addEventListener("pointerdown", (event) => {
        const slot = event.target.closest?.("#warehouseLevels .slot");
        if (!slot || event.button !== 0 || slot.disabled) return;
        drag = {
            startX: event.clientX,
            startY: event.clientY,
            active: false,
            initial: event.ctrlKey || event.metaKey ? new Set(selectedSlotCodes) : new Set(),
        };
    }, true);
    document.addEventListener("pointermove", (event) => {
        if (!drag) return;
        const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (!drag.active && distance < 6) return;
        drag.active = true;
        hideSlotPreview();
        const left = Math.min(drag.startX, event.clientX);
        const top = Math.min(drag.startY, event.clientY);
        const right = Math.max(drag.startX, event.clientX);
        const bottom = Math.max(drag.startY, event.clientY);
        rectangle.hidden = false;
        Object.assign(rectangle.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
        selectedSlotCodes.clear();
        drag.initial.forEach((code) => selectedSlotCodes.add(code));
        document.querySelectorAll("#warehouseLevels .slot:not(:disabled)").forEach((button) => {
            const bounds = button.getBoundingClientRect();
            const intersects = bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom;
            if (intersects) selectedSlotCodes.add(button.dataset.slot);
            button.classList.toggle("is-multi-selected", selectedSlotCodes.has(button.dataset.slot));
        });
    }, true);
    document.addEventListener("pointerup", () => {
        if (!drag) return;
        if (drag.active) {
            suppressSlotClickUntil = Date.now() + 250;
            rectangle.hidden = true;
            const last = Array.from(selectedSlotCodes).at(-1);
            if (last) {
                selectedSlot = parseSlotCode(last);
                renderDetails();
            }
        }
        drag = null;
    }, true);
}

function setupDisplayMode() {
    const menu = document.getElementById("displayFieldsMenu");
    const summary = document.getElementById("displayFieldsSummary");
    const labels = {
        location: "Ubicazione",
        article: "Articolo",
        pieces: "N. pezzi",
        customer: "Cliente",
        order: "Rif. ordine",
        weighing: "Codice pesata",
        type: "Tipologia",
        tags: "Tag",
        receivedAt: "Data ingresso",
    };
    const updateSummary = () => {
        const selected = Array.from(displayFields, (field) => labels[field]);
        summary.textContent = selected.length <= 3
            ? selected.join(" · ")
            : `${selected.length} campi selezionati`;
        summary.title = selected.join(" · ");
    };
    document.querySelectorAll('input[name="displayField"]').forEach((input) => {
        input.checked = displayFields.has(input.value);
        input.addEventListener("change", () => {
            if (input.checked) displayFields.add(input.value);
            else if (displayFields.size > 1) displayFields.delete(input.value);
            else input.checked = true;
            updateSummary();
            renderMap();
            broadcastWarehouse3dState();
        });
    });
    document.addEventListener("pointerdown", (event) => {
        if (menu?.open && !event.target.closest?.("#displayFieldsMenu")) menu.open = false;
    });
    updateSummary();
}

function setupSlotPager() {
    const previous = document.getElementById("previousSlotPage");
    const next = document.getElementById("nextSlotPage");

    document.querySelectorAll("[data-slot-range]").forEach((button) => {
        button.addEventListener("click", () => {
            slotRangeMode = button.dataset.slotRange;
            slotPage = 0;
            slotPageDirection = null;
            renderMap();
        });
    });
    previous?.addEventListener("click", () => {
        if (slotRangeMode !== "paged" || slotPage === 0) return;
        slotPage = 0;
        slotPageDirection = "previous";
        renderMap();
    });
    next?.addEventListener("click", () => {
        if (slotRangeMode !== "paged" || slotPage === 1) return;
        slotPage = 1;
        slotPageDirection = "next";
        renderMap();
    });
}

let toolsDrawerCloseTimer = null;

function openToolsDrawer() {
    if (toolsDrawerCloseTimer) clearTimeout(toolsDrawerCloseTimer);
    const drawer = document.getElementById("toolsDrawer");
    const scrim = document.getElementById("toolsDrawerScrim");
    const handle = document.getElementById("toolsDrawerHandle");
    drawer?.classList.add("is-open");
    scrim?.classList.add("is-open");
    handle?.setAttribute("aria-expanded", "true");
}

function closeToolsDrawer(delay = 0) {
    if (toolsDrawerCloseTimer) clearTimeout(toolsDrawerCloseTimer);
    toolsDrawerCloseTimer = setTimeout(() => {
        document.getElementById("toolsDrawer")?.classList.remove("is-open");
        document.getElementById("toolsDrawerScrim")?.classList.remove("is-open");
        document.getElementById("toolsDrawerHandle")?.setAttribute("aria-expanded", "false");
        toolsDrawerCloseTimer = null;
    }, delay);
}

function setupToolsDrawer() {
    const drawer = document.getElementById("toolsDrawer");
    const handle = document.getElementById("toolsDrawerHandle");
    drawer?.addEventListener("pointerenter", openToolsDrawer);
    drawer?.addEventListener("pointerleave", () => closeToolsDrawer(120));
    handle?.addEventListener("pointerenter", openToolsDrawer);
    handle?.addEventListener("pointerleave", () => closeToolsDrawer(320));
    handle?.addEventListener("focus", openToolsDrawer);
    handle?.addEventListener("click", openToolsDrawer);
    document.getElementById("toolsDrawerScrim")?.addEventListener("click", () => closeToolsDrawer());
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeToolsDrawer();
    });
}

let warehouseStructureDraft = warehouseRows.map((row) => ({ ...row }));

function nextAvailableRowCode() {
    const used = new Set(warehouseStructureDraft.map((row) => row.code));
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((code) => !used.has(code));
}

function setWarehouseStructureMessage(text, success = false) {
    const message = document.getElementById("warehouseStructureMessage");
    if (!message) return;
    message.textContent = text;
    message.classList.toggle("is-success", success);
}

function renderWarehouseStructureEditor() {
    const container = document.getElementById("warehouseRowsEditor");
    if (!container) return;
    container.replaceChildren();
    warehouseStructureDraft
        .sort((left, right) => left.code.localeCompare(right.code))
        .forEach((configuration) => {
            const row = document.createElement("div");
            row.className = "warehouse-row-editor__row";
            row.dataset.row = configuration.code;
            const label = document.createElement("strong");
            label.textContent = `Fila ${configuration.code}`;
            const inputLabel = document.createElement("label");
            inputLabel.className = "warehouse-row-editor__capacity";
            const input = document.createElement("input");
            input.type = "number";
            input.min = "6";
            input.max = "192";
            input.step = "6";
            input.value = String(configuration.capacity);
            input.setAttribute("aria-label", `Capacità fila ${configuration.code} in cassoni`);
            input.addEventListener("input", () => {
                configuration.capacity = Number(input.value);
                setWarehouseStructureMessage("");
            });
            const suffix = document.createElement("span");
            suffix.textContent = "cassoni";
            inputLabel.append(input, suffix);
            const orientationLabel = document.createElement("label");
            orientationLabel.className = "warehouse-row-editor__orientation";
            const orientationInput = document.createElement("input");
            orientationInput.type = "checkbox";
            orientationInput.checked = Boolean(configuration.invertedSides);
            orientationInput.setAttribute("aria-label", `Inverti lato anteriore e posteriore della fila ${configuration.code}`);
            const orientationText = document.createElement("span");
            const updateOrientationText = () => {
                orientationText.textContent = orientationInput.checked
                    ? "Invertita · dispari dietro, pari davanti"
                    : "Standard · dispari davanti, pari dietro";
            };
            updateOrientationText();
            orientationInput.addEventListener("change", () => {
                configuration.invertedSides = orientationInput.checked;
                updateOrientationText();
                setWarehouseStructureMessage("Modifica da applicare.");
            });
            orientationLabel.append(orientationInput, orientationText);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "warehouse-row-editor__remove";
            remove.textContent = "×";
            remove.title = `Rimuovi fila ${configuration.code}`;
            remove.disabled = warehouseStructureDraft.length === 1;
            remove.addEventListener("click", () => {
                warehouseStructureDraft = warehouseStructureDraft.filter((entry) => entry.code !== configuration.code);
                renderWarehouseStructureEditor();
                setWarehouseStructureMessage("Modifica da applicare.");
            });
            row.append(label, inputLabel, remove, orientationLabel);
            container.appendChild(row);
        });
}

function validateWarehouseStructure() {
    for (const configuration of warehouseStructureDraft) {
        if (!Number.isInteger(configuration.capacity) || configuration.capacity < 6 || configuration.capacity > 192 || configuration.capacity % 6 !== 0) {
            return `Fila ${configuration.code}: indica da 6 a 192 cassoni, in multipli di 6.`;
        }
    }
    for (const item of inventory.values()) {
        const match = SLOT_PATTERN.exec(item.location);
        const configuration = warehouseStructureDraft.find((row) => row.code === match?.[1]?.toUpperCase());
        if (!configuration) return `La fila ${match?.[1]} contiene merce e non può essere rimossa.`;
        const maximumPosition = configuration.capacity / 3;
        if (Number(match[2]) > maximumPosition) {
            return `${item.location} è occupato: la fila ${configuration.code} deve contenere almeno ${Number(match[2]) * 3} cassoni.`;
        }
    }
    return "";
}

function applyWarehouseStructure() {
    if (!isWarehouseAdmin()) {
        showWarehouseToast("Accesso amministratore richiesto per modificare la struttura fisica.", true);
        return;
    }
    const error = validateWarehouseStructure();
    if (error) {
        setWarehouseStructureMessage(error);
        return;
    }
    warehouseRows = warehouseStructureDraft.map((row) => ({ ...row }));
    const validRows = new Set(rowCodes());
    Array.from(rowRestrictions.keys()).forEach((row) => {
        if (!validRows.has(row)) rowRestrictions.delete(row);
    });
    Array.from(slotRestrictions.keys()).forEach((location) => {
        if (!parseSlotCode(location)) slotRestrictions.delete(location);
    });
    if (!validRows.has(selectedRow)) selectedRow = warehouseRows[0].code;
    if (!validRows.has(selectedRestrictionRow)) selectedRestrictionRow = warehouseRows[0].code;
    if (selectedSlot) selectedSlot = parseSlotCode(selectedSlot.code);
    slotPage = 0;
    renderTabs();
    renderMap();
    renderDetails();
    updateSummary();
    if (!document.getElementById("analysisView")?.hidden) renderAnalysisTable();
    setWarehouseStructureMessage("Struttura applicata. Le modifiche sono ancora solo dimostrative.", true);
    broadcastWarehouse3dState();
}

function setupWarehouseStructure() {
    renderWarehouseStructureEditor();
    document.getElementById("addWarehouseRow")?.addEventListener("click", () => {
        const code = nextAvailableRowCode();
        if (!code) {
            setWarehouseStructureMessage("Hai raggiunto il limite di 26 file.");
            return;
        }
        warehouseStructureDraft.push({ code, capacity: 96, invertedSides: defaultInvertedSides(code) });
        renderWarehouseStructureEditor();
        setWarehouseStructureMessage("Nuova fila da applicare.");
    });
    document.getElementById("applyWarehouseStructure")?.addEventListener("click", applyWarehouseStructure);
}

function updateLoadTypeNote() {
    const type = document.getElementById("loadType")?.value;
    const note = document.getElementById("loadTypeNote");
    if (!note) return;
    if (operationGroupMode === "unload") {
        note.classList.remove("is-pallet");
        note.textContent = "Il prelievo applicherà FIFO e ottimizzerà l'intero gruppo. Puoi anche aggiungere unità specifiche dal report di ricerca.";
        return;
    }
    const pallet = type === "pallet";
    note.classList.toggle("is-pallet", pallet);
    note.textContent = pallet
        ? "Un pallet occupa obbligatoriamente la coppia anteriore/posteriore dello stesso modulo, esclusivamente a terra (livello a). La colonna deve essere completamente libera e non può avere merce sopra o sotto."
        : "Un cassone occupa una singola ubicazione e può essere impilato rispettando i livelli.";
}

function operationModeLabel(capitalized = false) {
    const label = operationGroupMode === "load" ? "carico" : "scarico";
    return capitalized ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : label;
}

function activeOperationGroup() {
    return operationGroups[operationGroupMode];
}

function loadBatchCount() {
    const field = document.getElementById("loadBatchCount");
    return Math.max(1, Math.min(50, Math.trunc(Number(field?.value) || 1)));
}

function createLoadBatchRow(index) {
    const row = document.createElement("div");
    row.className = "load-batch__row";
    row.dataset.batchIndex = String(index);
    const number = document.createElement("strong");
    number.textContent = String(index + 1);
    const weighingLabel = document.createElement("label");
    const weighing = document.createElement("input");
    weighing.className = "load-batch-weighing";
    weighing.placeholder = `Pesata cassone ${index + 1} (opzionale)`;
    weighing.autocomplete = "off";
    weighingLabel.appendChild(weighing);
    const piecesLabel = document.createElement("label");
    const pieces = document.createElement("input");
    pieces.className = "load-batch-pieces";
    pieces.type = "number";
    pieces.min = "1";
    pieces.step = "1";
    pieces.required = true;
    pieces.placeholder = `Pezzi cassone ${index + 1}`;
    piecesLabel.appendChild(pieces);
    row.append(number, weighingLabel, piecesLabel);
    return row;
}

function updateLoadBatchRows() {
    const rows = document.getElementById("loadBatchRows");
    const countField = document.getElementById("loadBatchCount");
    const controls = document.getElementById("loadBatchControls");
    const section = document.getElementById("loadBatchSection");
    if (!rows || !countField || !controls || !section) return;
    const batchAllowed = operationGroupMode === "load"
        && document.getElementById("loadType")?.value === "crate"
        && editingOperationLineIndex === null;
    controls.hidden = operationGroupMode !== "load";
    countField.disabled = !batchAllowed;
    if (!batchAllowed) countField.value = "1";
    const targetCount = batchAllowed ? loadBatchCount() : 1;
    countField.value = String(targetCount);
    while (rows.children.length < targetCount) rows.appendChild(createLoadBatchRow(rows.children.length));
    while (rows.children.length > targetCount) rows.lastElementChild?.remove();
    rows.querySelectorAll(".load-batch-pieces").forEach((input) => { input.required = operationGroupMode === "load"; });
    section.classList.toggle("is-single", targetCount === 1);
    const addButton = document.getElementById("addOperationLine");
    if (addButton && editingOperationLineIndex === null) {
        addButton.textContent = targetCount > 1
            ? `Aggiungi ${targetCount} cassoni al gruppo di carico`
            : `Aggiungi al gruppo di ${operationModeLabel()}`;
    }
}

function loadBatchValues() {
    return Array.from(document.querySelectorAll("#loadBatchRows .load-batch__row"), (row, index) => ({
        index,
        weighingCode: row.querySelector(".load-batch-weighing")?.value.trim().toUpperCase() || "",
        pieceCount: Number(row.querySelector(".load-batch-pieces")?.value),
    }));
}

function updateOperationButtons() {
    const loadCount = operationGroups.load.length;
    const unloadCount = operationGroups.unload.length;
    const loadButton = document.getElementById("openLoadButton");
    const unloadButton = document.getElementById("openUnloadButton");
    if (loadButton) loadButton.textContent = loadCount ? `Carico · ${loadCount}` : "Carico";
    if (unloadButton) unloadButton.textContent = unloadCount ? `Scarico · ${unloadCount}` : "Scarico";
}

function setOperationStage(stage) {
    operationGroupStages[operationGroupMode] = stage;
    document.getElementById("operationComposeStage").hidden = stage !== "compose";
    document.getElementById("operationReviewStage").hidden = stage !== "review";
    document.getElementById("operationReadyStage").hidden = stage !== "ready";
    document.querySelectorAll("[data-operation-step]").forEach((step) => {
        const names = ["compose", "review", "ready"];
        const currentIndex = names.indexOf(stage);
        const stepIndex = names.indexOf(step.dataset.operationStep);
        step.classList.toggle("is-active", stepIndex === currentIndex);
        step.classList.toggle("is-complete", stepIndex < currentIndex);
    });
}

function resetOperationLineForm() {
    const form = document.getElementById("operationLineForm");
    form?.reset();
    document.getElementById("loadQuantity").value = "1";
    document.getElementById("loadPieceCount").value = "";
    document.getElementById("loadWeighingCode").value = "";
    document.getElementById("loadBatchCount").value = "1";
    editingOperationLineIndex = null;
    document.getElementById("addOperationLine").textContent = `Aggiungi al gruppo di ${operationModeLabel()}`;
    updateLoadBatchRows();
    document.getElementById("loadFormMessage").textContent = "";
    updateLoadTypeNote();
}

function configureOperationDialog() {
    const load = operationGroupMode === "load";
    document.getElementById("operationDialogEyebrow").textContent = load ? "NUOVO GRUPPO DI CARICO" : "NUOVO GRUPPO DI SCARICO";
    document.getElementById("operationDialogTitle").textContent = load ? "Componi il carico" : "Componi lo scarico";
    document.getElementById("operationDialogDescription").textContent = load
        ? "Inserisci un singolo cassone oppure aggiungine più insieme condividendo articolo e, se indicati, cliente e ordine."
        : "Preleva per articolo e pezzi, per riferimento ordine oppure mediante codice pesata esatto.";
    document.getElementById("loadCustomer").required = false;
    document.getElementById("loadArticle").required = load;
    document.getElementById("loadOrderReference").required = false;
    document.getElementById("loadPieceCount").required = load;
    document.getElementById("operationOrderLabelText").textContent = load
        ? "Riferimento ordine"
        : "Riferimento ordine (opzionale · tutti i corrispondenti)";
    document.getElementById("loadOrderReference").placeholder = load
        ? "es. 25/00114 oppure 25/00114/C"
        : "Lascia vuoto per prelevare i più vecchi";
    document.getElementById("operationWeighingLabelText").textContent = load
        ? "Codice pesata (opzionale · univoco)"
        : "Codice pesata (opzionale · cassone esatto)";
    document.getElementById("operationPiecesLabelText").textContent = load
        ? "Numero pezzi nel cassone"
        : "Numero pezzi da prelevare (opzionale)";
    document.getElementById("loadPieceCount").placeholder = load ? "es. 250" : "Vuoto = cassoni interi";
    document.getElementById("reviewOperationGroup").textContent = `Visualizza ${operationModeLabel()}`;
    document.getElementById("confirmOperationGroup").textContent = `Conferma gruppo di ${operationModeLabel()}`;
    updateLoadBatchRows();
    updateLoadTypeNote();
}

function createOperationLineElement(entry, index, review = false) {
    const row = document.createElement("article");
    row.className = "operation-line";
    const main = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.article || (entry.weighingCode ? `Pesata ${entry.weighingCode}` : entry.order ? `Ordine ${entry.order}` : "Prelievo");
    const meta = document.createElement("small");
    const orderDescription = entry.order
        ? entry.order
        : operationGroupMode === "unload" ? "Tutti gli ordini · FIFO più vecchio" : "Ordine non indicato";
    const customerDescription = entry.customer
        || (operationGroupMode === "unload" ? "Qualsiasi cliente" : "Cliente non indicato");
    const details = [customerDescription, orderDescription, entry.type === "pallet" ? "Pallet" : "Cassone"];
    if (entry.weighingCode) details.push(`Pesata ${entry.weighingCode}`);
    if (entry.pieceCount) details.push(`${entry.pieceCount} pezzi`);
    if (entry.availablePieces) details.push(`${entry.availablePieces} pezzi disponibili`);
    if (entry.requestedPieces) details.push(`Richiesti ${entry.requestedPieces} pezzi`);
    if (entry.sourceLocations?.length) details.push(`Da ${entry.sourceLocations.join(" + ")}`);
    meta.textContent = details.join(" · ");
    main.append(title, meta);
    const quantity = document.createElement("b");
    quantity.textContent = operationGroupMode === "load"
        ? `1 ${entry.type === "pallet" ? "pallet" : "cassone"}`
        : entry.requestedPieces
          ? `${entry.requestedPieces} pezzi`
          : entry.weighingCode
            ? "1 cassone"
            : entry.order ? "Tutti ordine" : `${entry.quantity || 1} unità`;
    const actions = document.createElement("div");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Modifica";
    edit.addEventListener("click", () => editOperationLine(index));
    actions.appendChild(edit);
    if (!review) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "is-danger";
        remove.textContent = "Rimuovi";
        remove.addEventListener("click", () => {
            activeOperationGroup().splice(index, 1);
            operationPreviewPlan = null;
            renderOperationGroup();
        });
        actions.appendChild(remove);
    }
    row.append(main, quantity, actions);
    return row;
}

function renderOperationGroup() {
    const entries = activeOperationGroup();
    const units = operationGroupMode === "load"
        ? entries.length
        : entries.reduce((total, entry) => total + (Number(entry.quantity) || 0), 0);
    const draft = document.getElementById("operationDraftList");
    const review = document.getElementById("operationReviewList");
    const ready = document.getElementById("operationReadyList");
    [draft, review, ready].forEach((container) => container?.replaceChildren());
    if (!entries.length) {
        const empty = document.createElement("p");
        empty.className = "operation-lines__empty";
        empty.textContent = `Aggiungi il primo articolo al gruppo di ${operationModeLabel()}.`;
        draft?.appendChild(empty);
    }
    entries.forEach((entry, index) => {
        draft?.appendChild(createOperationLineElement(entry, index));
        review?.appendChild(createOperationLineElement(entry, index, true));
        const readyLine = createOperationLineElement(entry, index, true);
        readyLine.querySelector("div:last-child")?.remove();
        ready?.appendChild(readyLine);
    });
    document.getElementById("operationDraftSummary").textContent = entries.length
        ? `${entries.length} ${entries.length === 1 ? "riga" : "righe"} · ${units} ${units === 1 ? "unità" : "unità"}`
        : "Nessuna riga aggiunta";
    document.getElementById("reviewOperationGroup").disabled = !entries.length;
    document.getElementById("operationReviewLineCount").textContent = String(entries.length);
    document.getElementById("operationReviewUnitCount").textContent = String(units);
    document.getElementById("operationReviewCrateCount").textContent = String(entries.filter((entry) => entry.type === "crate").reduce((total, entry) => total + (Number(entry.quantity) || (operationGroupMode === "load" ? 1 : 0)), 0));
    document.getElementById("operationReviewPalletCount").textContent = String(entries.filter((entry) => entry.type === "pallet").reduce((total, entry) => total + (Number(entry.quantity) || (operationGroupMode === "load" ? 1 : 0)), 0));
    const unrestrictedOrders = entries.filter((entry) => !entry.order).length;
    document.getElementById("operationReviewNote").classList.remove("is-error");
    document.getElementById("operationReviewNote").textContent = operationGroupMode === "load"
        ? "La futura proposta userà tutte le righe insieme per ridurre divisioni e movimentazioni implicite. Nessuna ubicazione è ancora stata modificata."
        : `${unrestrictedOrders ? `${unrestrictedOrders} ${unrestrictedOrders === 1 ? "riga userà" : "righe useranno"} tutti i riferimenti ordine e ` : ""}il prelievo applicherà sempre FIFO, scegliendo prima le unità più vecchie tra quelle ammesse. Nessuna unità è ancora stata prelevata.`;
    updateOperationButtons();
}

function editOperationLine(index) {
    const entry = activeOperationGroup()[index];
    if (!entry) return;
    setOperationStage("compose");
    editingOperationLineIndex = index;
    document.getElementById("loadBatchCount").value = "1";
    updateLoadBatchRows();
    document.getElementById("loadArticle").value = entry.article;
    document.getElementById("loadCustomer").value = entry.customer || "";
    document.getElementById("loadOrderReference").value = entry.order;
    document.getElementById("loadQuantity").value = String(entry.quantity);
    document.getElementById("loadWeighingCode").value = entry.weighingCode || "";
    document.getElementById("loadPieceCount").value = entry.requestedPieces || entry.pieceCount || "";
    document.getElementById("loadType").value = entry.type;
    document.getElementById("addOperationLine").textContent = "Salva modifica";
    document.getElementById("loadFormMessage").textContent = `Modifica della riga ${index + 1}.`;
    updateLoadTypeNote();
    void focusWarehouseElement(document.getElementById("loadArticle"), true);
}

function openOperationDialog(mode, stage) {
    if (!isWarehouseLoggedIn()) {
        openWarehouseLogin();
        showWarehouseToast("Login operatore richiesto per carico e scarico.", true);
        return;
    }
    closeToolsDrawer();
    closeContextMenu();
    hideSlotPreview();
    operationGroupMode = mode;
    configureOperationDialog();
    resetOperationLineForm();
    renderOperationGroup();
    setOperationStage(stage || operationGroupStages[mode] || "compose");
    const dialog = document.getElementById("operationGroupDialog");
    const composeStage = (stage || operationGroupStages[mode]) === "compose";
    openWarehouseDialog(dialog, document.getElementById(composeStage ? "loadArticle" : "closeOperationDialog"), composeStage);
}

function closeOperationDialog() {
    closeWarehouseDialog(document.getElementById("operationGroupDialog"));
}

async function cancelOperationGroup() {
    const entries = activeOperationGroup();
    if (entries.length && !await showWarehouseConfirm({
        title: `Annulla gruppo di ${operationModeLabel()}`,
        message: `Vuoi eliminare completamente tutte le righe del gruppo di ${operationModeLabel()}?`,
        confirmLabel: "Annulla gruppo",
        danger: true,
    })) return;
    entries.splice(0);
    operationGroupStages[operationGroupMode] = "compose";
    operationPreviewPlan = null;
    resetOperationLineForm();
    renderOperationGroup();
    closeOperationDialog();
}

function addSelectedResultsToUnloadGroup() {
    const alreadyAdded = new Set(operationGroups.unload.flatMap((entry) => entry.sourceIds || []));
    const units = new Map();
    selectedReportLocations.forEach((location) => {
        const item = inventory.get(location);
        if (item && !alreadyAdded.has(item.id) && !units.has(item.id)) units.set(item.id, item);
    });
    units.forEach((item) => {
        const sourceLocation = item.type === "pallet"
            ? [item.location, item.pairedLocation].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).join(" + ")
            : item.location;
        operationGroups.unload.push({
            id: nextOperationLineId++,
            article: item.article,
            customer: item.customer,
            order: item.orderReference,
            weighingCode: item.weighingCode || "",
            pieceCount: null,
            availablePieces: warehouseItemPieces(item),
            requestedPieces: null,
            quantity: 1,
            type: item.type,
            sourceIds: [item.id],
            sourceLocations: [sourceLocation],
        });
    });
    operationPreviewPlan = null;
    closeInventorySearchDialog();
    openOperationDialog("unload", "compose");
    document.getElementById("loadFormMessage").textContent = units.size
        ? `${units.size} ${units.size === 1 ? "unità aggiunta" : "unità aggiunte"} dalla ricerca.`
        : "Le unità selezionate erano già presenti nel gruppo di scarico.";
}

function cloneInventoryState(source = inventory) {
    return new Map(Array.from(source, ([location, item]) => [location, { ...item, tags: [...item.tags] }]));
}

class LoadPlanningState {
    constructor(source) {
        if (source instanceof LoadPlanningState) {
            this.base = source.base;
            this.additions = new Map(source.additions);
        } else {
            this.base = source instanceof Map ? source : new Map(source || []);
            this.additions = new Map();
        }
    }

    get size() { return this.base.size + this.additions.size; }

    has(location) { return this.additions.has(location) || this.base.has(location); }

    get(location) { return this.additions.has(location) ? this.additions.get(location) : this.base.get(location); }

    withItems(items) {
        const next = new LoadPlanningState(this);
        items.forEach(([location, item]) => next.additions.set(location, item));
        return next;
    }

    *entries() {
        yield* this.base.entries();
        yield* this.additions.entries();
    }

    *values() {
        yield* this.base.values();
        yield* this.additions.values();
    }

    [Symbol.iterator]() { return this.entries(); }

    forEach(callback) {
        this.base.forEach((item, location) => callback(item, location, this));
        this.additions.forEach((item, location) => callback(item, location, this));
    }

    toMap() { return new Map(this.entries()); }
}

function asLoadPlanningState(source) {
    return source instanceof LoadPlanningState ? source : new LoadPlanningState(source);
}

function createMutableLoadOverlay(source) {
    const additions = new Map();
    return {
        has: (location) => additions.has(location) || source.has(location),
        get: (location) => additions.has(location) ? additions.get(location) : source.get(location),
        set: (location, item) => additions.set(location, item),
    };
}

function stateHasBlockingPallet(state, parsed) {
    if (!parsed || parsed.level === "a") return false;
    const groundCodes = [
        slotCode(parsed.row, parsed.physicalColumn - 1, "front", "a"),
        slotCode(parsed.row, parsed.physicalColumn - 1, "rear", "a"),
    ];
    return groundCodes.some((code) => state.get(code)?.type === "pallet");
}

const CRATE_SORTING_WEIGHTS = Object.freeze({
    forkliftMovement: 220,
    touchedStack: 260,
    newArticleDivision: 300,
    touchedPhysicalModule: 120,
    newPhysicalModule: 450,
    mixedArticleStack: 100,
    mixedArticleUnit: 450,
    frontUnit: 90,
    completeStack: -220,
    residualSingleCompletion: -450,
    twoHighStack: -45,
    sameArticleFrontRearModule: -800,
    fullArticleFrontRearModule: -660,
    continueExistingArticleUnit: -900,
    differentRowDistance: 2000,
    physicalColumnDistance: 35,
    oppositeSideDistance: 15,
    initialRowOrder: 180,
    initialColumnOrder: 8,
});
const CRATE_SORTING_WEIGHT_GROUPS = Object.freeze({
    proximity: new Set([
        "newArticleDivision", "mixedArticleStack", "mixedArticleUnit", "continueExistingArticleUnit",
        "differentRowDistance", "physicalColumnDistance", "oppositeSideDistance",
    ]),
    space: new Set([
        "touchedStack", "newArticleDivision", "touchedPhysicalModule", "newPhysicalModule",
        "completeStack", "residualSingleCompletion", "twoHighStack", "sameArticleFrontRearModule",
        "fullArticleFrontRearModule",
    ]),
    handling: new Set([
        "forkliftMovement", "frontUnit", "completeStack", "sameArticleFrontRearModule",
        "fullArticleFrontRearModule",
    ]),
});

function sortingWeight(name) {
    const base = CRATE_SORTING_WEIGHTS[name];
    if (!activeCrateSortingProfile) return base;
    let multiplier = 1;
    if (activeCrateSortingProfile.preferProximity && CRATE_SORTING_WEIGHT_GROUPS.proximity.has(name)) multiplier *= 1.85;
    if (activeCrateSortingProfile.optimizeSpace && CRATE_SORTING_WEIGHT_GROUPS.space.has(name)) multiplier *= 1.65;
    if (activeCrateSortingProfile.reduceFutureMoves && CRATE_SORTING_WEIGHT_GROUPS.handling.has(name)) multiplier *= 1.45;
    return base * multiplier;
}

function validCrateDestination(state, parsed, customer) {
    if (!parsed || state.has(parsed.code) || stateHasBlockingPallet(state, parsed)) return false;
    if (activeOptimizationScope && !optimizationLocationAllowed(parsed.code, activeOptimizationScope)) return false;
    if (!evaluateCustomerForSlot(parsed.code, customer).allowed) return false;
    const lowerLevels = parsed.level === "c" ? ["a", "b"] : parsed.level === "b" ? ["a"] : [];
    if (!lowerLevels.every((level) => state.has(`${parsed.row}${parsed.number}${level}`))) return false;
    if (parsed.side === "front") {
        const rearNumber = slotCode(parsed.row, parsed.physicalColumn - 1, "rear", "a").match(/\d+/)?.[0];
        if (!["a", "b", "c"].every((level) => state.has(`${parsed.row}${rearNumber}${level}`))) return false;
    }
    return true;
}

function crateStackItems(state, parsed) {
    return ["a", "b", "c"].map((level) => state.get(`${parsed.row}${parsed.number}${level}`));
}

function generateCratePlacementMoves(state, maximumUnits, article, customer) {
    const levels = ["a", "b", "c"];
    const moves = [];
    rowCodes().forEach((row) => {
        for (let number = 1; number <= maximumPositionForRow(row); number += 1) {
            const ground = parseSlotCode(`${row}${number}a`);
            const stack = crateStackItems(state, ground);
            const occupied = stack.filter(Boolean).length;
            const compact = stack.slice(0, occupied).every(Boolean)
                && stack.slice(occupied).every((item) => !item);
            if (!compact || occupied >= 3) continue;
            const largestMove = Math.min(3 - occupied, maximumUnits, 3);
            const validationState = createMutableLoadOverlay(state);
            const codes = [];
            for (let size = 1; size <= largestMove; size += 1) {
                const code = `${row}${number}${levels[occupied + size - 1]}`;
                const parsed = parseSlotCode(code);
                if (!validCrateDestination(validationState, parsed, customer)) break;
                validationState.set(code, { location: code, article, customer, type: "crate", tags: [] });
                codes.push(code);
                moves.push({ codes: [...codes] });
            }
        }
    });
    return moves;
}

function cratePlanSignature(node) {
    return [...node.locations].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).join("|");
}

function crateMovementOrderKey(node) {
    return (node.moveSizes || []).map((size) => 4 - size).join("");
}

function createCrateScoreContext(initialArticleLocations) {
    const locations = initialArticleLocations || [];
    const distanceByStack = new Map();
    rowCodes().forEach((row) => {
        for (let number = 1; number <= maximumPositionForRow(row); number += 1) {
            const parsed = parseSlotCode(`${row}${number}a`);
            const otherStacks = locations.filter((existing) => (
                existing.row !== parsed.row || existing.number !== parsed.number
            ));
            const proximityReferences = otherStacks.length ? otherStacks : locations;
            const distance = proximityReferences.length
                ? Math.min(...proximityReferences.map((existing) => (
                    Math.abs(rowCodes().indexOf(parsed.row) - rowCodes().indexOf(existing.row)) * sortingWeight("differentRowDistance")
                    + Math.abs(parsed.physicalColumn - existing.physicalColumn) * sortingWeight("physicalColumnDistance")
                    + (parsed.side === existing.side ? 0 : sortingWeight("oppositeSideDistance"))
                )))
                : rowCodes().indexOf(parsed.row) * sortingWeight("initialRowOrder")
                    + parsed.physicalColumn * sortingWeight("initialColumnOrder");
            distanceByStack.set(`${parsed.row}:${parsed.number}`, distance);
        }
    });
    return {
        hasExistingArticle: locations.length > 0,
        distance: (parsed) => distanceByStack.get(`${parsed.row}:${parsed.number}`) || 0,
    };
}

function crateLocationAccessibilityBurden(state, code) {
    const parsed = parseSlotCode(code);
    if (!parsed) return Number.POSITIVE_INFINITY;
    const levels = ["a", "b", "c"];
    const levelIndex = levels.indexOf(parsed.level);
    const above = levels.slice(levelIndex + 1)
        .filter((level) => state.has(`${parsed.row}${parsed.number}${level}`)).length;
    let frontObstruction = 0;
    if (parsed.side === "rear") {
        const frontNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "front", "a")).number;
        frontObstruction = levels.some((level) => state.has(`${parsed.row}${frontNumber}${level}`)) ? 1 : 0;
    }
    return above * 1.4 + frontObstruction;
}

function compareCrateLocationsByAccessibility(state, left, right) {
    const burdenDifference = crateLocationAccessibilityBurden(state, left)
        - crateLocationAccessibilityBurden(state, right);
    if (burdenDifference) return burdenDifference;
    const leftParsed = parseSlotCode(left);
    const rightParsed = parseSlotCode(right);
    const sideDifference = (leftParsed.side === "front" ? 0 : 1) - (rightParsed.side === "front" ? 0 : 1);
    if (sideDifference) return sideDifference;
    const levelPriority = { c: 0, b: 1, a: 2 };
    const levelDifference = levelPriority[leftParsed.level] - levelPriority[rightParsed.level];
    if (levelDifference) return levelDifference;
    return left.localeCompare(right, undefined, { numeric: true });
}

function cratePieceAccessibilityScore(state, locations, pieceCount) {
    const pieces = Number(pieceCount);
    if (!Number.isFinite(pieces) || pieces <= 0) return 0;
    const urgency = 5200 / Math.sqrt(pieces);
    return locations.reduce((score, code) => (
        score + crateLocationAccessibilityBurden(state, code) * urgency
    ), 0);
}

function scoreCratePlan(initialState, state, locations, article, movements, scoreContext, pieceCount = 0) {
    const levels = ["a", "b", "c"];
    const touchedStacks = new Map();
    const addedByStack = new Map();
    locations.forEach((code) => {
        const parsed = parseSlotCode(code);
        const key = `${parsed.row}:${parsed.number}`;
        touchedStacks.set(key, parsed);
        addedByStack.set(key, (addedByStack.get(key) || 0) + 1);
    });
    const touchedModules = new Map();
    let mixedStacks = 0;
    let mixedUnits = 0;
    let newArticleDivisions = 0;
    let newPhysicalModules = 0;
    let frontUnits = 0;
    let completedStacks = 0;
    let residualSingleCompletions = 0;
    let twoHighStacks = 0;
    let distanceScore = 0;
    let initialPositionScore = 0;
    touchedStacks.forEach((parsed) => {
        const initialItems = crateStackItems(initialState, parsed).filter(Boolean);
        const finalItems = crateStackItems(state, parsed).filter(Boolean);
        if (finalItems.some((item) => item.article !== article)) {
            mixedStacks += 1;
            mixedUnits += addedByStack.get(`${parsed.row}:${parsed.number}`) || 0;
        }
        if (!initialItems.some((item) => item.article === article)) newArticleDivisions += 1;
        if (finalItems.length === 3) {
            completedStacks += 1;
            const addedHere = addedByStack.get(`${parsed.row}:${parsed.number}`) || 0;
            if (locations.length % 3 === 1 && initialItems.length === 2 && addedHere === 1) residualSingleCompletions += 1;
        }
        else if (finalItems.length === 2) twoHighStacks += 1;
        touchedModules.set(`${parsed.row}:${parsed.physicalColumn}`, parsed);
        if (scoreContext.hasExistingArticle) distanceScore += scoreContext.distance(parsed);
        else initialPositionScore += scoreContext.distance(parsed);
    });
    locations.forEach((code) => {
        if (parseSlotCode(code).side === "front") frontUnits += 1;
    });
    let pairedArticleModules = 0;
    let fullPairedArticleModules = 0;
    let continuedArticleUnits = 0;
    touchedModules.forEach((parsed) => {
        const rearNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "rear", "a")).number;
        const frontNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "front", "a")).number;
        const moduleWasEmpty = [rearNumber, frontNumber].every((number) => (
            levels.every((level) => !initialState.has(`${parsed.row}${number}${level}`))
        ));
        if (moduleWasEmpty) newPhysicalModules += 1;
        const initialRearHasArticle = levels.some((level) => initialState.get(`${parsed.row}${rearNumber}${level}`)?.article === article);
        const initialFrontHasArticle = levels.some((level) => initialState.get(`${parsed.row}${frontNumber}${level}`)?.article === article);
        const rearHasArticle = levels.some((level) => state.get(`${parsed.row}${rearNumber}${level}`)?.article === article);
        const frontHasArticle = levels.some((level) => state.get(`${parsed.row}${frontNumber}${level}`)?.article === article);
        const moduleHasOtherArticle = [rearNumber, frontNumber].some((number) => levels.some((level) => {
            const item = state.get(`${parsed.row}${number}${level}`);
            return item && item.article !== article;
        }));
        if (rearHasArticle && frontHasArticle && !moduleHasOtherArticle) {
            pairedArticleModules += 1;
            const rearIsFullArticle = levels.every((level) => state.get(`${parsed.row}${rearNumber}${level}`)?.article === article);
            const frontIsFullArticle = levels.every((level) => state.get(`${parsed.row}${frontNumber}${level}`)?.article === article);
            if (rearIsFullArticle && frontIsFullArticle) fullPairedArticleModules += 1;
            if (initialRearHasArticle || initialFrontHasArticle) {
                const rearKey = `${parsed.row}:${rearNumber}`;
                const frontKey = `${parsed.row}:${frontNumber}`;
                continuedArticleUnits += (addedByStack.get(rearKey) || 0) + (addedByStack.get(frontKey) || 0);
            }
        }
    });
    return movements * sortingWeight("forkliftMovement")
        + touchedStacks.size * sortingWeight("touchedStack")
        + newArticleDivisions * sortingWeight("newArticleDivision")
        + touchedModules.size * sortingWeight("touchedPhysicalModule")
        + newPhysicalModules * sortingWeight("newPhysicalModule")
        + mixedStacks * sortingWeight("mixedArticleStack")
        + mixedUnits * sortingWeight("mixedArticleUnit")
        + frontUnits * sortingWeight("frontUnit")
        + completedStacks * sortingWeight("completeStack")
        + residualSingleCompletions * sortingWeight("residualSingleCompletion")
        + twoHighStacks * sortingWeight("twoHighStack")
        + pairedArticleModules * sortingWeight("sameArticleFrontRearModule")
        + fullPairedArticleModules * sortingWeight("fullArticleFrontRearModule")
        + continuedArticleUnits * sortingWeight("continueExistingArticleUnit")
        + distanceScore
        + initialPositionScore
        + cratePieceAccessibilityScore(state, locations, pieceCount);
}

function scoreCrateMoveCandidate(state, move, article, scoreContext, requestedQuantity, pieceCount = 0) {
    const parsed = parseSlotCode(move.codes[0]);
    const stack = crateStackItems(state, parsed).filter(Boolean);
    const finalHeight = stack.length + move.codes.length;
    const rearNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "rear", "a")).number;
    const frontNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "front", "a")).number;
    const moduleNumbers = [rearNumber, frontNumber];
    const moduleWasEmpty = moduleNumbers.every((number) => (
        ["a", "b", "c"].every((level) => !state.has(`${parsed.row}${number}${level}`))
    ));
    const sideHasArticle = (number) => ["a", "b", "c"].some((level) => (
        state.get(`${parsed.row}${number}${level}`)?.article === article
            || move.codes.includes(`${parsed.row}${number}${level}`)
    ));
    const sideIsFullArticle = (number) => ["a", "b", "c"].every((level) => (
        state.get(`${parsed.row}${number}${level}`)?.article === article
            || move.codes.includes(`${parsed.row}${number}${level}`)
    ));
    const moduleHasOtherArticle = moduleNumbers.some((number) => ["a", "b", "c"].some((level) => {
        const item = state.get(`${parsed.row}${number}${level}`);
        return item && item.article !== article;
    }));
    const distance = scoreContext.distance(parsed);
    return sortingWeight("forkliftMovement")
        + sortingWeight("touchedStack")
        + sortingWeight("touchedPhysicalModule")
        + (stack.some((item) => item.article !== article)
            ? sortingWeight("mixedArticleStack") + move.codes.length * sortingWeight("mixedArticleUnit")
            : 0)
        + (!stack.some((item) => item.article === article) ? sortingWeight("newArticleDivision") : 0)
        + (moduleWasEmpty ? sortingWeight("newPhysicalModule") : 0)
        + move.codes.filter((code) => parseSlotCode(code).side === "front").length * sortingWeight("frontUnit")
        + (finalHeight === 3 ? sortingWeight("completeStack") : finalHeight === 2 ? sortingWeight("twoHighStack") : 0)
        + (requestedQuantity % 3 === 1 && stack.length === 2 && move.codes.length === 1
            ? sortingWeight("residualSingleCompletion")
            : 0)
        + (sideHasArticle(rearNumber) && sideHasArticle(frontNumber) && !moduleHasOtherArticle
            ? sortingWeight("sameArticleFrontRearModule")
            : 0)
        + (sideIsFullArticle(rearNumber) && sideIsFullArticle(frontNumber) && !moduleHasOtherArticle
            ? sortingWeight("fullArticleFrontRearModule")
            : 0)
        + distance
        + cratePieceAccessibilityScore(state, move.codes, pieceCount);
}

function trimCratePlanBeam(nodes, width) {
    const unique = new Map();
    nodes.forEach((node) => {
        const signature = cratePlanSignature(node);
        const current = unique.get(signature);
        if (!current || node.score < current.score
            || (node.score === current.score && crateMovementOrderKey(node) < crateMovementOrderKey(current))
            || (node.score === current.score && crateMovementOrderKey(node) === crateMovementOrderKey(current)
                && node.locations.join("|") < current.locations.join("|"))) {
            unique.set(signature, node);
        }
    });
    return Array.from(unique.values())
        .sort((left, right) => left.score - right.score
            || crateMovementOrderKey(left).localeCompare(crateMovementOrderKey(right))
            || left.locations.join("|").localeCompare(right.locations.join("|"), undefined, { numeric: true }))
        .slice(0, width);
}

function planWeightedCrateAllocations(initialState, entry, resultLimit = 1, searchProfile = "standard") {
    const quantity = entry.quantity;
    const jointSearch = searchProfile === "joint";
    const beamWidth = jointSearch
        ? quantity <= 6 ? 6 : quantity <= 20 ? 3 : quantity <= 60 ? 3 : 2
        : quantity <= 6 ? 32 : quantity <= 20 ? 14 : quantity <= 60 ? 8 : 4;
    const actionWidth = jointSearch ? 3 : quantity <= 20 ? 12 : 8;
    const initialArticleLocations = Array.from(initialState.values())
        .filter((item) => item.article === entry.article)
        .map((item) => parseSlotCode(item.location))
        .filter(Boolean);
    const scoreContext = createCrateScoreContext(initialArticleLocations);
    const layers = Array.from({ length: quantity + 1 }, () => []);
    layers[0].push({ state: asLoadPlanningState(initialState), locations: [], movements: 0, moveSizes: [], score: 0 });
    for (let placed = 0; placed < quantity; placed += 1) {
        const layer = trimCratePlanBeam(layers[placed], beamWidth);
        for (const node of layer) {
            const moves = generateCratePlacementMoves(node.state, quantity - placed, entry.article, entry.customer);
            const shortlistedMoves = [1, 2, 3].flatMap((size) => moves
                .filter((move) => move.codes.length === size)
                .map((move) => ({
                    ...move,
                    quickScore: scoreCrateMoveCandidate(node.state, move, entry.article, scoreContext, quantity, entry.pieceCount),
                }))
                .sort((left, right) => left.quickScore - right.quickScore
                    || left.codes[0].localeCompare(right.codes[0], undefined, { numeric: true }))
                .slice(0, actionWidth));
            for (const move of shortlistedMoves) {
                const moveState = node.state.withItems(move.codes.map((code) => [code, {
                    location: code,
                    article: entry.article,
                    customer: entry.customer,
                    type: "crate",
                    tags: [],
                }]));
                const locations = [...node.locations, ...move.codes];
                const movements = node.movements + 1;
                const target = placed + move.codes.length;
                layers[target].push({
                    state: moveState,
                    locations,
                    movements,
                    moveSizes: [...node.moveSizes, move.codes.length],
                    score: scoreCratePlan(initialState, moveState, locations, entry.article, movements, scoreContext, entry.pieceCount),
                });
                if (layers[target].length > beamWidth * 12) {
                    layers[target] = trimCratePlanBeam(layers[target], beamWidth * 4);
                }
            }
        }
    }
    return trimCratePlanBeam(layers[quantity], Math.max(1, resultLimit));
}

function planWeightedCrateAllocation(initialState, entry) {
    const plan = planWeightedCrateAllocations(initialState, entry, 1)[0] || null;
    if (!plan) return null;
    return { ...plan, state: plan.state.toMap() };
}

function palletDestinationCandidates(state, article, customer, limit = 1) {
    const articleLocations = Array.from(state.values())
        .filter((item) => item.article === article)
        .map((item) => parseSlotCode(item.location))
        .filter(Boolean);
    const candidates = [];
    for (const row of rowCodes()) {
        for (let column = 0; column < physicalColumnsForRow(row); column += 1) {
            const front = slotCode(row, column, "front", "a");
            const rear = slotCode(row, column, "rear", "a");
            if (activeOptimizationScope
                && ![front, rear].every((code) => optimizationLocationAllowed(code, activeOptimizationScope))) continue;
            const columnCodes = [front, rear].flatMap((ground) => {
                const number = parseSlotCode(ground).number;
                return ["a", "b", "c"].map((level) => `${row}${number}${level}`);
            });
            if (columnCodes.some((code) => state.has(code))) continue;
            if (![front, rear].every((code) => evaluateCustomerForSlot(code, customer).allowed)) continue;
            const parsed = parseSlotCode(rear);
            const distance = articleLocations.length
                ? Math.min(...articleLocations.map((existing) => (
                    Math.abs(rowCodes().indexOf(row) - rowCodes().indexOf(existing.row)) * sortingWeight("differentRowDistance")
                    + Math.abs(parsed.physicalColumn - existing.physicalColumn) * sortingWeight("physicalColumnDistance")
                )))
                : rowCodes().indexOf(row) * sortingWeight("initialRowOrder")
                    + parsed.physicalColumn * sortingWeight("initialColumnOrder");
            candidates.push({ pair: [rear, front], score: distance });
        }
    }
    candidates.sort((left, right) => left.score - right.score
        || left.pair[0].localeCompare(right.pair[0], undefined, { numeric: true }));
    return candidates.slice(0, Math.max(1, limit));
}

function bestPalletDestination(state, article, customer) {
    return palletDestinationCandidates(state, article, customer, 1)[0]?.pair || null;
}

function summarizeMovementLines(actions) {
    return actions.map((action) => ({ ...action, kind: action.kind || "loaded" }));
}

const JOINT_LOAD_LIMITS = Object.freeze({
    smallBlockEntries: 6,
    mediumBlockEntries: 14,
    smallBeam: 8,
    mediumBeam: 3,
    largeBeam: 2,
    smallEntryBranches: 6,
    mediumEntryBranches: 2,
    largeEntryBranches: 2,
    allocationVariants: 2,
    palletVariants: 4,
});

function planPalletEntryAllocations(initialState, entry, resultLimit = 1) {
    let nodes = [{ state: asLoadPlanningState(initialState), pairs: [], score: 0 }];
    const beamWidth = Math.max(8, resultLimit * 4);
    for (let unit = 0; unit < entry.quantity; unit += 1) {
        const expanded = [];
        nodes.forEach((node) => {
            palletDestinationCandidates(node.state, entry.article, entry.customer, JOINT_LOAD_LIMITS.palletVariants)
                .forEach((candidate) => {
                    const pair = candidate.pair;
                    const state = node.state.withItems(pair.map((location, index) => [location, {
                        location,
                        article: entry.article,
                        customer: entry.customer,
                        type: "pallet",
                        pairedLocation: pair[index === 0 ? 1 : 0],
                        tags: [],
                    }]));
                    expanded.push({ state, pairs: [...node.pairs, pair], score: node.score + candidate.score });
                });
        });
        const unique = new Map();
        expanded.forEach((node) => {
            const signature = node.pairs.flat().slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join("|");
            const current = unique.get(signature);
            if (!current || node.score < current.score) unique.set(signature, node);
        });
        nodes = Array.from(unique.values())
            .sort((left, right) => left.score - right.score
                || left.pairs.flat().join("|").localeCompare(right.pairs.flat().join("|"), undefined, { numeric: true }))
            .slice(0, beamWidth);
        if (!nodes.length) break;
    }
    return nodes.slice(0, Math.max(1, resultLimit));
}

function jointLoadNodeSignature(node) {
    return node.allocations.map((allocation) => {
        if (!allocation) return "";
        const locations = allocation.type === "pallet" ? allocation.pairs.flat() : allocation.locations;
        return `${allocation.entryKey}:${locations.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(",")}`;
    }).filter(Boolean).sort((a, b) => a.localeCompare(b, "it", { numeric: true })).join("|");
}

function scoreJointLoadNode(initialState, node, entries, initialArticleScoreContexts) {
    const cratePlans = new Map();
    let score = 0;
    node.allocations.forEach((allocation, index) => {
        if (!allocation) return;
        const entry = entries[index];
        if (allocation.type === "pallet") {
            score += allocation.score;
            return;
        }
        if (!cratePlans.has(entry.article)) cratePlans.set(entry.article, { locations: [], movements: 0 });
        const articlePlan = cratePlans.get(entry.article);
        articlePlan.locations.push(...allocation.locations);
        articlePlan.movements += allocation.movements;
        score += cratePieceAccessibilityScore(node.state, allocation.locations, entry.pieceCount);
    });
    cratePlans.forEach((plan, article) => {
        score += scoreCratePlan(
            initialState,
            node.state,
            plan.locations,
            article,
            plan.movements,
            initialArticleScoreContexts.get(article) || createCrateScoreContext([]),
        );
    });
    return score;
}

function trimJointLoadBeam(nodes, width) {
    const unique = new Map();
    nodes.forEach((node) => {
        const signature = jointLoadNodeSignature(node);
        const current = unique.get(signature);
        if (!current || node.score < current.score) unique.set(signature, node);
    });
    return Array.from(unique.values())
        .sort((left, right) => left.score - right.score
            || jointLoadNodeSignature(left).localeCompare(jointLoadNodeSignature(right), undefined, { numeric: true }))
        .slice(0, width);
}

function canonicalLoadEntryKey(entry) {
    return [entry.type, entry.article, entry.customer, entry.order, entry.weighingCode || "", entry.pieceCount || "", entry.quantity].join("|");
}

function jointEntryPriority(entry, initialArticleCounts, entryScarcity) {
    const scarcityPriority = (entryScarcity.get(canonicalLoadEntryKey(entry)) || 0) * 100000;
    const palletPriority = entry.type === "pallet" ? -10000 : 0;
    const continuityPriority = -(initialArticleCounts.get(entry.article) || 0) * 1000;
    const quantityPriority = -Number(entry.quantity || 0) * 10;
    return scarcityPriority + palletPriority + continuityPriority + quantityPriority;
}

function planJointLoadAllocation(entries, initialState) {
    const planningState = asLoadPlanningState(initialState);
    if (!entries.length) return { state: planningState, allocations: [], score: 0 };
    if (entries.length === 1) {
        const entry = entries[0];
        const candidate = entry.type === "pallet"
            ? planPalletEntryAllocations(planningState, entry, 1)[0]
            : planWeightedCrateAllocations(planningState, entry, 1, "standard")[0];
        if (!candidate) return null;
        const allocation = entry.type === "pallet"
            ? { type: "pallet", entryKey: canonicalLoadEntryKey(entry), pairs: candidate.pairs.map((pair) => [...pair]), score: candidate.score }
            : {
                type: "crate",
                entryKey: canonicalLoadEntryKey(entry),
                locations: [...candidate.locations],
                movements: candidate.movements,
                moveSizes: [...candidate.moveSizes],
                score: candidate.score,
            };
        return { state: candidate.state, allocations: [allocation], score: candidate.score };
    }
    const initialArticleLocations = new Map();
    const initialArticleCounts = new Map();
    Array.from(planningState.values()).forEach((item) => {
        const parsed = parseSlotCode(item.location);
        if (!parsed) return;
        if (!initialArticleLocations.has(item.article)) initialArticleLocations.set(item.article, []);
        initialArticleLocations.get(item.article).push(parsed);
        initialArticleCounts.set(item.article, (initialArticleCounts.get(item.article) || 0) + 1);
    });
    const initialArticleScoreContexts = new Map(entries
        .filter((entry) => entry.type !== "pallet")
        .map((entry) => [entry.article, createCrateScoreContext(initialArticleLocations.get(entry.article) || [])]));
    const entryScarcity = new Map(entries.map((entry) => [
        canonicalLoadEntryKey(entry),
        entry.type === "pallet"
            ? palletDestinationCandidates(planningState, entry.article, entry.customer, totalSlots()).length
            : generateCratePlacementMoves(planningState, Math.min(3, entry.quantity), entry.article, entry.customer).length,
    ]));
    const optimizationSearch = Boolean(activeCrateSortingProfile);
    const beamWidth = optimizationSearch
        ? entries.length <= 6 ? 18 : entries.length <= 14 ? 9 : 5
        : entries.length <= JOINT_LOAD_LIMITS.smallBlockEntries
          ? JOINT_LOAD_LIMITS.smallBeam
          : entries.length <= JOINT_LOAD_LIMITS.mediumBlockEntries
            ? JOINT_LOAD_LIMITS.mediumBeam
            : JOINT_LOAD_LIMITS.largeBeam;
    const entryBranches = optimizationSearch
        ? entries.length <= 6 ? entries.length : entries.length <= 14 ? 5 : 3
        : entries.length <= JOINT_LOAD_LIMITS.smallBlockEntries
          ? JOINT_LOAD_LIMITS.smallEntryBranches
          : entries.length <= JOINT_LOAD_LIMITS.mediumBlockEntries
            ? JOINT_LOAD_LIMITS.mediumEntryBranches
            : JOINT_LOAD_LIMITS.largeEntryBranches;
    const allocationVariants = optimizationSearch
        ? entries.length <= 14 ? 3 : 2
        : entries.length <= JOINT_LOAD_LIMITS.smallBlockEntries
          ? JOINT_LOAD_LIMITS.allocationVariants
          : 1;
    let nodes = [{
        state: planningState,
        allocations: Array(entries.length).fill(null),
        remaining: entries.map((_entry, index) => index),
        score: 0,
    }];
    for (let depth = 0; depth < entries.length; depth += 1) {
        const expanded = [];
        trimJointLoadBeam(nodes, beamWidth).forEach((node) => {
            const candidateEntries = node.remaining.slice()
                .sort((left, right) => jointEntryPriority(entries[left], initialArticleCounts, entryScarcity)
                    - jointEntryPriority(entries[right], initialArticleCounts, entryScarcity)
                    || canonicalLoadEntryKey(entries[left]).localeCompare(canonicalLoadEntryKey(entries[right]), "it", { numeric: true }))
                .slice(0, Math.min(entryBranches, node.remaining.length));
            candidateEntries.forEach((entryIndex) => {
                const entry = entries[entryIndex];
                const candidates = entry.type === "pallet"
                    ? planPalletEntryAllocations(node.state, entry, allocationVariants)
                    : planWeightedCrateAllocations(node.state, entry, allocationVariants, "joint");
                candidates.forEach((candidate) => {
                    const allocation = entry.type === "pallet"
                        ? { type: "pallet", entryKey: canonicalLoadEntryKey(entry), pairs: candidate.pairs.map((pair) => [...pair]), score: candidate.score }
                        : {
                            type: "crate",
                            entryKey: canonicalLoadEntryKey(entry),
                            locations: [...candidate.locations],
                            movements: candidate.movements,
                            moveSizes: [...candidate.moveSizes],
                            score: candidate.score,
                        };
                    const allocations = [...node.allocations];
                    allocations[entryIndex] = allocation;
                    const child = {
                        state: candidate.state,
                        allocations,
                        remaining: node.remaining.filter((index) => index !== entryIndex),
                        score: 0,
                    };
                    child.score = scoreJointLoadNode(initialState, child, entries, initialArticleScoreContexts);
                    expanded.push(child);
                });
            });
        });
        nodes = trimJointLoadBeam(expanded, beamWidth);
        if (!nodes.length) return null;
    }
    return trimJointLoadBeam(nodes, 1)[0] || null;
}

function createLoadPlanningGroups(entries) {
    const groups = [];
    const crateGroupsByKey = new Map();
    entries.forEach((entry, entryIndex) => {
        const canShareCratePlan = entry.type === "crate" && Number(entry.quantity) === 1;
        const key = canShareCratePlan
            ? [entry.type, entry.article, normalizeCustomer(entry.customer), entry.order || ""].join("|")
            : null;
        let group = key ? crateGroupsByKey.get(key) : null;
        if (!group) {
            group = { entry: { ...entry }, memberIndices: [] };
            groups.push(group);
            if (key) crateGroupsByKey.set(key, group);
        }
        group.memberIndices.push(entryIndex);
    });
    groups.forEach((group) => {
        if (group.memberIndices.length < 2) return;
        group.entry.quantity = group.memberIndices.length;
        // La quantità dei pezzi non deve modificare la geometria del lotto (per esempio
        // trasformare una pila da tre in tre cassoni isolati). Viene applicata dopo la
        // pianificazione per mettere i cassoni meno pieni nelle posizioni più accessibili.
        group.entry.pieceCount = 0;
        group.entry.weighingCode = "";
    });
    return groups;
}

function expandLoadPlanningAllocations(entries, groups, jointPlan) {
    const allocations = Array(entries.length).fill(null);
    groups.forEach((group, groupIndex) => {
        const allocation = jointPlan.allocations[groupIndex];
        if (group.memberIndices.length === 1) {
            allocations[group.memberIndices[0]] = allocation;
            return;
        }
        const entriesByPieces = [...group.memberIndices].sort((left, right) => (
            Number(entries[left].pieceCount) - Number(entries[right].pieceCount)
            || left - right
        ));
        const locationsByAccessibility = [...allocation.locations]
            .sort((left, right) => compareCrateLocationsByAccessibility(jointPlan.state, left, right));
        entriesByPieces.forEach((entryIndex, rank) => {
            allocations[entryIndex] = {
                ...allocation,
                entryKey: canonicalLoadEntryKey(entries[entryIndex]),
                locations: [locationsByAccessibility[rank]],
                movements: 1,
                moveSizes: [1],
            };
        });
    });
    return allocations;
}

function planLoadOperation(entries, initialState = inventory) {
    const planningGroups = createLoadPlanningGroups(entries);
    const planningEntries = planningGroups.map((group) => group.entry);
    const jointPlan = planJointLoadAllocation(planningEntries, initialState);
    if (!jointPlan) return { error: "Spazio valido insufficiente: impossibile trovare una combinazione congiunta per l'intero gruppo di carico." };
    const assignedAllocations = expandLoadPlanningAllocations(entries, planningGroups, jointPlan);
    const state = cloneInventoryState(initialState);
    const actions = [];
    const timestamp = new Date();
    let sequence = 0;
    entries.forEach((entry, entryIndex) => {
        const allocation = assignedAllocations[entryIndex];
        const locations = [];
        const insertCrate = (location) => {
            const id = `AUTO-${timestamp.getTime()}-${sequence++}`;
            const receivedAt = new Date(timestamp.getTime() + sequence).toISOString();
            state.set(location, {
                id,
                location,
                article: entry.article,
                customer: entry.customer,
                orderReference: entry.order,
                weighingCode: entry.weighingCode || "",
                pieceCount: entry.pieceCount,
                maxPieceCapacity: entry.pieceCount,
                tags: [],
                inMovement: false,
                type: "crate",
                pairedLocation: null,
                receivedAt,
            });
            locations.push(location);
        };
        if (entry.type === "pallet") {
            allocation.pairs.forEach((pair) => {
                const id = `AUTO-${timestamp.getTime()}-${sequence++}`;
                const receivedAt = new Date(timestamp.getTime() + sequence).toISOString();
                pair.forEach((location, index) => state.set(location, {
                    id,
                    location,
                    article: entry.article,
                    customer: entry.customer,
                    orderReference: entry.order,
                    weighingCode: entry.weighingCode || "",
                    pieceCount: entry.pieceCount,
                    maxPieceCapacity: entry.pieceCount,
                    tags: [],
                    inMovement: false,
                    type: "pallet",
                    pairedLocation: pair[index === 0 ? 1 : 0],
                    receivedAt,
                }));
                locations.push(pair.join(" + "));
            });
        } else {
            allocation.locations.forEach(insertCrate);
        }
        actions.push({
            article: entry.article,
            locations,
            weighingCode: entry.weighingCode || "",
            pieceCount: Math.max(1, Number(entry.pieceCount) || 1),
            maxPieceCapacity: Math.max(1, Number(entry.pieceCount) || 1),
        });
    });
    return { state, lines: summarizeMovementLines(actions), score: jointPlan.score };
}

function logicalInventoryUnits(state) {
    const units = new Map();
    state.forEach((item) => {
        if (!units.has(item.id)) units.set(item.id, { item, locations: [] });
        units.get(item.id).locations.push(item.location);
    });
    return Array.from(units.values());
}

function optimizationLocationAllowed(location, scope) {
    const parsed = parseSlotCode(location);
    if (!parsed || !scope.rows.includes(parsed.row)) return false;
    if (parsed.physicalColumn < scope.columnFrom || parsed.physicalColumn > scope.columnTo) return false;
    if (parsed.side === "rear" && !scope.includeRear) return false;
    if (parsed.side === "front" && !scope.includeFront) return false;
    return true;
}

function optimizationValueAllowed(value, filter) {
    const normalized = normalizeCustomer(value);
    if (filter.include.length && !filter.include.includes(normalized)) return false;
    return !filter.exclude.includes(normalized);
}

function unitIncludedInOptimization(unit, options) {
    const locationsAllowed = unit.item.type === "pallet"
        ? unit.locations.every((location) => optimizationLocationAllowed(location, options))
        : unit.locations.some((location) => optimizationLocationAllowed(location, options));
    return locationsAllowed
        && (unit.item.type === "pallet" ? options.includePallets : options.includeCrates)
        && optimizationValueAllowed(unit.item.article, options.articles)
        && optimizationValueAllowed(unit.item.customer, options.customers);
}

function removeUnitsBlockedByScope(units) {
    const blockedIds = new Set();
    let changed = true;
    while (changed) {
        changed = false;
        const selectedIds = new Set(units.map((unit) => unit.item.id).filter((id) => !blockedIds.has(id)));
        units.forEach((unit) => {
            if (blockedIds.has(unit.item.id) || unit.item.type !== "crate") return;
            const parsed = parseSlotCode(unit.locations[0]);
            const levelIndex = ["a", "b", "c"].indexOf(parsed?.level);
            if (!parsed || levelIndex < 0) return;
            const blocked = ["a", "b", "c"].slice(levelIndex + 1).some((level) => {
                const blocker = inventory.get(`${parsed.row}${parsed.number}${level}`);
                return blocker && !selectedIds.has(blocker.id);
            });
            const frontDependsOnRear = parsed.side === "rear" && (() => {
                const frontGround = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "front", "a"));
                return ["a", "b", "c"].some((level) => {
                    const frontItem = inventory.get(`${parsed.row}${frontGround.number}${level}`);
                    return frontItem && !selectedIds.has(frontItem.id);
                });
            })();
            if (blocked || frontDependsOnRear) {
                blockedIds.add(unit.item.id);
                changed = true;
            }
        });
    }
    return { units: units.filter((unit) => !blockedIds.has(unit.item.id)), blockedCount: blockedIds.size };
}

function warehouseOptimizationOptions() {
    const columnFrom = Math.max(1, Number(document.getElementById("optimizerColumnFrom")?.value) || 1);
    const columnTo = Math.max(columnFrom, Number(document.getElementById("optimizerColumnTo")?.value) || columnFrom);
    return {
        maxMovements: Math.max(2, Math.min(10000, Number(document.getElementById("optimizerMaxMovements")?.value) || 500)),
        preferProximity: Boolean(document.getElementById("optimizerPreferProximity")?.checked),
        optimizeSpace: Boolean(document.getElementById("optimizerOptimizeSpace")?.checked),
        reduceFutureMoves: Boolean(document.getElementById("optimizerReduceFutureMoves")?.checked),
        rows: Array.from(document.querySelectorAll("#optimizerRows input:checked"), (input) => input.value),
        includeRear: Boolean(document.getElementById("optimizerIncludeRear")?.checked),
        includeFront: Boolean(document.getElementById("optimizerIncludeFront")?.checked),
        includeCrates: Boolean(document.getElementById("optimizerIncludeCrates")?.checked),
        includePallets: Boolean(document.getElementById("optimizerIncludePallets")?.checked),
        columnFrom,
        columnTo,
        articles: {
            include: Array.from(optimizerFilters.articles.include),
            exclude: Array.from(optimizerFilters.articles.exclude),
        },
        customers: {
            include: Array.from(optimizerFilters.customers.include),
            exclude: Array.from(optimizerFilters.customers.exclude),
        },
    };
}

function optimizationGroupKey(item) {
    return JSON.stringify([
        item.type || "crate",
        item.article || "",
        item.customer || "",
        item.orderReference || "",
        Math.max(1, Number(item.pieceCount) || 1),
    ]);
}

function optimizationEntriesAndUnits(units) {
    const groups = new Map();
    units.forEach((unit) => {
        const key = optimizationGroupKey(unit.item);
        if (!groups.has(key)) groups.set(key, { units: [], item: unit.item });
        groups.get(key).units.push(unit);
    });
    const values = Array.from(groups.values()).sort((left, right) => (
        String(left.item.article).localeCompare(String(right.item.article), "it", { numeric: true })
        || String(left.item.customer).localeCompare(String(right.item.customer), "it")
        || String(left.item.orderReference).localeCompare(String(right.item.orderReference), "it", { numeric: true })
        || String(left.item.type).localeCompare(String(right.item.type), "it")
    ));
    values.forEach((group) => group.units.sort((left, right) => (
        compareLocations({ location: left.locations[0] }, { location: right.locations[0] })
        || String(left.item.id).localeCompare(String(right.item.id), "it", { numeric: true })
    )));
    return {
        groups: values,
        entries: values.map((group) => ({
            article: group.item.article,
            customer: group.item.customer,
            order: group.item.orderReference,
            pieceCount: Math.max(1, Number(group.item.pieceCount) || 1),
            type: group.item.type,
            quantity: group.units.length,
        })),
    };
}

function buildOptimizationTarget(jointPlan, groups, baseState = new Map()) {
    const state = cloneInventoryState(baseState);
    groups.forEach((group, index) => {
        const allocation = jointPlan.allocations[index];
        if (!allocation) throw new Error(`Allocazione mancante per l'articolo ${group.item.article}.`);
        if (group.item.type === "pallet") {
            if (allocation.pairs.length !== group.units.length) throw new Error("Numero di destinazioni pallet incoerente.");
            const pairKey = (locations) => locations.slice().sort((left, right) => left.localeCompare(right, "it", { numeric: true })).join("|");
            const remainingPairs = allocation.pairs.map((pair) => [...pair]);
            const assignments = [];
            const remainingUnits = [];
            group.units.forEach((unit) => {
                const matchIndex = remainingPairs.findIndex((pair) => pairKey(pair) === pairKey(unit.locations));
                if (matchIndex < 0) remainingUnits.push(unit);
                else assignments.push({ unit, pair: remainingPairs.splice(matchIndex, 1)[0] });
            });
            remainingUnits.forEach((unit) => assignments.push({ unit, pair: remainingPairs.shift() }));
            assignments.forEach(({ unit, pair }) => {
                pair.forEach((location, pairIndex) => state.set(location, {
                    ...unit.item,
                    location,
                    pairedLocation: pair[pairIndex === 0 ? 1 : 0],
                    tags: [...(unit.item.tags || [])],
                }));
            });
            return;
        }
        if (allocation.locations.length !== group.units.length) throw new Error("Numero di destinazioni cassoni incoerente.");
        const remainingLocations = [...allocation.locations];
        const assignments = [];
        const remainingUnits = [];
        group.units.forEach((unit) => {
            const matchIndex = remainingLocations.indexOf(unit.locations[0]);
            if (matchIndex < 0) remainingUnits.push(unit);
            else assignments.push({ unit, location: remainingLocations.splice(matchIndex, 1)[0] });
        });
        remainingUnits.forEach((unit) => assignments.push({ unit, location: remainingLocations.shift() }));
        assignments.forEach(({ unit, location }) => {
            state.set(location, {
                ...unit.item,
                location,
                pairedLocation: null,
                tags: [...(unit.item.tags || [])],
            });
        });
    });
    return state;
}

function optimizationStackBundle(state, row, number) {
    const items = ["a", "b", "c"]
        .map((level) => state.get(`${row}${number}${level}`))
        .filter((item) => item?.type === "crate");
    if (!items.length) return null;
    return {
        type: "crate",
        locations: items.map((item) => item.location),
        items,
    };
}

function optimizationPalletBundle(state, firstLocation, seenPallets) {
    const item = state.get(firstLocation);
    if (item?.type !== "pallet" || seenPallets.has(item.id)) return null;
    seenPallets.add(item.id);
    const locations = [item.location, item.pairedLocation]
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, "it", { numeric: true }));
    return { type: "pallet", locations, items: [item] };
}

function optimizationBundles(state, placing = false, includedModules = null) {
    const bundles = [];
    const seenPallets = new Set();
    rowCodes().forEach((row) => {
        for (let column = 0; column < physicalColumnsForRow(row); column += 1) {
            if (includedModules && !includedModules.has(`${row}:${column + 1}`)) continue;
            const rear = parseSlotCode(slotCode(row, column, "rear", "a"));
            const front = parseSlotCode(slotCode(row, column, "front", "a"));
            const grounds = placing ? [rear, front] : [front, rear];
            const pallet = grounds.map((parsed) => optimizationPalletBundle(state, parsed.code, seenPallets)).find(Boolean);
            if (pallet) {
                bundles.push(pallet);
                continue;
            }
            grounds.forEach((parsed) => {
                const stack = optimizationStackBundle(state, row, parsed.number);
                if (stack) bundles.push(stack);
            });
        }
    });
    return bundles;
}

function optimizationOperationalSteps(beforeState, afterState, includedModules) {
    const steps = [];
    const targetUnits = new Map(logicalInventoryUnits(afterState).map((unit) => [unit.item.id, unit]));
    const targetChunks = new Map();
    optimizationBundles(beforeState, false, includedModules).forEach((bundle) => {
        steps.push({
            order: steps.length + 1,
            kind: "optimization-corridor",
            from: [...bundle.locations],
            to: [],
            wholeStack: bundle.type === "crate" && bundle.locations.length > 1,
            units: bundle.items.map((item) => operationalUnit(item, item.location)),
        });
        if (bundle.type !== "crate") return;
        const targetKey = (item) => {
            const target = targetUnits.get(item.id)?.locations?.[0];
            const parsed = parseSlotCode(target);
            return parsed ? `${parsed.row}:${parsed.number}` : item.id;
        };
        const runs = [];
        bundle.items.forEach((item) => {
            const key = targetKey(item);
            const previous = runs[runs.length - 1];
            if (previous?.key === key) previous.items.push(item);
            else runs.push({ key, items: [item] });
        });
        runs.forEach((run) => {
            if (!targetChunks.has(run.key)) targetChunks.set(run.key, []);
            targetChunks.get(run.key).push(run.items);
        });
        // Il gruppo più basso può restare fermo; ogni altro gruppo deve essere separato partendo dall'alto.
        runs.slice(1).reverse().forEach((run) => {
            const destinations = run.items.flatMap((item) => targetUnits.get(item.id)?.locations || []);
            steps.push({
                order: steps.length + 1,
                kind: "optimization-stage",
                from: run.items.map((item) => item.location),
                to: destinations,
                wholeStack: run.items.length > 1,
                units: run.items.map((item) => operationalUnit(item, item.location, targetUnits.get(item.id)?.locations?.[0] || "")),
            });
        });
    });
    optimizationBundles(afterState, true, includedModules).forEach((bundle) => {
        if (bundle.type === "crate") {
            const parsed = parseSlotCode(bundle.locations[0]);
            const chunks = (targetChunks.get(`${parsed.row}:${parsed.number}`) || [])
                .map((items) => items.slice().sort((left, right) => {
                    const leftLevel = parseSlotCode(targetUnits.get(left.id)?.locations?.[0])?.level || "a";
                    const rightLevel = parseSlotCode(targetUnits.get(right.id)?.locations?.[0])?.level || "a";
                    return ["a", "b", "c"].indexOf(leftLevel) - ["a", "b", "c"].indexOf(rightLevel);
                }))
                .sort((left, right) => {
                    const leftLevel = parseSlotCode(targetUnits.get(left[0].id)?.locations?.[0])?.level || "a";
                    const rightLevel = parseSlotCode(targetUnits.get(right[0].id)?.locations?.[0])?.level || "a";
                    return ["a", "b", "c"].indexOf(leftLevel) - ["a", "b", "c"].indexOf(rightLevel);
                });
            chunks.forEach((items) => {
                const destinations = items.map((item) => targetUnits.get(item.id)?.locations?.[0]).filter(Boolean);
                steps.push({
                    order: steps.length + 1,
                    kind: "optimization-place",
                    from: [],
                    to: destinations,
                    wholeStack: destinations.length > 1,
                    units: items.map((item) => operationalUnit(item, "", targetUnits.get(item.id)?.locations?.[0] || "")),
                });
            });
            return;
        }
        steps.push({
            order: steps.length + 1,
            kind: "optimization-place",
            from: [],
            to: [...bundle.locations],
            wholeStack: bundle.type === "crate" && bundle.locations.length > 1,
            units: bundle.items.map((item) => operationalUnit(item, "", item.location)),
        });
    });
    return steps;
}

function buildOptimizationLines(beforeState, afterState) {
    const before = indexLogicalUnits(Array.from(beforeState.values()));
    const after = indexLogicalUnits(Array.from(afterState.values()));
    const lines = new Map();
    after.forEach((unit, id) => {
        const previous = before.get(id);
        if (!previous) return;
        const from = previous.locations.join(" + ");
        const to = unit.locations.join(" + ");
        if (from === to) return;
        if (!lines.has(unit.item.article)) lines.set(unit.item.article, { kind: "relocated", article: unit.item.article, locations: [] });
        lines.get(unit.item.article).locations.push(`${from} → ${to}`);
    });
    return Array.from(lines.values());
}

function planWarehouseOptimization(options) {
    if (!inventory.size) return { error: "Il magazzino è vuoto: non ci sono unità da ottimizzare." };
    if (!options.rows.length) return { error: "Seleziona almeno una fila da includere nell'ottimizzazione.", options };
    if (!options.includeRear && !options.includeFront) return { error: "Seleziona almeno un lato utilizzabile.", options };
    const allUnits = logicalInventoryUnits(inventory);
    const requestedUnits = allUnits.filter((unit) => unitIncludedInOptimization(unit, options));
    const movableSelection = removeUnitsBlockedByScope(requestedUnits);
    const selectedUnits = movableSelection.units;
    if (!selectedUnits.length) return {
        error: movableSelection.blockedCount
            ? "Alcune unità dipendono fisicamente da cassoni esclusi dal filtro. Amplia il perimetro per poterle movimentare in sicurezza."
            : "Nessuna unità corrisponde all'area e ai filtri selezionati.",
        options,
    };
    const selectedIds = new Set(selectedUnits.map((unit) => unit.item.id));
    const baseState = cloneInventoryState(inventory);
    Array.from(baseState.entries()).forEach(([location, item]) => {
        if (selectedIds.has(item.id)) baseState.delete(location);
    });
    const { entries, groups } = optimizationEntriesAndUnits(selectedUnits);
    let jointPlan;
    activeCrateSortingProfile = options;
    activeOptimizationScope = options;
    try {
        jointPlan = planJointLoadAllocation(entries, baseState);
    } finally {
        activeCrateSortingProfile = null;
        activeOptimizationScope = null;
    }
    if (!jointPlan) return { error: "Non esiste una disposizione globale valida per la struttura e i vincoli cliente attuali." };
    let state;
    try {
        state = buildOptimizationTarget(jointPlan, groups, baseState);
    } catch (error) {
        return { error: `Piano globale non valido: ${error.message}` };
    }
    const beforeRows = serializeWarehouseInventory();
    const afterRows = Array.from(state.values()).map((item) => ({ ...item, tags: [...(item.tags || [])] }));
    const changes = buildMovementChanges(beforeRows, afterRows);
    const includedModules = new Set(changes.shifted.flatMap((change) => [...(change.from || []), ...(change.to || [])]).map((location) => {
        const parsed = parseSlotCode(location);
        return parsed ? `${parsed.row}:${parsed.physicalColumn}` : "";
    }).filter(Boolean));
    const operationalSteps = changes.shifted.length ? optimizationOperationalSteps(inventory, state, includedModules) : [];
    const humanMovements = operationalSteps.length;
    return {
        state,
        lines: buildOptimizationLines(inventory, state),
        operationalSteps,
        changes,
        humanMovements,
        unitCount: selectedUnits.length,
        changedCount: changes.shifted.length,
        score: jointPlan.score,
        warning: movableSelection.blockedCount
            ? `${movableSelection.blockedCount} unità con dipendenze fisiche escluse sono rimaste ferme per sicurezza.`
            : "",
        options: { ...options },
        applicable: changes.shifted.length > 0 && humanMovements <= options.maxMovements,
        error: humanMovements > options.maxMovements
            ? `Il piano completo richiede ${humanMovements} spostamenti e supera il limite di ${options.maxMovements}. Nessuna modifica verrà applicata.`
            : changes.shifted.length ? "" : "Il magazzino rispetta già la migliore disposizione trovata con questi criteri.",
    };
}

function optimizationStepTitle(step) {
    const source = italianLocationList(step.from || []);
    const destination = italianLocationList(step.to || []);
    const pallet = step.units?.length === 1 && step.units[0].type === "pallet";
    if (step.kind === "optimization-corridor") {
        if (pallet) return `Preleva il pallet ${source} e posizionalo nel corridoio`;
        return step.wholeStack
            ? `Preleva insieme l'intera pila ${source} e posizionala nel corridoio`
            : `Preleva il cassone ${source} e posizionalo nel corridoio`;
    }
    if (step.kind === "optimization-stage") {
        return step.wholeStack
            ? `Separa nel corridoio il gruppo ${source} destinato alla pila ${destination}`
            : `Separa nel corridoio il cassone ${source} destinato a ${destination}`;
    }
    if (pallet) return `Posiziona il pallet dal corridoio in ${destination}`;
    return step.wholeStack
        ? `Posiziona insieme la pila dal corridoio in ${destination}`
        : `Posiziona il cassone dal corridoio in ${destination}`;
}

function invalidateWarehouseOptimizationPreview() {
    warehouseOptimizationPreview = null;
    document.getElementById("applyWarehouseOptimization").disabled = true;
    document.getElementById("warehouseOptimizerPreview").hidden = true;
}

function renderOptimizerRows() {
    const container = document.getElementById("optimizerRows");
    if (!container) return;
    const available = rowCodes();
    if (!optimizerSelectedRows) optimizerSelectedRows = new Set(available);
    else {
        optimizerSelectedRows = new Set(Array.from(optimizerSelectedRows).filter((row) => available.includes(row)));
    }
    container.replaceChildren();
    available.forEach((row) => {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = row;
        checkbox.checked = optimizerSelectedRows.has(row);
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) optimizerSelectedRows.add(row);
            else optimizerSelectedRows.delete(row);
            invalidateWarehouseOptimizationPreview();
        });
        label.append(checkbox, document.createTextNode(`Fila ${row}`));
        container.appendChild(label);
    });
    const maximum = Math.max(...available.map((row) => physicalColumnsForRow(row)), 1);
    const to = document.getElementById("optimizerColumnTo");
    const from = document.getElementById("optimizerColumnFrom");
    to.max = String(maximum);
    from.max = String(maximum);
    if (!Number(to.value) || Number(to.value) > maximum) to.value = String(maximum);
    if (!Number(from.value) || Number(from.value) > maximum) from.value = "1";
}

function optimizerTokenConfig(kind) {
    return kind === "articles"
        ? { entryId: "optimizerArticleEntry", actionId: "optimizerArticleAction", containerId: "optimizerArticleTokens" }
        : { entryId: "optimizerCustomerEntry", actionId: "optimizerCustomerAction", containerId: "optimizerCustomerTokens" };
}

function renderOptimizerTokens(kind) {
    const config = optimizerTokenConfig(kind);
    const container = document.getElementById(config.containerId);
    container.replaceChildren();
    const values = [
        ...Array.from(optimizerFilters[kind].include).map((value) => ({ value, action: "include" })),
        ...Array.from(optimizerFilters[kind].exclude).map((value) => ({ value, action: "exclude" })),
    ];
    if (!values.length) {
        const empty = document.createElement("span");
        empty.textContent = "Nessun filtro";
        container.appendChild(empty);
        return;
    }
    values.forEach(({ value, action }) => {
        const chip = document.createElement("span");
        chip.className = `warehouse-optimizer-token${action === "exclude" ? " is-exclude" : ""}`;
        const mode = document.createElement("small");
        mode.textContent = action === "include" ? "includi" : "escludi";
        const text = document.createElement("span");
        text.textContent = value;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.title = `Rimuovi filtro ${value}`;
        remove.addEventListener("click", () => {
            optimizerFilters[kind][action].delete(value);
            renderOptimizerTokens(kind);
            invalidateWarehouseOptimizationPreview();
        });
        chip.append(mode, text, remove);
        container.appendChild(chip);
    });
}

function addOptimizerToken(kind) {
    const config = optimizerTokenConfig(kind);
    const entry = document.getElementById(config.entryId);
    const action = document.getElementById(config.actionId).value === "exclude" ? "exclude" : "include";
    const opposite = action === "include" ? "exclude" : "include";
    const values = parseCustomerList(entry.value);
    values.forEach((value) => {
        optimizerFilters[kind][opposite].delete(value);
        optimizerFilters[kind][action].add(value);
    });
    entry.value = "";
    renderOptimizerTokens(kind);
    invalidateWarehouseOptimizationPreview();
    entry.focus();
}

function renderWarehouseOptimizationPreview(plan, elapsed) {
    const preview = document.getElementById("warehouseOptimizerPreview");
    const apply = document.getElementById("applyWarehouseOptimization");
    const status = document.getElementById("warehouseOptimizerStatus");
    preview.hidden = false;
    document.getElementById("optimizerMovementCount").textContent = String(plan.humanMovements || 0);
    document.getElementById("optimizerMovementLimit").textContent = `massimo ${plan.options?.maxMovements || warehouseOptimizationOptions().maxMovements}`;
    document.getElementById("optimizerUnitCount").textContent = String(plan.unitCount || 0);
    document.getElementById("optimizerChangedCount").textContent = String(plan.changedCount || 0);
    document.getElementById("optimizerElapsedTime").textContent = elapsed >= 1000
        ? `${(elapsed / 1000).toFixed(1)} s`
        : `${Math.round(elapsed)} ms`;
    status.textContent = plan.error || [
        `Piano completo valido: ${plan.changedCount} unità cambieranno ubicazione in ${plan.humanMovements} spostamenti.`,
        plan.warning,
    ].filter(Boolean).join(" ");
    status.classList.toggle("is-error", Boolean(plan.error));
    const scope = plan.options || warehouseOptimizationOptions();
    const filterLabel = (filter) => [
        filter?.include?.length ? `includi ${filter.include.join(", ")}` : "",
        filter?.exclude?.length ? `escludi ${filter.exclude.join(", ")}` : "",
    ].filter(Boolean).join("; ") || "tutti";
    document.getElementById("warehouseOptimizerScopeSummary").textContent = [
        `File: ${scope.rows?.join(", ") || "nessuna"}`,
        `Lati: ${[scope.includeRear ? "posteriore" : "", scope.includeFront ? "anteriore" : ""].filter(Boolean).join(" + ") || "nessuno"}`,
        `Coppie fisiche: ${scope.columnFrom || 1}–${scope.columnTo || 1}`,
        `Unità: ${[scope.includeCrates ? "cassoni" : "", scope.includePallets ? "pallet" : ""].filter(Boolean).join(", ") || "nessuna"}`,
        `Articoli: ${filterLabel(scope.articles)}`,
        `Clienti: ${filterLabel(scope.customers)}`,
    ].join(" · ");
    apply.disabled = !plan.applicable;

    const instructions = document.getElementById("warehouseOptimizerInstructions");
    instructions.replaceChildren();
    if (!plan.operationalSteps?.length) return;
    plan.operationalSteps.forEach((step, index) => {
        const row = document.createElement("article");
        const number = document.createElement("b");
        number.textContent = String(index + 1);
        const content = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = optimizationStepTitle(step);
        const details = document.createElement("small");
        details.textContent = operationalUnitsDescription(step.units || []);
        content.append(title, details);
        row.append(number, content);
        instructions.appendChild(row);
    });
}

function openWarehouseOptimizer() {
    if (!isWarehouseAdmin()) {
        showWarehouseToast("Accesso amministratore richiesto per ottimizzare il magazzino.", true);
        return;
    }
    closeToolsDrawer();
    warehouseOptimizationPreview = null;
    renderOptimizerRows();
    renderOptimizerTokens("articles");
    renderOptimizerTokens("customers");
    document.getElementById("warehouseOptimizerPreview").hidden = true;
    document.getElementById("applyWarehouseOptimization").disabled = true;
    openWarehouseDialog(document.getElementById("warehouseOptimizerDialog"), document.getElementById("optimizerMaxMovements"));
}

function closeWarehouseOptimizer() {
    closeWarehouseDialog(document.getElementById("warehouseOptimizerDialog"));
    warehouseOptimizationPreview = null;
}

async function calculateWarehouseOptimization() {
    if (!isWarehouseAdmin()) return;
    if (document.getElementById("optimizerArticleEntry")?.value.trim()) addOptimizerToken("articles");
    if (document.getElementById("optimizerCustomerEntry")?.value.trim()) addOptimizerToken("customers");
    const button = document.getElementById("calculateWarehouseOptimization");
    const options = warehouseOptimizationOptions();
    document.getElementById("optimizerMaxMovements").value = String(options.maxMovements);
    button.disabled = true;
    button.textContent = "Calcolo globale in corso…";
    document.getElementById("applyWarehouseOptimization").disabled = true;
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    const startedAt = performance.now();
    let plan;
    try {
        plan = planWarehouseOptimization(options);
    } catch (error) {
        plan = { error: `Calcolo non completato: ${error.message}`, options, applicable: false };
    }
    const elapsed = performance.now() - startedAt;
    button.disabled = false;
    button.textContent = "Ricalcola anteprima completa";
    warehouseOptimizationPreview = plan.state ? { revision: warehouseRevision, plan } : null;
    renderWarehouseOptimizationPreview(plan, elapsed);
}

async function applyWarehouseOptimization() {
    const preview = warehouseOptimizationPreview;
    if (!isWarehouseAdmin()) {
        showWarehouseToast("Accesso amministratore richiesto.", true);
        return;
    }
    if (!preview?.plan?.applicable) return;
    if (preview.revision !== warehouseRevision) {
        warehouseOptimizationPreview = null;
        document.getElementById("applyWarehouseOptimization").disabled = true;
        const status = document.getElementById("warehouseOptimizerStatus");
        status.textContent = "Il magazzino è cambiato dopo il calcolo. Ricalcola l'anteprima prima di applicarla.";
        status.classList.add("is-error");
        return;
    }
    const accepted = await showWarehouseConfirm({
        title: "Applicare l'ottimizzazione completa?",
        message: `${preview.plan.humanMovements} spostamenti ricostruiranno la disposizione del magazzino. L'operazione sarà registrata nello storico.`,
        confirmLabel: "Applica ottimizzazione",
    });
    if (!accepted) return;
    const button = document.getElementById("applyWarehouseOptimization");
    button.disabled = true;
    button.textContent = "Salvataggio…";
    const beforeState = serializeWarehouseInventory();
    const afterState = Array.from(preview.plan.state.values()).map((item) => ({ ...item, tags: [...(item.tags || [])] }));
    const now = new Date();
    const movement = {
        id: movementIdentifier(now),
        timestamp: now.toISOString(),
        type: "load",
        optimization: true,
        optimizationOptions: { ...preview.plan.options },
        actor: warehouseActorSnapshot(),
        lines: preview.plan.lines,
        operationalSteps: preview.plan.operationalSteps,
        beforeState: cloneWarehouseRows(beforeState),
        afterState: cloneWarehouseRows(afterState),
        changes: buildMovementChanges(beforeState, afterState),
    };
    try {
        await persistWarehouseData(afterState, [movement, ...serializeWarehouseMovements()], cloneUnloadZoneUnits());
    } catch (error) {
        button.disabled = false;
        button.textContent = "Applica ottimizzazione";
        const status = document.getElementById("warehouseOptimizerStatus");
        status.textContent = `Ottimizzazione non applicata: ${error.message}`;
        status.classList.add("is-error");
        return;
    }
    inventory.clear();
    preview.plan.state.forEach((item, location) => inventory.set(location, item));
    movementHistory.unshift(movement);
    warehouseOptimizationPreview = null;
    movementHighlight = {
        loadedIds: new Set(),
        loadedLocations: new Set(),
        shiftedIds: new Set(movement.changes.shifted.map((entry) => entry.id)),
        shiftedLocations: new Set(movement.changes.shifted.flatMap((entry) => entry.to || [])),
    };
    refreshWarehouseDataViews();
    closeWarehouseOptimizer();
    showWarehouseToast(`${movement.id}: ottimizzazione completata e registrata.`);
}

function setupWarehouseOptimizer() {
    document.getElementById("openWarehouseOptimizer")?.addEventListener("click", openWarehouseOptimizer);
    document.getElementById("closeWarehouseOptimizer")?.addEventListener("click", closeWarehouseOptimizer);
    document.getElementById("cancelWarehouseOptimizer")?.addEventListener("click", closeWarehouseOptimizer);
    document.getElementById("addOptimizerArticle")?.addEventListener("click", () => addOptimizerToken("articles"));
    document.getElementById("addOptimizerCustomer")?.addEventListener("click", () => addOptimizerToken("customers"));
    [["optimizerArticleEntry", "articles"], ["optimizerCustomerEntry", "customers"]].forEach(([id, kind]) => {
        document.getElementById(id)?.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== ",") return;
            event.preventDefault();
            addOptimizerToken(kind);
        });
    });
    [
        "optimizerMaxMovements", "optimizerIncludeRear", "optimizerIncludeFront",
        "optimizerIncludeCrates", "optimizerIncludePallets",
        "optimizerColumnFrom", "optimizerColumnTo", "optimizerPreferProximity",
        "optimizerOptimizeSpace", "optimizerReduceFutureMoves",
    ].forEach((id) => document.getElementById(id)?.addEventListener("change", invalidateWarehouseOptimizationPreview));
    document.getElementById("warehouseOptimizerForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        await calculateWarehouseOptimization();
    });
    document.getElementById("applyWarehouseOptimization")?.addEventListener("click", applyWarehouseOptimization);
}

function compactCrateStacks(state) {
    rowCodes().forEach((row) => {
        for (let number = 1; number <= maximumPositionForRow(row); number += 1) {
            const codes = ["a", "b", "c"].map((level) => `${row}${number}${level}`);
            if (codes.some((code) => state.get(code)?.type === "pallet")) continue;
            const items = codes.map((code) => state.get(code)).filter(Boolean);
            codes.forEach((code) => state.delete(code));
            items.forEach((item, index) => {
                const location = `${row}${number}${["a", "b", "c"][index]}`;
                item.location = location;
                state.set(location, item);
            });
        }
    });
}

function indexLogicalUnits(rows) {
    const units = new Map();
    (rows || []).forEach((item) => {
        if (!item?.id) return;
        if (!units.has(item.id)) units.set(item.id, { item, locations: [] });
        units.get(item.id).locations.push(item.location);
    });
    units.forEach((unit) => unit.locations.sort((a, b) => a.localeCompare(b, "it", { numeric: true })));
    return units;
}

function buildMovementChanges(beforeState, afterState) {
    const before = indexLogicalUnits(beforeState);
    const after = indexLogicalUnits(afterState);
    const loaded = [];
    const unloaded = [];
    const shifted = [];
    const adjusted = [];
    after.forEach((unit, id) => {
        if (!before.has(id)) {
            loaded.push({ id, article: unit.item.article, from: [], to: [...unit.locations] });
            return;
        }
        const previous = before.get(id);
        if (warehouseItemPieces(previous.item) !== warehouseItemPieces(unit.item)) {
            adjusted.push({
                id,
                article: unit.item.article,
                beforePieces: warehouseItemPieces(previous.item),
                afterPieces: warehouseItemPieces(unit.item),
            });
        }
        if (previous.locations.join("|") !== unit.locations.join("|")) {
            shifted.push({ id, article: unit.item.article, from: [...previous.locations], to: [...unit.locations] });
        }
    });
    before.forEach((unit, id) => {
        if (!after.has(id)) unloaded.push({ id, article: unit.item.article, from: [...unit.locations], to: [] });
    });
    return { loaded, unloaded, shifted, adjusted };
}

function fifoOperationalBatch(item) {
    const timestamp = new Date(item.receivedAt || 0);
    if (Number.isNaN(timestamp.getTime())) return "0000-00-00T00:00:00.000Z";
    return timestamp.toISOString();
}

function estimateUnloadSelection(state, selectedIds) {
    const selected = new Set(selectedIds);
    const units = new Map(logicalInventoryUnits(state).map((unit) => [unit.item.id, unit]));
    const touchedStacks = new Map();
    const rearModules = new Map();
    const selectedPalletModules = new Set();
    let humanMovements = 0;
    let releasedStacks = 0;
    let releasedModules = 0;
    let frontUnits = 0;
    let rearUnits = 0;
    let isolatedUnits = 0;
    selected.forEach((id) => {
        const unit = units.get(id);
        if (!unit) return;
        if (unit.item.type === "pallet") {
            humanMovements += 1;
            const parsed = parseSlotCode(unit.locations[0]);
            selectedPalletModules.add(`${parsed.row}:${parsed.physicalColumn}`);
            return;
        }
        const parsed = parseSlotCode(unit.locations[0]);
        if (parsed.side === "front") frontUnits += 1;
        else rearUnits += 1;
        const sourceStack = ["a", "b", "c"].map((level) => state.get(`${parsed.row}${parsed.number}${level}`)).filter(Boolean);
        if (sourceStack.length === 1) isolatedUnits += 1;
        touchedStacks.set(`${parsed.row}:${parsed.number}`, parsed);
        if (parsed.side === "rear") rearModules.set(`${parsed.row}:${parsed.physicalColumn}`, parsed);
    });
    touchedStacks.forEach((parsed) => {
        const stack = ["a", "b", "c"].map((level) => state.get(`${parsed.row}${parsed.number}${level}`)).filter(Boolean);
        const selectedLevels = stack.map((item, index) => selected.has(item.id) ? index : -1).filter((index) => index >= 0);
        if (!selectedLevels.length) return;
        let extractionRuns = 1;
        for (let index = 1; index < selectedLevels.length; index += 1) {
            if (selectedLevels[index] !== selectedLevels[index - 1] + 1) extractionRuns += 1;
        }
        humanMovements += extractionRuns;
        const lowestSelected = Math.min(...selectedLevels);
        if (stack.slice(lowestSelected + 1).some((item) => !selected.has(item.id))) humanMovements += 2;
        if (stack.every((item) => selected.has(item.id))) releasedStacks += 1;
    });
    rearModules.forEach((parsed) => {
        const frontNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "front", "a")).number;
        const frontItems = ["a", "b", "c"].map((level) => state.get(`${parsed.row}${frontNumber}${level}`)).filter(Boolean);
        if (frontItems.some((item) => !selected.has(item.id))) humanMovements += 2;
    });
    const touchedModules = new Map();
    touchedStacks.forEach((parsed) => touchedModules.set(`${parsed.row}:${parsed.physicalColumn}`, parsed));
    touchedModules.forEach((parsed) => {
        const rearNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "rear", "a")).number;
        const frontNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "front", "a")).number;
        const items = [rearNumber, frontNumber].flatMap((number) => (
            ["a", "b", "c"].map((level) => state.get(`${parsed.row}${number}${level}`)).filter(Boolean)
        ));
        if (items.length && items.every((item) => selected.has(item.id))) releasedModules += 1;
    });
    releasedStacks += selectedPalletModules.size * 2;
    releasedModules += selectedPalletModules.size;
    return { humanMovements, releasedStacks, releasedModules, frontUnits, rearUnits, isolatedUnits };
}

const UNLOAD_SELECTION_WEIGHTS = Object.freeze({
    humanMovement: 1000,
    firstReleasedModuleCredit: 1100,
    releasedStackCredit: 60,
    isolatedUnitCredit: 1200,
    rearUnitPenalty: 25,
    combinationBeamWidth: 64,
});

function scoreUnloadSelection(metrics) {
    return metrics.humanMovements * UNLOAD_SELECTION_WEIGHTS.humanMovement
        - (metrics.releasedModules > 0 ? UNLOAD_SELECTION_WEIGHTS.firstReleasedModuleCredit : 0)
        - metrics.releasedStacks * UNLOAD_SELECTION_WEIGHTS.releasedStackCredit
        - metrics.isolatedUnits * UNLOAD_SELECTION_WEIGHTS.isolatedUnitCredit
        + metrics.rearUnits * UNLOAD_SELECTION_WEIGHTS.rearUnitPenalty;
}

function compareUnloadSelectionNodes(left, right) {
    return left.score - right.score
        || left.metrics.humanMovements - right.metrics.humanMovements
        || right.metrics.releasedModules - left.metrics.releasedModules
        || right.metrics.isolatedUnits - left.metrics.isolatedUnits
        || right.metrics.releasedStacks - left.metrics.releasedStacks
        || left.metrics.rearUnits - right.metrics.rearUnits
        || right.metrics.frontUnits - left.metrics.frontUnits
        || left.signature.localeCompare(right.signature, "it", { numeric: true });
}

function chooseUnloadBatchUnits(state, candidates, quantity, alreadySelected) {
    const ordered = candidates.slice().sort((left, right) => (
        left.locations[0].localeCompare(right.locations[0], "it", { numeric: true })
    ));
    let nodes = [{ chosen: [], nextIndex: 0, metrics: estimateUnloadSelection(state, alreadySelected), score: 0, signature: "" }];
    for (let depth = 0; depth < quantity; depth += 1) {
        const expanded = [];
        nodes.forEach((node) => {
            for (let index = node.nextIndex; index < ordered.length; index += 1) {
                if (ordered.length - index < quantity - depth) break;
                const chosen = [...node.chosen, ordered[index]];
                const ids = new Set([...alreadySelected, ...chosen.map((unit) => unit.item.id)]);
                const metrics = estimateUnloadSelection(state, ids);
                const signature = chosen.map((unit) => unit.locations.join("+")).join("|");
                expanded.push({
                    chosen,
                    nextIndex: index + 1,
                    metrics,
                    score: scoreUnloadSelection(metrics),
                    signature,
                });
            }
        });
        nodes = expanded.sort(compareUnloadSelectionNodes).slice(0, UNLOAD_SELECTION_WEIGHTS.combinationBeamWidth);
        if (!nodes.length) break;
    }
    return nodes.sort(compareUnloadSelectionNodes)[0]?.chosen || [];
}

function chooseUnloadUnits(state, candidates, quantity, alreadySelected, forced) {
    if (forced) return candidates.slice()
        .sort((left, right) => left.locations[0].localeCompare(right.locations[0], "it", { numeric: true }))
        .slice(0, quantity);
    const batches = new Map();
    candidates.forEach((candidate) => {
        const key = fifoOperationalBatch(candidate.item);
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key).push(candidate);
    });
    const chosen = [];
    Array.from(batches.keys()).sort().some((key) => {
        const required = quantity - chosen.length;
        if (required <= 0) return true;
        const batch = batches.get(key);
        const selected = batch.length <= required
            ? batch
            : chooseUnloadBatchUnits(state, batch, required, new Set([...alreadySelected, ...chosen.map((unit) => unit.item.id)]));
        chosen.push(...selected);
        return chosen.length >= quantity;
    });
    return chosen;
}

function warehouseItemPieces(item) {
    return Math.max(1, Number(item?.pieceCount) || 1);
}

function choosePieceWithdrawalUnits(state, candidates, requestedPieces, alreadySelected = new Set()) {
    const remainingCandidates = candidates.slice();
    const selectedIds = new Set(alreadySelected);
    const selections = [];
    let remaining = requestedPieces;
    while (remaining > 0 && remainingCandidates.length) {
        remainingCandidates.sort((left, right) => {
            const pieceDifference = warehouseItemPieces(left.item) - warehouseItemPieces(right.item);
            if (pieceDifference) return pieceDifference;
            const leftMetrics = estimateUnloadSelection(state, new Set([...selectedIds, left.item.id]));
            const rightMetrics = estimateUnloadSelection(state, new Set([...selectedIds, right.item.id]));
            const movementDifference = leftMetrics.humanMovements - rightMetrics.humanMovements;
            return movementDifference
                || scoreUnloadSelection(leftMetrics) - scoreUnloadSelection(rightMetrics)
                || fifoOperationalBatch(left.item).localeCompare(fifoOperationalBatch(right.item))
                || left.locations[0].localeCompare(right.locations[0], "it", { numeric: true });
        });
        const unit = remainingCandidates.shift();
        const availablePieces = warehouseItemPieces(unit.item);
        const takenPieces = Math.min(remaining, availablePieces);
        selections.push({ unit, takenPieces, availablePieces, complete: takenPieces === availablePieces });
        selectedIds.add(unit.item.id);
        remaining -= takenPieces;
    }
    return { selections, remaining };
}

function collectUnloadAffectedUnits(state, selectedIds) {
    const units = new Map(logicalInventoryUnits(state).map((unit) => [unit.item.id, unit]));
    const affectedIds = new Set();
    selectedIds.forEach((id) => {
        const unit = units.get(id);
        if (!unit || unit.item.type === "pallet") return;
        unit.locations.forEach((location) => {
            const parsed = parseSlotCode(location);
            const levelIndex = ["a", "b", "c"].indexOf(parsed.level);
            ["a", "b", "c"].slice(levelIndex + 1).forEach((level) => {
                const above = state.get(`${parsed.row}${parsed.number}${level}`);
                if (above && !selectedIds.has(above.id)) affectedIds.add(above.id);
            });
            if (parsed.side === "rear") {
                const frontNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "front", "a")).number;
                ["a", "b", "c"].forEach((level) => {
                    const blocker = state.get(`${parsed.row}${frontNumber}${level}`);
                    if (blocker && !selectedIds.has(blocker.id)) affectedIds.add(blocker.id);
                });
            }
        });
    });
    return Array.from(affectedIds, (id) => units.get(id)).filter(Boolean);
}

function writeCrateStack(state, row, number, items) {
    ["a", "b", "c"].forEach((level) => state.delete(`${row}${number}${level}`));
    items.forEach((item, index) => {
        const location = `${row}${number}${["a", "b", "c"][index]}`;
        state.set(location, { ...item, location, tags: [...(item.tags || [])] });
    });
}

function restoreUnloadObstructionsLocally(sourceState, selectedUnits, initiallyAffectedUnits) {
    const selectedIds = new Set(selectedUnits.map((unit) => unit.item.id));
    const initiallyAffectedIds = new Set(initiallyAffectedUnits.map((unit) => unit.item.id));
    const state = cloneInventoryState(sourceState);
    selectedUnits.forEach((unit) => unit.locations.forEach((location) => state.delete(location)));
    compactCrateStacks(state);

    const touchedModules = new Map();
    selectedUnits.forEach((unit) => unit.locations.forEach((location) => {
        const parsed = parseSlotCode(location);
        if (parsed) touchedModules.set(`${parsed.row}:${parsed.physicalColumn}`, parsed);
    }));
    touchedModules.forEach((parsed) => {
        const rearNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "rear", "a")).number;
        const frontNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "front", "a")).number;
        const rear = ["a", "b", "c"].map((level) => state.get(`${parsed.row}${rearNumber}${level}`)).filter(Boolean);
        const front = ["a", "b", "c"].map((level) => state.get(`${parsed.row}${frontNumber}${level}`)).filter(Boolean);
        if (!front.length || rear.length === 3 || front.some((item) => item.type === "pallet") || rear.some((item) => item.type === "pallet")) return;

        let nextRear;
        let nextFront;
        if (front.length === 3) {
            // La pila anteriore completa passa dietro senza essere spezzata; il residuo posteriore passa davanti.
            nextRear = front;
            nextFront = rear;
        } else {
            // Mantiene tutto nel modulo originale e trasferisce dietro soltanto quanto serve.
            const localUnits = [...rear, ...front];
            nextRear = localUnits.slice(0, Math.min(3, localUnits.length));
            nextFront = localUnits.slice(3);
        }
        writeCrateStack(state, parsed.row, rearNumber, nextRear);
        writeCrateStack(state, parsed.row, frontNumber, nextFront);
    });

    const beforeUnits = new Map(logicalInventoryUnits(sourceState).map((unit) => [unit.item.id, unit]));
    const afterUnits = new Map(logicalInventoryUnits(state).map((unit) => [unit.item.id, unit]));
    const relocations = [];
    beforeUnits.forEach((before, id) => {
        if (selectedIds.has(id)) return;
        const after = afterUnits.get(id);
        if (!after) return;
        const from = before.locations.slice().sort((left, right) => compareLocations({ location: left }, { location: right }));
        const to = after.locations.slice().sort((left, right) => compareLocations({ location: left }, { location: right }));
        if (!initiallyAffectedIds.has(id) && from.join("|") === to.join("|")) return;
        const allowed = to.every((location) => evaluateCustomerForSlot(location, before.item.customer).allowed);
        if (!allowed) {
            relocations.push({ error: `Il rientro locale di ${before.item.article} non rispetta il vincolo cliente della nuova posizione ${to.join(" + ")}.` });
            return;
        }
        relocations.push({ id, article: before.item.article, from, to });
    });
    const conflict = relocations.find((relocation) => relocation.error);
    return conflict ? { error: conflict.error } : { state, relocations };
}

function buildUnloadMovementLines(selectedUnits, relocations) {
    const lines = new Map();
    const add = (kind, article, location) => {
        const key = `${kind}:${article}`;
        if (!lines.has(key)) lines.set(key, { kind, article, locations: [] });
        lines.get(key).locations.push(location);
    };
    selectedUnits.forEach(({ item, locations }) => add(
        "unloaded",
        item.article,
        item.type === "pallet" ? locations.slice().sort((a, b) => a.localeCompare(b, "it", { numeric: true })).join(" + ") : locations[0],
    ));
    relocations.forEach((relocation) => {
        const from = relocation.from.join(" + ");
        const to = relocation.to.join(" + ");
        add("relocated", relocation.article, from === to ? `${from} → corridoio → ${to}` : `${from} → ${to}`);
    });
    return Array.from(lines.values());
}

function operationalUnit(item, from, to = "") {
    return {
        id: item.id,
        article: item.article || "",
        customer: item.customer || "",
        orderReference: item.orderReference || "",
        weighingCode: item.weighingCode || "",
        pieceCount: Math.max(1, Number(item.pieceCount) || 1),
        maxPieceCapacity: Math.max(1, Number(item.maxPieceCapacity) || Number(item.pieceCount) || 1),
        type: item.type || "crate",
        from,
        to,
    };
}

function sameOperationalDestination(previous, next) {
    if (!previous?.to || !next?.to) return false;
    const left = parseSlotCode(previous.to);
    const right = parseSlotCode(next.to);
    if (!left || !right || left.row !== right.row || left.number !== right.number) return false;
    return ["a", "b", "c"].indexOf(left.level) - ["a", "b", "c"].indexOf(right.level) === 1;
}

function unloadSourceStacks(sourceState, selectedIds, affectedIds) {
    const stacks = new Map();
    const isolatedModules = new Set();
    sourceState.forEach((item, location) => {
        if (item.type !== "crate" || !selectedIds.has(item.id)) return;
        const parsed = parseSlotCode(location);
        const stackSize = ["a", "b", "c"].map((level) => sourceState.get(`${parsed.row}${parsed.number}${level}`)).filter(Boolean).length;
        if (stackSize === 1) isolatedModules.add(`${parsed.row}:${parsed.physicalColumn}`);
    });
    sourceState.forEach((item, location) => {
        if (item.type !== "crate" || (!selectedIds.has(item.id) && !affectedIds.has(item.id))) return;
        const parsed = parseSlotCode(location);
        const key = `${parsed.row}:${parsed.physicalColumn}:${parsed.side}`;
        if (!stacks.has(key)) stacks.set(key, { parsed, units: [] });
        stacks.get(key).units.push({ item, location, parsed });
    });
    return Array.from(stacks.values()).sort((left, right) => {
        const leftIsolated = isolatedModules.has(`${left.parsed.row}:${left.parsed.physicalColumn}`);
        const rightIsolated = isolatedModules.has(`${right.parsed.row}:${right.parsed.physicalColumn}`);
        if (leftIsolated !== rightIsolated) return leftIsolated ? -1 : 1;
        const rowDifference = rowCodes().indexOf(left.parsed.row) - rowCodes().indexOf(right.parsed.row);
        if (rowDifference) return rowDifference;
        if (left.parsed.physicalColumn !== right.parsed.physicalColumn) return left.parsed.physicalColumn - right.parsed.physicalColumn;
        return left.parsed.side === right.parsed.side ? 0 : left.parsed.side === "front" ? -1 : 1;
    });
}

function buildUnloadOperationalSteps(sourceState, selectedUnits, relocations) {
    const selectedIds = new Set(selectedUnits.map((unit) => unit.item.id));
    const relocationById = new Map(relocations.map((relocation) => [relocation.id, relocation]));
    const affectedIds = new Set(relocationById.keys());
    const extractionSteps = [];
    const corridorGroups = [];
    unloadSourceStacks(sourceState, selectedIds, affectedIds).forEach((stack) => {
        const units = stack.units.slice().sort((left, right) => (
            ["a", "b", "c"].indexOf(right.parsed.level) - ["a", "b", "c"].indexOf(left.parsed.level)
        ));
        let index = 0;
        while (index < units.length) {
            const first = units[index];
            const kind = selectedIds.has(first.item.id) ? "unload" : "corridor";
            const grouped = [first];
            let cursor = index + 1;
            while (cursor < units.length && grouped.length < 3) {
                const candidate = units[cursor];
                const candidateKind = selectedIds.has(candidate.item.id) ? "unload" : "corridor";
                if (candidateKind !== kind) break;
                if (kind === "corridor") {
                    const previousRelocation = relocationById.get(grouped[grouped.length - 1].item.id);
                    const candidateRelocation = relocationById.get(candidate.item.id);
                    const previousTarget = previousRelocation?.to?.[0] || "";
                    const candidateTarget = candidateRelocation?.to?.[0] || "";
                    if (!sameOperationalDestination({ to: previousTarget }, { to: candidateTarget })) break;
                }
                grouped.push(candidate);
                cursor += 1;
            }
            const ordered = grouped.slice().reverse();
            const step = {
                kind,
                from: ordered.map((unit) => unit.location),
                to: kind === "unload" ? [STAGING_AREA_LABEL] : ["Corridoio"],
                units: ordered.map((unit) => operationalUnit(
                    unit.item,
                    unit.location,
                    kind === "unload" ? STAGING_AREA_LABEL : relocationById.get(unit.item.id)?.to?.[0] || "",
                )),
                wholeStack: ordered.length === 3 && ordered.map((unit) => unit.parsed.level).join("") === "abc",
            };
            extractionSteps.push(step);
            if (kind === "corridor") corridorGroups.push(step);
            index = cursor;
        }
    });
    selectedUnits.filter((unit) => unit.item.type === "pallet").forEach((unit) => {
        const locations = unit.locations.slice().sort((left, right) => left.localeCompare(right, "it", { numeric: true }));
        extractionSteps.push({
            kind: "unload",
            from: locations,
            to: [STAGING_AREA_LABEL],
            units: [operationalUnit(unit.item, locations.join(" + "), STAGING_AREA_LABEL)],
            wholeStack: false,
        });
    });
    const reinsertionSteps = corridorGroups.map((group) => ({
        kind: "reinsert",
        from: [...group.from],
        to: group.units.map((unit) => unit.to),
        units: group.units.map((unit) => ({ ...unit })),
        wholeStack: group.wholeStack,
    })).sort((left, right) => {
        const leftTarget = parseSlotCode(left.to[0]);
        const rightTarget = parseSlotCode(right.to[0]);
        if (!leftTarget || !rightTarget) return 0;
        const rowDifference = rowCodes().indexOf(leftTarget.row) - rowCodes().indexOf(rightTarget.row);
        if (rowDifference) return rowDifference;
        if (leftTarget.physicalColumn !== rightTarget.physicalColumn) return leftTarget.physicalColumn - rightTarget.physicalColumn;
        if (leftTarget.side !== rightTarget.side) return leftTarget.side === "rear" ? -1 : 1;
        return ["a", "b", "c"].indexOf(leftTarget.level) - ["a", "b", "c"].indexOf(rightTarget.level);
    });
    return [...extractionSteps, ...reinsertionSteps].map((step, index) => ({ ...step, order: index + 1 }));
}

function planUnloadOperation(entries, initialState = inventory) {
    const sourceState = cloneInventoryState(initialState);
    const logicalUnits = logicalInventoryUnits(sourceState);
    const selectedIds = new Set();
    const touchedIds = new Set();
    const selectedUnits = [];
    const pieceSelections = [];
    for (const entry of entries) {
        const requestedIds = new Set(entry.sourceIds || []);
        const weighingCode = normalizeCustomer(entry.weighingCode);
        const candidates = logicalUnits.filter(({ item }) => !touchedIds.has(item.id)
            && (!entry.article || item.article === entry.article)
            && (!entry.customer || item.customer === entry.customer)
            && (!entry.order || item.orderReference === entry.order)
            && (!weighingCode || normalizeCustomer(item.weighingCode) === weighingCode)
            && (!entry.type || item.type === entry.type)
            && (!requestedIds.size || requestedIds.has(item.id)));
        if (weighingCode && candidates.length !== 1) {
            return { error: candidates.length ? `Il codice pesata ${entry.weighingCode} non è univoco.` : `Nessun cassone trovato con codice pesata ${entry.weighingCode}.` };
        }
        if (entry.requestedPieces) {
            const requestedPieces = Math.max(1, Number(entry.requestedPieces) || 0);
            const availablePieces = candidates.reduce((sum, unit) => sum + warehouseItemPieces(unit.item), 0);
            if (availablePieces < requestedPieces) {
                return { error: `Disponibilità insufficiente: richiesti ${requestedPieces} pezzi${entry.article ? ` dell'articolo ${entry.article}` : ""}, disponibili ${availablePieces}.` };
            }
            choosePieceWithdrawalUnits(sourceState, candidates, requestedPieces, selectedIds).selections.forEach((selection) => {
                touchedIds.add(selection.unit.item.id);
                pieceSelections.push(selection);
                if (selection.complete) {
                    selectedIds.add(selection.unit.item.id);
                    selectedUnits.push(selection.unit);
                }
            });
            continue;
        }
        const quantity = entry.order && !weighingCode && !requestedIds.size
            ? candidates.length
            : Math.max(1, Number(entry.quantity) || 1);
        if (candidates.length < quantity || quantity < 1) {
            const target = entry.article || entry.order || entry.weighingCode || "la selezione indicata";
            return { error: `Disponibilità insufficiente per ${target}: richieste ${quantity} unità, trovate ${candidates.length}.` };
        }
        chooseUnloadUnits(sourceState, candidates, quantity, selectedIds, requestedIds.size > 0 || Boolean(weighingCode)).forEach((unit) => {
            touchedIds.add(unit.item.id);
            selectedIds.add(unit.item.id);
            selectedUnits.push(unit);
        });
    }
    const partialSelections = pieceSelections.filter((selection) => !selection.complete);
    partialSelections.forEach((selection) => {
        selectedIds.add(selection.unit.item.id);
        selectedUnits.push(selection.unit);
    });
    const affectedUnits = collectUnloadAffectedUnits(sourceState, selectedIds);
    const reallocation = restoreUnloadObstructionsLocally(sourceState, selectedUnits, affectedUnits);
    if (reallocation.error) return reallocation;
    const partialSelectionById = new Map(partialSelections.map((selection) => [selection.unit.item.id, selection]));
    const unloadedUnits = selectedUnits.map(({ item, locations }) => ({
        ...item,
        pieceCount: partialSelectionById.has(item.id)
            ? partialSelectionById.get(item.id).availablePieces - partialSelectionById.get(item.id).takenPieces
            : warehouseItemPieces(item),
        maxPieceCapacity: Math.max(warehouseItemPieces(item), Number(item.maxPieceCapacity) || warehouseItemPieces(item)),
        location: null,
        pairedLocation: null,
        tags: [...(item.tags || [])],
        inMovement: true,
        requiresWarehouseReturn: partialSelectionById.has(item.id),
        withdrawnPieceCount: partialSelectionById.get(item.id)?.takenPieces || 0,
        originalLocations: [...locations].sort((a, b) => a.localeCompare(b, "it", { numeric: true })),
        stagedAt: new Date().toISOString(),
    }));
    const metrics = estimateUnloadSelection(sourceState, selectedIds);
    const operationalSteps = buildUnloadOperationalSteps(sourceState, selectedUnits, reallocation.relocations);
    partialSelections.forEach((selection) => {
        const pieceStep = {
            kind: "piece-pick",
            from: [STAGING_AREA_LABEL],
            to: [STAGING_AREA_LABEL],
            units: [operationalUnit(selection.unit.item, selection.unit.locations[0], STAGING_AREA_LABEL)],
            pieceQuantity: selection.takenPieces,
            remainingPieces: selection.availablePieces - selection.takenPieces,
            requiresWarehouseReturn: true,
            wholeStack: false,
        };
        const unloadIndex = operationalSteps.findIndex((step) => step.kind === "unload"
            && step.units?.some((unit) => unit.id === selection.unit.item.id));
        let insertionIndex = unloadIndex >= 0 ? unloadIndex + 1 : operationalSteps.length;
        while (operationalSteps[insertionIndex]?.kind === "piece-pick") insertionIndex += 1;
        operationalSteps.splice(insertionIndex, 0, pieceStep);
    });
    operationalSteps.forEach((step, index) => { step.order = index + 1; });
    const lines = buildUnloadMovementLines(selectedUnits, reallocation.relocations);
    pieceSelections.filter((selection) => !selection.complete).forEach((selection) => lines.push({
        kind: "pieces",
        article: selection.unit.item.article,
        locations: [`${selection.unit.locations[0]} · ${selection.takenPieces} pezzi prelevati · ${selection.availablePieces - selection.takenPieces} residui`],
    }));
    return {
        state: reallocation.state,
        lines,
        operationalSteps,
        unloadedUnits,
        pickedPieces: pieceSelections.reduce((sum, selection) => sum + selection.takenPieces, 0),
        humanMovements: metrics.humanMovements + partialSelections.length,
        releasedStacks: metrics.releasedStacks,
        releasedModules: metrics.releasedModules,
        relocations: reallocation.relocations,
    };
}

function setManualMovementMessage(message, status = "") {
    const element = document.getElementById("manualMovementMessage");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", status === "error");
    element.classList.toggle("is-success", status === "success");
}

function manualDestinationError(location, customer) {
    const parsed = parseSlotCode(location);
    if (!parsed) return "Ubicazione inesistente o non compresa nella struttura configurata.";
    if (inventory.has(parsed.code)) return `${parsed.code} è già occupata.`;
    if (stateHasBlockingPallet(inventory, parsed)) return `${parsed.code} è bloccata da un pallet al piano terra.`;
    const restriction = evaluateCustomerForSlot(parsed.code, customer);
    if (!restriction.allowed) return restriction.reason || `${parsed.code} non ammette il cliente indicato.`;
    const lowerLevels = parsed.level === "c" ? ["a", "b"] : parsed.level === "b" ? ["a"] : [];
    if (!lowerLevels.every((level) => inventory.has(`${parsed.row}${parsed.number}${level}`))) {
        return `${parsed.code} non ha tutti i cassoni di appoggio nei livelli inferiori.`;
    }
    if (parsed.side === "front") {
        const rearNumber = parseSlotCode(slotCode(parsed.row, parsed.physicalColumn - 1, "rear", "a")).number;
        if (!["a", "b", "c"].every((level) => inventory.has(`${parsed.row}${rearNumber}${level}`))) {
            return `Prima di usare ${parsed.code}, la pila posteriore ${parsed.row}${rearNumber} deve essere completa.`;
        }
    }
    return "";
}

function refreshManualUnloadSource() {
    const field = document.getElementById("manualMovementLocation");
    const title = document.getElementById("manualUnloadSourceTitle");
    const details = document.getElementById("manualUnloadSourceDetails");
    if (!field || !title || !details || manualMovementMode !== "unload") return;
    const parsed = parseSlotCode(field.value);
    const item = parsed ? inventory.get(parsed.code) : null;
    if (!parsed) {
        title.textContent = "Nessuna ubicazione valida";
        details.textContent = "Inserisci una posizione esistente, ad esempio A2c.";
        return;
    }
    if (!item) {
        title.textContent = `${parsed.code} · Slot libero`;
        details.textContent = "Non esiste alcun cassone da prelevare in questa posizione.";
        return;
    }
    title.textContent = `${parsed.code} · ${item.article}`;
    details.textContent = `${item.type === "pallet" ? "Pallet" : "Cassone"} · ${item.customer || "Cliente non indicato"} · ${item.orderReference || "Rif. ordine non indicato"}${item.weighingCode ? ` · Pesata ${item.weighingCode}` : ""} · ${warehouseItemPieces(item)} pezzi`;
}

function configureManualMovement(mode) {
    manualMovementMode = mode === "unload" ? "unload" : "load";
    const loading = manualMovementMode === "load";
    const loadButton = document.getElementById("manualLoadMode");
    const unloadButton = document.getElementById("manualUnloadMode");
    loadButton?.classList.toggle("is-active", loading);
    unloadButton?.classList.toggle("is-active", !loading);
    loadButton?.setAttribute("aria-selected", String(loading));
    unloadButton?.setAttribute("aria-selected", String(!loading));
    document.getElementById("manualLoadFields").hidden = !loading;
    document.getElementById("manualUnloadSource").hidden = loading;
    document.getElementById("manualLoadArticle").required = loading;
    document.getElementById("manualLoadPieces").required = loading;
    document.getElementById("manualMovementLocationHint").textContent = loading
        ? "Indica lo slot libero in cui forzare il nuovo cassone."
        : "Indica la posizione esatta del cassone da prelevare.";
    document.getElementById("executeManualMovement").textContent = loading
        ? "Esegui carico manuale"
        : "Esegui scarico manuale";
    setManualMovementMessage(loading
        ? "La posizione verrà convalidata rispetto a struttura fisica, pallet e vincoli cliente."
        : "Verrà prelevato soltanto il cassone indicato; gli eventuali ingombri saranno riallocati e mostrati nelle istruzioni.");
    refreshManualUnloadSource();
}

function resetManualMovementResult() {
    document.getElementById("manualMovementForm").hidden = false;
    document.getElementById("manualMovementResult").hidden = true;
    setManualMovementMessage("L'operazione verrà convalidata rispetto a struttura fisica, pallet e vincoli cliente.");
}

function openManualMovementDialog(mode = "load", location = "") {
    if (!isWarehouseLoggedIn()) {
        openWarehouseLogin();
        return;
    }
    if (!warehousePersistenceReady) {
        showWarehouseToast("Database del magazzino non disponibile.", true);
        return;
    }
    document.getElementById("manualMovementForm")?.reset();
    resetManualMovementResult();
    configureManualMovement(mode);
    const field = document.getElementById("manualMovementLocation");
    field.value = parseSlotCode(location)?.code || String(location || "").trim().toUpperCase();
    refreshManualUnloadSource();
    const dialog = document.getElementById("manualMovementDialog");
    openWarehouseDialog(dialog, field, true);
}

function closeManualMovementDialog() {
    closeWarehouseDialog(document.getElementById("manualMovementDialog"));
}

async function commitManualLoad() {
    const beforeState = serializeWarehouseInventory();
    const location = parseSlotCode(document.getElementById("manualMovementLocation").value)?.code || "";
    const article = document.getElementById("manualLoadArticle").value.trim();
    const customer = document.getElementById("manualLoadCustomer").value.trim();
    const orderReference = document.getElementById("manualLoadOrder").value.trim();
    const weighingCode = document.getElementById("manualLoadWeighing").value.trim().toUpperCase();
    const pieceCount = Number(document.getElementById("manualLoadPieces").value);
    if (!article) return { error: "Indica l'articolo del cassone da caricare." };
    if (!Number.isInteger(pieceCount) || pieceCount < 1) return { error: "Il numero pezzi è obbligatorio e deve essere un intero positivo." };
    if (weighingCode && logicalInventoryUnits(inventory).some((unit) => normalizeCustomer(unit.item.weighingCode) === weighingCode)) {
        return { error: `Il codice pesata ${weighingCode} è già assegnato a un altro cassone.` };
    }
    const error = manualDestinationError(location, customer);
    if (error) return { error };
    const now = new Date();
    const state = cloneInventoryState();
    state.set(location, {
        id: `MANUAL-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        location,
        article,
        customer,
        orderReference,
        weighingCode,
        pieceCount,
        maxPieceCapacity: pieceCount,
        tags: [],
        inMovement: false,
        type: "crate",
        pairedLocation: null,
        receivedAt: now.toISOString(),
    });
    const afterState = Array.from(state.values()).map((item) => ({ ...item, tags: [...(item.tags || [])] }));
    const lines = [{ kind: "loaded", article, locations: [location] }];
    const movement = {
        id: movementIdentifier(now),
        timestamp: now.toISOString(),
        type: "load",
        manual: true,
        actor: warehouseActorSnapshot(),
        lines,
        beforeState: cloneWarehouseRows(beforeState),
        afterState: cloneWarehouseRows(afterState),
        changes: buildMovementChanges(beforeState, afterState),
    };
    try {
        await persistWarehouseData(afterState, [movement, ...serializeWarehouseMovements()], cloneUnloadZoneUnits());
    } catch (persistenceError) {
        return { error: `Carico manuale non applicato: ${persistenceError.message}` };
    }
    inventory.clear();
    state.forEach((item, code) => inventory.set(code, item));
    movementHistory.unshift(movement);
    return {
        lines,
        movement,
        message: `${movement.id}: il cassone ${article} è stato caricato in ${location}.`,
    };
}

async function commitManualUnload() {
    const beforeState = serializeWarehouseInventory();
    const parsed = parseSlotCode(document.getElementById("manualMovementLocation").value);
    if (!parsed) return { error: "Ubicazione inesistente o non compresa nella struttura configurata." };
    const item = inventory.get(parsed.code);
    if (!item) return { error: `${parsed.code} è libero: non c'è alcun cassone da prelevare.` };
    if (item.type !== "crate") return { error: "Lo scarico manuale puntuale è disponibile per ora soltanto per i cassoni." };
    const plan = planUnloadOperation([{
        article: item.article,
        customer: item.customer,
        order: item.orderReference,
        quantity: 1,
        type: "crate",
        sourceIds: [item.id],
    }]);
    if (plan.error) return plan;
    const stagedAt = new Date().toISOString();
    const stagedUnits = (plan.unloadedUnits || []).map((unit) => ({ ...unit, stagedAt }));
    const afterState = Array.from(plan.state.values()).map((unit) => ({ ...unit, tags: [...(unit.tags || [])] }));
    const nextUnloadZone = [...cloneUnloadZoneUnits(), ...cloneUnloadZoneUnits(stagedUnits)];
    const now = new Date(stagedAt);
    const movement = {
        id: movementIdentifier(now),
        timestamp: stagedAt,
        type: "unload",
        manual: true,
        actor: warehouseActorSnapshot(),
        lines: plan.lines,
        operationalSteps: plan.operationalSteps || [],
        beforeState: cloneWarehouseRows(beforeState),
        afterState: cloneWarehouseRows(afterState),
        changes: buildMovementChanges(beforeState, afterState),
    };
    try {
        await persistWarehouseData(afterState, [movement, ...serializeWarehouseMovements()], nextUnloadZone);
    } catch (persistenceError) {
        return { error: `Scarico manuale non applicato: ${persistenceError.message}` };
    }
    inventory.clear();
    plan.state.forEach((unit, code) => inventory.set(code, unit));
    unloadZone.splice(0, unloadZone.length, ...nextUnloadZone);
    movementHistory.unshift(movement);
    return {
        lines: plan.lines,
        operationalSteps: plan.operationalSteps || [],
        movement,
        message: `${movement.id}: ${item.article} è stato prelevato da ${parsed.code} e portato in ${STAGING_AREA_LABEL}.${plan.relocations?.length ? ` ${plan.relocations.length} riallocazioni necessarie.` : ""}`,
    };
}

async function executeManualMovement() {
    const result = manualMovementMode === "load" ? await commitManualLoad() : await commitManualUnload();
    if (result.error) {
        setManualMovementMessage(result.error, "error");
        return;
    }
    refreshWarehouseDataViews();
    document.getElementById("manualMovementForm").hidden = true;
    document.getElementById("manualMovementResult").hidden = false;
    document.getElementById("manualMovementResultText").textContent = `${result.message} Il movimento è stato registrato come operazione manuale.`;
    appendMovementLines(document.getElementById("manualMovementResultLines"), result);
}

function setupManualMovement() {
    document.getElementById("openManualMovementButton")?.addEventListener("click", () => openManualMovementDialog("load"));
    document.getElementById("closeManualMovement")?.addEventListener("click", closeManualMovementDialog);
    document.getElementById("cancelManualMovement")?.addEventListener("click", closeManualMovementDialog);
    document.getElementById("finishManualMovement")?.addEventListener("click", closeManualMovementDialog);
    document.getElementById("newManualMovement")?.addEventListener("click", () => {
        document.getElementById("manualMovementForm").reset();
        resetManualMovementResult();
        configureManualMovement(manualMovementMode);
        void focusWarehouseElement(document.getElementById("manualMovementLocation"), true);
    });
    document.getElementById("manualLoadMode")?.addEventListener("click", () => configureManualMovement("load"));
    document.getElementById("manualUnloadMode")?.addEventListener("click", () => configureManualMovement("unload"));
    document.getElementById("manualMovementLocation")?.addEventListener("input", refreshManualUnloadSource);
    document.getElementById("manualMovementLocation")?.addEventListener("blur", (event) => {
        const parsed = parseSlotCode(event.currentTarget.value);
        if (parsed) event.currentTarget.value = parsed.code;
        refreshManualUnloadSource();
    });
    document.getElementById("manualMovementForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = document.getElementById("executeManualMovement");
        button.disabled = true;
        setManualMovementMessage("Convalida e salvataggio dell'operazione in corso…");
        await executeManualMovement();
        button.disabled = false;
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.getElementById("manualMovementDialog")?.classList.contains("is-open")) {
            closeManualMovementDialog();
        }
    });
}

function movementIdentifier(date) {
    const part = (value) => String(value).padStart(2, "0");
    const base = `MV_${part(date.getFullYear() % 100)}-${part(date.getMonth() + 1)}-${part(date.getDate())}_${part(date.getHours())}:${part(date.getMinutes())}`;
    const duplicates = movementHistory.filter((movement) => movement.id === base || movement.id.startsWith(`${base}_`)).length;
    return duplicates ? `${base}_${part(duplicates + 1)}` : base;
}

function operationPlanKey() {
    return JSON.stringify({
        mode: operationGroupMode,
        revision: warehouseRevision,
        entries: activeOperationGroup().map((entry) => ({
            article: entry.article,
            customer: entry.customer,
            order: entry.order,
            weighingCode: entry.weighingCode || "",
            pieceCount: entry.pieceCount || null,
            requestedPieces: entry.requestedPieces || null,
            quantity: entry.quantity,
            type: entry.type,
            sourceIds: [...(entry.sourceIds || [])].sort(),
        })),
    });
}

async function prepareOperationReview() {
    const note = document.getElementById("operationReviewNote");
    const button = document.getElementById("reviewOperationGroup");
    button.disabled = true;
    setOperationStage("review");
    note.classList.remove("is-error");
    note.textContent = operationGroupMode === "load"
        ? "Calcolo congiunto dell'intero gruppo in corso…"
        : "Calcolo FIFO del gruppo di scarico in corso…";
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const key = operationPlanKey();
    const startedAt = performance.now();
    const plan = operationGroupMode === "load"
        ? planLoadOperation(activeOperationGroup())
        : planUnloadOperation(activeOperationGroup());
    const elapsed = performance.now() - startedAt;
    button.disabled = false;
    if (plan.error) {
        operationPreviewPlan = null;
        note.textContent = plan.error;
        note.classList.add("is-error");
        return;
    }
    operationPreviewPlan = { key, plan };
    appendMovementLines(document.getElementById("operationReviewList"), plan);
    note.textContent = operationGroupMode === "load"
        ? `Proposta congiunta calcolata su ${activeOperationGroup().length} ${activeOperationGroup().length === 1 ? "riga" : "righe"} in ${Math.round(elapsed)} ms · score ${Math.round(plan.score || 0)}. Il magazzino non è ancora stato modificato.`
        : `Proposta FIFO calcolata in ${Math.round(elapsed)} ms · ${plan.operationalSteps?.length || 0} istruzioni operative ordinate · ${plan.humanMovements} movimentazioni stimate · ${plan.releasedStacks} pile e ${plan.releasedModules} coppie liberate. Il magazzino non è ancora stato modificato.`;
}

function finalizeLoadPlanIdentity(plan, timestamp) {
    const existingIds = new Set(Array.from(inventory.values(), (item) => item.id));
    const replacementIds = new Map();
    let sequence = 0;
    const state = new Map();
    plan.state.forEach((item, location) => {
        if (existingIds.has(item.id)) {
            state.set(location, item);
            return;
        }
        if (!replacementIds.has(item.id)) {
            replacementIds.set(item.id, {
                id: `AUTO-${timestamp.getTime()}-${sequence}`,
                receivedAt: timestamp.toISOString(),
            });
            sequence += 1;
        }
        state.set(location, { ...item, ...replacementIds.get(item.id), tags: [...(item.tags || [])] });
    });
    return { ...plan, state };
}

async function commitOperationGroup() {
    if (!isWarehouseLoggedIn()) {
        openWarehouseLogin();
        return { error: "Effettua il login operatore prima di confermare il movimento." };
    }
    const beforeState = serializeWarehouseInventory();
    const key = operationPlanKey();
    let plan = operationPreviewPlan?.key === key
        ? operationPreviewPlan.plan
        : operationGroupMode === "load"
          ? planLoadOperation(activeOperationGroup())
          : planUnloadOperation(activeOperationGroup());
    if (plan.error) return plan;
    const now = new Date();
    if (operationGroupMode === "load") plan = finalizeLoadPlanIdentity(plan, now);
    else plan = {
        ...plan,
        unloadedUnits: (plan.unloadedUnits || []).map((item) => ({ ...item, stagedAt: now.toISOString() })),
    };
    const afterState = Array.from(plan.state.values()).map((item) => ({ ...item, tags: [...(item.tags || [])] }));
    const movement = {
        id: movementIdentifier(now),
        timestamp: now.toISOString(),
        type: operationGroupMode,
        actor: warehouseActorSnapshot(),
        lines: plan.lines,
        operationalSteps: plan.operationalSteps || [],
        beforeState: cloneWarehouseRows(beforeState),
        afterState: cloneWarehouseRows(afterState),
        changes: buildMovementChanges(beforeState, afterState),
    };
    const nextUnloadZone = operationGroupMode === "unload"
        ? [...cloneUnloadZoneUnits(), ...cloneUnloadZoneUnits(plan.unloadedUnits)]
        : cloneUnloadZoneUnits();
    try {
        await persistWarehouseData(
            afterState,
            [movement, ...serializeWarehouseMovements()],
            nextUnloadZone,
        );
    } catch (error) {
        return { error: `Operazione non applicata: ${error.message}` };
    }
    inventory.clear();
    plan.state.forEach((item, location) => inventory.set(location, item));
    movementHistory.unshift(movement);
    unloadZone.splice(0, unloadZone.length, ...nextUnloadZone);
    completedOperationMovement = movement;
    operationPreviewPlan = null;
    renderMovementHistory();
    refreshInventorySearch();
    renderDetails();
    updateSummary();
    renderUnloadZone();
    if (!document.getElementById("analysisView")?.hidden) renderAnalysisTable();
    return { movement };
}

function appendMovementLines(container, movement) {
    container.replaceChildren();
    if (movement.operationalSteps?.length) {
        movement.operationalSteps.forEach((step, index) => {
            const row = document.createElement("article");
            row.className = "movement-line movement-line--operational";
            const number = document.createElement("b");
            number.textContent = `${index + 1}`;
            const content = document.createElement("div");
            const title = document.createElement("strong");
            const source = italianLocationList(step.from || []);
            const destination = italianLocationList(step.to || []);
            if (["optimization-corridor", "optimization-stage", "optimization-place"].includes(step.kind)) {
                title.textContent = optimizationStepTitle(step);
            } else if (step.kind === "corridor") {
                title.textContent = step.wholeStack
                    ? `Sposta temporaneamente l'intera pila ${source} nel corridoio`
                    : `Sposta temporaneamente ${crateWording(step.from?.length || 0)} ${source} nel corridoio`;
            } else if (step.kind === "unload") {
                const pallet = step.units?.length === 1 && step.units[0].type === "pallet";
                title.textContent = pallet
                    ? `Preleva il pallet ${source} e posizionalo in ${STAGING_AREA_LABEL}`
                    : `Preleva ${crateWording(step.from?.length || 0)} ${source} e ${step.from?.length === 1 ? "posizionalo" : "posizionali"} in ${STAGING_AREA_LABEL}`;
            } else if (step.kind === "piece-pick") {
                const origin = step.units?.[0]?.from || source;
                title.textContent = source === STAGING_AREA_LABEL
                    ? `In ${STAGING_AREA_LABEL}, preleva ${step.pieceQuantity} pezzi dal cassone proveniente da ${origin} · residuo ${step.remainingPieces} pezzi da rimettere a magazzino`
                    : source === "Corridoio"
                    ? `Dal cassone proveniente da ${origin}, nel corridoio, preleva ${step.pieceQuantity} pezzi · residuo ${step.remainingPieces} pezzi`
                    : `Preleva ${step.pieceQuantity} pezzi dal cassone ${source} · residuo ${step.remainingPieces} pezzi`;
            } else {
                const origin = italianLocationList(step.units?.map((unit) => unit.from) || []);
                title.textContent = step.wholeStack
                    ? `Ricolloca insieme dal corridoio la pila proveniente da ${origin} in ${destination}`
                    : step.units?.length === 1
                      ? `Ricolloca dal corridoio il cassone proveniente da ${origin} in ${destination}`
                      : `Ricolloca dal corridoio ${crateWording(step.to?.length || 0)} in ${destination}`;
            }
            const details = operationalUnitsDetail(step);
            content.append(title, details);
            row.append(number, content);
            container.appendChild(row);
        });
        return;
    }
    movement.lines.forEach((line) => {
        const row = document.createElement("article");
        row.className = "movement-line";
        const title = document.createElement("strong");
        title.textContent = line.kind === "unloaded"
            ? `Preleva articolo ${line.article}`
            : line.kind === "pieces"
              ? `Preleva pezzi articolo ${line.article}`
            : line.kind === "relocated"
              ? `Rialloca articolo ${line.article}`
              : line.kind === "loaded"
                ? `Carica articolo ${line.article}`
                : `Articolo ${line.article}`;
        const locations = document.createElement("p");
        const logistics = [line.weighingCode ? `pesata ${line.weighingCode}` : "", line.pieceCount ? `${line.pieceCount} pezzi` : ""].filter(Boolean);
        locations.textContent = `${line.kind === "relocated" ? "Spostamenti" : line.kind === "unloaded" ? "Preleva da" : line.kind === "pieces" ? "Dettaglio" : line.kind === "loaded" ? "Carica in" : "Posizioni"} ${line.locations.join(", ")}${logistics.length ? ` · ${logistics.join(" · ")}` : ""}`;
        row.append(title, locations);
        container.appendChild(row);
    });
}

function italianLocationList(locations) {
    const values = (locations || []).filter(Boolean);
    if (values.length < 2) return values[0] || "";
    return `${values.slice(0, -1).join(", ")} e ${values[values.length - 1]}`;
}

function crateWording(quantity) {
    return quantity === 1 ? "il cassone" : `i ${quantity} cassoni`;
}

function operationalUnitRoute(step, unit) {
    if (["corridor", "optimization-corridor", "optimization-stage"].includes(step.kind)) {
        return `${unit.from || italianLocationList(step.from)} → CORRIDOIO${unit.to ? ` → ${unit.to}` : ""}`;
    }
    if (["reinsert", "optimization-place"].includes(step.kind)) {
        return `CORRIDOIO → ${unit.to || italianLocationList(step.to)}`;
    }
    if (step.kind === "unload") return `${unit.from || italianLocationList(step.from)} → ${STAGING_AREA_LABEL.toUpperCase()}`;
    if (step.kind === "piece-pick") {
        const source = step.from?.[0] === STAGING_AREA_LABEL
            ? STAGING_AREA_LABEL.toUpperCase()
            : step.from?.[0] === "Corridoio" ? "CORRIDOIO" : unit.from;
        return `${source} · PRELIEVO ${step.pieceQuantity} PZ · RESIDUO ${step.remainingPieces} PZ`;
    }
    return `${unit.from || italianLocationList(step.from)} → ${unit.to || italianLocationList(step.to)}`;
}

function operationalUnitsDetail(step) {
    const list = document.createElement("div");
    list.className = `movement-unit-list movement-unit-list--${step.kind}`;
    (step.units || []).forEach((unit) => {
        const row = document.createElement("div");
        row.className = "movement-unit-detail";
        const identity = document.createElement("span");
        identity.className = "movement-unit-identity";
        identity.textContent = unit.weighingCode
            ? `PESATA ${unit.weighingCode}`
            : `${unit.type === "pallet" ? "PALLET" : "CASSONE"} DA ${unit.from || "—"}`;
        const route = document.createElement("b");
        route.className = "movement-unit-route";
        route.textContent = operationalUnitRoute(step, unit);
        const metadata = document.createElement("small");
        metadata.textContent = [
            `articolo ${unit.article || "—"}`,
            `cliente ${unit.customer || "—"}`,
            `ordine ${unit.orderReference || "—"}`,
            `${unit.pieceCount || 0} pezzi`,
        ].join(" · ");
        row.append(identity, route, metadata);
        list.appendChild(row);
    });
    if (!list.childElementCount) {
        const fallback = document.createElement("p");
        fallback.textContent = operationalUnitsDescription(step.units || []);
        list.appendChild(fallback);
    }
    return list;
}

function operationalUnitsDescription(units) {
    if (!units.length) return "";
    const signature = (unit) => `${unit.article}|${unit.customer}|${unit.orderReference}|${unit.weighingCode}|${unit.pieceCount}`;
    const allEqual = units.every((unit) => signature(unit) === signature(units[0]));
    const describe = (unit) => [
        `articolo ${unit.article || "—"}`,
        `cliente ${unit.customer || "—"}`,
        `ordine ${unit.orderReference || "—"}`,
        unit.weighingCode ? `pesata ${unit.weighingCode}` : "",
        `${unit.pieceCount || 0} pezzi`,
    ].filter(Boolean).join(" · ");
    if (allEqual) return describe(units[0]);
    return units.map((unit) => `${unit.from}: ${describe(unit)}`).join("; ");
}

function renderMovementHistory() {
    const count = document.getElementById("movementHistoryCount");
    if (count) count.textContent = movementHistory.length
        ? `${movementHistory.length} ${movementHistory.length === 1 ? "movimento registrato" : "movimenti registrati"}`
        : "Nessun movimento registrato";
    const list = document.getElementById("movementHistoryList");
    if (!list) return;
    list.replaceChildren();
    if (!movementHistory.length) {
        const empty = document.createElement("p");
        empty.className = "movement-history-empty";
        empty.textContent = "Lo storico si popolerà completando un carico, uno scarico o un'ottimizzazione globale.";
        list.appendChild(empty);
        return;
    }
    movementHistory.forEach((movement) => {
        const card = document.createElement("article");
        card.className = "movement-history-card";
        card.dataset.movementId = movement.id;
        card.tabIndex = 0;
        const header = document.createElement("header");
        const heading = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = movement.id;
        const date = document.createElement("small");
        date.textContent = new Date(movement.timestamp).toLocaleString("it-IT");
        heading.append(title, date);
        const badge = document.createElement("span");
        badge.textContent = movement.optimization
            ? "Ottimizzazione"
            : `${movement.type === "load" ? "Carico" : "Scarico"}${movement.manual ? " manuale" : ""}`;
        header.append(heading, badge);
        const lines = document.createElement("div");
        lines.className = "movement-history-card__lines";
        if (movement.optimization) {
            const summary = document.createElement("article");
            summary.className = "movement-line";
            const heading = document.createElement("strong");
            heading.textContent = "Riassetto globale del magazzino";
            const details = document.createElement("p");
            details.textContent = `${movement.operationalSteps?.length || 0} spostamenti · ${movement.changes?.shifted?.length || 0} unità con nuova ubicazione`;
            summary.append(heading, details);
            lines.appendChild(summary);
        } else {
            appendMovementLines(lines, movement);
        }
        const actor = document.createElement("p");
        actor.className = "movement-history-card__actor";
        const actorName = movement.actor?.displayName || movement.actor?.employee || movement.actor?.adminName || "Operatore non registrato";
        actor.textContent = `Operatore: ${actorName}${movement.actor?.department ? ` · ${movement.actor.department}` : ""}`;
        card.append(header, actor, lines);
        card.addEventListener("click", () => highlightMovementOnMap(movement));
        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                highlightMovementOnMap(movement);
            }
        });
        card.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            openMovementContextMenu(movement, event.clientX, event.clientY);
        });
        list.appendChild(card);
    });
}

function closeMovementContextMenu() {
    contextMovementId = null;
    const menu = document.getElementById("movementContextMenu");
    menu?.classList.remove("is-open");
    menu?.setAttribute("aria-hidden", "true");
}

function openMovementContextMenu(movement, x, y) {
    contextMovementId = movement.id;
    const menu = document.getElementById("movementContextMenu");
    if (!menu) return;
    document.getElementById("movementContextTitle").textContent = movement.id;
    menu.classList.add("is-open");
    menu.setAttribute("aria-hidden", "false");
    const width = 220;
    const height = 78;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
}

function highlightMovementOnMap(movement) {
    const loaded = movement.changes?.loaded || [];
    const shifted = movement.changes?.shifted || [];
    const fallbackLocations = movement.type === "load" && !movement.changes
        ? movement.lines.flatMap((line) => line.locations || []).filter((location) => parseSlotCode(location))
        : [];
    movementHighlight = {
        loadedIds: new Set(loaded.map((entry) => entry.id)),
        loadedLocations: new Set([...loaded.flatMap((entry) => entry.to || []), ...fallbackLocations]),
        shiftedIds: new Set(shifted.map((entry) => entry.id)),
        shiftedLocations: new Set(shifted.flatMap((entry) => entry.to || [])),
    };
    const currentLocations = [];
    inventory.forEach((item, location) => {
        if (movementHighlight.loadedIds.has(item.id) || movementHighlight.shiftedIds.has(item.id)
            || movementHighlight.loadedLocations.has(location) || movementHighlight.shiftedLocations.has(location)) currentLocations.push(location);
    });
    const first = currentLocations.sort((a, b) => a.localeCompare(b, "it", { numeric: true }))[0]
        || [...movementHighlight.loadedLocations, ...movementHighlight.shiftedLocations][0];
    const parsed = parseSlotCode(first);
    if (parsed) {
        selectedRow = parsed.row;
        const half = Math.ceil(physicalColumnsForRow(parsed.row) / 2) * 2;
        if (slotRangeMode === "paged") slotPage = parsed.number <= half ? 0 : 1;
    }
    closeMovementHistoryDialog();
    setActiveView("warehouse");
    renderTabs();
    renderMap();
    if (movementHighlightTimer) window.clearTimeout(movementHighlightTimer);
    movementHighlightTimer = window.setTimeout(() => {
        movementHighlight = null;
        renderTabs();
        renderMap();
    }, 8000);
    showWarehouseToast(`${movement.id}: giallo = caricato, rosa = ricollocato. Evidenziazione attiva per 8 secondi.`);
}

function openMovementHistoryDialog() {
    closeToolsDrawer();
    renderMovementHistory();
    openWarehouseDialog(document.getElementById("movementHistoryDialog"), document.getElementById("closeMovementHistory"));
}

function closeMovementHistoryDialog() {
    closeWarehouseDialog(document.getElementById("movementHistoryDialog"));
}

function clearCompletedOperationGroup(closeDialog = false) {
    activeOperationGroup().splice(0);
    operationGroupStages[operationGroupMode] = "compose";
    completedOperationMovement = null;
    operationPreviewPlan = null;
    resetOperationLineForm();
    renderOperationGroup();
    setOperationStage("compose");
    if (closeDialog) closeOperationDialog();
    else void focusWarehouseElement(document.getElementById("loadArticle"), true);
}

function closeUnloadZoneContextMenu() {
    contextUnloadZoneUnitId = null;
    const menu = document.getElementById("unloadZoneContextMenu");
    menu?.classList.remove("is-open");
    menu?.setAttribute("aria-hidden", "true");
}

function openUnloadZoneContextMenu(item, x, y) {
    contextUnloadZoneUnitId = item.id;
    const menu = document.getElementById("unloadZoneContextMenu");
    if (!menu) return;
    document.getElementById("unloadZoneContextTitle").textContent = `${item.article} · ${item.id}`;
    const reload = document.getElementById("reloadUnloadZoneUnit");
    reload.disabled = warehouseStorageUnavailable || !isWarehouseLoggedIn();
    menu.classList.add("is-open");
    menu.setAttribute("aria-hidden", "false");
    const width = 230;
    const height = 78;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
}

function renderUnloadZone() {
    const count = document.getElementById("unloadZoneCount");
    if (count) count.textContent = String(unloadZone.length);
    const summary = document.getElementById("unloadZoneSummary");
    const returnRequired = unloadZone.filter((item) => item.requiresWarehouseReturn).length;
    const vehicleReady = unloadZone.length - returnRequired;
    if (summary) summary.textContent = unloadZone.length
        ? `${unloadZone.length} unità in lavorazione · ${vehicleReady} pronte per la Zona Scarico · ${returnRequired} da rimettere a magazzino`
        : "Zona vuota";
    const confirmButton = document.getElementById("confirmVehicleLoad");
    if (confirmButton) confirmButton.disabled = !vehicleReady || warehouseStorageUnavailable || !isWarehouseLoggedIn();
    const list = document.getElementById("unloadZoneList");
    if (!list) return;
    list.replaceChildren();
    if (!unloadZone.length) {
        const empty = document.createElement("p");
        empty.className = "unload-zone-empty";
        empty.textContent = `Le unità prelevate compariranno qui fino al rientro a magazzino o all'uscita verso la Zona Scarico.`;
        list.appendChild(empty);
        return;
    }
    unloadZone.forEach((item) => {
        const row = document.createElement("article");
        row.className = "unload-zone-row";
        row.dataset.unitId = item.id;
        row.tabIndex = 0;
        const values = [
            item.article || "—",
            item.customer || "—",
            item.orderReference || "—",
            `${item.type === "pallet" ? "Pallet" : "Cassone"} · ${warehouseItemPieces(item)} pezzi${item.weighingCode ? ` · ${item.weighingCode}` : ""}`,
            (item.originalLocations || []).join(" + ") || "—",
            item.requiresWarehouseReturn ? "Rientro necessario" : "Pronto per Zona Scarico",
        ];
        values.forEach((value, index) => {
            const cell = document.createElement(index === 0 ? "strong" : "span");
            cell.textContent = value;
            if (index === 5) cell.className = `unload-zone-status${item.requiresWarehouseReturn ? " is-return-required" : ""}`;
            row.appendChild(cell);
        });
        const actions = document.createElement("div");
        actions.className = "unload-zone-actions";
        const exitButton = document.createElement("button");
        exitButton.className = "unload-zone-exit";
        exitButton.type = "button";
        exitButton.textContent = "Zona Scarico";
        exitButton.disabled = item.requiresWarehouseReturn || warehouseStorageUnavailable || !isWarehouseLoggedIn();
        exitButton.title = item.requiresWarehouseReturn
            ? "Questo cassone contiene merce residua e deve rientrare a magazzino"
            : "Fai uscire definitivamente questa unità";
        exitButton.addEventListener("click", async (event) => {
            event.stopPropagation();
            await moveSingleUnitToUnloadArea(item.id);
        });
        const reloadButton = document.createElement("button");
        reloadButton.className = "unload-zone-reload";
        reloadButton.type = "button";
        reloadButton.textContent = "Prepara rientro";
        reloadButton.disabled = warehouseStorageUnavailable || !isWarehouseLoggedIn();
        reloadButton.addEventListener("click", (event) => {
            event.stopPropagation();
            openUnloadReloadDialog(item.id);
        });
        actions.append(exitButton, reloadButton);
        row.appendChild(actions);
        row.title = item.requiresWarehouseReturn
            ? "Questo cassone deve essere rimesso a magazzino"
            : "Scegli il rientro a magazzino oppure l'uscita definitiva verso la Zona Scarico";
        row.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            openUnloadZoneContextMenu(item, event.clientX, event.clientY);
        });
        list.appendChild(row);
    });
}

function openUnloadZoneDialog() {
    closeToolsDrawer();
    renderUnloadZone();
    openWarehouseDialog(document.getElementById("unloadZoneDialog"), document.getElementById("closeUnloadZone"));
}

function closeUnloadZoneDialog() {
    closeUnloadZoneContextMenu();
    closeWarehouseDialog(document.getElementById("unloadZoneDialog"));
}

function prepareUnloadZoneReload(unitId, overrides = {}) {
    if (!isWarehouseLoggedIn()) {
        openWarehouseLogin();
        return { error: "Effettua il login operatore prima di ricaricare la merce." };
    }
    const staged = unloadZone.find((item) => item.id === unitId);
    if (!staged) return { error: `L'unità selezionata non è più presente in ${STAGING_AREA_LABEL}.` };
    const pieceCount = overrides.pieceCount === undefined
        ? Math.max(1, Number(staged.pieceCount) || 1)
        : Number(overrides.pieceCount);
    if (!Number.isInteger(pieceCount) || pieceCount < 1) {
        return { error: "Il numero pezzi al rientro deve essere un intero positivo." };
    }
    const maximumPieceCapacity = Math.max(1, Number(staged.maxPieceCapacity) || Number(staged.pieceCount) || 1);
    if (pieceCount > maximumPieceCapacity) {
        return { error: `Il cassone può contenere al massimo ${maximumPieceCapacity} pezzi.` };
    }
    const weighingCode = overrides.weighingCode === undefined
        ? String(staged.weighingCode || "").trim()
        : String(overrides.weighingCode || "").trim();
    const normalizedWeighing = normalizeCustomer(weighingCode);
    const weighingAlreadyUsed = normalizedWeighing && (
        logicalInventoryUnits(inventory).some((unit) => normalizeCustomer(unit.item.weighingCode) === normalizedWeighing)
        || unloadZone.some((item) => item.id !== unitId && normalizeCustomer(item.weighingCode) === normalizedWeighing)
    );
    if (weighingAlreadyUsed) return { error: `Il codice pesata ${weighingCode} è già assegnato a un altro cassone.` };
    const beforeState = serializeWarehouseInventory();
    const entry = {
        article: staged.article,
        customer: staged.customer,
        order: staged.orderReference,
        weighingCode,
        pieceCount,
        quantity: 1,
        type: staged.type,
    };
    const plan = planLoadOperation([entry]);
    if (plan.error) return plan;
    const existingIds = new Set(beforeState.map((item) => item.id));
    const generatedIds = new Set(Array.from(plan.state.values())
        .filter((item) => !existingIds.has(item.id))
        .map((item) => item.id));
    const destinations = Array.from(plan.state.entries())
        .filter(([, item]) => generatedIds.has(item.id))
        .map(([location]) => location)
        .sort((left, right) => compareLocations({ location: left }, { location: right }));
    if (!destinations.length) return { error: "Il sistema non ha prodotto una destinazione valida." };
    Array.from(plan.state.entries()).forEach(([location, item]) => {
        if (generatedIds.has(item.id)) plan.state.delete(location);
    });
    const {
        originalLocations: _originalLocations,
        stagedAt: _stagedAt,
        requiresWarehouseReturn: _requiresWarehouseReturn,
        withdrawnPieceCount: _withdrawnPieceCount,
        ...warehouseItem
    } = staged;
    destinations.forEach((location, index) => {
        plan.state.set(location, {
            ...warehouseItem,
            id: staged.id,
            location,
            weighingCode,
            pieceCount,
            maxPieceCapacity: maximumPieceCapacity,
            pairedLocation: staged.type === "pallet" ? destinations[index === 0 ? 1 : 0] || null : null,
            tags: [...(staged.tags || [])],
            inMovement: false,
        });
    });
    const now = new Date();
    const afterState = Array.from(plan.state.values()).map((item) => ({ ...item, tags: [...(item.tags || [])] }));
    const movement = {
        id: movementIdentifier(now),
        timestamp: now.toISOString(),
        type: "load",
        actor: warehouseActorSnapshot(),
        lines: [{
            article: staged.article,
            locations: staged.type === "pallet" ? [destinations.join(" + ")] : destinations,
            weighingCode,
            pieceCount,
        }],
        beforeState: cloneWarehouseRows(beforeState),
        afterState: cloneWarehouseRows(afterState),
        changes: buildMovementChanges(beforeState, afterState),
    };
    const nextUnloadZone = unloadZone.filter((item) => item.id !== unitId);
    return { staged, plan, destinations, afterState, movement, nextUnloadZone, weighingCode, pieceCount };
}

function closeUnloadReloadDialog() {
    unloadZoneReloadPreview = null;
    closeWarehouseDialog(document.getElementById("unloadReloadDialog"));
}

function unloadReloadFormValues() {
    return {
        weighingCode: document.getElementById("unloadReloadWeighing")?.value || "",
        pieceCount: document.getElementById("unloadReloadPieces")?.value || "",
    };
}

function refreshUnloadReloadPreview(unitId, overrides = unloadReloadFormValues()) {
    const preview = prepareUnloadZoneReload(unitId, overrides);
    const destination = document.getElementById("unloadReloadDestination");
    const message = document.getElementById("unloadReloadMessage");
    message.classList.toggle("is-error", Boolean(preview.error));
    if (preview.error) {
        destination.textContent = "Destinazione non disponibile";
        message.textContent = preview.error;
        document.getElementById("confirmUnloadReload").disabled = true;
        return preview;
    }
    unloadZoneReloadPreview = {
        unitId,
        revision: warehouseRevision,
        destinations: [...preview.destinations],
        weighingCode: preview.weighingCode,
        pieceCount: preview.pieceCount,
    };
    destination.textContent = preview.destinations.join(" + ");
    message.textContent = "Anteprima soltanto: quantità, pesata e destinazione saranno applicate esclusivamente alla conferma.";
    document.getElementById("confirmUnloadReload").disabled = false;
    return preview;
}

function openUnloadReloadDialog(unitId) {
    const staged = unloadZone.find((item) => item.id === unitId);
    if (!staged) {
        showWarehouseToast(`L'unità selezionata non è più presente in ${STAGING_AREA_LABEL}.`, true);
        return;
    }
    document.getElementById("unloadReloadWeighing").value = staged.weighingCode || "";
    const piecesInput = document.getElementById("unloadReloadPieces");
    piecesInput.value = String(Math.max(1, Number(staged.pieceCount) || 1));
    piecesInput.max = String(Math.max(1, Number(staged.maxPieceCapacity) || Number(staged.pieceCount) || 1));
    const preview = refreshUnloadReloadPreview(unitId);
    if (preview.error) {
        showWarehouseToast(preview.error, true);
    }
    document.getElementById("unloadReloadArticle").textContent = staged.article || "—";
    document.getElementById("unloadReloadCustomer").textContent = staged.customer || "—";
    document.getElementById("unloadReloadOrder").textContent = staged.orderReference || "—";
    document.getElementById("unloadReloadOrigin").textContent = (staged.originalLocations || []).join(" + ") || "—";
    openWarehouseDialog(document.getElementById("unloadReloadDialog"), document.getElementById("unloadReloadWeighing"), true);
}

async function reloadUnloadZoneUnit(unitId, overrides = {}) {
    const prepared = prepareUnloadZoneReload(unitId, overrides);
    if (prepared.error) return prepared;
    const { plan, afterState, movement, nextUnloadZone } = prepared;
    try {
        await persistWarehouseData(afterState, [movement, ...serializeWarehouseMovements()], nextUnloadZone);
    } catch (error) {
        return { error: `Ricarico non applicato: ${error.message}` };
    }
    inventory.clear();
    plan.state.forEach((item, location) => inventory.set(location, item));
    movementHistory.unshift(movement);
    unloadZone.splice(0, unloadZone.length, ...nextUnloadZone);
    renderMovementHistory();
    renderUnloadZone();
    refreshInventorySearch();
    renderDetails();
    updateSummary();
    if (!document.getElementById("analysisView")?.hidden) renderAnalysisTable();
    return { movement, destinations: prepared.destinations };
}

async function moveSingleUnitToUnloadArea(unitId) {
    const item = unloadZone.find((unit) => unit.id === unitId);
    if (!item) {
        showWarehouseToast(`L'unità selezionata non è più presente in ${STAGING_AREA_LABEL}.`, true);
        return;
    }
    if (item.requiresWarehouseReturn) {
        showWarehouseToast("Il cassone contiene merce residua e deve essere rimesso a magazzino.", true);
        return;
    }
    if (!isWarehouseLoggedIn()) {
        openWarehouseLogin();
        return;
    }
    const identity = item.weighingCode ? `pesata ${item.weighingCode}` : `proveniente da ${(item.originalLocations || []).join(" + ") || "ubicazione non indicata"}`;
    if (!await showWarehouseConfirm({
        title: "Sposta in Zona Scarico",
        message: `Confermare l'uscita definitiva dell'articolo ${item.article}, ${identity}? L'unità verrà rimossa da ${STAGING_AREA_LABEL}.`,
        confirmLabel: "Sposta in Zona Scarico",
        danger: true,
    })) return;
    const nextUnloadZone = unloadZone.filter((unit) => unit.id !== unitId);
    try {
        await persistWarehouseData(serializeWarehouseInventory(), serializeWarehouseMovements(), cloneUnloadZoneUnits(nextUnloadZone));
        unloadZone.splice(0, unloadZone.length, ...nextUnloadZone);
        renderUnloadZone();
        showWarehouseToast(`Articolo ${item.article}: uscita definitiva verso la Zona Scarico registrata.`);
    } catch (error) {
        showWarehouseToast(`Uscita non salvata: ${error.message}`, true);
        renderUnloadZone();
    }
}

async function confirmVehicleLoad() {
    const vehicleUnits = unloadZone.filter((item) => !item.requiresWarehouseReturn);
    const returnUnits = unloadZone.filter((item) => item.requiresWarehouseReturn);
    if (!vehicleUnits.length) return;
    if (!isWarehouseLoggedIn()) {
        openWarehouseLogin();
        return;
    }
    const quantity = vehicleUnits.length;
    if (!await showWarehouseConfirm({
        title: "Sposta tutti in Zona Scarico",
        message: `Confermare l'uscita definitiva verso la Zona Scarico di ${quantity} ${quantity === 1 ? "unità" : "unità"}?${returnUnits.length ? ` I ${returnUnits.length} cassoni con rientro necessario resteranno in ${STAGING_AREA_LABEL}.` : ""}`,
        confirmLabel: "Sposta tutti",
        danger: true,
    })) return;
    const button = document.getElementById("confirmVehicleLoad");
    button.disabled = true;
    try {
        await persistWarehouseData(serializeWarehouseInventory(), serializeWarehouseMovements(), cloneUnloadZoneUnits(returnUnits));
        unloadZone.splice(0, unloadZone.length, ...returnUnits);
        renderUnloadZone();
        showWarehouseToast(`Zona Scarico: ${quantity} ${quantity === 1 ? "unità uscita" : "unità uscite"} definitivamente.${returnUnits.length ? ` ${returnUnits.length} da rimettere a magazzino restano in lavorazione.` : ""}`);
    } catch (error) {
        showWarehouseToast(`Conferma non salvata: ${error.message}`, true);
        renderUnloadZone();
    }
}

function setupUnloadZone() {
    let reloadPreviewTimer = null;
    document.getElementById("openUnloadZoneButton")?.addEventListener("click", openUnloadZoneDialog);
    document.getElementById("closeUnloadZone")?.addEventListener("click", closeUnloadZoneDialog);
    document.getElementById("reloadUnloadZoneUnit")?.addEventListener("click", async () => {
        const unitId = contextUnloadZoneUnitId;
        closeUnloadZoneContextMenu();
        if (!unitId) return;
        openUnloadReloadDialog(unitId);
    });
    document.getElementById("closeUnloadReload")?.addEventListener("click", closeUnloadReloadDialog);
    document.getElementById("cancelUnloadReload")?.addEventListener("click", closeUnloadReloadDialog);
    ["unloadReloadWeighing", "unloadReloadPieces"].forEach((id) => {
        document.getElementById(id)?.addEventListener("input", () => {
            if (!unloadZoneReloadPreview?.unitId) return;
            if (reloadPreviewTimer) window.clearTimeout(reloadPreviewTimer);
            reloadPreviewTimer = window.setTimeout(() => {
                const unitId = unloadZoneReloadPreview?.unitId;
                if (unitId) refreshUnloadReloadPreview(unitId);
            }, 180);
        });
    });
    document.getElementById("confirmUnloadReload")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const unitId = unloadZoneReloadPreview?.unitId;
        if (!unitId) return;
        button.disabled = true;
        const message = document.getElementById("unloadReloadMessage");
        message.classList.remove("is-error");
        message.textContent = "Salvataggio del rientro in corso…";
        const result = await reloadUnloadZoneUnit(unitId, unloadReloadFormValues());
        button.disabled = false;
        if (result.error) {
            message.textContent = result.error;
            message.classList.add("is-error");
            return;
        }
        closeUnloadReloadDialog();
        closeUnloadZoneDialog();
        highlightMovementOnMap(result.movement);
        showWarehouseToast(`${result.movement.id}: unità ricaricata in ${result.destinations.join(" + ")} ed evidenziata sulla mappa.`);
    });
    document.getElementById("confirmVehicleLoad")?.addEventListener("click", confirmVehicleLoad);
    document.addEventListener("pointerdown", (event) => {
        if (!event.target.closest?.("#unloadZoneContextMenu")) closeUnloadZoneContextMenu();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeUnloadZoneDialog();
    });
    renderUnloadZone();
}

function setupLoadDialog() {
    document.getElementById("openLoadButton")?.addEventListener("click", () => openOperationDialog("load"));
    document.getElementById("openUnloadButton")?.addEventListener("click", () => openOperationDialog("unload"));
    document.getElementById("closeOperationDialog")?.addEventListener("click", closeOperationDialog);
    document.getElementById("operationGroupDialog")?.addEventListener("pointerdown", (event) => {
        if (event.target.closest?.("input, select, textarea, button")) event.stopPropagation();
    });
    document.getElementById("loadType")?.addEventListener("change", () => {
        updateLoadTypeNote();
        updateLoadBatchRows();
    });
    document.getElementById("loadBatchCount")?.addEventListener("input", updateLoadBatchRows);
    document.getElementById("loadBatchCount")?.addEventListener("change", updateLoadBatchRows);
    document.getElementById("operationLineForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const article = document.getElementById("loadArticle").value.trim();
        const customer = document.getElementById("loadCustomer").value.trim();
        const order = document.getElementById("loadOrderReference").value.trim();
        const batchValues = loadBatchValues();
        const weighingCode = batchValues[0]?.weighingCode || "";
        const enteredPieces = batchValues[0]?.pieceCount;
        const type = document.getElementById("loadType").value;
        const previous = editingOperationLineIndex === null ? null : activeOperationGroup()[editingOperationLineIndex];
        const message = document.getElementById("loadFormMessage");
        if (operationGroupMode === "load") {
            const invalidPieces = batchValues.find((unit) => !Number.isInteger(unit.pieceCount) || unit.pieceCount < 1);
            if (invalidPieces) {
                message.textContent = `Il numero pezzi del cassone ${invalidPieces.index + 1} è obbligatorio e deve essere un intero positivo.`;
                return;
            }
            const occupiedWeighings = new Set(logicalInventoryUnits(inventory)
                .map((unit) => normalizeCustomer(unit.item.weighingCode))
                .filter(Boolean));
            operationGroups.load.forEach((entry, index) => {
                if (index !== editingOperationLineIndex && entry.weighingCode) occupiedWeighings.add(normalizeCustomer(entry.weighingCode));
            });
            const incomingWeighings = new Set();
            let duplicate = null;
            for (const unit of batchValues) {
                if (!unit.weighingCode) continue;
                if (occupiedWeighings.has(unit.weighingCode) || incomingWeighings.has(unit.weighingCode)) {
                    duplicate = unit;
                    break;
                }
                incomingWeighings.add(unit.weighingCode);
            }
            if (duplicate) {
                message.textContent = `Il codice pesata ${duplicate.weighingCode} del cassone ${duplicate.index + 1} è già assegnato.`;
                return;
            }
        }
        if (operationGroupMode === "unload" && !weighingCode && !order && (!Number.isInteger(enteredPieces) || enteredPieces < 1)) {
            message.textContent = "Indica almeno un riferimento ordine, un codice pesata oppure il numero di pezzi da prelevare.";
            return;
        }
        if (operationGroupMode === "unload" && Number.isInteger(enteredPieces) && enteredPieces > 0 && !article && !weighingCode) {
            message.textContent = "Per il prelievo a pezzi indica l'articolo oppure un codice pesata esatto.";
            return;
        }
        const entry = {
            id: previous?.id || nextOperationLineId++,
            article,
            customer,
            order,
            weighingCode,
            pieceCount: operationGroupMode === "load" ? enteredPieces : null,
            requestedPieces: operationGroupMode === "unload" && Number.isInteger(enteredPieces) && enteredPieces > 0 ? enteredPieces : null,
            quantity: 1,
            type,
            sourceIds: previous?.sourceIds || [],
            sourceLocations: previous?.sourceLocations || [],
        };
        if (operationGroupMode === "load" && editingOperationLineIndex === null) {
            activeOperationGroup().push(...batchValues.map((unit) => ({
                ...entry,
                id: unit.index === 0 ? entry.id : nextOperationLineId++,
                weighingCode: unit.weighingCode,
                pieceCount: unit.pieceCount,
            })));
        } else if (editingOperationLineIndex === null) activeOperationGroup().push(entry);
        else activeOperationGroup()[editingOperationLineIndex] = entry;
        operationPreviewPlan = null;
        resetOperationLineForm();
        renderOperationGroup();
        document.getElementById("loadFormMessage").textContent = previous
            ? "Riga aggiornata."
            : operationGroupMode === "load" && batchValues.length > 1
              ? `${batchValues.length} cassoni aggiunti insieme al gruppo di carico.`
              : `Articolo aggiunto al gruppo di ${operationModeLabel()}.`;
        void focusWarehouseElement(document.getElementById("loadArticle"), true);
    });
    document.getElementById("reviewOperationGroup")?.addEventListener("click", prepareOperationReview);
    document.getElementById("backToOperationCompose")?.addEventListener("click", () => setOperationStage("compose"));
    document.getElementById("cancelOperationGroup")?.addEventListener("click", cancelOperationGroup);
    document.getElementById("cancelOperationReview")?.addEventListener("click", cancelOperationGroup);
    document.getElementById("confirmOperationGroup")?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        const result = await commitOperationGroup();
        button.disabled = false;
        if (result.error) {
            const note = document.getElementById("operationReviewNote");
            note.textContent = result.error;
            note.classList.add("is-error");
            return;
        }
        setOperationStage("ready");
        document.getElementById("operationReadyTitle").textContent = `Gruppo di ${operationModeLabel()} confermato`;
        document.getElementById("operationReadyText").textContent = `${result.movement.id} completato. La mappa è stata aggiornata con la nuova disposizione.`;
        appendMovementLines(document.getElementById("operationReadyList"), result.movement);
    });
    document.getElementById("reviseConfirmedOperation")?.addEventListener("click", () => clearCompletedOperationGroup());
    document.getElementById("finishOperationGroup")?.addEventListener("click", () => clearCompletedOperationGroup(true));
    document.getElementById("prepareUnloadButton")?.addEventListener("click", addSelectedResultsToUnloadGroup);
    document.getElementById("openMovementHistory")?.addEventListener("click", openMovementHistoryDialog);
    document.getElementById("closeMovementHistory")?.addEventListener("click", closeMovementHistoryDialog);
    document.getElementById("movementHistoryDialog")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeMovementHistoryDialog();
    });
    document.getElementById("openMovementDetails")?.addEventListener("click", () => {
        const movement = movementHistory.find((entry) => entry.id === contextMovementId);
        if (!movement) return;
        closeMovementContextMenu();
        ipcRenderer.send("open-warehouse-movement-details-window", cloneWarehouseMovement(movement));
    });
    document.addEventListener("pointerdown", (event) => {
        if (!event.target.closest?.("#movementContextMenu")) closeMovementContextMenu();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeOperationDialog();
            closeMovementHistoryDialog();
        }
    });
    updateLoadTypeNote();
    updateOperationButtons();
    renderMovementHistory();
}

function setupWarehouseLogin() {
    const chooseMode = (mode) => {
        const employee = mode === "employee";
        document.getElementById("warehouseEmployeeLoginPanel").hidden = !employee;
        document.getElementById("warehouseAdminLoginPanel").hidden = employee;
        document.getElementById("warehouseLoginEmployeeChoice")?.classList.toggle("is-active", employee);
        document.getElementById("warehouseLoginAdminChoice")?.classList.toggle("is-active", !employee);
        document.getElementById("warehouseLoginError").hidden = true;
    };
    document.getElementById("warehouseLoginToggle")?.addEventListener("click", async () => {
        if (!isWarehouseLoggedIn()) {
            openWarehouseLogin();
            return;
        }
        if (!await showWarehouseConfirm({
            title: "Disconnetti operatore",
            message: `Vuoi disconnettere ${warehouseActorSnapshot().displayName}?`,
            confirmLabel: "Disconnetti",
        })) return;
        await ipcRenderer.invoke("pm-session-clear");
        applyWarehouseSession(null);
        openWarehouseLogin();
    });
    document.getElementById("closeWarehouseLogin")?.addEventListener("click", closeWarehouseLogin);
    document.getElementById("warehouseLoginEmployeeChoice")?.addEventListener("click", () => chooseMode("employee"));
    document.getElementById("warehouseLoginAdminChoice")?.addEventListener("click", () => chooseMode("admin"));
    document.getElementById("warehouseLoginDepartment")?.addEventListener("change", (event) => {
        fillWarehouseSelect(document.getElementById("warehouseLoginEmployee"), warehouseAssigneeGroups[event.currentTarget.value] || [], "Seleziona dipendente");
    });
    document.getElementById("warehouseEmployeeLoginConfirm")?.addEventListener("click", async () => {
        const department = document.getElementById("warehouseLoginDepartment").value;
        const employee = document.getElementById("warehouseLoginEmployee").value;
        if (!department || !employee) {
            showWarehouseToast("Seleziona reparto e dipendente per accedere.", true);
            return;
        }
        await saveWarehouseSession({ role: "employee", adminName: "", department, employee });
        closeWarehouseLogin();
    });
    document.getElementById("warehouseAdminLoginConfirm")?.addEventListener("click", async () => {
        const targetName = document.getElementById("warehouseLoginAdmin").value;
        const password = document.getElementById("warehouseLoginPassword").value;
        const error = document.getElementById("warehouseLoginError");
        error.hidden = true;
        if (!targetName || !password) {
            error.textContent = "Seleziona un admin e inserisci la password.";
            error.hidden = false;
            return;
        }
        try {
            const verified = await requestBackend("/api/shared/admins/verify", { method: "POST", body: { password, targetName } });
            if (!verified?.admin) throw new Error("Credenziali non valide");
            await saveWarehouseSession({ role: "admin", adminName: verified.admin.name, department: "", employee: "" });
            document.getElementById("warehouseLoginPassword").value = "";
            closeWarehouseLogin();
        } catch {
            error.textContent = "Password errata.";
            error.hidden = false;
        }
    });
    ["warehouseLoginPassword", "warehouseLoginAdmin"].forEach((id) => {
        document.getElementById(id)?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") document.getElementById("warehouseAdminLoginConfirm")?.click();
        });
    });
    ipcRenderer.on("pm-session-updated", (_event, payload) => applyWarehouseSession(payload));
}

function normalizeSearchText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function selectedSearchFields() {
    return Array.from(document.querySelectorAll('input[name="searchField"]:checked')).map((input) => input.value);
}

function searchableValues(item, fields) {
    const values = {
        article: item.article,
        customer: item.customer,
        order: item.orderReference,
        weighing: item.weighingCode || "",
        pieces: `${item.pieceCount || 0} pezzi capienza ${item.maxPieceCapacity || item.pieceCount || 0}`,
        tags: item.tags.join(" "),
        type: item.type === "pallet" ? "pallet bancale" : "cassone",
        movement: item.inMovement ? "in movimento movimentazione spostamento scarico" : "",
    };
    return fields.map((field) => normalizeSearchText(values[field]));
}

function compareLocations(left, right) {
    const a = parseSlotCode(left.location);
    const b = parseSlotCode(right.location);
    if (a.row !== b.row) return a.row.localeCompare(b.row);
    if (a.number !== b.number) return a.number - b.number;
    return a.level.localeCompare(b.level);
}

function findInventoryMatches(query) {
    const normalized = normalizeSearchText(query);
    const fields = selectedSearchFields();
    if (!normalized || !fields.length) return [];
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return Array.from(inventory.values())
        .filter((item) => {
            const values = searchableValues(item, fields);
            return tokens.every((token) => values.some((value) => value.includes(token)));
        })
        .sort(compareLocations);
}

function createResultFlag(text, className = "") {
    const flag = document.createElement("span");
    flag.className = `result-flag ${className}`.trim();
    flag.textContent = text;
    return flag;
}

function updateSelectedResultCount() {
    const count = selectedReportLocations.size;
    document.getElementById("selectedResultCount").textContent = `${count} ${count === 1 ? "selezionato" : "selezionati"}`;
    document.getElementById("prepareUnloadButton").disabled = count === 0;
}

function renderSearchReport(query) {
    const list = document.getElementById("searchReportList");
    const summary = document.getElementById("searchReportSummary");
    if (!list || !summary) return;
    list.replaceChildren();
    if (!normalizeSearchText(query)) {
        summary.textContent = "Inserisci una ricerca";
        const empty = document.createElement("p");
        empty.className = "search-report__empty";
        empty.textContent = "I risultati compariranno qui e verranno evidenziati nella mappa.";
        list.appendChild(empty);
        updateSelectedResultCount();
        return;
    }
    summary.textContent = `${currentSearchResults.length} ${currentSearchResults.length === 1 ? "risultato" : "risultati"}`;
    if (!currentSearchResults.length) {
        const empty = document.createElement("p");
        empty.className = "search-report__empty";
        empty.textContent = "Nessun cassone corrisponde ai criteri selezionati.";
        list.appendChild(empty);
        updateSelectedResultCount();
        return;
    }

    currentSearchResults.forEach((item) => {
        const row = document.createElement("div");
        row.className = "search-result";
        row.classList.toggle("is-checked", selectedReportLocations.has(item.location));
        row.tabIndex = 0;
        row.title = `Apri ${item.location}`;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedReportLocations.has(item.location);
        checkbox.setAttribute("aria-label", `Seleziona ${item.location} per una futura movimentazione`);
        checkbox.addEventListener("click", (event) => event.stopPropagation());
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) selectedReportLocations.add(item.location);
            else selectedReportLocations.delete(item.location);
            row.classList.toggle("is-checked", checkbox.checked);
            updateSelectedResultCount();
        });
        const location = document.createElement("strong");
        location.textContent = item.location;
        const article = document.createElement("span");
        article.textContent = item.article;
        article.title = `Articolo: ${item.article}`;
        const customer = document.createElement("span");
        customer.textContent = item.customer;
        customer.title = `Cliente: ${item.customer}`;
        const order = document.createElement("span");
        order.textContent = item.orderReference || "—";
        order.title = `Rif. ordine: ${item.orderReference}`;
        const weighing = document.createElement("span");
        weighing.textContent = item.weighingCode || "—";
        weighing.title = `Codice pesata: ${item.weighingCode || "non indicato"}`;
        const pieces = document.createElement("span");
        pieces.textContent = `${warehouseItemPieces(item)} / ${Math.max(warehouseItemPieces(item), Number(item.maxPieceCapacity) || warehouseItemPieces(item))}`;
        pieces.title = "Pezzi correnti / capienza iniziale";
        const flags = document.createElement("div");
        flags.className = "result-flags";
        if (item.tags.length) {
            const tagFlag = createResultFlag("Tag");
            tagFlag.title = item.tags.join(", ");
            flags.appendChild(tagFlag);
        }
        if (item.inMovement) flags.appendChild(createResultFlag("Movimento", "result-flag--movement"));
        if (item.type === "pallet") flags.appendChild(createResultFlag("Pallet", "result-flag--pallet"));
        row.append(checkbox, location, article, customer, order, weighing, pieces, flags);
        row.addEventListener("click", () => selectSlot(item.location));
        row.addEventListener("keydown", (event) => {
            if (event.key === "Enter") selectSlot(item.location);
        });
        list.appendChild(row);
    });
    updateSelectedResultCount();
}

function refreshInventorySearch() {
    const query = document.getElementById("inventorySearchInput")?.value || "";
    const quickInput = document.getElementById("quickInventorySearchInput");
    if (quickInput && quickInput.value !== query) quickInput.value = query;
    currentSearchResults = findInventoryMatches(query);
    const visibleLocations = new Set(currentSearchResults.map((item) => item.location));
    Array.from(selectedReportLocations).forEach((location) => {
        if (!visibleLocations.has(location)) selectedReportLocations.delete(location);
    });
    renderSearchReport(query);
    renderMap();
    document.getElementById("openInventorySearchDialog")?.classList.toggle("has-active-search", Boolean(normalizeSearchText(query)));
}

function openInventorySearchDialog() {
    openWarehouseDialog(document.getElementById("inventorySearchDialog"), document.getElementById("inventorySearchInput"), true);
}

function closeInventorySearchDialog() {
    closeWarehouseDialog(document.getElementById("inventorySearchDialog"));
}

function setupInventorySearch() {
    const form = document.getElementById("inventorySearchForm");
    const input = document.getElementById("inventorySearchInput");
    const quickInput = document.getElementById("quickInventorySearchInput");
    form?.addEventListener("submit", (event) => event.preventDefault());
    input?.addEventListener("input", () => {
        if (quickInput) quickInput.value = input.value;
        refreshInventorySearch();
    });
    quickInput?.addEventListener("input", () => {
        if (input) input.value = quickInput.value;
        refreshInventorySearch();
    });
    document.querySelectorAll('input[name="searchField"]').forEach((checkbox) => {
        checkbox.addEventListener("change", refreshInventorySearch);
    });
    document.getElementById("clearInventorySearch")?.addEventListener("click", () => {
        if (input) input.value = "";
        if (quickInput) quickInput.value = "";
        selectedReportLocations.clear();
        refreshInventorySearch();
        void focusWarehouseElement(input, true);
    });
    document.getElementById("openInventorySearchDialog")?.addEventListener("click", openInventorySearchDialog);
    document.getElementById("closeInventorySearchDialog")?.addEventListener("click", closeInventorySearchDialog);
    document.getElementById("inventorySearchDialog")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeInventorySearchDialog();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeInventorySearchDialog();
    });
}

function setupSlotPreview() {
    window.addEventListener("resize", hideSlotPreview);
    window.addEventListener("resize", scheduleSlotLabelFit);
    document.addEventListener("scroll", hideSlotPreview, true);
}

function restrictionFromInputs(whitelistId, blacklistId) {
    return {
        whitelist: parseCustomerList(document.getElementById(whitelistId)?.value),
        blacklist: parseCustomerList(document.getElementById(blacklistId)?.value),
    };
}

const restrictionCustomerEditors = {
    rowWhitelist: { entryId: "rowWhitelistEntry", chipsId: "rowWhitelistChips", oppositeId: "rowBlacklist" },
    rowBlacklist: { entryId: "rowBlacklistEntry", chipsId: "rowBlacklistChips", oppositeId: "rowWhitelist" },
    slotWhitelist: { entryId: "slotWhitelistEntry", chipsId: "slotWhitelistChips", oppositeId: "slotBlacklist" },
    slotBlacklist: { entryId: "slotBlacklistEntry", chipsId: "slotBlacklistChips", oppositeId: "slotWhitelist" },
};

function restrictionCustomerValues(fieldId) {
    return parseCustomerList(document.getElementById(fieldId)?.value);
}

function markRestrictionDraft(fieldId) {
    const messageId = fieldId.startsWith("row") ? "rowRestrictionMessage" : "slotRestrictionMessage";
    setRestrictionMessage(messageId, "Modifica pronta: premi Salva per applicarla.");
}

function renderRestrictionCustomerEditor(fieldId) {
    const editor = restrictionCustomerEditors[fieldId];
    const container = document.getElementById(editor?.chipsId);
    if (!editor || !container) return;
    container.replaceChildren();
    const customers = restrictionCustomerValues(fieldId);
    if (!customers.length) {
        const empty = document.createElement("span");
        empty.className = "restriction-customer-chips__empty";
        empty.textContent = "Nessun cliente inserito";
        container.appendChild(empty);
        return;
    }
    customers.forEach((customer) => {
        const chip = document.createElement("span");
        chip.className = "restriction-customer-chip";
        const label = document.createElement("span");
        label.textContent = customer;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label", `Rimuovi ${customer}`);
        remove.title = `Rimuovi ${customer}`;
        remove.addEventListener("click", () => {
            document.getElementById(fieldId).value = customers.filter((value) => value !== customer).join(", ");
            renderRestrictionCustomerEditor(fieldId);
            markRestrictionDraft(fieldId);
            document.getElementById(editor.entryId)?.focus();
        });
        chip.append(label, remove);
        container.appendChild(chip);
    });
}

function addRestrictionCustomer(fieldId) {
    const editor = restrictionCustomerEditors[fieldId];
    const entry = document.getElementById(editor?.entryId);
    if (!editor || !entry) return;
    const additions = parseCustomerList(entry.value);
    if (!additions.length) {
        entry.focus();
        return;
    }
    const next = Array.from(new Set([...restrictionCustomerValues(fieldId), ...additions]));
    document.getElementById(fieldId).value = next.join(", ");

    // Un cliente non può essere contemporaneamente ammesso e vietato allo stesso livello.
    const opposite = restrictionCustomerValues(editor.oppositeId).filter((customer) => !additions.includes(customer));
    document.getElementById(editor.oppositeId).value = opposite.join(", ");
    entry.value = "";
    renderRestrictionCustomerEditor(fieldId);
    renderRestrictionCustomerEditor(editor.oppositeId);
    markRestrictionDraft(fieldId);
    entry.focus();
}

function commitPendingRestrictionCustomers(...fieldIds) {
    fieldIds.forEach((fieldId) => {
        const editor = restrictionCustomerEditors[fieldId];
        const entry = document.getElementById(editor?.entryId);
        if (entry?.value.trim()) addRestrictionCustomer(fieldId);
    });
}

function writeRestrictionInputs(rule, whitelistId, blacklistId) {
    const safeRule = rule || { whitelist: [], blacklist: [] };
    document.getElementById(whitelistId).value = safeRule.whitelist.join(", ");
    document.getElementById(blacklistId).value = safeRule.blacklist.join(", ");
    const whitelistEntry = restrictionCustomerEditors[whitelistId]?.entryId;
    const blacklistEntry = restrictionCustomerEditors[blacklistId]?.entryId;
    if (whitelistEntry) document.getElementById(whitelistEntry).value = "";
    if (blacklistEntry) document.getElementById(blacklistEntry).value = "";
    renderRestrictionCustomerEditor(whitelistId);
    renderRestrictionCustomerEditor(blacklistId);
}

function storeRestriction(collection, key, rule) {
    if (hasRestriction(rule)) collection.set(key, rule);
    else collection.delete(key);
}

function restrictionConflictCount() {
    return Array.from(inventory.values()).filter(
        (item) => !evaluateCustomerForSlot(item.location, item.customer).allowed,
    ).length;
}

function setRestrictionMessage(id, text, success = false) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = text;
    element.classList.toggle("is-success", success);
}

function populateRestrictionSlots(preferredLocation) {
    const select = document.getElementById("restrictionSlotSelect");
    if (!select) return;
    select.replaceChildren();
    for (let number = 1; number <= maximumPositionForRow(selectedRestrictionRow); number += 1) {
        ["a", "b", "c"].forEach((level) => {
            const code = `${selectedRestrictionRow}${number}${level}`;
            const option = document.createElement("option");
            option.value = code;
            option.textContent = `${code}${hasRestriction(slotRestrictions.get(code)) ? " · vincolo configurato" : ""}`;
            select.appendChild(option);
        });
    }
    const desired = preferredLocation?.startsWith(selectedRestrictionRow)
        ? preferredLocation
        : `${selectedRestrictionRow}1a`;
    select.value = desired;
}

function renderEffectiveRestriction() {
    const location = document.getElementById("restrictionSlotSelect")?.value;
    if (!location) return;
    const rowRule = rowRestrictions.get(selectedRestrictionRow);
    const slotRule = slotRestrictions.get(location);
    document.getElementById("effectiveRestrictionTitle").textContent = location;
    const parts = [];
    if (hasRestriction(rowRule)) parts.push(`Fila ${selectedRestrictionRow}: ${restrictionLabel(rowRule)}.`);
    if (hasRestriction(slotRule)) parts.push(`Slot: ${restrictionLabel(slotRule)}.`);
    document.getElementById("effectiveRestrictionText").textContent = parts.length
        ? `${parts.join(" ")} La regola dello slot non può superare quella della fila.`
        : "Nessuna restrizione: tutti i clienti sono ammessi.";
}

function loadSelectedSlotRestriction() {
    const location = document.getElementById("restrictionSlotSelect")?.value;
    writeRestrictionInputs(slotRestrictions.get(location), "slotWhitelist", "slotBlacklist");
    setRestrictionMessage("slotRestrictionMessage", "");
    renderEffectiveRestriction();
}

function renderRestrictionRows() {
    const container = document.getElementById("restrictionRowTabs");
    if (!container) return;
    container.replaceChildren();
    rowCodes().forEach((row) => {
        const button = document.createElement("button");
        button.type = "button";
        button.classList.toggle("is-active", row === selectedRestrictionRow);
        const label = document.createElement("strong");
        label.textContent = `Fila ${row}`;
        const slotRuleCount = Array.from(slotRestrictions.keys()).filter((location) => location.startsWith(row)).length;
        const info = document.createElement("small");
        info.textContent = hasRestriction(rowRestrictions.get(row))
            ? "Regola fila"
            : slotRuleCount
              ? `${slotRuleCount} ${slotRuleCount === 1 ? "slot" : "slot"}`
              : "Nessun vincolo";
        button.append(label, info);
        button.addEventListener("click", () => {
            selectedRestrictionRow = row;
            renderRestrictionDialog();
            setRestrictionView("editor");
        });
        container.appendChild(button);
    });
}

function renderRestrictionSummary() {
    const configured = rowRestrictions.size + slotRestrictions.size;
    const conflicts = restrictionConflictCount();
    document.getElementById("restrictionConfiguredCount").textContent =
        `${configured} ${configured === 1 ? "regola configurata" : "regole configurate"}`;
    const conflictElement = document.getElementById("restrictionConflictCount");
    conflictElement.textContent = conflicts
        ? `${conflicts} ${conflicts === 1 ? "cassone non conforme" : "cassoni non conformi"}`
        : "Nessun conflitto";
    conflictElement.classList.toggle("has-conflicts", conflicts > 0);
}

function setRestrictionView(view) {
    const overview = view === "overview";
    document.getElementById("restrictionEditorView").hidden = overview;
    document.getElementById("restrictionOverviewView").hidden = !overview;
    document.getElementById("openRestrictionOverview")?.classList.toggle("is-active", overview);
    if (overview) renderRestrictionOverview();
}

function restrictionOverviewCustomers(customers, emptyText) {
    const container = document.createElement("div");
    container.className = "restriction-overview__customers";
    if (!customers.length) {
        const empty = document.createElement("span");
        empty.className = "restriction-overview__empty-value";
        empty.textContent = emptyText;
        container.appendChild(empty);
        return container;
    }
    customers.forEach((customer) => {
        const chip = document.createElement("span");
        chip.textContent = customer;
        container.appendChild(chip);
    });
    return container;
}

function openRestrictionRule(scope, key) {
    const location = scope === "slot" ? key : `${key}1a`;
    selectedRestrictionRow = scope === "slot" ? parseSlotCode(key)?.row : key;
    renderRestrictionDialog(location);
    setRestrictionView("editor");
    if (scope === "slot") document.getElementById("restrictionSlotSelect")?.focus();
    else document.getElementById("rowWhitelistEntry")?.focus();
}

function renderRestrictionOverview() {
    const container = document.getElementById("restrictionOverviewRows");
    if (!container) return;
    container.replaceChildren();
    const rules = [
        ...Array.from(rowRestrictions.entries()).map(([key, rule]) => ({ scope: "row", key, rule })),
        ...Array.from(slotRestrictions.entries()).map(([key, rule]) => ({ scope: "slot", key, rule })),
    ].sort((left, right) => {
        const leftCode = left.scope === "row" ? `${left.key}0` : left.key;
        const rightCode = right.scope === "row" ? `${right.key}0` : right.key;
        return leftCode.localeCompare(rightCode, "it", { numeric: true });
    });
    if (!rules.length) {
        const empty = document.createElement("div");
        empty.className = "restriction-overview__empty";
        empty.textContent = "Nessuna regola configurata. Seleziona una fila per iniziare.";
        container.appendChild(empty);
        return;
    }
    rules.forEach(({ scope, key, rule }) => {
        const row = document.createElement("div");
        row.className = "restriction-overview__row";
        row.setAttribute("role", "row");
        const scopeCell = document.createElement("div");
        const scopeLabel = document.createElement("strong");
        scopeLabel.textContent = scope === "row" ? `Fila ${key}` : `Slot ${key}`;
        const scopeHint = document.createElement("small");
        scopeHint.textContent = scope === "row" ? "Priorità 1" : `Fila ${parseSlotCode(key)?.row} · Priorità 2`;
        scopeCell.append(scopeLabel, scopeHint);
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "Modifica";
        edit.addEventListener("click", () => openRestrictionRule(scope, key));
        row.append(
            scopeCell,
            restrictionOverviewCustomers(rule.whitelist, "Tutti ammessi"),
            restrictionOverviewCustomers(rule.blacklist, "Nessuna esclusione"),
            edit,
        );
        container.appendChild(row);
    });
}

function renderRestrictionDialog(preferredLocation) {
    renderRestrictionRows();
    document.getElementById("rowRestrictionTitle").textContent = `Regola fila ${selectedRestrictionRow}`;
    writeRestrictionInputs(rowRestrictions.get(selectedRestrictionRow), "rowWhitelist", "rowBlacklist");
    populateRestrictionSlots(preferredLocation || selectedSlot?.code);
    loadSelectedSlotRestriction();
    renderRestrictionSummary();
    setRestrictionMessage("rowRestrictionMessage", "");
}

function refreshRestrictionViews() {
    renderMap();
    renderDetails();
    if (!document.getElementById("analysisView")?.hidden) renderAnalysisTable();
}

function openRestrictionDialog(targets = null) {
    if (!isWarehouseAdmin()) {
        showWarehouseToast("Accesso amministratore richiesto per gestire i vincoli cliente.", true);
        return;
    }
    closeToolsDrawer();
    const targetCodes = Array.isArray(targets) ? targets.filter((code) => parseSlotCode(code)) : [];
    restrictionBatchTargets = targetCodes.length > 1 ? targetCodes : null;
    const preferredLocation = targetCodes[0] || selectedSlot?.code;
    selectedRestrictionRow = parseSlotCode(preferredLocation)?.row || selectedRow;
    renderRestrictionDialog(preferredLocation);
    document.getElementById("restrictionDialogTitle").textContent = restrictionBatchTargets
        ? `Vincoli cliente per ${restrictionBatchTargets.length} slot selezionati`
        : "Vincoli cliente per fila e slot";
    setRestrictionView("editor");
    openWarehouseDialog(document.getElementById("restrictionDialog"), document.getElementById("rowWhitelistEntry"));
}

function closeRestrictionDialog() {
    closeWarehouseDialog(document.getElementById("restrictionDialog"));
    restrictionBatchTargets = null;
}

function setupRestrictionDialog() {
    document.getElementById("openRestrictionsButton")?.addEventListener("click", () => openRestrictionDialog());
    document.getElementById("closeRestrictionsButton")?.addEventListener("click", closeRestrictionDialog);
    document.getElementById("restrictionDialog")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeRestrictionDialog();
    });
    document.getElementById("restrictionSlotSelect")?.addEventListener("change", loadSelectedSlotRestriction);
    document.getElementById("openRestrictionOverview")?.addEventListener("click", () => setRestrictionView("overview"));
    document.getElementById("closeRestrictionOverview")?.addEventListener("click", () => setRestrictionView("editor"));
    Object.entries(restrictionCustomerEditors).forEach(([fieldId, editor]) => {
        document.querySelector(`[data-restriction-add="${fieldId}"]`)?.addEventListener("click", () => addRestrictionCustomer(fieldId));
        document.getElementById(editor.entryId)?.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== ",") return;
            event.preventDefault();
            addRestrictionCustomer(fieldId);
        });
    });
    document.getElementById("saveRowRestriction")?.addEventListener("click", () => {
        commitPendingRestrictionCustomers("rowWhitelist", "rowBlacklist");
        const rule = restrictionFromInputs("rowWhitelist", "rowBlacklist");
        const error = validateRestriction(rule);
        if (error) {
            setRestrictionMessage("rowRestrictionMessage", error);
            return;
        }
        const location = document.getElementById("restrictionSlotSelect")?.value;
        storeRestriction(rowRestrictions, selectedRestrictionRow, rule);
        refreshRestrictionViews();
        renderRestrictionDialog(location);
        setRestrictionMessage("rowRestrictionMessage", "Regola della fila salvata.", true);
    });
    document.getElementById("saveSlotRestriction")?.addEventListener("click", () => {
        commitPendingRestrictionCustomers("slotWhitelist", "slotBlacklist");
        const location = document.getElementById("restrictionSlotSelect")?.value;
        const rule = restrictionFromInputs("slotWhitelist", "slotBlacklist");
        const error = validateRestriction(rule);
        if (error) {
            setRestrictionMessage("slotRestrictionMessage", error);
            return;
        }
        const targets = restrictionBatchTargets || [location];
        targets.forEach((target) => storeRestriction(slotRestrictions, target, rule));
        refreshRestrictionViews();
        renderRestrictionDialog(location);
        setRestrictionMessage("slotRestrictionMessage", targets.length === 1 ? "Regola dello slot salvata." : `Regola applicata a ${targets.length} slot.`, true);
    });
    document.getElementById("clearRowRestriction")?.addEventListener("click", () => {
        const location = document.getElementById("restrictionSlotSelect")?.value;
        rowRestrictions.delete(selectedRestrictionRow);
        refreshRestrictionViews();
        renderRestrictionDialog(location);
        setRestrictionMessage("rowRestrictionMessage", "Regola della fila rimossa.", true);
    });
    document.getElementById("clearSlotRestriction")?.addEventListener("click", () => {
        const location = document.getElementById("restrictionSlotSelect")?.value;
        const targets = restrictionBatchTargets || [location];
        targets.forEach((target) => slotRestrictions.delete(target));
        refreshRestrictionViews();
        renderRestrictionDialog(location);
        setRestrictionMessage("slotRestrictionMessage", targets.length === 1 ? "Regola dello slot rimossa." : `Regola rimossa da ${targets.length} slot.`, true);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeRestrictionDialog();
    });
}

let selectedAnalysisLocation = null;
let analysisSort = { key: "location", direction: "asc" };
const ANALYSIS_SORT_KEYS = [
    "location", "row", "physicalColumn", "side", "level", "slotStatus", "id", "type",
    "article", "customer", "orderReference", "weighingCode", "pieceCount", "maxPieceCapacity", "tags", "contentStatus", "rowRestriction",
    "slotRestriction", "customerCompliance",
];
const analysisCollator = new Intl.Collator("it", { numeric: true, sensitivity: "base" });

function allWarehouseSlots() {
    const slots = [];
    rowCodes().forEach((row) => {
        for (let number = 1; number <= maximumPositionForRow(row); number += 1) {
            ["a", "b", "c"].forEach((level) => {
                const code = `${row}${number}${level}`;
                slots.push({ ...parseSlotCode(code), item: inventory.get(code) || null });
            });
        }
    });
    return slots;
}

function analysisSlotMatches(slot, query) {
    const normalized = normalizeSearchText(query);
    if (!normalized) return true;
    const item = slot.item;
    const blockingPalletId = !item ? palletBlockingSlot(slot) : null;
    const values = normalizeSearchText([
        slot.code,
        slot.row,
        slot.physicalColumn,
        slot.side === "rear" ? "posteriore retro" : "anteriore fronte",
        slot.level,
        blockingPalletId ? `bloccato pallet ${blockingPalletId}` : item ? "occupato" : "libero",
        item?.id,
        item?.type === "pallet" ? "pallet bancale" : item ? "cassone" : "",
        item?.article,
        item?.customer,
        item?.orderReference,
        item?.weighingCode,
        item?.pieceCount,
        item?.maxPieceCapacity,
        item?.tags?.join(" "),
        item?.inMovement ? "in movimento" : "",
        restrictionLabel(rowRestrictions.get(slot.row)),
        restrictionLabel(slotRestrictions.get(slot.code)),
        item && !evaluateCustomerForSlot(slot.code, item.customer).allowed ? "conflitto cliente" : "conforme",
    ].join(" "));
    return normalized.split(/\s+/).every((token) => values.includes(token));
}

function analysisSortValue(slot, key) {
    const item = slot.item;
    const blockingPalletId = !item ? palletBlockingSlot(slot) : null;
    const customerCheck = item ? evaluateCustomerForSlot(slot.code, item.customer) : null;
    const values = {
        location: slot.code,
        row: slot.row,
        physicalColumn: slot.physicalColumn,
        side: slot.side === "rear" ? "Posteriore" : "Anteriore",
        level: slot.level,
        slotStatus: blockingPalletId ? "Bloccato da pallet" : item ? "Occupato" : "Libero",
        id: item?.id || "",
        type: item?.type === "pallet" ? "Pallet" : item ? "Cassone" : "",
        article: item?.article || "",
        customer: item?.customer || "",
        orderReference: item?.orderReference || "",
        weighingCode: item?.weighingCode || "",
        pieceCount: item ? Math.max(1, Number(item.pieceCount) || 1) : "",
        maxPieceCapacity: item ? Math.max(1, Number(item.maxPieceCapacity) || Number(item.pieceCount) || 1) : "",
        tags: item?.tags?.join(", ") || "",
        contentStatus: item?.inMovement ? "In movimento" : "",
        rowRestriction: restrictionLabel(rowRestrictions.get(slot.row)),
        slotRestriction: restrictionLabel(slotRestrictions.get(slot.code)),
        customerCompliance: !item ? "" : customerCheck.allowed ? "Conforme" : `Conflitto ${customerCheck.source}`,
    };
    return values[key];
}

function compareAnalysisSlots(left, right) {
    const leftValue = analysisSortValue(left, analysisSort.key);
    const rightValue = analysisSortValue(right, analysisSort.key);
    const leftEmpty = leftValue === "" || leftValue === null || leftValue === undefined;
    const rightEmpty = rightValue === "" || rightValue === null || rightValue === undefined;
    if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
    let comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : analysisCollator.compare(String(leftValue), String(rightValue));
    if (analysisSort.direction === "desc") comparison *= -1;
    return comparison || analysisCollator.compare(left.code, right.code);
}

function updateAnalysisSortHeaders() {
    document.querySelectorAll(".analysis-table th").forEach((header, index) => {
        const key = ANALYSIS_SORT_KEYS[index];
        header.dataset.sortKey = key;
        header.tabIndex = 0;
        const active = analysisSort.key === key;
        header.setAttribute("aria-sort", active ? (analysisSort.direction === "asc" ? "ascending" : "descending") : "none");
        header.title = active
            ? `Ordinamento ${analysisSort.direction === "asc" ? "crescente" : "decrescente"}. Clicca per invertire.`
            : "Ordina questa colonna in modo alfanumerico";
    });
}

function appendAnalysisCell(row, value, className = "") {
    const cell = document.createElement("td");
    cell.textContent = value || "—";
    cell.title = value || "";
    if (!value) cell.classList.add("table-empty");
    if (className) cell.classList.add(...className.split(" "));
    row.appendChild(cell);
}

function renderAnalysisTable() {
    const body = document.getElementById("analysisTableBody");
    if (!body) return;
    const query = document.getElementById("analysisSearch")?.value || "";
    const occupiedOnly = Boolean(document.getElementById("analysisOccupiedOnly")?.checked);
    const slots = allWarehouseSlots().filter(
        (slot) => (!occupiedOnly || slot.item) && analysisSlotMatches(slot, query),
    ).sort(compareAnalysisSlots);
    body.replaceChildren();
    const fragment = document.createDocumentFragment();
    slots.forEach((slot) => {
        const item = slot.item;
        const blockingPalletId = !item ? palletBlockingSlot(slot) : null;
        const row = document.createElement("tr");
        row.dataset.location = slot.code;
        row.classList.toggle("is-selected", selectedAnalysisLocation === slot.code);
        appendAnalysisCell(row, slot.code);
        appendAnalysisCell(row, slot.row);
        appendAnalysisCell(row, String(slot.physicalColumn));
        appendAnalysisCell(row, slot.side === "rear" ? "Posteriore" : "Anteriore");
        appendAnalysisCell(row, slot.level);
        appendAnalysisCell(
            row,
            blockingPalletId ? "Bloccato da pallet" : item ? "Occupato" : "Libero",
            `table-status ${blockingPalletId ? "table-status--blocked" : item ? "table-status--occupied" : "table-status--free"}`,
        );
        appendAnalysisCell(row, item?.id || "");
        appendAnalysisCell(row, item?.type === "pallet" ? "Pallet" : item ? "Cassone" : "");
        appendAnalysisCell(row, item?.article || "");
        appendAnalysisCell(row, item?.customer || "");
        appendAnalysisCell(row, item?.orderReference || "");
        appendAnalysisCell(row, item?.weighingCode || "");
        appendAnalysisCell(row, item ? String(item.pieceCount) : "");
        appendAnalysisCell(row, item ? String(item.maxPieceCapacity) : "");
        appendAnalysisCell(row, item?.tags?.join(", ") || "");
        const contentStates = [];
        if (item?.inMovement) contentStates.push("In movimento");
        appendAnalysisCell(
            row,
            contentStates.join(" · "),
            item?.inMovement
                ? "table-status table-status--movement"
                : "",
        );
        appendAnalysisCell(row, restrictionLabel(rowRestrictions.get(slot.row)));
        appendAnalysisCell(row, restrictionLabel(slotRestrictions.get(slot.code)));
        const customerCheck = item ? evaluateCustomerForSlot(slot.code, item.customer) : null;
        appendAnalysisCell(
            row,
            !item ? "" : customerCheck.allowed ? "Conforme" : `Conflitto · ${customerCheck.source}`,
            !item
                ? ""
                : customerCheck.allowed
                  ? "table-status table-status--allowed"
                  : "table-status table-status--conflict",
        );
        row.addEventListener("click", () => {
            selectedAnalysisLocation = slot.code;
            body.querySelectorAll("tr").forEach((entry) => {
                entry.classList.toggle("is-selected", entry === row);
            });
            const openButton = document.getElementById("openAnalysisSelection");
            if (openButton) openButton.disabled = false;
            const analysisButton = document.getElementById("analyzeAnalysisSelection");
            if (analysisButton) analysisButton.disabled = !item;
        });
        row.addEventListener("dblclick", () => openAnalysisLocation(slot.code));
        fragment.appendChild(row);
    });
    if (!slots.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 19;
        cell.className = "table-empty";
        cell.textContent = "Nessuna ubicazione corrisponde ai filtri impostati.";
        row.appendChild(cell);
        fragment.appendChild(row);
    }
    body.appendChild(fragment);
    document.getElementById("analysisResultCount").textContent = `${slots.length} ${slots.length === 1 ? "riga" : "righe"}`;
}

function articleUnits(article) {
    const units = new Map();
    Array.from(inventory.values())
        .filter((item) => item.article === article)
        .forEach((item) => {
            const key = item.id || item.location;
            if (!units.has(key)) units.set(key, { item, locations: [] });
            units.get(key).locations.push(item.location);
        });
    return Array.from(units.values());
}

function setArticleMetric(id, value) {
    document.getElementById(id).textContent = String(value);
}

function openArticleAnalysis() {
    const selectedItem = selectedAnalysisLocation ? inventory.get(selectedAnalysisLocation) : null;
    if (!selectedItem) return;
    const units = articleUnits(selectedItem.article);
    const occupiedSlots = units.flatMap((unit) => unit.locations);
    const orders = new Map();
    const customers = new Set();
    const rows = new Set();
    const tags = new Set();

    units.forEach((unit) => {
        const item = unit.item;
        orders.set(item.orderReference, (orders.get(item.orderReference) || 0) + 1);
        if (item.customer) customers.add(item.customer);
        item.tags.forEach((tag) => tags.add(tag));
        unit.locations.forEach((location) => rows.add(parseSlotCode(location)?.row));
    });

    document.getElementById("articleAnalysisTitle").textContent = `Articolo ${selectedItem.article}`;
    document.getElementById("articleAnalysisSubtitle").textContent =
        `${units.length} ${units.length === 1 ? "unità logistica" : "unità logistiche"} presenti, conteggiando ogni pallet una sola volta.`;
    setArticleMetric("articleUnitCount", units.length);
    setArticleMetric("articleCrateCount", units.filter((unit) => unit.item.type !== "pallet").length);
    setArticleMetric("articlePalletCount", units.filter((unit) => unit.item.type === "pallet").length);
    setArticleMetric("articleSlotCount", occupiedSlots.length);
    setArticleMetric("articleOrderCount", orders.size);
    setArticleMetric("articleCustomerCount", customers.size);
    setArticleMetric("articleMovementCount", units.filter((unit) => unit.item.inMovement).length);
    setArticleMetric("articlePieceCount", units.reduce((sum, unit) => sum + warehouseItemPieces(unit.item), 0));

    const orderList = document.getElementById("articleAnalysisOrders");
    orderList.replaceChildren();
    Array.from(orders.entries())
        .sort(([left], [right]) => analysisCollator.compare(left, right))
        .forEach(([order, count]) => {
            const row = document.createElement("div");
            const label = document.createElement("span");
            label.textContent = order || "Senza riferimento";
            const value = document.createElement("b");
            value.textContent = String(count);
            row.append(label, value);
            orderList.appendChild(row);
        });

    const locations = document.getElementById("articleAnalysisLocations");
    locations.replaceChildren();
    occupiedSlots.sort(analysisCollator.compare).forEach((location) => {
        const badge = document.createElement("span");
        badge.textContent = location;
        locations.appendChild(badge);
    });
    document.getElementById("articleAnalysisRows").textContent =
        `${rows.size} ${rows.size === 1 ? "fila" : "file"}: ${Array.from(rows).sort().join(", ")}`;
    document.getElementById("articleAnalysisCustomers").textContent = Array.from(customers).sort(analysisCollator.compare).join(", ") || "—";
    document.getElementById("articleAnalysisTags").textContent = Array.from(tags).sort(analysisCollator.compare).join(", ") || "—";

    openWarehouseDialog(document.getElementById("articleAnalysisDialog"), document.getElementById("closeArticleAnalysis"));
}

function closeArticleAnalysis() {
    closeWarehouseDialog(document.getElementById("articleAnalysisDialog"));
}

function setActiveView(view) {
    const showAnalysis = view === "analysis";
    document.getElementById("warehouseView").hidden = showAnalysis;
    document.getElementById("analysisView").hidden = !showAnalysis;
    document.querySelectorAll("[data-view]").forEach((button) => {
        const active = button.dataset.view === view;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
    });
    if (showAnalysis) renderAnalysisTable();
    else {
        renderMap();
        renderDetails();
    }
}

function openAnalysisLocation(location) {
    selectedAnalysisLocation = location;
    setActiveView("warehouse");
    selectSlot(location);
}

function setupAnalysisView() {
    document.querySelectorAll("[data-view]").forEach((button) => {
        button.addEventListener("click", () => setActiveView(button.dataset.view));
    });
    document.getElementById("analysisSearch")?.addEventListener("input", renderAnalysisTable);
    document.getElementById("analysisOccupiedOnly")?.addEventListener("change", renderAnalysisTable);
    document.getElementById("openAnalysisSelection")?.addEventListener("click", () => {
        if (selectedAnalysisLocation) openAnalysisLocation(selectedAnalysisLocation);
    });
    document.getElementById("analyzeAnalysisSelection")?.addEventListener("click", openArticleAnalysis);
    document.getElementById("closeArticleAnalysis")?.addEventListener("click", closeArticleAnalysis);
    document.getElementById("articleAnalysisDialog")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeArticleAnalysis();
    });
    document.querySelectorAll(".analysis-table th").forEach((header, index) => {
        const applySort = () => {
            const key = ANALYSIS_SORT_KEYS[index];
            analysisSort = analysisSort.key === key
                ? { key, direction: analysisSort.direction === "asc" ? "desc" : "asc" }
                : { key, direction: "asc" };
            updateAnalysisSortHeaders();
            renderAnalysisTable();
        };
        header.addEventListener("click", applySort);
        header.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                applySort();
            }
        });
    });
    updateAnalysisSortHeaders();
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeArticleAnalysis();
    });
}

function updateSummary() {
    const capacity = totalSlots();
    const blocked = blockedSlotCount();
    document.getElementById("totalSlots").textContent = String(capacity);
    document.getElementById("occupiedSlots").textContent = String(inventory.size);
    document.getElementById("freeSlots").textContent = String(capacity - inventory.size - blocked);
    document.getElementById("freeSlotsCapacity").textContent = `${blocked} bloccati da pallet · su ${capacity} posizioni`;
    document.getElementById("rowCount").textContent = String(warehouseRows.length);
    document.getElementById("rowList").textContent = rowCodes().join(", ");
    document.getElementById("warehouseStructureSummary").textContent =
        `Struttura configurata: ${warehouseRows.length} ${warehouseRows.length === 1 ? "fila" : "file"}, 3 livelli e ${capacity} slot totali.`;
}

function createSeededRandom(seed) {
    let state = Number(seed) >>> 0;
    if (!state) state = 0x6d2b79f5;
    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}

function pseudoRandomInteger(minimum, maximum, random = Math.random) {
    return Math.floor(random() * (maximum - minimum + 1)) + minimum;
}

function shufflePseudoRandom(values, random) {
    for (let index = values.length - 1; index > 0; index -= 1) {
        const target = pseudoRandomInteger(0, index, random);
        [values[index], values[target]] = [values[target], values[index]];
    }
    return values;
}

function pseudoPopulationFieldValue(id) {
    return Number(document.getElementById(id)?.value);
}

function readPseudoPopulationOptions() {
    const seedValue = document.getElementById("pseudoSeed")?.value.trim();
    const options = {
        totalCrates: pseudoPopulationFieldValue("pseudoTotalCrates"),
        totalPallets: pseudoPopulationFieldValue("pseudoTotalPallets"),
        minimumLot: pseudoPopulationFieldValue("pseudoMinLot"),
        maximumLot: pseudoPopulationFieldValue("pseudoMaxLot"),
        averagePieces: pseudoPopulationFieldValue("pseudoAveragePieces"),
        pieceVariation: pseudoPopulationFieldValue("pseudoPieceVariation"),
        customerCount: pseudoPopulationFieldValue("pseudoCustomers"),
        articleCount: pseudoPopulationFieldValue("pseudoArticles"),
        orderCount: pseudoPopulationFieldValue("pseudoOrders"),
        weighingRate: pseudoPopulationFieldValue("pseudoWeighingRate"),
        seed: seedValue === "" ? (Date.now() >>> 0) : Number(seedValue) >>> 0,
    };
    const integerKeys = ["totalCrates", "totalPallets", "minimumLot", "maximumLot", "averagePieces", "pieceVariation", "customerCount", "articleCount", "orderCount", "weighingRate"];
    if (integerKeys.some((key) => !Number.isInteger(options[key]))) return { error: "Inserisci soltanto numeri interi validi." };
    if (options.totalCrates < 1 || options.totalPallets < 0) return { error: "Indica almeno un cassone e un numero di pallet non negativo." };
    if (options.minimumLot < 1 || options.maximumLot < options.minimumLot) return { error: "Il massimo per lotto deve essere uguale o superiore al minimo." };
    if (options.averagePieces < 1) return { error: "La media pezzi deve essere almeno 1." };
    if (options.pieceVariation < 0 || options.pieceVariation > 95 || options.weighingRate < 0 || options.weighingRate > 100) {
        return { error: "Variabilità e percentuale pesate devono rientrare nei limiti indicati." };
    }
    if (options.customerCount < 1 || options.articleCount < 1 || options.orderCount < 1) return { error: "Clienti, articoli e ordini diversi devono essere almeno 1." };
    const minimumLots = Math.max(
        Math.ceil(options.totalCrates / options.maximumLot),
        options.customerCount,
        options.articleCount,
        options.orderCount,
    );
    const maximumLots = Math.floor(options.totalCrates / options.minimumLot);
    if (minimumLots > maximumLots) {
        return { error: `I parametri richiedono almeno ${minimumLots} lotti, ma con ${options.totalCrates} cassoni e il minimo scelto ne sono possibili al massimo ${maximumLots}.` };
    }
    if (options.customerCount * options.articleCount * options.orderCount < minimumLots) {
        return { error: "Le combinazioni di clienti, articoli e ordini non bastano a creare lotti distinti: aumenta almeno una delle tre varietà." };
    }
    const occupiedSlots = options.totalCrates + options.totalPallets * 2;
    if (occupiedSlots > totalSlots()) return { error: `Sono richiesti almeno ${occupiedSlots} slot fisici, ma il magazzino ne contiene ${totalSlots()}.` };
    return { options: { ...options, lotCount: minimumLots, occupiedSlots } };
}

function renderPseudoPopulationSummary() {
    const summary = document.getElementById("pseudoPopulateSummary");
    if (!summary) return;
    const result = readPseudoPopulationOptions();
    summary.classList.toggle("is-invalid", Boolean(result.error));
    summary.textContent = result.error || `${result.options.totalCrates} cassoni suddivisi in ${result.options.lotCount} lotti · ${result.options.totalPallets} pallet · almeno ${result.options.occupiedSlots} di ${totalSlots()} slot fisici occupati.`;
}

function openPseudoPopulateDialog() {
    if (!isExclusiveTestDatabaseAdmin()) {
        closePseudoPopulateDialog();
        showWarehouseToast("Funzione riservata all'admin Ayrton Pizzi.", true);
        return;
    }
    document.getElementById("pseudoPopulateStatus").textContent = "";
    renderPseudoPopulationSummary();
    openWarehouseDialog(document.getElementById("pseudoPopulateDialog"), document.getElementById("pseudoTotalCrates"), true);
}

function closePseudoPopulateDialog() {
    closeWarehouseDialog(document.getElementById("pseudoPopulateDialog"));
}

function buildPseudoLotSizes(options, random) {
    const sizes = Array(options.lotCount).fill(options.minimumLot);
    let remaining = options.totalCrates - options.lotCount * options.minimumLot;
    while (remaining > 0) {
        const available = sizes.map((size, index) => size < options.maximumLot ? index : -1).filter((index) => index >= 0);
        const index = available[pseudoRandomInteger(0, available.length - 1, random)];
        sizes[index] += 1;
        remaining -= 1;
    }
    return shufflePseudoRandom(sizes, random);
}

function buildPseudoLotDimensions(options, random) {
    const dimensions = [];
    const used = new Set();
    for (let index = 0; index < options.lotCount; index += 1) {
        let tuple = null;
        for (let attempt = 0; attempt < 2000 && !tuple; attempt += 1) {
            const candidate = index < Math.max(options.articleCount, options.customerCount, options.orderCount) && attempt === 0
                ? [index % options.articleCount, index % options.customerCount, index % options.orderCount]
                : [
                    pseudoRandomInteger(0, options.articleCount - 1, random),
                    pseudoRandomInteger(0, options.customerCount - 1, random),
                    pseudoRandomInteger(0, options.orderCount - 1, random),
                ];
            if (!used.has(candidate.join("|"))) tuple = candidate;
        }
        if (!tuple) throw new Error("Impossibile generare combinazioni di lotto univoche con i parametri scelti.");
        used.add(tuple.join("|"));
        dimensions.push(tuple);
    }
    return shufflePseudoRandom(dimensions, random);
}

function buildPseudoRandomWarehouseState(options) {
    const random = createSeededRandom(options.seed);
    const standardCustomers = ["AGPRESS", "FANTINI", "CLIENTE DEMO", "TECNOSTAMPA", "ROSSI SPA"];
    const customers = Array.from({ length: options.customerCount }, (_, index) => standardCustomers[index] || `CLIENTE TEST ${String(index + 1).padStart(2, "0")}`);
    const articles = Array.from({ length: options.articleCount }, (_, index) => index % 3 === 0 ? `T${String(1500000 + index).padStart(7, "0")}A` : `ART-${String(index + 1).padStart(4, "0")}`);
    const orders = Array.from({ length: options.orderCount }, (_, index) => `${24 + index % 3}/${String(10001 + index).padStart(5, "0")}${index % 13 === 12 ? "/C" : ""}`);
    const lotSizes = buildPseudoLotSizes(options, random);
    const dimensions = buildPseudoLotDimensions(options, random);
    const entries = [];
    const pieceDelta = Math.round(options.averagePieces * options.pieceVariation / 100);
    let weighingSequence = 1;
    lotSizes.forEach((lotSize, lotIndex) => {
        const [articleIndex, customerIndex, orderIndex] = dimensions[lotIndex];
        for (let crateIndex = 0; crateIndex < lotSize; crateIndex += 1) {
            const hasWeighingCode = random() * 100 < options.weighingRate;
            entries.push({
                article: articles[articleIndex],
                customer: customers[customerIndex],
                order: orders[orderIndex],
                weighingCode: hasWeighingCode ? `PS-${String(options.seed).padStart(10, "0")}-${String(weighingSequence++).padStart(5, "0")}` : "",
                pieceCount: pseudoRandomInteger(Math.max(1, options.averagePieces - pieceDelta), options.averagePieces + pieceDelta, random),
                quantity: 1,
                type: "crate",
            });
        }
    });
    for (let index = 0; index < options.totalPallets; index += 1) {
        entries.push({
            article: `PALLET-${String(index + 1).padStart(3, "0")}`,
            customer: customers[pseudoRandomInteger(0, customers.length - 1, random)],
            order: orders[pseudoRandomInteger(0, orders.length - 1, random)],
            weighingCode: random() * 100 < options.weighingRate ? `PS-${String(options.seed).padStart(10, "0")}-P${String(index + 1).padStart(3, "0")}` : "",
            pieceCount: pseudoRandomInteger(Math.max(1, options.averagePieces - pieceDelta), options.averagePieces + pieceDelta, random),
            quantity: 1,
            type: "pallet",
        });
    }
    const plan = planLoadOperation(entries, new Map());
    if (plan.error) return plan;
    const receivedDates = new Map();
    const tagOptions = ["preferito", "urgente", "controllo", "riserva"];
    plan.state.forEach((item) => {
        if (!receivedDates.has(item.id)) receivedDates.set(item.id, new Date(Date.now() - pseudoRandomInteger(1, 540, random) * 86400000).toISOString());
        item.receivedAt = receivedDates.get(item.id);
        item.tags = random() < .18 ? [tagOptions[pseudoRandomInteger(0, tagOptions.length - 1, random)]] : [];
    });
    plan.testPopulation = { ...options, entries: entries.length };
    return plan;
}

function resetOperationDraftsAfterDatabaseChange() {
    operationGroups.load.splice(0);
    operationGroups.unload.splice(0);
    operationGroupStages.load = "compose";
    operationGroupStages.unload = "compose";
    completedOperationMovement = null;
    operationPreviewPlan = null;
}

function setupTemporaryDatabaseActions() {
    document.getElementById("populateWarehouseDatabase")?.addEventListener("click", openPseudoPopulateDialog);
    document.getElementById("closePseudoPopulate")?.addEventListener("click", closePseudoPopulateDialog);
    document.getElementById("cancelPseudoPopulate")?.addEventListener("click", closePseudoPopulateDialog);
    document.querySelectorAll("#pseudoPopulateForm input").forEach((input) => input.addEventListener("input", () => {
        document.getElementById("pseudoPopulateStatus").textContent = "";
        renderPseudoPopulationSummary();
    }));
    document.getElementById("pseudoPopulateForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!isExclusiveTestDatabaseAdmin()) {
            closePseudoPopulateDialog();
            showWarehouseToast("Funzione riservata all'admin Ayrton Pizzi.", true);
            return;
        }
        const result = readPseudoPopulationOptions();
        const status = document.getElementById("pseudoPopulateStatus");
        if (result.error) {
            status.textContent = result.error;
            renderPseudoPopulationSummary();
            return;
        }
        if ((inventory.size || movementHistory.length) && !await showWarehouseConfirm({
            title: "Sostituisci database di test",
            message: `Tutte le giacenze, l'area ${STAGING_AREA_LABEL} e lo storico saranno sostituiti con ${result.options.totalCrates} cassoni e ${result.options.totalPallets} pallet pseudo-randomici.`,
            confirmLabel: "Sostituisci dati",
            danger: true,
        })) return;
        setTestDatabaseButtonsDisabled(true);
        const submitButton = document.getElementById("confirmPseudoPopulate");
        submitButton.disabled = true;
        status.textContent = "Calcolo dell'allocazione in corso…";
        try {
            await new Promise((resolve) => setTimeout(resolve, 0));
            const plan = buildPseudoRandomWarehouseState(result.options);
            if (plan.error) throw new Error(plan.error);
            inventory.clear();
            plan.state.forEach((item, location) => inventory.set(location, item));
            movementHistory.splice(0);
            unloadZone.splice(0);
            resetOperationDraftsAfterDatabaseChange();
            refreshWarehouseDataViews();
            await persistWarehouseData();
            closePseudoPopulateDialog();
            showWarehouseToast(`Scenario creato: ${result.options.totalCrates} cassoni, ${result.options.totalPallets} pallet, ${result.options.lotCount} lotti · seed ${result.options.seed}.`);
        } catch (error) {
            status.textContent = `Popolamento non completato: ${error.message}`;
            showWarehouseToast(status.textContent, true);
        } finally {
            setTestDatabaseButtonsDisabled(false);
            submitButton.disabled = false;
        }
    });

    document.getElementById("clearWarehouseDatabase")?.addEventListener("click", async () => {
        if (!isExclusiveTestDatabaseAdmin()) {
            showWarehouseToast("Funzione riservata all'admin Ayrton Pizzi.", true);
            return;
        }
        if (!await showWarehouseConfirm({
            title: "Svuota database magazzino",
            message: `Giacenze, area ${STAGING_AREA_LABEL} e storico verranno eliminati completamente. L'operazione non è annullabile.`,
            confirmLabel: "Svuota database",
            danger: true,
        })) return;
        setTestDatabaseButtonsDisabled(true);
        try {
            inventory.clear();
            movementHistory.splice(0);
            unloadZone.splice(0);
            resetOperationDraftsAfterDatabaseChange();
            refreshWarehouseDataViews();
            await persistWarehouseData();
            showWarehouseToast("Database del magazzino svuotato completamente.");
        } catch (error) {
            showWarehouseToast(`Svuotamento non salvato: ${error.message}`, true);
        } finally {
            setTestDatabaseButtonsDisabled(false);
        }
    });
}

setupWarehouseSplash();
setupWarehouseDialogFocus();
renderTabs();
renderMap();
setupDisplayMode();
setupSlotPager();
setupToolsDrawer();
setupWarehouseStructure();
setupLoadDialog();
setupManualMovement();
setupWarehouseOptimizer();
setupUnloadZone();
setupSlotPreview();
setupContextMenu();
setupSlotAreaSelection();
setupInventorySearch();
setupAnalysisView();
setupRestrictionDialog();
setupTemporaryDatabaseActions();
setupWarehouse3dViewer();
setupWarehouseLogin();
updateSummary();
void initializeWarehouseAuthentication();
void initializeWarehousePersistence();
