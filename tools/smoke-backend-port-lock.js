const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const workspaceRoot = path.resolve(__dirname, "..");
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aypi-port-lock-"));
const generalDir = path.join(testRoot, "General");
const logDir = path.join(testRoot, "logs");
const dbPath = path.join(testRoot, "data", "aypi.db");
const blocker = net.createServer();

function cleanup() {
    fs.rmSync(testRoot, { recursive: true, force: true });
}

function fail(message, output = "") {
    console.error(message);
    if (output) console.error(output);
    cleanup();
    process.exit(1);
}

blocker.on("error", (error) => {
    fail(`Impossibile preparare il test: ${error.message}`);
});

blocker.listen(0, "127.0.0.1", () => {
    const address = blocker.address();
    if (!address || typeof address === "string") {
        blocker.close();
        fail("Il test non ha ottenuto una porta TCP.");
        return;
    }

    const child = spawn(process.execPath, ["backend-dist/server.js"], {
        cwd: workspaceRoot,
        env: {
            ...process.env,
            AYPI_BACKEND_PROFILE: "dev",
            AYPI_BACKEND_HOST: "127.0.0.1",
            AYPI_BACKEND_ADVERTISED_HOST: "127.0.0.1",
            AYPI_BACKEND_PORT: String(address.port),
            AYPI_FP_GENERAL_DIR: generalDir,
            AYPI_LOG_DIR: logDir,
            AYPI_DB_PATH: dbPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
        output += chunk;
    });
    child.stderr.on("data", (chunk) => {
        output += chunk;
    });
    child.on("error", (error) => {
        blocker.close();
        fail(`Impossibile avviare il backend di test: ${error.message}`, output);
    });
    child.on("close", (code) => {
        blocker.close(() => {
            const touchedPaths = [generalDir, logDir, dbPath].filter((item) =>
                fs.existsSync(item),
            );
            const sawPortConflict =
                /EADDRINUSE|address already in use/i.test(output);

            if (code === 0 || !sawPortConflict || touchedPaths.length > 0) {
                fail(
                    `Regressione port-lock: exit=${code}, storage=${JSON.stringify(
                        touchedPaths,
                    )}`,
                    output,
                );
                return;
            }

            cleanup();
            console.log(
                "OK: la seconda istanza non inizializza né persiste SQLite.",
            );
        });
    });
});
