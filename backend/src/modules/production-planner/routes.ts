import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { badRequest } from "../../shared/http/errors";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import {
    getProductionPlannerSnapshot,
    getProductionPlannerRevision,
    saveProductionPlanner,
    waitForProductionPlannerRevision,
} from "./service";

function validatePlannerState(value: any) {
    if (
        !value ||
        typeof value !== "object" ||
        !Array.isArray(value.machines) ||
        !Array.isArray(value.jobs) ||
        !Array.isArray(value.unavailabilities)
    ) {
        throw badRequest("Stato pianificatore non valido.");
    }
    return value;
}

export function registerProductionPlannerRoutes(router: Router) {
    router.register("GET", "/api/production-planner/state", async (_req, res) => {
        sendJson(res, 200, getProductionPlannerSnapshot());
    });

    router.register("GET", "/api/production-planner/revision", async (_req, res) => {
        sendJson(res, 200, getProductionPlannerRevision());
    });

    // TODO(release 1.3.3): rimuovere questo endpoint dopo aver verificato che
    // tutte le postazioni usino /ws. È mantenuto solo per i client AyPi legacy.
    router.register(
        "GET",
        "/api/production-planner/changes/:revision",
        async (_req, res, params) => {
            const revision = Math.max(0, Number(params.revision) || 0);
            res.setHeader("Deprecation", "true");
            res.setHeader(
                "Link",
                '</ws>; rel="successor-version"',
            );
            res.setHeader("x-aypi-legacy-transport", "long-poll");
            sendJson(
                res,
                200,
                await waitForProductionPlannerRevision(revision),
            );
        },
    );

    router.register("PUT", "/api/production-planner/state", async (req, res) => {
        const payload = (await readJsonBody<any>(req)) || {};
        const state = validatePlannerState(payload.state);
        const baseRevision = Number(payload.baseRevision);
        if (!Number.isInteger(baseRevision) || baseRevision < 0) {
            throw badRequest("Revisione pianificatore non valida.");
        }
        const snapshot = await saveProductionPlanner(state, baseRevision, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        sendJson(res, 200, snapshot);
    });
}
