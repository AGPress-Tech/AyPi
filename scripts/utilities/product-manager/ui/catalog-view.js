function renderCatalog({
    document,
    shell,
    isAdmin,
    catalogItems,
    catalogFilterTag,
    catalogSearch,
    catalogSort,
    toTags,
    getCatalogImageSrc,
    PLACEHOLDER_IMAGE,
    openImageModal,
    applyCategoryColor,
    addLineFromCatalog,
    requireLogin,
    showWarning,
    openConfirmModal,
    saveCatalog,
    setCatalogItems,
    rerenderCatalog,
    openCatalogModal,
}) {
    const grid = document.getElementById("pm-catalog-grid");
    const addBtnHeader = document.getElementById("pm-catalog-add");
    if (addBtnHeader) {
        addBtnHeader.style.display = isAdmin() ? "inline-flex" : "none";
    }
    if (!grid) return;
    grid.innerHTML = "";
    if (!catalogItems.length) {
        grid.innerHTML = "<div class=\"pm-message\">Nessun prodotto a catalogo.</div>";
        return;
    }
    const activeTags = Array.isArray(catalogFilterTag)
        ? catalogFilterTag.filter(Boolean)
        : catalogFilterTag
        ? [catalogFilterTag]
        : [];
    let visibleItems = activeTags.length
        ? catalogItems.filter((item) => {
              const tags = toTags(item.category || "");
              return activeTags.some((tag) => tags.includes(tag));
          })
        : catalogItems;
    if (catalogSearch) {
        const needle = catalogSearch.toLowerCase();
        visibleItems = visibleItems.filter((item) => {
            const haystack = `${item.name || ""} ${item.description || ""} ${item.category || ""}`.toLowerCase();
            return haystack.includes(needle);
        });
    }
    visibleItems = [...visibleItems].sort((a, b) => {
        if (catalogSort === "created_desc") return String(b.createdAt).localeCompare(String(a.createdAt));
        if (catalogSort === "created_asc") return String(a.createdAt).localeCompare(String(b.createdAt));
        if (catalogSort === "name_desc") return String(b.name || "").localeCompare(String(a.name || ""));
        return String(a.name || "").localeCompare(String(b.name || ""));
    });
    if (!visibleItems.length) {
        grid.innerHTML = "<div class=\"pm-message\">Nessun prodotto per questa categoria.</div>";
        return;
    }
    visibleItems.forEach((item) => {
        const card = document.createElement("div");
        card.className = "pm-catalog-card";
        if (isAdmin()) {
            card.addEventListener("dblclick", () => openCatalogModal(item));
        }
        const imageSrc = getCatalogImageSrc(item);
        const img = document.createElement("img");
        img.className = "pm-catalog-image";
        img.alt = item.name || "Prodotto";
        img.src = imageSrc || PLACEHOLDER_IMAGE;
        img.addEventListener("click", () =>
            openImageModal(imageSrc || PLACEHOLDER_IMAGE, "", item.name || "Prodotto")
        );
        const title = document.createElement("div");
        title.className = "pm-catalog-title";
        title.textContent = item.name || "Prodotto";
        const desc = document.createElement("div");
        desc.className = "pm-catalog-desc";
        desc.textContent = item.description || "";
        const linkRow = document.createElement("a");
        linkRow.className = "pm-link";
        linkRow.textContent = item.url ? "Apri link" : "";
        linkRow.href = item.url || "#";
        if (item.url) {
            linkRow.addEventListener("click", (event) => {
                event.preventDefault();
                if (shell && shell.openExternal) {
                    shell.openExternal(item.url);
                }
            });
        } else {
            linkRow.classList.add("is-hidden");
        }
        const tags = document.createElement("div");
        tags.className = "pm-tag-list";
        toTags(item.category || "").forEach((tag) => {
            const pill = document.createElement("span");
            pill.className = "pm-pill";
            pill.textContent = tag;
            applyCategoryColor(pill, tag);
            tags.appendChild(pill);
        });
        const actions = document.createElement("div");
        actions.className = "pm-catalog-actions";
        const qtyWrap = document.createElement("div");
        qtyWrap.className = "pm-qty-spinner";
        const qtyMinus = document.createElement("button");
        qtyMinus.type = "button";
        qtyMinus.className = "pm-qty-btn";
        qtyMinus.title = "Diminuisci quantita";
        qtyMinus.setAttribute("aria-label", "Diminuisci quantita");
        const qtyMinusIcon = document.createElement("span");
        qtyMinusIcon.className = "material-icons";
        qtyMinusIcon.textContent = "remove";
        qtyMinus.appendChild(qtyMinusIcon);
        const qty = document.createElement("input");
        qty.className = "pm-qty-input";
        qty.type = "number";
        qty.min = "1";
        qty.step = "1";
        qty.inputMode = "numeric";
        qty.placeholder = "Q.ta";
        qty.value = "";
        const qtyPlus = document.createElement("button");
        qtyPlus.type = "button";
        qtyPlus.className = "pm-qty-btn";
        qtyPlus.title = "Aumenta quantita";
        qtyPlus.setAttribute("aria-label", "Aumenta quantita");
        const qtyPlusIcon = document.createElement("span");
        qtyPlusIcon.className = "material-icons";
        qtyPlusIcon.textContent = "add";
        qtyPlus.appendChild(qtyPlusIcon);
        const clampQty = (value) => {
            if (value === "" || value === null || value === undefined) return "";
            const num = Number.parseInt(String(value || "").trim(), 10);
            if (Number.isNaN(num) || num < 1) return 1;
            return num;
        };
        const syncQty = (nextValue) => {
            const clamped = clampQty(nextValue);
            qty.value = clamped === "" ? "" : String(clamped);
        };
        let holdTimer = null;
        let holdActive = false;
        let holdStart = 0;

        const stopHold = () => {
            holdActive = false;
            if (holdTimer) clearTimeout(holdTimer);
            holdTimer = null;
        };

        const stepOnce = (direction) => {
            const base = Number.parseInt(qty.value || "0", 10) || 0;
            const next = base + direction;
            syncQty(next);
        };

        const scheduleHold = (direction) => {
            if (!holdActive) return;
            const elapsed = Date.now() - holdStart;
            const minDelay = 50;
            const maxDelay = 320;
            const accelWindow = 3000;
            const progress = Math.min(1, elapsed / accelWindow);
            const delay = Math.round(maxDelay - (maxDelay - minDelay) * progress);
            holdTimer = setTimeout(() => {
                stepOnce(direction);
                scheduleHold(direction);
            }, delay);
        };

        const startHold = (direction) => {
            stopHold();
            holdActive = true;
            holdStart = Date.now();
            stepOnce(direction);
            scheduleHold(direction);
        };

        const bindHold = (btn, direction) => {
            btn.addEventListener("mousedown", () => startHold(direction));
            btn.addEventListener("touchstart", (event) => {
                event.preventDefault();
                startHold(direction);
            });
            btn.addEventListener("mouseup", stopHold);
            btn.addEventListener("mouseleave", stopHold);
            btn.addEventListener("touchend", stopHold);
            btn.addEventListener("touchcancel", stopHold);
        };

        bindHold(qtyMinus, -1);
        bindHold(qtyPlus, 1);
        qty.addEventListener("blur", () => {
            syncQty(qty.value);
        });
        qtyWrap.append(qtyMinus, qty, qtyPlus);
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "pm-cart-btn";
        addBtn.title = "Aggiungi al carrello";
        const icon = document.createElement("span");
        icon.className = "material-icons";
        icon.textContent = "shopping_cart";
        addBtn.appendChild(icon);
        addBtn.addEventListener("click", () => {
            if (!requireLogin()) return;
            const quantity = qty.value.toString().trim();
            if (!quantity || Number.parseFloat(quantity) <= 0) {
                showWarning("Inserisci una quantita valida.");
                return;
            }
            addLineFromCatalog(item, quantity);
            qty.value = "";
        });
        actions.append(qtyWrap, addBtn);

        if (isAdmin()) {
            const trashBtn = document.createElement("button");
            trashBtn.type = "button";
            trashBtn.className = "pm-catalog-trash";
            trashBtn.title = "Elimina prodotto";
            const trashIcon = document.createElement("span");
            trashIcon.className = "material-icons";
            trashIcon.textContent = "delete";
            trashBtn.appendChild(trashIcon);
            trashBtn.addEventListener("click", async () => {
                const ok = await openConfirmModal("Vuoi eliminare questo prodotto dal catalogo?");
                if (!ok) return;
                const nextItems = catalogItems.filter((entry) => entry.id !== item.id);
                setCatalogItems(nextItems);
                if (saveCatalog(nextItems)) rerenderCatalog();
            });
            card.appendChild(trashBtn);
        }

        card.append(img, title, desc, linkRow);
        if (tags.childElementCount) card.appendChild(tags);
        card.appendChild(actions);
        grid.appendChild(card);
    });
}

module.exports = { renderCatalog };
