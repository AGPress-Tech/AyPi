# Confronta cartelle

Primo modulo renderer raggruppato per funzionalità. Pagina, entry point e stili
specifici vivono insieme; il comportamento e i canali IPC restano quelli esistenti.

```text
compare-folders/
├── compare-folders.html
├── index.ts
└── styles/
    ├── base.css
    └── bluearchive.css
```

- `compare-folders.html` conserva il nome della pagina per mantenere tema,
  splash e identificazione del modulo nei bootstrap condivisi.
- `index.ts` importa i servizi comuni da `scripts/shared` e il selettore
  cartelle comune da `scripts/utilities/shared`. Non duplicarli nel modulo.
- `styles/` contiene solo gli stili specifici. Gli stili comuni restano in
  `renderer/styles` durante la migrazione graduale.
- Electron apre `dist-ts/modules/compare-folders/compare-folders.html`.
  Home e Gerarchia conservano gli stessi canali IPC e il riuso della finestra.
- La build individua le cartelle modulo contenenti una pagina HTML, copia le
  risorse e compila `index.ts` con un ambito privato. I submoduli richiamabili
  con `require` conservano il formato CommonJS.

Verifiche automatiche e prove manuali sono descritte in
`VERIFICA.md` nella stessa cartella del modulo.
