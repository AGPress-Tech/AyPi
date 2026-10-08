function createScriptedSplashMode(blueArchiveBodyClasses: string[]) {
    const parameters = new URLSearchParams(window.location.search);
    const isBlueArchive = parameters.get("theme") === "bluearchive";
    const isAgpress = parameters.get("splashTheme") === "agpress";
    const enabled = isBlueArchive || isAgpress;

    if (isBlueArchive) document.body.classList.add(...blueArchiveBodyClasses);
    if (isAgpress) document.body.classList.add("agpress-scripted-splash");

    let temporaryBodyClasses: string[] = [];

    return {
        enabled,
        isBlueArchive,
        isAgpress,
        attach(splash: HTMLElement) {
            if (!isAgpress || temporaryBodyClasses.length) return;
            // Applicare temporaneamente il tema al body evita di spostare lo
            // splash nel DOM, operazione che riavviava le animazioni CSS.
            temporaryBodyClasses = blueArchiveBodyClasses.filter(
                (className) => !document.body.classList.contains(className),
            );
            document.body.classList.add(...temporaryBodyClasses);
        },
        cleanup() {
            if (!isAgpress) return;
            document.body.classList.remove(...temporaryBodyClasses);
            temporaryBodyClasses = [];
            document.body.classList.remove("agpress-scripted-splash");
        },
    };
}

export { createScriptedSplashMode };
