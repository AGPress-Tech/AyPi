# MES e Pianificazione — Stato implementazione

Aggiornato al 22 ottobre 2026.

| Fase | Stato | Risultato |
|---|---|---|
| Backup pre-MES | Completato | Snapshot locale verificato del Pianificatore precedente alle modifiche MES |
| 0. Regole e contratto dati | Completato | Regole, stati, formule, invarianti e casi limite documentati |
| 1. Importatore CSV | Completato | Sincronizzazione incrementale automatica dei CSV PLC, deduplicazione e consultazione eventi |
| 2. Database MES | Avviato | Tabelle eventi e storico importazioni presenti; ordini, fasi, sessioni e rettifiche ancora da implementare |
| 3. Vertical slice | Da iniziare | Una macchina e una fase collegate al conteggio reale |
| 4. Ordini evoluti | Da iniziare | Tempo ciclo, attrezzaggio e durata automatica |
| 5. Console macchina | Da iniziare | Attivazione, pausa, attrezzaggio, correzioni e chiusura |
| 6. Integrazione Gantt | Da iniziare | Avanzamento a pezzi e pianificazione temporale |
| 7. Esploratore dati | Da iniziare | Griglia filtrabile ed esportazione |
| 8. Analisi | Da iniziare | KPI per macchina, articolo, fase e periodo |
| 9. Collector SQLite | Da iniziare | Sostituzione dell'adattatore CSV con la futura sorgente SQLite |

## Funzionalità disponibili dopo la fase 1

- tabella SQLite `mes_machine_events` con eventi grezzi immutabili;
- tabella `mes_import_runs` con storico e risultato delle importazioni;
- identificatore deterministico per impedire la duplicazione della stessa riga;
- riconoscimento delle righe non valide senza bloccare quelle valide;
- filtro eventi per macchina e intervallo temporale;
- riepilogo eventi e pezzi per macchina;
- lettura automatica incrementale del file `impulsi.csv` della sessione attiva;
- invio dei nuovi record al MES senza intervento dell'operatore;
- nuovo tentativo automatico senza avanzare il cursore se il backend non è disponibile;
- notifica del numero di eventi nuovi, duplicati ignorati e righe scartate;
- API predisposte per il futuro modulo MES.

## API introdotte

| Metodo | Percorso | Uso |
|---|---|---|
| `POST` | `/api/mes/imports/plc-csv` | Importa il contenuto di un CSV PLC |
| `GET` | `/api/mes/events` | Consulta gli eventi con paginazione e filtri |
| `GET` | `/api/mes/events/summary` | Restituisce i totali per macchina |
| `GET` | `/api/mes/imports` | Consulta lo storico delle importazioni |

## Prossimo incremento

La fase 2 introdurrà il modello normalizzato di:

- ordini;
- fasi;
- sessioni macchina;
- pezzi non attribuiti;
- risoluzioni effettuate all'attivazione;
- rettifiche e audit.

Gli eventi importati nella fase 1 non verranno migrati o riscritti: saranno la sorgente grezza sulla quale costruire le nuove proiezioni.

