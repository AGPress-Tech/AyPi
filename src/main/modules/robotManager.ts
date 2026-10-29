import { setupFornoReader } from './fornoReader';
import { setupForgeHub } from './forgeHub';
// Importa moduli necessari
import { ipcMain } from "electron";
import { execFile } from "child_process";
import { toMAC } from "@network-utils/arp-lookup";

type RobotConfig = { ip: string; mac: string };

const ROBOTS: Record<string, RobotConfig> = {
    "21D500": { ip: "192.168.1.153", mac: "00:03:1d:12:0f:71" },
    "21D600": { ip: "192.168.1.152", mac: "00:03:1d:11:62:da" },
    "21D850": { ip: "192.168.1.92",  mac: "00:03:1d:14:13:38" }
};

const ROBOT_CUSTOM_TIMEOUT_MS = 12000;

type RobotStatusResult = {
    ok: boolean;
    robotId: string;
    ip?: string;
    error?: string;
    program?: string;
    state?: string;
    counter?: string;
    cycleTime?: string;
    details?: string;
};

type RobotPingResult = {
    ok: boolean;
    robotId: string;
    ip?: string;
    reachable?: boolean;
    summary?: string;
    expectedMac?: string;
    detectedMac?: string | null;
    macConflict?: boolean;
    error?: string;
};

function estraiTesto(testo: string, chiave: string) {
    const testoUpper = testo.toUpperCase();
    const chiaveUpper = chiave.toUpperCase();

    const idx = testoUpper.indexOf(chiaveUpper);
    if (idx === -1) return null;

    const dopo = testo.slice(idx + chiave.length).trim();
    return dopo.split("\n")[0].replace("[","").replace("]","").trim();
}

function estraiPrimaParola(testo: string, chiave: string) {
    const risultato = estraiTesto(testo, chiave);
    if (!risultato) return null;
    return risultato.split(" ")[0].trim();
}

function estraiRigaSubitoDopo(testo: string, chiave: string) {
    const testoUpper = testo.toUpperCase();
    const chiaveUpper = chiave.toUpperCase();

    const idx = testoUpper.indexOf(chiaveUpper);
    if (idx === -1) return null;

    const dopo = testo.slice(idx + chiave.length);
    const righe = dopo.split("\n");

    let riga = righe[3] ? righe[3].replace("[","").replace("]","").replace(/'/g, "").trim() : null;
    if (!riga) return null;

    riga = riga.replace(/\s+/g, " ");
    riga = riga.charAt(0).toUpperCase() + riga.slice(1).toLowerCase();

    return riga;
}

async function getMacForIP(ip: string) {
    try {
        return await toMAC(ip);
    } catch {
        return null;
    }
}

async function getRobotStatus(
    robotId: string,
    url: string,
    chiaveStato: string,
): Promise<RobotStatusResult> {
    const config = ROBOTS[robotId];
    if (!config || !url || !chiaveStato) {
        return {
            ok: false,
            robotId,
            error: "Configurazione robot non valida.",
        };
    }

    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        ROBOT_CUSTOM_TIMEOUT_MS,
    );
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Pagina non raggiungibile (${response.status})`);
        }
        const html = await response.text();
        const cleanText = html
            .replace(/<[^>]*>/g, "\n")
            .replace(/\r/g, "")
            .trim();
        return {
            ok: true,
            robotId,
            ip: config.ip,
            program:
                estraiTesto(cleanText, "Programma di lavoro:") || "Non trovato",
            state: estraiTesto(cleanText, chiaveStato) || "Non trovato",
            counter: estraiPrimaParola(cleanText, "PEZZI NUMERO") || undefined,
            cycleTime:
                estraiPrimaParola(cleanText, "TEMPO CICLO") || undefined,
            details:
                estraiRigaSubitoDopo(cleanText, "PEZZI NUMERO") || undefined,
        };
    } catch (error) {
        const timedOut =
            error instanceof Error && error.name === "AbortError";
        return {
            ok: false,
            robotId,
            ip: config.ip,
            error: timedOut
                ? "Tempo di risposta scaduto. Il robot potrebbe essere spento o scollegato."
                : "Robot non individuato. Verifica alimentazione, rete e disponibilità della porta.",
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function pingRobot(robotId: string): Promise<RobotPingResult> {
    const config = ROBOTS[robotId];
    if (!config) {
        return {
            ok: false,
            robotId,
            error: "Robot non riconosciuto.",
        };
    }

    return new Promise((resolve) => {
        execFile(
            "ping",
            ["-n", "1", config.ip],
            { timeout: ROBOT_CUSTOM_TIMEOUT_MS },
            async (error, stdout) => {
                const lines = String(stdout || "")
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean);
                const summary =
                    lines.find((line) =>
                        /Persi\s*=|Lost\s*=|Minimum\s*=|Minimo\s*=/i.test(
                            line,
                        ),
                    ) ||
                    lines.at(-1) ||
                    "Nessuna risposta ricevuta.";
                const reachable =
                    !error && /(?:Persi|Lost)\s*=\s*0/i.test(stdout || "");
                const detectedMac = reachable
                    ? await getMacForIP(config.ip)
                    : null;
                const macConflict =
                    !!detectedMac &&
                    detectedMac.toLowerCase() !== config.mac.toLowerCase();

                resolve({
                    ok: true,
                    robotId,
                    ip: config.ip,
                    reachable,
                    summary,
                    expectedMac: config.mac,
                    detectedMac,
                    macConflict,
                });
            },
        );
    });
}

function setupRobotManager() {
    setupFornoReader();
    setupForgeHub();
    ipcMain.handle(
        "robot-status-custom",
        async (
            _event,
            robotId: string,
            url: string,
            chiaveStato: string,
        ) => getRobotStatus(robotId, url, chiaveStato),
    );

    ipcMain.handle("ping-robot-custom", async (_event, robotId: string) =>
        pingRobot(robotId),
    );
}

export { setupRobotManager, getRobotStatus };
