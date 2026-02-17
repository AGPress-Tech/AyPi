function getCatalogImagePath(ctx, item) {
    const { path, fs, PRODUCTS_DIR, LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT } = ctx;
    if (!item || !item.imageFile) return "";
    const primary = path.join(PRODUCTS_DIR, item.imageFile);
    if (fs && fs.existsSync(primary)) return primary;
    const legacyDirs = [LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT].filter(Boolean);
    for (const dir of legacyDirs) {
        const legacy = path.join(dir, item.imageFile);
        if (!fs || fs.existsSync(legacy)) return legacy;
    }
    return primary;
}

function getCatalogImageSrc(ctx, item) {
    const { pathToFileURL } = ctx;
    if (item && item.imageUrl) return item.imageUrl;
    const filePath = getCatalogImagePath(ctx, item);
    if (!filePath) return "";
    try {
        return pathToFileURL(filePath).href;
    } catch {
        return filePath;
    }
}

function ensureProductsDir(ctx) {
    const { fs, PRODUCTS_DIR, LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT } = ctx;
    try {
        if (PRODUCTS_DIR && !fs.existsSync(PRODUCTS_DIR)) {
            fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
        }
        [LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT].filter(Boolean).forEach((dir) => {
            // Legacy: non ricreare cartelle eliminate manualmente.
            if (fs.existsSync(dir)) return;
        });
    } catch (err) {
        console.error("Errore creazione cartella prodotti:", err);
    }
}

function copyCatalogImage(ctx, filePath, catalogId) {
    const { fs, path, PRODUCTS_DIR, LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT, showError } = ctx;
    if (!filePath) return "";
    ensureProductsDir(ctx);
    const ext = path.extname(filePath) || ".png";
    const filename = `${catalogId}${ext}`;
    try {
        const targets = [path.join(PRODUCTS_DIR, filename)];
        [LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT].filter(Boolean).forEach((dir) => {
            if (fs.existsSync(dir)) targets.push(path.join(dir, filename));
        });
        targets.forEach((target) => fs.copyFileSync(filePath, target));
        return filename;
    } catch (err) {
        showError("Errore copia immagine.", err.message || String(err));
        return "";
    }
}

module.exports = {
    getCatalogImagePath,
    getCatalogImageSrc,
    ensureProductsDir,
    copyCatalogImage,
};
