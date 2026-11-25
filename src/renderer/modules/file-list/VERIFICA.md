# Verifica del riordino — Elenca file

## Passaggio 3 — 24 novembre 2026

Confronta cartelle e Generatore QR/Barcode sono stati confermati funzionanti
dall'utente. Questo passaggio riunisce pagina, entry point e i due stili di
Elenca file in `src/renderer/modules/file-list/`.

Sono aggiornati entrambi i percorsi Electron (apertura e cambio tema).
Il corpo del renderer è invariato salvo i percorsi degli import. Gli stili
aggiungono solo una regola per rispettare `hidden` su tabella e messaggio vuoto:
la verifica visiva aveva mostrato quest'ultimo ancora sopra i risultati caricati.
La build già predisposta individua il modulo e ne isola l'entry point.

## Verifiche automatiche

- Build desktop prima e dopo lo spostamento, TypeScript renderer e risorse locali.
- Build backend e verifica corrispondenza fra sorgenti e compilati.
- `npx electron tools/test-file-list-ui.cjs`: vero canale Home, selettore cartella
  e dialogo export; scansione automatica, sottocartelle, conteggi, dimensione,
  ordinamento numerico, nomi accentati e file vuoti; annullamento dei dialoghi;
  aggiornamento dopo un nuovo file; cartella vuota, cartella non più disponibile
  e recupero selezionando una cartella valida; input invariati.
- Lettura del file Excel realmente scritto: foglio File e colonne Nome file,
  Percorso relativo, Percorso completo; tutte le righe della selezione e i
  percorsi completi devono corrispondere ai file di prova.
- Riuso finestra, cambio tema con ricaricamento, chiusura/riapertura, due temi
  e dimensioni 1100×820 / 780×640; visibilità effettiva di tabella e messaggio vuoto.
- Pacchetto Windows separato:
  `npx electron-builder --dir --win --x64 --publish never --config.directories.output=dist/module-refactor-preview/step-03-file-list`.
- `npx electron tools/test-file-list-ui.cjs --packaged`: ripetizione dal vero
  ASAR, inclusa la dipendenza XLSX del pacchetto.
- Regressione di Generatore QR e Confronta cartelle nel nuovo pacchetto: impostare
  `AYPI_TEST_RUNTIME_DIR` al percorso assoluto
  `dist/module-refactor-preview/step-03-file-list/win-unpacked/resources/app.asar/dist-ts`
  e usare le rispettive suite con `--packaged`.

Le suite usano profili e cartelle temporanei, senza backend o dati aziendali.
I dialoghi vengono intercettati; i file Excel vengono effettivamente scritti e letti.

## Prove nell'app completa

Chiudere le istanze AyPi precedenti e avviare
`dist/module-refactor-preview/step-03-file-list/win-unpacked/AyPi.exe`.
Mantenere l'eseguibile nella cartella `win-unpacked`.
Le versioni dei passaggi precedenti restano disponibili separatamente.

1. Da **Utilities → Elenca file**, controllare apertura, stile e pulsanti.
   Ripetere l'apertura dalla home: deve riusare la stessa finestra.
2. Selezionare la cartella dimostrativa
   `dist/module-refactor-preview/step-03-file-list/prova-elenco`.
   La scansione deve partire automaticamente. Con sottocartelle incluse:
   **7 file**, **4 cartelle lette**, **27 B**, **0 accessi non riusciti**.
3. Disattivare Includi sottocartelle: devono rimanere **5 file** e **1 cartella**.
   Riattivarlo: tornano i **7 file**. Controllare `file2.txt` prima di `file10.txt`,
   il nome `nome-à.txt` e `zero.bin` da 0 B.
4. Con sottocartelle incluse, esportare l'Excel e aprirlo. Devono esserci il foglio
   File, **7 righe di dati** e le tre colonne Nome file, Percorso relativo e
   Percorso completo. Salvare fuori da `prova-elenco`, per esempio in
   `dist/module-refactor-preview/step-03-file-list/risultati-prova`, per non
   includere l'Excel stesso in una scansione successiva.
5. Riaprire il selettore cartella e annullare; annullare anche un export e poi
   ripeterlo. Percorso, elenco e comandi devono rimanere utilizzabili.
6. Aggiungere un nuovo file di testo nella cartella dimostrativa e premere
   Analizza file: il conteggio ricorsivo deve salire a **8**. Provare poi una
   cartella vuota: elenco vuoto ed Esporta disabilitato. Tornare alla cartella
   di prova e verificare che scansione ed export funzionino ancora.
7. Controllare entrambi i temi, finestra ampia/ridotta, scorrimento e
   chiusura/riapertura. Una nuova finestra parte senza cartella selezionata,
   come prima del riordino.
8. Riprovare brevemente Generatore QR e Confronta cartelle dalla nuova versione.

**Stato:** verifiche automatiche superate; prova manuale dell'utente in attesa.
Registrare l'esito prima di migrare il quarto modulo.
