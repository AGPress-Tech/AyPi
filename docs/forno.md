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
canali nel bucket visualizzato; nel resoconto è la media aritmetica delle medie
dei canali nell'intervallo selezionato, con lo stesso peso per ogni canale.
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
  e selezione del giorno, senza selettore Periodo.
- Live incrementale: si richiedono solo gli intervalli nuovi e l'ultimo incompleto,
  con aggiornamento ogni 1–5 secondi in funzione della risoluzione scelta.
  Con vista 0.5 s si vedono entrambi i campioni nel refresh di circa un secondo.
- Storico e viste lunghe: massimo 2000 bucket per richiesta; la risoluzione può
  essere aumentata automaticamente, con indicazione visibile nel pannello.
- Ogni bucket conserva min, max, media e conteggi. I picchi restano visibili.
- Tooltip dopo 500 ms a mouse fermo, entro 24 pixel da una curva visibile;
  il controllo della distanza include gli estremi orizzontali della traccia.
  Una volta aperto, resta visibile con il cursore fermo e aggiorna il campione
  sotto il cursore quando il live scorre, anche se la temperatura cambia.
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
  eventi della rotella per evitare richieste continue alla rete.

## API sola lettura

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
