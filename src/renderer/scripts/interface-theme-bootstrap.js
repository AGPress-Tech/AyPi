(() => {
    const requestedTheme = new URLSearchParams(window.location.search).get("theme");
    const theme = requestedTheme === "agpress" ? "agpress" : "bluearchive";
    document.documentElement.dataset.interfaceTheme = theme;
    document.documentElement.style.backgroundColor = theme === "bluearchive" ? "#eaf7ff" : "#f6f1e7";

    const blueArchiveStylesheet = document.getElementById("blueArchiveStylesheet");
    const agpressStylesheet = document.getElementById("agpressStylesheet");
    if (theme === "agpress") {
        blueArchiveStylesheet?.setAttribute("media", "not all");
        agpressStylesheet?.setAttribute("media", "all");
        document.title = "AyPi — AGPress";
    }
})();
