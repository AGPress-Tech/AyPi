const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

const gantt = window.gantt;
const DATA_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-obiettivi.json";
const ASSIGNEES_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-assignees.json";

let saveTimer = null;
let assigneeOptions = [];
let assigneeGroups = {};
let assigneePanelHeight = 200;
let timelineExtendCooldown = 0;

function showDialog(type, message, detail = "") {
    return ipcRenderer.invoke("show-message-box", { type, message, detail });
}

function loadAssigneeOptions() {
    try {
        if (!fs.existsSync(ASSIGNEES_PATH)) {
            ensureDataFolder();
            fs.writeFileSync(ASSIGNEES_PATH, JSON.stringify({}, null, 2), "utf8");
            return { groups: {}, options: [] };
        }
        const raw = fs.readFileSync(ASSIGNEES_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return { groups: { "Altro": parsed.map((name) => String(name)) }, options: parsed.map((name) => String(name)) };
        }
        if (Array.isArray(parsed.data)) {
            return { groups: { "Altro": parsed.data.map((name) => String(name)) }, options: parsed.data.map((name) => String(name)) };
        }
        if (parsed && typeof parsed === "object") {
            const rawGroups = parsed.groups && typeof parsed.groups === "object" ? parsed.groups : parsed;
            const groups = {};
            Object.keys(rawGroups).forEach((key) => {
                const list = Array.isArray(rawGroups[key]) ? rawGroups[key] : [];
                groups[key] = list.map((name) => String(name));
            });
            const options = Object.values(groups).flat();
            return { groups, options };
        }
        return { groups: {}, options: [] };
    } catch (err) {
        console.error("Errore caricamento assignees:", err);
        showDialog("warning", "Impossibile leggere la lista responsabili.", err.message || String(err));
        return { groups: {}, options: [] };
    }
}

function saveAssigneeOptions(groups) {
    try {
        ensureDataFolder();
        fs.writeFileSync(ASSIGNEES_PATH, JSON.stringify(groups, null, 2), "utf8");
    } catch (err) {
        console.error("Errore salvataggio assignees:", err);
        showDialog("warning", "Impossibile salvare la lista responsabili.", err.message || String(err));
    }
}

function renderAssigneePanel() {
    const panel = document.getElementById("assignees_panel");
    if (!panel) return;
    panel.innerHTML = "";
    const groupKeys = Object.keys(assigneeGroups);
    if (!groupKeys.length) {
        panel.textContent = "Nessun responsabile configurato.";
        return;
    }
    groupKeys.forEach((groupName) => {
        const group = document.createElement("div");
        group.className = "assignee-group";

        const title = document.createElement("div");
        title.className = "assignee-group__title";
        title.textContent = groupName;

        const list = document.createElement("div");
        list.className = "assignee-group__list";
        const names = assigneeGroups[groupName] || [];
        names.forEach((name) => {
            const item = document.createElement("div");
            item.className = "assignee-group__item";
            item.textContent = name;
            list.appendChild(item);
        });

        group.appendChild(title);
        group.appendChild(list);
        panel.appendChild(group);
    });
}

function renderDepartmentSelect() {
    const select = document.getElementById("employee-department");
    if (!select) return;
    select.innerHTML = "";
    Object.keys(assigneeGroups).forEach((group) => {
        const option = document.createElement("option");
        option.value = group;
        option.textContent = group;
        select.appendChild(option);
    });
}

