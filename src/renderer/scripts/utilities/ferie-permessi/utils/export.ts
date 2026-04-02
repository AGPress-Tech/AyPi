require("../../../shared/dev-guards");
import { calculateHours } from "./requests";
import { getTypeLabel, type RequestType } from "./labels";

type RequestLike = {
    employee?: string;
    department?: string;
    start?: string | null;
    end?: string | null;
    allDay?: boolean;
    type?: RequestType;
    status?: string;
    approvedBy?: string;
    modifiedBy?: string;
    rejectedBy?: string;
    rejectedAt?: string;
    deletedBy?: string;
    deletedAt?: string;
};
type HolidayLike = { date?: string } | string;
type ClosureLike = { start?: string; end?: string };

function getExportDates(request: RequestLike) {
    const startValue = request.allDay
        ? request.start
            ? new Date(`${request.start}T00:00:00`)
            : null
        : request.start
          ? new Date(request.start)
          : null;
    const endValue = request.allDay
        ? request.end
            ? new Date(`${request.end}T00:00:00`)
            : request.start
              ? new Date(`${request.start}T00:00:00`)
              : null
        : request.end
          ? new Date(request.end)
          : null;
    return { startValue, endValue };
}

export function buildExportRows(
    requests: RequestLike[],
    holidays: HolidayLike[] | null | undefined,
    closures: ClosureLike[] | null | undefined,
) {
    return requests.map((request) => {
        const { startValue, endValue } = getExportDates(request);
        const hours = calculateHours(request, holidays, closures);
        const isMutua = request.type === "mutua";
        const isInfortunio = request.type === "infortunio";
        const mutuaHours = isMutua ? hours : 0;
        const infortunioHours = isInfortunio ? hours : 0;
        const status =
            request.status === "approved"
                ? "Approvata"
                : request.status === "rejected"
                  ? "Rifiutata"
                  : request.status === "deleted"
                    ? "Eliminata"
                    : request.status || "";
        return {
            "Nome Operatore": request.employee || "",
            Reparto: request.department || "",
            "Data Inizio": startValue || "",
            "Data Fine": endValue || "",
            Ore: hours,
            "Ore Mutua": mutuaHours,
            "Ore Infortunio": infortunioHours,
            Tipo: getTypeLabel(request.type || ""),
            Stato: status,
            "Approvato da":
                isMutua || isInfortunio ? "" : request.approvedBy || "",
            "Inserito da":
                isMutua || isInfortunio ? request.approvedBy || "" : "",
            "Modificato da": request.modifiedBy || "",
            "Rifiutato da": request.rejectedBy || "",
            "Rifiutato il": request.rejectedAt
                ? new Date(request.rejectedAt)
                : "",
            "Eliminato da": request.deletedBy || "",
            "Eliminato il": request.deletedAt
                ? new Date(request.deletedAt)
                : "",
        };
    });
}

// Keep CommonJS compatibility for legacy JS callers
if (
    typeof module !== "undefined" &&
    module.exports &&
    !(globalThis as any).__aypiBundled
) {
    if (
        typeof module !== "undefined" &&
        module.exports &&
        !(globalThis as any).__aypiBundled
    )
        module.exports = { buildExportRows };
}
