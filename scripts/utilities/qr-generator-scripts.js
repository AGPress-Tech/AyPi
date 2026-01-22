const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const bwipjs = require("bwip-js");
const { showInfo, showWarning, showError } = require("../shared/dialogs");

let lastPngBuffer = null;

window.addEventListener("DOMContentLoaded", () => {
    const contentInput = document.getElementById("contentInput");
    const typeSelect = document.getElementById("typeSelect");
    const sizeInput = document.getElementById("sizeInput");
    const marginInput = document.getElementById("marginInput");
    const barcodeHeightInput = document.getElementById("barcodeHeight");
    const barcodeShowTextInput = document.getElementById("barcodeShowText");
    const barcodeExtraOptions = document.getElementById("barcodeExtraOptions");

    const btnGenerate = document.getElementById("btnGenerate");
    const btnSave = document.getElementById("btnSave");
    const btnClose = document.getElementById("btnClose");
    const previewImage = document.getElementById("previewImage");
    const previewPlaceholder = document.getElementById("previewPlaceholder");

    console.log("qr-generator-scripts.js caricato ✔");

    function updateOptionsVisibility() {
        const type = typeSelect.value;
        if (type === "barcode") {
            barcodeExtraOptions.style.display = "block";
        } else {
            barcodeExtraOptions.style.display = "none";
        }
    }

    typeSelect.addEventListener("change", updateOptionsVisibility);
    updateOptionsVisibility(); // inizializza

    btnGenerate.addEventListener("click", async () => {
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

                const base64 = lastPngBuffer.toString("base64");
                previewImage.src = `data:image/png;base64,${base64}`;
                previewImage.style.display = "inline-block";
                previewPlaceholder.style.display = "none";

                btnSave.disabled = false;
            } catch (err) {
                console.error("Errore nella generazione del QR:", err);
                await showError("Errore nella generazione del QR code.", err.message || String(err));
            }
        } else if (type === "barcode") {
            try {
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

                const base64 = lastPngBuffer.toString("base64");
                previewImage.src = `data:image/png;base64,${base64}`;
                previewImage.style.display = "inline-block";
                previewPlaceholder.style.display = "none";

                btnSave.disabled = false;
            } catch (err) {
                console.error("Errore nella generazione del barcode:", err);
                await showError(
                    "Errore nella generazione del codice a barre.",
                    err.message || String(err)
                );
            }
        } else {
            await showInfo(
                "Tipo non riconosciuto.",
                "Sono supportati 'QR Code' e 'Codice a barre (Code 128)'."
            );
        }
    });

    btnSave.addEventListener("click", async () => {
        if (!lastPngBuffer) {
            await showWarning("Non c'è nessuna immagine da salvare. Genera prima un codice.");
            return;
        }

        const defaultName =
            typeSelect.value === "qr" ? "qrcode.png" : "barcode.png";

        const outputPath = await ipcRenderer.invoke("select-output-file", {
            defaultName,
        });

        if (!outputPath) {
            return;
        }

        try{
            const dirOut = path.dirname(outputPath);
            if (!fs.existsSync(dirOut)) {
                fs.mkdirSync(dirOut, { recursive: true });
            }

            fs.writeFileSync(outputPath, lastPngBuffer);
            await showInfo("Immagine salvata con successo.", outputPath);
        } catch (err) {
            console.error("Errore nel salvataggio dell'immagine:", err);
            await showError("Errore nel salvataggio dell'immagine.", err.message || String(err));
        }
    });

    btnClose.addEventListener("click", () => {
        window.close();
    });
});
