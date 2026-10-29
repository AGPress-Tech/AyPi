# Forno nanodac: archivio centralizzato AyPi

Il modulo forno è indipendente dal MES: non modifica tabelle, collector o persistenza MES.
Il nanodac viene interrogato solo dal backend, anche senza finestre client aperte.

## Attivazione sul server

Il lettore Modbus e SQLite funzionano in TypeScript/Node.js usando il runtime
incluso in Electron. Sul server non occorrono Python, Scapy, Node separato,
Docker o un servizio database. Il pacchetto include la libreria SQLite compilata
per la versione Electron distribuita e viene verificato senza Python/Node nel PATH.

Aggiungere questa proprietà al file `aypi-backend.runtime.json` del server,
mantenendo tutte le altre proprietà esistenti:

```json
{
  "forno": {
    "autoStart": true,
    "dbPath": "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\forno.db",
    "host": "192.168.1.165",
    "intervalMs": 500
  }
}
```

Installare/avviare il backend aggiornato: l'acquisizione parte automaticamente
insieme al backend, anche senza client aperti. La sezione `forno` è facoltativa:
in produzione l'avvio automatico è attivo per default e il database viene
collocato accanto ad `aypi.db`. Il vecchio `forno.enabled:false`, salvato come
default dalle versioni precedenti, non blocca più l'avvio.
Per un arresto esplicito impostare `forno.autoStart:false` oppure
`AYPI_FORNO_ENABLED=0` (la variabile ha precedenza sul JSON).
Il profilo `AYPI_BACKEND_PROFILE=dev` resta disattivato per default.
Eventuali vecchie proprieta forno.python / AYPI_FORNO_PYTHON non sono piu usate.

Variabili equivalenti: `AYPI_FORNO_ENABLED`, `AYPI_FORNO_DB_PATH`,
`AYPI_FORNO_HOST`, `AYPI_FORNO_INTERVAL_MS`. `AYPI_FORNO_ENABLED=1` forza
l'attivazione anche nel profilo di sviluppo.
Porta 502, Unit ID 255, registro 256 sono preimpostati e configurabili con
`AYPI_FORNO_PORT`, `AYPI_FORNO_UNIT`, `AYPI_FORNO_ADDRESS`.
La scala è 0.1 °C, verificata sul forno. Solo lettura Modbus FC03.

### Quattro canali

Il collector legge in un'unica richiesta FC03 i 14 registri da 256 a 269,
ogni 500 ms: PV/stato CH1 256/257, CH2 260/261, CH3 264/265, CH4 268/269.
`address` indica il registro base del primo canale; non occorre cambiare
il JSON esistente per attivare gli altri tre canali.
La temperatura è un intero signed in decimi; un canale Off o in errore viene
salvato con temperatura nulla e qualità distinta, mai come una falsa lettura zero.

Per aggiornare occorre installare sia il backend sul server sia il client sui PC.
Alla prima apertura di un archivio precedente viene creato un backup SQLite
coerente `forno.db.pre-multichannel-<id>.bak`, poi aggiunte le tabelle dei nuovi
canali. Lo storico CH1 viene conservato; CH2–4 iniziano dall'aggiornamento,
senza ricostruire dati mai raccolti. Tutti i nuovi campioni dei quattro canali
condividono timestamp e transazione di commit nello stesso `forno.db`.

La vista mostra quattro curve colorate e quattro riquadri con valore e stato.
Si possono nascondere/mostrare canali dai riquadri o dalla legenda: la scelta
è salvata nelle preferenze locali della postazione. La scala automatica e
0–Max+50 considerano solo i canali visibili; tooltip e analisi Ctrl+trascinamento
forniscono i dati distinti per canale.
Entrambi mostrano anche la temperatura media complessiva dei canali validi,
incluse le curve nascoste. Nel tooltip è la media aritmetica delle medie dei
canali nel bucket visualizzato. Nel nuovo resoconto "Tutti i canali" si calcola
prima la media dei canali validi a ogni istante, poi le statistiche di questa
temperatura media nell'intervallo selezionato.
I canali Off, senza campioni validi o con valori non finiti non contribuiscono;
se nessun canale è valido viene mostrato un trattino. I canali inclusi sono
indicati accanto alla media. Temperature zero o negative valide restano incluse.
Le API restituiscono `channels` (id, nome e dati per canale) mantenendo i campi
precedenti di CH1 per compatibilità con i client meno recenti.

