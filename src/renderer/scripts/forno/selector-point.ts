export type SelectorPoint = {
    id: string;
    timestampMs: number;
    type: string;
    label: string;
};
export type SelectorPhases = {
    from?: string;
    to?: string;
    fromId?: string;
    toId?: string;
};

export type PhaseInfo = {
    kind: string;
    durationMs?: number | null;
    fromTemperature?: number | null;
    toTemperature?: number | null;
    status?: string;
};

export function technicalPhaseLabel(info: PhaseInfo) {
    if (info.kind === "Reset ciclo") return info.kind;
    const number = (value: number) =>
        value.toLocaleString("it-IT", { maximumFractionDigits: 1 });
    const from = info.fromTemperature,
        to = info.toTemperature;
    const temperatures =
        from != null && to != null
            ? Math.abs(from - to) < 0.05
                ? number(from)
                : `${number(from)} → ${number(to)}`
            : from != null
              ? `${number(from)} → n/d`
              : to != null
                ? `n/d → ${number(to)}`
                : null;
    let duration = "durata non disponibile";
    if (info.durationMs != null) {
        const seconds = Math.round(info.durationMs / 100) / 10;
        const hours = Math.floor(seconds / 3600),
            minutes = Math.floor((seconds % 3600) / 60);
        const rest = seconds % 60;
        duration =
            "durata effettiva " +
            [
                hours ? `${hours} h` : "",
                minutes ? `${minutes} min` : "",
                rest || (!hours && !minutes) ? `${number(rest)} s` : "",
            ]
                .filter(Boolean)
                .join(" ");
    } else if (info.status === "interrupted")
        duration = "rilevazione interrotta";
    else if (info.status === "open")
        duration = "fine fase non ancora registrata";
    return `${info.kind} · ${temperatures ? `T rilevata ${temperatures} °C` : "T non disponibile"} · ${duration}`;
}

/** Show the recorded technical type while archive details are being loaded. */
export function selectorLabel(event: {
    type: string;
    message: string;
    detail?: { program?: string; segment?: string; segmentType?: number };
}) {
    return event.type === "program_reset"
        ? "Reset ciclo"
        : (["Fine ciclo", "Rampa", "Stasi", "Gradino", "Attesa", "Ripetizione"][
              event.detail?.segmentType
          ] || "Fase") + " · caricamento temperatura e durata…";
}
