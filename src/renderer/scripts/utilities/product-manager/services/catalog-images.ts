require("../../../shared/dev-guards");

type CatalogImageContext = {
    getBackendCatalogImageUrl: (fileName: string) => string;
    uploadCatalogImage: (
        filePath: string,
        catalogId: string,
    ) => string;
};

type CatalogItem = {
    imageFile?: string;
    imageUrl?: string;
};

function getCatalogImageSrc(
    ctx: CatalogImageContext,
    item?: CatalogItem | null,
) {
    if (item && item.imageUrl) return item.imageUrl;
    return item?.imageFile
        ? ctx.getBackendCatalogImageUrl(item.imageFile)
        : "";
}

function copyCatalogImage(
    ctx: CatalogImageContext,
    filePath: string,
    catalogId: string,
) {
    if (!filePath) return "";
    return ctx.uploadCatalogImage(filePath, catalogId);
}

export {
    getCatalogImageSrc,
    copyCatalogImage,
};

// Keep CommonJS compatibility for legacy JS callers
if (
    typeof module !== "undefined" &&
    module.exports &&
    !(globalThis as any).__aypiBundled
) {
    if (
        typeof module !== "undefined" &&
        module.exports &&
        !(globalThis as any).__aypiBundled
    )
        module.exports = {
            getCatalogImageSrc,
            copyCatalogImage,
        };
}
