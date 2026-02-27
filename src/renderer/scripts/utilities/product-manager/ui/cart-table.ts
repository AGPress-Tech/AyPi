// @ts-nocheck
require("../../../shared/dev-guards");
function renderCartTable({
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
}) {
    const list = document.getElementById("pm-requests-list");
    if (!list) return;
    if (isInterventionMode()) {
        renderInterventionTable({
            document,
            list,
            isAdmin,
            cartState,
            toTags,
            readRequestsFile,
            saveRequestsFile,
            REQUEST_MODES,
            formatDateDisplay,
            getInterventionType,
            getInterventionDescription,
            confirmCartRow,
            deleteCartRow,
            openInterventionEditModal,
        });
        return;
    }
    const requests = readRequestsFile();
    const rows = [];
    let needsSave = false;
    let droppedDeleted = 0;
    let droppedConfirmed = 0;
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    requests.forEach((request, requestIndex) => {
        const requester = request.employee || "";
        const nextLines = [];
        (request.lines || []).forEach((line) => {
            const deletedAt = line.deletedAt ? new Date(line.deletedAt).getTime() : 0;
            if (deletedAt && now - deletedAt >= weekMs) {
                needsSave = true;
                droppedDeleted += 1;
                return;
            }
            nextLines.push(line);
            const nextIndex = nextLines.length - 1;
            const confirmedAt = line.confirmedAt ? new Date(line.confirmedAt).getTime() : 0;
            if (confirmedAt && now - confirmedAt >= monthMs) {
                droppedConfirmed += 1;
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
                supplier: line.supplier || "",
                url: line.url || "",
                note: line.note || "",
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

    const urgencyFilter = Array.isArray(cartState.urgency)
        ? cartState.urgency.filter((value) => value)
        : cartState.urgency
        ? [cartState.urgency]
        : [];
    const tagFilter = Array.isArray(cartState.tag) ? cartState.tag.filter((value) => value) : cartState.tag ? [cartState.tag] : [];
    let failUrgency = 0;
    let failTag = 0;
    let failSearch = 0;
    const filtered = rows.filter((row) => {
        if (urgencyFilter.length) {
            if (!urgencyFilter.includes(row.urgency || "")) {
                failUrgency += 1;
                return false;
            }
        }
        if (tagFilter.length) {
            const tags = row.tags || [];
            if (!tagFilter.some((tag) => tags.includes(tag))) {
                failTag += 1;
                return false;
            }
        }
        if (cartState.search) {
            const haystack = [
                row.product,
                row.tags.join(" "),
                row.requester,
                row.url,
                row.unit,
                row.urgency,
                row.supplier,
                row.priceCad,
                row.note,
            ]
                .join(" ")
                .toLowerCase();
            if (!haystack.includes(cartState.search.toLowerCase())) {
                failSearch += 1;
                return false;
            }
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
    [
        "",
        "Prodotto",
        "QuantitÃ ",
        "UM",
        "Priorità",
        "Fornitore",
        "Note",
        "URL",
        "Prezzo C.A.D",
        "Richiesto da",
        "Data",
        "Azioni",
    ].forEach((title) => {
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

        const supplierCell = document.createElement("div");
        supplierCell.className = "pm-table__cell";
        supplierCell.textContent = row.supplier || "-";

        const noteCell = document.createElement("div");
        noteCell.className = "pm-table__cell";
        noteCell.textContent = row.note || "-";

        const urlCell = document.createElement("div");
        urlCell.className = "pm-table__cell";
        urlCell.appendChild(buildUrlCell(row.url, row.product));

        const priceCell = document.createElement("div");
        priceCell.className = "pm-table__cell";
        priceCell.textContent = row.priceCad ? formatPriceCadDisplay(row.priceCad) : "-";

        const requesterCell = document.createElement("div");
        requesterCell.className = "pm-table__cell";
        requesterCell.textContent = row.requester || "-";

        const dateCell = document.createElement("div");
        dateCell.className = "pm-table__cell";
        dateCell.textContent = formatDateDisplay(row.createdAt);

        const actionsCell = document.createElement("div");
        actionsCell.className = "pm-table__cell pm-table__actions pm-table__actions--compact";
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "pm-icon-btn";
        addBtn.title = "Aggiungi";
        addBtn.setAttribute("aria-label", "Aggiungi");
        const addIcon = document.createElement("span");
        addIcon.className = "material-icons";
        addIcon.textContent = "add";
        addBtn.appendChild(addIcon);
        addBtn.addEventListener("click", () => openAddModal(row));
        actionsCell.appendChild(addBtn);
        if (row.deletedAt) {
            addBtn.disabled = true;
        }
        if (admin) {
            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "pm-icon-btn";
            editBtn.title = "Modifica";
            editBtn.setAttribute("aria-label", "Modifica");
            const editIcon = document.createElement("span");
            editIcon.className = "material-icons";
            editIcon.textContent = "edit";
            editBtn.appendChild(editIcon);
            editBtn.addEventListener("click", () => openEditModal(row));
            if (row.deletedAt) editBtn.disabled = true;
            const addCatalogBtn = document.createElement("button");
            addCatalogBtn.type = "button";
            addCatalogBtn.className = "pm-icon-btn";
            addCatalogBtn.title = "Inserisci a catalogo";
            addCatalogBtn.setAttribute("aria-label", "Inserisci a catalogo");
            const addCatalogIcon = document.createElement("span");
            addCatalogIcon.className = "material-icons";
            addCatalogIcon.textContent = "inventory_2";
            addCatalogBtn.appendChild(addCatalogIcon);
            addCatalogBtn.addEventListener("click", async () => {
                const ok = await openConfirmModal("Vuoi aggiungere questo prodotto al catalogo?");
                if (!ok) return;
                const item = {
                    id: `CAT-${Date.now()}`,
                    name: row.product || "",
                    description: "",
                    category: row.category || row.tags.join(", "),
                    unit: row.unit || "",
                    url: row.url || "",
                    supplier: row.supplier || "",
                    imageFile: "",
                    createdAt: new Date().toISOString(),
                };
                catalogItems.push(item);
                if (saveCatalog(catalogItems)) {
                    renderCatalog();
                }
            });
            if (row.deletedAt) addCatalogBtn.disabled = true;
            actionsCell.append(editBtn, addCatalogBtn);
        } else if (!isLoggedIn()) {
            addBtn.disabled = true;
        }

        tr.append(
            statusCell,
            productCell,
            quantityCell,
            unitCell,
            urgencyCell,
            supplierCell,
            noteCell,
            urlCell,
            priceCell,
            requesterCell,
            dateCell,
            actionsCell
        );
        table.appendChild(tr);
    });

    list.innerHTML = "";
    list.appendChild(table);
}

function renderInterventionTable({
    document,
    list,
    isAdmin,
    cartState,
    toTags,
    readRequestsFile,
    saveRequestsFile,
    REQUEST_MODES,
    formatDateDisplay,
    getInterventionType,
    getInterventionDescription,
    confirmCartRow,
    deleteCartRow,
    openInterventionEditModal,
}) {
    const requests = readRequestsFile(REQUEST_MODES.INTERVENTION);
    const rows = [];
    let needsSave = false;
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    requests.forEach((request, requestIndex) => {
        const requester = request.employee || "";
        const nextLines = [];
        (request.lines || []).forEach((line) => {
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
            const typeValue = getInterventionType(line);
            const typeTags = toTags(typeValue);
            rows.push({
                key: `${request.id || requestIndex}-${nextIndex}`,
                requestIndex,
                lineIndex: nextIndex,
                interventionType: typeTags.length ? typeTags.join(", ") : typeValue,
                tags: typeTags,
                description: getInterventionDescription(line),
                urgency: line.urgency || "",
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
        saveRequestsFile(cleaned, REQUEST_MODES.INTERVENTION);
    }

    const urgencyFilter = Array.isArray(cartState.urgency)
        ? cartState.urgency.filter((value) => value)
        : cartState.urgency
        ? [cartState.urgency]
        : [];
    const tagFilter = Array.isArray(cartState.tag) ? cartState.tag.filter((value) => value) : cartState.tag ? [cartState.tag] : [];
    const filtered = rows.filter((row) => {
        if (urgencyFilter.length) {
            if (!urgencyFilter.includes(row.urgency || "")) return false;
        }
        if (tagFilter.length) {
            const tags = row.tags || [];
            if (!tagFilter.some((tag) => tags.includes(tag))) return false;
        }
        if (cartState.search) {
            const haystack = [row.interventionType, row.description, row.requester, row.urgency]
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
        if (sortKey === "type_asc") return a.interventionType.localeCompare(b.interventionType);
        if (sortKey === "type_desc") return b.interventionType.localeCompare(a.interventionType);
        if (sortKey === "urgency_desc") {
            const order = { Alta: 3, Media: 2, Bassa: 1, "": 0 };
            return (order[b.urgency] || 0) - (order[a.urgency] || 0);
        }
        if (sortKey === "requester_asc") return a.requester.localeCompare(b.requester);
        return 0;
    });

    if (!filtered.length) {
        list.innerHTML = "<div class=\"pm-message\">Nessun intervento in lista.</div>";
        return;
    }

    const table = document.createElement("div");
    table.className = "pm-table pm-table--interventions";

    const header = document.createElement("div");
    header.className = "pm-table__row pm-table__row--header";
    ["", "Tipologia", "Descrizione", "Priorità", "Richiesto da", "Data", "Azioni"].forEach((title) => {
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

        const typeCell = document.createElement("div");
        typeCell.className = "pm-table__cell";
        typeCell.textContent = row.interventionType || "-";

        const descCell = document.createElement("div");
        descCell.className = "pm-table__cell";
        descCell.textContent = row.description || "-";

        const urgencyCell = document.createElement("div");
        urgencyCell.className = "pm-table__cell";
        urgencyCell.textContent = row.urgency || "-";

        const requesterCell = document.createElement("div");
        requesterCell.className = "pm-table__cell";
        requesterCell.textContent = row.requester || "-";

        const dateCell = document.createElement("div");
        dateCell.className = "pm-table__cell";
        dateCell.textContent = formatDateDisplay(row.createdAt);

        const actionsCell = document.createElement("div");
        actionsCell.className = "pm-table__cell pm-table__actions pm-table__actions--compact";
        if (isAdmin()) {
            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "pm-icon-btn";
            editBtn.title = "Modifica";
            editBtn.setAttribute("aria-label", "Modifica");
            const editIcon = document.createElement("span");
            editIcon.className = "material-icons";
            editIcon.textContent = "edit";
            editBtn.appendChild(editIcon);
            editBtn.addEventListener("click", () => openInterventionEditModal(row));
            if (row.deletedAt) editBtn.disabled = true;
            actionsCell.appendChild(editBtn);
        }

        tr.append(statusCell, typeCell, descCell, urgencyCell, requesterCell, dateCell, actionsCell);
        table.appendChild(tr);
    });

    list.innerHTML = "";
    list.appendChild(table);
    if (window.pmDebug) {
        const debugLine = document.createElement("div");
        debugLine.className = "pm-message";
        debugLine.textContent = `DEBUG source=${window.pmDebug.source} count=${window.pmDebug.count}`;
        list.appendChild(debugLine);
    }
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { renderCartTable };


