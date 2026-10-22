export type MesEventSource = "PLC_CSV" | "PLC_SQLITE" | "ROBOT" | "DEMO";

export type MachineCounterEvent = {
    eventId: string;
    source: MesEventSource;
    sourceSessionId: string;
    sourcePosition: string;
    machineId: string;
    occurredAt: string;
    receivedAt: string;
    pulseDelta: number;
    pieceDelta: number;
    multiplier: number;
    signal?: {
        mac?: string;
        frameId?: string;
        byte?: number;
        bit?: number;
    };
    raw?: Record<string, unknown>;
};

export type PlcCsvImportIssue = {
    row: number;
    message: string;
};

export type PlcCsvImportPayload = {
    sourceSessionId: string;
    sourceFile: string;
    csv: string;
    firstDataRow?: number;
};

export type PlcCsvParseResult = {
    events: MachineCounterEvent[];
    totalRows: number;
    rejectedRows: number;
    issues: PlcCsvImportIssue[];
};

export type MesImportResult = {
    importId: string;
    source: MesEventSource;
    sourceSessionId: string;
    sourceFile: string;
    totalRows: number;
    validRows: number;
    insertedEvents: number;
    duplicateEvents: number;
    rejectedRows: number;
    issues: PlcCsvImportIssue[];
    importedAt: string;
};

