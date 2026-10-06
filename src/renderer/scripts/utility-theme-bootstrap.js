(() => {
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.get("splashTheme") !== "agpress") return;

    document.documentElement.dataset.utilityTheme = "agpress";
    document.querySelectorAll("link[data-bluearchive-theme]").forEach((link) => {
        link.setAttribute("media", "not all");
    });
    document.querySelectorAll("link[data-agpress-theme]").forEach((link) => {
        link.setAttribute("media", "all");
    });
})();
