// @ts-nocheck
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
const { ipcRenderer } = require("electron");
const { requestBackend } = require("./shared/backend-client");

const canvas = document.getElementById("warehouseCanvas");
const stage = document.getElementById("viewerStage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe5edf2);
scene.fog = new THREE.Fog(0xe5edf2, 34, 90);
const camera = new THREE.PerspectiveCamera(42, 1, .1, 200);
camera.position.set(18, 14, 22);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.screenSpacePanning = true;
controls.minDistance = 3;
controls.maxDistance = 75;
controls.maxPolarAngle = Math.PI * .495;
controls.target.set(0, 2.2, 0);

scene.add(new THREE.HemisphereLight(0xf8fcff, 0x60717c, 2.35));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
keyLight.position.set(12, 22, 15);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -35;
keyLight.shadow.camera.right = 35;
keyLight.shadow.camera.top = 35;
keyLight.shadow.camera.bottom = -35;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xaedbfa, 1.1);
fillLight.position.set(-18, 10, -12);
scene.add(fillLight);

const world = new THREE.Group();
scene.add(world);
const movementGhostLayer = new THREE.Group();
scene.add(movementGhostLayer);
const movementDepositLayer = new THREE.Group();
scene.add(movementDepositLayer);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const movementTimer = new THREE.Timer();
movementTimer.connect(document);
const pressedMovementKeys = new Set();
let pickables = [];
let currentSnapshot = { rows: [], inventory: [], stagingUnits: [], displayFields: [] };
let currentSelection = "";
let hoveredObject = null;
let showFreeSlots = false;
let surfaceLabelsVisible = true;
let cameraHasBeenFramed = false;
let pointerDown = null;
let layoutRows = [];
let layoutRowZ = [];
let layoutMaxColumns = 1;
let movementPlaybackState = null;
let lastMovementPlaybackId = "";
let contextMovement3dId = "";
let viewerDisposing = false;
const surfaceLabelTextureCache = new Map();
const usedSurfaceLabelTextureKeys = new Set();

const DEFAULT_VIEWER_SETTINGS_VERSION = 2;
const defaultViewerSettings = {
    settingsVersion: DEFAULT_VIEWER_SETTINGS_VERSION,
    rowSpacing: 10,
    rowSpacings: {},
    rackOpacity: .1,
    labelScale: 1,
    cameraFov: 44,
    movementSpeed: 2,
    playbackSpeed: .8,
    showFreeSlots: false,
    showRacks: true,
    showGrid: true,
    hiddenRows: [],
};
function loadViewerSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem("aypi-warehouse-3d-view-settings") || "{}");
        if (saved.settingsVersion !== DEFAULT_VIEWER_SETTINGS_VERSION) return { ...defaultViewerSettings, rowSpacings: {}, hiddenRows: [] };
        return {
            ...defaultViewerSettings,
            ...saved,
            rowSpacings: saved.rowSpacings && typeof saved.rowSpacings === "object" ? saved.rowSpacings : {},
            hiddenRows: Array.isArray(saved.hiddenRows) ? saved.hiddenRows : [],
        };
    } catch {
        return { ...defaultViewerSettings, rowSpacings: {} };
    }
}
let viewerSettings = loadViewerSettings();
showFreeSlots = Boolean(viewerSettings.showFreeSlots);
camera.fov = viewerSettings.cameraFov;
camera.updateProjectionMatrix();
let savedCameraViews = [];
let activeCameraViewId = "";
let cameraTransition = null;
let cameraViewOwner = { key: "guest", label: "Nessun operatore", canManage: false };
let savedPersonalViewPresets = [];
const CAMERA_VIEWS_STORAGE_KEY = "aypi-warehouse-3d-camera-views-by-operator";
const LEGACY_CAMERA_VIEWS_STORAGE_KEY = "aypi-warehouse-3d-camera-views";
const VIEW_PRESETS_STORAGE_KEY = "aypi-warehouse-3d-view-presets-by-operator";
const remotePersonalPreferenceTimers = new Map();

function validCameraViews(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry) => entry?.id && entry?.name
        && Array.isArray(entry.position) && entry.position.length === 3
        && Array.isArray(entry.target) && entry.target.length === 3).slice(0, 30);
}

function cameraViewRegistry() {
    try {
        const registry = JSON.parse(localStorage.getItem(CAMERA_VIEWS_STORAGE_KEY) || "{}");
        return registry && typeof registry === "object" && !Array.isArray(registry) ? registry : {};
    } catch {
        return {};
    }
}

function cameraOwnerIdentity(actor) {
    const role = String(actor?.role || "guest").trim().toLowerCase();
    const department = String(actor?.department || "").trim();
    const name = String(role === "admin" ? actor?.adminName : actor?.employee || actor?.displayName || "").trim();
    if (role === "test") return { key: "test:operatore-test", label: actor?.displayName || "Operatore test", canManage: true };
    if (role === "admin" && name) return { key: `admin:${name.toLocaleLowerCase("it")}`, label: `Admin ${name}`, canManage: true };
    if (role === "employee" && name) {
        const departmentKey = department.toLocaleLowerCase("it");
        return { key: `employee:${departmentKey}:${name.toLocaleLowerCase("it")}`, label: name, canManage: true };
    }
    return { key: "guest", label: "Nessun operatore", canManage: false };
}

function loadCameraViews(ownerKey) {
    const registry = cameraViewRegistry();
    if (Object.prototype.hasOwnProperty.call(registry, ownerKey)) return validCameraViews(registry[ownerKey]);
    if (ownerKey !== "guest") {
        try {
            const legacy = validCameraViews(JSON.parse(localStorage.getItem(LEGACY_CAMERA_VIEWS_STORAGE_KEY) || "[]"));
            if (legacy.length) {
                registry[ownerKey] = legacy;
                localStorage.setItem(CAMERA_VIEWS_STORAGE_KEY, JSON.stringify(registry));
                localStorage.removeItem(LEGACY_CAMERA_VIEWS_STORAGE_KEY);
                return legacy;
            }
        } catch { /* archivio precedente non valido */ }
    }
    return [];
}

function saveCameraViews() {
    if (!cameraViewOwner.canManage) return;
    const registry = cameraViewRegistry();
    registry[cameraViewOwner.key] = validCameraViews(savedCameraViews);
    localStorage.setItem(CAMERA_VIEWS_STORAGE_KEY, JSON.stringify(registry));
    scheduleRemotePersonalPreferencesSave();
}

function personalViewPresetRegistry() {
    try {
        const registry = JSON.parse(localStorage.getItem(VIEW_PRESETS_STORAGE_KEY) || "{}");
        return registry && typeof registry === "object" && !Array.isArray(registry) ? registry : {};
    } catch {
        return {};
    }
}

function validPersonalViewPresets(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry) => entry?.id && entry?.name && entry?.settings && typeof entry.settings === "object").slice(0, 20);
}

function loadPersonalViewPresets(ownerKey) {
    return validPersonalViewPresets(personalViewPresetRegistry()[ownerKey]);
}

function savePersonalViewPresets() {
    if (!cameraViewOwner.canManage) return;
    const registry = personalViewPresetRegistry();
    registry[cameraViewOwner.key] = validPersonalViewPresets(savedPersonalViewPresets);
    localStorage.setItem(VIEW_PRESETS_STORAGE_KEY, JSON.stringify(registry));
    scheduleRemotePersonalPreferencesSave();
}

function clonePreferenceEntries(entries) {
    return JSON.parse(JSON.stringify(entries || []));
}

function mergePreferenceEntries(serverEntries, localEntries, validator, limit) {
    const merged = validator(serverEntries);
    const indexes = new Map(merged.map((entry, index) => [entry.id, index]));
    validator(localEntries).forEach((localEntry) => {
        const existingIndex = indexes.get(localEntry.id);
        if (existingIndex === undefined) {
            indexes.set(localEntry.id, merged.length);
            merged.push(localEntry);
            return;
        }
        const serverTime = Date.parse(merged[existingIndex].updatedAt || "") || 0;
        const localTime = Date.parse(localEntry.updatedAt || "") || 0;
        if (localTime >= serverTime) merged[existingIndex] = localEntry;
    });
    return merged.slice(0, limit);
}

function cachePersonalPreferences(ownerKey, cameraViews, viewPresets) {
    const cameraRegistry = cameraViewRegistry();
    cameraRegistry[ownerKey] = validCameraViews(cameraViews);
    localStorage.setItem(CAMERA_VIEWS_STORAGE_KEY, JSON.stringify(cameraRegistry));
    const presetRegistry = personalViewPresetRegistry();
    presetRegistry[ownerKey] = validPersonalViewPresets(viewPresets);
    localStorage.setItem(VIEW_PRESETS_STORAGE_KEY, JSON.stringify(presetRegistry));
}

function remotePersonalPreferencesPayload(ownerKey = cameraViewOwner.key, ownerLabel = cameraViewOwner.label) {
    const cameraRegistry = cameraViewRegistry();
    const presetRegistry = personalViewPresetRegistry();
    return {
        ownerKey,
        ownerLabel,
        cameraViews: clonePreferenceEntries(ownerKey === cameraViewOwner.key ? savedCameraViews : cameraRegistry[ownerKey]),
        viewPresets: clonePreferenceEntries(ownerKey === cameraViewOwner.key ? savedPersonalViewPresets : presetRegistry[ownerKey]),
    };
}

function saveRemotePersonalPreferences(payload) {
    return requestBackend("/api/warehouse-inventory/view-preferences", { method: "PUT", body: payload });
}

function scheduleRemotePersonalPreferencesSave() {
    if (!cameraViewOwner.canManage) return;
    const payload = remotePersonalPreferencesPayload();
    const previousTimer = remotePersonalPreferenceTimers.get(payload.ownerKey);
    if (previousTimer) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
        remotePersonalPreferenceTimers.delete(payload.ownerKey);
        void saveRemotePersonalPreferences(payload).catch((error) => {
            console.warn("[warehouse-3d] Preferenze personali salvate solo nella cache locale:", error?.message || error);
        });
    }, 350);
    remotePersonalPreferenceTimers.set(payload.ownerKey, timer);
}

async function syncRemotePersonalPreferences(owner) {
    if (!owner.canManage) return;
    try {
        const remote = await requestBackend(`/api/warehouse-inventory/view-preferences?owner=${encodeURIComponent(owner.key)}`);
        const cameraRegistry = cameraViewRegistry();
        const presetRegistry = personalViewPresetRegistry();
        const mergedCameraViews = mergePreferenceEntries(remote?.cameraViews, cameraRegistry[owner.key], validCameraViews, 30);
        const mergedViewPresets = mergePreferenceEntries(remote?.viewPresets, presetRegistry[owner.key], validPersonalViewPresets, 20);
        const pendingTimer = remotePersonalPreferenceTimers.get(owner.key);
        if (pendingTimer) {
            window.clearTimeout(pendingTimer);
            remotePersonalPreferenceTimers.delete(owner.key);
        }
        cachePersonalPreferences(owner.key, mergedCameraViews, mergedViewPresets);
        if (cameraViewOwner.key === owner.key) {
            savedCameraViews = mergedCameraViews;
            savedPersonalViewPresets = mergedViewPresets;
            renderCameraViews();
            renderPersonalViewPresets();
        }
        const remoteCameraViews = validCameraViews(remote?.cameraViews);
        const remoteViewPresets = validPersonalViewPresets(remote?.viewPresets);
        if (JSON.stringify(remoteCameraViews) !== JSON.stringify(mergedCameraViews)
            || JSON.stringify(remoteViewPresets) !== JSON.stringify(mergedViewPresets)) {
            await saveRemotePersonalPreferences({
                ownerKey: owner.key,
                ownerLabel: owner.label,
                cameraViews: clonePreferenceEntries(mergedCameraViews),
                viewPresets: clonePreferenceEntries(mergedViewPresets),
            });
        }
    } catch (error) {
        console.warn("[warehouse-3d] Preferenze personali server non disponibili; uso cache locale:", error?.message || error);
    }
}

function applyCameraViewOwner(actor) {
    const nextOwner = cameraOwnerIdentity(actor);
    const ownerChanged = nextOwner.key !== cameraViewOwner.key;
    cameraViewOwner = nextOwner;
    if (ownerChanged) {
        savedCameraViews = loadCameraViews(cameraViewOwner.key);
        savedPersonalViewPresets = loadPersonalViewPresets(cameraViewOwner.key);
        activeCameraViewId = "";
        cameraTransition = null;
    }
    const saveButton = document.getElementById("saveCameraView");
    const newButton = document.getElementById("newCameraView");
    saveButton.disabled = !cameraViewOwner.canManage;
    newButton.disabled = !cameraViewOwner.canManage;
    saveButton.title = cameraViewOwner.canManage ? `Salva un POV personale per ${cameraViewOwner.label}` : "Accedi come operatore o admin per salvare i POV";
    document.getElementById("cameraViewOwner").textContent = cameraViewOwner.canManage
        ? `${cameraViewOwner.label} · Tasti 1–9 per il richiamo rapido.`
        : "Accedi come operatore o admin per gestire i POV personali.";
    closeCameraSaveForm();
    renderCameraViews();
    syncPersonalViewPresetAccess();
    renderPersonalViewPresets();
    if (ownerChanged) void syncRemotePersonalPreferences({ ...cameraViewOwner });
}

function saveViewerSettings() {
    localStorage.setItem("aypi-warehouse-3d-view-settings", JSON.stringify(viewerSettings));
}

const palette = {
    free: 0xeaf5fd,
    occupied: 0xdff3e7,
    pallet: 0xf6cece,
    blocked: 0xaeb7be,
    selected: 0x123f70,
    related: 0x4cb8ef,
    selectedFill: 0x9fbfd9,
    relatedFill: 0xd9f2fd,
    match: 0x087fbd,
    searchFill: 0xcceeff,
    movementLoad: 0xffd84d,
    movementUnload: 0xff9b7d,
    movementShift: 0xff9fbe,
    movementCorridor: 0xb89ae8,
};

function physicalColumns(row) {
    return Math.max(1, Math.floor((Number(row?.capacity) || 6) / 6));
}

