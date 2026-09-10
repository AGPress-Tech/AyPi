// @ts-nocheck
require("./shared/dev-guards");

let warehouseRows = ["A", "B", "C", "D", "E"].map((code) => ({ code, capacity: 96 }));
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

// Dati esclusivamente dimostrativi: verranno sostituiti dalla persistenza reale.
const inventory = new Map(
    [
        ["A2a", "1400", "AGPRESS", "25/00114", ["urgente", "preferito"], false, false],
        ["A2b", "1401", "AGPRESS", "25/00114", ["controllo"], false, true],
        ["A2c", "1500", "AGPRESS", "25/00115", [], false, false],
        ["A1a", "1400", "AGPRESS", "25/00114", ["preferito"], false, false],
        ["A1b", "1401", "AGPRESS", "25/00115", [], false, false],
        ["A1c", "1500", "CLIENTE DEMO", "25/00116", ["prossimo prelievo"], false, false],
        ["A4a", "T0410AOA77", "AGPRESS", "25/00114", [], false, false],
        ["A4b", "T0410AOA77", "AGPRESS", "25/00114", ["verifica"], false, true],
        ["B2a", "T0410AOA77", "AGPRESS", "25/00114", ["preferito"], true, false],
        ["B2b", "T0410AOA77", "CLIENTE DEMO", "25/00114", [], false, false],
        ["B4a", "1400", "AGPRESS", "25/00120", [], false, false],
        ["C2a", "1900", "CLIENTE DEMO", "25/00121", [], false, false],
        ["C2b", "1900", "CLIENTE DEMO", "25/00121", ["riserva"], false, false],
        ["C2c", "1900", "CLIENTE DEMO", "25/00121", [], false, false],
        ["D5a", "PALLET-DEMO", "FANTINI", "26/00001", ["pallet"], false, false, "pallet", "D6a", "PALLET-001"],
        ["D6a", "PALLET-DEMO", "FANTINI", "26/00001", ["pallet"], false, false, "pallet", "D5a", "PALLET-001"],
    ].map(([location, article, customer, orderReference, tags, inMovement, partial, type = "crate", pairedLocation = null, unitId = null], index) => [
        location,
        {
            id: unitId || `DEMO-${String(index + 1).padStart(3, "0")}`,
            location,
            article,
            customer,
            orderReference,
            tags,
            inMovement,
            partial,
            type,
            pairedLocation,
        },
    ]),
);

let selectedRow = "A";
let selectedSlot = null;
let displayMode = "location";
let slotRangeMode = "paged";
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
    const number = columnIndex * 2 + (side === "front" ? 1 : 2);
    return `${row}${number}${level}`;
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
        side: number % 2 === 0 ? "rear" : "front",
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
    button.title = blockingPalletId
        ? `${code} | Non disponibile: colonna occupata dal pallet ${blockingPalletId}`
        : item
        ? `${code} | ${item.type === "pallet" ? "Pallet" : "Cassone"} | ${item.article} | ${item.customer} | ${item.orderReference}${item.pairedLocation ? ` | Occupa anche ${item.pairedLocation}` : ""}${item.tags.length ? ` | Tag: ${item.tags.join(", ")}` : ""}${item.partial ? " | Parziale" : ""}${item.inMovement ? " | In movimento" : ""}`
        : `${code} | Libero`;
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
    button.classList.toggle(
        "has-customer-conflict",
        Boolean(item && !evaluateCustomerForSlot(code, item.customer).allowed),
    );
    button.addEventListener("pointerenter", () => scheduleSlotPreview(code, button));
    button.addEventListener("pointerleave", hideSlotPreview);
    button.addEventListener("focus", () => scheduleSlotPreview(code, button, 0));
    button.addEventListener("blur", hideSlotPreview);
    button.addEventListener("click", () => selectSlot(code));
    button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        selectSlot(code, false);
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
        button.classList.toggle("is-active", active);
        button.classList.toggle("has-match", hasMatch);
        button.classList.toggle("has-search-match", hasSearchMatch);
        button.setAttribute("aria-pressed", String(active));
        const indicators = [];
        if (hasMatch) indicators.push("corrispondenze");
        if (hasSearchMatch) indicators.push("risultati di ricerca");
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
    contextSlotCode = code;
    document.getElementById("contextSlotCode").textContent = code;
    toggleButton.disabled = !item;
    toggleButton.textContent = item?.partial ? "Rimuovi stato parziale" : "Segna come parziale";
    hint.textContent = item
        ? "Il cassone contiene più dello 0% e meno del 100%."
        : "Uno slot libero non può essere indicato come parziale.";
    menu.classList.add("is-open");
    menu.setAttribute("aria-hidden", "false");
    const left = Math.min(x, window.innerWidth - menu.offsetWidth - 8);
    const top = Math.min(y, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
}

