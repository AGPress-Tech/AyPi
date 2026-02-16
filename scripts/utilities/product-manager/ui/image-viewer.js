function openImageModal(ctx, imageSrc, link, title) {
    const { document, PLACEHOLDER_IMAGE } = ctx;
    const modal = document.getElementById("pm-image-modal");
    const img = document.getElementById("pm-image-preview");
    const linkEl = document.getElementById("pm-image-link");
    const titleEl = document.getElementById("pm-image-title");
    if (!modal || !img || !linkEl || !titleEl) return;
    titleEl.textContent = title || "Dettaglio prodotto";
    img.src = imageSrc || PLACEHOLDER_IMAGE;
    if (link) {
        linkEl.textContent = link;
        linkEl.href = link;
        linkEl.classList.remove("is-hidden");
    } else {
        linkEl.classList.add("is-hidden");
    }
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeImageModal(ctx) {
    const { document } = ctx;
    const modal = document.getElementById("pm-image-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

module.exports = { openImageModal, closeImageModal };