function sideForPosition(row, number) {
    const odd = number % 2 !== 0;
    return odd === Boolean(row?.invertedSides) ? "rear" : "front";
}

function rowFrontDirection(row) {
    const physicalIndex = currentSnapshot.rows.findIndex((entry) => entry.code === row?.code);
    return physicalIndex >= 0 && physicalIndex % 2 !== 0 ? -1 : 1;
}

function sidePhysicalDirection(row, side) {
    const frontDirection = rowFrontDirection(row);
    return side === "front" ? frontDirection : -frontDirection;
}

function slotCode(row, columnIndex, side, level) {
    const oddNumberSide = row.invertedSides ? "rear" : "front";
    const number = columnIndex * 2 + (side === oddNumberSide ? 1 : 2);
    return `${row.code}${number}${level}`;
}

function parseLocation(location) {
    const match = /^([A-Z])(\d{1,3})([a-c])$/i.exec(String(location || ""));
    if (!match) return null;
    const row = currentSnapshot.rows.find((entry) => entry.code === match[1].toUpperCase());
    if (!row) return null;
    const number = Number(match[2]);
    return {
        row,
        rowIndex: currentSnapshot.rows.indexOf(row),
        number,
        level: match[3].toLowerCase(),
        physicalColumn: Math.ceil(number / 2),
        side: sideForPosition(row, number),
    };
}

function clearObject(group) {
    group.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
        else {
            if (!object.material?.map?.userData?.warehouseSurfaceLabel) object.material?.map?.dispose?.();
            object.material?.dispose?.();
        }
    });
    group.clear();
}

function createBox(width, height, depth, color, options = {}) {
    const material = new THREE.MeshStandardMaterial({
        color,
        roughness: options.roughness ?? .72,
        metalness: options.metalness ?? .04,
        transparent: Boolean(options.transparent),
        opacity: options.opacity ?? 1,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = true;
    return mesh;
}

function createTextSprite(lines, colors = {}) {
    const surface = document.createElement("canvas");
    surface.width = 512;
    surface.height = 210;
    const context = surface.getContext("2d");
    context.clearRect(0, 0, surface.width, surface.height);
    context.fillStyle = colors.background || "rgba(245,250,253,.94)";
    context.strokeStyle = colors.border || "rgba(62,94,113,.5)";
    context.lineWidth = 3;
    context.beginPath();
    context.roundRect(4, 4, 504, 202, 16);
    context.fill();
    context.stroke();
    context.textAlign = "center";
    context.textBaseline = "middle";
    const visible = lines.slice(0, 3);
    visible.forEach((line, index) => {
        context.fillStyle = index === 0 ? (colors.title || "#163e5d") : (colors.text || "#263c4a");
        context.font = `${index === 0 ? "800 57px" : "700 44px"} Segoe UI, Arial`;
        context.fillText(String(line).slice(0, 22), 256, 49 + index * 57);
    });
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true }));
    sprite.scale.set(1.08, .48, 1);
    sprite.renderOrder = 4;
    return sprite;
}

function surfaceLabelTexture(lines) {
    const key = JSON.stringify(lines.slice(0, 3).map((line) => String(line).slice(0, 20)));
    usedSurfaceLabelTextureKeys.add(key);
    if (surfaceLabelTextureCache.has(key)) return surfaceLabelTextureCache.get(key);
    const surface = document.createElement("canvas");
    surface.width = 512;
    surface.height = 320;
    const context = surface.getContext("2d");
    context.clearRect(0, 0, surface.width, surface.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    const visible = lines.slice(0, 3);
    visible.forEach((line, index) => {
        context.font = `${index === 0 ? "900 72px" : "800 56px"} Segoe UI, Arial`;
        context.lineWidth = 3;
        context.strokeStyle = "rgba(246,252,255,.98)";
        context.strokeText(String(line).slice(0, 20), 256, 72 + index * 87, 478);
        context.fillStyle = index === 0 ? "#123f70" : "#203947";
        context.fillText(String(line).slice(0, 20), 256, 72 + index * 87, 478);
    });
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.userData.warehouseSurfaceLabel = true;
    surfaceLabelTextureCache.set(key, texture);
    return texture;
}

function createSurfaceLabel(lines, face = "rear", pallet = false) {
    const material = new THREE.MeshBasicMaterial({
        map: surfaceLabelTexture(lines),
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(
        pallet ? .88 : .86,
        pallet ? .48 : .59,
    ), material);
    label.scale.setScalar(viewerSettings.labelScale);
    label.renderOrder = 3;
    if (face === "front") label.rotation.y = Math.PI;
    return label;
}

function itemLabelLines(location, item) {
    const fields = currentSnapshot.displayFields?.length ? currentSnapshot.displayFields : ["location", "article", "pieces"];
    const values = {
        location,
        article: item.article || "Articolo —",
        pieces: `${Number(item.pieceCount) || 0} pezzi`,
        customer: item.customer || "Cliente —",
        order: item.orderReference || "Ordine —",
        weighing: item.weighingCode || "Pesata —",
        type: item.type === "pallet" ? "Pallet" : "Cassone",
        tags: (item.tags || []).join(", ") || "Tag —",
        receivedAt: item.receivedAt ? new Date(item.receivedAt).toLocaleDateString("it-IT") : "Ingresso —",
    };
    return fields.map((field) => values[field]).filter(Boolean);
}

function addShelfStructure(row, rowIndex, columns, baseZ) {
    const width = columns * 1.28 + .35;
    const horizontalCenter = (columns - layoutMaxColumns) * .64;
    const frameMaterial = new THREE.MeshStandardMaterial({
        color: 0x31566c,
        roughness: .48,
        metalness: .42,
        transparent: true,
        opacity: viewerSettings.rackOpacity,
        depthWrite: false,
    });
    const addFrame = (geometry, x, y, z) => {
        const mesh = new THREE.Mesh(geometry, frameMaterial);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.visible = viewerSettings.showRacks;
        mesh.userData.sceneRole = "rack";
        mesh.userData.rowCode = row.code;
        world.add(mesh);
    };
    for (let column = 0; column <= columns; column += 1) {
        const x = horizontalCenter + (column - columns / 2) * 1.28;
        addFrame(new THREE.BoxGeometry(.07, 3.55, 1.92), x, 1.76, baseZ);
    }
    [0, 1.03, 2.06, 3.09].forEach((height) => addFrame(new THREE.BoxGeometry(width, .07, 1.92), horizontalCenter, height, baseZ));
    const oddSide = sideForPosition(row, 1);
    const oddDirection = sidePhysicalDirection(row, oddSide);
    const physicalIndex = currentSnapshot.rows.findIndex((entry) => entry.code === row.code);
    const oddFacingRow = currentSnapshot.rows[physicalIndex + oddDirection]?.code;
    const orientationLabel = oddFacingRow ? `dispari verso fila ${oddFacingRow}` : "dispari verso lato esterno";
    const label = createTextSprite([`FILA ${row.code}`, orientationLabel], {
        background: "rgba(23,62,95,.96)", border: "rgba(255,255,255,.55)", title: "#ffffff", text: "#cfeafa",
    });
    label.position.set(horizontalCenter - width / 2 - 1.3, 3.25, baseZ);
    label.scale.set(2.25, .9, 1);
    label.visible = viewerSettings.showRacks;
    label.userData.sceneRole = "rack";
    label.userData.rowCode = row.code;
    world.add(label);
}

function rowSpacingKey(firstRow, secondRow) {
    return `${firstRow?.code || ""}|${secondRow?.code || ""}`;
}

function rowPairSpacing(firstRow, secondRow) {
    const value = Number(viewerSettings.rowSpacings?.[rowSpacingKey(firstRow, secondRow)]);
    if (Number.isFinite(value)) return Math.min(14, Math.max(3.2, value));
    const physicalIndex = currentSnapshot.rows.findIndex((row) => row.code === firstRow?.code);
    return physicalIndex >= 0 && physicalIndex % 2 !== 0 ? 3.8 : viewerSettings.rowSpacing;
}

function calculateLayoutRowZ() {
    if (!layoutRows.length) return [];
    const sourceIndexes = new Map(currentSnapshot.rows.map((row, index) => [row.code, index]));
    const positions = [0];
    for (let visibleIndex = 1; visibleIndex < layoutRows.length; visibleIndex += 1) {
        const previousSourceIndex = sourceIndexes.get(layoutRows[visibleIndex - 1].code);
        const sourceIndex = sourceIndexes.get(layoutRows[visibleIndex].code);
        let distance = 0;
        if (Number.isInteger(previousSourceIndex) && Number.isInteger(sourceIndex) && sourceIndex > previousSourceIndex) {
            for (let index = previousSourceIndex; index < sourceIndex; index += 1) {
                distance += rowPairSpacing(currentSnapshot.rows[index], currentSnapshot.rows[index + 1]);
            }
        } else {
            distance = viewerSettings.rowSpacing;
        }
        positions.push(positions[positions.length - 1] + distance);
    }
    const center = (positions[0] + positions[positions.length - 1]) / 2;
    return positions.map((position) => position - center);
}

function layoutDepth(extra = 0) {
    if (layoutRowZ.length < 2) return Math.max(5, viewerSettings.rowSpacing + extra);
    return Math.max(5, Math.max(...layoutRowZ) - Math.min(...layoutRowZ) + viewerSettings.rowSpacing + extra);
}

function configuredRowZPositions() {
    if (!currentSnapshot.rows.length) return [];
    const positions = [0];
    for (let index = 1; index < currentSnapshot.rows.length; index += 1) {
        positions.push(positions[index - 1] + rowPairSpacing(currentSnapshot.rows[index - 1], currentSnapshot.rows[index]));
    }
    const center = (positions[0] + positions[positions.length - 1]) / 2;
    return positions.map((position) => position - center);
}

function warehousePhysicalBounds() {
    const maxColumns = Math.max(1, ...currentSnapshot.rows.map(physicalColumns));
    const width = maxColumns * 1.28 + 10;
    const rowPositions = configuredRowZPositions();
    const rowMinimum = Math.min(...rowPositions, 0);
    const rowMaximum = Math.max(...rowPositions, 0);
    const depth = Math.max(
        10,
        rowMaximum - rowMinimum + viewerSettings.rowSpacing + 12,
        Math.max(1, currentSnapshot.rows.length - 1) * 14 + 12,
    );
    return {
        width,
        depth,
        minX: -width / 2,
        maxX: width / 2,
        minZ: -depth / 2,
        maxZ: depth / 2,
        rowMinimum,
        rowMaximum,
    };
}

function dockAreaGeometry() {
    const bounds = warehousePhysicalBounds();
    const availableDepth = Math.max(3.2, bounds.maxZ - bounds.rowMaximum - 1.2);
    // Cinque celle della griglia visiva (circa 1,67 unità scena ciascuna),
    // non cinque unità geometriche Three.js.
    const width = 8.35;
    return {
        centerX: bounds.maxX - width / 2,
        centerZ: bounds.rowMaximum + availableDepth / 2 + .35,
        width,
        depth: Math.max(2.6, Math.min(3.4, availableDepth - .7)),
    };
}

function dockAreaPosition(stackIndex = 0) {
    const dock = dockAreaGeometry();
    return new THREE.Vector3(dock.centerX, .39 + stackIndex * .82, dock.centerZ);
}

function stagingAreaGeometry() {
    const bounds = warehousePhysicalBounds();
    const dock = dockAreaGeometry();
    const gapFromDock = .8;
    const floorEdgeMargin = .9;
    const availableDepth = Math.max(3.2, bounds.maxZ - bounds.rowMaximum - 3 - floorEdgeMargin);
    const maximumWidth = Math.max(3.6, bounds.width - dock.width - gapFromDock - 1.6);
    // Zona ruotata di 90°: usa il lato lungo lungo la larghezza libera del
    // capannone e conserva un corridoio netto davanti all'ultima fila.
    const width = Math.max(6, Math.min(18, bounds.width * .56, maximumWidth));
    const depth = Math.max(3.2, Math.min(9, availableDepth));
    return {
        centerX: bounds.maxX - dock.width - gapFromDock - width / 2,
        centerZ: bounds.maxZ - floorEdgeMargin - depth / 2,
        width,
        depth,
        outerX: bounds.maxX - .9,
    };
}

function stagingPositionForUnit(unit, stagingContext = []) {
    const staged = stagingContext.length ? [...stagingContext] : [...(currentSnapshot.stagingUnits || [])];
    if (unit?.id && !staged.some((item) => item.id === unit.id)) staged.push(unit);
    const articleKeys = Array.from(new Set(staged.map((item) => String(item.article || "SENZA ARTICOLO")))).sort((left, right) => left.localeCompare(right, "it", { numeric: true }));
    const article = String(unit?.article || "SENZA ARTICOLO");
    const pileIndex = Math.max(0, articleKeys.indexOf(article));
    const sameArticle = staged.filter((item) => String(item.article || "SENZA ARTICOLO") === article);
    const unitIndex = Math.max(0, sameArticle.findIndex((item) => item.id === unit?.id));
    const area = stagingAreaGeometry();
    const columns = Math.max(1, Math.floor(area.width / 1.2));
    const column = pileIndex % columns;
    const row = Math.floor(pileIndex / columns);
    return new THREE.Vector3(
        area.centerX - area.width / 2 + .7 + column * 1.15,
        .39 + unitIndex * .82,
        area.centerZ - area.depth / 2 + .7 + row * 1.12,
    );
}

function aislePositionForLocation(location) {
    const parsed = parseLocation(location);
    if (!parsed) return null;
    const rowIndex = layoutRows.findIndex((row) => row.code === parsed.row.code);
    if (rowIndex < 0) return null;
    const slot = locationScenePosition(location);
    // Il muletto opera sempre dal fronte fisico della scaffalatura. Il lato
    // rear identifica la profondità dello slot, non un secondo lato di accesso.
    return new THREE.Vector3(slot.x, slot.y, (layoutRowZ[rowIndex] || 0) + rowFrontDirection(parsed.row) * 2.05);
}

function addOperationalArea(center, width, depth, color, title, subtitle) {
    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(center.x, -.045, center.z);
    plane.userData.sceneRole = "operational-area";
    world.add(plane);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(plane.geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .85 }));
    edges.rotation.copy(plane.rotation);
    edges.position.copy(plane.position);
    edges.position.y += .006;
    edges.userData.sceneRole = "operational-area";
    world.add(edges);
    const label = createTextSprite([title, subtitle], {
        background: "rgba(255,255,255,.94)", border: `#${color.toString(16).padStart(6, "0")}`, title: `#${color.toString(16).padStart(6, "0")}`, text: "#365064",
    });
    label.position.set(center.x, .35, center.z);
    label.scale.set(2.5, .95, 1);
    label.userData.sceneRole = "operational-area";
    world.add(label);
}

