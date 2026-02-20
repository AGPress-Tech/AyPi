require("../shared/dev-guards");
import { ipcRenderer } from "electron";
import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import bwipjs from "bwip-js";
const { showInfo, showWarning, showError } = require("../shared/dialogs");

let lastPngBuffer: Buffer | null = null;

const getEl = (id: string) => document.getElementById(id);

window.addEventListener("DOMContentLoaded", () => {
    const contentInput = getEl("contentInput") as HTMLInputElement | null;
    const typeSelect = getEl("typeSelect") as HTMLSelectElement | null;
    const sizeInput = getEl("sizeInput") as HTMLInputElement | null;
    const marginInput = getEl("marginInput") as HTMLInputElement | null;
    const barcodeHeightInput = getEl(
        "barcodeHeight",
    ) as HTMLInputElement | null;
    const barcodeShowTextInput = getEl(
        "barcodeShowText",
    ) as HTMLInputElement | null;
    const barcodeExtraOptions = getEl(
        "barcodeExtraOptions",
    ) as HTMLElement | null;

    const btnGenerate = getEl("btnGenerate") as HTMLButtonElement | null;
    const btnSave = getEl("btnSave") as HTMLButtonElement | null;
    const btnClose = getEl("btnClose") as HTMLButtonElement | null;
    const previewImage = getEl("previewImage") as HTMLImageElement | null;
    const previewPlaceholder = getEl(
        "previewPlaceholder",
    ) as HTMLElement | null;

    console.log("qr-generator-scripts.js caricato ✔");

    function updateOptionsVisibility() {
        if (!typeSelect || !barcodeExtraOptions) return;
        const type = typeSelect.value;
        if (type === "barcode") {
            barcodeExtraOptions.style.display = "block";
        } else {
            barcodeExtraOptions.style.display = "none";
        }
    }

    if (typeSelect) {
        typeSelect.addEventListener("change", updateOptionsVisibility);
    }
    updateOptionsVisibility(); // inizializza

    btnGenerate?.addEventListener("click", async () => {
        if (
            !contentInput ||
            !typeSelect ||
            !sizeInput ||
            !marginInput ||
            !previewImage ||
            !previewPlaceholder ||
            !btnSave
        ) {
            return;
        }
        const content = (contentInput.value || "").trim();
        const type = typeSelect.value;
        const size = parseInt(sizeInput.value || "256", 10);
        const margin = parseInt(marginInput.value || "4", 10);

        if (!content) {
            await showWarning("Inserisci un contenuto da codificare.");
            return;
        }

        if (type === "qr") {
            try {
                const opts = {
                    type: "png",
                    width: size,
                    margin: margin,
                    errorCorrectionLevel: "M",
                };

                lastPngBuffer = await QRCode.toBuffer(content, opts);

                const base64 = lastPngBuffer
                    ? lastPngBuffer.toString("base64")
                    : "";
                previewImage.src = `data:image/png;base64,${base64}`;
                previewImage.style.display = "inline-block";
                previewPlaceholder.style.display = "none";

                btnSave.disabled = false;
            } catch (err) {
                console.error("Errore nella generazione del QR:", err);
                const message =
                    err instanceof Error ? err.message : String(err);
                await showError(
                    "Errore nella generazione del QR code.",
                    message,
                );
            }
        } else if (type === "barcode") {
            try {
                if (!barcodeHeightInput || !barcodeShowTextInput) return;
                const height = parseInt(barcodeHeightInput.value || "10", 10);
                const showText = barcodeShowTextInput.checked;

                const scale = Math.max(1, Math.min(10, Math.round(size / 80)));

                const pngBuffer = await bwipjs.toBuffer({
                    bcid: "code128",
                    text: content,
                    scale: scale,
                    height: Math.max(5, Math.min(50, height)),
                    includetext: showText,
                    textxalign: "center",
                    backgroundcolor: "FFFFFF",
                });

                lastPngBuffer = pngBuffer;

                const base64 = lastPngBuffer
                    ? lastPngBuffer.toString("base64")
                    : "";
                previewImage.src = `data:image/png;base64,${base64}`;
                previewImage.style.display = "inline-block";
                previewPlaceholder.style.display = "none";

                btnSave.disabled = false;
            } catch (err) {
                console.error("Errore nella generazione del barcode:", err);
                const message =
                    err instanceof Error ? err.message : String(err);
                await showError(
                    "Errore nella generazione del codice a barre.",
                    message,
                );
            }
        } else {
            await showInfo(
                "Tipo non riconosciuto.",
                "Sono supportati 'QR Code' e 'Codice a barre (Code 128)'.",
            );
        }
    });

    btnSave?.addEventListener("click", async () => {
        if (!lastPngBuffer) {
            await showWarning(
                "Non c'è nessuna immagine da salvare. Genera prima un codice.",
            );
            return;
        }

        const defaultName =
            typeSelect && typeSelect.value === "qr"
                ? "qrcode.png"
                : "barcode.png";

        const outputPath = await ipcRenderer.invoke("select-output-file", {
            defaultName,
        });

        if (!outputPath) {
            return;
        }

        try {
            const dirOut = path.dirname(outputPath);
            if (!fs.existsSync(dirOut)) {
                fs.mkdirSync(dirOut, { recursive: true });
            }

            fs.writeFileSync(outputPath, lastPngBuffer);
            await showInfo("Immagine salvata con successo.", outputPath);
        } catch (err) {
            console.error("Errore nel salvataggio dell'immagine:", err);
            const message = err instanceof Error ? err.message : String(err);
            await showError("Errore nel salvataggio dell'immagine.", message);
        }
    });

    btnClose?.addEventListener("click", () => {
        window.close();
    });
});

export {};


