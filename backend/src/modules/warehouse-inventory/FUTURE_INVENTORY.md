# Evoluzioni inventariali preparate ma non attive

Queste funzioni sono intenzionalmente disabilitate in
`future-capabilities.ts`. Le tabelle vengono create tramite migrazione
additiva, ma nessuna rotta consente ancora di scrivere conteggi, rettifiche o
lavori di stampa.

## Principi già fissati

- Ogni unità logistica può avere un `trackingCode` univoco e indipendente
  dall'articolo, dalla pesata e dall'ubicazione.
- Il valore del codice è indipendente dalla simbologia stampata: potrà essere
  rappresentato come Code 128, Data Matrix o QR.
- Una scansione non modifica direttamente il magazzino. Produce prima
  un'osservazione confrontabile con lo stato digitale.
- Le differenze fisico/digitale generano una rettifica in bozza, da approvare
  e applicare esplicitamente con autore e data.
- La stampa passa attraverso una coda persistente e idempotente: un errore di
  stampante non deve duplicare unità o carichi.
- Lo scanner USB sarà trattato inizialmente come tastiera (`keyboard wedge`),
  evitando driver proprietari e mantenendo compatibilità con i PC più datati.
- I normali identificativi `unit_id` restano invariati; il codice stampabile è
  un attributo aggiuntivo e può essere introdotto gradualmente.

## Tabelle predisposte

- `warehouse_physical_inventory_sessions`: campagne di conteggio e relativo
  ambito (fila, ubicazioni o intero magazzino).
- `warehouse_physical_inventory_scans`: osservazioni scanner con esito atteso,
  errato, sconosciuto o duplicato.
- `warehouse_inventory_adjustments`: rettifiche sottoposte a revisione prima
  dell'applicazione.
- `warehouse_label_print_jobs`: coda di stampa, copie, stampante, errori e
  ristampe.

## Sequenza consigliata per la futura attivazione

1. Scegliere stampante, dimensione etichetta e simbologia dopo una prova sul
   campo con guanti, sporco e diverse distanze di lettura.
2. Definire il formato versionato del `trackingCode` e una strategia per
   etichettare gradualmente i cassoni già presenti.
3. Implementare la sola funzione di identificazione scanner, senza conferme
   operative, e raccogliere errori reali.
4. Aggiungere conferma deposito/prelievo con controllo del cassone atteso.
5. Attivare sessioni di inventario fisico e report differenze.
6. Attivare le rettifiche soltanto dopo aver definito approvazioni, permessi e
   procedura di annullamento.
7. Abilitare la stampa automatica al termine di un carico solo dopo avere
   verificato ristampe, stampante offline e recupero dei job interrotti.

## Decisioni ancora aperte

- Code 128, Data Matrix o QR.
- Contenuto minimo dell'etichetta e presenza di testo leggibile dall'uomo.
- Stampante unica di reparto oppure stampanti associate alla postazione.
- Necessità di scansionare anche l'ubicazione oltre al cassone.
- Chi può approvare una rettifica e sopra quali soglie quantitative.
- Politica di sostituzione delle etichette danneggiate e storico delle
  ristampe.

