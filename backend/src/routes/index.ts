import type { Router } from "../shared/http/router";
import { registerUploadRoutes } from "../shared/http/upload-routes";
import { registerFeriePermessiRoutes } from "../modules/ferie-permessi/routes";
import { registerSharedRoutes } from "../modules/shared/routes";
import { registerProductManagerRoutes } from "../modules/product-manager/routes";
import { registerTicketSupportRoutes } from "../modules/ticket-support/routes";
import { registerTransferAttrezzaggioRoutes } from "../modules/transfer-attrezzaggio/routes";
import { registerHaasAttrezzaggioRoutes } from "../modules/haas-attrezzaggio/routes";
import { registerProductionPlannerRoutes } from "../modules/production-planner/routes";
import { registerRegistrazioniProgettazioneStampiRoutes } from "../modules/registrazioni-progettazione-stampi/routes";
import { registerRegistrazioniProgettiSpecialiRoutes } from "../modules/registrazioni-progetti-speciali/routes";
import { registerWarehouseInventoryRoutes } from "../modules/warehouse-inventory/routes";
import { sendJson } from "../shared/http/response";
import { backendConfig } from "../config";
import { getTelegramBotServiceStatus } from "../modules/telegram-bot/service";

export function registerRoutes(router: Router) {
    registerUploadRoutes(router);
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
                "haas-attrezzaggio",
                "production-planner",
                "registrazioni-progettazione-stampi",
                "registrazioni-progetti-speciali",
                "telegram-bot",
                "warehouse-inventory",
            ],
            host: backendConfig.advertisedHost,
            port: backendConfig.port,
            profile: backendConfig.profile,
            realtime: {
                transport: "websocket",
                path: "/ws",
            },
            mobileGateway: {
                enabled: backendConfig.mobileGateway.enabled,
                host: backendConfig.mobileGateway.host,
                port: backendConfig.mobileGateway.port,
                scope: "calendar-admin",
            },
            telegramBot: getTelegramBotServiceStatus(),
        });
    });

    registerFeriePermessiRoutes(router);
    registerSharedRoutes(router);
    registerProductManagerRoutes(router);
    registerTicketSupportRoutes(router);
    registerTransferAttrezzaggioRoutes(router);
    registerHaasAttrezzaggioRoutes(router);
    registerProductionPlannerRoutes(router);
    registerRegistrazioniProgettazioneStampiRoutes(router);
    registerRegistrazioniProgettiSpecialiRoutes(router);
    registerWarehouseInventoryRoutes(router);
}