function setupContextMenu() {
    document.getElementById("togglePartialButton")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const item = contextSlotCode ? inventory.get(contextSlotCode) : null;
        if (!item) return;
        item.partial = !item.partial;
        refreshInventorySearch();
        renderDetails();
        closeContextMenu();
    });
    document.addEventListener("click", closeContextMenu);
    window.addEventListener("blur", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeContextMenu();
    });
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
            const label = document.createElement("strong");
            label.textContent = `Fila ${configuration.code}`;
            const inputLabel = document.createElement("label");
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
            row.append(label, inputLabel, remove);
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
    if (selectedSlot && !parseSlotCode(selectedSlot.code)) selectedSlot = null;
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
        warehouseStructureDraft.push({ code, capacity: 96 });
        renderWarehouseStructureEditor();
        setWarehouseStructureMessage("Nuova fila da applicare.");
    });
    document.getElementById("applyWarehouseStructure")?.addEventListener("click", applyWarehouseStructure);
}

function updateLoadTypeNote() {
    const type = document.getElementById("loadType")?.value;
    const note = document.getElementById("loadTypeNote");
    if (!note) return;
    const pallet = type === "pallet";
    note.classList.toggle("is-pallet", pallet);
    note.textContent = pallet
        ? "Un pallet occupa obbligatoriamente la coppia anteriore/posteriore dello stesso modulo, esclusivamente a terra (livello a). La colonna deve essere completamente libera e non può avere merce sopra o sotto."
        : "Un cassone occupa una singola ubicazione e può essere impilato rispettando i livelli.";
}

function openLoadDialog() {
    const dialog = document.getElementById("loadDialog");
    dialog?.classList.add("is-open");
    dialog?.setAttribute("aria-hidden", "false");
    document.getElementById("loadFormMessage").textContent = "";
    document.getElementById("loadArticle")?.focus();
}

function closeLoadDialog() {
    const dialog = document.getElementById("loadDialog");
    dialog?.classList.remove("is-open");
    dialog?.setAttribute("aria-hidden", "true");
}

function setupLoadDialog() {
    document.getElementById("openLoadButton")?.addEventListener("click", openLoadDialog);
    document.getElementById("closeLoadButton")?.addEventListener("click", closeLoadDialog);
    document.getElementById("loadDialog")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) closeLoadDialog();
    });
    document.getElementById("loadType")?.addEventListener("change", updateLoadTypeNote);
    document.getElementById("loadForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const article = document.getElementById("loadArticle").value.trim();
        const customer = document.getElementById("loadCustomer").value.trim();
        const order = document.getElementById("loadOrderReference").value.trim();
        const quantity = Number(document.getElementById("loadQuantity").value);
        const partial = document.getElementById("loadPartial").value === "yes";
        const type = document.getElementById("loadType").value;
        document.getElementById("loadFormMessage").textContent =
            `Richiesta pronta: ${quantity} ${type === "pallet" ? "pallet" : quantity === 1 ? "cassone" : "cassoni"} · ${article} · ${customer} · ${order}${partial ? " · parziale" : ""}. L'assegnazione automatica sarà collegata nella prossima fase.`;
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeLoadDialog();
    });
    updateLoadTypeNote();
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

function openRestrictionDialog() {
    closeToolsDrawer();
    selectedRestrictionRow = selectedSlot?.row || selectedRow;
    renderRestrictionDialog(selectedSlot?.code);
    const dialog = document.getElementById("restrictionDialog");
    dialog.classList.add("is-open");
    dialog.setAttribute("aria-hidden", "false");
    document.getElementById("rowWhitelist")?.focus();
}

function closeRestrictionDialog() {
    const dialog = document.getElementById("restrictionDialog");
    dialog?.classList.remove("is-open");
    dialog?.setAttribute("aria-hidden", "true");
}

function setupRestrictionDialog() {
    document.getElementById("openRestrictionsButton")?.addEventListener("click", openRestrictionDialog);
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
        storeRestriction(slotRestrictions, location, rule);
        refreshRestrictionViews();
        renderRestrictionDialog(location);
        setRestrictionMessage("slotRestrictionMessage", "Regola dello slot salvata.", true);
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
        slotRestrictions.delete(location);
        refreshRestrictionViews();
        renderRestrictionDialog(location);
        setRestrictionMessage("slotRestrictionMessage", "Regola dello slot rimossa.", true);
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

renderTabs();
renderMap();
setupDisplayMode();
setupSlotPager();
setupToolsDrawer();
setupWarehouseStructure();
setupLoadDialog();
setupSlotPreview();
setupContextMenu();
setupInventorySearch();
setupAnalysisView();
setupRestrictionDialog();
updateSummary();
