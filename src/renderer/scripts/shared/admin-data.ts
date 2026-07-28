export type AdminEntry = {
    name: string;
    password?: string;
    passwordHash?: string;
    email: string;
    phone: string;
    accessCalendar: boolean;
    accessPurchasing: boolean;
};

export function normalizeAdminEntry(item: any): AdminEntry {
    return {
        name: String(item?.name || "").trim(),
        password: item?.password ? String(item.password) : undefined,
        passwordHash: item?.passwordHash
            ? String(item.passwordHash)
            : undefined,
        email: item?.email ? String(item.email) : "",
        phone: item?.phone ? String(item.phone) : "",
        accessCalendar:
            typeof item?.accessCalendar === "boolean"
                ? item.accessCalendar
                : true,
        accessPurchasing:
            typeof item?.accessPurchasing === "boolean"
                ? item.accessPurchasing
                : true,
    };
}
