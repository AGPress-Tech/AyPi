# Elenca file

Terzo modulo renderer raggruppato per funzionalità, dopo Confronta cartelle e
Generatore QR/Barcode.

```text
file-list/
├── file-list.html
├── index.ts
└── styles/
    ├── base.css
    └── bluearchive.css
```

La pagina conserva il nome `file-list.html`, quindi tema e splash continuano a
essere riconosciuti dai bootstrap condivisi. Il controller Electron apre
`dist-ts/modules/file-list/file-list.html` sia per la nuova finestra sia al
cambio tema della finestra esistente. Il canale Home resta `open-file-list-window`.

Il codice è invariato salvo i percorsi degli import verso `scripts/shared`.
Scansione, conteggi, ordinamento ed export conservano il comportamento
precedente. Lo stile aggiunge solo il rispetto di `hidden` per tabella e messaggio
vuoto, evitando che quest'ultimo copra i risultati già caricati.
`xlsx` resta una dipendenza esistente; non sono introdotti nuovi
servizi o percorsi per i dati.

La checklist e le verifiche del passaggio sono in `VERIFICA.md`.
