# Generatore QR / Barcode

Secondo modulo renderer raggruppato per funzionalità dopo Confronta cartelle.

```text
qr-generator/
├── qr-generator.html
├── index.ts
└── styles/
    ├── base.css
    └── bluearchive.css
```

La pagina mantiene il nome `qr-generator.html` per conservare il riconoscimento
di tema e splash. Electron apre `dist-ts/modules/qr-generator/qr-generator.html`,
sia alla prima apertura sia al cambio tema della finestra già aperta.
Il canale Home resta `open-qr-generator-window`.

L'entry point importa i componenti comuni da `scripts/shared`; `qrcode` e
`bwip-js` restano dipendenze esistenti, verificate anche nel pacchetto ASAR.
La generazione e gli stili sono invariati. Il dialogo Salva usa esplicitamente
il filtro PNG invece del filtro Excel predefinito del servizio condiviso.

Vedere `VERIFICA.md` per i controlli automatici e la prova manuale del passaggio.
