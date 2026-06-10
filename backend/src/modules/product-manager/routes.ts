import fs from "fs";
import path from "path";
import type { Router } from "../../shared/http/router";
import { readJsonBody } from "../../shared/http/request";
import { badRequest, notFound } from "../../shared/http/errors";
import { sendJson } from "../../shared/http/response";
import { createSchemaValidator } from "../../shared/http/validation";
import {
    resolveCatalogImagePath,
} from "./repository";
import {
    getProductManagerBackups,
    getProductManagerBootstrap,
    runProductManagerBackup,
    runProductManagerRestore,
    saveCatalog,
    saveCatalogImageEntry,
    saveCategories,
    saveInterventionTypes,
    saveInterventions,
    saveRequests,
} from "./service";

function getContentType(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    return "image/png";
}

const validateArrayPayload = createSchemaValidator<any[]>({
    type: "array",
});

const validateCatalogImagePayload = createSchemaValidator<{
    catalogId: string;
    fileName?: string;
    dataBase64: string;
}>({
    type: "object",
    required: ["catalogId", "dataBase64"],
    additionalProperties: false,
    properties: {
        catalogId: { type: "string", minLength: 1 },
        fileName: { type: "string", minLength: 1, nullable: true },
        dataBase64: { type: "string", minLength: 1 },
    },
});

export function registerProductManagerRoutes(router: Router) {
    router.register("GET", "/api/product-manager/bootstrap", async (_req, res) => {
        sendJson(res, 200, getProductManagerBootstrap());
    });

    router.register("GET", "/api/product-manager/backups", async (_req, res) => {
        sendJson(res, 200, { items: getProductManagerBackups() });
    });

    router.register("POST", "/api/product-manager/backups", async (_req, res) => {
        sendJson(res, 201, await runProductManagerBackup());
    });

    router.register(
        "POST",
        "/api/product-manager/backups/:name/restore",
        async (_req, res, params) => {
            if (!String(params.name || "").trim()) {
                throw badRequest("Backup name missing");
            }
            sendJson(res, 200, await runProductManagerRestore(params.name));
        },
    );

    router.register("PUT", "/api/product-manager/requests", async (req, res) => {
        const payload = validateArrayPayload(
            await readJsonBody(req),
            "Invalid purchasing requests payload",
        );
        sendJson(res, 200, {
            items: await saveRequests(payload),
        });
    });

    router.register("PUT", "/api/product-manager/interventions", async (req, res) => {
        const payload = validateArrayPayload(
            await readJsonBody(req),
            "Invalid purchasing interventions payload",
        );
        sendJson(res, 200, {
            items: await saveInterventions(payload),
        });
    });

    router.register("PUT", "/api/product-manager/catalog", async (req, res) => {
        const payload = validateArrayPayload(
            await readJsonBody(req),
            "Invalid catalog payload",
        );
        sendJson(res, 200, {
            items: await saveCatalog(payload),
        });
    });

    router.register("PUT", "/api/product-manager/categories", async (req, res) => {
        const payload = validateArrayPayload(
            await readJsonBody(req),
            "Invalid categories payload",
        );
        sendJson(res, 200, {
            items: await saveCategories(payload),
        });
    });

    router.register(
        "PUT",
        "/api/product-manager/intervention-types",
        async (req, res) => {
            const payload = validateArrayPayload(
                await readJsonBody(req),
                "Invalid intervention types payload",
            );
            sendJson(res, 200, {
                items: await saveInterventionTypes(payload),
            });
        },
    );

    router.register("POST", "/api/product-manager/catalog-image", async (req, res) => {
        const payload = validateCatalogImagePayload(
            await readJsonBody(req),
            "Invalid catalog image payload",
        );
        sendJson(res, 200, await saveCatalogImageEntry(payload));
    });

    router.register(
        "GET",
        "/api/product-manager/catalog-image/:fileName",
        async (_req, res, params) => {
            const filePath = resolveCatalogImagePath(params.fileName);
            if (!fs.existsSync(filePath)) {
                throw notFound("Catalog image not found");
            }
            res.writeHead(200, {
                "Content-Type": getContentType(filePath),
                "Cache-Control": "public, max-age=60",
            });
            fs.createReadStream(filePath).pipe(res);
        },
    );
}
