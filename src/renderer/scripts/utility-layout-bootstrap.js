(() => {
    const params = new URLSearchParams(window.location.search || "");
    const page = decodeURIComponent(window.location.pathname)
        .split(/[\\/]/)
        .pop()
        ?.toLowerCase();
    const isBlueArchive = params.get("theme") === "bluearchive";
    // Il tema esplicito del modulo prevale sullo splash ereditato dal portale.
    const isAgpressSplash = !isBlueArchive && params.get("splashTheme") === "agpress";
    const bodyClasses = new Set();
    const html = document.documentElement;
    html.dataset.moduleTheme = isBlueArchive ? "bluearchive" : "standard";

    // Eseguito nel <head>, prima dei CSS e di qualunque bundle/IPC asincrono.
    if (["forge.html", "forge-preview.html"].includes(page)) {
        html.dataset.forgeTheme = isBlueArchive ? "bluearchive" : "standard";
        if (page === "forge.html" && !isBlueArchive) bodyClasses.add("agpress-scripted-splash");
    }
    if (page === "forno.html" && params.has("theme")) {
        html.dataset.theme = isBlueArchive ? "blue" : "classic";
    }

    const fixedBlueLayouts = {
        "file-list.html": "bluearchive-file-list",
        "batch-rename.html": "bluearchive-batch-rename",
        "qr-generator.html": "bluearchive-qr",
        "compare-folders.html": "bluearchive-compare",
        "hierarchy.html": "bluearchive-hierarchy",
    };

    if (fixedBlueLayouts[page]) {
        bodyClasses.add(fixedBlueLayouts[page]);
    }
    const fixedBlue = Boolean(fixedBlueLayouts[page]) || page === "production-planner.html";
    html.style.backgroundColor = isBlueArchive || fixedBlue ? "#edf9ff" : "#f7f4ed";

    if (page === "ticket-support.html" || page === "ticket-support-admin.html") {
        bodyClasses.add("fp-bluearchive");
        bodyClasses.add("bluearchive-purchasing");
        bodyClasses.add("bluearchive-ticket-support");
        if (!isBlueArchive) bodyClasses.add("agpress-login-ui");
        if (
            page === "ticket-support.html" &&
            params.get("tsSplash") === "1" &&
            (isBlueArchive || isAgpressSplash)
        ) {
            document.documentElement.classList.add("ticket-splash-boot");
        }
    }

    if (
        page === "product-manager.html" ||
        page === "product-manager-cart.html" ||
        page === "product-manager-interventions.html"
    ) {
        if (isBlueArchive) {
            bodyClasses.add("bluearchive-purchasing");
            bodyClasses.add("fp-bluearchive");
        } else {
            bodyClasses.add("agpress-purchasing");
            bodyClasses.add("agpress-login-ui");
        }
        if (page === "product-manager.html" && isAgpressSplash) {
            document.documentElement.classList.add("agpress-purchasing-boot");
        }
    }

    const calendarPages = new Set([
        "ferie-permessi.html",
        "ferie-permessi-hours.html",
        "ferie-permessi-analysis.html",
        "assignees-manager.html",
        "admin-manager.html",
    ]);
    if (calendarPages.has(page)) {
        if (isBlueArchive) {
            bodyClasses.add("fp-bluearchive");
        } else {
            if (page === "ferie-permessi.html") bodyClasses.add("agpress-login-ui");
            try {
                const savedTheme = window.localStorage.getItem("fpTheme");
                if (savedTheme === "dark") bodyClasses.add("fp-dark");
                if (savedTheme === "aypi") bodyClasses.add("fp-aypi");
            } catch {}
        }
    }

    if (page === "timers.html" && isBlueArchive) {
        bodyClasses.add("bluearchive-timers");
    }
    if (page === "inventario-magazzino.html") {
        bodyClasses.add(isBlueArchive ? "warehouse-bluearchive" : "agpress-login-ui");
    }

    if (page === "production-planner.html") {
        if (isBlueArchive) bodyClasses.add("bluearchive-production-planner");
    }

    if (isAgpressSplash) bodyClasses.add("agpress-scripted-splash");

    const applyLayout = () => {
        if (!document.body) return false;
        if (isBlueArchive) document.body.classList.remove("agpress-scripted-splash", "agpress-purchasing", "agpress-login-ui");
        document.body.classList.add(...bodyClasses);
        return true;
    };

    if (!applyLayout()) {
        const observer = new MutationObserver(() => {
            if (!applyLayout()) return;
            observer.disconnect();
        });
        observer.observe(document.documentElement, { childList: true });
    }
})();
