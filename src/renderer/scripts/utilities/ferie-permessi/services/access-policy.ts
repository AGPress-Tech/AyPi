// @ts-nocheck
export function createCalendarAccessPolicy(context) {
    const getOperations = () => context.getConfig()?.operations || {};

    async function load() {
        const payload = await context.request(
            "/api/shared/calendar-access-config",
        );
        return context.normalize(payload);
    }

    async function persist(next) {
        const normalized = context.normalize(next);
        const payload = await context.request(
            "/api/shared/calendar-access-config",
            { method: "PUT", body: normalized },
        );
        const saved = context.normalize(payload?.data || next);
        context.setConfig(saved);
        return saved;
    }

    function create(type) {
        const key = type === "infortunio" ? "mutua" : type;
        return Boolean(getOperations().create?.[key]);
    }

    function filter(type) {
        const key = type === "overtime" ? "straordinari" : type;
        return Boolean(getOperations().filters?.[key]);
    }

    const pendingAccess = () =>
        Boolean(getOperations().pending?.access);
    const pendingApprove = () =>
        Boolean(getOperations().pending?.approve);
    const pendingReject = () =>
        Boolean(getOperations().pending?.reject);
    const editApproved = () =>
        Boolean(getOperations().editApproved);
    const deleteApproved = () =>
        Boolean(getOperations().deleteApproved);
    const manageAccess = () =>
        Boolean(getOperations().manageAccess);
    const daysAccess = () => Boolean(getOperations().daysAccess);
    const exportData = () => Boolean(getOperations().export);

    function action(actionValue) {
        const type = actionValue?.type || "";
        if (type === "mutua-create") return create("mutua");
        if (type === "infortunio-create") return create("infortunio");
        if (
            type === "retribuito-create" ||
            type === "giustificato-create"
        ) {
            return create("retribuito");
        }
        if (type === "speciale-create") return create("speciale");
        if (
            type === "holiday-create" ||
            type === "holiday-remove" ||
            type === "holiday-update" ||
            type === "closure-create" ||
            type === "closure-remove" ||
            type === "closure-update" ||
            type === "days-access"
        ) {
            return daysAccess();
        }
        if (type === "export") return exportData();
        if (
            type === "manage-access" ||
            type === "assignees-access"
        ) {
            return manageAccess();
        }
        return true;
    }

    return {
        load,
        persist,
        create,
        filter,
        pendingAccess,
        pendingApprove,
        pendingReject,
        editApproved,
        deleteApproved,
        manageAccess,
        daysAccess,
        exportData,
        action,
    };
}
