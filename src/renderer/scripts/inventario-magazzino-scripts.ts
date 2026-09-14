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
let displayMode = "article";
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
let manualMovementMode = "load";
const selectedSlotCodes = new Set();
let relocationSourceCode = null;
let restrictionBatchTargets = null;
let completedOperationMovement = null;
let operationPreviewPlan = null;
let suppressSlotClickUntil = 0;
let warehouseRevision = 0;
let warehousePersistenceReady = false;
let warehousePersistenceQueue = Promise.resolve();
const warehousePersistenceMode = process.env.AYPI_WAREHOUSE_USE_BACKEND === "1" ? "backend" : "local";

function warehouseStorageLabel() {
    return warehousePersistenceMode === "backend" ? "SQLite condiviso" : "SQLite locale";
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
    ["openLoadButton", "openUnloadButton", "openManualMovementButton"].forEach((id) => {
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
    if (!isWarehouseAdmin()) closeRestrictionDialog();
    renderUnloadZone();
}

function applyWarehouseSession(payload) {
    Object.assign(warehouseSession, { role: "guest", adminName: "", department: "", employee: "" },
        payload && ["employee", "admin"].includes(payload.role) ? payload : {});
    syncWarehouseSessionUi();
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

function openWarehouseLogin() {
    const dialog = document.getElementById("warehouseLoginDialog");
    dialog?.classList.add("is-open");
    dialog?.setAttribute("aria-hidden", "false");
}

function closeWarehouseLogin() {
    const dialog = document.getElementById("warehouseLoginDialog");
    dialog?.classList.remove("is-open");
    dialog?.setAttribute("aria-hidden", "true");
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
    return warehousePersistenceMode === "backend"
        ? requestBackend("/api/warehouse-inventory/state")
        : ipcRenderer.invoke("warehouse-inventory-local-load");
}

function savePersistedWarehouseData(snapshot) {
    return warehousePersistenceMode === "backend"
        ? requestBackend("/api/warehouse-inventory/state", { method: "PUT", body: snapshot })
        : ipcRenderer.invoke("warehouse-inventory-local-save", snapshot);
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
        partial: false,
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
        inventory.set(item.location, {
            ...item,
            tags: Array.isArray(item.tags) ? [...item.tags] : [],
            pairedLocation: item.pairedLocation || null,
        });
    });
    unloadZone.splice(0, unloadZone.length, ...cloneUnloadZoneUnits(snapshot?.unloadZone || []));
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
}

function setTestDatabaseButtonsDisabled(disabled) {
    document.getElementById("populateWarehouseDatabase").disabled = disabled;
    document.getElementById("clearWarehouseDatabase").disabled = disabled;
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
    if (displayMode === "customer") return item.customer === selectedItem.customer;
    if (displayMode === "order") return item.orderReference === selectedItem.orderReference;
    if (displayMode === "combined") {
        return item.article === selectedItem.article && item.orderReference === selectedItem.orderReference;
    }
    return item.article === selectedItem.article;
}

function cellLabel(code, item) {
    if (!item) return displayMode === "location" ? code : "Libero";
    if (displayMode === "article") return item.article;
    if (displayMode === "customer") return item.customer;
    if (displayMode === "order") return item.orderReference;
    if (displayMode === "combined") return `${code} · ${item.article} · ${item.orderReference}`;
    return code;
}

function renderCellLabel(button, code, item) {
    button.replaceChildren();
    if (displayMode !== "combined" || !item) {
        button.textContent = cellLabel(code, item);
        return;
    }
    [
        [code, "location"],
        [item.article, "article"],
        [item.orderReference, "order"],
    ].forEach(([text, type]) => {
        const line = document.createElement("span");
        line.className = `slot__line slot__line--${type}`;
        line.textContent = text;
        button.appendChild(line);
    });
}

function fitSlotButtonLabel(button) {
    const combined = displayMode === "combined" && button.querySelector(".slot__line");
    let size = slotRangeMode === "paged" ? 14 : combined ? 12 : 11;
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
    button.classList.toggle("is-partial", Boolean(item?.partial));
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
    levelsContainer.dataset.displayMode = displayMode;
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
    status.className = blockingPalletId ? "blocked-badge" : item?.partial ? "partial-badge" : item ? "occupied-badge" : "free-badge";
    status.textContent = blockingPalletId ? "Bloccato da pallet" : item?.partial ? "Parziale" : item ? "Occupato" : "Libero";
    setDetailRowVisibility("detailTypeRow", Boolean(item));
    setDetailRowVisibility("detailPairRow", item?.type === "pallet");
    setDetailRowVisibility("detailArticleRow", Boolean(item));
    setDetailRowVisibility("detailCustomerRow", Boolean(item));
    setDetailRowVisibility("detailOrderRow", Boolean(item));
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
        document.getElementById("detailOrder").textContent = item.orderReference;
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
        ? "Cassone dimostrativo. Tasto destro sulla cella per modificare lo stato parziale."
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
    const toggleButton = document.getElementById("togglePartialButton");
    const hint = document.getElementById("contextMenuHint");
    const item = inventory.get(code);
    if (!menu || !toggleButton || !hint) return;
    menu.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    contextSlotCode = code;
    const multiSelection = selectedSlotCodes.size > 1 && selectedSlotCodes.has(code);
    const selectedItems = Array.from(selectedSlotCodes).map((location) => inventory.get(location)).filter(Boolean);
    document.getElementById("contextSlotCode").textContent = multiSelection ? `${selectedSlotCodes.size} posizioni selezionate` : code;
    toggleButton.hidden = multiSelection;
    toggleButton.disabled = !item || item.type === "pallet";
    toggleButton.textContent = item?.partial ? "Rimuovi stato parziale" : "Segna come parziale";
    document.getElementById("markSelectionPartial").hidden = !multiSelection;
    document.getElementById("clearSelectionPartial").hidden = !multiSelection;
    document.getElementById("markSelectionPartial").disabled = !selectedItems.some((selected) => selected.type === "crate");
    document.getElementById("clearSelectionPartial").disabled = !selectedItems.some((selected) => selected.type === "crate");
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
    document.getElementById("togglePartialButton")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const item = contextSlotCode ? inventory.get(contextSlotCode) : null;
        if (!item) return;
        item.partial = !item.partial;
        refreshInventorySearch();
        renderDetails();
        void persistWarehouseData().catch(() => {});
        closeContextMenu();
    });
    document.getElementById("markSelectionPartial")?.addEventListener("click", (event) => {
        event.stopPropagation();
        let changed = 0;
        selectedSlotCodes.forEach((location) => {
            const item = inventory.get(location);
            if (item?.type === "crate") {
                item.partial = true;
                changed += 1;
            }
        });
        refreshWarehouseAfterManualChange();
        void persistWarehouseData().catch(() => {});
        closeContextMenu();
        showWarehouseToast(`${changed} ${changed === 1 ? "cassone segnato" : "cassoni segnati"} come parziali.`);
    });
    document.getElementById("clearSelectionPartial")?.addEventListener("click", (event) => {
        event.stopPropagation();
        let changed = 0;
        selectedSlotCodes.forEach((location) => {
            const item = inventory.get(location);
            if (item?.type === "crate") {
                item.partial = false;
                changed += 1;
            }
        });
        refreshWarehouseAfterManualChange();
        void persistWarehouseData().catch(() => {});
        closeContextMenu();
        showWarehouseToast(`Stato parziale rimosso da ${changed} ${changed === 1 ? "cassone" : "cassoni"}.`);
    });
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
    document.getElementById("displayMode")?.addEventListener("change", (event) => {
        displayMode = event.target.value;
        renderMap();
    });
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
    editingOperationLineIndex = null;
    document.getElementById("addOperationLine").textContent = `Aggiungi al gruppo di ${operationModeLabel()}`;
    document.getElementById("loadFormMessage").textContent = "";
    updateLoadTypeNote();
}

