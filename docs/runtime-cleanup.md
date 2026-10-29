# Pulizia dei componenti inutilizzati — 29 ottobre 2026

Il portale utilizzato all'avvio è `pages/bluearchive-preview.html` per entrambi
i temi. Le sezioni sono renderizzate dal suo controller, con la presentazione
MES - SCADA caricata da `pages/partials/forge-landing.html`.

## Rimossi

- Vecchio portale autonomo: index/splash, Moduli, Programmi, Articoli,
  Produzioni, Calcolatore, Utilities, MES - SCADA e sidebar, con script e CSS
  esclusivi. Nessuna finestra attuale veniva aperta su queste pagine.
- Vecchia pagina Robot, redirect, controller e stile non più collegati.
- Console robot duplicata e irraggiungibile nel portale: markup, controller,
  animazioni CSS duplicate e varianti generate. La console corrente rimane in FORGE.
- Handler IPC `mostra-robot-popup` e `ping-robot-dialog`, con i relativi dialoghi
  e letture duplicate. FORGE usa `robot-status-custom` e `ping-robot-custom`.
- Ridimensionamento della finestra principale legato alla vecchia navigazione,
  compresa la chiamata residua nel Calendar e l'indice indirizzi `ADDRESS_BY_ID`.
- Moduli isolati `assignees-modal.ts` del Calendar e `catalog-controls.ts` del
  Purchasing. La gestione assegnatari attuale è una finestra dedicata; i filtri
  catalogo attuali usano `catalog-search.ts`.
- Variante decorativa SVG precedente del landing e cinque immagini modulo
  senza riferimenti: Calendar, Inventario, Pianificazione, Purchasing e Ticket Support
  (5.860.278 byte di asset sorgente).

Gli stili ancora usati dello splash FORGE sono ora in
`styles/forge/boot-animation.css`, con classi `forge-boot` e `forge-splash`.
Non dipendono più dal nome del vecchio splash del pianificatore.

## Componenti conservati perché in uso

Le migrazioni dei database, la ricostruzione dei vecchi movimenti di magazzino,
il recupero delle preferenze e i trasporti compatibili con client/backend di
versioni diverse servono dati e installazioni reali. Non sono codice morto.
Lo stesso vale per i moduli CommonJS caricati dinamicamente dal Calendar e
Purchasing, l'auto-updater, il collector PLC e i file Spine/audio/icone
referenziati da manifest o nomi costruiti a runtime.

Nessuna cancellazione di database, registrazioni, impostazioni utente o file
condivisi sul server. Nessuna modifica ai servizi di acquisizione del backend.
Le cartelle di build non sono sorgenti: `build:ts` ricrea `dist-ts` e l'installer
viene rigenerato senza includere i file rimossi.

## Controlli

- `npm run build:ts`: compilazione e ricostruzione degli asset.
- `npm run check:assets`: verifica i riferimenti locali HTML/CSS delle pagine
  operative compilate; esclude guide e template di report che hanno basi URL
  assegnate dinamicamente.
- `node tools/test-forno-launcher.cjs`: portale → FORGE → MES/forno/robot,
  entrambi i temi e riuso delle finestre, con servizi simulati.
- `node tools/test-operations-ui.cjs`: splash FORGE, animazioni e annullamento
  robot, apertura diretta MES e identità grafica comune.
- `node tools/test-theme-bootstrap.cjs` e
  `node --test tools/test-themed-window.cjs`: temi iniziali e ciclo finestre.
- `npm run preview:forge -- --smoke`: preview e aggiornamento automatico.
