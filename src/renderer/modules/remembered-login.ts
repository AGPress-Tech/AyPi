import type {
    LoginPreferences,
    RememberedLogin,
} from "../../main/modules/login-preferences";
const STORAGE = "aypi.last-successful-login.v1";
function cached(): LoginPreferences {
    try {
        const value = JSON.parse(localStorage.getItem(STORAGE) || "{}");
        return value && typeof value === "object" && !Array.isArray(value)
            ? value
            : {};
    } catch {
        return {};
    }
}
export async function rememberSuccessfulLogin(
    name: string,
    department = "",
    role: "employee" | "admin" = "employee",
) {
    if (!name?.trim()) return;
    const value = { name: name.trim(), department: department.trim() };
    try {
        localStorage.setItem(
            STORAGE,
            JSON.stringify({ ...cached(), [role]: value }),
        );
    } catch {}
    window.dispatchEvent(
        new CustomEvent("aypi-login-remembered", { detail: { role, value } }),
    );
    try {
        await require("electron").ipcRenderer.invoke(
            "login-preferences-remember",
            role,
            value,
        );
    } catch {}
}

/** Only names are remembered. Lists, authentication and explicit user changes keep their normal lifecycle. */
export function installRememberedLogins() {
    const profiles = [
        {
            role: "employee",
            department: "loginDepartment",
            name: "loginEmployee",
        },
        {
            role: "employee",
            department: "pm-login-department",
            name: "pm-login-employee-name",
        },
        {
            role: "employee",
            department: "warehouseLoginDepartment",
            name: "warehouseLoginEmployee",
        },
        { role: "admin", name: "pm-login-admin-name" },
        { role: "admin", name: "warehouseLoginAdmin" },
        { role: "admin", name: "fp-login-admin-name" },
    ] as const;
    let preferences = cached(),
        restoring = false,
        generation = 0,
        touched = new WeakSet<Element>();
    const knownFields = new WeakSet<Element>(),
        visibility = new WeakMap<Element, boolean>();
    const roots =
        "#loginDialog,#pm-login-modal,#warehouseLoginDialog,#fp-approval-modal";
    function refresh() {
        const version = generation;
        void require("electron")
            .ipcRenderer.invoke("login-preferences-read")
            .then((value: LoginPreferences) => {
                if (
                    version === generation &&
                    value &&
                    typeof value === "object"
                ) {
                    preferences = { ...preferences, ...value };
                    restore();
                }
            })
            .catch(() => {});
    }
    function restore() {
        for (const root of document.querySelectorAll<HTMLElement>(roots)) {
            const style = getComputedStyle(root),
                open =
                    root instanceof HTMLDialogElement
                        ? root.open
                        : !root.hidden &&
                          root.getAttribute("aria-hidden") !== "true" &&
                          style.display !== "none" &&
                          style.visibility !== "hidden";
            if (open && visibility.get(root) === false) {
                touched = new WeakSet();
                generation++;
                refresh();
            }
            visibility.set(root, open);
        }
        for (const profile of profiles) {
            const name = document.getElementById(
                profile.name,
            ) as HTMLSelectElement | null;
            const saved = preferences[profile.role] as RememberedLogin;
            if (name && !knownFields.has(name)) {
                knownFields.add(name);
                refresh();
            }
            if (!name || !saved?.name || touched.has(name)) continue;
            const department =
                "department" in profile
                    ? (document.getElementById(
                          profile.department,
                      ) as HTMLSelectElement | null)
                    : null;
            restoring = true;
            try {
                if (
                    department &&
                    !touched.has(department) &&
                    saved.department &&
                    [...department.options].some(
                        (o) => o.value === saved.department,
                    )
                ) {
                    if (department.value !== saved.department) {
                        department.value = saved.department;
                        department.dispatchEvent(
                            new Event("change", { bubbles: true }),
                        );
                    }
                }
                if (
                    department &&
                    saved.department &&
                    department.value !== saved.department
                )
                    continue;
                if (
                    [...name.options].some(
                        (o) => o.value === saved.name && !o.disabled,
                    )
                ) {
                    if (name.value !== saved.name) {
                        name.value = saved.name;
                        name.dispatchEvent(
                            new Event("change", { bubbles: true }),
                        );
                    }
                }
            } finally {
                restoring = false;
            }
        }
    }
    document.addEventListener(
        "change",
        (event) => {
            if (!restoring && event.target instanceof Element)
                touched.add(event.target);
        },
        true,
    );
    document.addEventListener(
        "submit",
        (event) => {
            for (const profile of profiles) {
                const name = document.getElementById(profile.name);
                if (!name || name.closest("form") !== event.target) continue;
                touched.add(name);
                if ("department" in profile) {
                    const department = document.getElementById(
                        profile.department,
                    );
                    if (department) touched.add(department);
                }
            }
        },
        true,
    );
    document.addEventListener(
        "close",
        (event) => {
            const root = event.target as HTMLElement;
            if (!root.matches?.(roots)) return;
            visibility.set(root, false);
            if (root instanceof HTMLDialogElement && root.open) restore();
        },
        true,
    );
    new MutationObserver(restore).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["open", "aria-hidden", "class", "hidden", "style"],
    });
    restore();
    window.addEventListener("aypi-login-remembered", (event: CustomEvent) => {
        generation++;
        preferences = {
            ...preferences,
            [event.detail.role]: event.detail.value,
        };
    });
    window.addEventListener("storage", (event) => {
        if (event.key === STORAGE) {
            preferences = cached();
            restore();
        }
    });
}