function addOperationalAreas() {
    const dock = dockAreaGeometry();
    addOperationalArea(new THREE.Vector3(dock.centerX, 0, dock.centerZ), dock.width, dock.depth, 0x45ae66, "CARICO / USCITA", "Baia veicolo");
    const staging = stagingAreaGeometry();
    addOperationalArea(new THREE.Vector3(staging.centerX, 0, staging.centerZ), staging.width, staging.depth, 0x2f83d1, "ATTESA / PREPARAZIONE", "Oltre l'ultima fila");
    const stagedByArticle = new Map();
    (currentSnapshot.stagingUnits || []).forEach((item) => {
        const key = String(item.article || "SENZA ARTICOLO");
        if (!stagedByArticle.has(key)) stagedByArticle.set(key, []);
        stagedByArticle.get(key).push(item);
    });
    stagedByArticle.forEach((items) => items.forEach((item) => {
        const pallet = item.type === "pallet";
        const color = item.requiresWarehouseReturn ? 0xb666d2 : pallet ? 0xe6a16f : 0x66aee0;
        const mesh = createBox(pallet ? .98 : .82, pallet ? .68 : .72, pallet ? 1.62 : .72, color, { castShadow: true });
        mesh.position.copy(stagingPositionForUnit(item));
        mesh.userData.sceneRole = "staging-unit";
        mesh.userData.stagingUnitId = item.id;
        const lines = [item.article || "Articolo —", item.requiresWarehouseReturn ? "RIENTRO" : "PRONTO USCITA", `${Number(item.pieceCount) || 0} pezzi`];
        ["front", "rear"].forEach((face) => {
            const label = createSurfaceLabel(lines, face, pallet);
            label.position.set(0, 0, (face === "front" ? -1 : 1) * (pallet ? .816 : .366));
            mesh.add(label);
        });
        world.add(mesh);
    }));
}

function updateRowLayoutLive() {
    const previousPositions = new Map(layoutRows.map((row, index) => [row.code, layoutRowZ[index] || 0]));
    const nextPositions = calculateLayoutRowZ();
    const nextByRow = new Map(layoutRows.map((row, index) => [row.code, nextPositions[index] || 0]));
    world.children.forEach((object) => {
        const rowCode = object.userData?.rowCode;
        if (!rowCode || !previousPositions.has(rowCode) || !nextByRow.has(rowCode)) return;
        object.position.z += nextByRow.get(rowCode) - previousPositions.get(rowCode);
    });
    layoutRowZ = nextPositions;
}

function updateRackAppearanceLive() {
    world.traverse((object) => {
        if (object.userData?.sceneRole !== "rack") return;
        object.visible = viewerSettings.showRacks;
        if (object.material?.isMeshStandardMaterial) {
            object.material.opacity = viewerSettings.rackOpacity;
            object.material.needsUpdate = true;
        }
    });
}

function updateLabelScaleLive() {
    pickables.forEach((mesh) => (mesh.userData.labels || []).forEach((label) => {
        label.scale.setScalar(viewerSettings.labelScale);
    }));
}

function updateGridVisibilityLive() {
    world.children.forEach((object) => {
        if (object.userData?.sceneRole === "grid") object.visible = viewerSettings.showGrid;
    });
}

function refreshPhysicalAreasLive() {
    const removableRoles = new Set(["floor", "grid", "operational-area", "staging-unit"]);
    world.children.slice().forEach((object) => {
        if (!removableRoles.has(object.userData?.sceneRole)) return;
        object.traverse((child) => {
            child.geometry?.dispose?.();
            if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
            else child.material?.dispose?.();
        });
        world.remove(object);
    });
    addFloor();
    addOperationalAreas();
}

function applyViewerSettingsLive({ updateRows = true } = {}) {
    if (updateRows) {
        updateRowLayoutLive();
        refreshPhysicalAreasLive();
    }
    updateRackAppearanceLive();
    updateLabelScaleLive();
    updateGridVisibilityLive();
    camera.fov = viewerSettings.cameraFov;
    camera.updateProjectionMatrix();
    saveViewerSettings();
}

function slotPosition(rowIndex, column, side, level) {
    const baseZ = layoutRowZ[rowIndex] || 0;
    return new THREE.Vector3(
        (column - (layoutMaxColumns + 1) / 2) * 1.28,
        .49 + ({ a: 0, b: 1, c: 2 }[level] || 0) * 1.03,
        baseZ + sidePhysicalDirection(layoutRows[rowIndex], side) * .49,
    );
}

function addSlotMesh(location, item, state, position, locations = [location]) {
    const pallet = state === "pallet";
    const mesh = createBox(.98, pallet ? .68 : .78, pallet ? 1.62 : .76, palette[state], {
        transparent: state === "free" || state === "blocked",
        opacity: state === "free" ? .22 : state === "blocked" ? .42 : 1,
        castShadow: state !== "free" && state !== "blocked",
    });
    mesh.position.copy(position);
    mesh.userData = {
        location,
        locations,
        rowCode: parseLocation(location)?.row?.code || "",
        item: item || null,
        state,
        baseColor: palette[state],
        searchable: [location, ...(locations || []), item?.article, item?.customer, item?.orderReference, item?.weighingCode, ...(item?.tags || [])]
            .filter(Boolean).join(" ").toUpperCase(),
    };
    const outline = new THREE.Mesh(
        mesh.geometry,
        new THREE.MeshBasicMaterial({ color: palette.related, side: THREE.BackSide, transparent: true, opacity: .96 }),
    );
    outline.name = "selection-outline";
    outline.scale.set(1.075, 1.09, 1.075);
    outline.visible = false;
    outline.renderOrder = 2;
    mesh.add(outline);
    mesh.userData.outline = outline;
    if (state === "free" || state === "blocked") {
        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(mesh.geometry),
            new THREE.LineBasicMaterial({ color: state === "free" ? 0x69a9ce : 0x747e85, transparent: true, opacity: .6 }),
        );
        mesh.add(edges);
    }
    world.add(mesh);
    pickables.push(mesh);
    if (item) {
        const lines = itemLabelLines(locations.length > 1 ? locations.join(" + ") : location, item);
        const faces = ["front", "rear"];
        mesh.userData.labels = faces.map((face) => {
            const label = createSurfaceLabel(lines, face, pallet);
            label.position.set(0, 0, (face === "front" ? -1 : 1) * (pallet ? .816 : .386));
            label.userData.parentSlot = mesh;
            mesh.add(label);
            return label;
        });
    }
    return mesh;
}

function buildWarehouse() {
    usedSurfaceLabelTextureKeys.clear();
    clearObject(world);
    pickables = [];
    hoveredObject = null;
    const hiddenRows = new Set(viewerSettings.hiddenRows || []);
    layoutRows = currentSnapshot.rows.filter((row) => !hiddenRows.has(row.code));
    if (!layoutRows.length && currentSnapshot.rows.length) {
        layoutRows = [currentSnapshot.rows[0]];
        viewerSettings.hiddenRows = currentSnapshot.rows.slice(1).map((row) => row.code);
    }
    layoutMaxColumns = Math.max(1, ...layoutRows.map(physicalColumns));
    layoutRowZ = calculateLayoutRowZ();
    const inventoryByLocation = new Map(currentSnapshot.inventory.map((item) => [item.location, item]));
    const palletModules = new Map();
    currentSnapshot.inventory.filter((item) => item.type === "pallet").forEach((item) => {
        const parsed = parseLocation(item.location);
        if (parsed) palletModules.set(`${parsed.row.code}:${parsed.physicalColumn}`, item.id);
    });
    const renderedPallets = new Set();
    layoutRows.forEach((row, rowIndex) => {
        const columns = physicalColumns(row);
        const baseZ = layoutRowZ[rowIndex] || 0;
        addShelfStructure(row, rowIndex, columns, baseZ);
        for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
            for (const side of ["rear", "front"]) {
                for (const level of ["a", "b", "c"]) {
                    const location = slotCode(row, columnIndex, side, level);
                    const item = inventoryByLocation.get(location);
                    if (item?.type === "pallet") {
                        if (renderedPallets.has(item.id)) continue;
                        renderedPallets.add(item.id);
                        const locations = currentSnapshot.inventory.filter((entry) => entry.id === item.id).map((entry) => entry.location).sort();
                        const position = slotPosition(rowIndex, columnIndex + 1, "front", "a");
                        position.z = baseZ;
                        addSlotMesh(locations[0] || location, item, "pallet", position, locations);
                        continue;
                    }
                    const blocked = level !== "a" && palletModules.has(`${row.code}:${columnIndex + 1}`);
                    const state = item ? "occupied" : blocked ? "blocked" : "free";
                    addSlotMesh(location, item, state, slotPosition(rowIndex, columnIndex + 1, side, level));
                }
            }
        }
    });
    addFloor();
    addOperationalAreas();
    surfaceLabelTextureCache.forEach((texture, key) => {
        if (usedSurfaceLabelTextureKeys.has(key)) return;
        texture.dispose();
        surfaceLabelTextureCache.delete(key);
    });
    applyFreeSlotVisibility();
    applySearch();
    const selectedMesh = pickables.find((mesh) => mesh.userData.locations?.includes(currentSelection)
        || mesh.userData.location === currentSelection);
    if (selectedMesh) selectMesh(selectedMesh);
    else {
        currentSelection = "";
        applySelection();
        document.getElementById("detailsEmpty").hidden = false;
        document.getElementById("detailsContent").hidden = true;
    }
    renderRowButtons();
    renderSummary();
    document.getElementById("viewerLoading").classList.add("is-hidden");
    if (!cameraHasBeenFramed) frameWarehouse();
}

