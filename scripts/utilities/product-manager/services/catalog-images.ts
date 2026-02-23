require("../../../shared/dev-guards");

type CatalogImageContext = {
    path: typeof import("path");
    fs: typeof import("fs");
    pathToFileURL: (filePath: string) => URL;
    PRODUCTS_DIR: string;
    LEGACY_PRODUCTS_DIR?: string;
    LEGACY_PRODUCTS_DIR_ALT?: string;
    showError: (message: string, detail?: string) => void;
};

type CatalogItem = {
    imageFile?: string;
    imageUrl?: string;
};

function getCatalogImagePath(ctx: CatalogImageContext, item?: CatalogItem | null) {
    const { path, fs, PRODUCTS_DIR, LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT } = ctx;
    if (!item || !item.imageFile) return "";
    const primary = path.join(PRODUCTS_DIR, item.imageFile);
    if (fs && fs.existsSync(primary)) return primary;
    const legacyDirs = [LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT].filter(Boolean);
    for (const dir of legacyDirs) {
        const legacy = path.join(dir as string, item.imageFile);
        if (!fs || fs.existsSync(legacy)) return legacy;
    }
    return primary;
}

function getCatalogImageSrc(ctx: CatalogImageContext, item?: CatalogItem | null) {
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

function ensureProductsDir(ctx: CatalogImageContext) {
    const { fs, PRODUCTS_DIR, LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT } = ctx;
    try {
        if (PRODUCTS_DIR && !fs.existsSync(PRODUCTS_DIR)) {
            fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
        }
        [LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT].filter(Boolean).forEach((dir) => {
            // Legacy: non ricreare cartelle eliminate manualmente.
            if (fs.existsSync(dir as string)) return;
        });
    } catch (err) {
        console.error("Errore creazione cartella prodotti:", err);
    }
}

function copyCatalogImage(ctx: CatalogImageContext, filePath: string, catalogId: string) {
    const { fs, path, PRODUCTS_DIR, LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT, showError } = ctx;
    if (!filePath) return "";
    ensureProductsDir(ctx);
    const ext = path.extname(filePath) || ".png";
    const filename = `${catalogId}${ext}`;
    try {
        const targets = [path.join(PRODUCTS_DIR, filename)];
        [LEGACY_PRODUCTS_DIR, LEGACY_PRODUCTS_DIR_ALT].filter(Boolean).forEach((dir) => {
            if (fs.existsSync(dir as string)) targets.push(path.join(dir as string, filename));
        });
        targets.forEach((target) => fs.copyFileSync(filePath, target));
        return filename;
    } catch (err) {
        showError("Errore copia immagine.", err instanceof Error ? err.message : String(err));
        return "";
    }
}

export {
    getCatalogImagePath,
    getCatalogImageSrc,
    ensureProductsDir,
    copyCatalogImage,
};

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
        getCatalogImagePath,
        getCatalogImageSrc,
        ensureProductsDir,
        copyCatalogImage,
    };
}


