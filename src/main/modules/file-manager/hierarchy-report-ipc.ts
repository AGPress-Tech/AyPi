import { app, BrowserWindow, dialog, ipcMain } from "electron";
import fs from "fs";
import path from "path";
import log from "electron-log";

type HierarchyReportBuilders = {
    buildHtml: () => string;
    buildCss: () => string;
    buildJs: (data: unknown) => string;
};

function resolveTemplateDirectory() {
    const candidates = [
        path.join(app.getAppPath(), "templates"),
        path.join(__dirname, "..", "..", "templates"),
    ];
    return candidates.find((candidate) =>
        fs.existsSync(path.join(candidate, "hierarchy-report.html")),
    );
}

function writeTemplateAssets(
    reportDir: string,
    data: unknown,
    paths: {
        html: string;
        css: string;
        js: string;
        chart: string;
    },
) {
    const templateDir = resolveTemplateDirectory();
    if (!templateDir) {
        throw new Error("Template del report gerarchia non trovati.");
    }

    const htmlTemplate = fs.readFileSync(
        path.join(templateDir, "hierarchy-report.html"),
        "utf8",
    );
    const cssContent = fs.readFileSync(
        path.join(templateDir, "hierarchy-report.css"),
        "utf8",
    );
    const jsTemplate = fs.readFileSync(
        path.join(templateDir, "hierarchy-report.js"),
        "utf8",
    );
    const jsContent =
        `const REPORT_DATA = ${JSON.stringify(data, null, 2)};\n\n` +
        jsTemplate;

    fs.writeFileSync(paths.html, htmlTemplate, "utf8");
    fs.writeFileSync(paths.css, cssContent, "utf8");
    fs.writeFileSync(paths.js, jsContent, "utf8");

    try {
        const chartMainPath = require.resolve("chart.js");
        const chartSourcePath = path.join(
            path.dirname(chartMainPath),
            "chart.umd.js",
        );
        fs.copyFileSync(chartSourcePath, paths.chart);
    } catch (err) {
        log.warn(
            "[hierarchy] impossibile copiare chart.js per il report navigabile:",
            err,
        );
    }

    return reportDir;
}

export function registerHierarchyReportIpc(
    mainWindow: BrowserWindow,
    fallbackBuilders: HierarchyReportBuilders,
) {
    ipcMain.handle(
        "hierarchy-export-navigable-report",
        async (event, payload) => {
            try {
                const parentWindow =
                    BrowserWindow.fromWebContents(event.sender) || mainWindow;
                if (!payload?.data) {
                    throw new Error("Dati report non validi.");
                }

                const data = payload.data;
                const rootPath = data.meta?.rootPath || "";
                const rootNameRaw = rootPath
                    ? path.basename(rootPath.replace(/[\\/]+$/, ""))
                    : "root";
                const rootName = rootNameRaw || "root";
                const result = await dialog.showSaveDialog(parentWindow, {
                    title: "Salva report navigabile",
                    defaultPath: `Report ${rootName}.html`,
                    filters: [{ name: "File HTML", extensions: ["html"] }],
                });

                if (result.canceled || !result.filePath) {
                    return { canceled: true };
                }

                const reportDir = path.join(
                    path.dirname(result.filePath),
                    `Report ${rootName}`,
                );
                fs.mkdirSync(reportDir, { recursive: true });

                const paths = {
                    html: path.join(reportDir, "report-gerarchia.html"),
                    json: path.join(reportDir, "report-data.json"),
                    js: path.join(reportDir, "report.js"),
                    css: path.join(reportDir, "report.css"),
                    chart: path.join(reportDir, "chart.umd.js"),
                };
                fs.writeFileSync(
                    paths.json,
                    JSON.stringify(data, null, 2),
                    "utf8",
                );

                try {
                    writeTemplateAssets(reportDir, data, paths);
                } catch (templateErr) {
                    log.error(
                        "[hierarchy] errore durante la generazione del report navigabile da template:",
                        templateErr,
                    );
                    fs.writeFileSync(
                        paths.html,
                        fallbackBuilders.buildHtml(),
                        "utf8",
                    );
                    fs.writeFileSync(
                        paths.css,
                        fallbackBuilders.buildCss(),
                        "utf8",
                    );
                    fs.writeFileSync(
                        paths.js,
                        fallbackBuilders.buildJs(data),
                        "utf8",
                    );
                }

                return {
                    canceled: false,
                    htmlPath: paths.html,
                    jsonPath: paths.json,
                };
            } catch (err) {
                log.error("[hierarchy] export-navigable-report error", err);
                return {
                    canceled: false,
                    error: err instanceof Error ? err.message : String(err),
                };
            }
        },
    );
}
