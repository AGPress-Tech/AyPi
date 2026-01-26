const { UI_TEXTS } = require("../utils/ui-texts");

function createHolidaysModal(options) {
    const {
        document,
        showModal,
        hideModal,
        setMessage,
        syncData,
        renderAll,
        loadData,
        openPasswordModal,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    let highlightDate = null;
    let editingDate = null;

    function normalizeHolidays(payload) {
        const holidays = Array.isArray(payload?.holidays) ? payload.holidays.slice() : [];
        return holidays.map((item) => {
            if (typeof item === "string") {
                return { date: item, name: "" };
            }
            if (item && typeof item.date === "string") {
                return { date: item.date, name: item.name || "" };
            }
            return null;
        }).filter(Boolean);
    }

    function renderHolidayList(payload, options = {}) {
        const listId = options.containerId || "fp-holidays-future-list";
        const list = document.getElementById(listId);
        if (!list) return;
        list.innerHTML = "";
        const normalized = normalizeHolidays(payload);
        const today = new Date();
        const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
            today.getDate()
        ).padStart(2, "0")}`;
        const filtered = normalized
            .filter((item) => (options.futureOnly ? item.date >= todayKey : true))
            .sort((a, b) => a.date.localeCompare(b.date));
        if (!filtered.length) {
            const empty = document.createElement("div");
            empty.className = "fp-message";
            empty.textContent = options.futureOnly
                ? "Nessuna festivita futura configurata."
                : "Nessuna festivita configurata.";
            list.appendChild(empty);
            return;
        }
        filtered.forEach(({ date, name }) => {
            const row = document.createElement("div");
            row.className = "fp-holidays-row";
            if (highlightDate && highlightDate === date) {
                row.classList.add("is-highlight");
            }

            let label = document.createElement("div");
            label.className = "fp-holidays-row__info";
            const title = document.createElement("div");
            title.className = "fp-holidays-row__name";
            title.textContent = name || "Festivita";
            const dateLine = document.createElement("div");
            dateLine.className = "fp-holidays-row__date";
            dateLine.textContent = date;
            label.appendChild(title);
            label.appendChild(dateLine);

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "fp-btn fp-btn--ghost";
            remove.textContent = "Rimuovi";
            remove.addEventListener("click", () => {
                if (typeof openPasswordModal === "function") {
                    openPasswordModal({
                        type: "holiday-remove",
                        id: date,
                        title: "Rimuovi festivita",
                        description: UI_TEXTS.holidayPasswordDescription,
                        date,
                    });
                }
            });

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "fp-btn";
            edit.textContent = "Modifica";
            edit.addEventListener("click", () => {
                editingDate = date;
                renderHolidayList(payload);
            });

            if (editingDate === date) {
                const wrapper = document.createElement("div");
                wrapper.className = "fp-holidays-row__edit";
                const input = document.createElement("input");
                input.type = "date";
                input.className = "fp-field__input";
                input.value = date;
                input.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        saveBtn.click();
                    }
                });
                const nameInput = document.createElement("input");
                nameInput.type = "text";
                nameInput.className = "fp-field__input";
                nameInput.placeholder = "Nome festivita";
                nameInput.value = name || "";
                wrapper.appendChild(input);
                wrapper.appendChild(nameInput);
                label = wrapper;
            }

            const actions = document.createElement("div");
            actions.className = "fp-assignees-row__actions";
            if (editingDate === date) {
                actions.dataset.editing = "true";
            }

            if (editingDate === date) {
                const saveBtn = document.createElement("button");
                saveBtn.type = "button";
                saveBtn.className = "fp-btn fp-btn--primary";
                saveBtn.textContent = "Salva";
                saveBtn.addEventListener("click", () => {
                    const input = row.querySelector("input[type='date']");
                    const nameInput = row.querySelector("input[type='text']");
                    const nextValue = input ? input.value : "";
                    const nextName = nameInput ? nameInput.value.trim() : "";
                    if (!nextValue) {
                        setMessage(document.getElementById("fp-holidays-message"), UI_TEXTS.holidayInvalidDate, true);
                        return;
                    }
                    if (typeof openPasswordModal === "function") {
                        openPasswordModal({
                            type: "holiday-update",
                            id: date,
                            title: "Modifica festivita",
                            description: UI_TEXTS.holidayPasswordDescription,
                            date,
                            nextDate: nextValue,
                            nextName,
                        });
                    }
                    editingDate = null;
                });

                const cancelBtn = document.createElement("button");
                cancelBtn.type = "button";
                cancelBtn.className = "fp-btn fp-btn--ghost";
                cancelBtn.textContent = "Annulla";
                cancelBtn.addEventListener("click", () => {
                    editingDate = null;
                    renderHolidayList(payload);
                });
                actions.appendChild(cancelBtn);
                actions.appendChild(saveBtn);
            } else {
                actions.appendChild(edit);
                actions.appendChild(remove);
            }

            row.appendChild(label);
            row.appendChild(actions);
            list.appendChild(row);
        });
    }

    function openHolidaysModal(dateToHighlight) {
        const modal = document.getElementById("fp-holidays-modal");
        const message = document.getElementById("fp-holidays-message");
        const startInput = document.getElementById("fp-holidays-start");
        const nameInput = document.getElementById("fp-holidays-name");
        if (!modal) return;
        highlightDate = dateToHighlight || null;
        editingDate = null;
        setMessage(message, "");
        if (startInput) startInput.value = dateToHighlight || "";
        if (nameInput) nameInput.value = "";
        showModal(modal);
    }

    function openHolidaysListModal(dateToHighlight) {
        const modal = document.getElementById("fp-holidays-list-modal");
        if (!modal) return;
        highlightDate = dateToHighlight || null;
        editingDate = null;
        const data = loadData();
        renderHolidayList(data, { containerId: "fp-holidays-future-list", futureOnly: true });
        if (highlightDate) {
            const target = document.querySelector(".fp-holidays-row.is-highlight");
            if (target) {
                target.scrollIntoView({ block: "nearest" });
            }
        }
        showModal(modal);
    }

    function closeHolidaysModal() {
        const modal = document.getElementById("fp-holidays-modal");
        if (!modal) return;
        hideModal(modal);
    }

    function initHolidaysModal() {
        const openBtn = document.getElementById("fp-holidays-manage");
        const listOpenBtn = document.getElementById("fp-holidays-list-open");
        const listCloseBtn = document.getElementById("fp-holidays-list-close");
        const closeBtn = document.getElementById("fp-holidays-close");
        const addBtn = document.getElementById("fp-holidays-add");
        const startInput = document.getElementById("fp-holidays-start");
        const nameInput = document.getElementById("fp-holidays-name");
        const message = document.getElementById("fp-holidays-message");
        const modal = document.getElementById("fp-holidays-modal");
        const listModal = document.getElementById("fp-holidays-list-modal");

        if (openBtn) {
            openBtn.addEventListener("click", () => {
                openHolidaysModal();
            });
        }
        if (listOpenBtn) {
            listOpenBtn.addEventListener("click", () => {
                openHolidaysListModal();
            });
        }
        if (listCloseBtn) {
            listCloseBtn.addEventListener("click", () => {
                if (listModal) hideModal(listModal);
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                closeHolidaysModal();
            });
        }
        if (modal) {
            modal.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }
        if (listModal) {
            listModal.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }
        if (addBtn) {
            addBtn.addEventListener("click", () => {
                const startValue = startInput ? startInput.value : "";
                const nameValue = nameInput ? nameInput.value.trim() : "";
                if (!startValue) {
                    setMessage(message, UI_TEXTS.holidayInvalidDate, true);
                    return;
                }
                const dates = [startValue];

                if (typeof openPasswordModal === "function") {
                    openPasswordModal({
                        type: "holiday-create",
                        id: "holiday-create",
                        title: "Conferma festivita",
                        description: UI_TEXTS.holidayPasswordDescription,
                        dates,
                        name: nameValue,
                    });
                }
            });
        }
        if (startInput) {
            startInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    addBtn?.click();
                }
            });
        }
    }

    return { initHolidaysModal, renderHolidayList, openHolidaysModal, openHolidaysListModal };
}

module.exports = { createHolidaysModal };
