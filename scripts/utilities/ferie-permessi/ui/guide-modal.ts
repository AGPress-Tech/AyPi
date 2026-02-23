require("../../../shared/dev-guards");

type GuideModalOptions = {
    document: Document;
    showModal: (el: HTMLElement | null) => void;
    hideModal: (el: HTMLElement | null) => void;
    setMessage?: (el: HTMLElement | null, message: string, isError?: boolean) => void;
    guideUrl?: string;
    guideSearchParam?: string;
    getTheme?: () => string;
};

function createGuideModal(options: GuideModalOptions) {
    const {
        document,
        showModal,
        hideModal,
        setMessage,
        guideUrl,
        guideSearchParam,
        getTheme,
    } = options || ({} as GuideModalOptions);

    if (!document) {
        throw new Error("document richiesto.");
    }

    let lastQuery = "";

    function buildGuideUrl(query: string) {
        if (!guideUrl) return "";
        const theme = typeof getTheme === "function" ? getTheme() : "";
        try {
            const url = new URL(guideUrl);
            if (theme) {
                url.searchParams.set("theme", theme);
            }
            if (guideSearchParam) {
                if (query) {
                    url.searchParams.set(guideSearchParam, query);
                }
            }
            return url.toString();
        } catch (err) {
            if (!query && !theme) return guideUrl;
            if (guideSearchParam) {
                const joiner = guideUrl.includes("?") ? "&" : "?";
                const themeParam = theme ? `&theme=${encodeURIComponent(theme)}` : "";
                const queryParam = query ? `${encodeURIComponent(guideSearchParam)}=${encodeURIComponent(query)}` : "";
                const base = queryParam ? `${guideUrl}${joiner}${queryParam}` : guideUrl;
                return `${base}${themeParam}`;
            }
            return guideUrl;
        }
    }

    function buildGuideUrlForPath(relativePath: string) {
        if (!guideUrl || !relativePath) return "";
        const theme = typeof getTheme === "function" ? getTheme() : "";
        try {
            const base = new URL(guideUrl);
            const target = new URL(relativePath, base);
            base.searchParams.forEach((value, key) => {
                if (guideSearchParam && key === guideSearchParam) return;
                target.searchParams.set(key, value);
            });
            if (guideSearchParam) {
                target.searchParams.delete(guideSearchParam);
            }
            if (theme) {
                target.searchParams.set("theme", theme);
            }
            return target.toString();
        } catch (err) {
            const [baseNoQuery] = guideUrl.split("?");
            const baseDir = baseNoQuery.endsWith("/")
                ? baseNoQuery
                : baseNoQuery.replace(/[^/]*$/, "");
            const themeParam = theme ? `?theme=${encodeURIComponent(theme)}` : "";
            return `${baseDir}${relativePath}${themeParam}`;
        }
    }

    function tryFindInIframe(frame: HTMLIFrameElement | null, query: string) {
        if (!frame || !query) return false;
        try {
            const win = frame.contentWindow;
            if (win && typeof win.find === "function") {
                return !!win.find(query);
            }
        } catch (err) {
            return false;
        }
        return false;
    }

    function openGuideModal() {
        const modal = document.getElementById("fp-guide-modal") as HTMLElement | null;
        const frame = document.getElementById("fp-guide-frame") as HTMLIFrameElement | null;
        const message = document.getElementById("fp-guide-message") as HTMLElement | null;
        if (!modal) return;
        if (!guideUrl) {
            if (setMessage) setMessage(message, "Guida non configurata. Imposta GUIDE_URL in config/constants.js.");
        } else if (frame) {
            const baseUrl = buildGuideUrl(lastQuery || "");
            if (!frame.getAttribute("src") || frame.getAttribute("src") === "about:blank" || !lastQuery) {
                frame.setAttribute("src", baseUrl);
            } else if (baseUrl && !frame.getAttribute("src")?.includes(baseUrl)) {
                frame.setAttribute("src", baseUrl);
            }
            if (setMessage) setMessage(message, "");
        }
        showModal(modal);
    }

    function openGuideModalWithQuery(query: string) {
        lastQuery = query || "";
        openGuideModal();
        if (query) {
            const frame = document.getElementById("fp-guide-frame") as HTMLIFrameElement | null;
            const nextUrl = buildGuideUrl(query);
            if (frame && nextUrl) {
                frame.setAttribute("src", nextUrl);
            }
        }
    }

    function openGuideModalAtPath(relativePath: string) {
        lastQuery = "";
        const modal = document.getElementById("fp-guide-modal") as HTMLElement | null;
        const frame = document.getElementById("fp-guide-frame") as HTMLIFrameElement | null;
        const message = document.getElementById("fp-guide-message") as HTMLElement | null;
        if (!modal) return;
        if (!guideUrl) {
            if (setMessage) setMessage(message, "Guida non configurata. Imposta GUIDE_URL in config/constants.js.");
        } else if (frame) {
            const targetUrl = buildGuideUrlForPath(relativePath);
            if (targetUrl) {
                frame.setAttribute("src", targetUrl);
            }
            if (setMessage) setMessage(message, "");
        }
        showModal(modal);
    }

    function closeGuideModal() {
        const modal = document.getElementById("fp-guide-modal") as HTMLElement | null;
        if (!modal) return;
        hideModal(modal);
    }

    function handleSearch() {
        const frame = document.getElementById("fp-guide-frame") as HTMLIFrameElement | null;
        const input = document.getElementById("fp-guide-search") as HTMLInputElement | null;
        if (!input || !frame) return;
        const query = input.value.trim();
        if (!query) return;
        lastQuery = query;
        if (!tryFindInIframe(frame, query)) {
            const nextUrl = buildGuideUrl(query);
            if (nextUrl) {
                frame.setAttribute("src", nextUrl);
            }
        }
    }

    function initGuideModal() {
        const modal = document.getElementById("fp-guide-modal") as HTMLElement | null;
        const searchBtn = document.getElementById("fp-guide-search-btn") as HTMLButtonElement | null;
        const searchInput = document.getElementById("fp-guide-search") as HTMLInputElement | null;
        const frame = document.getElementById("fp-guide-frame") as HTMLIFrameElement | null;

        if (modal) {
            modal.addEventListener("click", (event) => {
                if (event.target === modal) {
                    // no-op: keep modal open on backdrop click
                }
            });
        }
        if (searchBtn) {
            searchBtn.addEventListener("click", handleSearch);
        }
        if (searchInput) {
            searchInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    handleSearch();
                }
            });
        }
        if (frame) {
            frame.addEventListener("load", () => {
                if (!lastQuery) return;
                tryFindInIframe(frame, lastQuery);
            });
        }
    }

    return { openGuideModal, openGuideModalWithQuery, openGuideModalAtPath, closeGuideModal, initGuideModal };
}

export { createGuideModal };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { createGuideModal };
}