function addFloor() {
    const { width, depth } = warehousePhysicalBounds();
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        new THREE.MeshStandardMaterial({ color: 0xdbe3e8, roughness: .94, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.08;
    floor.receiveShadow = true;
    floor.userData.sceneRole = "floor";
    world.add(floor);
    const grid = new THREE.GridHelper(Math.max(width, depth), Math.ceil(Math.max(width, depth) / 1.25), 0x86a0b0, 0xb7c5ce);
    grid.position.y = -.065;
    grid.material.transparent = true;
    grid.material.opacity = .34;
    grid.visible = viewerSettings.showGrid;
    grid.userData.sceneRole = "grid";
    world.add(grid);
}

function renderRowButtons() {
    const container = document.getElementById("viewerRowButtons");
    container.replaceChildren();
    layoutRows.forEach((row, rowIndex) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = row.code;
        button.title = `Vai alla fila ${row.code}`;
        button.addEventListener("click", () => {
            cameraTransition = null;
            activeCameraViewId = "";
            focusRow(rowIndex);
            renderCameraViews();
        });
        container.appendChild(button);
    });
}

function renderSummary() {
    const logicalUnits = new Set(currentSnapshot.inventory.map((item) => item.id)).size;
    const capacity = currentSnapshot.rows.reduce((total, row) => total + Number(row.capacity || 0), 0);
    const palletBlocked = new Set(currentSnapshot.inventory.filter((item) => item.type === "pallet").map((item) => {
        const parsed = parseLocation(item.location);
        return parsed ? `${parsed.row.code}:${parsed.physicalColumn}` : "";
    }).filter(Boolean)).size * 4;
    document.getElementById("viewerRows").textContent = layoutRows.length === currentSnapshot.rows.length
        ? String(currentSnapshot.rows.length)
        : `${layoutRows.length}/${currentSnapshot.rows.length}`;
    document.getElementById("viewerUnits").textContent = String(logicalUnits);
    document.getElementById("viewerFree").textContent = String(Math.max(0, capacity - currentSnapshot.inventory.length - palletBlocked));
    document.getElementById("viewerStatus").textContent = `Revisione ${Number(currentSnapshot.revision) || 0} · aggiornato ${new Date(currentSnapshot.generatedAt || Date.now()).toLocaleTimeString("it-IT")}`;
}

function frameWarehouse() {
    const maxColumns = layoutMaxColumns;
    const width = maxColumns * 1.28;
    const depth = layoutDepth();
    controls.target.set(0, 1.5, 0);
    camera.position.set(width * .72, Math.max(9, depth * .65), depth * .78);
    camera.near = .1;
    camera.far = 220;
    camera.updateProjectionMatrix();
    controls.update();
    cameraHasBeenFramed = true;
}

function focusRow(rowIndex) {
    const baseZ = layoutRowZ[rowIndex] || 0;
    const distance = Math.max(10, physicalColumns(layoutRows[rowIndex]) * .72);
    controls.target.set(0, 1.5, baseZ);
    camera.position.set(distance, 7, baseZ + 8);
    controls.update();
}

function topView() {
    controls.target.set(0, 0, 0);
    camera.position.set(0, Math.max(22, layoutDepth() * 1.2), .01);
    controls.update();
}

function applyFreeSlotVisibility() {
    pickables.forEach((mesh) => {
        if (mesh.userData.state === "free") mesh.visible = showFreeSlots;
    });
}

function applySearch() {
    const query = document.getElementById("viewerSearch").value.trim().toUpperCase();
    pickables.forEach((mesh) => {
        const matches = query && mesh.userData.searchable.includes(query);
        mesh.userData.matchesSearch = Boolean(matches);
    });
    applySelection();
}

function matchesSelectedContent(candidate, selected) {
    if (!candidate || !selected) return false;
    const fields = new Set(currentSnapshot.displayFields || []);
    if (fields.has("article")) return candidate.article === selected.article;
    if (fields.has("customer")) return candidate.customer === selected.customer;
    if (fields.has("order")) return candidate.orderReference === selected.orderReference;
    if (fields.has("weighing")) return Boolean(selected.weighingCode)
        && String(candidate.weighingCode || "").toUpperCase() === String(selected.weighingCode).toUpperCase();
    return candidate.article === selected.article;
}

function applySelection() {
    const selectedMesh = pickables.find((mesh) => mesh.userData.locations?.includes(currentSelection)
        || mesh.userData.location === currentSelection);
    const selectedItem = selectedMesh?.userData.item || null;
    pickables.forEach((mesh) => {
        const selected = mesh.userData.locations?.includes(currentSelection) || mesh.userData.location === currentSelection;
        const related = !selected && matchesSelectedContent(mesh.userData.item, selectedItem);
        mesh.userData.selected = selected;
        mesh.userData.related = related;
        const movementColor = mesh.userData.movementRole === "source"
            ? palette.movementUnload
            : mesh.userData.movementRole === "target"
              ? palette.movementLoad
              : mesh.userData.movementRole === "shift"
                ? palette.movementShift
                : null;
        const fillColor = movementColor || (selected
            ? palette.selectedFill
            : mesh.userData.matchesSearch
              ? palette.searchFill
              : related
                ? palette.relatedFill
                : mesh.userData.baseColor);
        mesh.material.color.setHex(fillColor);
        mesh.material.emissive.setHex(0x000000);
        mesh.material.emissiveIntensity = 0;
        const outline = mesh.userData.outline;
        outline.visible = selected || related || mesh.userData.matchesSearch;
        outline.material.color.setHex(selected ? palette.selected : mesh.userData.matchesSearch ? palette.match : palette.related);
        outline.scale.setScalar(selected ? 1.105 : 1.075);
    });
    updateSurfaceLabels();
}

function updateSurfaceLabels() {
    pickables.forEach((mesh) => {
        (mesh.userData.labels || []).forEach((label) => {
            label.visible = surfaceLabelsVisible;
            label.material.opacity = mesh.userData.selected || mesh.userData.related || mesh.userData.matchesSearch ? 1 : .92;
        });
    });
}

function movementSteps(movement) {
    if (movement?.playbackSteps?.length) return movement.playbackSteps.map((step) => ({
        ...step,
        from: [...(step.from || [])],
        to: [...(step.to || [])],
        units: (step.units || []).map((unit) => ({ ...unit })),
    }));
    if (movement?.operationalSteps?.length) return movement.operationalSteps.map((step) => ({
        ...step,
        from: [...(step.from || [])],
        to: [...(step.to || [])],
        units: (step.units || []).map((unit) => ({ ...unit })),
    }));
    const changes = movement?.changes || {};
    const itemFor = (id) => [...(movement?.afterState || []), ...(movement?.beforeState || [])].find((item) => item.id === id) || {};
    return [
        ...(changes.loaded || []).map((entry) => ({ kind: "load", from: [], to: [...(entry.to || [])], units: [{ ...itemFor(entry.id), id: entry.id, article: entry.article }] })),
        ...(changes.unloaded || []).map((entry) => ({ kind: "unload", from: [...(entry.from || [])], to: ["In Attesa/Preparazione/Montaggio"], units: [{ ...itemFor(entry.id), id: entry.id, article: entry.article }] })),
        ...(changes.shifted || []).map((entry) => ({ kind: "reinsert", from: [...(entry.from || [])], to: [...(entry.to || [])], units: [{ ...itemFor(entry.id), id: entry.id, article: entry.article }] })),
    ];
}

function operationalLocations(values) {
    return Array.from(new Set((values || []).flatMap((value) => String(value || "").match(/[A-Z]\d{1,3}[a-c]/gi) || [])
        .map((value) => value[0].toUpperCase() + value.slice(1).toLowerCase())))
        .filter((location) => parseLocation(location));
}

function locationScenePosition(location) {
    const parsed = parseLocation(location);
    if (!parsed) return null;
    const rowIndex = layoutRows.findIndex((row) => row.code === parsed.row.code);
    if (rowIndex < 0) return null;
    return slotPosition(rowIndex, parsed.physicalColumn, parsed.side, parsed.level);
}

function movementExternalPosition(kind, referencePosition) {
    const reference = referencePosition || new THREE.Vector3(0, .5, 0);
    if (kind === "corridor") return new THREE.Vector3(reference.x, reference.y, reference.z + 2.35);
    if (kind === "dock") return dockAreaPosition();
    return stagingPositionForUnit(null);
}

function movementStepDescription(step) {
    const from = operationalLocations(step.from).join(", ");
    const to = operationalLocations(step.to).join(", ");
    const articles = Array.from(new Set((step.units || []).map((unit) => unit.article).filter(Boolean))).join(", ");
    if (["corridor", "optimization-corridor", "optimization-stage"].includes(step.kind)) return `Spostamento temporaneo dal fronte ${from || articles || "unità"} → corridoio`;
    if (["reinsert", "optimization-place"].includes(step.kind)) return `Riallocazione frontale ${articles || "unità"} → ${to || "destinazione"}`;
    if (step.kind === "unload") return `Prelievo frontale ${from || articles || "unità"} → In Attesa/Preparazione/Montaggio`;
    if (step.kind === "piece-pick") return `Prelievo ${step.pieceQuantity || 0} pezzi${articles ? ` · articolo ${articles}` : ""}`;
    if (step.kind === "staging-exit") return `Uscita ${articles || "unità"} · In Attesa/Preparazione/Montaggio → zona carico/uscita`;
    if (step.kind === "load") return `Carico ${articles || "unità"} → ${to || "destinazione"}`;
    return `${from || "Corridoio"}${to ? ` → ${to}` : ""}${articles ? ` · ${articles}` : ""}`;
}

function movementStepColor(kind) {
    if (kind === "load") return palette.movementLoad;
    if (kind === "unload" || kind === "piece-pick") return palette.movementUnload;
    if (["corridor", "optimization-corridor", "optimization-stage"].includes(kind)) return palette.movementCorridor;
    return palette.movementShift;
}

function movementUnitRequiresReturn(unit, step) {
    if (step?.requiresWarehouseReturn || unit?.requiresWarehouseReturn) return true;
    const unitId = movementUnitKey(unit);
    if (unitId && movementPlaybackState?.steps.some((candidate) => candidate.kind === "piece-pick"
        && (candidate.units || []).some((candidateUnit) => movementUnitKey(candidateUnit) === unitId))) return true;
    return Boolean((currentSnapshot.stagingUnits || []).find((item) => item.id === unit?.id)?.requiresWarehouseReturn);
}

function movementAreaPosition(area, unit, index, stagingContext = []) {
    if (area === "staging") return stagingPositionForUnit(unit, stagingContext);
    return dockAreaPosition(index);
}

function movementRoutePath(route, kind) {
    const source = route.source.clone();
    const target = route.target.clone();
    const bounds = warehousePhysicalBounds();
    const outerX = stagingAreaGeometry().outerX;
    const sourceAisle = route.sourceLocation ? aislePositionForLocation(route.sourceLocation) : null;
    const targetAisle = route.targetLocation ? aislePositionForLocation(route.targetLocation) : null;
    const raw = [source];
    if (["corridor", "optimization-corridor", "optimization-stage"].includes(kind)) {
        if (sourceAisle) raw.push(sourceAisle);
    } else if (["reinsert", "optimization-place"].includes(kind)) {
        if (targetAisle) raw.push(targetAisle);
        raw.push(target);
    } else if (kind === "unload") {
        if (sourceAisle) raw.push(sourceAisle);
        raw.push(new THREE.Vector3(outerX, source.y, sourceAisle?.z ?? source.z));
        raw.push(new THREE.Vector3(outerX, target.y, target.z), target);
    } else if (kind === "staging-exit") {
        raw.push(new THREE.Vector3(outerX, source.y, source.z));
        raw.push(new THREE.Vector3(outerX, target.y, target.z), target);
    } else if (kind === "load") {
        raw.push(new THREE.Vector3(outerX, source.y, source.z));
        if (targetAisle) raw.push(new THREE.Vector3(outerX, target.y, targetAisle.z), targetAisle);
        raw.push(target);
    } else {
        raw.push(target);
    }
    const compact = raw.filter((point, index) => !index || point.distanceToSquared(raw[index - 1]) > .0001);
    if (compact.length < 2) return compact;
    const safeY = Math.max(source.y, target.y) + .72;
    const path = [source, new THREE.Vector3(source.x, safeY, source.z)];
    compact.slice(1, -1).forEach((point) => path.push(new THREE.Vector3(
        Math.min(bounds.maxX - .25, Math.max(bounds.minX + .25, point.x)),
        safeY,
        point.z,
    )));
    path.push(new THREE.Vector3(target.x, safeY, target.z), target);
    return path.filter((point, index) => !index || point.distanceToSquared(path[index - 1]) > .0001);
}

function movementPathPoint(path, progress) {
    if (!path?.length) return new THREE.Vector3();
    if (path.length === 1) return path[0].clone();
    const lengths = [];
    let total = 0;
    for (let index = 1; index < path.length; index += 1) {
        const length = path[index - 1].distanceTo(path[index]);
        lengths.push(length);
        total += length;
    }
    if (!total) return path[path.length - 1].clone();
    let remaining = Math.min(1, Math.max(0, progress)) * total;
    for (let index = 0; index < lengths.length; index += 1) {
        if (remaining <= lengths[index] || index === lengths.length - 1) {
            return path[index].clone().lerp(path[index + 1], lengths[index] ? remaining / lengths[index] : 1);
        }
        remaining -= lengths[index];
    }
    return path[path.length - 1].clone();
}

function movementStepRoutes(step) {
    const fromLocations = operationalLocations([
        ...(step.from || []),
        ...(step.units || []).map((unit) => unit.from),
    ]);
    const toLocations = operationalLocations([
        ...(step.to || []),
        ...(step.units || []).map((unit) => unit.to),
    ]);
    if (step.units?.length === 1 && step.units[0].type === "pallet") {
        const averagePosition = (locations) => {
            const positions = locations.map(locationScenePosition).filter(Boolean);
            if (!positions.length) return null;
            return positions.reduce((total, position) => total.add(position), new THREE.Vector3()).multiplyScalar(1 / positions.length);
        };
        const sourceSlot = averagePosition(fromLocations);
        const targetSlot = averagePosition(toLocations);
        const unit = step.units[0];
        const corridorMove = ["corridor", "optimization-corridor", "optimization-stage"].includes(step.kind);
        const fromCorridor = ["reinsert", "optimization-place"].includes(step.kind);
        const sourceArea = step.kind === "staging-exit" || step.sourceArea === "staging" ? "staging" : "dock";
        const source = fromCorridor
            ? aislePositionForLocation(toLocations[0]) || movementExternalPosition("corridor", targetSlot || sourceSlot)
            : sourceSlot || movementAreaPosition(sourceArea, unit, 0, step.sourceStagingUnits || []);
        const target = step.kind === "staging-exit"
            ? movementAreaPosition("dock", unit, 0, step.units || [])
            : targetSlot || (corridorMove
                ? aislePositionForLocation(fromLocations[0]) || movementExternalPosition("corridor", sourceSlot)
                : movementAreaPosition("staging", unit, 0));
        const route = { source, target, unit, sourceLocation: fromLocations[0] || "", targetLocation: toLocations[0] || "" };
        route.path = movementRoutePath(route, step.kind);
        return [route];
    }
    const count = Math.max(1, fromLocations.length, toLocations.length, step.units?.length || 0);
    const routes = Array.from({ length: count }, (_, index) => {
        const sourceLocation = fromLocations[index] || fromLocations[fromLocations.length - 1] || "";
        const targetLocation = toLocations[index] || toLocations[toLocations.length - 1] || "";
        const sourceSlot = locationScenePosition(sourceLocation);
        const targetSlot = locationScenePosition(targetLocation);
        const corridorMove = ["corridor", "optimization-corridor", "optimization-stage"].includes(step.kind);
        const fromCorridor = ["reinsert", "optimization-place"].includes(step.kind);
        const unit = step.units?.[index] || step.units?.[0] || null;
        const sourceArea = step.kind === "staging-exit" || step.sourceArea === "staging" ? "staging" : "dock";
        const source = fromCorridor
            ? aislePositionForLocation(targetLocation) || movementExternalPosition("corridor", targetSlot || sourceSlot)
            : sourceSlot || movementAreaPosition(sourceArea, unit, index, step.sourceStagingUnits || []);
        let target = targetSlot;
        if (step.kind === "piece-pick") target = source.clone();
        else if (step.kind === "staging-exit") target = movementAreaPosition("dock", unit, index);
        else if (!target) target = corridorMove
            ? aislePositionForLocation(sourceLocation) || movementExternalPosition("corridor", sourceSlot)
            : movementAreaPosition("staging", unit, index);
        return { source, target, unit, sourceLocation, targetLocation };
    });
    const groundStack = (endpoint) => {
        const minimum = Math.min(...routes.map((route) => route[endpoint].y));
        routes.forEach((route) => { route[endpoint].y += .49 - minimum; });
    };
    if (step.kind === "load" && step.sourceArea !== "staging") groundStack("source");
    if (["staging-exit", "corridor", "optimization-corridor", "optimization-stage"].includes(step.kind)) groundStack("target");
    if (["reinsert", "optimization-place"].includes(step.kind)) groundStack("source");
    routes.forEach((route) => { route.path = movementRoutePath(route, step.kind); });
    return routes;
}

function clearMovementGhosts() {
    clearObject(movementGhostLayer);
}

function clearMovementDeposits() {
    clearObject(movementDepositLayer);
}

function movementUnitKey(unit) {
    return String(unit?.id || "").trim();
}

function createMovementDeposit(unit, position, requiresReturn = false) {
    const pallet = unit?.type === "pallet";
    const color = requiresReturn ? 0xb666d2 : pallet ? 0xe6a16f : 0x66aee0;
    const mesh = createBox(pallet ? .98 : .82, pallet ? .68 : .72, pallet ? 1.62 : .72, color, { castShadow: true });
    mesh.position.copy(position);
    mesh.userData.sceneRole = "movement-deposit";
    mesh.userData.stagingUnitId = movementUnitKey(unit);
    mesh.userData.item = unit;
    mesh.userData.movementRole = "";
    const lines = [
        unit?.article || "Articolo —",
        requiresReturn ? "RIENTRO" : "PRONTO USCITA",
        `${Number(unit?.pieceCount) || 0} pezzi`,
    ];
    ["front", "rear"].forEach((face) => {
        const label = createSurfaceLabel(lines, face, pallet);
        label.position.set(0, 0, (face === "front" ? -1 : 1) * (pallet ? .816 : .366));
        mesh.add(label);
    });
    movementDepositLayer.add(mesh);
    return mesh;
}

function syncMovementDeposits(completedThroughIndex) {
    const state = movementPlaybackState;
    clearMovementDeposits();
    if (!state || completedThroughIndex < 0) return;
    const deposits = new Map();
    state.steps.slice(0, completedThroughIndex + 1).forEach((step) => {
        if (step.kind === "unload") {
            movementStepRoutes(step).forEach((route) => {
                const key = movementUnitKey(route.unit);
                if (!key) return;
                deposits.set(key, {
                    unit: { ...route.unit },
                    position: route.target.clone(),
                    requiresReturn: movementUnitRequiresReturn(route.unit, step),
                });
            });
            return;
        }
        if (step.kind === "piece-pick") {
            (step.units || []).forEach((unit) => {
                const key = movementUnitKey(unit);
                const deposit = deposits.get(key);
                if (!deposit) return;
                deposit.unit = {
                    ...deposit.unit,
                    pieceCount: Math.max(0, Number(step.remainingPieces) || 0),
                    requiresWarehouseReturn: true,
                };
                deposit.requiresReturn = true;
            });
            return;
        }
        if (step.kind === "staging-exit" || (step.kind === "load" && step.sourceArea === "staging")) {
            (step.units || []).forEach((unit) => deposits.delete(movementUnitKey(unit)));
        }
    });
    deposits.forEach((deposit) => createMovementDeposit(deposit.unit, deposit.position, deposit.requiresReturn));
}

function setMovementMeshRoles(step = null) {
    const sources = new Set(operationalLocations([...(step?.from || []), ...(step?.units || []).map((unit) => unit.from)]));
    const targets = new Set(operationalLocations([...(step?.to || []), ...(step?.units || []).map((unit) => unit.to)]));
    pickables.forEach((mesh) => {
        const locations = mesh.userData.locations || [mesh.userData.location];
        mesh.userData.movementRole = locations.some((location) => sources.has(location))
            ? "source"
            : locations.some((location) => targets.has(location))
              ? (["reinsert", "optimization-place"].includes(step?.kind) ? "shift" : "target")
              : "";
    });
    applySelection();
}

function setStagingMovementRoles(step = null) {
    const activeIds = new Set(step?.kind === "piece-pick"
        ? (step.units || []).map((unit) => unit.id).filter(Boolean)
        : []);
    [...world.children, ...movementDepositLayer.children].forEach((object) => {
        if (!["staging-unit", "movement-deposit"].includes(object.userData?.sceneRole)) return;
        object.userData.movementRole = activeIds.has(object.userData.stagingUnitId) ? "staging-pick" : "";
        if (!object.userData.movementRole && object.material?.emissive) {
            object.material.emissive.setHex(0x000000);
            object.material.emissiveIntensity = 0;
        }
    });
}

function movementDestinationLocations(steps, endIndex = steps.length - 1) {
    return new Set(steps.slice(0, Math.max(0, endIndex + 1)).flatMap((step) => (
        ["load", "reinsert", "optimization-place"].includes(step.kind)
            ? operationalLocations([...(step.to || []), ...(step.units || []).map((unit) => unit.to)])
            : []
    )));
}

function applyMovementDestinationVisibility(completedThroughIndex) {
    const state = movementPlaybackState;
    if (!state) return;
    const allDestinations = movementDestinationLocations(state.steps);
    const completed = movementDestinationLocations(state.steps, completedThroughIndex);
    pickables.forEach((mesh) => {
        const locations = mesh.userData.locations || [mesh.userData.location];
        if (!locations.some((location) => allDestinations.has(location))) return;
        mesh.visible = locations.some((location) => completed.has(location));
    });
    const stagingIds = new Set(state.steps.filter((step) => step.kind === "unload")
        .flatMap((step) => (step.units || []).map((unit) => unit.id).filter(Boolean)));
    world.children.forEach((object) => {
        if (object.userData?.sceneRole !== "staging-unit" || !stagingIds.has(object.userData.stagingUnitId)) return;
        // Durante la riproduzione i depositi vengono rappresentati dalla layer
        // persistente: evita sia lo sdoppiamento sia la dipendenza dallo snapshot.
        object.visible = false;
    });
    syncMovementDeposits(completedThroughIndex);
}

function showMovement3dStep(index, restart = true) {
    if (!movementPlaybackState?.steps.length) return;
    const state = movementPlaybackState;
    state.index = Math.max(0, Math.min(index, state.steps.length - 1));
    state.progress = 0;
    state.currentDeposited = false;
    if (restart) state.stepStartedAt = performance.now();
    const step = state.steps[state.index];
    applyMovementDestinationVisibility(state.index - 1);
    setMovementMeshRoles(step);
    setStagingMovementRoles(step);
    clearMovementGhosts();
    const color = movementStepColor(step.kind);
    // Il prelievo parziale avviene sul cassone già arrivato nell'area di
    // preparazione: non creare un secondo fantasma dalla posizione originaria.
    const routes = step.kind === "piece-pick" ? [] : movementStepRoutes(step);
    routes.forEach((route) => {
        const pallet = route.unit?.type === "pallet";
        const unitColor = movementUnitRequiresReturn(route.unit, step) ? 0xb666d2 : color;
        const ghost = createBox(pallet ? .98 : .8, pallet ? .68 : .7, pallet ? 1.62 : .7, unitColor, {
            transparent: true,
            opacity: .9,
            castShadow: true,
        });
        ghost.position.copy(route.source);
        ghost.userData.route = route;
        ghost.userData.sceneRole = "movement-ghost";
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(ghost.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9 }));
        ghost.add(edges);
        if (route.unit) {
            const lines = [
                route.unit.article || "Articolo —",
                route.unit.weighingCode ? `Pesata ${route.unit.weighingCode}` : "",
                route.unit.pieceCount ? `${route.unit.pieceCount} pezzi` : "",
            ].filter(Boolean);
            ["front", "rear"].forEach((face) => {
                const label = createSurfaceLabel(lines, face, pallet);
                label.position.set(0, 0, (face === "front" ? -1 : 1) * (pallet ? .816 : .356));
                ghost.add(label);
            });
        }
        movementGhostLayer.add(ghost);
    });
    document.getElementById("movement3dCounter").textContent = `${state.movement.id} · PASSAGGIO ${state.index + 1}/${state.steps.length}`;
    document.getElementById("movement3dTitle").textContent = state.movement.type === "load"
        ? "Movimentazione di carico"
        : state.movement.type === "exit"
          ? "Uscita verso la Zona Scarico"
          : state.movement.optimization ? "Ottimizzazione magazzino" : "Movimentazione di scarico";
    document.getElementById("movement3dDescription").textContent = movementStepDescription(step);
    document.getElementById("movement3dPrevious").disabled = state.index === 0;
    document.getElementById("movement3dNext").disabled = state.index === state.steps.length - 1;
    document.getElementById("movement3dToggle").textContent = state.paused ? "Riprendi" : "Pausa";
}

