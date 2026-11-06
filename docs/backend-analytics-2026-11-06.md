# Analisi SQL su richiesta — 6 novembre 2026

Il backend espone un catalogo di analisi contabili definito nel codice. La connessione a `DL360\SQL2017`, database `NuovaAGP`, viene aperta solo alla prima richiesta di dati e riutilizzata tramite pool (massimo 3 connessioni). Non ci sono acquisizioni periodiche SQL. Le richieste identiche in corso condividono l'esecuzione; una successiva richiesta riesegue la query, senza cache persistente dei risultati.

## Installazione e configurazione

Aggiornare **backend e client AyPi**. Sul computer che esegue il backend, eseguire `backend-scripts/configure-sql-analytics.ps1` fornendo le credenziali SQL. Lo script crea:

```
C:\ProgramData\AGPress\AyPiBackend\sql-analytics.credentials.json
```

La password è cifrata tramite Windows DPAPI LocalMachine e il file è accessibile soltanto a SYSTEM, amministratori e utente che ha configurato il servizio. Il file cifrato va creato sul server di esecuzione: la copia da un altro computer non è utilizzabile. Non viene incluso nel repository o negli installer. Riavviare il backend dopo una variazione della configurazione.

Configurazione avanzata: `AYPI_ANALYTICS_CREDENTIALS_FILE` sceglie un percorso alternativo; `AYPI_ANALYTICS_SQL_PASSWORD` permette l'iniezione del segreto nell'ambiente del solo processo backend. Nel file sono configurabili server, istanza, database, utente, porta opzionale, TLS e verifica del certificato. I valori predisposti per la rete aziendale sono TLS attivo e certificato del server interno accettato.

L'accesso desktop continua a usare F2 e la password amministratore esistente. Il backend verifica la credenziale di accesso alle analisi e rilascia una sessione Bearer di 30 minuti, legata all'indirizzo del client e revocata disattivando l'admin. La password SQL non raggiunge i client. Il valore di accesso alle analisi è configurabile con `AYPI_ANALYTICS_ACCESS_PASSWORD`, da mantenere coerente con la credenziale F2 del client. Cinque tentativi errati bloccano nuovi login da quell'indirizzo per un minuto.

## API

- `POST /api/analytics/session`: `{ "password": "<password amministratore AyPi>" }`, restituisce token e scadenza.
- `DELETE /api/analytics/session`: revoca la sessione corrente.
- `GET /api/analytics/catalog`: analisi disponibili, colonne e parametri.
- `POST /api/analytics/query/bilancino`: movimenti contabili, comprese le chiusure per la successiva esclusione gestionale.
- `POST /api/analytics/query/saldi-conti-annuali`: Dare, Avere, saldo e numero di movimenti per anno e conto, con le chiusure già escluse; non usa Excel.

Catalogo e query richiedono `Authorization: Bearer <token>`. I parametri ammessi sono `fromYear` e `toYear`, opzionali e inclusivi; sono convertiti in parametri SQL di tipo Date. Non si accettano SQL, nomi di tabelle, colonne o clausole dai client. Le nuove analisi si aggiungono al catalogo nel backend, con query SELECT e parametri tipizzati.

Le query Bilancino riprendono SELECT e join della Power Query originale, con le stesse conversioni di segno; gli alias corrispondono alle successive trasformazioni Excel. Viene mantenuto anche IDRegistrazione. Le risposte contengono colonne e righe compatte, origine e data di lettura; il trasferimento gzip riduce i dati sulla rete. Le risposte non sono memorizzabili nelle cache HTTP. Gli errori di connessione non espongono credenziali SQL.

Timeout: connessione 15 secondi, query 90 secondi, client 120 secondi. Massimo due analisi distinte contemporanee e 750.000 righe per risposta. Questi vincoli evitano richieste illimitate; per dataset più grandi usare i parametri di periodo. L'utente SQL fornito resta quello configurato: l'applicazione espone esclusivamente le SELECT del catalogo e non modifica account o permessi del database.

## Controllo di gestione

La modalità predefinita è **SQL · aggiornati**: all'apertura e su Aggiorna dati il client interroga il backend per il Bilancino. Il worker legge soltanto Calcoli e Filtri da `\\Dl360\pubbliche\TECH\Controlli di Gestione\ExportMovimenti.xlsx`, applicando le regole esistenti. Il Bilancino salvato nel file non è utilizzato in questa modalità.

**Excel · istantanea** è una scelta esplicita per lavorare con il vecchio export. Un errore SQL non causa il passaggio automatico a Excel. Se è già presente una vista riuscita, rimane visibile con avviso. Origine, data della query e file dei parametri sono riportati nella sezione verifiche e nell'export.

Il dettaglio dei movimenti usa la stessa lettura della dashboard, evitando differenze durante l'espansione dei conti; per SQL riporta anche il numero della registrazione. Chiudendo la finestra si eliminano le copie in memoria del dataset del modulo, così la successiva apertura richiede dati nuovi.

## Verifiche eseguite

- Collegamento reale a SQL Server con le credenziali fornite, senza scritture al database.
- Saldi per conto del 2026: 291 righe.
- Prova completa SQL → HTTP gzip → client → worker → parametri Excel: 331.927 movimenti, 8.816 chiusure escluse, 88.912 movimenti mappati e riconciliazione esatta con i saldi mensili. Alla prova risultavano 296 movimenti in più rispetto al precedente Excel.
- Test sintetici per catalogo, parametri, autenticazione, revoca, mancata esposizione di segreti, pool, accorpamento delle richieste e limiti; regressione dell'interfaccia, obiettivi ed espansione dei movimenti.

## Stato della distribuzione

I compilati SQL e client sono pronti per il collaudo. La revisione `tools/baselines/backend-analytics-2026-11-06.json` ammette esclusivamente due punti di integrazione, i quattro moduli SQL, lo script di configurazione e la dipendenza mssql con lock verificato. La baseline storica e la revisione Forno restano separate e attive.

La creazione dell'installer completo resta bloccata da **71 differenze pregresse** di altri moduli rispetto al riferimento storico: Forno, MES, Calendar e altri componenti già presenti nel checkout. Nessuno di questi sorgenti è stato modificato per la funzione SQL e non è stato aggiornato il loro riferimento di distribuzione. Occorre una revisione specifica di quel contenuto prima di produrre un installer completo; il controllo non è stato disabilitato.

Comandi di collaudo:

```powershell
npx tsc -p backend/tsconfig.json
npx tsc -p tsconfig.json
npx tsc -p tsconfig.renderer.json
node --test tools/test-analytics.cjs tools/test-management.cjs tools/test-analytics-baseline.cjs
node tools/test-management-ui.cjs
```
