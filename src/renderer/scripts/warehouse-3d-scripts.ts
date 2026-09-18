// @ts-nocheck
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
const { ipcRenderer } = require("electron");

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
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const movementTimer = new THREE.Timer();
movementTimer.connect(document);
const pressedMovementKeys = new Set();
let pickables = [];
let currentSnapshot = { rows: [], inventory: [], displayFields: [] };
let currentSelection = "";
let hoveredObject = null;
let showFreeSlots = true;
let surfaceLabelsVisible = true;
let cameraHasBeenFramed = false;
let pointerDown = null;
let layoutRows = [];
let layoutRowZ = [];

const defaultViewerSettings = {
    rowSpacing: 6.2,
    rowSpacings: {},
    rackOpacity: .22,
    labelScale: 1.05,
    cameraFov: 42,
    movementSpeed: 1,
    showRacks: true,
    showGrid: true,
    hiddenRows: [],
};
function loadViewerSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem("aypi-warehouse-3d-view-settings") || "{}");
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
camera.fov = viewerSettings.cameraFov;
camera.updateProjectionMatrix();
let savedCameraViews = [];
let activeCameraViewId = "";
let cameraTransition = null;
let cameraViewOwner = { key: "guest", label: "Nessun operatore", canManage: false };
const CAMERA_VIEWS_STORAGE_KEY = "aypi-warehouse-3d-camera-views-by-operator";
const LEGACY_CAMERA_VIEWS_STORAGE_KEY = "aypi-warehouse-3d-camera-views";

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
}

function applyCameraViewOwner(actor) {
    const nextOwner = cameraOwnerIdentity(actor);
    if (nextOwner.key === cameraViewOwner.key) return;
    cameraViewOwner = nextOwner;
    savedCameraViews = loadCameraViews(cameraViewOwner.key);
    activeCameraViewId = "";
    cameraTransition = null;
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
}

function saveViewerSettings() {
    localStorage.setItem("aypi-warehouse-3d-view-settings", JSON.stringify(viewerSettings));
}

const palette = {
    free: 0xcfeafa,
    occupied: 0xbfe6cf,
    pallet: 0xf3b9b9,
    blocked: 0xaeb7be,
    selected: 0x123f70,
    related: 0x4cb8ef,
    match: 0x087fbd,
    searchFill: 0xcceeff,
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

function surfaceFaceForSide(row, side) {
    return sidePhysicalDirection(row, side) > 0 ? "rear" : "front";
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
            object.material?.map?.dispose?.();
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

function createSurfaceLabel(lines, face = "rear", pallet = false) {
    const surface = document.createElement("canvas");
    surface.width = 768;
    surface.height = 512;
    const context = surface.getContext("2d");
    context.clearRect(0, 0, surface.width, surface.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    const visible = lines.slice(0, 3);
    visible.forEach((line, index) => {
        context.font = `${index === 0 ? "900 108px" : "800 86px"} Segoe UI, Arial`;
        context.lineWidth = 4;
        context.strokeStyle = "rgba(246,252,255,.98)";
        context.strokeText(String(line).slice(0, 20), 384, 116 + index * 137, 716);
        context.fillStyle = index === 0 ? "#123f70" : "#203947";
        context.fillText(String(line).slice(0, 20), 384, 116 + index * 137, 716);
    });
    const texture = new THREE.CanvasTexture(surface);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
    });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(
        (pallet ? .88 : .86) * viewerSettings.labelScale,
        (pallet ? .48 : .59) * viewerSettings.labelScale,
    ), material);
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
        world.add(mesh);
    };
    for (let column = 0; column <= columns; column += 1) {
        const x = (column - columns / 2) * 1.28;
        addFrame(new THREE.BoxGeometry(.07, 3.55, 1.92), x, 1.76, baseZ);
    }
    [0, 1.03, 2.06, 3.09].forEach((height) => addFrame(new THREE.BoxGeometry(width, .07, 1.92), 0, height, baseZ));
    const oddSide = sideForPosition(row, 1);
    const oddDirection = sidePhysicalDirection(row, oddSide);
    const physicalIndex = currentSnapshot.rows.findIndex((entry) => entry.code === row.code);
    const oddFacingRow = currentSnapshot.rows[physicalIndex + oddDirection]?.code;
    const orientationLabel = oddFacingRow ? `dispari verso fila ${oddFacingRow}` : "dispari verso lato esterno";
    const label = createTextSprite([`FILA ${row.code}`, orientationLabel], {
        background: "rgba(23,62,95,.96)", border: "rgba(255,255,255,.55)", title: "#ffffff", text: "#cfeafa",
    });
    label.position.set(-width / 2 - 1.3, 3.25, baseZ);
    label.scale.set(2.25, .9, 1);
    world.add(label);
}