Per impostazione iniziale il file forno.db viene collocato accanto ad aypi.db,
quindi nella cartella General/data configurata per il backend. Se si specifica
un percorso esplicito nella configurazione, quel percorso ha precedenza.

Su Dl360 e possibile configurare la stessa UNC degli altri moduli:
`\\Dl360\pubbliche\TECH\AyPi\AGPRESS\General\data\forno.db`.
Il backend verifica che la share appartenga al computer su cui sta girando e
usa NetShareGetInfo locale per ottenere il percorso fisico: SQLite apre sempre
quel percorso locale e non attraversa SMB. La directory e il nome del file
rimangono quelli visibili nella condivisione. Non viene modificato aypi.db.

I percorsi UNC verso altri computer e quelli che escono dalla condivisione sono
rifiutati. In alternativa si puo configurare direttamente il percorso locale.
L'account del backend deve poter leggere la configurazione della share locale e
scrivere nella cartella. Non usare unita di rete mappate. Il percorso risolto e
consultabile in GET /api/forno/status (dbPath).
Il backend deve raggiungere il nanodac sulla porta 502.
Un lock SQLite esclusivo impedisce due collector sullo stesso archivio.

## Persistenza

Un unico archivio logico `forno.db`, SQLite nativo tramite better-sqlite3,
in un processo Node separato dal backend. Le query storiche vengono eseguite
in un worker thread separato dalla raccolta per non ritardare il polling Modbus.
Il formato dei blocchi resta compatibile con la prima versione dell'archivio.

- Timestamp UTC in millisecondi e temperatura originale in decimi interi.
- Ogni lettura, anche fallita, viene salvata in una transazione SQLite.
- WAL e `synchronous=FULL`: conferma del commit prima di pubblicare il campione.
- Ogni 120 campioni, blocchi binari delta-time/int32/qualità compressi con zlib,
  senza perdita; la sostituzione dei campioni temporanei è atomica.
- I blocchi contengono anche riepiloghi per velocizzare le query di periodi lunghi.
- Il blocco parziale è recuperabile dopo un arresto improvviso e viene compattato
  al riavvio o alla chiusura normale.
- Durante il funzionamento SQLite usa anche `forno.db-wal` e `forno.db-shm`, più
  il piccolo file SQLite `forno.db.collector.lock`. Non sono archivi giornalieri. Non cancellarli a caldo.
- Per un backup usare l'API SQLite backup con una connessione locale oppure
  arrestare ordinatamente il modulo prima di copiare `forno.db`.
- Non vengono cancellati o aggregati distruttivamente i campioni originali.

Un timeout viene registrato come temperatura nulla con qualità distinta. Quando
il backend è spento non si raccolgono dati: lo storico mostra un'interruzione,
non temperature interpolate. Non è implementato il recupero automatico dei campioni
arretrati dal nanodac. Un clock che torna indietro arresta il collector con errore
esplicito, anziché sovrascrivere campioni: correggere l'orologio e riavviare il backend.
Un errore di persistenza arresta la raccolta e viene esposto nello stato.

## Vista operatore

Scheda Robot → **Forno — Temperature e cicli**.
La risoluzione della vista è personale e non modifica il campionamento del server.

- Risoluzione da 0.5 s a 1 ora; intervallo navigabile con zoom, trascinamento
  e selezione del giorno o del range esatto (data/ora, millisecondi inclusi),
  senza selettore Periodo. A ogni apertura "Segui live" è attivo.
- Live tramite WebSocket: ogni campione originale viene inviato dopo il commit,
  normalmente ogni 0,5 s, e aggregato localmente alla risoluzione scelta.
  Senza WebSocket resta disponibile il recupero HTTP incrementale ogni 1–5 s.
- Storico e viste lunghe: normalmente massimo 2000 bucket per richiesta; la risoluzione può
  essere aumentata automaticamente, con indicazione visibile nel pannello.
