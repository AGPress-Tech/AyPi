import type { Router } from "../shared/http/router";
import { registerFeriePermessiRoutes } from "../modules/ferie-permessi/routes";
import { sendJson } from "../shared/http/response";
import { backendConfig } from "../config";

export function registerRoutes(router: Router) {
    router.register("GET", "/health", async (_req, res) => {
        sendJson(res, 200, {
            ok: true,
            service: "aypi-backend",
            modules: ["ferie-permessi"],
            host: backendConfig.advertisedHost,
            port: backendConfig.port,
            profile: backendConfig.profile,
        });
    });

    registerFeriePermessiRoutes(router);
}
