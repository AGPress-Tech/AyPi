// Nomi dal wiring iTools comunicato dall'operatore; nessuna deduzione sul feedback fisico.
const events = [
    {
        short: "Apertura saracinesca",
        name: "Apertura saracinesca (ON = apre)",
        terminal: "3A3B",
    },
    { short: "Aspiratore", name: "Marcia aspiratore", terminal: "RELAY_4AC" },
    { short: "Scambiatore", name: "Marcia scambiatore", terminal: "RELAY_5AC" },
];
export const eventLabel = (index: number) =>
    `E${index + 1}${events[index] ? " · " + events[index].short : ""}`;
export const eventDescription = (index: number) =>
    events[index]
        ? `E${index + 1} · ${events[index].name} (${events[index].terminal})`
        : `Evento ${index + 1}`;
