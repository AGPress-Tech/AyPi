// @ts-nocheck
require("./shared/dev-guards");

const ROWS = ["A", "B", "C", "D", "E"];
const LEVELS = [
    { code: "c", label: "alto", order: 3 },
    { code: "b", label: "intermedio", order: 2 },
    { code: "a", label: "basso", order: 1 },
];
const POSITIONS_PER_SIDE = 16;
const TOTAL_SLOTS = ROWS.length * LEVELS.length * POSITIONS_PER_SIDE * 2;
const SLOT_PATTERN = /^([A-E])(3[0-2]|[12]?\d)([a-c])$/i;

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
    ].map(([location, article, customer, orderReference, tags, inMovement, partial], index) => [
        location,
        {
            id: `DEMO-${String(index + 1).padStart(3, "0")}`,
            location,
            article,
            customer,
            orderReference,
            tags,
            inMovement,
            partial,
        },
    ]),
);

let selectedRow = "A";
let selectedSlot = null;
let displayMode = "location";
let contextSlotCode = null;
let currentSearchResults = [];
const selectedReportLocations = new Set();

function slotCode(row, columnIndex, side, level) {
    const number = columnIndex * 2 + (side === "front" ? 1 : 2);
    return `${row}${number}${level}`;
}

function parseSlotCode(value) {
    const normalized = String(value || "").trim().toUpperCase();
    const match = SLOT_PATTERN.exec(normalized);
    if (!match) return null;
    const number = Number(match[2]);
    if (number < 1 || number > 32) return null;
    return {
        code: `${match[1].toUpperCase()}${number}${match[3].toLowerCase()}`,
        row: match[1].toUpperCase(),
        number,
        level: match[3].toLowerCase(),
        side: number % 2 === 0 ? "rear" : "front",
        physicalColumn: Math.ceil(number / 2),
    };
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

function createSlotButton(row, columnIndex, side, level) {
    const code = slotCode(row, columnIndex, side, level);
    const item = inventory.get(code);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `slot slot--${side}`;
    button.dataset.slot = code;
    button.textContent = cellLabel(code, item);
    button.title = item
        ? `${code} | ${item.article} | ${item.customer} | ${item.orderReference}${item.tags.length ? ` | Tag: ${item.tags.join(", ")}` : ""}${item.partial ? " | Parziale" : ""}${item.inMovement ? " | In movimento" : ""}`
        : `${code} | Libero`;
    button.setAttribute("aria-label", item ? `${code}, articolo ${item.article}` : `${code}, libero`);
    button.classList.toggle("is-occupied", Boolean(item));
    button.classList.toggle("is-partial", Boolean(item?.partial));
    button.classList.toggle("is-match", code !== selectedSlot?.code && itemMatchesSelection(item));
    button.classList.toggle("is-search-match", currentSearchResults.some((result) => result.location === code));
    button.classList.toggle("is-selected", code === selectedSlot?.code);
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
    for (let index = 0; index < POSITIONS_PER_SIDE; index += 1) {
        container.appendChild(createSlotButton(row, index, side, level));
    }
    return container;
}

function renderMap() {
    const levelsContainer = document.getElementById("warehouseLevels");
    const rowTitle = document.getElementById("rowTitle");
    if (!levelsContainer || !rowTitle) return;
    rowTitle.textContent = `Fila ${selectedRow}`;
    levelsContainer.dataset.displayMode = displayMode;
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
    updateTabs();
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
    ROWS.forEach((row) => {
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

function renderDetails() {
    if (!selectedSlot) return;
    const item = inventory.get(selectedSlot.code);
    document.getElementById("emptyDetail")?.setAttribute("hidden", "");
    const detail = document.getElementById("slotDetail");
    if (detail) detail.hidden = false;
    document.getElementById("detailCode").textContent = selectedSlot.code;
    document.getElementById("detailRow").textContent = selectedSlot.row;
    document.getElementById("detailColumn").textContent = String(selectedSlot.physicalColumn);
    document.getElementById("detailSide").textContent = selectedSlot.side === "rear" ? "Posteriore" : "Anteriore";
    const level = LEVELS.find((entry) => entry.code === selectedSlot.level);
    document.getElementById("detailLevel").textContent = `${selectedSlot.level} · ${level?.label || ""}`;

    const status = document.getElementById("detailStatus");
    status.className = item?.partial ? "partial-badge" : item ? "occupied-badge" : "free-badge";
    status.textContent = item?.partial ? "Parziale" : item ? "Occupato" : "Libero";
    setDetailRowVisibility("detailArticleRow", Boolean(item));
    setDetailRowVisibility("detailCustomerRow", Boolean(item));
    setDetailRowVisibility("detailOrderRow", Boolean(item));
    setDetailRowVisibility("detailTagsRow", Boolean(item?.tags?.length));
    setDetailRowVisibility("detailMovementRow", Boolean(item?.inMovement));
    if (item) {
        document.getElementById("detailArticle").textContent = item.article;
        document.getElementById("detailCustomer").textContent = item.customer;
        document.getElementById("detailOrder").textContent = item.orderReference;
        document.getElementById("detailTags").textContent = item.tags.length ? item.tags.join(", ") : "—";
        document.getElementById("detailMovement").textContent = item.inMovement ? "In movimento" : "—";
    }
    document.getElementById("detailNote").textContent = item
        ? "Cassone dimostrativo. Tasto destro sulla cella per modificare lo stato parziale."
        : "Slot libero. I flussi di carico saranno aggiunti nelle fasi successive.";
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

function setupSearch() {
    const form = document.getElementById("positionSearchForm");
    const input = document.getElementById("positionSearch");
    const message = document.getElementById("searchMessage");
    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        const parsed = parseSlotCode(input?.value);
        if (!parsed) {
            if (message) message.textContent = "Posizione non valida. Esempio: A2c";
            return;
        }
        if (message) message.textContent = "";
        if (input) input.value = parsed.code;
        selectSlot(parsed.code);
    });
}

function setupDisplayMode() {
    document.getElementById("displayMode")?.addEventListener("change", (event) => {
        displayMode = event.target.value;
        renderMap();
    });
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
    currentSearchResults = findInventoryMatches(query);
    const visibleLocations = new Set(currentSearchResults.map((item) => item.location));
    Array.from(selectedReportLocations).forEach((location) => {
        if (!visibleLocations.has(location)) selectedReportLocations.delete(location);
    });
    renderSearchReport(query);
    renderMap();
}

function setupInventorySearch() {
    const form = document.getElementById("inventorySearchForm");
    const input = document.getElementById("inventorySearchInput");
    form?.addEventListener("submit", (event) => event.preventDefault());
    input?.addEventListener("input", refreshInventorySearch);
    document.querySelectorAll('input[name="searchField"]').forEach((checkbox) => {
        checkbox.addEventListener("change", refreshInventorySearch);
    });
    document.getElementById("clearInventorySearch")?.addEventListener("click", () => {
        if (input) input.value = "";
        selectedReportLocations.clear();
        refreshInventorySearch();
        input?.focus();
    });
}

function updateSummary() {
    document.getElementById("totalSlots").textContent = String(TOTAL_SLOTS);
    document.getElementById("occupiedSlots").textContent = String(inventory.size);
    document.getElementById("freeSlots").textContent = String(TOTAL_SLOTS - inventory.size);
}

renderTabs();
renderMap();
setupSearch();
setupDisplayMode();
setupContextMenu();
setupInventorySearch();
updateSummary();