function rowSpacingKey(firstRow, secondRow) {
    return `${firstRow?.code || ""}|${secondRow?.code || ""}`;
}

function rowPairSpacing(firstRow, secondRow) {
    const value = Number(viewerSettings.rowSpacings?.[rowSpacingKey(firstRow, secondRow)]);
    return Number.isFinite(value) ? Math.min(14, Math.max(3.2, value)) : viewerSettings.rowSpacing;
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

function slotPosition(rowIndex, column, side, level) {
    const baseZ = layoutRowZ[rowIndex] || 0;
    const columns = physicalColumns(layoutRows[rowIndex]);
    return new THREE.Vector3(
        (column - (columns + 1) / 2) * 1.28,
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
        const parsed = parseLocation(location);
        const faces = pallet ? ["front", "rear"] : [surfaceFaceForSide(parsed?.row, parsed?.side || "front")];
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
    clearObject(world);
    pickables = [];
    hoveredObject = null;
    const hiddenRows = new Set(viewerSettings.hiddenRows || []);
    layoutRows = currentSnapshot.rows.filter((row) => !hiddenRows.has(row.code));
    if (!layoutRows.length && currentSnapshot.rows.length) {
        layoutRows = [currentSnapshot.rows[0]];
        viewerSettings.hiddenRows = currentSnapshot.rows.slice(1).map((row) => row.code);
    }
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
        if (viewerSettings.showRacks) addShelfStructure(row, rowIndex, columns, baseZ);
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
    const maxColumns = Math.max(1, ...layoutRows.map(physicalColumns));
    const width = maxColumns * 1.28 + 10;
    const depth = Math.max(10, layoutDepth(7));
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth),
        new THREE.MeshStandardMaterial({ color: 0xdbe3e8, roughness: .94, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -.08;
    floor.receiveShadow = true;
    world.add(floor);
    const grid = new THREE.GridHelper(Math.max(width, depth), Math.ceil(Math.max(width, depth) / 1.25), 0x86a0b0, 0xb7c5ce);
    grid.position.y = -.065;
    grid.material.transparent = true;
    grid.material.opacity = .34;
    grid.visible = viewerSettings.showGrid;
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
    const maxColumns = Math.max(1, ...layoutRows.map(physicalColumns));
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
        mesh.material.color.setHex(mesh.userData.matchesSearch ? palette.searchFill : mesh.userData.baseColor);
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
            scheduleSceneRebuild();
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

function syncViewSettingsUi() {
    const values = {
        rackOpacityControl: Math.round(viewerSettings.rackOpacity * 100),
        labelScaleControl: Math.round(viewerSettings.labelScale * 100),
        cameraFovControl: viewerSettings.cameraFov,
        movementSpeedControl: Math.round(viewerSettings.movementSpeed * 100),
    };
    Object.entries(values).forEach(([id, value]) => { document.getElementById(id).value = String(value); });
    document.getElementById("rackOpacityValue").textContent = `${Math.round(viewerSettings.rackOpacity * 100)}%`;
    document.getElementById("labelScaleValue").textContent = `${Math.round(viewerSettings.labelScale * 100)}%`;
    document.getElementById("cameraFovValue").textContent = `${viewerSettings.cameraFov}°`;
    document.getElementById("movementSpeedValue").textContent = `${Math.round(viewerSettings.movementSpeed * 100)}%`;
    document.getElementById("showRacksControl").checked = viewerSettings.showRacks;
    document.getElementById("showGridControl").checked = viewerSettings.showGrid;
    renderRowSpacingControls();
    renderSceneRowVisibility();
}

function applyScenePreset(name) {
    const presets = {
        compact: { rowSpacing: 3.8, rackOpacity: .4, labelScale: .94, cameraFov: 48, movementSpeed: .9 },
        operational: { rowSpacing: 6.2, rackOpacity: .22, labelScale: 1.05, cameraFov: 42, movementSpeed: 1 },
        exploded: { rowSpacing: 9, rackOpacity: .1, labelScale: 1.14, cameraFov: 36, movementSpeed: 1.35 },
    };
    Object.assign(viewerSettings, presets[name] || presets.operational);
    viewerSettings.rowSpacings = Object.fromEntries(currentSnapshot.rows.slice(0, -1).map((row, index) => [
        rowSpacingKey(row, currentSnapshot.rows[index + 1]),
        viewerSettings.rowSpacing,
    ]));
    camera.fov = viewerSettings.cameraFov;
    camera.updateProjectionMatrix();
    document.querySelectorAll("[data-scene-preset]").forEach((button) => button.classList.toggle("is-active", button.dataset.scenePreset === name));
    syncViewSettingsUi();
    scheduleSceneRebuild();
}

function setupViewSettings() {
    const panel = document.getElementById("viewerSettings");
    const toggle = document.getElementById("toggleViewSettings");
    const setOpen = (open) => {
        panel.hidden = !open;
        toggle.classList.toggle("is-active", open);
        toggle.setAttribute("aria-expanded", String(open));
        if (open) setCameraViewsPanelOpen(false);
    };
    toggle.addEventListener("click", () => setOpen(panel.hidden));
    document.getElementById("closeViewSettings").addEventListener("click", () => setOpen(false));
    document.querySelectorAll("[data-scene-preset]").forEach((button) => button.addEventListener("click", () => applyScenePreset(button.dataset.scenePreset)));
    const rebuildControls = {
        rackOpacityControl: (value) => { viewerSettings.rackOpacity = Number(value) / 100; },
        labelScaleControl: (value) => { viewerSettings.labelScale = Number(value) / 100; },
    };
    Object.entries(rebuildControls).forEach(([id, setter]) => document.getElementById(id).addEventListener("input", (event) => {
        setter(event.target.value);
        document.querySelectorAll("[data-scene-preset]").forEach((button) => button.classList.remove("is-active"));
        syncViewSettingsUi();
        scheduleSceneRebuild();
    }));
    document.getElementById("cameraFovControl").addEventListener("input", (event) => {
        viewerSettings.cameraFov = Number(event.target.value);
        camera.fov = viewerSettings.cameraFov;
        camera.updateProjectionMatrix();
        saveViewerSettings();
        syncViewSettingsUi();
    });
    document.getElementById("movementSpeedControl").addEventListener("input", (event) => {
        viewerSettings.movementSpeed = Number(event.target.value) / 100;
        saveViewerSettings();
        syncViewSettingsUi();
    });
    document.getElementById("showRacksControl").addEventListener("change", (event) => {
        viewerSettings.showRacks = event.target.checked;
        scheduleSceneRebuild();
    });
    document.getElementById("showGridControl").addEventListener("change", (event) => {
        viewerSettings.showGrid = event.target.checked;
        scheduleSceneRebuild();
    });
    document.getElementById("showAllRows").addEventListener("click", () => {
        viewerSettings.hiddenRows = [];
        syncViewSettingsUi();
        scheduleSceneRebuild();
    });
    document.getElementById("resetViewSettings").addEventListener("click", () => {
        viewerSettings = { ...defaultViewerSettings, rowSpacings: {}, hiddenRows: [] };
        camera.fov = viewerSettings.cameraFov;
        camera.updateProjectionMatrix();
        document.querySelectorAll("[data-scene-preset]").forEach((button) => button.classList.toggle("is-active", button.dataset.scenePreset === "operational"));
        syncViewSettingsUi();
        scheduleSceneRebuild();
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
    event.currentTarget.classList.toggle("is-active", showFreeSlots);
    event.currentTarget.setAttribute("aria-pressed", String(showFreeSlots));
    applyFreeSlotVisibility();
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
window.addEventListener("beforeunload", () => movementTimer.dispose(), { once: true });
window.addEventListener("resize", resize);
setupViewSettings();
setupCameraViews();

ipcRenderer.on("warehouse-3d-data", (_event, payload) => {
    if (!payload || !Array.isArray(payload.rows) || !Array.isArray(payload.inventory)) return;
    applyCameraViewOwner(payload.actor);
    currentSnapshot = payload;
    currentSelection = payload.selectedLocation || currentSelection;
    renderRowSpacingControls();
    renderSceneRowVisibility();
    buildWarehouse();
});
ipcRenderer.send("warehouse-3d-ready");

resize();
renderer.setAnimationLoop((timestamp) => {
    movementTimer.update(timestamp);
    updateCameraTransition(timestamp);
    updateKeyboardMovement(movementTimer.getDelta());
    controls.update();
    renderer.render(scene, camera);
});
