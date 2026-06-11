export type RequestLike = {
    id?: string;
    employee?: string | { name?: string };
    department?: string;
    type?: string;
    note?: string;
    status?: string;
    start?: string | null;
    end?: string | null;
    allDay?: boolean;
    createdAt?: string;
    updatedAt?: string;
    approvedAt?: string;
    balanceHours?: number;
    balanceAppliedAt?: string | null;
    approvedBy?: string;
    modifiedAt?: string;
    modifiedBy?: string;
    rejectedAt?: string;
    rejectedBy?: string;
    deletedAt?: string;
    deletedBy?: string;
};

export type BalanceEntry = {
    hoursAvailable: number;
    lastAccrualMonth?: string;
    monthlyAccrualHours?: number;
    employee?: string;
    department?: string;
    employeeEmail?: string;
    closureAppliedMonth?: string;
    closureAppliedHours?: number;
    inactive?: boolean;
    previousKeys?: string[];
};

export type HolidayLike = { date?: string; name?: string } | string;
export type ClosureLike = { start?: string; end?: string; name?: string } | string;
export type HolidayEntry = { date: string; name?: string };
export type ClosureEntry = { start: string; end?: string; name?: string };

export type FpPayload = {
    requests: RequestLike[];
    balances: Record<string, BalanceEntry>;
    holidays: HolidayLike[];
    closures: ClosureLike[];
};

export type AssigneesPayload = {
    groups: Record<string, string[]>;
    options: string[];
    emails: Record<string, string>;
};
