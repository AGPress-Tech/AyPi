function getCatalogImagePath(ctx, item) {
    const { path, PRODUCTS_DIR } = ctx;
    if (!item || !item.imageFile) return "";
    return path.join(PRODUCTS_DIR, item.imageFile);
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
    const { fs, PRODUCTS_DIR } = ctx;
    try {
        if (!fs.existsSync(PRODUCTS_DIR)) {
            fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
        }
    } catch (err) {
        console.error("Errore creazione cartella prodotti:", err);
    }
}

function copyCatalogImage(ctx, filePath, catalogId) {
    const { fs, path, PRODUCTS_DIR, showError } = ctx;
    if (!filePath) return "";
    ensureProductsDir(ctx);
    const ext = path.extname(filePath) || ".png";
    const filename = `${catalogId}${ext}`;
    const target = path.join(PRODUCTS_DIR, filename);
    try {
        fs.copyFileSync(filePath, target);
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