- Ogni bucket conserva min, max, media e conteggi. I picchi restano visibili.
- Tooltip dopo 500 ms a mouse fermo, entro 24 pixel da una curva visibile;
  il controllo della distanza include gli estremi orizzontali della traccia.
  Una volta aperto, resta visibile con il cursore fermo e aggiorna il campione
  sotto il cursore quando il live scorre, anche se la temperatura cambia.
- Tasto destro nel plot → "Tooltip continuo": abilita/disabilita un riquadro
  flottante nell'angolo superiore destro e una guida verticale. Nessuna attesa
  di 500 ms né vincolo di vicinanza alla curva. Mostra i quattro canali, lo stato
  Off e la media dei canali validi. La scelta resta salvata sulla postazione.
  Durante il caricamento sono indicate le medie della vista, poi sostituite dal
  campione originale più vicino con il suo timestamp effettivo, senza interpolazione.
  Se ci sono buchi nell'archivio non viene inventata una lettura. Il campione
  preciso si legge via API, con al massimo quattro richieste al secondo, una
  richiesta in corso per client e una piccola cache locale. Il grafico mantiene
  tutta la sua larghezza; drag, zoom e Ctrl+selezione restano disponibili.
- Rotella: zoom temporale con transizione breve; trascinamento: scorrimento
  aggiornato a ogni frame, senza attendere il rilascio; Ctrl + trascinamento:
  analisi sui campioni originali (non sulla curva ridotta).
- Click e trascinamento non selezionano punti sulla curva. La manina usa i cursori
  nativi `grab/grabbing`, con forma e dimensioni gestite da Windows/Chromium.
  Il grafico dichiara uno sfondo opaco e uno schema cromatico coerente con il tema.
  I colori dei cursori nativi non sono personalizzabili separatamente tramite CSS;
  un eventuale difetto del puntatore bianco richiede verifica sul PC interessato.
- Durante la navigazione la curva caricata resta visibile. Le nuove porzioni
  proseguono dagli estremi della traccia esistente in circa 320 ms: verso destra
  per i dati successivi e verso sinistra per quelli precedenti. Senza una traccia
  precedente la curva compare con una breve dissolvenza, senza scansione laterale.
  Si conserva un margine di cache
  locale limitato a 4000 bucket per canale. Le preferenze di movimento ridotto
  del sistema disattivano queste transizioni.
- Il caricamento avviene al termine dello zoom/trascinamento, raggruppando gli
  eventi della rotella per evitare richieste continue alla rete. La navigazione
  precarica un quarto di vista ai lati (max 3000 bucket per richiesta): un pan
  dentro la cache non richiede la rete. Al rilascio del pan non si attende
  l'animazione di ridisegno.
- Scala temperatura automatica, 0–Max+50 oppure manuale con minimo/massimo;
  i pulsanti +/− restringono/allargano la scala verticale.
- Opzioni asse gradi: divisioni fisse oppure linee ogni X °C, ancorate ai
  multipli di X, con 1–10 suddivisioni per intervallo. Passo troppo fitto su
  range ampi: griglia diradata con indicazione visibile. Preferenze locali.

### Analisi intervallo

Ctrl + trascinamento apre schede per "Tutti i canali" (curva media per istante)
e per ciascun canale: T max, T min, Delta T e media campioni. La finestra X,
in secondi (0,5–86400), resta salvata sulla postazione.
Il server analizza i campioni originali in finestre mobili chiuse [t−X,t],
avanzate a ogni campione registrato. Considera solo finestre interamente
interne ai campioni selezionati; Delta T = massima − minima nella finestra,
non differenza tra i soli estremi. Mostra media dei Delta T e finestra con il
Delta T massimo, con date/ore, minimo, massimo e istanti dei due estremi.
In caso di parità viene mostrata la prima finestra. Campioni non validi/Off
esclusi e nessuna interpolazione dei periodi scoperti; una finestra può quindi
contenere meno campioni del previsto. Nessuna finestra completa: valori assenti.
Il calcolo avviene nel worker di consultazione, con code monotone, senza
trasferire dati raw ai client. Oltre due milioni di istanti o circa nove secondi
di calcolo, viene richiesto di selezionare un intervallo più breve.
Per questa funzione occorrono backend e client aggiornati.

## Note degli operatori e messaggi automatici

