type SkippableSplashOptions = {
    fadeClass?: string;
    onFinish?: () => void;
};

type SkippableSplashController = {
    finish: () => void;
    isFinished: () => boolean;
};

function makeSplashSkippable(
    splash: HTMLElement,
    options: SkippableSplashOptions = {},
): SkippableSplashController {
    const fadeClass = options.fadeClass || "is-fading";
    let finished = false;
    let skipRequested = false;

    const finish = () => {
        if (finished) return;
        finished = true;
        splash.removeEventListener("click", requestSkip);
        splash.remove();
        options.onFinish?.();
    };

    const requestSkip = () => {
        if (finished || skipRequested) {
            return;
        }
        skipRequested = true;
        splash.classList.add("is-splash-skipping", fadeClass);
        splash.setAttribute("aria-hidden", "true");
        finish();
    };

    splash.classList.add("is-splash-skippable");
    splash.setAttribute("aria-label", "Clicca per saltare la schermata iniziale");
    splash.addEventListener("click", requestSkip);

    return {
        finish,
        isFinished: () => finished,
    };
}

export { makeSplashSkippable };
export type { SkippableSplashController, SkippableSplashOptions };
