function openMultiselectMenu(menu, trigger, host) {
    if (!menu) return;
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
