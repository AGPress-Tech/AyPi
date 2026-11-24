import type { Router } from "../../shared/http/router";
import { getAssignees } from "../shared/service";
import { getRequestActor } from "../../shared/http/context";
import { unauthorized, badRequest } from "../../shared/http/errors";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import * as service from "./service";
import type { Kind } from "./model";
export function registerMeasurementRoutes(router: Router) {
    const employees = () => (getAssignees() as any)?.groups || {};
    const actor = (req: any) => {
        const name = getRequestActor(req);
        if (
            !Object.values(employees())
                .flat()
                .some(
                    (v) =>
                        String(v).trim().toLocaleLowerCase("it") ===
                        name.toLocaleLowerCase("it"),
                )
        )
            throw unauthorized("Seleziona un dipendente dall’elenco.");
        return name;
    };
    const kind = (v: string): Kind => {
        if (!["instrument", "calibration", "system"].includes(v))
            throw badRequest("Tipo non valido.");
        return v as Kind;
    };
    router.register(
        "GET",
        "/api/measurement-instruments/employees",
        async (_req, res) => sendJson(res, 200, { groups: employees() }),
    );
    router.register(
        "GET",
        "/api/measurement-instruments/snapshot",
        async (req, res) => {
            actor(req);
            res.setHeader("Cache-Control", "no-store");
            sendJson(res, 200, service.measurementSnapshot());
        },
    );
    router.register(
        "POST",
        "/api/measurement-instruments/entities/:kind",
        async (req, res, p) => {
            const user = actor(req);
            sendJson(res, 200, {
                entity: service.saveMeasurement(
                    kind(p.kind),
                    await readJsonBody(req),
                    user,
                ),
            });
        },
    );
    router.register(
        "POST",
        "/api/measurement-instruments/delete/:kind",
        async (req, res, p) => {
            const user = actor(req);
            sendJson(res, 200, {
                entity: service.deleteMeasurement(
                    kind(p.kind),
                    await readJsonBody(req),
                    user,
                ),
            });
        },
    );
    router.register(
        "GET",
        "/api/measurement-instruments/audit/:id",
        async (req, res, p) => {
            actor(req);
            sendJson(res, 200, { audit: service.measurementAudit(p.id) });
        },
    );
    router.register(
        "GET",
        "/api/measurement-instruments/attachments/:id",
        async (req, res, p) => {
            actor(req);
            sendJson(res, 200, service.measurementAttachment(p.id));
        },
    );
    router.register(
        "GET",
        "/api/measurement-instruments/preferences",
        async (req, res) =>
            sendJson(res, 200, {
                preferences: service.measurementPreferences(actor(req)),
            }),
    );
    router.register(
        "PUT",
        "/api/measurement-instruments/preferences",
        async (req, res) => {
            const user = actor(req);
            sendJson(res, 200, {
                preferences: service.measurementPreferences(
                    user,
                    await readJsonBody(req),
                ),
            });
        },
    );
    router.register(
        "POST",
        "/api/measurement-instruments/import",
        async (req, res) => {
            const user = actor(req);
            sendJson(res, 200, {
                info: service.importMeasurements(await readJsonBody(req), user),
            });
        },
    );
    router.register(
        "POST",
        "/api/measurement-instruments/import-preview",
        async (req, res) => {
            const user = actor(req);
            sendJson(res, 200, {
                comparison: service.previewMeasurementImport(
                    await readJsonBody(req),
                    user,
                ),
            });
        },
    );
    for (const phase of ["apply", "cancel"])
        router.register(
            "POST",
            "/api/measurement-instruments/import-" + phase,
            async (req, res) => {
                const user = actor(req),
                    body: any = await readJsonBody(req);
                if (typeof body?.token !== "string" || body.token.length > 100)
                    throw badRequest("Token non valido.");
                sendJson(
                    res,
                    200,
                    phase === "apply"
                        ? {
                              report: service.applyMeasurementImport(
                                  body.token,
                                  user,
                              ),
                          }
                        : service.cancelMeasurementImport(body.token, user),
                );
            },
        );
}
