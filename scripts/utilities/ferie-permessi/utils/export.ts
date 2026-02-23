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
    approvedBy?: string;
    modifiedBy?: string;
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
    closures: ClosureLike[] | null | undefined
) {
    return requests.map((request) => {
        const { startValue, endValue } = getExportDates(request);
        const hours = calculateHours(request, holidays, closures);
        const isMutua = request.type === "mutua";
        const mutuaHours = isMutua ? hours : 0;
        return {
            "Nome Operatore": request.employee || "",
            Reparto: request.department || "",
            "Data Inizio": startValue || "",
            "Data Fine": endValue || "",
            Ore: hours,
            "Ore Mutua": mutuaHours,
            Tipo: getTypeLabel(request.type),
            "Approvato da": isMutua ? "" : request.approvedBy || "",
            "Inserito da": isMutua ? request.approvedBy || "" : "",
            "Modificato da": request.modifiedBy || "",
        };
    });
}

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { buildExportRows };
}


