function getWrapperId(selectEl) {
    return `${selectEl.id}-custom`;
}

function getElements(selectEl) {
    const doc = selectEl.ownerDocument || document;
    const wrapper = doc.getElementById(getWrapperId(selectEl));
    if (!wrapper) return null;
    return {
        wrapper,
        button: wrapper.querySelector(".pm-custom-select__button"),
        list: wrapper.querySelector(".pm-custom-select__list"),
    };
}

function closeSelect(wrapper) {
    if (!wrapper) return;
    wrapper.classList.remove("is-open");
}

function shouldFloat(selectEl) {
    return Boolean(selectEl?.closest("#pm-request-form"));
}

function clearFloating(list) {
    if (!list) return;
    list.style.position = "";
    list.style.left = "";
    list.style.top = "";
    list.style.width = "";
    list.style.maxHeight = "";
    list.dataset.pmFloating = "0";
}

function positionFloating(selectEl, list, wrapper) {
    if (!selectEl || !list || !wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const padding = 12;
    const spaceBelow = Math.max(120, window.innerHeight - rect.bottom - padding);
    list.style.position = "fixed";
    list.style.left = `${rect.left}px`;
    list.style.top = `${rect.bottom + 6}px`;
    list.style.width = `${rect.width}px`;
    list.style.maxHeight = `${spaceBelow}px`;
    list.dataset.pmFloating = "1";
}

function updateButton(selectEl, button) {
    if (!selectEl || !button) return;
    const selected = selectEl.selectedOptions?.[0];
    const label = selected && selected.value ? selected.textContent : selected?.textContent || "";
    button.textContent = label || "Seleziona";
    button.dataset.value = selected?.value || "";
    button.classList.toggle("is-placeholder", !selected || !selected.value);
    button.disabled = !!selectEl.disabled;
}

function syncCustomSelect(selectEl) {
    if (!selectEl || selectEl.dataset.pmCustomSelect !== "1") return;
    const elements = getElements(selectEl);
    if (!elements) return;
    const { list, button } = elements;
    if (!list) return;
    list.innerHTML = "";
    Array.from(selectEl.options).forEach((opt) => {
        const optionBtn = document.createElement("button");
        optionBtn.type = "button";
        optionBtn.className = "pm-custom-select__option";
        optionBtn.textContent = opt.textContent;
        optionBtn.dataset.value = opt.value;
        optionBtn.disabled = !!opt.disabled;
        if (opt.disabled) optionBtn.classList.add("is-disabled");
        if (opt.selected) optionBtn.classList.add("is-selected");
        optionBtn.addEventListener("click", () => {
            if (opt.disabled) return;
            selectEl.value = opt.value;
            selectEl.dispatchEvent(new Event("change", { bubbles: true }));
            updateButton(selectEl, button);
            Array.from(list.querySelectorAll(".pm-custom-select__option")).forEach((btn) => {
                btn.classList.toggle("is-selected", btn.dataset.value === opt.value);
            });
            closeSelect(elements.wrapper);
            clearFloating(list);
        });
        list.appendChild(optionBtn);
    });
    updateButton(selectEl, button);
}

let customSelectId = 0;

function ensureCustomSelect(selectEl) {
    if (!selectEl) return;
    if (!selectEl.id) {
        customSelectId += 1;
        selectEl.id = `pm-custom-select-${customSelectId}`;
    }
    if (selectEl.dataset.pmCustomSelect === "1") {
        syncCustomSelect(selectEl);
        return;
    }
    const doc = selectEl.ownerDocument || document;
    const wrapper = doc.createElement("div");
    wrapper.className = "pm-custom-select";
    wrapper.id = getWrapperId(selectEl);

    const button = doc.createElement("button");
    button.type = "button";
    button.className = "pm-custom-select__button";

    const list = doc.createElement("div");
    list.className = "pm-custom-select__list";
    list.setAttribute("role", "listbox");

    wrapper.appendChild(button);
    wrapper.appendChild(list);
    selectEl.classList.add("pm-custom-select__native");
    selectEl.dataset.pmCustomSelect = "1";
    selectEl.insertAdjacentElement("afterend", wrapper);

    const handleOpenChange = () => {
        const isOpen = wrapper.classList.contains("is-open");
        if (isOpen && shouldFloat(selectEl)) {
            positionFloating(selectEl, list, wrapper);
        } else {
            clearFloating(list);
        }
    };

    button.addEventListener("click", () => {
        wrapper.classList.toggle("is-open");
        handleOpenChange();
    });
    button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            wrapper.classList.toggle("is-open");
            handleOpenChange();
        }
        if (event.key === "Escape") {
            closeSelect(wrapper);
            handleOpenChange();
        }
    });
    doc.addEventListener("click", (event) => {
        if (wrapper.contains(event.target) || event.target === selectEl) return;
        closeSelect(wrapper);
        handleOpenChange();
    });

    const reposition = () => {
        if (!wrapper.classList.contains("is-open")) return;
        if (!shouldFloat(selectEl)) return;
        positionFloating(selectEl, list, wrapper);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    selectEl.addEventListener("change", () => {
        updateButton(selectEl, button);
        Array.from(list.querySelectorAll(".pm-custom-select__option")).forEach((optionBtn) => {
            optionBtn.classList.toggle("is-selected", optionBtn.dataset.value === selectEl.value);
        });
    });

    const observer = new MutationObserver(() => {
        syncCustomSelect(selectEl);
    });
    observer.observe(selectEl, { childList: true, subtree: true });

    syncCustomSelect(selectEl);
}

function initCustomSelects({ document, selector }) {
    if (!document || !selector) return;
    document.querySelectorAll(selector).forEach((selectEl) => {
        if (selectEl.dataset && selectEl.dataset.pmMultiselect === "1") return;
        ensureCustomSelect(selectEl);
    });
}

module.exports = {
    ensureCustomSelect,
    syncCustomSelect,
    initCustomSelects,
};
