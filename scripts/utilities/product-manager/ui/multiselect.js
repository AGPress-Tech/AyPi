function openMultiselectMenu(menu, trigger, host) {
    if (!menu) return;
    document.querySelectorAll(".pm-custom-select.is-open").forEach((wrapper) => {
        wrapper.classList.remove("is-open");
        const list = wrapper.querySelector(".pm-custom-select__list");
        if (list && list.dataset.pmFloating === "1") {
            list.style.position = "";
            list.style.left = "";
            list.style.top = "";
            list.style.width = "";
            list.style.maxHeight = "";
            list.dataset.pmFloating = "0";
        }
    });
    document.querySelectorAll(".pm-multiselect__menu--floating").forEach((menuEl) => {
        if (menuEl === menu) return;
        menuEl.classList.add("is-hidden");
        menuEl.classList.remove("pm-multiselect__menu--floating");
        menuEl.style.top = "";
        menuEl.style.left = "";
        menuEl.style.width = "";
        const hostId = menuEl.dataset.pmHostId || "";
        const hostEl = hostId ? document.querySelector(`[data-pm-host-id="${hostId}"]`) : null;
        if (hostEl && !hostEl.contains(menuEl)) {
            hostEl.appendChild(menuEl);
        }
    });
    const rect = trigger.getBoundingClientRect();
    menu.classList.remove("is-hidden");
    menu.classList.add("pm-multiselect__menu--floating");
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${rect.left}px`;
    menu.style.width = `${rect.width}px`;
    document.body.appendChild(menu);
    menu.dataset.pmHostId = host?.dataset?.pmHostId || "";
}

function closeMultiselectMenu(menu, host) {
    if (!menu) return;
    menu.classList.add("is-hidden");
    menu.classList.remove("pm-multiselect__menu--floating");
    menu.style.top = "";
    menu.style.left = "";
    menu.style.width = "";
    if (host && !host.contains(menu)) {
        host.appendChild(menu);
    }
}

module.exports = { openMultiselectMenu, closeMultiselectMenu };
