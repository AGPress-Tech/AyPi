// @ts-nocheck
export function setupLogin(context) {
    const { document } = context;
    let adminFailCount = 0;
    const loginButton = document.getElementById("pm-login-toggle");
    const closeButton = document.getElementById("pm-login-close");
    const employeeChoice = document.getElementById(
        "pm-login-choice-employee",
    );
    const adminChoice = document.getElementById("pm-login-choice-admin");
    const employeePanel = document.getElementById(
        "pm-login-employee-panel",
    );
    const adminPanel = document.getElementById("pm-login-admin-panel");
    const employeeConfirm = document.getElementById(
        "pm-login-employee-confirm",
    );
    const adminConfirm = document.getElementById("pm-login-admin-confirm");
    const adminError = document.getElementById("pm-login-admin-error");
    const adminRecover = document.getElementById("pm-login-admin-recover");
    const employeeDepartment = document.getElementById(
        "pm-login-department",
    );
    const employeeName = document.getElementById(
        "pm-login-employee-name",
    );
    const adminName = document.getElementById("pm-login-admin-name");
    const adminPassword = document.getElementById(
        "pm-login-admin-password",
    );

    const resetAdminError = () => {
        adminFailCount = 0;
        adminError?.classList.add("is-hidden");
        adminRecover?.classList.add("is-hidden");
    };
    const showAdminError = (message, allowRecovery = true) => {
        if (adminError) {
            adminError.textContent = message;
            adminError.classList.remove("is-hidden");
        }
        adminFailCount += 1;
        if (
            allowRecovery &&
            adminRecover &&
            adminFailCount >= 3
        ) {
            adminRecover.classList.remove("is-hidden");
        }
    };

    loginButton?.addEventListener("click", () => {
        if (context.isLoggedIn()) {
            context.openLogoutModal();
            return;
        }
        context.openLoginModal();
        resetAdminError();
    });
    closeButton?.addEventListener("click", () => {
        context.closeLoginModal();
        resetAdminError();
    });
    employeeChoice?.addEventListener("click", () => {
        employeePanel?.classList.remove("is-hidden");
        adminPanel?.classList.add("is-hidden");
        employeeChoice.classList.add("is-active");
        adminChoice?.classList.remove("is-active");
        resetAdminError();
    });
    adminChoice?.addEventListener("click", () => {
        adminPanel?.classList.remove("is-hidden");
        employeePanel?.classList.add("is-hidden");
        adminChoice.classList.add("is-active");
        employeeChoice?.classList.remove("is-active");
        resetAdminError();
    });

    employeeConfirm?.addEventListener("click", () => {
        const department = employeeDepartment?.value || "";
        const employee = employeeName?.value || "";
        if (!department || !employee) {
            context.showWarning(
                "Seleziona reparto e dipendente per accedere.",
            );
            return;
        }
        context.setSession({
            role: "employee",
            adminName: "",
            department,
            employee,
        });
        context.saveSession();
        context.syncSessionUI();
        context.closeLoginModal();
    });
    [employeeDepartment, employeeName].forEach((field) => {
        if (!field || !employeeConfirm) return;
        field.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            if (employeePanel?.classList.contains("is-hidden")) return;
            event.preventDefault();
            employeeConfirm.click();
        });
    });

    adminConfirm?.addEventListener(
        "click",
        context.asyncGuard.wrap(async () => {
            const name = adminName?.value || "";
            const password = adminPassword?.value || "";
            const defaultError = "Password errata.";
            adminError?.classList.add("is-hidden");
            adminRecover?.classList.add("is-hidden");
            if (!name || !password) {
                showAdminError(defaultError);
                return;
            }
            const verified = await context
                .verifyAdminPassword(password, name)
                .catch(() => null);
            if (!verified?.admin) {
                showAdminError(defaultError);
                return;
            }
            if (verified.admin.accessPurchasing === false) {
                showAdminError(
                    "Accesso admin non abilitato per Purchasing.",
                    false,
                );
                return;
            }
            resetAdminError();
            if (adminError) adminError.textContent = defaultError;
            context.setSession({
                role: "admin",
                adminName: verified.admin.name,
                department: "",
                employee: "",
            });
            context.saveSession();
            context.syncSessionUI();
            context.closeLoginModal();
        }),
    );
    [adminName, adminPassword].forEach((field) => {
        if (!field || !adminConfirm) return;
        field.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            if (adminPanel?.classList.contains("is-hidden")) return;
            event.preventDefault();
            adminConfirm.click();
        });
    });
    adminRecover?.addEventListener("click", context.openOtpModal);
}
