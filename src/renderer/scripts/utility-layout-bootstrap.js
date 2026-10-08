(() => {
    const params = new URLSearchParams(window.location.search || "");
    const page = decodeURIComponent(window.location.pathname)
        .split(/[\\/]/)
        .pop()
        ?.toLowerCase();
    const isBlueArchive = params.get("theme") === "bluearchive";
    const isAgpressSplash = params.get("splashTheme") === "agpress";
    const bodyClasses = new Set();

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

    if (page === "ticket-support.html" || page === "ticket-support-admin.html") {
        bodyClasses.add("fp-bluearchive");
        bodyClasses.add("bluearchive-purchasing");
        bodyClasses.add("bluearchive-ticket-support");
        if (!isBlueArchive) bodyClasses.add("agpress-login-ui");
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

    if (page === "production-planner.html") {
        if (isBlueArchive) bodyClasses.add("bluearchive-production-planner");
        if (params.get("plannerSplash") === "1") {
            bodyClasses.add("planner-splash-active");
        }
    }

    if (isAgpressSplash) bodyClasses.add("agpress-scripted-splash");

    const applyLayout = () => {
        if (!document.body) return false;
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
