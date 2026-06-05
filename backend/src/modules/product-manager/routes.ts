import fs from "fs";
import path from "path";
import type { Router } from "../../shared/http/router";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import {
    createProductManagerBackup,
    loadProductManagerBootstrap,
    listProductManagerBackups,
    resolveCatalogImagePath,
    restoreProductManagerBackup,
    saveCatalogImage,
    saveProductManagerCatalog,
    saveProductManagerCategories,
    saveProductManagerInterventions,
    saveProductManagerInterventionTypes,
    saveProductManagerRequests,
} from "./repository";

function getContentType(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    return "image/png";
}

export function registerProductManagerRoutes(router: Router) {
    router.register("GET", "/api/product-manager/bootstrap", async (_req, res) => {
        sendJson(res, 200, loadProductManagerBootstrap());
    });

    router.register("GET", "/api/product-manager/backups", async (_req, res) => {
        sendJson(res, 200, { items: listProductManagerBackups() });
    });

    router.register("POST", "/api/product-manager/backups", async (_req, res) => {
        sendJson(res, 201, createProductManagerBackup());
    });

    router.register(
        "POST",
        "/api/product-manager/backups/:name/restore",
        async (_req, res, params) => {
            sendJson(res, 200, restoreProductManagerBackup(params.name));
        },
    );

    router.register("PUT", "/api/product-manager/requests", async (req, res) => {
        const payload = await readJsonBody<any[]>(req);
        sendJson(res, 200, {
            items: saveProductManagerRequests(Array.isArray(payload) ? payload : []),
        });
    });

    router.register("PUT", "/api/product-manager/interventions", async (req, res) => {
        const payload = await readJsonBody<any[]>(req);
        sendJson(res, 200, {
            items: saveProductManagerInterventions(Array.isArray(payload) ? payload : []),
        });
    });

    router.register("PUT", "/api/product-manager/catalog", async (req, res) => {
        const payload = await readJsonBody<any[]>(req);
        sendJson(res, 200, {
            items: saveProductManagerCatalog(Array.isArray(payload) ? payload : []),
        });
    });

    router.register("PUT", "/api/product-manager/categories", async (req, res) => {
        const payload = await readJsonBody<any[]>(req);
        sendJson(res, 200, {
            items: saveProductManagerCategories(Array.isArray(payload) ? payload : []),
        });
    });

    router.register(
        "PUT",
        "/api/product-manager/intervention-types",
        async (req, res) => {
            const payload = await readJsonBody<any[]>(req);
            sendJson(res, 200, {
                items: saveProductManagerInterventionTypes(
                    Array.isArray(payload) ? payload : [],
                ),
            });
        },
    );

    router.register("POST", "/api/product-manager/catalog-image", async (req, res) => {
        const payload = await readJsonBody<{
            catalogId?: string;
            fileName?: string;
            dataBase64?: string;
        }>(req);
        sendJson(res, 200, saveCatalogImage(payload || {}));
    });

    router.register(
        "GET",
        "/api/product-manager/catalog-image/:fileName",
        async (_req, res, params) => {
            const filePath = resolveCatalogImagePath(params.fileName);
            if (!fs.existsSync(filePath)) {
                sendJson(res, 404, { error: "Not found" });
                return;
            }
            res.writeHead(200, {
                "Content-Type": getContentType(filePath),
                "Cache-Control": "public, max-age=60",
            });
            fs.createReadStream(filePath).pipe(res);
        },
    );
}
