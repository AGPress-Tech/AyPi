import { createHash, timingSafeEqual } from "crypto";
import type { Router } from "../../shared/http/router";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import { badRequest, unauthorized, HttpError } from "../../shared/http/errors";
import { loadWorkstationProfiles, saveWorkstationProfiles } from "./repository";
import { logger } from "../../shared/logging/logger";
import { getRequestUser } from "../../shared/http/context";

export function validateWorkstationProfiles(value: any) {
    if (
        value?.version !== 1 ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        Object.keys(value).some(
            (key) => !["version", "revision", "profiles"].includes(key),
        ) ||
        !Array.isArray(value.profiles) ||
        !value.profiles.length ||
        value.profiles.length > 100
    )
        throw badRequest("Catalogo postazioni non valido.");
    const ids = new Set<string>(),
        names = new Set<string>();
    const profiles = value.profiles.map((profile: any) => {
        const name =
            typeof profile?.name === "string" ? profile.name.trim() : "";
        if (
            typeof profile?.id !== "string" ||
            !/^[a-zA-Z0-9_-]{1,80}$/.test(profile.id) ||
            ids.has(profile.id) ||
            !name ||
            name.length > 80 ||
            names.has(name.toLocaleLowerCase("it")) ||
            !profile.rules ||
            typeof profile.rules !== "object" ||
            Array.isArray(profile.rules) ||
            Object.keys(profile.rules).length > 500 ||
            Object.keys(profile).some(
                (key) => !["id", "name", "rules"].includes(key),
            )
        )
            throw badRequest("Profilo postazione non valido o duplicato.");
        ids.add(profile.id);
        names.add(name.toLocaleLowerCase("it"));
        for (const [key, state] of Object.entries(profile.rules))
            if (
                !/^[a-zA-Z0-9:._-]{1,120}$/.test(key) ||
                !["accessible", "blocked", "hidden"].includes(state as string)
            )
                throw badRequest("Regola postazione non valida.");
        return { id: profile.id, name, rules: profile.rules };
    });
    return { version: 1, revision: value.revision, profiles };
}

export function registerWorkstationRoutes(router: Router) {
    router.register("GET", "/api/shared/workstations", async (_req, res) =>
        sendJson(res, 200, loadWorkstationProfiles()),
    );
    router.register("PUT", "/api/shared/workstations", async (req, res) => {
        const digest = (value: string) =>
            createHash("sha256").update(value).digest();
        const password = req.headers["x-aypi-workstations-password"];
        if (
            typeof password !== "string" ||
            !timingSafeEqual(
                digest(password),
                digest(
                    process.env.AYPI_WORKSTATIONS_ADMIN_PASSWORD || "AGPress",
                ),
            )
        )
            throw unauthorized(
                "Gestione postazioni riservata all’amministratore.",
            );
        const next = validateWorkstationProfiles(await readJsonBody(req));
        const current = validateWorkstationProfiles(loadWorkstationProfiles());
        if (next.revision !== current.revision)
            throw new HttpError(
                409,
                "Le postazioni sono state modificate da un altro amministratore. Ricarica prima di salvare.",
            );
        const saved = { ...next, revision: current.revision + 1 };
        saveWorkstationProfiles(saved);
        logger.info("Catalogo postazioni aggiornato", {
            module: "shared",
            event: "workstations_save",
            actor: getRequestUser(req),
            profiles: saved.profiles.length,
            revision: saved.revision,
        });
        sendJson(res, 200, saved);
    });
}
