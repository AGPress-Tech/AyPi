function createGuideModal(options) {
    const {
        document,
        showModal,
        hideModal,
        setMessage,
        guideUrl,
        guideSearchParam,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    let lastQuery = "";

    function buildGuideUrl(query) {
        if (!guideUrl) return "";
        if (!query) return guideUrl;
        try {
            const url = new URL(guideUrl);
            if (guideSearchParam) {
                url.searchParams.set(guideSearchParam, query);
            }
            return url.toString();
        } catch (err) {
            if (guideSearchParam) {
                const joiner = guideUrl.includes("?") ? "&" : "?";
                return `${guideUrl}${joiner}${encodeURIComponent(guideSearchParam)}=${encodeURIComponent(query)}`;
            }
            return guideUrl;
        }
    }

    function tryFindInIframe(frame, query) {
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
        const modal = document.getElementById("fp-guide-modal");
        const frame = document.getElementById("fp-guide-frame");
        const message = document.getElementById("fp-guide-message");
        if (!modal) return;
        if (!guideUrl) {
            if (setMessage) setMessage(message, "Guida non configurata. Imposta GUIDE_URL in config/constants.js.");
        } else if (frame && (!frame.getAttribute("src") || frame.getAttribute("src") === "about:blank")) {
            frame.setAttribute("src", buildGuideUrl(""));
            if (setMessage) setMessage(message, "");
        }
        showModal(modal);
    }

    function closeGuideModal() {
        const modal = document.getElementById("fp-guide-modal");
        if (!modal) return;
        hideModal(modal);
    }

    function handleSearch() {
        const frame = document.getElementById("fp-guide-frame");
        const input = document.getElementById("fp-guide-search");
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
        const modal = document.getElementById("fp-guide-modal");
        const close = document.getElementById("fp-guide-close");
        const searchBtn = document.getElementById("fp-guide-search-btn");
        const searchInput = document.getElementById("fp-guide-search");
        const frame = document.getElementById("fp-guide-frame");

        if (close) {
            close.addEventListener("click", () => {
                closeGuideModal();
            });
        }
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

    return { openGuideModal, closeGuideModal, initGuideModal };
}

module.exports = { createGuideModal };
