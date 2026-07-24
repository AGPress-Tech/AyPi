require("./shared/dev-guards");
import { initBlueArchivePointerEffects } from "./shared/bluearchive-pointer-effects";

window.addEventListener("DOMContentLoaded", () => {
    initBlueArchivePointerEffects(true);
    const splash = document.getElementById("splash");
    let navigationStarted = false;
    const openModules = () => {
        if (navigationStarted) return;
        navigationStarted = true;
        window.location.href = "moduli.html";
    };

    if (splash) {
        splash.classList.add("is-splash-skippable");
        splash.setAttribute(
            "aria-label",
            "Clicca per saltare la schermata iniziale",
        );
        splash.addEventListener(
            "click",
            () => {
                splash.classList.add("is-splash-skipping");
                window.setTimeout(openModules, 340);
            },
            { once: true },
        );
    }

    window.setTimeout(openModules, 3000);
});

export {};
