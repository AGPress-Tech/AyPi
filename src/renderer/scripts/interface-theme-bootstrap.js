(() => {
    const requestedTheme = new URLSearchParams(window.location.search).get("theme");
    const theme = requestedTheme === "agpress" ? "agpress" : "bluearchive";
    document.documentElement.dataset.interfaceTheme = theme;

    const blueArchiveStylesheet = document.getElementById("blueArchiveStylesheet");
    const agpressStylesheet = document.getElementById("agpressStylesheet");
    if (theme === "agpress") {
        blueArchiveStylesheet?.setAttribute("media", "not all");
        agpressStylesheet?.setAttribute("media", "all");
        document.title = "AyPi — AGPress";
    }
})();
