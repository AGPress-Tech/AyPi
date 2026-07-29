import { initBlueArchivePointerEffects } from "../shared/bluearchive-pointer-effects";

function setupProductionPlannerSplash() {
    try {
        const splash = document.getElementById("planner-splash");
        const params = new URLSearchParams(window.location.search || "");
        const shouldShow = params.get("plannerSplash") === "1";
        const isBlueArchive = params.get("theme") === "bluearchive";
        if (isBlueArchive) {
            document.body.classList.add("bluearchive-production-planner");
            splash?.classList.add("planner-splash--bluearchive");
        }
        initBlueArchivePointerEffects(isBlueArchive);
        const finish = () => {
            if (!splash || splash.dataset.hidden === "1") return;
            splash.dataset.hidden = "1";
            splash.classList.add("is-hidden");
            splash.classList.remove("is-visible", "is-fading");
            splash.setAttribute("aria-hidden", "true");
            document.body.classList.remove("planner-splash-active");
            document.body.classList.add("planner-ready");
        };

        if (!splash || !shouldShow) {
            splash?.classList.add("is-hidden");
            if (splash) splash.dataset.hidden = "1";
            document.body.classList.add("planner-ready");
            return;
        }

        document.body.classList.add("planner-splash-active");
        splash.classList.add("is-visible", "is-splash-skippable");
        splash.setAttribute("aria-hidden", "false");
        splash.setAttribute(
            "aria-label",
            "Clicca per saltare la schermata iniziale",
        );
        splash.addEventListener(
            "click",
            () => {
                if (splash.dataset.skipRequested === "1") return;
                splash.dataset.skipRequested = "1";
                splash.classList.add("is-splash-skipping", "is-fading");
                window.setTimeout(finish, 340);
            },
            { once: true },
        );
        if (isBlueArchive) {
            const statusSteps = splash.querySelectorAll(
                ".planner-ba-boot__status span",
            );
            window.setTimeout(
                () => statusSteps[1]?.classList.add("is-complete"),
                1900,
            );
            window.setTimeout(
                () => statusSteps[2]?.classList.add("is-complete"),
                2800,
            );
            window.setTimeout(
                () => statusSteps[3]?.classList.add("is-complete"),
                3650,
            );
            window.setTimeout(() => {
                if (splash.dataset.hidden !== "1") {
                    splash.classList.add("is-fading");
                }
            }, 4550);
            window.setTimeout(finish, 5550);
            return;
        }
        window.setTimeout(() => {
            if (splash.dataset.hidden !== "1") {
                splash.classList.add("is-fading");
            }
        }, 800);
        window.setTimeout(finish, 1600);
    } catch {
        document.body.classList.add("planner-ready");
    }
}

setupProductionPlannerSplash();
