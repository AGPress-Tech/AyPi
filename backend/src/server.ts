import { startBackendServer } from "./app";

let handlePromise = startBackendServer();

handlePromise.catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

async function shutdown() {
    try {
        const handle = await handlePromise;
        await handle.stop();
    } catch {
        // ignore shutdown failures while process is exiting
    } finally {
        process.exit(0);
    }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