function renderDepartmentList() {
    const list = document.getElementById("departments-list");
    if (!list) return;
    list.innerHTML = "";
    const groups = Object.keys(assigneeGroups);
    if (!groups.length) {
        list.textContent = "Nessun reparto.";
        return;
    }
    groups.forEach((group) => {
        const row = document.createElement("div");
        row.className = "assignees-row";

        const label = document.createElement("div");
        label.textContent = group;

        const actions = document.createElement("div");
        actions.className = "assignees-row__actions";

        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "assignees-link";
        edit.textContent = "Modifica";
        edit.addEventListener("click", () => {
            const next = window.prompt("Nuovo nome reparto:", group);
            if (!next) return;
            const trimmed = next.trim();
            if (!trimmed || trimmed === group) return;
            if (assigneeGroups[trimmed]) return;
            assigneeGroups[trimmed] = assigneeGroups[group];
            delete assigneeGroups[group];
            assigneeOptions = Object.values(assigneeGroups).flat();
            saveAssigneeOptions(assigneeGroups);
            renderAssigneePanel();
            renderDepartmentList();
            renderDepartmentSelect();
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "assignees-link assignees-link--danger";
        remove.textContent = "Rimuovi";
        remove.addEventListener("click", () => {
            if (!window.confirm(`Rimuovere il reparto "${group}"?`)) return;
            delete assigneeGroups[group];
            assigneeOptions = Object.values(assigneeGroups).flat();
            saveAssigneeOptions(assigneeGroups);
            renderAssigneePanel();
            renderDepartmentList();
            renderDepartmentSelect();
        });

        actions.appendChild(edit);
        actions.appendChild(remove);

        row.appendChild(label);
        row.appendChild(actions);
        list.appendChild(row);
    });
}

function renderEmployeesList() {
    const list = document.getElementById("employees-list");
    if (!list) return;
    list.innerHTML = "";
    const groups = Object.keys(assigneeGroups);
    const employees = [];
    groups.forEach((group) => {
        (assigneeGroups[group] || []).forEach((name) => {
            employees.push({ group, name });
        });
    });
    if (!employees.length) {
        list.textContent = "Nessun operatore.";
        return;
    }
    employees.forEach((employee) => {
        const row = document.createElement("div");
        row.className = "assignees-row";

        const label = document.createElement("div");
        label.textContent = `${employee.name} (${employee.group})`;

        const actions = document.createElement("div");
        actions.className = "assignees-row__actions";

        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "assignees-link";
        edit.textContent = "Modifica";
        edit.addEventListener("click", () => {
            const nextName = window.prompt("Nome operatore:", employee.name);
            if (!nextName) return;
            const trimmedName = nextName.trim();
            if (!trimmedName) return;
            const nextGroup = window.prompt("Reparto:", employee.group) || employee.group;
            const trimmedGroup = nextGroup.trim();
            if (!trimmedGroup) return;
            assigneeGroups[employee.group] = (assigneeGroups[employee.group] || []).filter((n) => n !== employee.name);
            if (!assigneeGroups[trimmedGroup]) assigneeGroups[trimmedGroup] = [];
            assigneeGroups[trimmedGroup].push(trimmedName);
            assigneeGroups[trimmedGroup].sort((a, b) => a.localeCompare(b));
            if (assigneeGroups[employee.group].length === 0) delete assigneeGroups[employee.group];
            assigneeOptions = Object.values(assigneeGroups).flat();
            saveAssigneeOptions(assigneeGroups);
            renderAssigneePanel();
            renderEmployeesList();
            renderDepartmentList();
            renderDepartmentSelect();
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "assignees-link assignees-link--danger";
        remove.textContent = "Rimuovi";
        remove.addEventListener("click", () => {
            if (!window.confirm(`Rimuovere "${employee.name}"?`)) return;
            assigneeGroups[employee.group] = (assigneeGroups[employee.group] || []).filter((n) => n !== employee.name);
            if (assigneeGroups[employee.group].length === 0) delete assigneeGroups[employee.group];
            assigneeOptions = Object.values(assigneeGroups).flat();
            saveAssigneeOptions(assigneeGroups);
            renderAssigneePanel();
            renderEmployeesList();
            renderDepartmentList();
            renderDepartmentSelect();
        });

        actions.appendChild(edit);
        actions.appendChild(remove);

        row.appendChild(label);
        row.appendChild(actions);
        list.appendChild(row);
    });
}

function applyAssigneePanelHeight() {
    const panel = document.querySelector(".assignees-panel");
    if (!panel) return;
    panel.style.height = `${assigneePanelHeight}px`;
}

function normalizeAssignees(value) {
    if (Array.isArray(value)) return value.join(", ");
    if (value == null) return "";
    const trimmed = String(value).trim();
    if (!trimmed || trimmed.toLowerCase() === "undefined") return "";
    return trimmed;
}

function randomColor() {
    const hue = Math.floor(Math.random() * 360);
    const sat = 70 + Math.floor(Math.random() * 15);
    const light = 45 + Math.floor(Math.random() * 10);
    return hslToHex(hue, sat, light);
}

function hexToRgb(hex) {
    const cleaned = String(hex).replace("#", "").trim();
    if (cleaned.length === 3) {
        const r = parseInt(cleaned[0] + cleaned[0], 16);
        const g = parseInt(cleaned[1] + cleaned[1], 16);
        const b = parseInt(cleaned[2] + cleaned[2], 16);
        return { r, g, b };
    }
    if (cleaned.length !== 6) return null;
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return { r, g, b };
}

function lightenColor(color, amount = 0.3) {
    if (!color) return "";
    const rgb = hexToRgb(color);
    if (!rgb) return color;
    const mix = (channel) => Math.round(channel + (255 - channel) * amount);
    return `rgb(${mix(rgb.r)}, ${mix(rgb.g)}, ${mix(rgb.b)})`;
}

function hslToHex(h, s, l) {
    const sat = s / 100;
    const light = l / 100;
    const k = (n) => (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    const f = (n) =>
        Math.round(255 * (light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
    const toHex = (v) => v.toString(16).padStart(2, "0");
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
}

function getPaddingDays() {
    return 7;
}

function updateRangeFromTasks() {
    if (!gantt) return;
    const range = gantt.getSubtaskDates();
    if (!range || !range.start_date || !range.end_date) return;
    const padding = getPaddingDays();
    gantt.config.start_date = addDays(range.start_date, -padding);
    gantt.config.end_date = addDays(range.end_date, padding);
    gantt.render();
}

function extendTimelineRange(direction, anchorDate) {
    if (direction < 0) {
        gantt.config.start_date = gantt.date.add(gantt.config.start_date, -1, "day");
    } else {
        gantt.config.end_date = gantt.date.add(gantt.config.end_date, 1, "day");
    }
    gantt.render();
    if (anchorDate) {
        const scroll = gantt.getScrollState();
        const x = gantt.posFromDate(anchorDate);
        gantt.scrollTo(x, scroll.y);
    }
}

function extendRange(direction) {
    if (!gantt) return;
    const padding = getPaddingDays();
    const scroll = gantt.getScrollState();
    if (direction < 0) {
        gantt.config.start_date = addDays(gantt.config.start_date, -padding);
    } else {
        gantt.config.end_date = addDays(gantt.config.end_date, padding);
    }
    gantt.render();
    if (gantt.$task) {
        gantt.$task.scrollLeft = scroll.x;
    }
}

function getDateValue(value) {
    if (!value) return null;
    return value instanceof Date ? value : new Date(value);
}

function syncParentRange(parentId) {
    if (!parentId || parentId === 0) return;
    const parent = gantt.getTask(parentId);
    const children = gantt.getChildren(parentId) || [];
    if (!children.length) return;

    let minStart = null;
    let maxEnd = null;
    children.forEach((childId) => {
        const child = gantt.getTask(childId);
        const start = getDateValue(child.start_date);
        const end = getDateValue(child.end_date);
        if (start) minStart = minStart ? (start < minStart ? start : minStart) : start;
        if (end) maxEnd = maxEnd ? (end > maxEnd ? end : maxEnd) : end;
    });

    const currentStart = getDateValue(parent.start_date);
    const currentEnd = getDateValue(parent.end_date);

    if (minStart && (!currentStart || minStart < currentStart)) {
        parent.start_date = new Date(minStart);
    }
    if (maxEnd && (!currentEnd || maxEnd > currentEnd)) {
        parent.end_date = new Date(maxEnd);
    }
    parent.type = gantt.config.types.project;

    if (parent.parent && parent.parent !== 0) {
        syncParentRange(parent.parent);
    }
}

function syncAllParents() {
    const roots = gantt.getChildren(0) || [];
    roots.forEach((rootId) => {
        const stack = [rootId];
        while (stack.length) {
            const currentId = stack.pop();
            const children = gantt.getChildren(currentId) || [];
            children.forEach((childId) => stack.push(childId));
            if (children.length) {
                const current = gantt.getTask(currentId);
                current.type = gantt.config.types.project;
                syncParentRange(currentId);
            }
        }
    });
}

function clampParentToChildren(task) {
    if (!task) return;
    const children = gantt.getChildren(task.id) || [];
    if (!children.length) return;
    let minStart = null;
    let maxEnd = null;
    children.forEach((childId) => {
        const child = gantt.getTask(childId);
        const start = getDateValue(child.start_date);
        const end = getDateValue(child.end_date);
        if (start) minStart = minStart ? (start < minStart ? start : minStart) : start;
        if (end) maxEnd = maxEnd ? (end > maxEnd ? end : maxEnd) : end;
    });
    if (!minStart || !maxEnd) return;
    const start = getDateValue(task.start_date);
    const end = getDateValue(task.end_date);
    if (start && start > minStart) {
        task.start_date = new Date(minStart);
    }
    if (end && end < maxEnd) {
        task.end_date = new Date(maxEnd);
    }
}

function calculateParentProgress(parentId) {
    if (!parentId || parentId === 0) return;
    const parent = gantt.getTask(parentId);
    if (!parent) return;
    const children = gantt.getChildren(parentId) || [];
    if (!children.length) return;

    let totalWeight = 0;
    let weightedProgress = 0;
    children.forEach((childId) => {
        const child = gantt.getTask(childId);
        const duration = Number(child.duration) || 1;
        const progress = Number(child.progress) || 0;
        totalWeight += duration;
        weightedProgress += progress * duration;
    });

    if (totalWeight > 0) {
        parent.progress = Math.max(0, Math.min(1, weightedProgress / totalWeight));
        gantt.refreshTask(parentId);
    }

    if (parent.parent && parent.parent !== 0) {
        calculateParentProgress(parent.parent);
    }
}

function updateParentProgressFrom(id) {
    gantt.eachParent((task) => {
        const children = gantt.getChildren(task.id) || [];
        if (!children.length) return;
        let sum = 0;
        children.forEach((childId) => {
            const child = gantt.getTask(childId);
            sum += (Number(child.progress) || 0);
        });
        task.progress = Math.max(0, Math.min(1, sum / children.length));
    }, id);
    gantt.render();
}

function calculateAllParentsProgress() {
    const roots = gantt.getChildren(0) || [];
    roots.forEach((rootId) => {
        const stack = [rootId];
        while (stack.length) {
            const currentId = stack.pop();
            const children = gantt.getChildren(currentId) || [];
            children.forEach((childId) => stack.push(childId));
            if (children.length) {
                calculateParentProgress(currentId);
            }
        }
    });
}

function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveData();
    }, 500);
}

function ensureDataFolder() {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function toDateString(value) {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(value);
    if (!isFinite(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function normalizeTask(task) {
    const cleaned = { ...task };
    if ("undefined" in cleaned) delete cleaned.undefined;
    if ("assigneesText" in cleaned) delete cleaned.assigneesText;
    return {
        ...cleaned,
        start_date: toDateString(cleaned.start_date),
        end_date: toDateString(cleaned.end_date),
        assignees: normalizeAssignees(cleaned.assignees),
    };
}

function normalizePayload(payload) {
    const tasks = Array.isArray(payload.data || payload.tasks) ? (payload.data || payload.tasks) : [];
    const links = Array.isArray(payload.links) ? payload.links : [];
    return {
        data: tasks.map(normalizeTask),
        links,
    };
}

function loadData() {
    try {
        if (!fs.existsSync(DATA_PATH)) {
            return { data: [], links: [] };
        }
        const raw = fs.readFileSync(DATA_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return { data: [], links: [] };
        }
        return normalizePayload(parsed);
    } catch (err) {
        console.error("Errore caricamento dati:", err);
        showDialog("warning", "Impossibile leggere i dati dal server.", err.message || String(err));
        return { data: [], links: [] };
    }
}

function saveData() {
    try {
        ensureDataFolder();
        const payload = normalizePayload(gantt.serialize());
        fs.writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
        console.error("Errore salvataggio dati:", err);
        showDialog("warning", "Impossibile salvare i dati sul server.", err.message || String(err));
    }
}

function configureGantt() {
    gantt.plugins({ marker: true, drag_timeline: true });
    gantt.attachEvent("onTaskCreated", (task) => {
        if (!task.start_date) {
            const start = new Date();
            const end = addDays(start, 7);
            task.start_date = start;
            task.end_date = end;
        }
        return task;
    });

    gantt.attachEvent("onGridResize", () => {
        gantt.render();
    });
    gantt.config.date_format = "%Y-%m-%d";
    gantt.config.xml_date = "%Y-%m-%d";
    gantt.config.readonly = false;
    gantt.config.open_tree_initially = true;
    gantt.config.drag_progress = true;
    gantt.config.drag_resize = true;
    gantt.config.drag_move = true;
    gantt.config.drag_links = true;
    gantt.config.order_branch = true;
    gantt.config.auto_scheduling = false;
    gantt.config.inline_editing = true;
    gantt.config.auto_types = true;
    gantt.config.show_progress = true;
    gantt.config.scroll_size = 10;
    gantt.config.drag_timeline = {
        ignore: ".gantt_task_line, .gantt_task_link",
        useKey: false,
        render: false,
    };
    gantt.config.duration_unit = "day";
    gantt.config.duration_step = 1;
    gantt.config.drag_resize = true;
    gantt.config.drag_move = true;
    gantt.config.grid_width = 360;
    gantt.config.grid_resize = false;
    gantt.config.columns = [
        {
            name: "done",
            label: "",
            width: 36,
            align: "center",
            template: (task) => {
                const checked = (task.progress || 0) >= 1 ? "checked" : "";
                return `<input type="checkbox" class="ay-task-done" data-task-id="${task.id}" ${checked}>`;
            },
        },
        { name: "text", label: "Nome task", tree: true, width: 200, resize: true },
        { name: "start_date", label: "Inizio", align: "center", width: 110, resize: true, editor: { type: "date", map_to: "start_date", format: "%d/%m/%Y" } },
        { name: "end_date", label: "Fine", align: "center", width: 110, resize: true, editor: { type: "date", map_to: "end_date", format: "%d/%m/%Y" } },
        {
            name: "assignees",
            label: "Responsabili",
            align: "left",
            width: 160,
            resize: true,
            template: (task) => normalizeAssignees(task.assignees),
        },
        { name: "add", label: "", width: 40 },
    ];

    gantt.templates.task_style = (start, end, task) => {
        if (!task.color) return "";
        return `background-color:${task.color};`;
    };
    gantt.templates.progress_text = (start, end, task) => {
        return `<span style="text-align:left;">${Math.round((task.progress || 0) * 100)}%</span>`;
    };
    gantt.templates.task_class = () => "";

    gantt.form_blocks.ay_text = {
        render: function (sns) {
            return `<div class="gantt_custom_field"><input type="text" name="${sns.name}"></div>`;
        },
        set_value: function (node, value) {
            const input = node.querySelector("input");
            if (input) input.value = value || "";
        },
        get_value: function (node) {
            const input = node.querySelector("input");
            return input ? input.value : "";
        },
        focus: function (node) {
            const input = node.querySelector("input");
            if (input) input.focus();
        },
    };

    gantt.form_blocks.ay_color = {
        render: function (sns) {
            return `<div class="gantt_custom_field"><input type="color" name="${sns.name}"></div>`;
        },
        set_value: function (node, value) {
            const input = node.querySelector("input");
            if (input) input.value = value || "#4c6ef5";
        },
        get_value: function (node) {
            const input = node.querySelector("input");
            return input ? input.value : "";
        },
        focus: function (node) {
            const input = node.querySelector("input");
            if (input) input.focus();
        },
    };

    gantt.form_blocks.ay_assignees = {
        render: function (sns) {
            const options = assigneeOptions.map((name) => {
                const safe = String(name);
                return `<label class="gantt_assignee_option"><input type="checkbox" value="${safe}"><span>${safe}</span></label>`;
            }).join("");
            return `<div class="gantt_assignee_list" data-name="${sns.name}">${options}</div>`;
        },
        set_value: function (node, value) {
            const selected = normalizeAssignees(value)
                .split(",")
                .map((name) => name.trim())
                .filter(Boolean);
            const inputs = node.querySelectorAll("input[type='checkbox']");
            inputs.forEach((input) => {
                input.checked = selected.includes(input.value);
            });
        },
        get_value: function (node) {
            const inputs = node.querySelectorAll("input[type='checkbox']");
            const values = [];
            inputs.forEach((input) => {
                if (input.checked) values.push(input.value);
            });
            return values.join(", ");
        },
        focus: function (node) {
            const input = node.querySelector("input[type='checkbox']");
            if (input) input.focus();
        },
    };

    gantt.config.lightbox.sections = [
        { name: "description", height: 60, map_to: "text", type: "textarea", focus: true, label: "Descrizione" },
        { name: "time", type: "time", map_to: "auto", label: "Periodo previsto" },
        { name: "assignees", height: 80, map_to: "assignees", type: "ay_assignees", label: "Responsabili" },
        { name: "color", height: 38, map_to: "color", type: "ay_color", label: "Colore task" },
    ];

    gantt.attachEvent("onTaskLoading", (task) => {
        task.assignees = normalizeAssignees(task.assignees);
        if (task.color == null) task.color = "";
        return true;
    });

    gantt.attachEvent("onAfterTaskAdd", (id, task) => {
        task.assignees = normalizeAssignees(task.assignees);
        if (!task.color) {
            if (task.parent && task.parent !== 0) {
                const parent = gantt.getTask(task.parent);
                if (parent && parent.color) {
                    task.color = lightenColor(parent.color, 0.35);
                }
            }
            if (!task.color) {
                task.color = randomColor();
            }
        }
        if (task.parent) {
            syncParentRange(task.parent);
            updateParentProgressFrom(task.parent);
        }
        scheduleSave();
    });
    gantt.attachEvent("onAfterTaskUpdate", (id, task) => {
        if (task) {
            task.assignees = normalizeAssignees(task.assignees);
            if (task.parent) {
                syncParentRange(task.parent);
                updateParentProgressFrom(task.parent);
            }
            clampParentToChildren(task);
        }
        scheduleSave();
    });
    gantt.attachEvent("onAfterTaskDelete", () => {
        calculateAllParentsProgress();
        scheduleSave();
    });
    gantt.attachEvent("onTaskDrag", (id, mode) => {
        if (mode === "progress") {
            updateParentProgressFrom(id);
            return;
        }
        if (!gantt.$task) return;
        const scroll = gantt.getScrollState();
        const viewWidth = gantt.$task.offsetWidth || 0;
        const leftDate = gantt.dateFromPos(scroll.x);
        const rightDate = gantt.dateFromPos(scroll.x + viewWidth - 1);
        if (!leftDate || !rightDate) return;
        const thresholdMs = 2 * 24 * 60 * 60 * 1000;
        if (leftDate.getTime() - gantt.config.start_date.getTime() < thresholdMs) {
            extendTimelineRange(-1, leftDate);
        } else if (gantt.config.end_date.getTime() - rightDate.getTime() < thresholdMs) {
            extendTimelineRange(1, leftDate);
        }
    });
    gantt.attachEvent("onMouseMove", (id, e) => {
        if (!gantt.$task || gantt.getState().drag_id || e.buttons !== 1) return;
        const now = Date.now();
        if (now - timelineExtendCooldown < 30) return;
        timelineExtendCooldown = now;
        const scroll = gantt.getScrollState();
        const leftDate = gantt.dateFromPos(scroll.x);
        const rightDate = gantt.dateFromPos(scroll.x + gantt.$task.offsetWidth - 1);
        if (!leftDate || !rightDate) return;
        if (+leftDate <= +gantt.config.start_date) {
            extendTimelineRange(-1, leftDate);
        }
        if (+gantt.config.end_date < +gantt.date.add(rightDate, 1, "day")) {
            extendTimelineRange(1, leftDate);
        }
    });
    gantt.attachEvent("onGridClick", (id, e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return true;
        if (!target.classList.contains("ay-task-done")) return true;
        const taskId = target.getAttribute("data-task-id");
        if (!taskId) return true;
        const task = gantt.getTask(taskId);
        if (!task) return false;
        task.progress = target.checked ? 1 : 0;
        gantt.updateTask(task.id);
        updateParentProgressFrom(task.id);
        scheduleSave();
        return false;
    });
    gantt.attachEvent("onAfterLinkAdd", scheduleSave);
    gantt.attachEvent("onAfterLinkDelete", scheduleSave);
    gantt.attachEvent("onAfterLinkUpdate", scheduleSave);

    gantt.attachEvent("onDblClick", () => {
        const now = new Date();
        const task = {
            text: "Nuova task",
            start_date: now,
            end_date: addDays(now, 7),
            parent: 0,
        };
        const newId = gantt.addTask(task, 0);
        gantt.showLightbox(newId);
        return false;
    });

    gantt.attachEvent("onBeforeTaskChanged", (id, mode, task) => {
        task.assignees = normalizeAssignees(task.assignees);
        clampParentToChildren(task);
        return true;
    });

    gantt.config.open_split_tasks = true;
    gantt.attachEvent("onBeforeSplitTaskDisplay", (id, task, parent) => {
        if (task.$rendered_at != task.parent) {
            return false;
        }
        return true;
    });

    gantt.attachEvent("onLightboxSave", () => true);
}

function init() {
    if (!gantt) {
        showDialog("warning", "Gantt non disponibile.", "Controlla che dhtmlx-gantt sia installato.");
        return;
    }
    const assigneesData = loadAssigneeOptions();
    assigneeOptions = assigneesData.options;
    assigneeGroups = assigneesData.groups;
    configureGantt();
    const data = loadData();
    gantt.init("gantt_here");
    gantt.parse(data);
    syncAllParents();
    calculateAllParentsProgress();

    renderAssigneePanel();
    renderDepartmentList();
    renderEmployeesList();
    renderDepartmentSelect();
    applyAssigneePanelHeight();

    if (gantt.$grid) {
        gantt.$grid.addEventListener("change", (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            if (!target.classList.contains("ay-task-done")) return;
            const taskId = target.getAttribute("data-task-id");
            if (!taskId) return;
            const task = gantt.getTask(taskId);
            if (!task) return;
            task.progress = target.checked ? 1 : 0;
            gantt.updateTask(task.id);
            updateParentProgressFrom(task.id);
            scheduleSave();
        });
    }

    gantt.locale = gantt.locale || {};
    gantt.locale.labels = {
        ...gantt.locale.labels,
        new_task: "Nuova attivita",
        icon_save: "Salva",
        icon_cancel: "Annulla",
        icon_delete: "Elimina",
        confirm_closing: "",
        confirm_deleting: "Vuoi davvero eliminare questa attivita?",
    };
    gantt.locale.date = {
        month_full: [
            "Gennaio",
            "Febbraio",
            "Marzo",
            "Aprile",
            "Maggio",
            "Giugno",
            "Luglio",
            "Agosto",
            "Settembre",
            "Ottobre",
            "Novembre",
            "Dicembre",
        ],
        month_short: [
            "Gen",
            "Feb",
            "Mar",
            "Apr",
            "Mag",
            "Giu",
            "Lug",
            "Ago",
            "Set",
            "Ott",
            "Nov",
            "Dic",
        ],
        day_full: [
            "Domenica",
            "Lunedi",
            "Martedi",
            "Mercoledi",
            "Giovedi",
            "Venerdi",
            "Sabato",
        ],
        day_short: ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"],
    };

    gantt.config.scale_height = 70;
    gantt.config.min_column_width = 36;
    gantt.config.scales = [
        { unit: "year", step: 1, format: "%Y" },
        { unit: "month", step: 1, format: "%F" },
        { unit: "day", step: 1, format: "%d" },
    ];

    gantt.templates.date_grid = gantt.date.date_to_str("%d/%m/%Y");

    const today = new Date();
    gantt.config.start_date = new Date(today.getFullYear() - 1, 0, 1);
    gantt.config.end_date = new Date(today.getFullYear() + 2, 11, 31);
    gantt.render();
    updateRangeFromTasks();
    gantt.showDate(today);
    updateRangeFromTasks();

    gantt.addMarker({
        start_date: today,
        css: "today",
        text: "Oggi",
    });

    const showTodayBtn = document.getElementById("aypi-show-today");
    if (showTodayBtn) {
        showTodayBtn.addEventListener("click", () => {
            const now = new Date();
            const scroll = gantt.getScrollState();
            const centerOffset = gantt.$task ? gantt.$task.offsetWidth / 2 : 0;
            const x = gantt.posFromDate(now) - centerOffset;
            gantt.scrollTo(x, scroll.y);
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Delete") return;
        const target = event.target;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }
        const selectedId = gantt.getState().selected_task;
        if (!selectedId || !gantt.isTaskExists(selectedId)) return;
        if (!window.confirm("Vuoi davvero eliminare questa attivita?")) return;
        gantt.deleteTask(selectedId);
    });

    const manageBtn = document.getElementById("assignees-manage");
    const modal = document.getElementById("assignees-modal");
    const cancelBtn = document.getElementById("assignees-cancel");
    const departmentInput = document.getElementById("department-name");
    const departmentAdd = document.getElementById("department-add");
    const employeeNameInput = document.getElementById("employee-name");
    const employeeAdd = document.getElementById("employee-add");
    const resizer = document.getElementById("assignees-resizer");

    const closeModal = () => {
        if (!modal) return;
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
        if (departmentInput) departmentInput.value = "";
        if (employeeNameInput) employeeNameInput.value = "";
    };

    if (manageBtn && modal) {
        manageBtn.addEventListener("click", () => {
            modal.classList.add("is-open");
            modal.setAttribute("aria-hidden", "false");
            if (departmentInput) departmentInput.focus();
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener("click", closeModal);
    }

    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeModal();
        });
    }

    if (departmentAdd) {
        departmentAdd.addEventListener("click", () => {
            const name = departmentInput ? departmentInput.value.trim() : "";
            if (!name || assigneeGroups[name]) return;
            assigneeGroups[name] = [];
            assigneeOptions = Object.values(assigneeGroups).flat();
            saveAssigneeOptions(assigneeGroups);
            renderAssigneePanel();
            renderDepartmentList();
            renderDepartmentSelect();
            if (departmentInput) departmentInput.value = "";
        });
    }

    if (employeeAdd) {
        employeeAdd.addEventListener("click", () => {
            const select = document.getElementById("employee-department");
            const department = select ? select.value : "";
            const name = employeeNameInput ? employeeNameInput.value.trim() : "";
            if (!department || !name) return;
            if (!assigneeGroups[department]) assigneeGroups[department] = [];
            if (!assigneeGroups[department].includes(name)) {
                assigneeGroups[department].push(name);
                assigneeGroups[department].sort((a, b) => a.localeCompare(b));
            }
            assigneeOptions = Object.values(assigneeGroups).flat();
            saveAssigneeOptions(assigneeGroups);
            renderAssigneePanel();
            renderEmployeesList();
            if (employeeNameInput) employeeNameInput.value = "";
        });
    }

    if (resizer) {
        let startY = 0;
        let startHeight = assigneePanelHeight;
        const onMove = (event) => {
            const delta = startY - event.clientY;
            assigneePanelHeight = Math.min(360, Math.max(120, startHeight + delta));
            applyAssigneePanelHeight();
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
        resizer.addEventListener("mousedown", (event) => {
            startY = event.clientY;
            startHeight = assigneePanelHeight;
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        });
    }
}

document.addEventListener("DOMContentLoaded", init);
