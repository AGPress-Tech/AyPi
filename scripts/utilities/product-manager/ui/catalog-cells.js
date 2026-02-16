function buildProductCell(ctx, productName, tags) {
    const { document, applyCategoryColor } = ctx;
    const wrapper = document.createElement("div");
    wrapper.className = "pm-product-cell";
    const title = document.createElement("div");
    title.className = "pm-product-title";
    title.textContent = productName || "-";
    wrapper.appendChild(title);
    if (tags.length) {
        const tagWrap = document.createElement("div");
        tagWrap.className = "pm-tag-list";
        tags.forEach((tag) => {
            const pill = document.createElement("span");
            pill.className = "pm-pill";
            pill.textContent = tag;
            applyCategoryColor(pill, tag);
            tagWrap.appendChild(pill);
        });
        wrapper.appendChild(tagWrap);
    }
    return wrapper;
}

function buildUrlCell(ctx, url) {
    const { document, shell } = ctx;
    const wrapper = document.createElement("div");
    wrapper.className = "pm-url-cell";
    if (!url) {
        wrapper.textContent = "-";
        return wrapper;
    }
    const shortUrl = url.length > 45 ? `${url.slice(0, 42)}...` : url;
    const link = document.createElement("a");
    link.href = url;
    link.textContent = shortUrl;
    link.className = "pm-link";
    link.title = url;
    link.addEventListener("click", (event) => {
        event.preventDefault();
        if (shell && shell.openExternal) {
            shell.openExternal(url);
        }
    });
    wrapper.appendChild(link);
    return wrapper;
}

module.exports = { buildProductCell, buildUrlCell };
