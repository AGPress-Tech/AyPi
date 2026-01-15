const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

const DATA_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-obiettivi.json";

const state = {
    objectives: [],
};

let saveTimer = null;

function showDialog(type, message, detail = "") {
    return ipcRenderer.invoke("show-message-box", { type, message, detail });
}

function computeProgress(items) {
    if (!items || items.length === 0) return 0;
    const done = items.filter((item) => isSubtaskDone(item)).length;
    return Math.round((done / items.length) * 100);
}

function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveData();
    }, 500);
    setSaveStatus("Modifiche in attesa...");
}

function setSaveStatus(text) {
    const el = document.getElementById("saveStatus");
    if (el) el.textContent = text;
}

function ensureDataFolder() {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadData() {
    try {
        if (!fs.existsSync(DATA_PATH)) {
            state.objectives = [];
            setSaveStatus("Nessun dato trovato");
            return;
        }
        const raw = fs.readFileSync(DATA_PATH, "utf8");
        const data = JSON.parse(raw);
        state.objectives = Array.isArray(data) ? data : [];
        setSaveStatus("Dati caricati");
    } catch (err) {
        console.error("Errore caricamento dati:", err);
        state.objectives = [];
        setSaveStatus("Errore lettura dati");
        showDialog("warning", "Impossibile leggere i dati dal server.", err.message || String(err));
    }
}

function saveData() {
    try {
        ensureDataFolder();
        fs.writeFileSync(DATA_PATH, JSON.stringify(state.objectives, null, 2), "utf8");
        setSaveStatus("Salvato");
    } catch (err) {
        console.error("Errore salvataggio dati:", err);
        setSaveStatus("Salvataggio fallito");
        showDialog("warning", "Impossibile salvare i dati sul server.", err.message || String(err));
    }
}

function createId() {
    return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function addObjective() {
    state.objectives.push({
        id: createId(),
        title: "Nuovo obiettivo",
        createdBy: "",
        items: [],
    });
    renderObjectives();
    scheduleSave();
}

function addSubtask(objective) {
    objective.items.push({
        id: createId(),
        title: "Nuovo sub obiettivo",
        assignees: [],
        dueDate: "",
        done: false,
        completionType: "check",
        targetValue: "",
        currentValue: "",
        currency: "€",
        rating: 0,
    });
    renderObjectives();
    scheduleSave();
}

function removeObjective(objectiveId) {
    state.objectives = state.objectives.filter((obj) => obj.id !== objectiveId);
    renderObjectives();
    scheduleSave();
}

function removeSubtask(objective, subtaskId) {
    objective.items = objective.items.filter((item) => item.id !== subtaskId);
    renderObjectives();
    scheduleSave();
}

function updateObjectiveTitle(objective, value) {
    objective.title = value;
    scheduleSave();
}

function updateObjectiveOwner(objective, value) {
    objective.createdBy = value;
    scheduleSave();
}

function updateSubtask(subtask, fields) {
    Object.assign(subtask, fields);
    scheduleSave();
}

function parseNumber(value) {
    if (value == null) return NaN;
    const normalized = String(value).replace(",", ".").trim();
    return parseFloat(normalized);
}

function isSubtaskDone(item) {
    if (!item) return false;
    const type = item.completionType || "check";
    if (type === "number" || type === "currency") {
        const target = parseNumber(item.targetValue);
        const current = parseNumber(item.currentValue);
        if (!isFinite(target) || !isFinite(current)) return false;
        return current >= target;
    }
    if (type === "rating") {
        return Number(item.rating || 0) >= 5;
    }
    return !!item.done;
}

function updateObjectiveProgress(card, objective) {
    if (!card || !objective) return;
    const progress = computeProgress(objective.items);
    const valueEl = card.querySelector(".progress-value");
    const fillEl = card.querySelector(".progress-fill");
    if (valueEl) valueEl.textContent = `${progress}%`;
    if (fillEl) fillEl.style.width = `${progress}%`;
}

function updateStarsDisplay(stars, rating) {
    if (!stars || !stars.length) return;
    stars.forEach((star) => {
        const value = Number(star.dataset.star || 0);
        if (value <= rating) {
            star.classList.add("active");
            star.textContent = "★";
        } else {
            star.classList.remove("active");
            star.textContent = "☆";
        }
    });
}

function renderObjectives() {
    const list = document.getElementById("objectiveList");
    if (!list) return;
    list.innerHTML = "";

    if (!state.objectives.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "Nessun obiettivo. Crea il primo con il pulsante in alto.";
        list.appendChild(empty);
        return;
    }

    const objectiveTemplate = document.getElementById("objectiveTemplate");
    const subtaskTemplate = document.getElementById("subtaskTemplate");
    if (!objectiveTemplate || !subtaskTemplate) return;

    state.objectives.forEach((objective) => {
        const clone = objectiveTemplate.content.cloneNode(true);
        const card = clone.querySelector(".objective-card");
        const titleInput = clone.querySelector(".objective-title");
        const ownerInput = clone.querySelector(".objective-owner");
        const deleteBtn = clone.querySelector(".delete-objective");
        const progressValue = clone.querySelector(".progress-value");
        const progressFill = clone.querySelector(".progress-fill");
        const subtasksEl = clone.querySelector(".subtasks");
        const addSubBtn = clone.querySelector(".add-subtask");

        titleInput.value = objective.title || "";
        titleInput.addEventListener("input", (event) => {
            updateObjectiveTitle(objective, event.target.value);
        });

        if (ownerInput) {
            ownerInput.value = objective.createdBy || "";
            ownerInput.addEventListener("input", (event) => {
                updateObjectiveOwner(objective, event.target.value);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener("click", () => {
                removeObjective(objective.id);
            });
        }

        updateObjectiveProgress(card, objective);

        (objective.items || []).forEach((item) => {
            const subClone = subtaskTemplate.content.cloneNode(true);
            const row = subClone.querySelector(".subtask-row");
            const checkbox = subClone.querySelector("input[type='checkbox']");
            const checkWrapper = subClone.querySelector(".check");
            const title = subClone.querySelector(".subtask-title");
            const assigneeList = subClone.querySelector(".assignee-list");
            const addAssigneeBtn = subClone.querySelector(".add-assignee");
            const assigneeInputWrap = subClone.querySelector(".assignee-input");
            const assigneeNameInput = subClone.querySelector(".assignee-name");
            const assigneeAddBtn = subClone.querySelector(".assignee-add-btn");
            const typeSelect = subClone.querySelector(".subtask-type");
            const metricNumber = subClone.querySelector(".metric-number");
            const metricRating = subClone.querySelector(".metric-rating");
            const currentInput = subClone.querySelector(".subtask-current");
            const targetInput = subClone.querySelector(".subtask-target");
            const currencySelect = subClone.querySelector(".subtask-currency");
            const stars = subClone.querySelectorAll(".metric-rating .star");
            const date = subClone.querySelector(".subtask-date");
            const deleteSubBtn = subClone.querySelector(".delete-subtask");

            if (checkbox) checkbox.checked = !!item.done;
            if (title) title.value = item.title || "";
            if (date) date.value = item.dueDate || "";
            if (typeSelect) typeSelect.value = item.completionType || "check";
            if (currentInput) currentInput.value = item.currentValue || "";
            if (targetInput) targetInput.value = item.targetValue || "";
            if (currencySelect) currencySelect.value = item.currency || "€";

            if (assigneeList) {
                assigneeList.innerHTML = "";
                (item.assignees || []).forEach((name) => {
                    const rowEl = document.createElement("div");
                    rowEl.className = "assignee-item";
                    const text = document.createElement("span");
                    text.textContent = name;
                    const removeBtn = document.createElement("button");
                    removeBtn.type = "button";
                    removeBtn.className = "assignee-remove";
                    removeBtn.textContent = "✕";
                    removeBtn.addEventListener("click", () => {
                        item.assignees = (item.assignees || []).filter((n) => n !== name);
                        renderObjectives();
                        scheduleSave();
                    });
                    rowEl.appendChild(text);
                    rowEl.appendChild(removeBtn);
                    assigneeList.appendChild(rowEl);
                });
            }

            const updateMetricVisibility = () => {
                const type = item.completionType || "check";
                if (metricNumber) {
                    metricNumber.classList.toggle(
                        "is-hidden",
                        type !== "number" && type !== "currency"
                    );
                }
                if (metricRating) {
                    metricRating.classList.toggle("is-hidden", type !== "rating");
                }
                if (currencySelect) {
                    currencySelect.classList.toggle("is-hidden", type !== "currency");
                }
                if (checkWrapper) {
                    checkWrapper.classList.toggle("is-hidden", type !== "check");
                }
                if (checkbox) {
                    checkbox.disabled = type !== "check";
                }
            };

            updateMetricVisibility();

            if (checkbox) {
                checkbox.addEventListener("change", (event) => {
                    updateSubtask(item, { done: event.target.checked });
                    updateObjectiveProgress(card, objective);
                });
            }

            if (title) {
                title.addEventListener("input", (event) => {
                    updateSubtask(item, { title: event.target.value });
                });
            }

            if (typeSelect) {
                typeSelect.addEventListener("change", (event) => {
                    updateSubtask(item, {
                        completionType: event.target.value,
                    });
                    renderObjectives();
                });
            }

            if (currentInput) {
                currentInput.addEventListener("input", (event) => {
                    updateSubtask(item, { currentValue: event.target.value });
                    updateObjectiveProgress(card, objective);
                });
            }

            if (currencySelect) {
                currencySelect.addEventListener("change", (event) => {
                    updateSubtask(item, { currency: event.target.value });
                });
            }

            if (targetInput) {
                targetInput.addEventListener("input", (event) => {
                    updateSubtask(item, { targetValue: event.target.value });
                    updateObjectiveProgress(card, objective);
                });
            }

            if (stars && stars.length) {
                const rating = Number(item.rating || 0);
                updateStarsDisplay(stars, rating);
                stars.forEach((star) => {
                    const value = Number(star.dataset.star || 0);
                    star.addEventListener("click", () => {
                        updateSubtask(item, { rating: value });
                        updateStarsDisplay(stars, value);
                        updateObjectiveProgress(card, objective);
                    });
                });
            }

            if (date) {
                date.addEventListener("change", (event) => {
                    updateSubtask(item, { dueDate: event.target.value });
                });
            }

            if (deleteSubBtn) {
                deleteSubBtn.addEventListener("click", () => {
                    removeSubtask(objective, item.id);
                });
            }

            if (addAssigneeBtn && assigneeInputWrap) {
                addAssigneeBtn.addEventListener("click", () => {
                    assigneeInputWrap.classList.toggle("is-hidden");
                    if (!assigneeInputWrap.classList.contains("is-hidden") && assigneeNameInput) {
                        assigneeNameInput.focus();
                    }
                });
            }

            const commitAssignee = () => {
                if (!assigneeNameInput) return;
                const value = assigneeNameInput.value.trim();
                if (!value) return;
                const current = Array.isArray(item.assignees) ? item.assignees : [];
                if (!current.includes(value)) {
                    updateSubtask(item, { assignees: [...current, value] });
                }
                assigneeNameInput.value = "";
                if (assigneeInputWrap) assigneeInputWrap.classList.add("is-hidden");
                renderObjectives();
            };

            if (assigneeAddBtn) {
                assigneeAddBtn.addEventListener("click", () => {
                    commitAssignee();
                });
            }

            if (assigneeNameInput) {
                assigneeNameInput.addEventListener("keydown", (event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        commitAssignee();
                    }
                });
            }

            if (subtasksEl && row) {
                subtasksEl.appendChild(row);
            }
        });

        if (addSubBtn) {
            addSubBtn.addEventListener("click", () => {
                addSubtask(objective);
            });
        }

        if (list && card) {
            list.appendChild(card);
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    console.log("amministrazione-scripts.js caricato");
    loadData();
    renderObjectives();

    const addBtn = document.getElementById("addObjectiveBtn");
    if (addBtn) {
        addBtn.addEventListener("click", () => {
            addObjective();
        });
    }
});
