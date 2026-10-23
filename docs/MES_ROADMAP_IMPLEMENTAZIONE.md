# MES e Pianificazione — Stato implementazione

Aggiornato al 23 ottobre 2026.

| Fase | Stato | Risultato |
|---|---|---|
| Backup pre-MES | Completato | Snapshot locale verificato del Pianificatore precedente alle modifiche MES |
| 0. Regole e contratto dati | Completato | Regole, stati, formule, invarianti e casi limite documentati |
| 1. Importatore CSV | Completato | Sincronizzazione incrementale automatica dei CSV PLC, deduplicazione e consultazione eventi |
| 2. Database MES | Completato | Modello normalizzato, CRUD ordini/fasi, sessioni, allocazioni, rettifiche e audit |
| 3. Motore sessioni | Completato backend | Flusso parametrico per ogni macchina: attivazione, attribuzione, conteggio, pausa e chiusura |
| 4. Ordini evoluti | Completato base | Ordini/fasi MES dal planner, tempo ciclo, attrezzaggio e durata automatica |
| 5. Console macchina | In corso | Quadro MES a pagina intera, selezione manuale ordine, pausa, attrezzaggio, riconciliazione e chiusura; restano le rettifiche manuali |
| 6. Integrazione Gantt | In corso | Lo schedulatore è subordinato al MES: segue macchina, stato e avanzamento reali senza attivare ordini; resta la pianificazione oraria/turni |
| 7. Esploratore dati | Da iniziare | Griglia filtrabile ed esportazione |
| 8. Analisi | Da iniziare | KPI per macchina, articolo, fase e periodo |
| 9. Collector SQLite | Da iniziare | Sostituzione dell'adattatore CSV con la futura sorgente SQLite |

## Funzionalità disponibili dopo la fase 2

- tabella SQLite `mes_machine_events` con eventi grezzi immutabili;
- tabella `mes_import_runs` con storico e risultato delle importazioni;
- identificatore deterministico per impedire la duplicazione della stessa riga;
- riconoscimento delle righe non valide senza bloccare quelle valide;
- filtro eventi per macchina e intervallo temporale;
- riepilogo eventi e pezzi per macchina;
- lettura automatica incrementale del file `impulsi.csv` della sessione attiva;
- acquisizione Python/Npcap e salvataggio CSV eseguiti sempre sul PC collegato alle macchine, senza richiedere accesso alla rete PLC dal server;
- funzionamento locale indipendente dal backend MES: in caso di API non disponibili il CSV continua a crescere e la sincronizzazione riprova con attesa controllata;
- invio dei nuovi record al MES senza intervento dell'operatore;
- nuovo tentativo automatico senza avanzare il cursore se il backend non è disponibile;
- notifica del numero di eventi nuovi, duplicati ignorati e righe scartate;
- API predisposte per il futuro modulo MES.
- ordini e fasi persistenti con controllo di revisione contro sovrascritture concorrenti;
- durata fase calcolata come `attrezzaggio + quantità × secondi/pezzo`;
- fine pianificata calcolata automaticamente quando vengono indicate macchina e data di inizio;
- strutture dati per sessioni macchina, allocazione degli eventi, risoluzione dei pezzi non attribuiti e rettifiche;
- audit persistente delle creazioni e modifiche;
- riepilogo per macchina dei pezzi PLC non ancora attribuiti a una produzione.
- anteprima obbligatoria dei conteggi sospesi prima dell'attivazione;
- attribuzione totale, parziale o esclusione dei pezzi precedenti;
- una sola sessione attiva per macchina e per fase;
- attribuzione automatica dei nuovi eventi alla sessione attiva tramite `machineId`;
- esclusione dei colpi prodotti durante una pausa;
- pausa, ripresa, completamento e annullamento con revisioni e audit;
- motore indipendente dalla macchina: `21F400` è la prima mappatura verificata, non un vincolo applicativo.
- unico accesso visibile **MES e Pianificatore**, con PLC Reader e console macchine incorporati;
- il MES è la fonte operativa principale: lo schedulatore non attiva mai automaticamente una produzione;
- attivazione manuale dalla macchina con scelta anche di ordini mai posizionati nel Gantt;
- riallineamento automatico del Gantt alla macchina realmente scelta nel MES e creazione della proiezione per le fasi attive non ancora pianificate;
- navigazione a pagine intere con quadro Produzione, Ordini, Schedulatore e le quattro viste originali del PLC Reader;
- fermi macchina, chiusure e ferie raccolti in un unico sottomenu;
- salvataggio delle lavorazioni del Gantt come ordini e fasi MES persistenti;
- supporto a più fasi con lo stesso numero ordine;
- durata del Gantt calcolata da ore di attrezzaggio, quantità e secondi per pezzo;
- avanzamento della barra del Gantt derivato dai pezzi buoni anziché dai giorni trascorsi;
- tempo standard, tempo ciclo reale medio e ultimo ciclo mostrati per la sessione attiva;
- riconciliazione di fine attrezzaggio in pezzi buoni, scarti/prove ed esclusi;
- avvio immediato della produzione dopo la riconciliazione dell'attrezzaggio.

## API introdotte

| Metodo | Percorso | Uso |
|---|---|---|
| `POST` | `/api/mes/imports/plc-csv` | Importa il contenuto di un CSV PLC |
| `GET` | `/api/mes/events` | Consulta gli eventi con paginazione e filtri |
| `GET` | `/api/mes/events/summary` | Restituisce i totali per macchina |
| `GET` | `/api/mes/imports` | Consulta lo storico delle importazioni |
| `GET` | `/api/mes/orders` | Cerca e pagina gli ordini MES |
| `POST` | `/api/mes/orders` | Crea un ordine con una o più fasi |
| `GET` | `/api/mes/orders/:orderId` | Legge ordine e relative fasi |
| `PUT` | `/api/mes/orders/:orderId` | Aggiorna un ordine controllandone la revisione |
| `POST` | `/api/mes/orders/:orderId/phases` | Aggiunge una fase a un ordine |
| `PUT` | `/api/mes/phases/:phaseId` | Aggiorna una fase controllandone la revisione |
| `GET` | `/api/mes/machines/unassigned` | Elenca i pezzi non ancora attribuiti per macchina |
| `GET` | `/api/mes/machines/activation-preview` | Mostra cosa dovrà decidere l'operatore prima dell'avvio |
| `GET` | `/api/mes/sessions` | Elenca le sessioni di tutte le macchine o di una macchina specifica |
| `POST` | `/api/mes/sessions` | Attiva una fase e risolve gli eventuali pezzi precedenti |
| `POST` | `/api/mes/sessions/:sessionId/actions` | Mette in pausa, riprende, completa o annulla una sessione |
| `POST` | `/api/mes/sessions/:sessionId/setup-reconciliation` | Classifica i conteggi di attrezzaggio e opzionalmente avvia la produzione |

## Prossimo incremento

Il prossimo incremento completerà la console **MES e Pianificatore** con:

- rettifiche manuali con causali configurabili;
- registrazione separata di scarti durante la produzione;
- vista oraria/turni del Gantt e calendari produttivi reali;
- dettaglio storico e griglia analitica filtrabile;
- ulteriori KPI di efficienza per macchina, articolo e periodo.

Gli eventi grezzi continueranno a non essere modificati: attribuzioni e azzeramenti saranno registrati come movimenti separati e auditabili.

