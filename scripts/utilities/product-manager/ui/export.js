function initExportModal(ctx) {
    const {
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
    } = ctx;

    const setExportMessage = (text, isError = false) => {
        const el = document.getElementById("pm-export-message");
        if (!el) return;
        if (!text) {
            el.classList.add("is-hidden");
            el.textContent = "";
            el.classList.remove("pm-message--error", "pm-message--success");
            return;
        }
        el.textContent = text;
        el.classList.remove("is-hidden", "pm-message--error", "pm-message--success");
        if (isError) {
            el.classList.add("pm-message--error");
        } else {
            el.classList.add("pm-message--success");
        }
    };

    const parseDateInput = (value) => {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return date;
    };

    const buildExportRows = () => {
        const mode = getActiveMode();
        if (isInterventionMode(mode)) {
            const requests = readRequestsFile(REQUEST_MODES.INTERVENTION);
            const rows = [];
            requests.forEach((request) => {
                const requester = [request.employee, request.department].filter(Boolean).join(" - ");
                (request.lines || []).forEach((line) => {
                    const status = line.deletedAt
                        ? "deleted"
                        : line.confirmedAt || line.confirmed
                            ? "confirmed"
                            : "pending";
                    const typeValue = getInterventionType(line);
                    rows.push({
                        requestId: request.id || "",
                        createdAt: request.createdAt || "",
                        employee: request.employee || "",
                        department: request.department || "",
                        requester,
                        category: typeValue || "",
                        description: getInterventionDescription(line),
                        urgency: line.urgency || "",
                        notes: request.notes || "",
                        status,
                        confirmedAt: line.confirmedAt || "",
                        confirmedBy: line.confirmedBy || "",
                        deletedAt: line.deletedAt || "",
                        deletedBy: line.deletedBy || "",
                    });
                });
            });
            return rows;
        }
        const requests = readRequestsFile(REQUEST_MODES.PURCHASE);
        const rows = [];
        requests.forEach((request) => {
            const requester = [request.employee, request.department].filter(Boolean).join(" - ");
            (request.lines || []).forEach((line) => {
                const status = line.deletedAt
                    ? "deleted"
                    : line.confirmedAt || line.confirmed
                        ? "confirmed"
                        : "pending";
                rows.push({
                    requestId: request.id || "",
                    createdAt: request.createdAt || "",
                    employee: request.employee || "",
                    department: request.department || "",
                    requester,
                    product: line.product || "",
                    category: line.category || "",
                    quantity: line.quantity || "",
                    unit: line.unit || "",
                    urgency: line.urgency || "",
                    url: line.url || "",
                    note: line.note || "",
                    priceCad: line.priceCad || "",
                    status,
                    confirmedAt: line.confirmedAt || "",
                    confirmedBy: line.confirmedBy || "",
                    deletedAt: line.deletedAt || "",
                    deletedBy: line.deletedBy || "",
                });
            });
        });
        return rows;
    };

    const filterExportRows = (rows, options) => {
        const {
            search,
            urgency,
            tag,
            includePending,
            includeConfirmed,
            includeDeleted,
            rangeMode,
            year,
            start,
            end,
        } = options;

        return rows.filter((row) => {
            if (urgency && Array.isArray(urgency) && urgency.length) {
                if (!urgency.includes(row.urgency || "")) return false;
            }
            if (tag && Array.isArray(tag) && tag.length) {
                const tags = toTags(row.category || "");
                if (!tag.some((value) => tags.includes(value))) return false;
            }
            if (search) {
                const haystack = [
                    row.product,
                    row.category,
                    row.description,
                    row.requester,
                    row.url,
                    row.unit,
                    row.urgency,
                    row.priceCad,
                    row.notes,
                ]
                    .join(" ")
                    .toLowerCase();
                if (!haystack.includes(search.toLowerCase())) return false;
            }

            if (row.status === "pending" && !includePending) return false;
            if (row.status === "confirmed" && !includeConfirmed) return false;
            if (row.status === "deleted" && !includeDeleted) return false;

            const dateValue = row.confirmedAt || row.deletedAt || row.createdAt;
            const date = dateValue ? new Date(dateValue) : null;
            if (!date || Number.isNaN(date.getTime())) return false;

            if (rangeMode === "year" && year) {
                if (date.getFullYear() !== year) return false;
            }
            if (rangeMode === "range") {
                if (start && date < start) return false;
                if (end && date > end) return false;
            }
            return true;
        });
    };

    const buildExportSheet = (rows) => {
        if (isInterventionMode()) return buildInterventionExportSheet(rows);
        const headers = [
            "ID Richiesta",
            "Data richiesta",
            "Dipendente",
            "Reparto",
            "Richiesto da",
            "Prodotto",
            "Tipologia",
            "Quantità",
            "UM",
            "Urgenza",
            "URL",
            "Note",
            "Prezzo C.A.D",
            "Stato",
            "Data convalida",
            "Convalidato da",
            "Data eliminazione",
            "Eliminato da",
        ];
        const data = rows.map((row) => [
            row.requestId,
            row.createdAt,
            row.employee,
            row.department,
            row.requester,
            row.product,
            row.category,
            row.quantity,
            row.unit,
            row.urgency,
            row.url,
            row.note,
            row.priceCad,
            row.status,
            row.confirmedAt,
            row.confirmedBy,
            row.deletedAt,
            row.deletedBy,
        ]);
        return XLSX.utils.aoa_to_sheet([headers, ...data]);
    };

    const buildInterventionExportSheet = (rows) => {
        const headers = [
            "ID Richiesta",
            "Data richiesta",
            "Dipendente",
            "Reparto",
            "Richiesto da",
            "Tipologia",
            "Descrizione",
            "Urgenza",
            "Note generali",
            "Stato",
            "Data convalida",
            "Convalidato da",
            "Data eliminazione",
            "Eliminato da",
        ];
        const data = rows.map((row) => [
            row.requestId,
            row.createdAt,
            row.employee,
            row.department,
            row.requester,
            row.category,
            row.description,
            row.urgency,
            row.notes,
            row.status,
            row.confirmedAt,
            row.confirmedBy,
            row.deletedAt,
            row.deletedBy,
        ]);
        return XLSX.utils.aoa_to_sheet([headers, ...data]);
    };

    const exportCartExcel = async () => {
        if (!XLSX) {
            showError("Modulo 'xlsx' non trovato.", "Esegui 'npm install xlsx' nella cartella del progetto AyPi.");
            return;
        }
        const rangeMode = document.querySelector("input[name='pm-export-range']:checked")?.value || "all";
        const start = parseDateInput(document.getElementById("pm-export-start")?.value || "");
        const end = parseDateInput(document.getElementById("pm-export-end")?.value || "");
        const yearValue = parseInt(document.getElementById("pm-export-year")?.value || "", 10);
        const year = Number.isNaN(yearValue) ? null : yearValue;
        if (rangeMode === "range" && start && end && start > end) {
            setExportMessage("Seleziona un intervallo valido.", true);
            return;
        }
        const stateValues = [];
        const stateContainer = document.getElementById("pm-export-state");
        if (stateContainer) {
            stateContainer.querySelectorAll('input[type="checkbox"]:checked').forEach((input) => {
                stateValues.push(input.value);
            });
        }
        const includePending = stateValues.length ? stateValues.includes("Pending") : true;
        const includeConfirmed = stateValues.length ? stateValues.includes("Convalidati") : true;
        const includeDeleted = stateValues.length ? stateValues.includes("Eliminati") : false;
        if (!includePending && !includeConfirmed && !includeDeleted) {
            setExportMessage("Seleziona almeno uno stato.", true);
            return;
        }
        const rows = buildExportRows();
        const urgencyValues = [];
        const tagValues = [];
        const urgencyContainer = document.getElementById("pm-export-urgency");
        if (urgencyContainer) {
            urgencyContainer.querySelectorAll('input[type="checkbox"]:checked').forEach((input) => {
                urgencyValues.push(input.value);
            });
        }
        const tagContainer = document.getElementById("pm-export-tag");
        if (tagContainer) {
            tagContainer.querySelectorAll('input[type="checkbox"]:checked').forEach((input) => {
                tagValues.push(input.value);
            });
        }
        const filtered = filterExportRows(rows, {
            search: "",
            urgency: urgencyValues,
            tag: tagValues,
            includePending,
            includeConfirmed,
            includeDeleted,
            rangeMode,
            year,
            start,
            end,
        });
        if (!filtered.length) {
            setExportMessage("Nessun dato da esportare.", true);
            return;
        }
        const isIntervention = isInterventionMode();
        const filePath = await ipcRenderer.invoke("select-output-file", {
            defaultName: isIntervention ? "lista_interventi.xlsx" : "lista_acquisti.xlsx",
            filters: [{ name: "File Excel", extensions: ["xlsx"] }],
        });
        if (!filePath) return;
        const wb = XLSX.utils.book_new();
        const sheet = buildExportSheet(filtered);
        XLSX.utils.book_append_sheet(wb, sheet, isIntervention ? "Interventi" : "Acquisti");
        XLSX.writeFile(wb, filePath);
        setExportMessage("File Excel creato con successo.", false);
    };

    const openBtn = document.getElementById("pm-export-open");
    const closeBtn = document.getElementById("pm-export-close");
    const cancelBtn = document.getElementById("pm-export-cancel");
    const runBtn = document.getElementById("pm-export-run");
    const modal = document.getElementById("pm-export-modal");
    const rangeRadios = document.querySelectorAll("input[name='pm-export-range']");
    const tagSelect = document.getElementById("pm-export-tag");
    const yearSelect = document.getElementById("pm-export-year");
    const searchInput = document.getElementById("pm-export-search");
    const urgencySelect = document.getElementById("pm-export-urgency");
    const stateSelect = document.getElementById("pm-export-state");

    const setRangeState = () => {
        const mode = document.querySelector("input[name='pm-export-range']:checked")?.value || "all";
        const yearField = document.getElementById("pm-export-year");
        const startField = document.getElementById("pm-export-start");
        const endField = document.getElementById("pm-export-end");
        if (yearField) yearField.disabled = mode !== "year";
        if (startField) startField.disabled = mode !== "range";
        if (endField) endField.disabled = mode !== "range";
    };

    const populateYearOptions = () => {
        if (!yearSelect) return;
        yearSelect.innerHTML = "";
        const rows = buildExportRows();
        const years = new Set();
        rows.forEach((row) => {
            const dateValue = row.confirmedAt || row.deletedAt || row.createdAt;
            if (!dateValue) return;
            const date = new Date(dateValue);
            if (Number.isNaN(date.getTime())) return;
            years.add(date.getFullYear());
        });
        const sorted = Array.from(years.values()).sort((a, b) => b - a);
        if (!sorted.length) {
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "Nessun dato";
            yearSelect.appendChild(option);
            return;
        }
        sorted.forEach((year) => {
            const option = document.createElement("option");
            option.value = String(year);
            option.textContent = String(year);
            yearSelect.appendChild(option);
        });
    };

    const buildExportMultiSelect = (container, values, selectedValues) => {
        if (!container) return null;
        container.innerHTML = "";
        const wrap = document.createElement("div");
        wrap.className = "pm-multiselect";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pm-multiselect__button";
        button.textContent = "Tutte";
        const menu = document.createElement("div");
        menu.className = "pm-multiselect__menu is-hidden";
        const selectedSet = new Set(selectedValues || []);
        values.forEach((value) => {
            const option = document.createElement("label");
            option.className = "pm-multiselect__option";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = value;
            if (selectedSet.has(value)) checkbox.checked = true;
            const span = document.createElement("span");
            span.textContent = value;
            checkbox.addEventListener("change", () => {
                if (checkbox.checked) selectedSet.add(value);
                else selectedSet.delete(value);
                const list = Array.from(selectedSet.values());
                button.textContent = list.length ? list.join(", ") : "Tutte";
            });
            option.append(checkbox, span);
            menu.appendChild(option);
        });
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            if (menu.classList.contains("is-hidden")) {
                openMultiselectMenu(menu, button, wrap);
            } else {
                closeMultiselectMenu(menu, wrap);
            }
        });
        document.addEventListener("click", (event) => {
            if (!wrap.contains(event.target) && !menu.contains(event.target)) {
                closeMultiselectMenu(menu, wrap);
            }
        });
        const list = Array.from(selectedSet.values());
        button.textContent = list.length ? list.join(", ") : "Tutte";
        wrap.append(button, menu);
        container.appendChild(wrap);
        return { getSelected: () => Array.from(selectedSet.values()) };
    };

    let exportTagSelect = null;
    let exportUrgencySelect = null;
    let exportStateSelect = null;

    const openModal = () => {
        if (!modal) return;
        const tagValues = isInterventionMode() ? interventionTypes : catalogCategories;
        exportTagSelect = buildExportMultiSelect(tagSelect, tagValues, []);
        exportUrgencySelect = buildExportMultiSelect(urgencySelect, ["Alta", "Media", "Bassa"], []);
        exportStateSelect = buildExportMultiSelect(
            stateSelect,
            ["Pending", "Convalidati", "Eliminati"],
            []
        );
        populateYearOptions();
        if (searchInput) searchInput.value = "";
        setExportMessage("");
        modal.classList.remove("is-hidden");
        modal.setAttribute("aria-hidden", "false");
        setRangeState();
    };

    const closeModal = () => {
        if (!modal) return;
        modal.classList.add("is-hidden");
        modal.setAttribute("aria-hidden", "true");
    };

    if (openBtn) openBtn.addEventListener("click", () => openModal());
    if (closeBtn) closeBtn.addEventListener("click", () => closeModal());
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeModal());
    if (runBtn) runBtn.addEventListener("click", () => exportCartExcel());
    if (rangeRadios.length) {
        rangeRadios.forEach((radio) => radio.addEventListener("change", setRangeState));
    }
    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeModal();
        });
    }
}

module.exports = { initExportModal };