function configureOperationDialog() {
    const load = operationGroupMode === "load";
    document.getElementById("operationDialogEyebrow").textContent = load ? "NUOVO GRUPPO DI CARICO" : "NUOVO GRUPPO DI SCARICO";
    document.getElementById("operationDialogTitle").textContent = load ? "Componi il carico" : "Componi lo scarico";
    document.getElementById("operationDialogDescription").textContent = load
        ? "Inserisci tutti gli articoli prima di calcolare la proposta complessiva."
        : "Inserisci più articoli o importa le unità selezionate dalla ricerca prima del calcolo FIFO.";
    document.getElementById("operationPartialField").hidden = !load;
    document.getElementById("loadCustomer").required = load;
    document.getElementById("loadOrderReference").required = load;
    document.getElementById("operationOrderLabelText").textContent = load
        ? "Riferimento ordine"
        : "Riferimento ordine (opzionale · vuoto = FIFO globale)";
    document.getElementById("loadOrderReference").placeholder = load
        ? "es. 25/00114 oppure 25/00114/C"
        : "Lascia vuoto per prelevare i più vecchi";
    document.getElementById("reviewOperationGroup").textContent = `Visualizza ${operationModeLabel()}`;
    document.getElementById("confirmOperationGroup").textContent = `Conferma gruppo di ${operationModeLabel()}`;
    updateLoadTypeNote();
}

function createOperationLineElement(entry, index, review = false) {
    const row = document.createElement("article");
    row.className = "operation-line";
    const main = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.article;
    const meta = document.createElement("small");
    const orderDescription = entry.order
        ? entry.order
        : operationGroupMode === "unload" ? "Tutti gli ordini · FIFO più vecchio" : "Ordine non indicato";
    const details = [entry.customer || "Qualsiasi cliente", orderDescription, entry.type === "pallet" ? "Pallet" : "Cassone"];
    if (entry.partial && operationGroupMode === "load") details.push("Parziale");
    if (entry.sourceLocations?.length) details.push(`Da ${entry.sourceLocations.join(" + ")}`);
    meta.textContent = details.join(" · ");
    main.append(title, meta);
    const quantity = document.createElement("b");
    quantity.textContent = `${entry.quantity} ${entry.type === "pallet" ? (entry.quantity === 1 ? "pallet" : "pallet") : entry.quantity === 1 ? "cassone" : "cassoni"}`;
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
    const units = entries.reduce((total, entry) => total + entry.quantity, 0);
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
    document.getElementById("operationReviewCrateCount").textContent = String(entries.filter((entry) => entry.type === "crate").reduce((total, entry) => total + entry.quantity, 0));
    document.getElementById("operationReviewPalletCount").textContent = String(entries.filter((entry) => entry.type === "pallet").reduce((total, entry) => total + entry.quantity, 0));
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
    document.getElementById("loadArticle").value = entry.article;
    document.getElementById("loadCustomer").value = entry.customer;
    document.getElementById("loadOrderReference").value = entry.order;
    document.getElementById("loadQuantity").value = String(entry.quantity);
    document.getElementById("loadPartial").value = entry.partial ? "yes" : "no";
    document.getElementById("loadType").value = entry.type;
    document.getElementById("addOperationLine").textContent = "Salva modifica";
    document.getElementById("loadFormMessage").textContent = `Modifica della riga ${index + 1}.`;
    updateLoadTypeNote();
    document.getElementById("loadArticle")?.focus();
}

