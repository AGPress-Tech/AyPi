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

    const timePresetButtons = Array.from(document.querySelectorAll(".time-preset"));

    let timers = [];
    let nextId = 1;
    let editingTimerId = null;

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

    function closeDialog() {
        dialogBackdrop.classList.add("hidden");
    }

    function clampNumber(value, min, max, fallback) {
        const n = Number(value);
        if (Number.isNaN(n)) return fallback;
        return Math.min(Math.max(n, min), max);
    }

      function formatTime(totalSeconds) {
          const sign = totalSeconds < 0 ? "-" : "";
          const t = Math.max(0, Math.floor(Math.abs(totalSeconds)));
          const h = String(Math.floor(t / 3600)).padStart(2, "0");
          const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
          const s = String(t % 60).padStart(2, "0");
          return `${sign}${h}:${m}:${s}`;
      }

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
        addSmallBtn.title = "Aggiungi un nuovo timer/cronometro";

        badgeRow.appendChild(badge);
        badgeRow.appendChild(addSmallBtn);

        header.appendChild(title);
        header.appendChild(badgeRow);

        const display = document.createElement("div");
        display.className = "timer-display";
        display.textContent = formatTime(timer.currentSeconds);

        const controls = document.createElement("div");
        controls.className = "timer-controls";

        const startBtn = document.createElement("button");
        startBtn.type = "button";
        startBtn.textContent = "Avvia";

        let lapBtn = null;
        if (timer.type === "stopwatch") {
            lapBtn = document.createElement("button");
            lapBtn.type = "button";
            lapBtn.textContent = "Lap";
            lapBtn.className = "secondary";
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
            startBtn.textContent = "Avvia";
        }

        function markFinished() {
            card.classList.add("finished");
        }

        function clearFinished() {
            card.classList.remove("finished");
        }

        function tick() {
            if (!timer.running) return;

            if (timer.type === "timer") {
                if (timer.currentSeconds <= 0) {
                    stopInterval();
                    timer.currentSeconds = 0;
                    display.textContent = formatTime(timer.currentSeconds);
                    markFinished();
                    showTimerNotification(timer.name);
                    return;
                }
                timer.currentSeconds -= 1;
            } else {
                timer.currentSeconds += 1;
            }

            display.textContent = formatTime(timer.currentSeconds);
        }

        startBtn.addEventListener("click", () => {
            if (!timer.running) {
                clearFinished();
                timer.running = true;
                startBtn.textContent = "Pausa";
                if (timer.intervalId == null) {
                    timer.intervalId = setInterval(tick, 1000);
                }
            } else {
                stopInterval();
            }
        });

        resetBtn.addEventListener("click", () => {
            stopInterval();
            clearFinished();
            timer.currentSeconds = timer.initialSeconds;
            display.textContent = formatTime(timer.currentSeconds);
            if (timer.type === "stopwatch") {
                timer.laps = [];
                lapsContainer.innerHTML = "";
            }
        });

        deleteBtn.addEventListener("click", () => {
            stopInterval();
            card.remove();
            timers = timers.filter(t => t.id !== timer.id);
            updateEmptyState();
        });

        addSmallBtn.addEventListener("click", () => {
            openDialog();
        });

        if (lapBtn) {
            lapBtn.addEventListener("click", () => {
                if (!timer.running) return;
                const lapTime = timer.currentSeconds;
                timer.laps.push(lapTime);
                const index = timer.laps.length;
                const item = document.createElement("div");
                item.className = "lap-item";
                item.innerHTML = `<span>Lap ${index}</span><span>${formatTime(lapTime)}</span>`;
                lapsContainer.prepend(item);
                while (lapsContainer.children.length > 20) {
                    lapsContainer.removeChild(lapsContainer.lastChild);
                }
            });
        }

        editBtn.addEventListener("click", () => {
            stopInterval();
            clearFinished();
            openDialog(null, timer);
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
                timer.laps = [];

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
                running: false,
                intervalId: null,
                laps: [],
            };

            timers.push(timer);
            createTimerElement(timer);
            closeDialog();
        }
    }

    addTimerBtn.addEventListener("click", () => openDialog());

    typeSelect.addEventListener("change", handleTypeChange);

    timePresetButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const minutesToAdd = Number(btn.dataset.minutes || "0");
            const h = clampNumber(hoursInput.value, 0, 99, 0);
            const m = clampNumber(minutesInput.value, 0, 59, 0);
            const s = clampNumber(secondsInput.value, 0, 59, 0);
            let total = h * 3600 + m * 60 + s + minutesToAdd * 60;
            if (total < 0) total = 0;
            const newH = Math.floor(total / 3600);
            const newM = Math.floor((total % 3600) / 60);
            const newS = total % 60;
            hoursInput.value = String(newH);
            minutesInput.value = String(newM);
            secondsInput.value = String(newS);
        });
    });
    cancelDialogBtn.addEventListener("click", closeDialog);
    confirmDialogBtn.addEventListener("click", handleConfirmDialog);

    dialogBackdrop.addEventListener("click", (event) => {
        if (event.target === dialogBackdrop) {
            closeDialog();
        }
    });

    updateEmptyState();
});
