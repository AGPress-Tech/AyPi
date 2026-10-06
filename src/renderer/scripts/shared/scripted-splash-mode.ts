function createScriptedSplashMode(blueArchiveBodyClasses: string[]) {
    const parameters = new URLSearchParams(window.location.search);
    const isBlueArchive = parameters.get("theme") === "bluearchive";
    const isAgpress = parameters.get("splashTheme") === "agpress";
    const enabled = isBlueArchive || isAgpress;

    if (isBlueArchive) document.body.classList.add(...blueArchiveBodyClasses);
    if (isAgpress) document.body.classList.add("agpress-scripted-splash");

    let scope: HTMLElement | null = null;

    return {
        enabled,
        isBlueArchive,
        isAgpress,
        attach(splash: HTMLElement) {
            if (!isAgpress || scope) return;
            scope = document.createElement("div");
            scope.classList.add(
                "agpress-scripted-splash-scope",
                ...blueArchiveBodyClasses,
            );
            splash.parentNode?.insertBefore(scope, splash);
            scope.appendChild(splash);
        },
        cleanup() {
            if (!isAgpress) return;
            if (scope?.parentNode) {
                while (scope.firstChild) {
                    scope.parentNode.insertBefore(scope.firstChild, scope);
                }
                scope.remove();
            }
            scope = null;
            document.body.classList.remove("agpress-scripted-splash");
        },
    };
}

export { createScriptedSplashMode };