async function focusOperationDialogInput() {
    try {
        await ipcRenderer.invoke("warehouse-inventory-focus-window");
    } catch {
        window.focus();
    }
    requestAnimationFrame(() => {
        const input = document.getElementById("loadArticle");
        input?.focus({ preventScroll: true });
        input?.select();
    });
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
    if (dialog) dialog.inert = false;
    dialog?.classList.add("is-open");
    dialog?.setAttribute("aria-hidden", "false");
    if ((stage || operationGroupStages[mode]) === "compose") {
        void focusOperationDialogInput();
    }
}

function closeOperationDialog() {
    const dialog = document.getElementById("operationGroupDialog");
    dialog?.classList.remove("is-open");
    dialog?.setAttribute("aria-hidden", "true");
}

function cancelOperationGroup() {
    const entries = activeOperationGroup();
    if (entries.length && !window.confirm(`Annullare completamente il gruppo di ${operationModeLabel()}?`)) return;
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
    const grouped = new Map();
    units.forEach((item) => {
        const key = [item.article, item.customer, item.orderReference, item.type, item.partial].join("|");
        if (!grouped.has(key)) grouped.set(key, { article: item.article, customer: item.customer, order: item.orderReference, quantity: 0, partial: item.partial, type: item.type, sourceIds: [], sourceLocations: [] });
        const entry = grouped.get(key);
        entry.quantity += 1;
        entry.sourceIds.push(item.id);
        const sourceLocation = item.type === "pallet"
            ? [item.location, item.pairedLocation].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).join(" + ")
            : item.location;
        entry.sourceLocations.push(sourceLocation);
    });
    grouped.forEach((entry) => operationGroups.unload.push({ ...entry, id: nextOperationLineId++ }));
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

function validCrateDestination(state, parsed, customer) {
    if (!parsed || state.has(parsed.code) || stateHasBlockingPallet(state, parsed)) return false;
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
                    Math.abs(rowCodes().indexOf(parsed.row) - rowCodes().indexOf(existing.row)) * CRATE_SORTING_WEIGHTS.differentRowDistance
                    + Math.abs(parsed.physicalColumn - existing.physicalColumn) * CRATE_SORTING_WEIGHTS.physicalColumnDistance
                    + (parsed.side === existing.side ? 0 : CRATE_SORTING_WEIGHTS.oppositeSideDistance)
                )))
                : rowCodes().indexOf(parsed.row) * CRATE_SORTING_WEIGHTS.initialRowOrder
                    + parsed.physicalColumn * CRATE_SORTING_WEIGHTS.initialColumnOrder;
            distanceByStack.set(`${parsed.row}:${parsed.number}`, distance);
        }
    });
    return {
        hasExistingArticle: locations.length > 0,
        distance: (parsed) => distanceByStack.get(`${parsed.row}:${parsed.number}`) || 0,
    };
}

function scoreCratePlan(initialState, state, locations, article, movements, scoreContext) {
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
    return movements * CRATE_SORTING_WEIGHTS.forkliftMovement
        + touchedStacks.size * CRATE_SORTING_WEIGHTS.touchedStack
        + newArticleDivisions * CRATE_SORTING_WEIGHTS.newArticleDivision
        + touchedModules.size * CRATE_SORTING_WEIGHTS.touchedPhysicalModule
        + newPhysicalModules * CRATE_SORTING_WEIGHTS.newPhysicalModule
        + mixedStacks * CRATE_SORTING_WEIGHTS.mixedArticleStack
        + mixedUnits * CRATE_SORTING_WEIGHTS.mixedArticleUnit
        + frontUnits * CRATE_SORTING_WEIGHTS.frontUnit
        + completedStacks * CRATE_SORTING_WEIGHTS.completeStack
        + residualSingleCompletions * CRATE_SORTING_WEIGHTS.residualSingleCompletion
        + twoHighStacks * CRATE_SORTING_WEIGHTS.twoHighStack
        + pairedArticleModules * CRATE_SORTING_WEIGHTS.sameArticleFrontRearModule
        + fullPairedArticleModules * CRATE_SORTING_WEIGHTS.fullArticleFrontRearModule
        + continuedArticleUnits * CRATE_SORTING_WEIGHTS.continueExistingArticleUnit
        + distanceScore
        + initialPositionScore;
}

