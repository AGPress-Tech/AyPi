export type CalendarRequestInput = {
    department: string;
    employee: string;
    type: string;
    allDay: boolean;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    note: string;
};

type RequestMessages = {
    requestMissingFields: string;
    requestInvalidDateFormat: string;
    requestNoPastDates: string;
    requestEndBeforeStart: string;
    requestMultiDayAllDayOnly: string;
    requestMissingTimes: string;
    requestEndTimeBeforeStart: string;
};

type BuildRequestOptions = {
    requestId?: string | null;
    messages: RequestMessages;
    now?: Date;
    random?: () => number;
};

function parseStrictDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function buildCalendarRequest(
    input: CalendarRequestInput,
    options: BuildRequestOptions,
) {
    const {
        department,
        employee,
        type = "ferie",
        allDay,
        startDate,
        endDate,
        startTime,
        endTime,
        note,
    } = input;
    const { messages, requestId } = options;
    const now = options.now || new Date();

    if (!employee || !startDate || !endDate) {
        return { error: messages.requestMissingFields };
    }

    const todayMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
    );
    const maxYear = now.getFullYear() + 2;
    const startParsed = parseStrictDate(startDate);
    const endParsed = parseStrictDate(endDate);
    if (!startParsed || !endParsed) {
        return { error: messages.requestInvalidDateFormat };
    }
    if (
        startParsed.getFullYear() > maxYear ||
        endParsed.getFullYear() > maxYear
    ) {
        return { error: `L'anno non puo superare ${maxYear}.` };
    }

    const acceptsPastDates = new Set([
        "straordinari",
        "mutua",
        "infortunio",
        "retribuito",
        "speciale",
    ]).has(type);
    if (
        !acceptsPastDates &&
        (startParsed < todayMidnight || endParsed < todayMidnight)
    ) {
        return { error: messages.requestNoPastDates };
    }
    if (endParsed < startParsed) {
        return { error: messages.requestEndBeforeStart };
    }
    if (!allDay && startDate !== endDate) {
        return { error: messages.requestMultiDayAllDayOnly };
    }

    const random = options.random || Math.random;
    const id =
        requestId ||
        `${now.getTime()}-${random().toString(16).slice(2, 8)}`;
    const common = {
        id,
        employee,
        department,
        type,
        note,
        status: requestId ? "approved" : "pending",
        ...(requestId ? {} : { createdAt: now.toISOString() }),
    };

    if (!allDay) {
        if (!startTime || !endTime) {
            return { error: messages.requestMissingTimes };
        }
        const start = `${startDate}T${startTime}`;
        const end = `${endDate}T${endTime}`;
        if (end < start) {
            return { error: messages.requestEndTimeBeforeStart };
        }
        return {
            request: {
                ...common,
                allDay: false,
                start,
                end,
            },
        };
    }

    return {
        request: {
            ...common,
            allDay: true,
            start: startDate,
            end: endDate,
        },
    };
}
