// @ts-nocheck
require("../../../shared/dev-guards");
function setMessage(el, text, isError = false) {
    if (!el) return;
    if (!text) {
        el.classList.add("is-hidden");
        el.textContent = "";
        el.classList.remove("fp-message--error");
        return;
    }
    el.textContent = text;
    el.classList.remove("is-hidden");
    if (isError) {
        el.classList.add("fp-message--error");
    } else {
        el.classList.remove("fp-message--error");
    }
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { setMessage };