function startMovement3dPlayback(movement) {
    const steps = movementSteps(movement);
    if (!steps.length) return;
    if (movementPlaybackState) stopMovement3dPlayback();
    clearMovementDeposits();
    movementPlaybackState = { movement, steps, index: 0, paused: false, progress: 0, stepStartedAt: performance.now(), duration: 1800, hold: 500 };
    document.getElementById("movement3dPlayback").hidden = false;
    showMovement3dStep(0);
}

function stopMovement3dPlayback() {
    if (movementPlaybackState) {
        const allDestinations = movementDestinationLocations(movementPlaybackState.steps);
        pickables.forEach((mesh) => {
            const locations = mesh.userData.locations || [mesh.userData.location];
            if (locations.some((location) => allDestinations.has(location))) mesh.visible = true;
        });
        world.children.forEach((object) => {
            if (object.userData?.sceneRole === "staging-unit") object.visible = true;
        });
        applyFreeSlotVisibility();
    }
    movementPlaybackState = null;
    clearMovementGhosts();
    clearMovementDeposits();
    setMovementMeshRoles();
    setStagingMovementRoles();
    document.getElementById("movement3dPlayback").hidden = true;
}

function updateMovement3dPlayback(timestamp) {
    const state = movementPlaybackState;
    if (!state || state.paused) return;
    const elapsed = (timestamp - state.stepStartedAt) * viewerSettings.playbackSpeed;
    state.progress = Math.min(1, elapsed / state.duration);
    const eased = state.progress < .5 ? 2 * state.progress * state.progress : 1 - Math.pow(-2 * state.progress + 2, 2) / 2;
    movementGhostLayer.children.forEach((ghost) => {
        ghost.position.copy(movementPathPoint(ghost.userData.route.path, eased));
    });
    if (state.steps[state.index]?.kind === "piece-pick") {
        const stagingPulse = .24 + Math.abs(Math.sin(elapsed / 120)) * .5;
        [...world.children, ...movementDepositLayer.children].forEach((object) => {
            if (!object.visible || object.userData?.movementRole !== "staging-pick" || !object.material?.emissive) return;
            object.material.emissive.setHex(0xb666d2);
            object.material.emissiveIntensity = stagingPulse;
        });
    }
    if (state.progress >= 1 && !state.currentDeposited) {
        state.currentDeposited = true;
        applyMovementDestinationVisibility(state.index);
        movementGhostLayer.children.forEach((ghost) => { ghost.visible = false; });
    }
    if (state.currentDeposited) {
        const pulse = .18 + Math.abs(Math.sin(elapsed / 90)) * .48;
        pickables.forEach((mesh) => {
            if (!mesh.visible || !["target", "shift"].includes(mesh.userData.movementRole)) return;
            mesh.material.emissive.setHex(mesh.userData.movementRole === "shift" ? palette.movementShift : palette.movementLoad);
            mesh.material.emissiveIntensity = pulse;
        });
        world.children.forEach((object) => {
            if (!object.visible || object.userData?.movementRole !== "staging-pick" || !object.material?.emissive) return;
            object.material.emissive.setHex(0xb666d2);
            object.material.emissiveIntensity = pulse;
        });
    }
    if (elapsed < state.duration + state.hold) return;
    applySelection();
    if (state.index < state.steps.length - 1) showMovement3dStep(state.index + 1);
    else {
        state.paused = true;
        state.progress = 1;
        document.getElementById("movement3dToggle").textContent = "Completata";
    }
}

function setMovementPlaybackSpeed(value) {
    const previousSpeed = viewerSettings.playbackSpeed;
    const nextSpeed = Math.min(2, Math.max(.4, Math.round(Number(value) * 10) / 10));
    if (movementPlaybackState && !movementPlaybackState.paused && previousSpeed !== nextSpeed) {
        const elapsed = performance.now() - movementPlaybackState.stepStartedAt;
        movementPlaybackState.stepStartedAt = performance.now() - elapsed * previousSpeed / nextSpeed;
    }
    viewerSettings.playbackSpeed = nextSpeed;
    saveViewerSettings();
    const label = `${Math.round(nextSpeed * 100)}%`;
    const hudOutput = document.getElementById("movement3dSpeedValue");
    const settingsOutput = document.getElementById("playbackSpeedValue");
    const settingsControl = document.getElementById("playbackSpeedControl");
    if (hudOutput) hudOutput.textContent = label;
    if (settingsOutput) settingsOutput.textContent = label;
    if (settingsControl) settingsControl.value = String(Math.round(nextSpeed * 100));
}

function setupMovement3dPlayback() {
    document.getElementById("movement3dPrevious")?.addEventListener("click", () => showMovement3dStep((movementPlaybackState?.index || 0) - 1));
    document.getElementById("movement3dNext")?.addEventListener("click", () => showMovement3dStep((movementPlaybackState?.index || 0) + 1));
    document.getElementById("movement3dToggle")?.addEventListener("click", () => {
        if (!movementPlaybackState) return;
        movementPlaybackState.paused = !movementPlaybackState.paused;
        movementPlaybackState.stepStartedAt = performance.now() - movementPlaybackState.progress * movementPlaybackState.duration / viewerSettings.playbackSpeed;
        document.getElementById("movement3dToggle").textContent = movementPlaybackState.paused ? "Riprendi" : "Pausa";
    });
    document.getElementById("movement3dReplay")?.addEventListener("click", () => {
        if (movementPlaybackState) startMovement3dPlayback(movementPlaybackState.movement);
    });
    document.getElementById("movement3dSlower")?.addEventListener("click", () => setMovementPlaybackSpeed(viewerSettings.playbackSpeed - .1));
    document.getElementById("movement3dFaster")?.addEventListener("click", () => setMovementPlaybackSpeed(viewerSettings.playbackSpeed + .1));
    document.getElementById("movement3dClose")?.addEventListener("click", stopMovement3dPlayback);
}

function movement3dHistoryType(movement) {
    if (movement.optimization) return "Ottimizzazione";
    const type = movement.type === "load" ? "Carico" : movement.type === "exit" ? "Uscita" : "Scarico";
    return `${type}${movement.manual ? " manuale" : ""}`;
}

