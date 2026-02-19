function getWrapperId(selectEl) {
    return `${selectEl.id}-custom`;
}

function getElements(selectEl) {
    const doc = selectEl.ownerDocument || document;
    const wrapper = doc.getElementById(getWrapperId(selectEl));
    if (!wrapper) return null;
    return {
        wrapper,
        button: wrapper.querySelector(".fp-custom-select__button"),
        list: wrapper.querySelector(".fp-custom-select__list"),
    };
}

function closeSelect(wrapper) {
    if (!wrapper) return;
    wrapper.classList.remove("is-open");
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
    if (!selectEl || selectEl.dataset.fpCustomSelect !== "1") return;
    const elements = getElements(selectEl);
    if (!elements) return;
    const { list, button } = elements;
    if (!list) return;
    list.innerHTML = "";
    Array.from(selectEl.options).forEach((opt) => {
        const optionBtn = document.createElement("button");
        optionBtn.type = "button";
        optionBtn.className = "fp-custom-select__option";
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
            Array.from(list.querySelectorAll(".fp-custom-select__option")).forEach((btn) => {
                btn.classList.toggle("is-selected", btn.dataset.value === opt.value);
            });
            closeSelect(elements.wrapper);
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
        selectEl.id = `fp-custom-select-${customSelectId}`;
    }
    if (selectEl.dataset.fpCustomSelect === "1") {
        syncCustomSelect(selectEl);
        return;
    }
    const doc = selectEl.ownerDocument || document;
    const wrapper = doc.createElement("div");
    wrapper.className = "fp-custom-select";
    wrapper.id = getWrapperId(selectEl);

    const button = doc.createElement("button");
    button.type = "button";
    button.className = "fp-custom-select__button";

    const list = doc.createElement("div");
    list.className = "fp-custom-select__list";
    list.setAttribute("role", "listbox");

    wrapper.appendChild(button);
    wrapper.appendChild(list);
    selectEl.classList.add("fp-custom-select__native");
    selectEl.dataset.fpCustomSelect = "1";
    selectEl.insertAdjacentElement("afterend", wrapper);

    button.addEventListener("click", () => {
        wrapper.classList.toggle("is-open");
    });
    button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            wrapper.classList.toggle("is-open");
        }
        if (event.key === "Escape") {
            closeSelect(wrapper);
        }
    });
    doc.addEventListener("click", (event) => {
        if (wrapper.contains(event.target) || event.target === selectEl) return;
        closeSelect(wrapper);
    });

    selectEl.addEventListener("change", () => {
        updateButton(selectEl, button);
        Array.from(list.querySelectorAll(".fp-custom-select__option")).forEach((optionBtn) => {
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
        if (selectEl.dataset && selectEl.dataset.fpCustomSelect === "1") return;
        ensureCustomSelect(selectEl);
    });
}

module.exports = {
    ensureCustomSelect,
    syncCustomSelect,
    initCustomSelects,
};
