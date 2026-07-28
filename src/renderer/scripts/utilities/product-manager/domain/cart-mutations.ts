interface CartActor {
    role?: string;
    adminName?: string;
    employee?: string;
}

function timestamp(now: Date) {
    return now.toISOString();
}

function ensureHistory(request: any) {
    request.history = Array.isArray(request.history) ? request.history : [];
    return request.history;
}

function actorHistory(
    actor: CartActor,
    action: string,
    at: string,
    extra: Record<string, unknown> = {},
) {
    const role = actor.role || "guest";
    return {
        at,
        by: role,
        adminName: actor.adminName || "",
        employee: role === "employee" ? actor.employee || "" : "",
        action,
        ...extra,
    };
}

export function updateRequestLine(
    request: any,
    line: any,
    values: Record<string, unknown>,
    actor: CartActor,
    now = new Date(),
) {
    Object.assign(line, values);
    ensureHistory(request).push(
        actorHistory(actor, "line-updated", timestamp(now)),
    );
    return line;
}

export function confirmRequestLine(
    request: any,
    line: any,
    actor: CartActor,
    now = new Date(),
) {
    const at = timestamp(now);
    line.confirmed = true;
    line.confirmedAt = at;
    line.confirmedBy = actor.adminName || "";
    ensureHistory(request).push({
        at,
        by: "admin",
        adminName: actor.adminName || "",
        action: "line-confirmed",
    });
    return line;
}

export function deleteRequestLine(
    request: any,
    line: any,
    actor: CartActor,
    options: { admin: boolean; reason?: string },
    now = new Date(),
) {
    const at = timestamp(now);
    const reason = options.reason || "";
    line.deletedAt = at;
    line.deletedBy = options.admin
        ? actor.adminName || ""
        : actor.employee || "";
    line.deletedByRole = options.admin ? "admin" : "employee";
    if (reason) line.deletedReason = reason;
    ensureHistory(request).push(
        actorHistory(actor, "line-deleted", at, { reason }),
    );
    return line;
}