function movement3dHistoryUnits(movement) {
    const actionKinds = movement.optimization
        ? new Set(["optimization-place"])
        : movement.type === "load"
          ? new Set(["load"])
          : movement.type === "exit"
            ? new Set(["staging-exit"])
            : new Set(["unload"]);
    const units = (movement.operationalSteps || movement.playbackSteps || [])
        .filter((step) => actionKinds.has(step.kind))
        .flatMap((step) => step.units || []);
    const unique = new Map();
    units.forEach((unit, index) => unique.set(unit.id || `${unit.article}:${unit.weighingCode}:${index}`, unit));
    if (unique.size) return Array.from(unique.values());
    const changeKey = movement.type === "load" ? "loaded" : movement.optimization ? "shifted" : "unloaded";
    const changedIds = new Set((movement.changes?.[changeKey] || []).map((entry) => entry.id).filter(Boolean));
    [...(movement.afterState || []), ...(movement.beforeState || [])].forEach((unit) => {
        if (changedIds.has(unit?.id) && !unique.has(unit.id)) unique.set(unit.id, unit);
    });
    return Array.from(unique.values());
}

function compactMovement3dValues(values, maximum = 6) {
    const unique = Array.from(new Set((values || []).filter(Boolean).map(String)));
    if (!unique.length) return "—";
    return unique.length <= maximum ? unique.join(", ") : `${unique.slice(0, maximum).join(", ")} +${unique.length - maximum}`;
}

function movement3dTooltipRow(list, label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = String(value ?? "—");
    list.append(term, detail);
}

function hideMovement3dHistoryTooltip() {
    const tooltip = document.getElementById("movementHistory3dTooltip");
    if (tooltip) tooltip.hidden = true;
}

function showMovement3dHistoryTooltip(movement, anchor) {
    const tooltip = document.getElementById("movementHistory3dTooltip");
    if (!tooltip) return;
    const units = movement3dHistoryUnits(movement);
    const actor = movement.actor?.displayName || movement.actor?.employee || movement.actor?.adminName || "Operatore non registrato";
    const steps = movementSteps(movement);
    const locations = steps.flatMap((step) => [
        ...operationalLocations(step.from || []),
        ...operationalLocations(step.to || []),
    ]);
    const pieces = units.reduce((total, unit) => total + Math.max(0, Number(unit.pieceCount) || 0), 0);

    const head = document.createElement("div");
    head.className = "movement-tooltip-head";
    const identity = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = movement.id;
    const meta = document.createElement("small");
    meta.textContent = `${new Date(movement.timestamp).toLocaleString("it-IT")} · ${actor}`;
    identity.append(title, meta);
    const badge = document.createElement("b");
    badge.textContent = movement3dHistoryType(movement);
    head.append(identity, badge);

    const grid = document.createElement("dl");
    grid.className = "movement-tooltip-grid";
    movement3dTooltipRow(grid, "Articoli", compactMovement3dValues(units.map((unit) => unit.article)));
    movement3dTooltipRow(grid, "Clienti", compactMovement3dValues(units.map((unit) => unit.customer)));
    movement3dTooltipRow(grid, "Cassoni", units.length || "—");
    movement3dTooltipRow(grid, "N. pezzi", pieces || "—");
    movement3dTooltipRow(grid, "Rif. ordini", compactMovement3dValues(units.map((unit) => unit.orderReference)));
    movement3dTooltipRow(grid, "Pesate", compactMovement3dValues(units.map((unit) => unit.weighingCode)));
    movement3dTooltipRow(grid, "Posizioni", compactMovement3dValues(locations, 8));

    const sequence = document.createElement("section");
    sequence.className = "movement-tooltip-steps";
    const sequenceTitle = document.createElement("strong");
    sequenceTitle.textContent = `Sequenza sintetica · ${steps.length} passaggi`;
    const stepList = document.createElement("ol");
    steps.slice(0, 5).forEach((step) => {
        const item = document.createElement("li");
        item.textContent = movementStepDescription(step);
        stepList.appendChild(item);
    });
    if (steps.length > 5) {
        const more = document.createElement("li");
        more.textContent = `Altri ${steps.length - 5} passaggi…`;
        stepList.appendChild(more);
    }
    sequence.append(sequenceTitle, stepList);
    const hint = document.createElement("small");
    hint.className = "movement-tooltip-hint";
    hint.textContent = "Clic per riprodurre · tasto destro per i dettagli";
    tooltip.replaceChildren(head, grid, sequence, hint);
    tooltip.hidden = false;

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = anchorRect.left - tooltipRect.width - 10;
    if (left < 8) left = Math.min(window.innerWidth - tooltipRect.width - 8, anchorRect.right + 10);
    const top = Math.max(8, Math.min(anchorRect.top, window.innerHeight - tooltipRect.height - 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
}

function renderMovement3dHistory() {
    const movements = currentSnapshot.movementHistory || [];
    document.getElementById("movement3dHistoryCount").textContent = String(currentSnapshot.movementHistoryTotal ?? movements.length);
    const list = document.getElementById("movement3dHistoryList");
    const empty = document.getElementById("movement3dHistoryEmpty");
    hideMovement3dHistoryTooltip();
    list.replaceChildren();
    empty.hidden = movements.length > 0;
    movements.forEach((movement) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "movement-history-3d-card";
        const content = document.createElement("span");
        const title = document.createElement("strong");
        title.textContent = movement.id;
        const detail = document.createElement("small");
        const actor = movement.actor?.displayName || movement.actor?.employee || movement.actor?.adminName || "Operatore non registrato";
        detail.textContent = `${new Date(movement.timestamp).toLocaleString("it-IT")} · ${movement.playbackSteps?.length || 0} passaggi · ${actor}`;
        content.append(title, detail);
        const badge = document.createElement("b");
        badge.textContent = movement.optimization ? "Ottimizzazione" : movement.type === "load" ? "Carico" : movement.type === "exit" ? "Uscita" : "Scarico";
        card.append(content, badge);
        card.addEventListener("click", () => {
            hideMovement3dHistoryTooltip();
            startMovement3dPlayback(movement);
        });
        card.addEventListener("mouseenter", () => showMovement3dHistoryTooltip(movement, card));
        card.addEventListener("mouseleave", () => {
            if (document.activeElement !== card) hideMovement3dHistoryTooltip();
        });
        card.addEventListener("focus", () => showMovement3dHistoryTooltip(movement, card));
        card.addEventListener("blur", hideMovement3dHistoryTooltip);
        card.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            hideMovement3dHistoryTooltip();
            openMovementContextMenu3d(movement, event.clientX, event.clientY);
        });
        list.appendChild(card);
    });
}

function closeMovementContextMenu3d() {
    contextMovement3dId = "";
    const menu = document.getElementById("movementContextMenu3d");
    menu.classList.remove("is-open");
    menu.setAttribute("aria-hidden", "true");
}

function openMovementContextMenu3d(movement, x, y) {
    contextMovement3dId = movement.id;
    const menu = document.getElementById("movementContextMenu3d");
    menu.dataset.movementId = movement.id;
    document.getElementById("movementContextTitle3d").textContent = movement.id;
    menu.classList.add("is-open");
    menu.setAttribute("aria-hidden", "false");
    const width = 238;
    const height = 116;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
}

function requestMovementWindowFrom3d(view) {
    const movementId = contextMovement3dId || document.getElementById("movementContextMenu3d")?.dataset.movementId;
    if (!movementId) return;
    closeMovementContextMenu3d();
    ipcRenderer.send("warehouse-3d-movement-action", { movementId, view });
}

function setMovement3dHistoryOpen(open) {
    const panel = document.getElementById("movement3dHistoryPanel");
    panel.hidden = false;
    document.getElementById("openMovement3dHistory").setAttribute("aria-expanded", "true");
    if (!open) return;
    panel.classList.remove("is-attention");
    void panel.offsetWidth;
    panel.classList.add("is-attention");
    window.setTimeout(() => panel.classList.remove("is-attention"), 700);
    document.getElementById("viewerSettings").hidden = true;
    document.getElementById("toggleViewSettings").classList.remove("is-active");
    document.getElementById("toggleViewSettings").setAttribute("aria-expanded", "false");
    setCameraViewsPanelOpen(false);
    renderMovement3dHistory();
}

function setupMovement3dHistory() {
    document.getElementById("openMovement3dHistory")?.addEventListener("click", () => setMovement3dHistoryOpen(true));
    document.getElementById("closeMovement3dHistory")?.addEventListener("click", () => setMovement3dHistoryOpen(false));
    document.getElementById("openMovementComparison3d")?.addEventListener("click", () => requestMovementWindowFrom3d("comparison"));
    document.getElementById("openMovementInstructions3d")?.addEventListener("click", () => requestMovementWindowFrom3d("instructions"));
    document.getElementById("movementContextMenu3d")?.addEventListener("pointerdown", (event) => event.stopPropagation());
    document.addEventListener("pointerdown", (event) => {
        if (!event.target.closest?.("#movementContextMenu3d")) closeMovementContextMenu3d();
    });
}

function detailsRows(mesh) {
    const item = mesh.userData.item;
    const parsed = parseLocation(mesh.userData.location);
    const base = [
        ["Fila", parsed?.row.code || "—"],
        ["Modulo", parsed?.physicalColumn || "—"],
        ["Lato", parsed?.side === "front" ? "Anteriore" : "Posteriore"],
        ["Livello", parsed?.level || "—"],
    ];
    if (!item) return base;
    return [
        ...base,
        ["Tipologia", item.type === "pallet" ? "Pallet" : "Cassone"],
        ["Articolo", item.article || "—"],
        ["Cliente", item.customer || "—"],
        ["Rif. ordine", item.orderReference || "—"],
        ["Codice pesata", item.weighingCode || "—"],
        ["Pezzi", String(Number(item.pieceCount) || 0)],
        ["Ingresso", item.receivedAt ? new Date(item.receivedAt).toLocaleString("it-IT") : "—"],
        ["Tag", (item.tags || []).join(", ") || "—"],
    ];
}

function selectMesh(mesh, notifyMain = false) {
    if (!mesh) return;
    currentSelection = mesh.userData.location;
    applySelection();
    document.getElementById("detailsEmpty").hidden = true;
    document.getElementById("detailsContent").hidden = false;
    document.getElementById("detailLocation").textContent = mesh.userData.locations?.length > 1
        ? mesh.userData.locations.join(" + ") : mesh.userData.location;
    const states = { free: "Libero", occupied: "Occupato", pallet: "Pallet", blocked: "Bloccato da pallet" };
    document.getElementById("detailState").textContent = states[mesh.userData.state] || mesh.userData.state;
    const fields = document.getElementById("detailFields");
    fields.replaceChildren();
    detailsRows(mesh).forEach(([label, value]) => {
        const row = document.createElement("div");
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = value;
        row.append(term, description);
        fields.appendChild(row);
    });
    document.getElementById("showOn2dMap").disabled = mesh.userData.state === "blocked";
    if (notifyMain) ipcRenderer.send("warehouse-3d-select-slot", currentSelection);
}

function intersectAt(clientX, clientY) {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pickables.filter((mesh) => mesh.visible), false)[0]?.object || null;
}

function updateTooltip(event) {
    const tooltip = document.getElementById("slotTooltip");
    const mesh = intersectAt(event.clientX, event.clientY);
    hoveredObject = mesh;
    if (!mesh) {
        tooltip.hidden = true;
        canvas.style.cursor = "grab";
        return;
    }
    const item = mesh.userData.item;
    tooltip.textContent = item
        ? `${mesh.userData.locations?.join(" + ") || mesh.userData.location}\n${item.type === "pallet" ? "Pallet" : "Cassone"} · ${item.article || "—"}\n${item.customer || "Cliente —"} · ${Number(item.pieceCount) || 0} pezzi\nOrdine ${item.orderReference || "—"} · Pesata ${item.weighingCode || "—"}`
        : `${mesh.userData.location}\n${mesh.userData.state === "blocked" ? "Non utilizzabile: bloccato dal pallet sottostante" : "Slot libero"}`;
    tooltip.style.whiteSpace = "pre-line";
    tooltip.style.left = `${Math.min(window.innerWidth - 295, event.clientX + 15)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - 115, event.clientY + 15)}px`;
    tooltip.hidden = false;
    canvas.style.cursor = "pointer";
}

function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
}

function updateKeyboardMovement(deltaSeconds) {
    if (!["w", "a", "s", "d"].some((key) => pressedMovementKeys.has(key))) return;
    if (cameraTransition) cameraTransition = null;
    if (activeCameraViewId) {
        activeCameraViewId = "";
        renderCameraViews();
    }
    const forward = new THREE.Vector3().subVectors(controls.target, camera.position);
    forward.y = 0;
    if (forward.lengthSq() < .0001) forward.set(0, 0, -1);
    else forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const direction = new THREE.Vector3();
    if (pressedMovementKeys.has("w")) direction.add(forward);
    if (pressedMovementKeys.has("s")) direction.sub(forward);
    if (pressedMovementKeys.has("d")) direction.add(right);
    if (pressedMovementKeys.has("a")) direction.sub(right);
    if (!direction.lengthSq()) return;
    const turbo = pressedMovementKeys.has("shift") ? 2.15 : 1;
    direction.normalize().multiplyScalar(7.2 * viewerSettings.movementSpeed * turbo * Math.min(deltaSeconds, .05));
    camera.position.add(direction);
    controls.target.add(direction);
}

function captureCurrentCamera() {
    return {
        position: camera.position.toArray(),
        target: controls.target.toArray(),
        fov: camera.fov,
        updatedAt: new Date().toISOString(),
    };
}

function cameraViewDescription(view) {
    const height = Number(view.position?.[1] || 0).toLocaleString("it-IT", { maximumFractionDigits: 1 });
    return `Altezza ${height} · campo ${Math.round(Number(view.fov) || 42)}°`;
}

function activateCameraView(view) {
    if (!view) return;
    pressedMovementKeys.clear();
    activeCameraViewId = view.id;
    cameraTransition = {
        startedAt: performance.now(),
        duration: 720,
        fromPosition: camera.position.clone(),
        toPosition: new THREE.Vector3().fromArray(view.position),
        fromTarget: controls.target.clone(),
        toTarget: new THREE.Vector3().fromArray(view.target),
        fromFov: camera.fov,
        toFov: Number(view.fov) || 42,
    };
    renderCameraViews();
}

