type FilterKey =
    | "ferie"
    | "permesso"
    | "overtime"
    | "mutua"
    | "speciale"
    | "retribuito";

type FilterState = Record<FilterKey, boolean>;

interface CalendarFilterStateDependencies {
    document: Document;
    getStorage: () => Storage | null;
    filters: FilterState;
    isAdminLoggedIn: () => boolean;
    getAdminName: () => string;
    isAdminRequiredForFilter: (type: FilterKey) => boolean;
    render: () => void;
}

const FILTER_KEYS: FilterKey[] = [
    "ferie",
    "permesso",
    "overtime",
    "mutua",
    "speciale",
    "retribuito",
];
const TOGGLE_IDS: Record<FilterKey, string> = {
    ferie: "fp-filter-ferie",
    permesso: "fp-filter-permesso",
    overtime: "fp-filter-overtime",
    mutua: "fp-filter-mutua",
    speciale: "fp-filter-speciale",
    retribuito: "fp-filter-retribuito",
};
const GUEST_STORAGE_KEY = "fp-calendar-filters-guest";
const ADMIN_STORAGE_PREFIX = "fp-calendar-filters-admin:";

export function toFilterBoolean(value: unknown, fallback: boolean) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "on", "si"].includes(normalized)) return true;
        if (["false", "0", "off", "no"].includes(normalized)) return false;
    }
    return fallback;
}

export function createCalendarFilterState(
    dependencies: CalendarFilterStateDependencies,
) {
    function buildDefaults(): FilterState {
        return Object.fromEntries(
            FILTER_KEYS.map((key) => [
                key,
                !dependencies.isAdminRequiredForFilter(key),
            ]),
        ) as FilterState;
    }

    function getStorageKey() {
        const adminName = dependencies.getAdminName();
        if (dependencies.isAdminLoggedIn() && adminName) {
            return `${ADMIN_STORAGE_PREFIX}${adminName}`;
        }
        return GUEST_STORAGE_KEY;
    }

    function readStored(key = getStorageKey()) {
        try {
            const raw = dependencies.getStorage()?.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
            return null;
        }
    }

    function persist() {
        try {
            const payload = Object.fromEntries(
                FILTER_KEYS.map((key) => [
                    key,
                    Boolean(dependencies.filters[key]),
                ]),
            );
            dependencies
                .getStorage()
                ?.setItem(getStorageKey(), JSON.stringify(payload));
        } catch {
            // localStorage non disponibile
        }
    }

    function apply(state: Partial<Record<FilterKey, unknown>> | null) {
        const defaults = buildDefaults();
        const admin = dependencies.isAdminLoggedIn();
        FILTER_KEYS.forEach((key) => {
            const requested = toFilterBoolean(
                state?.[key],
                defaults[key],
            );
            const allowed =
                admin || !dependencies.isAdminRequiredForFilter(key);
            const value = allowed ? requested : false;
            dependencies.filters[key] = value;
            const toggle = dependencies.document.getElementById(
                TOGGLE_IDS[key],
            ) as HTMLInputElement | null;
            if (toggle) toggle.checked = value;
        });
        dependencies.render();
    }

    function applyDefaults() {
        apply(buildDefaults());
        persist();
    }

    function applyStored() {
        const stored = readStored();
        if (!stored) return false;
        apply(stored);
        return true;
    }

    return {
        buildDefaults,
        getStorageKey,
        readStored,
        persist,
        apply,
        applyDefaults,
        applyStored,
    };
}