Tasto destro nel plot → **Aggiungi nota qui**. La nota viene collegata al campione
originale più vicino; il suo orario effettivo è mostrato prima del salvataggio.
Senza un campione vicino non si può creare la nota. Il testo resta in `forno.db`,
con autore (utente Windows della postazione), data di creazione e modifiche.
Click sull'icona: apre/chiude il riquadro sul grafico. Tasto destro sull'icona
o sul testo aperto: modifica/elimina, con conferma prima dell'eliminazione.
Le note vicine sono raggruppate con un contatore; nel gruppo si può fare tasto
destro sulla singola nota. Le modifiche usano una revisione per evitare che
due postazioni si sovrascrivano. Eliminazione logica e cronologia delle versioni.
Il testo è visualizzato come testo semplice, mai come HTML.

Opzioni → **Note ed eventi sul grafico**: note visibili per default, eventi
automatici nascosti per default. Il filtro generale e i singoli tipi sono
preferenze locali; non interrompono la raccolta. Note condivise aggiornate
circa ogni 5 secondi anche nello storico, con risposta leggera se la revisione
non cambia. Risultati limitati a 1000 note/2000 eventi per intervallo; in caso
di troncamento compare l'indicazione di aumentare lo zoom.

La raccolta eventi parte con il backend, su una connessione Modbus di sola
lettura distinta da quella delle temperature, ogni 500 ms. Legge modo/stato,
tipo e tempo del segmento, uscite/eventi PV, nomi di programma e segmento,
revisione configurazione. Sono stati verificati sul forno i registri 14928–14959,
27302–27343 e 4256, secondo HA030554.
Riferimento: [manuale nanodac, tabella parametri programmatore](https://eurothermonline.com/media/instrument-manuals/nanodac%20Recorder%20%20Controller%20User%20Guide%20%28HA030554%20issue%205%29%20%289.38MB%29.pdf#page=220).

Registra i cambi osservati: Run, Hold, Resume, Reset, completamento, inizio/uscita
segmento, Holdback, attesa, eventi PV/digitali e revisione configurazione.
Avvio raccolta e ripristino connessione producono una fotografia dello stato,
senza inventare transizioni avvenute mentre il collector era fermo.
I timestamp indicano quando il backend ha rilevato il cambiamento: non sono
un'importazione del registro messaggi interno del nanodac. Transizioni più
rapide del polling o durante disconnessioni possono non essere rilevate.
L'evento "Avvio raccolta" riguarda il backend, non attesta un'accensione del forno.
I precedenti messaggi UHH/Review, i messaggi di sistema completi e le note
inserite sullo strumento non vengono importati automaticamente.
Raccolta eventi e relativi errori sono consultabili nella diagnostica acquisizione.

## Trasporto dello storico e del live

Lo storico usa lo stesso endpoint HTTP, con negoziazione
`Accept: application/vnd.aypi.forno.v1+protobuf` e `Accept-Encoding: gzip`.
Il formato è Protocol Buffers, versione 1, definito una sola volta in
`assets/forno-transport.proto`, incluso in entrambi i pacchetti. I campi numerici
dello storico restano float64; i null sono codificati come NaN e ripristinati
prima di arrivare al grafico. Si conservano statistiche, timestamp e qualità
implicita nei conteggi validi/mancanti. La risposta è limitata a 4000 bucket
per canale, senza duplicare CH1 al livello superiore nel trasferimento binario.
Il thread delle query esegue la codifica; gzip livello 1 usa il pool asincrono
di Node. L'IPC del collector usa serializzazione binaria avanzata.

`/api/forno/live` è un WebSocket sullo stesso host e porta del backend.
Il collector pubblica ogni frame solo dopo il commit SQLite. Il server codifica
una sola volta quattro temperature originali in decimi interi, quattro qualità,
timestamp, identificativo del processo collector e contatore di sequenza;
poi trasmette lo stesso messaggio a tutti i client collegati. Non si effettuano
query SQLite per ogni client o campione live. La compressione per messaggio è
disattivata perché i frame sono già molto piccoli. Heartbeat e limite di coda
disconnettono connessioni interrotte/client troppo lenti, senza code illimitate.

Il client aggrega i frame alla risoluzione di visualizzazione, esclusi Off/errori.
Identificativo/sequenza rilevano riavvii, duplicati e salti. Dopo una riconnessione
si recupera lo storico; `snapshotMs`, calcolato nella stessa transazione di
lettura, evita di ricontare i campioni inclusi nella risposta. Durante il recupero
i nuovi frame sono accodati in memoria con un limite. Senza WebSocket il client
continua con HTTP incrementale. Un client precedente continua a ricevere JSON;
un client nuovo funziona anche con il precedente backend JSON, in attesa
dell'aggiornamento. Note, eventi e impostazioni mantengono le API JSON.

Non cambiano file SQLite, schema dell'archivio, campioni o frequenza Modbus.
Installare prima il backend aggiornato e poi il client. Verifiche:
`npm run test:forno:transport`, `node tools/test-forno-ui.cjs` e
`node tools/test-forno-packaged-messages.cjs` dopo il packaging.
Quest'ultimo verifica anche gzip, decodifica del vero client, WebSocket comune
e forno contemporanei, frame già persistiti e riconnessione automatica.
`node tools/benchmark-forno-transport.cjs http://server:3000` misura in sola
lettura il peso dei formati sulle ultime 24 ore del backend indicato.
Il confronto del 29/10/2026 su dati reali ha dato 5.330.598 byte JSON,
647.261 byte JSON+gzip e 294.245 byte Protobuf+gzip (94,5% in meno del JSON
precedente); sono dimensioni del corpo HTTP, non una misura della latenza totale.

## API forno

`GET /api/forno/messages?fromMs=...&toMs=...&showNotes=1&eventTypes=program_run,...`
restituisce note/eventi selezionati. `revision` opzionale permette una risposta
`unchanged:true` se il client possiede già lo stesso intervallo/filtro.
`POST /api/forno/notes` crea una nota con `timestampMs`, `text`, `clientToken` UUID;
`PUT /api/forno/notes/:id` aggiorna con `text` e `revision`;
`DELETE /api/forno/notes/:id` elimina con `revision`. Conflitto: HTTP 409.
L'identità proviene dall'header LAN AyPi `x-aypi-user`, non è una firma certificata.
Gli eventi automatici non sono modificabili o eliminabili tramite queste API.

`GET /api/forno/sample?timestampMs=...`: campione originale più vicino entro
un periodo di acquisizione (almeno 500 ms), quattro letture coerenti allo stesso
timestamp, qualità e media dei valori validi. Usa snapshot e ricerche indicizzate
su due blocchi vicini, evitando scansioni dell'archivio. Serve il backend aggiornato.

`GET /api/forno/analysis?fromMs=...&toMs=...&windowSeconds=60`: riepiloghi e
analisi delle finestre per canale e media complessiva. Snapshot SQLite coerente.

`GET /api/forno/status`: salute del collector, ultimo campione, periodo effettivo
configurato, errore di persistenza e dimensione dei file.

`GET /api/forno/history?fromMs=...&toMs=...&intervalMs=500&maxPoints=2000`

Estremi inclusivi UTC, massimo 366 giorni/richiesta, risoluzione minima 500 ms,
`maxPoints` tra 1 e 4000. Il risultato indica la risoluzione richiesta ed effettiva,
riassunti per bucket e statistiche complessive esatte dell'intervallo.
`missing` conta i tentativi senza una temperatura valida (anche canali Off); non include periodi in
cui il collector era spento. Le medie sono sui campioni validi, non pesate nel tempo.
Il modulo segue l'accesso LAN delle API AyPi esistenti; non pubblicarlo su Internet.

## Dimensioni e UHH

`D:\Forno\NANODAC` contiene 564 file per 23,163,087 byte (22.1 MiB).
Dai nomi si vedono date 2019–2026; non sono stati decodificati intervalli, canali
o frequenza di registrazione. Non sono stati modificati né importati i file UHH.

Benchmark sintetico locale: 172,800 campioni (un giorno a 500 ms), segnale termico
simulato e compattazione lossless: 897,024 byte, circa 0.86 MiB/giorno. La proiezione
è circa 312 MiB/anno per quel segnale, non una garanzia sul forno reale. Il test
di generazione veloce disabilitava fsync; la configurazione di produzione conserva
`FULL`. La misura è del DB compattato, esclusi WAL temporaneo e backup.

## Verifica

```powershell
node --test tools/test-forno.cjs
node tools/test-forno-ui.cjs
npm run build:backend
npm run build:backend:tray
```

I test Node coprono compressione senza perdita, risoluzioni indipendenti,
recupero dopo crash e lunga interruzione, timeout, limiti query e lock esclusivo.
Il test UI Electron usa un backend simulato e non contatta macchine o MES.
La lettura Modbus reale è stata verificata separatamente con un database temporaneo,
inclusa consultazione a diverse risoluzioni e riavvio del processo.

## Build e distribuzione

`npm run build:backend` esegue anche `npm run prepare:forno`: scarica il
binario SQLite dalla release ufficiale better-sqlite3 corrispondente ad ABI,
architettura e versione Electron del progetto. I file generati in
`backend/resources/forno/native` non sono sorgenti e sono inclusi come risorse
nel pacchetto backend. La compilazione richiede rete solo se non sono gia presenti.
Non viene compilato niente sul server e non viene cercato un interprete esterno.

Il fork usa l'eseguibile Electron distribuito con AyPi: mantenere abilitato il fuse
`runAsNode` (default del progetto). Le librerie native sono escluse dall'ASAR.
Il test sul pacchetto Windows ha verificato lettura reale, query storiche e arresto
con Python e Node rimossi dal PATH.

## Preferenze locali del pannello forno

Il pannello usa il tema AyPi classico (ambra) come impostazione iniziale.
In **Opzioni grafico** si possono scegliere anche il tema blu e quello scuro,
divisioni X/Y, frequenza delle etichette, decimali dei gradi, intensita della griglia,
spessore curva, punti, legenda, intervallo min/max e apertura della diagnostica.
Le preferenze sono salvate in `<userData AyPi>/forno/view-settings.json`, sul PC
client/profilo Windows corrente, mediante il processo principale Electron.
Non transitano sul server e non cambiano la raccolta. Anche risoluzione, periodo
e modalita della scala vengono ripristinati alla successiva apertura.

Le divisioni indicano gli intervalli: 8 divisioni generano 9 linee. La griglia resta
fissa al variare dello zoom; le etichette possono comparire ogni N linee, con prima
e ultima sempre visibili su entrambi gli assi. La scala **Automatica** segue i
campioni visibili; **0 -> Max + 50 C** parte da zero e termina 50 gradi sopra il
massimo della vista. I campioni originali non vengono modificati.

**Seleziona data** apre il singolo giorno dalla mezzanotte locale fino all'ultimo
millisecondo prima della mezzanotte successiva, gestendo anche i giorni di 23/25
ore. Il live viene disattivato quando si apre un giorno storico.

Verifiche aggiuntive: `node --test tools/test-forno-preferences.cjs`,
`node tools/test-forno-ui.cjs` e `node tools/test-forno-launcher.cjs`.
Il test `node tools/test-forno-packaged-messages.cjs`, dopo la distribuzione del
backend, verifica il pacchetto Windows con un nanodac TCP simulato e un database
temporaneo: quattro canali, eventi, API note, conflitti HTTP 409, eliminazione
e aggiornamenti condizionali. Non contatta il forno reale o gli archivi aziendali.

## Apertura e identita del modulo

La finestra Forno viene massimizzata sia alla prima apertura sia quando viene
richiamata da Robot dopo essere stata ripristinata a dimensioni normali.
Il marchio nell'intestazione usa la geometria Ay/Pi con alone e barra obliqua
gia presente nel MES. Lo splash Forno riutilizza direttamente il foglio animato
del Production Planner e la variante AGPress condivisa con Calendar/Purchasing.

Lo splash puo essere saltato con un clic, Invio o Esc e termina automaticamente.
La durata massima e limitata anche quando il backend non risponde. Con movimento
ridotto attivo vengono saltate le animazioni. Le fasi visualizzate indicano
interfaccia, verifica server, accesso archivio e costruzione grafico; gli errori
rimangono visibili nel modulo al termine dell'animazione.
Il pulsante Aggiorna e la spia di stato nell'intestazione permettono di verificare
la raccolta senza dover aprire la diagnostica dettagliata.