function updateCameraTransition(timestamp) {
    if (!cameraTransition) return;
    const progress = Math.min(1, (timestamp - cameraTransition.startedAt) / cameraTransition.duration);
    const eased = progress < .5 ? 4 * progress ** 3 : 1 - ((-2 * progress + 2) ** 3) / 2;
    camera.position.lerpVectors(cameraTransition.fromPosition, cameraTransition.toPosition, eased);
    controls.target.lerpVectors(cameraTransition.fromTarget, cameraTransition.toTarget, eased);
    camera.fov = THREE.MathUtils.lerp(cameraTransition.fromFov, cameraTransition.toFov, eased);
    camera.updateProjectionMatrix();
    if (progress >= 1) cameraTransition = null;
}

function persistCameraViewUpdate(view, cameraState = captureCurrentCamera()) {
    Object.assign(view, cameraState);
    saveCameraViews();
    renderCameraViews();
}

function armCameraAction(button, confirmationLabel, action) {
    if (button.dataset.armed === "true") {
        action();
        return;
    }
    const original = button.textContent;
    button.dataset.armed = "true";
    button.textContent = confirmationLabel;
    button.classList.add("is-confirm");
    window.setTimeout(() => {
        if (!button.isConnected || button.dataset.armed !== "true") return;
        button.dataset.armed = "false";
        button.textContent = original;
        button.classList.remove("is-confirm");
    }, 2600);
}

function renderCameraViews() {
    const list = document.getElementById("cameraViewList");
    const empty = document.getElementById("cameraViewEmpty");
    document.getElementById("cameraViewCount").textContent = String(savedCameraViews.length);
    list.replaceChildren();
    empty.hidden = savedCameraViews.length > 0;
    savedCameraViews.forEach((view, index) => {
        const card = document.createElement("article");
        card.className = "camera-view-card";
        card.classList.toggle("is-active", view.id === activeCameraViewId);
        const hotkey = document.createElement("span");
        hotkey.className = "camera-view-hotkey";
        hotkey.textContent = index < 9 ? String(index + 1) : "·";
        const main = document.createElement("div");
        main.className = "camera-view-main";
        const name = document.createElement("input");
        name.className = "camera-view-name";
        name.value = view.name;
        name.maxLength = 42;
        name.readOnly = true;
        name.setAttribute("aria-label", `Nome POV ${view.name}`);
        const meta = document.createElement("small");
        meta.className = "camera-view-meta";
        meta.textContent = cameraViewDescription(view);
        const actions = document.createElement("div");
        actions.className = "camera-view-actions";
        const go = document.createElement("button");
        go.type = "button";
        go.className = "is-go";
        go.textContent = "Vai";
        go.addEventListener("click", () => activateCameraView(view));
        const rename = document.createElement("button");
        rename.type = "button";
        rename.textContent = "Rinomina";
        rename.addEventListener("click", () => {
            if (name.readOnly) {
                name.readOnly = false;
                rename.textContent = "Salva nome";
                name.focus();
                name.select();
                return;
            }
            const nextName = name.value.trim();
            const duplicate = savedCameraViews.some((entry) => entry.id !== view.id && entry.name.toUpperCase() === nextName.toUpperCase());
            if (!nextName || duplicate) {
                name.value = view.name;
                name.select();
                return;
            }
            view.name = nextName;
            view.updatedAt = new Date().toISOString();
            saveCameraViews();
            renderCameraViews();
        });
        name.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !name.readOnly) rename.click();
            if (event.key === "Escape" && !name.readOnly) renderCameraViews();
        });
        const replace = document.createElement("button");
        replace.type = "button";
        replace.textContent = "Sostituisci";
        replace.title = "Sostituisci con la posizione attuale della telecamera";
        replace.addEventListener("click", () => armCameraAction(replace, "Conferma", () => {
            activeCameraViewId = view.id;
            persistCameraViewUpdate(view);
        }));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "is-danger";
        remove.textContent = "Elimina";
        remove.addEventListener("click", () => armCameraAction(remove, "Conferma", () => {
            savedCameraViews = savedCameraViews.filter((entry) => entry.id !== view.id);
            if (activeCameraViewId === view.id) activeCameraViewId = "";
            saveCameraViews();
            renderCameraViews();
        }));
        actions.append(go, rename, replace, remove);
        main.append(name, meta, actions);
        card.append(hotkey, main);
        card.addEventListener("dblclick", (event) => {
            if (!event.target.closest("button, input")) activateCameraView(view);
        });
        list.appendChild(card);
    });
}

function setCameraViewsPanelOpen(open, showSaveForm = false) {
    const panel = document.getElementById("cameraViewsPanel");
    panel.hidden = !open;
    document.getElementById("openCameraViews").classList.toggle("is-active", open);
    document.getElementById("openCameraViews").setAttribute("aria-expanded", String(open));
    if (open) {
        setMovement3dHistoryOpen(false);
        document.getElementById("viewerSettings").hidden = true;
        document.getElementById("toggleViewSettings").classList.remove("is-active");
        document.getElementById("toggleViewSettings").setAttribute("aria-expanded", "false");
        renderCameraViews();
    } else closeCameraSaveForm();
    if (showSaveForm) openCameraSaveForm();
}

function openCameraSaveForm() {
    const form = document.getElementById("cameraSaveForm");
    const input = document.getElementById("cameraViewName");
    form.hidden = false;
    document.getElementById("cameraSaveMessage").textContent = "";
    input.value = `POV ${savedCameraViews.length + 1}`;
    input.focus();
    input.select();
}

function closeCameraSaveForm() {
    document.getElementById("cameraSaveForm").hidden = true;
    document.getElementById("cameraSaveMessage").textContent = "";
}

function setupCameraViews() {
    document.getElementById("saveCameraView").addEventListener("click", () => setCameraViewsPanelOpen(true, true));
    document.getElementById("openCameraViews").addEventListener("click", () => {
        const panel = document.getElementById("cameraViewsPanel");
        setCameraViewsPanelOpen(panel.hidden);
    });
    document.getElementById("closeCameraViews").addEventListener("click", () => setCameraViewsPanelOpen(false));
    document.getElementById("newCameraView").addEventListener("click", openCameraSaveForm);
    document.getElementById("cancelCameraSave").addEventListener("click", closeCameraSaveForm);
    document.getElementById("cameraSaveForm").addEventListener("submit", (event) => {
        event.preventDefault();
        const input = document.getElementById("cameraViewName");
        const message = document.getElementById("cameraSaveMessage");
        const name = input.value.trim();
        if (!name) {
            message.textContent = "Inserisci un nome per il POV.";
            input.focus();
            return;
        }
        if (savedCameraViews.some((entry) => entry.name.toUpperCase() === name.toUpperCase())) {
            message.textContent = "Esiste già un POV con questo nome.";
            input.focus();
            input.select();
            return;
        }
        if (savedCameraViews.length >= 30) {
            message.textContent = "Puoi salvare al massimo 30 POV.";
            return;
        }
        const view = {
            id: `pov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name,
            ...captureCurrentCamera(),
        };
        savedCameraViews.push(view);
        activeCameraViewId = view.id;
        saveCameraViews();
        closeCameraSaveForm();
        renderCameraViews();
    });
    controls.addEventListener("start", () => {
        cameraTransition = null;
        if (!activeCameraViewId) return;
        activeCameraViewId = "";
        renderCameraViews();
    });
    renderCameraViews();
}

let sceneRebuildTimer = null;
function scheduleSceneRebuild() {
    saveViewerSettings();
    if (sceneRebuildTimer) window.clearTimeout(sceneRebuildTimer);
    sceneRebuildTimer = window.setTimeout(() => {
        buildWarehouse();
        renderCameraViews();
        sceneRebuildTimer = null;
    }, 70);
}

function renderSceneRowVisibility() {
    const container = document.getElementById("sceneRowVisibility");
    container.replaceChildren();
    const hidden = new Set(viewerSettings.hiddenRows || []);
    currentSnapshot.rows.forEach((row) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = !hidden.has(row.code);
        input.addEventListener("change", () => {
            const nextHidden = new Set(viewerSettings.hiddenRows || []);
            if (input.checked) nextHidden.delete(row.code);
            else nextHidden.add(row.code);
            if (nextHidden.size >= currentSnapshot.rows.length) {
                input.checked = true;
                return;
            }
            viewerSettings.hiddenRows = Array.from(nextHidden);
            scheduleSceneRebuild();
        });
        label.append(input, document.createTextNode(`Fila ${row.code}`));
        container.appendChild(label);
    });
}

function renderRowSpacingControls() {
    const container = document.getElementById("rowSpacingControls");
    container.replaceChildren();
    currentSnapshot.rows.slice(0, -1).forEach((row, index) => {
        const nextRow = currentSnapshot.rows[index + 1];
        const key = rowSpacingKey(row, nextRow);
        const label = document.createElement("label");
        const name = document.createElement("span");
        name.textContent = `${row.code} – ${nextRow.code}`;
        const input = document.createElement("input");
        input.type = "range";
        input.min = "3.2";
        input.max = "14";
        input.step = ".1";
        input.value = String(rowPairSpacing(row, nextRow));
        const output = document.createElement("output");
        const updateOutput = () => {
            output.textContent = `${Number(input.value).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} u`;
        };
        updateOutput();
        input.addEventListener("input", () => {
            viewerSettings.rowSpacings = { ...viewerSettings.rowSpacings, [key]: Number(input.value) };
            document.querySelectorAll("[data-scene-preset]").forEach((button) => button.classList.remove("is-active"));
            updateOutput();
            applyViewerSettingsLive();
        });
        label.append(name, input, output);
        container.appendChild(label);
    });
    if (!container.childElementCount) {
        const empty = document.createElement("small");
        empty.textContent = "Aggiungi almeno due file per regolare le distanze.";
        container.appendChild(empty);
    }
}

function captureViewerPresetSettings() {
    return {
        rowSpacing: viewerSettings.rowSpacing,
        rowSpacings: { ...(viewerSettings.rowSpacings || {}) },
        rackOpacity: viewerSettings.rackOpacity,
        labelScale: viewerSettings.labelScale,
        cameraFov: viewerSettings.cameraFov,
        movementSpeed: viewerSettings.movementSpeed,
        playbackSpeed: viewerSettings.playbackSpeed,
        showFreeSlots,
        showRacks: viewerSettings.showRacks,
        showGrid: viewerSettings.showGrid,
        hiddenRows: [...(viewerSettings.hiddenRows || [])],
    };
}

function applyPersonalViewPreset(preset) {
    const settings = preset?.settings || {};
    const previousHiddenRows = JSON.stringify([...(viewerSettings.hiddenRows || [])].sort());
    viewerSettings = {
        ...defaultViewerSettings,
        ...settings,
        rowSpacings: settings.rowSpacings && typeof settings.rowSpacings === "object" ? { ...settings.rowSpacings } : {},
        hiddenRows: Array.isArray(settings.hiddenRows) ? [...settings.hiddenRows] : [],
    };
    showFreeSlots = Boolean(viewerSettings.showFreeSlots);
    camera.fov = viewerSettings.cameraFov;
    camera.updateProjectionMatrix();
    document.querySelectorAll("[data-scene-preset]").forEach((button) => button.classList.remove("is-active"));
    syncViewSettingsUi();
    applyViewerSettingsLive();
    if (previousHiddenRows !== JSON.stringify([...(viewerSettings.hiddenRows || [])].sort())) scheduleSceneRebuild();
}

function syncPersonalViewPresetAccess() {
    const saveButton = document.getElementById("saveViewPreset");
    const owner = document.getElementById("viewPresetOwner");
    saveButton.disabled = !cameraViewOwner.canManage;
    saveButton.title = cameraViewOwner.canManage
        ? `Salva una configurazione personale per ${cameraViewOwner.label}`
        : "Accedi come operatore o admin per salvare preset personali";
    owner.textContent = cameraViewOwner.canManage
        ? `Solo per ${cameraViewOwner.label}`
        : "Login operatore richiesto";
    if (!cameraViewOwner.canManage) document.getElementById("viewPresetForm").hidden = true;
}

function renderPersonalViewPresets() {
    const list = document.getElementById("personalViewPresetList");
    const empty = document.getElementById("personalViewPresetEmpty");
    list.replaceChildren();
    empty.hidden = savedPersonalViewPresets.length > 0;
    empty.textContent = cameraViewOwner.canManage
        ? "Nessun preset personale salvato."
        : "Accedi come operatore o admin per usare i preset personali.";
    savedPersonalViewPresets.forEach((preset) => {
        const card = document.createElement("article");
        card.className = "personal-view-preset";
        const name = document.createElement("input");
        name.value = preset.name;
        name.maxLength = 42;
        name.readOnly = true;
        name.setAttribute("aria-label", `Nome preset ${preset.name}`);
        const actions = document.createElement("div");
        actions.className = "personal-view-preset__actions";
        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "is-apply";
        apply.textContent = "Applica";
        apply.addEventListener("click", () => applyPersonalViewPreset(preset));
        const rename = document.createElement("button");
        rename.type = "button";
        rename.textContent = "Rinomina";
        rename.addEventListener("click", () => {
            if (name.readOnly) {
                name.readOnly = false;
                rename.textContent = "Salva";
                name.focus();
                name.select();
                return;
            }
            const nextName = name.value.trim();
            const duplicate = savedPersonalViewPresets.some((entry) => entry.id !== preset.id
                && entry.name.toUpperCase() === nextName.toUpperCase());
            if (!nextName || duplicate) {
                name.value = preset.name;
                name.select();
                return;
            }
            preset.name = nextName;
            preset.updatedAt = new Date().toISOString();
            savePersonalViewPresets();
            renderPersonalViewPresets();
        });
        name.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !name.readOnly) rename.click();
            if (event.key === "Escape" && !name.readOnly) renderPersonalViewPresets();
        });
        const replace = document.createElement("button");
        replace.type = "button";
        replace.textContent = "Aggiorna";
        replace.title = "Sostituisci il preset con le impostazioni attuali";
        replace.addEventListener("click", () => armCameraAction(replace, "Conferma", () => {
            preset.settings = captureViewerPresetSettings();
            preset.updatedAt = new Date().toISOString();
            savePersonalViewPresets();
            renderPersonalViewPresets();
        }));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "is-danger";
        remove.textContent = "Elimina";
        remove.addEventListener("click", () => armCameraAction(remove, "Conferma", () => {
            savedPersonalViewPresets = savedPersonalViewPresets.filter((entry) => entry.id !== preset.id);
            savePersonalViewPresets();
            renderPersonalViewPresets();
        }));
        actions.append(apply, rename, replace, remove);
        card.append(name, actions);
        list.appendChild(card);
    });
}

function setupPersonalViewPresets() {
    const form = document.getElementById("viewPresetForm");
    const input = document.getElementById("viewPresetName");
    const message = document.getElementById("viewPresetMessage");
    const closeForm = () => {
        form.hidden = true;
        message.textContent = "";
    };
    document.getElementById("saveViewPreset").addEventListener("click", () => {
        if (!cameraViewOwner.canManage) return;
        form.hidden = false;
        message.textContent = "";
        input.value = `Configurazione ${savedPersonalViewPresets.length + 1}`;
        input.focus();
        input.select();
    });
    document.getElementById("cancelViewPreset").addEventListener("click", closeForm);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!cameraViewOwner.canManage) return;
        const name = input.value.trim();
        if (!name) {
            message.textContent = "Inserisci un nome per il preset.";
            input.focus();
            return;
        }
        if (savedPersonalViewPresets.some((entry) => entry.name.toUpperCase() === name.toUpperCase())) {
            message.textContent = "Esiste già un preset con questo nome.";
            input.focus();
            input.select();
            return;
        }
        if (savedPersonalViewPresets.length >= 20) {
            message.textContent = "Puoi salvare al massimo 20 preset personali.";
            return;
        }
        savedPersonalViewPresets.push({
            id: `view-preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name,
            settings: captureViewerPresetSettings(),
            updatedAt: new Date().toISOString(),
        });
        savePersonalViewPresets();
        closeForm();
        renderPersonalViewPresets();
    });
    syncPersonalViewPresetAccess();
    renderPersonalViewPresets();
}

