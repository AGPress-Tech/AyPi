require("../../../shared/dev-guards");
import { UI_TEXTS } from "../utils/ui-texts";

type ClosureEntry = { start: string; end?: string; name?: string };
type ClosuresPayload = { closures?: Array<ClosureEntry | string> };

type ClosuresModalOptions = {
    document: Document;
    showModal: (el: HTMLElement | null) => void;
    hideModal: (el: HTMLElement | null) => void;
    setMessage: (el: HTMLElement | null, message: string, isError?: boolean) => void;
    syncData: (updater: (payload: any) => any) => any;
    renderAll: (data: any) => void;
    loadData: () => any;
    openPasswordModal: (payload: any) => void;
    requireDaysAccess: (run: () => void) => void;
    confirmAction?: (message: string) => Promise<boolean>;
};

function createClosuresModal(options: ClosuresModalOptions) {
    const {
        document,
        showModal,
        hideModal,
        setMessage,
        syncData,
        renderAll,
        loadData,
        openPasswordModal,
        requireDaysAccess,
        confirmAction,
    } = options || ({} as ClosuresModalOptions);

    if (!document) {
        throw new Error("document richiesto.");
    }

    const confirm =
        typeof confirmAction === "function" ? confirmAction : async () => true;

    let editingKey: string | null = null;
    let highlightDate: string | null = null;

    function isDateInRange(date: string, entry: ClosureEntry) {
        if (!date || !entry) return false;
        const start = entry.start || "";
        const end = entry.end || entry.start || "";
        if (!start) return false;
        const from = start <= end ? start : end;
        const to = start <= end ? end : start;
        return date >= from && date <= to;
    }

    function normalizeClosures(payload: ClosuresPayload) {
        const closures = Array.isArray(payload?.closures)
            ? payload.closures.slice()
            : [];
        return closures
            .map((item) => {
                if (!item) return null;
                if (typeof item === "string") {
                    return { start: item, end: item, name: "" };
                }
                const start = typeof item.start === "string" ? item.start : "";
                const end = typeof item.end === "string" ? item.end : start;
                return { start, end: end || start, name: item.name || "" };
            })
            .filter(Boolean) as ClosureEntry[];
    }

    function buildKey(entry: ClosureEntry) {
        const start = entry?.start || "";
        const end = entry?.end || entry?.start || "";
        return `${start}|${end}`;
    }

    function renderClosureList(payload: ClosuresPayload, options: { containerId?: string; futureOnly?: boolean } = {}) {
        const listId = options.containerId || "fp-closures-future-list";
        const list = document.getElementById(listId);
        if (!list) return;
        list.innerHTML = "";
        const normalized = normalizeClosures(payload);
        const today = new Date();
        const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
            today.getDate(),
        ).padStart(2, "0")}`;
        const filtered = normalized
            .filter((item) => {
                if (!options.futureOnly) return true;
                const endKey = item.end || item.start;
                return endKey >= todayKey;
            })
            .sort((a, b) => (a.start || "").localeCompare(b.start || ""));
        if (!filtered.length) {
            const empty = document.createElement("div");
            empty.className = "fp-message";
            empty.textContent = UI_TEXTS.closureNone;
            list.appendChild(empty);
            return;
        }
        filtered.forEach((entry) => {
            const row = document.createElement("div");
            row.className = "fp-holidays-row";
            if (highlightDate && isDateInRange(highlightDate, entry)) {
                row.classList.add("is-highlight");
            }

            let label = document.createElement("div");
            label.className = "fp-holidays-row__info";
            const title = document.createElement("div");
            title.className = "fp-holidays-row__name";
            title.textContent = entry.name || "Chiusura azienda";
            const dateLine = document.createElement("div");
            dateLine.className = "fp-holidays-row__date";
            const endLabel =
                entry.end && entry.end !== entry.start ? ` - ${entry.end}` : "";
            dateLine.textContent = `${entry.start}${endLabel}`;
            label.appendChild(title);
            label.appendChild(dateLine);

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "fp-btn fp-btn--ghost";
            remove.textContent = "Rimuovi";
            remove.addEventListener("click", () => {
                const run = async () => {
                    const ok = await confirm(
                        "Confermi la rimozione della chiusura?",
                    );
                    if (!ok) return;
                    if (typeof openPasswordModal === "function") {
                        openPasswordModal({
                            type: "closure-remove",
                            id: buildKey(entry),
                            title: "Rimuovi chiusura",
                            description: UI_TEXTS.closurePasswordDescription,
                            entry,
                        });
                    }
                };
                if (typeof requireDaysAccess === "function") {
                    requireDaysAccess(() => {
                        run();
                    });
                    return;
                }
                run();
            });

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "fp-btn";
            edit.textContent = "Modifica";
            edit.addEventListener("click", () => {
                const run = () => {
                    editingKey = buildKey(entry);
                    renderClosureList(payload, options);
                };
                if (typeof requireDaysAccess === "function") {
                    requireDaysAccess(run);
                    return;
                }
                run();
            });

            if (editingKey === buildKey(entry)) {
                const wrapper = document.createElement("div");
                wrapper.className = "fp-holidays-row__edit";
                const nameInput = document.createElement("input");
                nameInput.type = "text";
                nameInput.className = "fp-field__input";
                nameInput.placeholder = "Nome chiusura";
                nameInput.value = entry.name || "";
                const startInput = document.createElement("input");
                startInput.type = "date";
                startInput.className = "fp-field__input";
                startInput.value = entry.start || "";
                const endInput = document.createElement("input");
                endInput.type = "date";
                endInput.className = "fp-field__input";
                endInput.value = entry.end || entry.start || "";
                wrapper.appendChild(nameInput);
                wrapper.appendChild(startInput);
                wrapper.appendChild(endInput);
                label = wrapper;
            }

            const actions = document.createElement("div");
            actions.className = "fp-assignees-row__actions";
            if (editingKey === buildKey(entry)) {
                const saveBtn = document.createElement("button");
                saveBtn.type = "button";
                saveBtn.className = "fp-btn fp-btn--primary";
                saveBtn.textContent = "Salva";
                saveBtn.addEventListener("click", async () => {
                    const inputs = row.querySelectorAll("input");
                    const nameInput = inputs[0] as HTMLInputElement | undefined;
                    const startInput = inputs[1] as HTMLInputElement | undefined;
                    const endInput = inputs[2] as HTMLInputElement | undefined;
                    const startValue = startInput ? startInput.value : "";
                    const endValue = endInput ? endInput.value : "";
                    const nameValue = nameInput ? nameInput.value.trim() : "";
                    if (!startValue) {
                        setMessage(
                            document.getElementById("fp-closures-message"),
                            UI_TEXTS.closureInvalidDate,
                            true,
                        );
                        return;
                    }
                    if (endValue && endValue < startValue) {
                        setMessage(
                            document.getElementById("fp-closures-message"),
                            UI_TEXTS.closureRangeInvalid,
                            true,
                        );
                        return;
                    }
                    const run = async () => {
                        const ok = await confirm(
                            "Confermi la modifica della chiusura?",
                        );
                        if (!ok) return;
                        if (typeof openPasswordModal === "function") {
                            openPasswordModal({
                                type: "closure-update",
                                id: buildKey(entry),
                                title: "Modifica chiusura",
                                description:
                                    UI_TEXTS.closurePasswordDescription,
                                entry,
                                next: {
                                    start: startValue,
                                    end: endValue || startValue,
                                    name: nameValue,
                                },
                            });
                        }
                        editingKey = null;
                    };
                    if (typeof requireDaysAccess === "function") {
                        requireDaysAccess(() => {
                            run();
                        });
                        return;
                    }
                    run();
                });

                const cancelBtn = document.createElement("button");
                cancelBtn.type = "button";
                cancelBtn.className = "fp-btn fp-btn--ghost";
                cancelBtn.textContent = "Annulla";
                cancelBtn.addEventListener("click", () => {
                    editingKey = null;
                    renderClosureList(payload, options);
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

    function openClosuresModal() {
        const modal = document.getElementById("fp-closures-modal") as HTMLElement | null;
        const message = document.getElementById("fp-closures-message") as HTMLElement | null;
        const nameInput = document.getElementById("fp-closures-name") as HTMLInputElement | null;
        const startInput = document.getElementById("fp-closures-start") as HTMLInputElement | null;
        const endInput = document.getElementById("fp-closures-end") as HTMLInputElement | null;
        if (!modal) return;
        editingKey = null;
        if (nameInput) nameInput.value = "";
        if (startInput) startInput.value = "";
        if (endInput) endInput.value = "";
        setMessage(message, "");
        showModal(modal);
    }

    function openClosuresListModal(dateToHighlight?: string) {
        const modal = document.getElementById("fp-closures-list-modal") as HTMLElement | null;
        if (!modal) return;
        editingKey = null;
        highlightDate = dateToHighlight || null;
        const data = loadData();
        renderClosureList(data, {
            containerId: "fp-closures-future-list",
            futureOnly: true,
        });
        if (highlightDate) {
            const target = document.querySelector(
                ".fp-holidays-row.is-highlight",
            );
            if (target) {
                target.scrollIntoView({ block: "nearest" });
            }
        }
        showModal(modal);
    }

    function closeClosuresModal() {
        const modal = document.getElementById("fp-closures-modal") as HTMLElement | null;
        if (!modal) return;
        hideModal(modal);
    }

    function initClosuresModal() {
        const openBtn = document.getElementById("fp-closures-manage") as HTMLButtonElement | null;
        const listOpenBtn = document.getElementById("fp-closures-list-open") as HTMLButtonElement | null;
        const listCloseBtn = document.getElementById("fp-closures-list-close") as HTMLButtonElement | null;
        const closeBtn = document.getElementById("fp-closures-close") as HTMLButtonElement | null;
        const addBtn = document.getElementById("fp-closures-add") as HTMLButtonElement | null;
        const nameInput = document.getElementById("fp-closures-name") as HTMLInputElement | null;
        const startInput = document.getElementById("fp-closures-start") as HTMLInputElement | null;
        const endInput = document.getElementById("fp-closures-end") as HTMLInputElement | null;
        const message = document.getElementById("fp-closures-message") as HTMLElement | null;
        const modal = document.getElementById("fp-closures-modal") as HTMLElement | null;

        if (openBtn) {
            openBtn.addEventListener("click", () => {
                openClosuresModal();
            });
        }
        if (listOpenBtn) {
            listOpenBtn.addEventListener("click", () => {
                if (typeof requireDaysAccess === "function") {
                    requireDaysAccess(() => openClosuresListModal());
                } else {
                    openClosuresListModal();
                }
            });
        }
        if (listCloseBtn) {
            listCloseBtn.addEventListener("click", () => {
                const listModal = document.getElementById(
                    "fp-closures-list-modal",
                );
                if (listModal) hideModal(listModal);
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                closeClosuresModal();
            });
        }
        if (modal) {
            modal.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }
        if (addBtn) {
            addBtn.addEventListener("click", () => {
                const startValue = startInput ? startInput.value : "";
                const endValue = endInput ? endInput.value : "";
                const nameValue = nameInput ? nameInput.value.trim() : "";
                if (!startValue) {
                    setMessage(message, UI_TEXTS.closureInvalidDate, true);
                    return;
                }
                if (endValue && endValue < startValue) {
                    setMessage(message, UI_TEXTS.closureRangeInvalid, true);
                    return;
                }
                if (typeof openPasswordModal === "function") {
                    openPasswordModal({
                        type: "closure-create",
                        id: "closure-create",
                        title: "Conferma chiusura",
                        description: UI_TEXTS.closurePasswordDescription,
                        entry: {
                            start: startValue,
                            end: endValue || startValue,
                            name: nameValue,
                        },
                    });
                }
            });
        }
    }

    return {
        initClosuresModal,
        renderClosureList,
        openClosuresModal,
        openClosuresListModal,
    };
}

export { createClosuresModal };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { createClosuresModal };
}


