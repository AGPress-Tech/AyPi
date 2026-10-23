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

export type MesUnit = "pz" | "kg";
export type MesPriority = "NORMAL" | "HIGH" | "URGENT";
export type MesOrderStatus = "OPEN" | "COMPLETED" | "CANCELLED";
export type MesPlanningStatus = "BACKLOG" | "SCHEDULED" | "ARCHIVED";
export type MesExecutionStatus =
    | "NOT_STARTED"
    | "SETUP"
    | "RUNNING"
    | "PAUSED"
    | "COMPLETED"
    | "CANCELLED";

export type MesOrder = {
    orderId: string;
    orderNumber: string;
    customer: string;
    articleCode: string;
    targetQuantity: number;
    unit: MesUnit;
    firstDeliveryAt: string;
    dueAt: string;
    priority: MesPriority;
    notes: string;
    status: MesOrderStatus;
    revision: number;
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
};

export type MesPhase = {
    phaseId: string;
    orderId: string;
    phaseCode: string;
    sequence: number;
    articleCode: string;
    targetQuantity: number;
    unit: MesUnit;
    standardCycleSeconds: number;
    plannedSetupSeconds: number;
    plannedMachineId: string;
    scheduledStart: string;
    scheduledEnd: string;
    planningStatus: MesPlanningStatus;
    executionStatus: MesExecutionStatus;
    revision: number;
    createdAt: string;
    createdBy: string;
    updatedAt: string;
    updatedBy: string;
    plannedDurationSeconds: number;
};

export type MesOrderDetail = MesOrder & { phases: MesPhase[] };

export type MesOrderDraft = Omit<
    MesOrder,
    "orderId" | "revision" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy"
>;

export type MesPhaseDraft = Omit<
    MesPhase,
    "phaseId" | "orderId" | "revision" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "plannedDurationSeconds"
>;

export type MesSessionMode = "PRODUCTION" | "SETUP";
export type MesSessionStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED";
export type MesUnassignedChoice = "ATTRIBUTE_ALL" | "EXCLUDE_ALL" | "PARTIAL";

export type MesMachineSession = {
    sessionId: string;
    phaseId: string;
    orderId: string;
    orderNumber: string;
    phaseCode: string;
    articleCode: string;
    machineId: string;
    mode: MesSessionMode;
    status: MesSessionStatus;
    startedAt: string;
    endedAt: string;
    startedBy: string;
    endedBy: string;
    notes: string;
    revision: number;
    automaticPieces: number;
    openingPieces: number;
    setupPieces: number;
    goodPieces: number;
    targetQuantity: number;
    progressPercent: number;
    standardCycleSeconds: number;
    averageCycleSeconds: number | null;
    lastCycleSeconds: number | null;
};

export type MesActivationPreview = {
    machineId: string;
    phaseId: string;
    unassignedPieces: number;
    unassignedEvents: number;
    firstUnassignedAt: string;
    lastUnassignedAt: string;
    activeSession: MesMachineSession | null;
    lastClosedSession: MesMachineSession | null;
};