function syncViewSettingsUi() {
    const values = {
        rackOpacityControl: Math.round(viewerSettings.rackOpacity * 100),
        labelScaleControl: Math.round(viewerSettings.labelScale * 100),
        cameraFovControl: viewerSettings.cameraFov,
        movementSpeedControl: Math.round(viewerSettings.movementSpeed * 100),
        playbackSpeedControl: Math.round(viewerSettings.playbackSpeed * 100),
    };
    Object.entries(values).forEach(([id, value]) => { document.getElementById(id).value = String(value); });
    document.getElementById("rackOpacityValue").textContent = `${Math.round(viewerSettings.rackOpacity * 100)}%`;
    document.getElementById("labelScaleValue").textContent = `${Math.round(viewerSettings.labelScale * 100)}%`;
    document.getElementById("cameraFovValue").textContent = `${viewerSettings.cameraFov}°`;
    document.getElementById("movementSpeedValue").textContent = `${Math.round(viewerSettings.movementSpeed * 100)}%`;
    document.getElementById("playbackSpeedValue").textContent = `${Math.round(viewerSettings.playbackSpeed * 100)}%`;
    document.getElementById("movement3dSpeedValue").textContent = `${Math.round(viewerSettings.playbackSpeed * 100)}%`;
    const freeSlotsButton = document.getElementById("toggleFreeSlots");
    freeSlotsButton.classList.toggle("is-active", showFreeSlots);
    freeSlotsButton.setAttribute("aria-pressed", String(showFreeSlots));
    applyFreeSlotVisibility();
    document.getElementById("showRacksControl").checked = viewerSettings.showRacks;
    document.getElementById("showGridControl").checked = viewerSettings.showGrid;
    renderRowSpacingControls();
    renderSceneRowVisibility();
}

function applyScenePreset(name) {
    const presets = {
        compact: { rowSpacing: 3.8, rackOpacity: .4, labelScale: .94, cameraFov: 48, movementSpeed: .9, playbackSpeed: .8, showFreeSlots: false },
        operational: { rowSpacing: 10, rackOpacity: .1, labelScale: 1, cameraFov: 44, movementSpeed: 2, playbackSpeed: .8, showFreeSlots: false },
        exploded: { rowSpacing: 9, rackOpacity: .1, labelScale: 1.14, cameraFov: 36, movementSpeed: 1.35, playbackSpeed: 1, showFreeSlots: true },
    };
    Object.assign(viewerSettings, presets[name] || presets.operational);
    showFreeSlots = Boolean(viewerSettings.showFreeSlots);
    viewerSettings.rowSpacings = Object.fromEntries(currentSnapshot.rows.slice(0, -1).map((row, index) => [
        rowSpacingKey(row, currentSnapshot.rows[index + 1]),
        name === "operational" && index % 2 !== 0 ? 3.8 : viewerSettings.rowSpacing,
    ]));
    camera.fov = viewerSettings.cameraFov;
    camera.updateProjectionMatrix();
    document.querySelectorAll("[data-scene-preset]").forEach((button) => button.classList.toggle("is-active", button.dataset.scenePreset === name));
    syncViewSettingsUi();
    applyViewerSettingsLive();
}

function setupViewSettings() {
    const panel = document.getElementById("viewerSettings");
    const toggle = document.getElementById("toggleViewSettings");
    const setOpen = (open) => {
        panel.hidden = !open;
        toggle.classList.toggle("is-active", open);
        toggle.setAttribute("aria-expanded", String(open));
        if (open) {
            setCameraViewsPanelOpen(false);
            setMovement3dHistoryOpen(false);
        }
    };
    toggle.addEventListener("click", () => setOpen(panel.hidden));
    document.getElementById("closeViewSettings").addEventListener("click", () => setOpen(false));
    document.querySelectorAll("[data-scene-preset]").forEach((button) => button.addEventListener("click", () => applyScenePreset(button.dataset.scenePreset)));
    document.getElementById("rackOpacityControl").addEventListener("input", (event) => {
        viewerSettings.rackOpacity = Number(event.target.value) / 100;
        document.querySelectorAll("[data-scene-preset]").forEach((button) => button.classList.remove("is-active"));
        document.getElementById("rackOpacityValue").textContent = `${Math.round(viewerSettings.rackOpacity * 100)}%`;
        updateRackAppearanceLive();
        saveViewerSettings();
    });
    document.getElementById("labelScaleControl").addEventListener("input", (event) => {
        viewerSettings.labelScale = Number(event.target.value) / 100;
        document.querySelectorAll("[data-scene-preset]").forEach((button) => button.classList.remove("is-active"));
        document.getElementById("labelScaleValue").textContent = `${Math.round(viewerSettings.labelScale * 100)}%`;
        updateLabelScaleLive();
        saveViewerSettings();
    });
    document.getElementById("cameraFovControl").addEventListener("input", (event) => {
        viewerSettings.cameraFov = Number(event.target.value);
        camera.fov = viewerSettings.cameraFov;
        camera.updateProjectionMatrix();
        saveViewerSettings();
        document.getElementById("cameraFovValue").textContent = `${viewerSettings.cameraFov}Â°`;
    });
    document.getElementById("movementSpeedControl").addEventListener("input", (event) => {
        viewerSettings.movementSpeed = Number(event.target.value) / 100;
        saveViewerSettings();
        document.getElementById("movementSpeedValue").textContent = `${Math.round(viewerSettings.movementSpeed * 100)}%`;
    });
    document.getElementById("playbackSpeedControl").addEventListener("input", (event) => {
        setMovementPlaybackSpeed(Number(event.target.value) / 100);
        document.querySelectorAll("[data-scene-preset]").forEach((button) => button.classList.remove("is-active"));
    });
    document.getElementById("showRacksControl").addEventListener("change", (event) => {
        viewerSettings.showRacks = event.target.checked;
        updateRackAppearanceLive();
        saveViewerSettings();
    });
    document.getElementById("showGridControl").addEventListener("change", (event) => {
        viewerSettings.showGrid = event.target.checked;
        updateGridVisibilityLive();
        saveViewerSettings();
    });
    document.getElementById("showAllRows").addEventListener("click", () => {
        viewerSettings.hiddenRows = [];
        syncViewSettingsUi();
        scheduleSceneRebuild();
    });
    document.getElementById("resetViewSettings").addEventListener("click", () => {
        const hadHiddenRows = Boolean(viewerSettings.hiddenRows?.length);
        viewerSettings = { ...defaultViewerSettings, rowSpacings: {}, hiddenRows: [] };
        showFreeSlots = false;
        camera.fov = viewerSettings.cameraFov;
        camera.updateProjectionMatrix();
        document.querySelectorAll("[data-scene-preset]").forEach((button) => button.classList.toggle("is-active", button.dataset.scenePreset === "operational"));
        syncViewSettingsUi();
        applyViewerSettingsLive();
        if (hadHiddenRows) scheduleSceneRebuild();
    });
    syncViewSettingsUi();
}

canvas.addEventListener("pointermove", updateTooltip);
canvas.addEventListener("pointerleave", () => { document.getElementById("slotTooltip").hidden = true; });
canvas.addEventListener("pointerdown", (event) => { pointerDown = { x: event.clientX, y: event.clientY }; });
canvas.addEventListener("pointerup", (event) => {
    if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) return;
    const mesh = intersectAt(event.clientX, event.clientY);
    if (mesh) selectMesh(mesh, true);
});
document.getElementById("cameraHome").addEventListener("click", () => {
    cameraTransition = null;
    activeCameraViewId = "";
    frameWarehouse();
    renderCameraViews();
});
document.getElementById("cameraTop").addEventListener("click", () => {
    cameraTransition = null;
    activeCameraViewId = "";
    topView();
    renderCameraViews();
});
document.getElementById("toggleLabels").addEventListener("click", (event) => {
    surfaceLabelsVisible = !surfaceLabelsVisible;
    event.currentTarget.textContent = surfaceLabelsVisible ? "Scritte visibili" : "Scritte nascoste";
    event.currentTarget.classList.toggle("is-active", surfaceLabelsVisible);
    event.currentTarget.setAttribute("aria-pressed", String(surfaceLabelsVisible));
    updateSurfaceLabels();
});
document.getElementById("toggleFreeSlots").addEventListener("click", (event) => {
    showFreeSlots = !showFreeSlots;
    viewerSettings.showFreeSlots = showFreeSlots;
    event.currentTarget.classList.toggle("is-active", showFreeSlots);
    event.currentTarget.setAttribute("aria-pressed", String(showFreeSlots));
    applyFreeSlotVisibility();
    saveViewerSettings();
});
document.getElementById("viewerSearch").addEventListener("input", applySearch);
document.getElementById("showOn2dMap").addEventListener("click", () => {
    if (currentSelection) ipcRenderer.send("warehouse-3d-select-slot", currentSelection);
});
window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement) {
        if (event.key === "Escape") {
            event.target.value = "";
            applySearch();
            event.target.blur();
        }
        return;
    }
    const key = event.key.toLowerCase();
    if (/^[1-9]$/.test(key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const view = savedCameraViews[Number(key) - 1];
        if (view) {
            activateCameraView(view);
            event.preventDefault();
            return;
        }
    }
    if (["w", "a", "s", "d"].includes(key)) {
        pressedMovementKeys.add(key);
        event.preventDefault();
    }
    if (event.key === "Shift") pressedMovementKeys.add("shift");
});
window.addEventListener("keyup", (event) => {
    pressedMovementKeys.delete(event.key.toLowerCase());
    if (event.key === "Shift") pressedMovementKeys.delete("shift");
});
window.addEventListener("blur", () => pressedMovementKeys.clear());

function disposeWarehouse3dViewer() {
    if (viewerDisposing) return;
    viewerDisposing = true;
    renderer.setAnimationLoop(null);
    if (sceneRebuildTimer) window.clearTimeout(sceneRebuildTimer);
    sceneRebuildTimer = null;
    remotePersonalPreferenceTimers.forEach((timer) => window.clearTimeout(timer));
    remotePersonalPreferenceTimers.clear();
    pressedMovementKeys.clear();
    cameraTransition = null;
    // In chiusura non ripristinare visibilità, selezioni o materiali della
    // riproduzione: produrrebbe un ultimo frame completo proprio mentre la
    // finestra sta cedendo il focus a quella principale.
    movementPlaybackState = null;
    controls.dispose();
    movementTimer.dispose();
    clearObject(movementGhostLayer);
    clearObject(movementDepositLayer);
    clearObject(world);
    surfaceLabelTextureCache.forEach((texture) => texture.dispose());
    surfaceLabelTextureCache.clear();
    ipcRenderer.removeAllListeners("warehouse-3d-data");
    renderer.dispose();
}

window.addEventListener("pagehide", disposeWarehouse3dViewer, { once: true });
window.addEventListener("beforeunload", disposeWarehouse3dViewer, { once: true });
window.addEventListener("resize", resize);
setupViewSettings();
setupPersonalViewPresets();
setupCameraViews();
setupMovement3dPlayback();
setupMovement3dHistory();

ipcRenderer.on("warehouse-3d-data", (_event, payload) => {
    if (viewerDisposing) return;
    if (!payload || !Array.isArray(payload.rows) || !Array.isArray(payload.inventory)) return;
    applyCameraViewOwner(payload.actor);
    currentSnapshot = payload;
    currentSelection = payload.selectedLocation || currentSelection;
    renderRowSpacingControls();
    renderSceneRowVisibility();
    renderMovement3dHistory();
    buildWarehouse();
    const playback = payload.movementPlayback;
    const playbackKey = payload.movementPlaybackKey || playback?.id || "";
    if (playback?.id && playbackKey !== lastMovementPlaybackId) {
        lastMovementPlaybackId = playbackKey;
        startMovement3dPlayback(playback);
    } else if (movementPlaybackState) {
        showMovement3dStep(movementPlaybackState.index, false);
    }
});
ipcRenderer.send("warehouse-3d-ready");

resize();
renderer.setAnimationLoop((timestamp) => {
    if (viewerDisposing) return;
    movementTimer.update(timestamp);
    updateCameraTransition(timestamp);
    updateKeyboardMovement(movementTimer.getDelta());
    updateMovement3dPlayback(timestamp);
    controls.update();
    renderer.render(scene, camera);
});
