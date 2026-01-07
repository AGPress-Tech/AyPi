const { ipcRenderer } = require("electron");
const { initCommonUI } = require("../../modules/utils");

initCommonUI();

window.addEventListener("DOMContentLoaded", () => {
    const timersList = document.getElementById("timersList");
    const timersEmpty = document.getElementById("timersEmpty");
    const addTimerBtn = document.getElementById("addTimerBtn");

    const dialogBackdrop = document.getElementById("newTimerDialog");
    const dialogTitle = document.getElementById("dialogTitle");
    const typeSelect = document.getElementById("timerType");
    const nameInput = document.getElementById("timerName");
    const hoursInput = document.getElementById("hoursInput");
    const minutesInput = document.getElementById("minutesInput");
    const secondsInput = document.getElementById("secondsInput");
    const timeRow = document.getElementById("timeRow");
    const timeInputsRow = document.getElementById("timeInputsRow");
    const cancelDialogBtn = document.getElementById("cancelDialogBtn");
    const confirmDialogBtn = document.getElementById("confirmDialogBtn");

    const openPresetsBtn = document.getElementById("openPresetsBtn");
    const presetsPanel = document.getElementById("presetsPanel");
    const presetsList = document.getElementById("presetsList");
    const closePresetsBtn = document.getElementById("closePresetsBtn");

    const timePresetButtons = Array.from(document.querySelectorAll(".time-preset"));
    const timeInputs = [hoursInput, minutesInput, secondsInput];

    const PRESETS_STORAGE_KEY = "aypi-timer-presets-v1";

    let timers = [];
    let nextId = 1;
    let editingTimerId = null;
    let presets = [];

    function updateEmptyState() {
        if (!timersList.children.length) {
            timersEmpty.style.display = "block";
        } else {
            timersEmpty.style.display = "none";
        }
    }

    function handleTypeChange() {
        const type = typeSelect.value;
        if (type === "stopwatch") {
            hoursInput.value = "0";
            minutesInput.value = "0";
            secondsInput.value = "0";
            if (timeInputsRow) timeInputsRow.style.display = "none";
        } else {
            if (timeInputsRow) timeInputsRow.style.display = "block";
        }
    }

    function openDialog(prefType, existingTimer) {
        if (existingTimer) {
            editingTimerId = existingTimer.id;
            if (dialogTitle) dialogTitle.textContent = "Modifica timer / cronometro";
            if (confirmDialogBtn) confirmDialogBtn.textContent = "Salva";

            typeSelect.value = existingTimer.type === "stopwatch" ? "stopwatch" : "timer";
            nameInput.value = existingTimer.name || "";

            if (existingTimer.type === "timer") {
                const total = existingTimer.initialSeconds || 0;
                const h = Math.floor(total / 3600);
                const m = Math.floor((total % 3600) / 60);
                const s = total % 60;
                hoursInput.value = String(h);
                minutesInput.value = String(m);
                secondsInput.value = String(s);
            } else {
                hoursInput.value = "0";
                minutesInput.value = "0";
                secondsInput.value = "0";
            }
        } else {
            editingTimerId = null;
            if (dialogTitle) dialogTitle.textContent = "Nuovo timer / cronometro";
            if (confirmDialogBtn) confirmDialogBtn.textContent = "Aggiungi";

            if (prefType) {
                typeSelect.value = prefType;
            } else {
                typeSelect.value = "timer";
            }
            nameInput.value = "";
            hoursInput.value = "0";
            minutesInput.value = "5";
            secondsInput.value = "0";
        }

        handleTypeChange();
        dialogBackdrop.classList.remove("hidden");
        nameInput.focus();
    }

    function openDialogFromPreset(preset) {
        editingTimerId = null;
        if (dialogTitle) dialogTitle.textContent = "Nuovo timer / cronometro";
        if (confirmDialogBtn) confirmDialogBtn.textContent = "Aggiungi";

        typeSelect.value = preset.type === "stopwatch" ? "stopwatch" : "timer";
        nameInput.value = preset.name || "";

        if (preset.type === "timer") {
            const total = preset.initialSeconds || 0;
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            hoursInput.value = String(h);
            minutesInput.value = String(m);
            secondsInput.value = String(s);
        } else {
            hoursInput.value = "0";
            minutesInput.value = "0";
            secondsInput.value = "0";
        }

        handleTypeChange();
        dialogBackdrop.classList.remove("hidden");
        nameInput.focus();
    }

    function closeDialog() {
        dialogBackdrop.classList.add("hidden");
    }

    function clampNumber(value, min, max, fallback) {
        const n = Number(value);
        if (Number.isNaN(n)) return fallback;
        return Math.min(Math.max(n, min), max);
    }

    function attachMouseWheelToTimeInputs() {
        timeInputs.forEach((input) => {
            if (!input) return;

            input.addEventListener("wheel", (event) => {
                event.preventDefault();

                const step = event.deltaY < 0 ? 1 : -1;
                const min = typeof input.min === "string" && input.min !== "" ? Number(input.min) : 0;
                const max = typeof input.max === "string" && input.max !== "" ? Number(input.max) : 59;

                const current = clampNumber(input.value, min, max, 0);
                let next = current + step;

                if (next > max) next = min;
                if (next < min) next = max;

                input.value = String(next);
            }, { passive: false });
        });
    }

    function loadPresets() {
        try {
            const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
            if (!raw) {
                presets = [];
                return;
            }
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                presets = parsed
                    .filter(p => p && typeof p.name === "string")
                    .map(p => ({
                        name: p.name,
                        type: p.type === "stopwatch" ? "stopwatch" : "timer",
                        initialSeconds: Number(p.initialSeconds) || 0,
                    }));
            } else {
                presets = [];
            }
        } catch {
            presets = [];
        }
    }

    function savePresets() {
        try {
            window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
        } catch {
            // ignora errori di storage
        }
    }

    function renderPresetsList() {
        if (!presetsList) return;

        presetsList.innerHTML = "";

        if (!presets.length) {
            const empty = document.createElement("div");
            empty.textContent = "Nessun preset salvato.";
            empty.style.color = "#d5ccc0";
            presetsList.appendChild(empty);
            return;
        }

        presets.forEach((preset, index) => {
            const item = document.createElement("div");
            item.className = "preset-item";

            const main = document.createElement("div");
            main.className = "preset-main";

            const nameEl = document.createElement("div");
            nameEl.className = "preset-name";
            nameEl.textContent = preset.name;

            const metaEl = document.createElement("div");
            metaEl.className = "preset-meta";
            const label = preset.type === "stopwatch" ? "Cronometro" : "Timer";
            const timeLabel = formatTime(preset.initialSeconds || 0);
            metaEl.textContent = `${label} · ${timeLabel}`;

            main.appendChild(nameEl);
            main.appendChild(metaEl);

            const actions = document.createElement("div");
            actions.className = "preset-actions";

            const useBtn = document.createElement("button");
            useBtn.type = "button";
            useBtn.className = "preset-use-btn";
            useBtn.textContent = "Usa";

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "preset-delete-btn";
            deleteBtn.textContent = "Elimina";

            useBtn.addEventListener("click", () => {
                presetsPanel.classList.add("hidden");

                const type = preset.type === "stopwatch" ? "stopwatch" : "timer";
                const name = preset.name || (type === "timer" ? `Timer ${nextId}` : `Cronometro ${nextId}`);
                let initialSeconds = type === "timer" ? (Number(preset.initialSeconds) || 0) : 0;

                const timer = {
                    id: nextId++,
                    type,
                    name,
                    initialSeconds,
                    currentSeconds: initialSeconds,
                    currentMs: initialSeconds * 1000,
                    running: false,
                    intervalId: null,
                    lastTickAt: null,
                    laps: [],
                    lapCount: 0,
                    checkpointCount: 0,
                };

                timers.push(timer);
                createTimerElement(timer);
            });

            deleteBtn.addEventListener("click", () => {
                presets.splice(index, 1);
                savePresets();
                renderPresetsList();
            });

            actions.appendChild(useBtn);
            actions.appendChild(deleteBtn);

            item.appendChild(main);
            item.appendChild(actions);

            presetsList.appendChild(item);
        });
    }

    function formatTime(totalSeconds) {
          const sign = totalSeconds < 0 ? "-" : "";
          const t = Math.max(0, Math.floor(Math.abs(totalSeconds)));
          const h = String(Math.floor(t / 3600)).padStart(2, "0");
          const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
          const s = String(t % 60).padStart(2, "0");
          return `${sign}${h}:${m}:${s}`;
      }

    function sendTrayUpdate() {
        const items = timers
            .filter(t => t && t.running)
            .map(t => ({
                name: (t.name || "").trim() || (t.type === "stopwatch" ? "Cronometro" : "Timer"),
                time: formatTime((t.currentMs || 0) / 1000),
            }));
        ipcRenderer.send("timers-tray-update", { items });
    }

    ipcRenderer.on("timers-tray-request", () => {
        syncRunningTimers();
        sendTrayUpdate();
    });

    function showTimerNotification(name) {
        const title = "AyPi - Timer terminato";
        const body = name ? `Il timer "${name}" è terminato.` : "Un timer è terminato.";
        if (!("Notification" in window)) return;

        if (Notification.permission === "granted") {
            new Notification(title, { body });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then((perm) => {
                if (perm === "granted") {
                    new Notification(title, { body });
                }
            });
        }
    }

    function syncRunningTimers() {
        const now = Date.now();
        let changed = false;

        timers.forEach(timer => {
            if (!timer || !timer.running) return;
            if (!timer.lastTickAt) {
                timer.lastTickAt = now;
                return;
            }
            const deltaMs = now - timer.lastTickAt;
            if (deltaMs <= 0) return;
            timer.lastTickAt = now;

            if (timer.type === "timer") {
                timer.currentMs = Math.max(0, (timer.currentMs || 0) - deltaMs);
            } else {
                timer.currentMs = (timer.currentMs || 0) + deltaMs;
            }
            timer.currentSeconds = Math.floor((timer.currentMs || 0) / 1000);
            changed = true;
        });

        if (!changed) return;
        timers.forEach(timer => {
            if (!timer) return;
            const card = timersList.querySelector(`.timer-card[data-id="${timer.id}"]`);
            if (!card) return;
            const display = card.querySelector(".timer-display");
            if (display) {
                display.textContent = formatTime(timer.currentSeconds || 0);
            }
            if (timer.type === "timer" && timer.currentMs <= 0 && timer.running) {
                timer.running = false;
                timer.lastTickAt = null;
                if (timer.intervalId != null) {
                    clearInterval(timer.intervalId);
                    timer.intervalId = null;
                }
                const startBtn = card.querySelector(".timer-controls button");
                if (startBtn) startBtn.textContent = "Avvia";
                card.classList.add("finished");
                showTimerNotification(timer.name);
            }
        });
        sendTrayUpdate();
    }

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            syncRunningTimers();
        }
    });

    window.addEventListener("focus", () => {
        syncRunningTimers();
    });

    function createTimerElement(timer) {
        const card = document.createElement("div");
        card.className = "timer-card";
        card.dataset.id = String(timer.id);

        const header = document.createElement("div");
        header.className = "timer-card-header";

        const title = document.createElement("p");
        title.className = "timer-name";
        title.textContent = timer.name;

        const badgeRow = document.createElement("div");
        badgeRow.className = "badge-row";

        const badge = document.createElement("span");
        badge.className = "timer-badge" + (timer.type === "stopwatch" ? " stopwatch" : "");
        badge.textContent = timer.type === "timer" ? "Timer" : "Cronometro";

          const addSmallBtn = document.createElement("button");
          addSmallBtn.className = "card-add-btn";
          addSmallBtn.type = "button";
          addSmallBtn.textContent = "+";
          addSmallBtn.title = "Salva come preset";

        badgeRow.appendChild(badge);
        badgeRow.appendChild(addSmallBtn);

        header.appendChild(title);
        header.appendChild(badgeRow);

        const display = document.createElement("div");
        display.className = "timer-display";
        display.textContent = formatTime((timer.currentMs || 0) / 1000);

        const controls = document.createElement("div");
        controls.className = "timer-controls";

        const startBtn = document.createElement("button");
        startBtn.type = "button";
        startBtn.textContent = "Avvia";

        let lapBtn = null;
        let checkpointBtn = null;
        if (timer.type === "stopwatch") {
            timer.lapCount = typeof timer.lapCount === "number" ? timer.lapCount : 0;
            timer.checkpointCount = typeof timer.checkpointCount === "number" ? timer.checkpointCount : 0;

            lapBtn = document.createElement("button");
            lapBtn.type = "button";
            lapBtn.textContent = "Giro";
            lapBtn.className = "secondary";

            checkpointBtn = document.createElement("button");
            checkpointBtn.type = "button";
            checkpointBtn.textContent = "Parziale";
            checkpointBtn.className = "secondary";
        }

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.textContent = "Modifica";
        editBtn.className = "secondary";

        const resetBtn = document.createElement("button");
        resetBtn.type = "button";
        resetBtn.textContent = "Reset";
        resetBtn.className = "secondary";

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.textContent = "Rimuovi";
        deleteBtn.className = "danger";

          controls.appendChild(startBtn);
          if (lapBtn) controls.appendChild(lapBtn);
          if (checkpointBtn) controls.appendChild(checkpointBtn);
          controls.appendChild(editBtn);
        controls.appendChild(resetBtn);
        controls.appendChild(deleteBtn);

        const lapsContainer = document.createElement("div");
        lapsContainer.className = "laps";
        if (timer.type !== "stopwatch") {
            lapsContainer.style.display = "none";
        }

        card.appendChild(header);
        card.appendChild(display);
        card.appendChild(controls);
        card.appendChild(lapsContainer);

        timersList.appendChild(card);
        updateEmptyState();

        function stopInterval() {
            if (timer.intervalId != null) {
                clearInterval(timer.intervalId);
                timer.intervalId = null;
            }
            timer.running = false;
            timer.lastTickAt = null;
            startBtn.textContent = "Avvia";
            sendTrayUpdate();
        }

        function markFinished() {
            card.classList.add("finished");
        }

        function clearFinished() {
            card.classList.remove("finished");
        }

        function tick() {
            if (!timer.running) return;
            const now = Date.now();
            if (!timer.lastTickAt) {
                timer.lastTickAt = now;
                return;
            }
            const deltaMs = now - timer.lastTickAt;
            if (deltaMs <= 0) return;
            timer.lastTickAt = now;

            if (timer.type === "timer") {
                const nextMs = (timer.currentMs || 0) - deltaMs;
                if (nextMs <= 0) {
                    timer.currentMs = 0;
                    timer.currentSeconds = 0;
                    display.textContent = formatTime(0);
                    markFinished();
                    showTimerNotification(timer.name);
                    stopInterval();
                    return;
                }
                timer.currentMs = nextMs;
            } else {
                timer.currentMs = (timer.currentMs || 0) + deltaMs;
            }

            timer.currentSeconds = Math.floor((timer.currentMs || 0) / 1000);
            display.textContent = formatTime(timer.currentSeconds);
        }

        function addLapItem(label, timeSeconds) {
            const item = document.createElement("div");
            item.className = "lap-item";
            item.innerHTML = `<span>${label}</span><span>${formatTime(timeSeconds)}</span>`;
            lapsContainer.prepend(item);
            while (lapsContainer.children.length > 20) {
                lapsContainer.removeChild(lapsContainer.lastChild);
            }
        }

        startBtn.addEventListener("click", () => {
            if (!timer.running) {
                clearFinished();
                timer.running = true;
                timer.lastTickAt = Date.now();
                startBtn.textContent = "Pausa";
                if (timer.intervalId == null) {
                    timer.intervalId = setInterval(tick, 250);
                }
            } else {
                stopInterval();
            }
            sendTrayUpdate();
        });

        resetBtn.addEventListener("click", () => {
            stopInterval();
            clearFinished();
            timer.currentSeconds = timer.initialSeconds;
            timer.currentMs = timer.initialSeconds * 1000;
            display.textContent = formatTime(timer.currentSeconds);
            if (timer.type === "stopwatch") {
                timer.laps = [];
                timer.lapCount = 0;
                timer.checkpointCount = 0;
                lapsContainer.innerHTML = "";
            }
            sendTrayUpdate();
        });

        deleteBtn.addEventListener("click", () => {
            stopInterval();
            card.remove();
            timers = timers.filter(t => t.id !== timer.id);
            updateEmptyState();
            sendTrayUpdate();
        });

        if (lapBtn) {
            lapBtn.addEventListener("click", () => {
                if (!timer.running) return;
                const lapTimeMs = timer.currentMs || 0;
                timer.laps.push({ type: "lap", time: lapTimeMs });
                timer.lapCount += 1;
                addLapItem(`Giro ${timer.lapCount}`, lapTimeMs / 1000);
                timer.currentMs = 0;
                timer.currentSeconds = 0;
                timer.lastTickAt = Date.now();
                display.textContent = formatTime(0);
            });
        }

        if (checkpointBtn) {
            checkpointBtn.addEventListener("click", () => {
                if (!timer.running) return;
                const checkpointTimeMs = timer.currentMs || 0;
                timer.laps.push({ type: "checkpoint", time: checkpointTimeMs });
                timer.checkpointCount += 1;
                addLapItem(`Parziale ${timer.checkpointCount}`, checkpointTimeMs / 1000);
            });
        }

        editBtn.addEventListener("click", () => {
            stopInterval();
            clearFinished();
            openDialog(null, timer);
            sendTrayUpdate();
        });

        addSmallBtn.addEventListener("click", () => {
            const baseName = (timer.name || "").trim();
            if (!baseName) {
                alert("Dai un nome al timer prima di salvarlo come preset.");
                return;
            }
            if (timer.type === "timer" && (!timer.initialSeconds || timer.initialSeconds <= 0)) {
                alert("Imposta un tempo iniziale maggiore di 0 per salvare il preset.");
                return;
            }

            const preset = {
                name: baseName,
                type: timer.type,
                initialSeconds: timer.initialSeconds || 0,
            };

            const existingIndex = presets.findIndex(p => p.name === preset.name);
            if (existingIndex !== -1) {
                const oldPreset = presets[existingIndex];
                const oldLabel = `${oldPreset.type === "stopwatch" ? "Cronometro" : "Timer"} · ${formatTime(oldPreset.initialSeconds || 0)}`;
                const newLabel = `${preset.type === "stopwatch" ? "Cronometro" : "Timer"} · ${formatTime(preset.initialSeconds || 0)}`;
                const message = [
                    `Esiste già un preset chiamato "${preset.name}".`,
                    "",
                    `Attuale: ${oldLabel}`,
                    `Nuovo:   ${newLabel}`,
                    "",
                    "Vuoi sostituirlo?"
                ].join("\n");

                const replace = window.confirm(message);
                if (!replace) {
                    return;
                }

                presets[existingIndex] = preset;
            } else {
                presets.push(preset);
            }

            savePresets();
            renderPresetsList();
            alert(`Preset "${preset.name}" è stato salvato.`);
        });
    }

    function handleConfirmDialog() {
        const type = typeSelect.value === "stopwatch" ? "stopwatch" : "timer";
        let name = (nameInput.value || "").trim();

        const h = clampNumber(hoursInput.value, 0, 99, 0);
        const m = clampNumber(minutesInput.value, 0, 59, 0);
        const s = clampNumber(secondsInput.value, 0, 59, 0);

        let totalSeconds = h * 3600 + m * 60 + s;

        if (type === "timer" && totalSeconds <= 0) {
            alert("Per un timer imposta almeno 1 secondo.");
            return;
        }

        if (type === "stopwatch") {
            totalSeconds = 0;
        }

        if (!name) {
            name = type === "timer" ? `Timer ${nextId}` : `Cronometro ${nextId}`;
        }

        if (editingTimerId != null) {
            const idx = timers.findIndex(t => t.id === editingTimerId);
            if (idx !== -1) {
                const timer = timers[idx];
                if (timer.intervalId != null) {
                    clearInterval(timer.intervalId);
                    timer.intervalId = null;
                }
                timer.running = false;
                timer.type = type;
                timer.name = name;
                timer.initialSeconds = totalSeconds;
                timer.currentSeconds = totalSeconds;
                timer.currentMs = totalSeconds * 1000;
                timer.laps = [];
                timer.lapCount = 0;
                timer.checkpointCount = 0;
                timer.lastTickAt = null;

                const existingCard = timersList.querySelector(`.timer-card[data-id="${timer.id}"]`);
                if (existingCard) existingCard.remove();

                createTimerElement(timer);
            }
            editingTimerId = null;
            closeDialog();
        } else {
            const timer = {
                id: nextId++,
                type,
                name,
                initialSeconds: totalSeconds,
                currentSeconds: totalSeconds,
                currentMs: totalSeconds * 1000,
                running: false,
                intervalId: null,
                lastTickAt: null,
                laps: [],
                lapCount: 0,
                checkpointCount: 0,
            };

            timers.push(timer);
            createTimerElement(timer);
            closeDialog();
            sendTrayUpdate();
        }
    }

    addTimerBtn.addEventListener("click", () => openDialog());

    typeSelect.addEventListener("change", handleTypeChange);

    attachMouseWheelToTimeInputs();

    timePresetButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const secondsFromData = Number(btn.dataset.seconds || "");
            const minutesFromData = Number(btn.dataset.minutes || "");
            const deltaSeconds = Number.isFinite(secondsFromData)
                ? secondsFromData
                : (Number.isFinite(minutesFromData) ? minutesFromData * 60 : 0);

            const h = clampNumber(hoursInput.value, 0, 99, 0);
            const m = clampNumber(minutesInput.value, 0, 59, 0);
            const s = clampNumber(secondsInput.value, 0, 59, 0);
            let total = h * 3600 + m * 60 + s + deltaSeconds;
            if (total < 0) total = 0;
            const newH = Math.floor(total / 3600);
            const newM = Math.floor((total % 3600) / 60);
            const newS = total % 60;
            hoursInput.value = String(newH);
            minutesInput.value = String(newM);
            secondsInput.value = String(newS);
        });
    });

    if (openPresetsBtn && presetsPanel && presetsList && closePresetsBtn) {
        openPresetsBtn.addEventListener("click", () => {
            renderPresetsList();
            presetsPanel.classList.remove("hidden");
        });

        closePresetsBtn.addEventListener("click", () => {
            presetsPanel.classList.add("hidden");
        });

        presetsPanel.addEventListener("click", (event) => {
            if (event.target === presetsPanel) {
                presetsPanel.classList.add("hidden");
            }
        });
    }

    cancelDialogBtn.addEventListener("click", closeDialog);
    confirmDialogBtn.addEventListener("click", handleConfirmDialog);

    dialogBackdrop.addEventListener("click", (event) => {
        if (event.target === dialogBackdrop) {
            closeDialog();
        }
    });

    loadPresets();
    updateEmptyState();
    sendTrayUpdate();
});
