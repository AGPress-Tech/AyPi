require("../../../shared/dev-guards");

type AccessConfig = {
    version: number;
    operations: {
        create: Record<string, boolean>;
        pending: {
            access: boolean;
            approve: boolean;
            reject: boolean;
        };
        editApproved: boolean;
        deleteApproved: boolean;
        filters: Record<string, boolean>;
        manageAccess: boolean;
        daysAccess: boolean;
        export: boolean;
    };
};

const DEFAULT_ACCESS_CONFIG: AccessConfig = {
    version: 1,
    operations: {
        create: {
            ferie: false,
            permesso: false,
            straordinari: false,
            mutua: true,
            speciale: true,
            retribuito: true,
        },
        pending: {
            access: true,
            approve: true,
            reject: true,
        },
        editApproved: true,
        deleteApproved: true,
        filters: {
            ferie: false,
            permesso: false,
            straordinari: true,
            mutua: true,
            speciale: true,
            retribuito: true,
        },
        manageAccess: true,
        daysAccess: true,
        export: true,
    },
};

function toBool(value: unknown, fallback: boolean) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const trimmed = value.trim().toLowerCase();
        if (
            trimmed === "true" ||
            trimmed === "1" ||
            trimmed === "on" ||
            trimmed === "si"
        ) {
            return true;
        }
        if (
            trimmed === "false" ||
            trimmed === "0" ||
            trimmed === "off" ||
            trimmed === "no"
        ) {
            return false;
        }
    }
    return fallback;
}

function normalizeAccessConfig(raw: unknown): AccessConfig {
    const base: AccessConfig = JSON.parse(
        JSON.stringify(DEFAULT_ACCESS_CONFIG),
    );
    const src =
        raw && typeof raw === "object" ? (raw as Partial<AccessConfig>) : {};
    const ops =
        src.operations && typeof src.operations === "object"
            ? (src.operations as AccessConfig["operations"])
            : ({} as AccessConfig["operations"]);

    const create = (
        ops.create && typeof ops.create === "object" ? ops.create : {}
    ) as AccessConfig["operations"]["create"];
    const pending = (
        ops.pending && typeof ops.pending === "object" ? ops.pending : {}
    ) as AccessConfig["operations"]["pending"];
    const filters = (
        ops.filters && typeof ops.filters === "object" ? ops.filters : {}
    ) as AccessConfig["operations"]["filters"];

    base.operations.create.ferie = toBool(
        create.ferie,
        base.operations.create.ferie,
    );
    base.operations.create.permesso = toBool(
        create.permesso,
        base.operations.create.permesso,
    );
    base.operations.create.straordinari = toBool(
        create.straordinari,
        base.operations.create.straordinari,
    );
    base.operations.create.mutua = toBool(
        create.mutua,
        base.operations.create.mutua,
    );
    base.operations.create.speciale = toBool(
        create.speciale,
        base.operations.create.speciale,
    );
    base.operations.create.retribuito = toBool(
        create.retribuito,
        base.operations.create.retribuito,
    );

    base.operations.pending.access = toBool(
        pending.access,
        base.operations.pending.access,
    );
    base.operations.pending.approve = toBool(
        pending.approve,
        base.operations.pending.approve,
    );
    base.operations.pending.reject = toBool(
        pending.reject,
        base.operations.pending.reject,
    );

    base.operations.editApproved = toBool(
        ops.editApproved,
        base.operations.editApproved,
    );
    base.operations.deleteApproved = toBool(
        ops.deleteApproved,
        base.operations.deleteApproved,
    );

    base.operations.filters.ferie = toBool(
        filters.ferie,
        base.operations.filters.ferie,
    );
    base.operations.filters.permesso = toBool(
        filters.permesso,
        base.operations.filters.permesso,
    );
    base.operations.filters.straordinari = toBool(
        filters.straordinari,
        base.operations.filters.straordinari,
    );
    base.operations.filters.mutua = toBool(
        filters.mutua,
        base.operations.filters.mutua,
    );
    base.operations.filters.speciale = toBool(
        filters.speciale,
        base.operations.filters.speciale,
    );
    base.operations.filters.retribuito = toBool(
        filters.retribuito,
        base.operations.filters.retribuito,
    );

    base.operations.manageAccess = toBool(
        ops.manageAccess,
        base.operations.manageAccess,
    );
    base.operations.daysAccess = toBool(
        ops.daysAccess,
        base.operations.daysAccess,
    );
    base.operations.export = toBool(ops.export, base.operations.export);

    return base;
}

export { DEFAULT_ACCESS_CONFIG, normalizeAccessConfig };

if (
    typeof module !== "undefined" &&
    module.exports &&
    !(globalThis as any).__aypiBundled
) {
    module.exports = {
        DEFAULT_ACCESS_CONFIG,
        normalizeAccessConfig,
    };
}
