(() => {
  const sharedTableStyle = new URL('../styles/table-sorting.css', document.currentScript.src).href;
  document.addEventListener('DOMContentLoaded', () => {
    if (![...document.styleSheets].some(sheet => sheet.href === sharedTableStyle)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = sharedTableStyle;
      document.head.append(link);
    }
    const markCreationButtons = root => {
      const buttons = root.matches?.('button') ? [root] : root.querySelectorAll?.('button') || [];
      for (const button of buttons) {
        button.classList.toggle('analysis-create-button', /^(?:\+\s*\p{L}|Aggiungi\b|Inserisci\b|Nuov[ao]\b)/u.test(button.textContent.trim()));
      }
    };
    markCreationButtons(document);
    new MutationObserver(changes => {
      for (const change of changes) {
        if (change.target.parentElement?.closest('button')) markCreationButtons(change.target.parentElement.closest('button'));
        if (change.target.closest?.('button')) markCreationButtons(change.target.closest('button'));
        for (const node of change.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) markCreationButtons(node);
      }
    }).observe(document.body, {childList:true, subtree:true, characterData:true});
  });
  // Dismiss only filter/column popovers; expanded data rows and information stay open.
  document.addEventListener('pointerdown', event => {
    const selectors = 'details.multi-filter[open], details.columns-picker[open], details.analysis-columns[open], details.filter-picker[open], details.advanced-filters[open], details.filter-group[open], details.analysis-advanced-filters[open], details.machine-filter[open], details.additional-years[open], details.read-period[open], details.bom-presets[open], details[data-filter-popover][open], details#moreFilters[open], details#columns[open], details#report-columns[open]';
    for (const popup of document.querySelectorAll(selectors)) {
      if (!event.composedPath().includes(popup)) popup.open = false;
    }
  }, true);
  const params = new URLSearchParams(window.location.search || "");
  const page = decodeURIComponent(window.location.pathname)
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase();
  const isBlueArchive = params.get("theme") === "bluearchive";
  // Il tema esplicito del modulo prevale sullo splash ereditato dal portale.
  const isAgpressSplash =
    !isBlueArchive && params.get("splashTheme") === "agpress";
  const bodyClasses = new Set();
  const html = document.documentElement;
  html.dataset.moduleTheme = isBlueArchive ? "bluearchive" : "standard";

  // Eseguito nel <head>, prima dei CSS e di qualunque bundle/IPC asincrono.
  if (["forge.html", "forge-preview.html", "management.html", "article-orders.html", "article-offers.html", "turning-analysis.html", "customer-analysis.html", "commercial-analysis.html", "maintenance.html", "bom-analysis.html"].includes(page)) {
    html.dataset.forgeTheme = isBlueArchive ? "bluearchive" : "standard";
    if (page === "forge.html" && !isBlueArchive)
      bodyClasses.add("agpress-scripted-splash");
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
  const fixedBlue =
    Boolean(fixedBlueLayouts[page]) || page === "production-planner.html";
  html.style.backgroundColor =
    isBlueArchive || fixedBlue ? "#edf9ff" : "#f7f4ed";

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
      } catch { }
    }
  }

  if (page === "timers.html" && isBlueArchive) {
    bodyClasses.add("bluearchive-timers");
  }
  if (page === "inventario-magazzino.html") {
    bodyClasses.add(
      isBlueArchive ? "warehouse-bluearchive" : "agpress-login-ui",
    );
  }

  if (page === "production-planner.html") {
    if (isBlueArchive) bodyClasses.add("bluearchive-production-planner");
  }

  if (isAgpressSplash) bodyClasses.add("agpress-scripted-splash");

  const applyLayout = () => {
    if (!document.body) return false;
    if (isBlueArchive)
      document.body.classList.remove(
        "agpress-scripted-splash",
        "agpress-purchasing",
        "agpress-login-ui",
      );
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
