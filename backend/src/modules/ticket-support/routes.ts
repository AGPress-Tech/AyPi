import type { Router } from "../../shared/http/router";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import {
    createTicketBackup,
    loadTicketCategories,
    loadTicketStore,
    listTicketBackups,
    restoreTicketBackup,
    saveTicketCategories,
    saveTicketStore,
} from "./repository";

export function registerTicketSupportRoutes(router: Router) {
    router.register("GET", "/api/ticket-support/store", async (_req, res) => {
        sendJson(res, 200, loadTicketStore());
    });

    router.register("GET", "/api/ticket-support/backups", async (_req, res) => {
        sendJson(res, 200, { items: listTicketBackups() });
    });

    router.register("POST", "/api/ticket-support/backups", async (_req, res) => {
        sendJson(res, 201, createTicketBackup());
    });

    router.register(
        "POST",
        "/api/ticket-support/backups/:name/restore",
        async (_req, res, params) => {
            sendJson(res, 200, restoreTicketBackup(params.name));
        },
    );

    router.register("PUT", "/api/ticket-support/store", async (req, res) => {
        const payload = await readJsonBody<any>(req);
        sendJson(res, 200, saveTicketStore(payload || { version: 1, tickets: [] }));
    });

    router.register("GET", "/api/ticket-support/categories", async (_req, res) => {
        sendJson(res, 200, loadTicketCategories());
    });

    router.register("PUT", "/api/ticket-support/categories", async (req, res) => {
        const payload = await readJsonBody<any>(req);
        sendJson(res, 200, saveTicketCategories(payload || { version: 1, issueTypes: [], areas: [] }));
    });
}
