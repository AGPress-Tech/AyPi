// A launcher or terminal can disappear while Electron is still running.
// Losing its log pipe must not interrupt IPC replies or display a fatal dialog.
export function handleStdioError(error: NodeJS.ErrnoException) {
    if (error.code === "EPIPE") return;
    throw error;
}

process.stdout.on("error", handleStdioError);
process.stderr.on("error", handleStdioError);