function scoreCrateMoveCandidate(state, move, article, scoreContext, requestedQuantity) {
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
    return CRATE_SORTING_WEIGHTS.forkliftMovement
        + CRATE_SORTING_WEIGHTS.touchedStack
        + CRATE_SORTING_WEIGHTS.touchedPhysicalModule
        + (stack.some((item) => item.article !== article)
            ? CRATE_SORTING_WEIGHTS.mixedArticleStack + move.codes.length * CRATE_SORTING_WEIGHTS.mixedArticleUnit
            : 0)
        + (!stack.some((item) => item.article === article) ? CRATE_SORTING_WEIGHTS.newArticleDivision : 0)
        + (moduleWasEmpty ? CRATE_SORTING_WEIGHTS.newPhysicalModule : 0)
        + move.codes.filter((code) => parseSlotCode(code).side === "front").length * CRATE_SORTING_WEIGHTS.frontUnit
        + (finalHeight === 3 ? CRATE_SORTING_WEIGHTS.completeStack : finalHeight === 2 ? CRATE_SORTING_WEIGHTS.twoHighStack : 0)
        + (requestedQuantity % 3 === 1 && stack.length === 2 && move.codes.length === 1
            ? CRATE_SORTING_WEIGHTS.residualSingleCompletion
            : 0)
        + (sideHasArticle(rearNumber) && sideHasArticle(frontNumber) && !moduleHasOtherArticle
            ? CRATE_SORTING_WEIGHTS.sameArticleFrontRearModule
            : 0)
        + (sideIsFullArticle(rearNumber) && sideIsFullArticle(frontNumber) && !moduleHasOtherArticle
            ? CRATE_SORTING_WEIGHTS.fullArticleFrontRearModule
            : 0)
        + distance;
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
                    quickScore: scoreCrateMoveCandidate(node.state, move, entry.article, scoreContext, quantity),
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
                    score: scoreCratePlan(initialState, moveState, locations, entry.article, movements, scoreContext),
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
            const columnCodes = [front, rear].flatMap((ground) => {
                const number = parseSlotCode(ground).number;
                return ["a", "b", "c"].map((level) => `${row}${number}${level}`);
            });
            if (columnCodes.some((code) => state.has(code))) continue;
            if (![front, rear].every((code) => evaluateCustomerForSlot(code, customer).allowed)) continue;
            const parsed = parseSlotCode(rear);
            const distance = articleLocations.length
                ? Math.min(...articleLocations.map((existing) => (
                    Math.abs(rowCodes().indexOf(row) - rowCodes().indexOf(existing.row)) * CRATE_SORTING_WEIGHTS.differentRowDistance
                    + Math.abs(parsed.physicalColumn - existing.physicalColumn) * CRATE_SORTING_WEIGHTS.physicalColumnDistance
                )))
                : rowCodes().indexOf(row) * CRATE_SORTING_WEIGHTS.initialRowOrder
                    + parsed.physicalColumn * CRATE_SORTING_WEIGHTS.initialColumnOrder;
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
    const grouped = new Map();
    actions.forEach((action) => {
        if (!grouped.has(action.article)) grouped.set(action.article, []);
        grouped.get(action.article).push(...action.locations);
    });
    return Array.from(grouped, ([article, locations]) => ({ article, locations }));
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
    return [entry.type, entry.article, entry.customer, entry.order, entry.partial ? "1" : "0", entry.quantity].join("|");
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
    const beamWidth = entries.length <= JOINT_LOAD_LIMITS.smallBlockEntries
        ? JOINT_LOAD_LIMITS.smallBeam
        : entries.length <= JOINT_LOAD_LIMITS.mediumBlockEntries
          ? JOINT_LOAD_LIMITS.mediumBeam
          : JOINT_LOAD_LIMITS.largeBeam;
    const entryBranches = entries.length <= JOINT_LOAD_LIMITS.smallBlockEntries
        ? JOINT_LOAD_LIMITS.smallEntryBranches
        : entries.length <= JOINT_LOAD_LIMITS.mediumBlockEntries
          ? JOINT_LOAD_LIMITS.mediumEntryBranches
          : JOINT_LOAD_LIMITS.largeEntryBranches;
    const allocationVariants = entries.length <= JOINT_LOAD_LIMITS.smallBlockEntries
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

function planLoadOperation(entries, initialState = inventory) {
    const jointPlan = planJointLoadAllocation(entries, initialState);
    if (!jointPlan) return { error: "Spazio valido insufficiente: impossibile trovare una combinazione congiunta per l'intero gruppo di carico." };
    const state = cloneInventoryState(initialState);
    const actions = [];
    const timestamp = new Date();
    let sequence = 0;
    entries.forEach((entry, entryIndex) => {
        const allocation = jointPlan.allocations[entryIndex];
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
                tags: [],
                inMovement: false,
                partial: entry.partial,
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
                    tags: [],
                    inMovement: false,
                    partial: entry.partial,
                    type: "pallet",
                    pairedLocation: pair[index === 0 ? 1 : 0],
                    receivedAt,
                }));
                locations.push(pair.join(" + "));
            });
        } else {
            allocation.locations.forEach(insertCrate);
        }
        actions.push({ article: entry.article, locations });
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
    after.forEach((unit, id) => {
        if (!before.has(id)) {
            loaded.push({ id, article: unit.item.article, from: [], to: [...unit.locations] });
            return;
        }
        const previous = before.get(id);
        if (previous.locations.join("|") !== unit.locations.join("|")) {
            shifted.push({ id, article: unit.item.article, from: [...previous.locations], to: [...unit.locations] });
        }
    });
    before.forEach((unit, id) => {
        if (!after.has(id)) unloaded.push({ id, article: unit.item.article, from: [...unit.locations], to: [] });
    });
    return { loaded, unloaded, shifted };
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
    return { humanMovements, releasedStacks, releasedModules, frontUnits, rearUnits };
}

const UNLOAD_SELECTION_WEIGHTS = Object.freeze({
    humanMovement: 1000,
    firstReleasedModuleCredit: 1100,
    releasedStackCredit: 60,
    rearUnitPenalty: 25,
    combinationBeamWidth: 64,
});

