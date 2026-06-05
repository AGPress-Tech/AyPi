import type { Router } from "../shared/http/router";
import { registerFeriePermessiRoutes } from "../modules/ferie-permessi/routes";
import { registerSharedRoutes } from "../modules/shared/routes";
import { registerProductManagerRoutes } from "../modules/product-manager/routes";
import { registerTicketSupportRoutes } from "../modules/ticket-support/routes";
import { registerTransferAttrezzaggioRoutes } from "../modules/transfer-attrezzaggio/routes";
import { sendJson } from "../shared/http/response";
import { backendConfig } from "../config";

export function registerRoutes(router: Router) {
    router.register("GET", "/health", async (_req, res) => {
        sendJson(res, 200, {
            ok: true,
            service: "aypi-backend",
            modules: [
                "ferie-permessi",
                "shared",
                "product-manager",
                "ticket-support",
                "transfer-attrezzaggio",
            ],
            host: backendConfig.advertisedHost,
            port: backendConfig.port,
            profile: backendConfig.profile,
        });
    });

    registerFeriePermessiRoutes(router);
    registerSharedRoutes(router);
    registerProductManagerRoutes(router);
    registerTicketSupportRoutes(router);
    registerTransferAttrezzaggioRoutes(router);
}
