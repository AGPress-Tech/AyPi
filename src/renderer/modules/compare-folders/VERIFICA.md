# Verifica del riordino — Confronta cartelle

## Metodo

Migrare un modulo alla volta. Per ogni passaggio: build iniziale, spostamento dei
file e aggiornamento dei riferimenti, compilazione, controllo risorse locali,
prove Electron e prova delle risorse nel pacchetto ASAR prodotto da electron-builder.
La verifica manuale nell'app completa conclude il passaggio prima del modulo seguente.

Non cambiare percorsi dei dati, configurazioni delle postazioni, canali IPC o
identificativi ERP come conseguenza dello spostamento dei sorgenti.

## Passaggio 1 — Confronta cartelle, 24 novembre 2026

Baseline Git iniziale pulita: `fa297ee`. Il modulo è stato raggruppato in
`src/renderer/modules/compare-folders/`: pagina, `index.ts` e due fogli di stile.
Sono rimasti invariati corpo del codice, stili, modalità di confronto e canali IPC.
La pagina mantiene il nome `compare-folders.html` per conservare il riconoscimento
del tema e dello splash. È cambiato il percorso interno usato da Electron.

I bundle `index.ts` dei moduli raggruppati hanno un ambito privato: durante la
prova hash è emerso il conflitto fra il nome Node `crypto` e `window.crypto`.
L'isolamento del bundle evita il conflitto senza cambiare l'algoritmo di confronto.

### Verifiche automatiche completate

- Build desktop iniziale e finale; TypeScript renderer.
- Build backend e verifica corrispondenza fra sorgenti e compilati.
- `npm run check:assets`: include ora anche HTML/CSS sotto `dist-ts/modules`.
- `npx electron tools/test-compare-folders-ui.cjs`.
- Pacchetto Windows separato, senza installazione o pubblicazione:
  `npx electron-builder --dir --win --x64 --publish never --config.directories.output=dist/module-refactor-preview`.
- `npx electron tools/test-compare-folders-ui.cjs --packaged`: ripete le prove
  caricando il modulo e i controller dal vero `app.asar` del pacchetto.

La suite usa cartelle e profilo locali isolati; disabilita il backend, intercetta
i dialoghi e l'apertura di Esplora file. Verifica i veri canali Home/Gerarchia,
riuso/chiusura/riapertura della finestra, consegna del contesto dopo il caricamento,
nomi/metadati/hash, sottocartelle, filtri, selettore e annullamento, apertura A/B,
file di ingresso invariati, caricamento degli stili, due temi e dimensioni
1100×820 / 780×640. Non sostituisce la prova manuale dell'app completa.

### Prove da effettuare nell'app

Chiudere le istanze AyPi già aperte e avviare
`dist/module-refactor-preview/win-unpacked/AyPi.exe`.
Non spostare soltanto l'eseguibile: mantenere l'intera cartella `win-unpacked`.
Le cartelle dimostrative si trovano in
`dist/module-refactor-preview/prova-confronto/A` e `B`.

1. **Apertura:** da Utilities aprire Confronta cartelle. Controllare caricamento
   completo, stile e pulsanti. Ripetere l'apertura: deve riusare la stessa finestra.
2. **Selettori:** scegliere le cartelle dimostrative A e B. Riaprire un selettore
   e annullare: il percorso precedente deve rimanere; il selettore deve poter
   essere riaperto normalmente.
3. **Confronti:** attivare tutti e quattro i filtri Mostra e mantenere incluse
   le sottocartelle. Confrontare nelle tre modalità, con questi risultati:

   | Modalità | Totale | Solo A | Solo B | Diversi | Uguali |
   | --- | ---: | ---: | ---: | ---: | ---: |
   | Solo percorso e nome | 6 | 2 | 1 | 0 | 3 |
   | Dimensione + data | 6 | 2 | 1 | 2 | 1 |
   | Conferma con hash | 6 | 2 | 1 | 1 | 2 |

4. **Filtri e sottocartelle:** in modalità hash, mantenere solo Diversi:
   deve rimanere `changed.txt`. Riattivare tutti i filtri ed escludere le
   sottocartelle: devono rimanere 5 percorsi, senza `sub/nested-a.txt`.
5. **Apri in A/B:** selezionare `changed.txt` e provare entrambi i pulsanti:
   devono aprire le rispettive cartelle in Esplora file. Per `only-a.txt`,
   Apri in B deve essere disabilitato; per `only-b.txt` vale il contrario.
6. **Da Gerarchia:** aprire la cartella dimostrativa `prova-confronto` in
   Gerarchia. Tasto destro su A → Usa come Cartella A in Confronta cartelle;
   ripetere su B per il lato B. Controllare i percorsi ricevuti e confrontare.
   Ripetere almeno il lato A dopo aver chiuso la finestra Confronta cartelle.
7. **Aspetto e chiusura:** provare tema standard e Blue Archive, finestra ampia
   e ridotta; controllare leggibilità, scorrimento e chiusura/riapertura.

**Stato:** verifiche automatiche superate; verifica manuale confermata dall'utente
il 24 novembre 2026 con esito positivo. Autorizzato il passaggio al modulo successivo.