function scoreUnloadSelection(metrics) {
    return metrics.humanMovements * UNLOAD_SELECTION_WEIGHTS.humanMovement
        - (metrics.releasedModules > 0 ? UNLOAD_SELECTION_WEIGHTS.firstReleasedModuleCredit : 0)
        - metrics.releasedStacks * UNLOAD_SELECTION_WEIGHTS.releasedStackCredit
        + metrics.rearUnits * UNLOAD_SELECTION_WEIGHTS.rearUnitPenalty;
}

function compareUnloadSelectionNodes(left, right) {
    return left.score - right.score
        || left.metrics.humanMovements - right.metrics.humanMovements
        || right.metrics.releasedModules - left.metrics.releasedModules
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
    sourceState.forEach((item, location) => {
        if (item.type !== "crate" || (!selectedIds.has(item.id) && !affectedIds.has(item.id))) return;
        const parsed = parseSlotCode(location);
        const key = `${parsed.row}:${parsed.physicalColumn}:${parsed.side}`;
        if (!stacks.has(key)) stacks.set(key, { parsed, units: [] });
        stacks.get(key).units.push({ item, location, parsed });
    });
    return Array.from(stacks.values()).sort((left, right) => {
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
                to: kind === "unload" ? ["Zona scarico"] : ["Corridoio"],
                units: ordered.map((unit) => operationalUnit(
                    unit.item,
                    unit.location,
                    kind === "unload" ? "Zona scarico" : relocationById.get(unit.item.id)?.to?.[0] || "",
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
            to: ["Zona scarico"],
            units: [operationalUnit(unit.item, locations.join(" + "), "Zona scarico")],
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
    const selectedUnits = [];
    for (const entry of entries) {
        const requestedIds = new Set(entry.sourceIds || []);
        const candidates = logicalUnits.filter(({ item }) => !selectedIds.has(item.id)
            && item.article === entry.article
            && (!entry.customer || item.customer === entry.customer)
            && (!entry.order || item.orderReference === entry.order)
            && (!entry.type || item.type === entry.type)
            && (!requestedIds.size || requestedIds.has(item.id)));
        if (candidates.length < entry.quantity) {
            const orderText = entry.order ? ` per l'ordine ${entry.order}` : " considerando tutti gli ordini";
            return { error: `Disponibilità insufficiente: richieste ${entry.quantity} unità di ${entry.article}${orderText}, trovate ${candidates.length}.` };
        }
        chooseUnloadUnits(sourceState, candidates, entry.quantity, selectedIds, requestedIds.size > 0).forEach((unit) => {
            selectedIds.add(unit.item.id);
            selectedUnits.push(unit);
        });
    }
    const affectedUnits = collectUnloadAffectedUnits(sourceState, selectedIds);
    const reallocation = restoreUnloadObstructionsLocally(sourceState, selectedUnits, affectedUnits);
    if (reallocation.error) return reallocation;
    const unloadedUnits = selectedUnits.map(({ item, locations }) => ({
        ...item,
        location: null,
        pairedLocation: null,
        tags: [...(item.tags || [])],
        inMovement: true,
        originalLocations: [...locations].sort((a, b) => a.localeCompare(b, "it", { numeric: true })),
        stagedAt: new Date().toISOString(),
    }));
    const metrics = estimateUnloadSelection(sourceState, selectedIds);
    const operationalSteps = buildUnloadOperationalSteps(sourceState, selectedUnits, reallocation.relocations);
    return {
        state: reallocation.state,
        lines: buildUnloadMovementLines(selectedUnits, reallocation.relocations),
        operationalSteps,
        unloadedUnits,
        humanMovements: metrics.humanMovements,
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
    details.textContent = `${item.type === "pallet" ? "Pallet" : "Cassone"} · ${item.customer || "Cliente non indicato"} · ${item.orderReference || "Rif. ordine non indicato"}${item.partial ? " · Parziale" : ""}`;
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
    dialog?.classList.add("is-open");
    dialog?.setAttribute("aria-hidden", "false");
    window.setTimeout(() => field?.focus(), 0);
}

function closeManualMovementDialog() {
    const dialog = document.getElementById("manualMovementDialog");
    dialog?.classList.remove("is-open");
    dialog?.setAttribute("aria-hidden", "true");
}

async function commitManualLoad() {
    const beforeState = serializeWarehouseInventory();
    const location = parseSlotCode(document.getElementById("manualMovementLocation").value)?.code || "";
    const article = document.getElementById("manualLoadArticle").value.trim();
    const customer = document.getElementById("manualLoadCustomer").value.trim();
    const orderReference = document.getElementById("manualLoadOrder").value.trim();
    if (!article) return { error: "Indica l'articolo del cassone da caricare." };
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
        tags: [],
        inMovement: false,
        partial: document.getElementById("manualLoadPartial").value === "yes",
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
        message: `${movement.id}: ${item.article} è stato prelevato da ${parsed.code} e portato nella Zona scarico.${plan.relocations?.length ? ` ${plan.relocations.length} riallocazioni necessarie.` : ""}`,
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
        document.getElementById("manualMovementLocation")?.focus();
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
            quantity: entry.quantity,
            partial: entry.partial,
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
            if (step.kind === "corridor") {
                title.textContent = step.wholeStack
                    ? `Sposta temporaneamente l'intera pila ${source} nel corridoio`
                    : `Sposta temporaneamente ${crateWording(step.from?.length || 0)} ${source} nel corridoio`;
            } else if (step.kind === "unload") {
                const pallet = step.units?.length === 1 && step.units[0].type === "pallet";
                title.textContent = pallet
                    ? `Preleva il pallet ${source} e posizionalo nella Zona scarico`
                    : `Preleva ${crateWording(step.from?.length || 0)} ${source} e ${step.from?.length === 1 ? "posizionalo" : "posizionali"} nella Zona scarico`;
            } else {
                title.textContent = step.wholeStack
                    ? `Ricolloca insieme l'intera pila dal corridoio in ${destination}`
                    : `Ricolloca dal corridoio ${crateWording(step.to?.length || 0)} in ${destination}`;
            }
            const details = document.createElement("p");
            details.textContent = operationalUnitsDescription(step.units || []);
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
            : line.kind === "relocated"
              ? `Rialloca articolo ${line.article}`
              : line.kind === "loaded"
                ? `Carica articolo ${line.article}`
                : `Articolo ${line.article}`;
        const locations = document.createElement("p");
        locations.textContent = `${line.kind === "relocated" ? "Spostamenti" : line.kind === "unloaded" ? "Preleva da" : line.kind === "loaded" ? "Carica in" : "Posizioni"} ${line.locations.join(", ")}`;
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

function operationalUnitsDescription(units) {
    if (!units.length) return "";
    const signature = (unit) => `${unit.article}|${unit.customer}|${unit.orderReference}`;
    const allEqual = units.every((unit) => signature(unit) === signature(units[0]));
    const describe = (unit) => `articolo ${unit.article || "—"} · cliente ${unit.customer || "—"} · ordine ${unit.orderReference || "—"}`;
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
        empty.textContent = "Lo storico si popolerà completando un gruppo automatico di carico o scarico.";
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
        badge.textContent = `${movement.type === "load" ? "Carico" : "Scarico"}${movement.manual ? " manuale" : ""}`;
        header.append(heading, badge);
        const lines = document.createElement("div");
        lines.className = "movement-history-card__lines";
        appendMovementLines(lines, movement);
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
    const dialog = document.getElementById("movementHistoryDialog");
    dialog?.classList.add("is-open");
    dialog?.setAttribute("aria-hidden", "false");
}

function closeMovementHistoryDialog() {
    const dialog = document.getElementById("movementHistoryDialog");
    dialog?.classList.remove("is-open");
    dialog?.setAttribute("aria-hidden", "true");
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
    else document.getElementById("loadArticle")?.focus();
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
    if (summary) summary.textContent = unloadZone.length
        ? `${unloadZone.length} ${unloadZone.length === 1 ? "unità in attesa" : "unità in attesa"}`
        : "Zona vuota";
    const confirmButton = document.getElementById("confirmVehicleLoad");
    if (confirmButton) confirmButton.disabled = !unloadZone.length || warehouseStorageUnavailable || !isWarehouseLoggedIn();
    const list = document.getElementById("unloadZoneList");
    if (!list) return;
    list.replaceChildren();
    if (!unloadZone.length) {
        const empty = document.createElement("p");
        empty.className = "unload-zone-empty";
        empty.textContent = "Gli articoli scaricati compariranno qui fino alla conferma del caricamento sul veicolo.";
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
            item.type === "pallet" ? "Pallet" : item.partial ? "Cassone · parziale" : "Cassone",
            (item.originalLocations || []).join(" + ") || "—",
            "In attesa",
        ];
        values.forEach((value, index) => {
            const cell = document.createElement(index === 0 ? "strong" : "span");
            cell.textContent = value;
            if (index === 5) cell.className = "unload-zone-status";
            row.appendChild(cell);
        });
        row.title = "Tasto destro per ricaricare questa unità a magazzino";
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
    const dialog = document.getElementById("unloadZoneDialog");
    dialog?.classList.add("is-open");
    dialog?.setAttribute("aria-hidden", "false");
}

function closeUnloadZoneDialog() {
    closeUnloadZoneContextMenu();
    const dialog = document.getElementById("unloadZoneDialog");
    dialog?.classList.remove("is-open");
    dialog?.setAttribute("aria-hidden", "true");
}

async function reloadUnloadZoneUnit(unitId) {
    if (!isWarehouseLoggedIn()) {
        openWarehouseLogin();
        return { error: "Effettua il login operatore prima di ricaricare la merce." };
    }
    const staged = unloadZone.find((item) => item.id === unitId);
    if (!staged) return { error: "L'unità selezionata non è più presente nella zona scarico." };
    const beforeState = serializeWarehouseInventory();
    const entry = {
        article: staged.article,
        customer: staged.customer,
        order: staged.orderReference,
        quantity: 1,
        partial: Boolean(staged.partial),
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
    const { originalLocations: _originalLocations, stagedAt: _stagedAt, ...warehouseItem } = staged;
    destinations.forEach((location, index) => {
        plan.state.set(location, {
            ...warehouseItem,
            id: staged.id,
            location,
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
        lines: [{ article: staged.article, locations: staged.type === "pallet" ? [destinations.join(" + ")] : destinations }],
        beforeState: cloneWarehouseRows(beforeState),
        afterState: cloneWarehouseRows(afterState),
        changes: buildMovementChanges(beforeState, afterState),
    };
    const nextUnloadZone = unloadZone.filter((item) => item.id !== unitId);
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
    return { movement };
}

async function confirmVehicleLoad() {
    if (!unloadZone.length) return;
    if (!isWarehouseLoggedIn()) {
        openWarehouseLogin();
        return;
    }
    const quantity = unloadZone.length;
    if (!window.confirm(`Confermare il caricamento sul veicolo di ${quantity} ${quantity === 1 ? "unità" : "unità"}? Le unità usciranno definitivamente dalla zona scarico.`)) return;
    const button = document.getElementById("confirmVehicleLoad");
    button.disabled = true;
    try {
        await persistWarehouseData(serializeWarehouseInventory(), serializeWarehouseMovements(), []);
        unloadZone.splice(0);
        renderUnloadZone();
        showWarehouseToast(`Caricamento veicolo confermato: ${quantity} ${quantity === 1 ? "unità rimossa" : "unità rimosse"} dalla zona scarico.`);
    } catch (error) {
        showWarehouseToast(`Conferma non salvata: ${error.message}`, true);
        renderUnloadZone();
    }
}

function setupUnloadZone() {
    document.getElementById("openUnloadZoneButton")?.addEventListener("click", openUnloadZoneDialog);
    document.getElementById("closeUnloadZone")?.addEventListener("click", closeUnloadZoneDialog);
    document.getElementById("reloadUnloadZoneUnit")?.addEventListener("click", async () => {
        const unitId = contextUnloadZoneUnitId;
        closeUnloadZoneContextMenu();
        if (!unitId) return;
        const result = await reloadUnloadZoneUnit(unitId);
        showWarehouseToast(result.error || `${result.movement.id}: unità ricaricata a magazzino.`, Boolean(result.error));
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
    document.getElementById("loadType")?.addEventListener("change", updateLoadTypeNote);
    document.getElementById("operationLineForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const article = document.getElementById("loadArticle").value.trim();
        const customer = document.getElementById("loadCustomer").value.trim();
        const order = document.getElementById("loadOrderReference").value.trim();
        const quantity = Number(document.getElementById("loadQuantity").value);
        const partial = operationGroupMode === "load" && document.getElementById("loadPartial").value === "yes";
        const type = document.getElementById("loadType").value;
        const previous = editingOperationLineIndex === null ? null : activeOperationGroup()[editingOperationLineIndex];
        const entry = { id: previous?.id || nextOperationLineId++, article, customer, order, quantity, partial, type, sourceIds: previous?.sourceIds || [], sourceLocations: previous?.sourceLocations || [] };
        if (editingOperationLineIndex === null) activeOperationGroup().push(entry);
        else activeOperationGroup()[editingOperationLineIndex] = entry;
        operationPreviewPlan = null;
        resetOperationLineForm();
        renderOperationGroup();
        document.getElementById("loadFormMessage").textContent = previous ? "Riga aggiornata." : `Articolo aggiunto al gruppo di ${operationModeLabel()}.`;
        document.getElementById("loadArticle")?.focus();
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
        if (!window.confirm(`Disconnettere ${warehouseActorSnapshot().displayName}?`)) return;
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
        tags: item.tags.join(" "),
        type: item.type === "pallet" ? "pallet bancale" : "cassone",
        partial: item.partial ? "parziale parziali" : "",
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
        order.textContent = item.orderReference;
        order.title = `Rif. ordine: ${item.orderReference}`;
        const flags = document.createElement("div");
        flags.className = "result-flags";
        if (item.tags.length) {
            const tagFlag = createResultFlag("Tag");
            tagFlag.title = item.tags.join(", ");
            flags.appendChild(tagFlag);
        }
        if (item.partial) flags.appendChild(createResultFlag("Parziale", "result-flag--partial"));
        if (item.inMovement) flags.appendChild(createResultFlag("Movimento", "result-flag--movement"));
        if (item.type === "pallet") flags.appendChild(createResultFlag("Pallet", "result-flag--pallet"));
        row.append(checkbox, location, article, customer, order, flags);
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
    const dialog = document.getElementById("inventorySearchDialog");
    dialog?.classList.add("is-open");
    dialog?.setAttribute("aria-hidden", "false");
    document.getElementById("inventorySearchInput")?.focus();
}

function closeInventorySearchDialog() {
    const dialog = document.getElementById("inventorySearchDialog");
    dialog?.classList.remove("is-open");
    dialog?.setAttribute("aria-hidden", "true");
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
        input?.focus();
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

function writeRestrictionInputs(rule, whitelistId, blacklistId) {
    const safeRule = rule || { whitelist: [], blacklist: [] };
    document.getElementById(whitelistId).value = safeRule.whitelist.join(", ");
    document.getElementById(blacklistId).value = safeRule.blacklist.join(", ");
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
    const dialog = document.getElementById("restrictionDialog");
    dialog.classList.add("is-open");
    dialog.setAttribute("aria-hidden", "false");
    document.getElementById("rowWhitelist")?.focus();
}

function closeRestrictionDialog() {
    const dialog = document.getElementById("restrictionDialog");
    dialog?.classList.remove("is-open");
    dialog?.setAttribute("aria-hidden", "true");
    restrictionBatchTargets = null;
}

function setupRestrictionDialog() {
    document.getElementById("openRestrictionsButton")?.addEventListener("click", () => openRestrictionDialog());
    document.getElementById("closeRestrictionsButton")?.addEventListener("click", closeRestrictionDialog);
    document.getElementById("restrictionDialog")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeRestrictionDialog();
    });
    document.getElementById("restrictionSlotSelect")?.addEventListener("change", loadSelectedSlotRestriction);
    document.getElementById("saveRowRestriction")?.addEventListener("click", () => {
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
    "article", "customer", "orderReference", "tags", "contentStatus", "rowRestriction",
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
        item?.tags?.join(" "),
        item?.partial ? "parziale" : "pieno",
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
        tags: item?.tags?.join(", ") || "",
        contentStatus: item ? `${item.partial ? "Parziale" : "Pieno"}${item.inMovement ? " In movimento" : ""}` : "",
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
        appendAnalysisCell(row, item?.tags?.join(", ") || "");
        const contentStates = [];
        if (item?.partial) contentStates.push("Parziale");
        else if (item) contentStates.push("Pieno");
        if (item?.inMovement) contentStates.push("In movimento");
        appendAnalysisCell(
            row,
            contentStates.join(" · "),
            item?.inMovement
                ? "table-status table-status--movement"
                : item?.partial
                  ? "table-status table-status--partial"
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
        cell.colSpan = 16;
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
    setArticleMetric("articlePartialCount", units.filter((unit) => unit.item.partial).length);
    setArticleMetric("articleMovementCount", units.filter((unit) => unit.item.inMovement).length);

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

    const dialog = document.getElementById("articleAnalysisDialog");
    dialog.classList.add("is-open");
    dialog.setAttribute("aria-hidden", "false");
    document.getElementById("closeArticleAnalysis")?.focus();
}

function closeArticleAnalysis() {
    const dialog = document.getElementById("articleAnalysisDialog");
    dialog?.classList.remove("is-open");
    dialog?.setAttribute("aria-hidden", "true");
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

function pseudoRandomInteger(minimum, maximum) {
    return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function buildPseudoRandomWarehouseState() {
    const customers = ["AGPRESS", "FANTINI", "CLIENTE DEMO", "TECNOSTAMPA", "ROSSI SPA"];
    const entries = [];
    for (let index = 0; index < 4; index += 1) {
        entries.push({
            article: `PALLET-${String(index + 1).padStart(3, "0")}`,
            customer: customers[pseudoRandomInteger(0, customers.length - 1)],
            order: `${pseudoRandomInteger(25, 26)}/${String(pseudoRandomInteger(1, 99999)).padStart(5, "0")}`,
            quantity: pseudoRandomInteger(1, 2),
            partial: false,
            type: "pallet",
        });
    }
    for (let index = 0; index < 24; index += 1) {
        entries.push({
            article: index % 4 === 0 ? `T${pseudoRandomInteger(1000000, 9999999)}A` : String(pseudoRandomInteger(1100, 9900)),
            customer: customers[pseudoRandomInteger(0, customers.length - 1)],
            order: `${pseudoRandomInteger(24, 26)}/${String(pseudoRandomInteger(1, 99999)).padStart(5, "0")}${Math.random() < .08 ? "/C" : ""}`,
            quantity: pseudoRandomInteger(1, 7),
            partial: Math.random() < .14,
            type: "crate",
        });
    }
    const plan = planLoadOperation(entries, new Map());
    if (plan.error) return plan;
    const receivedDates = new Map();
    const tagOptions = ["preferito", "urgente", "controllo", "riserva"];
    plan.state.forEach((item) => {
        if (!receivedDates.has(item.id)) {
            receivedDates.set(item.id, new Date(Date.now() - pseudoRandomInteger(1, 540) * 86400000).toISOString());
        }
        item.receivedAt = receivedDates.get(item.id);
        item.tags = Math.random() < .18 ? [tagOptions[pseudoRandomInteger(0, tagOptions.length - 1)]] : [];
    });
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
    document.getElementById("populateWarehouseDatabase")?.addEventListener("click", async () => {
        if ((inventory.size || movementHistory.length) && !window.confirm("Sostituire tutte le giacenze e lo storico con nuovi dati pseudo-randomici di test?")) return;
        setTestDatabaseButtonsDisabled(true);
        try {
            const plan = buildPseudoRandomWarehouseState();
            if (plan.error) throw new Error(plan.error);
            inventory.clear();
            plan.state.forEach((item, location) => inventory.set(location, item));
            movementHistory.splice(0);
            unloadZone.splice(0);
            resetOperationDraftsAfterDatabaseChange();
            refreshWarehouseDataViews();
            await persistWarehouseData();
            showWarehouseToast(`Database popolato con ${logicalInventoryUnits(inventory).length} unità logistiche di test.`);
        } catch (error) {
            showWarehouseToast(`Popolamento non completato: ${error.message}`, true);
        } finally {
            setTestDatabaseButtonsDisabled(false);
        }
    });

    document.getElementById("clearWarehouseDatabase")?.addEventListener("click", async () => {
        if (!window.confirm("Svuotare completamente giacenze, zona scarico e storico del magazzino? L'operazione non è annullabile.")) return;
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
renderTabs();
renderMap();
setupDisplayMode();
setupSlotPager();
setupToolsDrawer();
setupWarehouseStructure();
setupLoadDialog();
setupManualMovement();
setupUnloadZone();
setupSlotPreview();
setupContextMenu();
setupSlotAreaSelection();
setupInventorySearch();
setupAnalysisView();
setupRestrictionDialog();
setupTemporaryDatabaseActions();
setupWarehouseLogin();
updateSummary();
void initializeWarehouseAuthentication();
void initializeWarehousePersistence();
