# Verifica del riordino — Generatore QR / Barcode

## Passaggio 2 — 24 novembre 2026

Confronta cartelle è stato confermato funzionante dall'utente. In questo passaggio
si raggruppano pagina, entry point e i due stili del Generatore QR, aggiornando
entrambi i percorsi di apertura Electron: nuova finestra e cambio tema.
La struttura e la build già introdotte nel primo passaggio riconoscono il nuovo
modulo senza ulteriori modifiche ai criteri di compilazione.

Il corpo del renderer è invariato salvo i percorsi degli import e il filtro
PNG nella richiesta di salvataggio: prima veniva ereditato il filtro Excel del
servizio comune. Non sono stati modificati algoritmo di generazione o stili.

## Verifiche automatiche

- Build desktop prima e dopo lo spostamento; TypeScript renderer.
- `npm run check:assets`: risorse locali delle pagine e degli stili presenti.
- `npx electron tools/test-qr-generator-ui.cjs`: vero canale Home, riuso finestra,
  cambio tema con ricaricamento, chiusura/riapertura, contenuto vuoto, testo Unicode,
  URL, QR a 256/384 px e margini differenti, Code 128, testo sotto il barcode,
  altezza, PNG validi e non vuoti, salvataggio su disco identico all'anteprima,
  nome e filtro PNG, annullamento e successivo nuovo salvataggio.
- Temi standard/Blue Archive, dimensioni 1100×820 e 740×640, caricamento degli stili.
- Pacchetto separato:
  `npx electron-builder --dir --win --x64 --publish never --config.directories.output=dist/module-refactor-preview/step-02-qr`.
- `npx electron tools/test-qr-generator-ui.cjs --packaged`: stesse prove usando
  codice e dipendenze del vero pacchetto ASAR.
- Regressione di Confronta cartelle in sviluppo e nel nuovo pacchetto: per la
  seconda prova impostare `AYPI_TEST_RUNTIME_DIR` al percorso assoluto
  `dist/module-refactor-preview/step-02-qr/win-unpacked/resources/app.asar/dist-ts`
  ed eseguire `npx electron tools/test-compare-folders-ui.cjs --packaged`.

Le prove usano un profilo e destinazioni di salvataggio temporanei, senza backend
o dati aziendali. Verificano struttura e pixel delle immagini PNG; la lettura con
telefono/lettore è prevista nel controllo manuale, non è simulata dalla suite.

## Prove da effettuare nell'app

Chiudere la precedente versione AyPi e aprire:
`dist/module-refactor-preview/step-02-qr/win-unpacked/AyPi.exe`.
Lasciare l'eseguibile all'interno della cartella `win-unpacked`.
La versione del primo passaggio è conservata separatamente.

1. Da **Utilities → Generatore QR**, verificare apertura e pulsanti. Riaprire
   dalla home: deve riusare la stessa finestra.
2. Premere **Genera** con contenuto vuoto: deve chiedere di inserire un contenuto,
   senza abilitare Salva prima della generazione del primo codice.
3. Generare un QR con `AyPi prova 123`, quindi uno con un URL a scelta. Variare
   dimensione e margine: l'anteprima deve aggiornarsi. Leggere il QR con il
   telefono e controllare che il contenuto corrisponda esattamente a quanto inserito.
4. Salvare come PNG, aprire il file con il visualizzatore immagini e controllarlo.
   Ripetere annullando il dialogo e poi salvando: il modulo deve restare utilizzabile.
5. Selezionare **Codice a barre (Code 128)** e generare `AYPI-123456`. Provare
   testo visibile/nascosto e altezze differenti; salvare e aprire anche questo PNG.
   Se disponibile, verificare la lettura con il lettore abituale.
6. Tornare a QR, generare nuovamente e controllare i due temi, finestra ampia e
   ridotta, scorrimento, chiusura e riapertura.
7. Aprire brevemente **Confronta cartelle** e ripetere un confronto con le cartelle
   dimostrative del primo passaggio: deve continuare a funzionare.

**Stato:** verifiche automatiche superate; prova manuale confermata dall'utente
il 24 novembre 2026 con esito positivo. Autorizzato il passaggio al terzo modulo.
