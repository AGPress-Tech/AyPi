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

Il pulsante **Cicli forno**, a sinistra dello stato acquisizione, apre il menu
con la voce **Visualizza cicli memorizzati**. Mostra i nomi dei programmi letti
dal nanodac, il numero di cicli e la data dell'ultima lettura. **Aggiorna elenco**
esegue una nuova lettura; nessun polling automatico o elenco locale precompilato.
Occorre aggiornare backend e client.

La richiesta `POST /api/forno/programs/list` usa una connessione dedicata sul
backend con host/porta/Unit ID configurati per il forno. L'unica scrittura è il
comando documentato FC06 `14976=1` (Get Listing); attende Complete e legge fino
a 100 nomi con richieste FC03 di 21 registri a partire da `30976+i`.
Non carica, salva, modifica o avvia programmi. Le richieste contemporanee delle
postazioni condividono la lettura in corso; gli errori non diventano elenchi vuoti.
Il timeout complessivo è 12 secondi e il socket è distinto dai collector.
Il trasporto delle temperature e degli eventi rimane di sola lettura FC03.

In Run o Hold il comando Get Listing può essere rifiutato dal nanodac. La richiesta
elenco verifica prima modo/stato: durante la lavorazione restituisce soltanto il
programma caricato, con `scope: "current"`, usando esclusivamente FC03. La finestra
mostra **Ciclo in lavorazione** o **Ciclo in pausa** e permette di aprirne il grafico;
l'archivio completo resta disponibile in Reset. Anche una transizione Reset → Run
durante la richiesta viene gestita recuperando il ciclo caricato.

Un clic sul nome di un ciclo apre **Programmazione del ciclo**: profilo nominale
tempo/temperatura, durata calcolata dalle fasi, temperatura massima, azione finale
e schede selezionabili per evidenziare rampe e soste sul grafico. Tooltip con
tempo e setpoint; la temperatura iniziale dell'anteprima è modificabile solo
localmente e parte da 0 °C. Nessun parametro viene ricavato dal nome del file.

`POST /api/forno/programs/preview` riceve `{name, allowTemporaryLoad?: boolean,
expectedCurrentProgram?: string}`. In questa fase `allowTemporaryLoad:true`
è rifiutato sia dall'IPC desktop sia dal servizio backend, prima dell'accesso
al forno. Il programma già caricato rimane consultabile.
Se il ciclo è già caricato e non modificato, legge soltanto FC03: impostazioni
programmatore/program, segmenti nativi a `0x8000 + 2*(15040 + 48*i)` e nomi
dei segmenti. I target sono float32 e i tempi uint32 in millisecondi, senza il
limite degli interi a 16 bit. Nome e revisione vengono verificati prima/dopo.
Sono rappresentati rampe a tempo o velocità, soste, step, due canali sincronizzati
e GoBack finiti (massimo 500 fasi). Attese esterne e ripetizioni continue hanno
durata variabile: l'anteprima si ferma senza inventare una fine. Holdback e
mantenimento indefinito finale sono indicati esplicitamente.

Per un ciclo diverso, la richiesta non carica nulla e la vista propone
**Apri archivio locale e backup**. Il precedente percorso **Leggi e ripristina**
è sospeso per rispettare il vincolo di non modificare al momento il forno.
Il codice di basso livello precedente resta coperto da simulatore, ma non è
raggiungibile tramite il servizio/IPC con caricamento autorizzato. Per leggere
gli altri programmi si importano il clone iTools o i file nativi locali.
Non vengono inviati Load, Run, Hold, Reset, Store, Delete o modifiche ai segmenti.
Le operazioni elenco/anteprima sono serializzate fra le postazioni.

Verifiche: `node --test tools/test-forno-programs.cjs tools/test-forno-recipe-profile.cjs`
(dopo compilazione backend) e `node tools/test-forno-ui.cjs`.

### Eventi ausiliari: indagine prima dell'editor (02/11/2026)

Verifica sul nanodac `192.168.1.165`, Unit ID 255, con sole richieste FC03:
programma già caricato `Ciclo_1_530_8h`, modo/stato Reset `[1,1]`, revisione
configurazione 18. Non sono stati inviati Load, Store, Run o comandi agli attuatori.

| Segmento | Profilo nominale CH1 | Evento 1 | Evento 2 | Evento 3 | Valore utente CH1 |
| --- | --- | --- | --- | --- | --- |
| 1 | Rampa a 200 °C, 1 h | OFF | OFF | OFF | 0 |
| 2 | Sosta, 1 h | OFF | OFF | OFF | 5 |
| 3 | Rampa a 400 °C, 2 h | OFF | OFF | OFF | 0 |
| 4 | Sosta, 1 h | OFF | OFF | OFF | 5 |
| 5 | Rampa a 530 °C, 2 h | OFF | OFF | OFF | 0 |
| 6 | Sosta, 4 h | OFF | OFF | OFF | 5 |
| 7 | Rampa a 10 °C, 30 s | ON | ON | ON | 0 |
| 8 | Fine → Reset | OFF (Reset) | OFF (Reset) | OFF (Reset) | 0 |

`MaxEvents` (14893) = 3; gli otto `ResetEvent` (14894–14901) sono zero.
Holdback ed eventi PV sono disabilitati; UserValue e Messages sono abilitati
(14848–14851 = `[0,0,4,8]`). I valori utente 5 nelle soste erano anch'essi
omessi dalla vecchia anteprima: il loro significato dipende dal wiring.

La segnalazione «apertura camino» è compatibile con la fase 7, ma NON identifica
quale evento comandi il camino né la funzione degli altri due. Tutti e tre sono
attivi contemporaneamente. Non si può dedurre se comandino tre attuatori distinti,
logiche intermedie o un'azione combinata. ON/OFF è lo stato logico programmato,
non una conferma della posizione fisica. La discesa a 10 °C in 30 s è il setpoint
nominale, non il tempo necessario al raffreddamento reale.

Riferimento: manuale Eurotherm HA030554, sezioni 3.4.9, 4.8.1, 4.8.3 e 5.3
([PDF issue 5, tabella Segment.1 a pagina PDF 223](https://eurothermonline.com/media/instrument-manuals/nanodac%20Recorder%20%20Controller%20User%20Guide%20%28HA030554%20issue%205%29%20%289.38MB%29.pdf#page=223)).
Il dispositivo supporta fino a otto eventi; il numero tre è una configurazione
di questo forno. Gli eventi possono essere collegati ad altri parametri.
Serve il clone completo iTools `.uic` e, per la funzione fisica finale, lo schema
elettrico o la conferma del manutentore. Il file del solo programma non basta.
In iTools selezionare lo strumento e usare File → Save to File / Save dalla
finestra principale; non usare Load Values From File, Send to Device o Download.

**Riscontro successivo nel clone fornito `forno magazzino.uic` (02/11/2026).**
Il file è stato analizzato solo localmente. I riferimenti numerici `Wire.N.Src`
e `Dest` sono stati risolti contro il campo `SortIndex` delle righe parametri,
non interpretati come indirizzi Modbus. Risultano 28 collegamenti attivi:

| Evento | Collegamento interno verificato | Morsetti | Tipo / inversione |
| --- | --- | --- | --- |
| E1 | Wire.26: Programmer.Run.Event1 → DigitalIO.3A3B.PV | 3A–3B | ON/OFF, Invert=0 |
| E2 | Wire.27: Programmer.Run.Event2 → DigitalIO.RELAY_4AC.PV | 4A–4C | ON/OFF, Invert=0 |
| E3 | Wire.28: Programmer.Run.Event3 → DigitalIO.RELAY_5AC.PV | 5A–5C | ON/OFF, Invert=0 |

Righe del clone: collegamenti 552–557, configurazione I/O 5197–5239.
Il clone da solo non contiene etichette degli attuatori esterni. Il successivo
screenshot del wiring iTools fornito dall'operatore identifica le uscite:
E1 / 3A3B = **Uscita saracinesca**; E2 / RELAY_4AC = **Marcia aspiratore**;
E3 / RELAY_5AC = **Marcia scambiatore**. Questi nomi sono mostrati nell'editor,
nella controverifica, nell'archivio e nella lettura dei programmi.
Nelle opzioni degli eventi storici il gruppo Uscite evento contiene anche tre
filtri separati per E1/E2/E3. Selezionare uno dei tre attiva il gruppo; i canali
sono filtrati localmente e la selezione viene salvata nelle preferenze della
postazione. Al backend viene ancora richiesto il solo tipo `digital_event`.
I messaggi storici nel formato del collector vengono visualizzati con i nomi
degli attuatori e ON/OFF; i record non riconosciuti restano consultabili sotto
il gruppo generico. Non occorre aggiornare il backend e i record originali
non vengono riscritti.
Nelle schede delle fasi la sintesi mostra gli eventi ON e i passaggi ON → OFF
rispetto al segmento precedente memorizzato; gli OFF invariati sono omessi.
Se la sintesi è vuota non viene aggiunta una riga. Gli stati completi restano
disponibili nella tabella ausiliaria e nell'editor, compresi gli stati di Reset.
Le etichette non sono feedback della posizione o marcia effettiva. L'operatore
ha successivamente confermato che E1 ON comanda l'apertura della saracinesca:
l'app lo identifica come Apertura saracinesca. OFF disattiva il comando di
apertura; non viene dedotto un feedback di chiusura.
L'aggiornamento cambia solo la presentazione: ordine dei tre bit, backup,
parametri e programmi memorizzati non vengono modificati.

**Il valore utente CH1 non è un parametro accessorio inutilizzato.**
I collegamenti Wire.1–14 realizzano una logica di attesa termica personalizzata:

- `Lgc2.1` confronta `Programmer.Run.Ch1UserVal` con zero (`Oper=5`, uguaglianza).
- `Math2.1` somma 1 al risultato; `Mux8.1` seleziona quindi il valore utente
  quando è diverso da zero, oppure `UsrVal.1.Val=1000` quando è zero.
- `Math2.2` sottrae il valore selezionato dal setpoint `Programmer.Run.Ch1PSP`.
- `Lgc2.2` e `Lgc2.3` confrontano rispettivamente le PV di Channel 1 e Channel 2
  con questa soglia (`Oper=8`, minore). `Lgc2.4` combina i risultati in OR
  (`Oper=2`) e alimenta `Programmer.SetUp.Hold`.

In condizioni valide: `Hold = (PV1 < PSP - tolleranza) OR
(PV2 < PSP - tolleranza)`, con tolleranza uguale al valore utente se diverso
da zero, altrimenti 1000. Nel ciclo 1 le soste usano 5 °C: basta che uno dei
due canali scenda sotto PSP−5 °C per attivare l'ingresso Hold. Non è una banda
simmetrica ±5 °C e non è la funzione Holdback nativa (che è disabilitata).
Lo zero seleziona la tolleranza ampia 1000, non elimina fisicamente la logica.
Le conclusioni descrivono il cablaggio configurato; comportamento con guasti
dei canali e modalità di ripresa vanno verificati nel collaudo dell'editor.
Righe clone: Math2 334–361, Mux8 1538–1553, Lgc2 1602–1629, UsrVal.1 1712–1717.
Le operazioni numeriche sono state confrontate con HA030554 §5.3.

Questa logica usa due sensori pur avendo il programmatore un solo profilo CH1.
I due loop di regolazione pilotano separatamente le uscite 1A–1B e 2A–2B
(Wire.20 e Wire.25): non vanno confusi con gli eventi ausiliari E1–E3.

La lettura ora restituisce gli otto eventi per segmento, gli stati globali di
Reset, le funzioni abilitate, valori utente, soglie/uso degli eventi PV e criteri
di attesa/Holdback. I bool sono interpretati come non-zero: sul forno la fase 7
restituisce `[1,2,4,0,0,0,0,0]`, non `[1,1,1,0,0,0,0,0]`. Sono conservati anche
i 72 word nativi originali di ogni segmento, inclusi i word di riempimento:
non devono essere usati come blocco di scrittura indiscriminato.
La vista riporta E1/E2/E3 sulle schede e una tabella di tutti i segmenti,
inclusi Fine, Wait e GoBack, con ON e OFF espliciti. Per Fine → Reset mostra
gli stati globali di Reset. Un backend precedente è segnalato come privo dei
dati ausiliari, senza inventare stati OFF. Aggiornare backend e client.

La scrittura sul nanodac non è ancora abilitata. Il programmatore locale
descritto sotto permette di preparare bozze. Prima di introdurre l'invio occorre:

- Verificare la corrispondenza evento → logica interna → uscita → attuatore,
  le inversioni, gli eventuali impulsi/memorie e l'effetto di Reset; chiarire
  anche l'uso dei valori utente. Non provare attuatori per identificarli.
- Definire un formato completo di modifica, separato dall'anteprima termica,
  preservando anche i parametri non modificati e distinguendo impostazioni
  globali del forno dai parametri del singolo programma.
- Validare tipi, limiti e funzioni disponibili; rendere configurabili gli
  eventi per ogni segmento con nomi verificati e ON/OFF espliciti.
- Operare solo in Reset, con esclusione delle operazioni concorrenti,
  verifica che il programma non sia cambiato e backup verificabile prima
  delle modifiche. Le scritture Modbus multiple non sono una transazione
  atomica: prevedere interruzione, esiti incerti e recupero esplicito.
- Rileggere e confrontare tutti i parametri dopo la modifica, verificare
  l'esito Store e, in condizioni controllate, la persistenza dopo il Load.
  Il solo ACK Modbus non dimostra che il programma salvato sia corretto.
- Collaudare prima con simulatore (maschere 1/2/4, due canali, Fine/Reset,
  perdita collegamento/ACK, modifica dal pannello, salvataggio parziale),
  poi con verifica concordata sul forno fermo senza avviare un ciclo.

Verifiche aggiuntive: `node --test tools/test-forno-recipe-auxiliary.cjs`;
il test UI verifica le tre colonne, gli eventi ON e il ritorno OFF in Reset.

### Programmatore locale: grafico e tabella sincronizzati

**Cicli forno → Programmatore · crea o riprendi bozza** apre l'editor desktop.
Dalla lettura di un programma compatibile, **Modifica una copia in bozza**
importa le fasi già lette, senza ulteriori richieste al forno e senza modificare
la ricetta originale. Sono supportati tutti i sei tipi del programmatore
CH1 con rampe a tempo: Rampa, Stasi, Step, Wait, GoBack e Fine. L'importazione
rifiuta profili a due canali, rampe a velocità e funzionalità ausiliarie non
gestite, senza trasformarle in fasi equivalenti inventate. Il ciclo 1 è compatibile.
L'editor è disponibile sul client desktop; su Android rimane la consultazione.

La finestra occupa quasi tutta la larghezza e altezza disponibili. Grafico a
sinistra e fasi a destra hanno pannelli indipendenti; la lista delle fasi scorre
verticalmente senza spostare il grafico. Le celle sono organizzate per fase,
con campi numerici esatti e parametri specifici del tipo selezionato.

Ogni fase è una **Rampa**, **Stasi**, **Salto (Step)**, **Attesa (Wait)**,
**Ripetizione (GoBack)** oppure **Fine / Reset**. Si impostano
nome fase, temperatura finale, durata, tre eventi ON/OFF indipendenti e valore
utente CH1. Una sosta mantiene il setpoint della fase precedente: il relativo
campo temperatura è di sola lettura e segue le modifiche della rampa precedente.
La prima sosta usa la partenza dell'anteprima. La partenza è locale e non
imposta né modifica la configurazione PV/SP del forno. I dati termici sono
decimi interi di °C, i tempi millisecondi interi; non si memorizzano coordinate
pixel o durate derivate da valori arrotondati in ore.

- **+ Rampa / + Stasi** o **Tipo → + Aggiungi fase** inseriscono dopo la fase
  selezionata, oppure in fondo senza selezione. Se è presente Fine, le nuove
  fasi sono inserite prima della chiusura. Sono consentite 25 fasi più Fine.
- **+ Fine** aggiunge esplicitamente il segmento finale: le nuove bozze non
  contengono alcuna Fine precompilata. Fine deve essere unica e ultima, può
  essere rinominata, modificata o eliminata. La verifica e il file nativo sono
  bloccati se manca; il salvataggio della bozza incompleta resta disponibile.
- **Seleziona / sposta**: trascinare un punto cambia il termine della fase;
  per una rampa cambia anche la temperatura. Le fasi successive conservano
  le proprie durate. Le soste consecutive mantengono la temperatura coerente.
- **Disegna punti**: un click dopo l'ultimo punto aggiunge una fase; un click
  interno a una rampa la divide conservando il termine originario, il tempo
  totale e i parametri ausiliari di entrambi i tratti. Non si divide una sosta
  trasformandola implicitamente in una rampa.
- Step cambia il setpoint istantaneamente, con un tratto verticale a tempo zero.
  Wait mantiene il setpoint finché è soddisfatta una condizione sull'ingresso
  `Wait Digital` o `Wait Analog 1` del programmatore CH1. Per l'analogico si
  impostano criterio assoluto/deviazione alto/basso e soglia. La configurazione
  dei collegamenti del forno non viene modificata e non si presume che tali
  ingressi coincidano direttamente con i sensori di temperatura.
- GoBack richiede fase precedente e numero di ripetizioni (0 = continuo).
  I cicli finiti vengono espansi nel grafico fino a 500 passaggi. Le ripetizioni
  annidate/sovrapposte sono rifiutate secondo HA030554 §3.4.9. Inserire una fase
  rinumera le destinazioni; una fase usata come destinazione non può essere
  eliminata senza modificare prima il riferimento. Per profili con GoBack si
  modificano i parametri nella tabella, evitando trascinamenti ambigui su
  un passaggio ripetuto.
- Il grafico si ferma alla prima attesa esterna o al primo GoBack continuo e
  avvisa che le fasi successive restano configurate. Non vengono inventati
  tempi per attese, cicli continui o mantenimento indefinito finale.
- Il passo grafico è selezionabile: 1 secondo, 30 secondi, 1 minuto,
  10 minuti, 30 minuti, 1 ora; temperatura 1, 5, 10, 50, 100 °C.
  Rotella: zoom orizzontale; Maiusc+rotella: zoom verticale. L'origine resta
  fissa a 0 ore e 0 °C, indipendentemente dalla posizione del puntatore.
  Lo zoom cambia soltanto il massimo dell'asse; il minimo ingrandimento visibile
  comprende sempre tutto il profilo rappresentato, con margine del 3%.
  Ulteriori richieste di restringere la vista oltre il profilo vengono limitate.
  Adatta grafico ripristina il profilo completo. Lo zoom modifica soltanto la
  vista e mantiene otto intervalli uguali con etichette complete. Gli intervalli
  temporali includono 0,5 / 1 / 1,5 / 2 / 2,5 / 3 / 4 / 5 / 6 / 8 / 10 ore
  e passi successivi; quelli termici includono 0,5 / 1 / 2 / 2,5 / 5 / 10 /
  15 / 20 / 25 / 30 / 40 / 50 / 75 / 100 °C e passi successivi. Minimo 0,5,
  massimo un decimale nelle etichette. Durante il
  trascinamento e al rilascio gli assi restano fermi: il punto segue le coordinate
  assolute del puntatore, limitato ai bordi della vista e al passo selezionato.
  Grafico, dettaglio della fase, durata totale, tabella e controverifica mostrano
  il candidato a ogni movimento. Il salvataggio avviene soltanto al rilascio
  valido, come singola modifica annullabile; il cambio di scala non altera
  il valore se il puntatore rimane fermo. L'anteprima usa requestAnimationFrame
  e aggiorna i campi della tabella esistenti senza ricostruirla a ogni movimento.
  Il solo tooltip nativo del grafico, posizionato a sinistra del punto, mostra
  tempo, temperatura e fase fino al rilascio/annullamento, anche se il mouse
  rimane fermo durante il drag. Gli eventi hover sono sospesi durante la presa
  per impedire che nascondano il tooltip; nessuna seconda etichetta HTML.
  Le frecce sul canvas spostano il punto selezionato di un passo, Maiusc di
  dieci. Esc o annullamento del puntatore ripristinano il profilo precedente;
  un rilascio su un valore non valido annulla lo spostamento completo.
- La tabella accetta temperature con punto o virgola e al massimo un decimale;
  tempi a secondi interi, da 1 secondo a 500 h per fase. Il campo durata usa
  tre cifre per le ore e separatori `:` fissi: digitazione e cancellazione
  sovrascrivono soltanto le cifre; l'incolla accetta tempi completi validi.
  Anche l'importazione di righe Excel rifiuta le frazioni di secondo.
  Il formato nativo conserva la risoluzione in millisecondi: eventuali frazioni
  originali restano immutate se si modificano altri campi. Il tooltip del campo
  ne espone il valore esatto; modificando quella durata si impostano secondi interi.
  Confermare con Tab/Invio. Input incompleti o non validi rimangono visibili
  e bloccano grafico, salvataggio ed esportazione finché corretti o annullati.
  Le modifiche sono applicate al modello soltanto quando tutti i campi sono validi.
- **Incolla righe da Excel** accetta sette colonne TSV senza intestazione:
  `rampa/stasi` (accettata anche `sosta`), temperatura finale, durata, E1, E2, E3, valore utente CH1.
  L'aggiunta è atomica: se anche una riga è errata non ne viene applicata nessuna.
- Annulla/Ripristina conserva fino a 100 modifiche. Nuova bozza e importazione
  di una copia sono anch'esse annullabili nella sessione.
- Clic sulla scheda o sul numero seleziona la fase e la evidenzia nel grafico.
  Aggiungi fase (anche Rampa/Stasi) inserisce dopo la selezione; senza selezione
  inserisce in fondo, prima di Fine. Fine rimane sempre l'ultima fase.
  Trascinare il numero sulla metà superiore/inferiore di una scheda sposta
  prima/dopo quella fase, con indicatore di destinazione e scroll ai bordi.
  Dal numero è disponibile anche Alt+freccia su/giù. Ogni spostamento è una
  singola modifica annullabile: nomi manuali, durate, target di rampa/salto,
  eventi e valori utente seguono la fase; i plateau ereditano il nuovo setpoint
  precedente. Le destinazioni GoBack seguono la fase originale rinumerata;
  un ordine che rende il salto non retrogrado o crea cicli annidati è rifiutato
  integralmente, senza salvare modifiche parziali.

**Verifica programma** mostra istruzioni per ogni fase, tempi iniziali/finali,
durata in ms, target decimale e corrispondente float32, eventi e valore utente.
Usa lo stesso modello canonico del grafico e della tabella. La rappresentazione
IEEE754 può avere piccoli scarti visibili rispetto al decimale (es. 530,1 °C):
il confronto con i valori nativi rientrerà nella futura verifica di scrittura.
Il segmento Fine ha un'azione Reset, con stati globali del dispositivo da
verificare, oppure mantenimento indefinito con eventi e valore utente configurati
sul segmento. Con Reset i relativi controlli sono disabilitati perché si applicano
i valori globali del forno. Gli eventi sono pulsanti con icone SVG di croce
(OFF) oppure spunta (ON), stato accessibile e tooltip, senza caratteri testuali.
Le fasi usano righe compatte che si adattano allo spazio del pannello destro,
con scorrimento indipendente dal grafico.

Il formato bozza è ora versione 2: Fine è una fase nella stessa lista delle
altre. Le bozze e i backup v1 vengono letti conservando la Fine già prevista,
il suo nome e la sua azione; non viene aggiunta una nuova Fine alle bozze v2.
La migrazione in visualizzazione non riscrive i file originali né altera gli
hash dei backup precedenti. I `.uipz` originali rimangono immutati; la generazione
serializza soltanto i segmenti esplicitamente presenti, senza chiusure implicite.

Ogni modifica valida viene salvata automaticamente su questo PC in
`<userData AyPi>/forno/program-draft.json`, tramite file temporaneo, fsync,
rename e rilettura per confronto. Un errore è visibile, non sostituito con una
bozza vuota. La bozza contiene versione/formato espliciti; campi sconosciuti
e versioni non supportate sono rifiutati. Salva bozza permette di riprovare;
Esporta/Apri bozza usa file `.aypi-forno.json` scelti dall'operatore. Sono bozze
AyPi, non file nativi nanodac. Modifiche non ancora confermate nei campi non
sono salvate; restano nella finestra durante la sessione. Conservare bozze
alternative tramite esportazione prima di chiudere l'applicazione: la cronologia
Annulla non è persistita. Non è un archivio condiviso fra postazioni.

Il campo dell'editor −10000…10000 °C è un limite di rappresentazione, non un
limite operativo autorizzato per la macchina. Precisione del modello e tempi
nominali non attestano precisione fisica, risoluzione effettiva dell'attuatore o
durata reale con pause Hold. Il valore utente è gestito esplicitamente per
preservare la logica di attesa termica individuata nel clone; non va confuso
con la stasi. Le nuove stasi propongono 5, modificabile; le nuove rampe 0.
Nel cambio del tipo viene proposta la configurazione propria del nuovo tipo;
il valore utente personalizzato resta conservato, mentre il valore di default
segue la scelta di rampa/stasi. Fine → Reset usa sempre gli stati globali.
L'importazione conserva ogni valore originale: alcuni programmi esistenti
hanno stasi con valore 0, quindi 5 non è un codice del tipo segmento.

Non esiste un endpoint/comando di invio della bozza al forno. I comandi locali
`forno-draft-load/save/import/export` non chiamano il backend. Restano da
completare mappatura degli attuatori, limiti validati della macchina e protocollo
di scrittura/rilettura indipendente/persistenza descritto sopra.

Verifiche: `node --test tools/test-forno-program-draft.cjs` e
`node tools/test-forno-ui.cjs`. Coperti: risoluzioni e limiti, plateau,
divisione/trascinamento dei punti, importazione del ciclo 1 confrontata con i
dati reali, file corrotto e salvataggio non valido senza sovrascrittura;
nella UI anche trascinamento e disegno con eventi mouse reali, undo/redo,
incolla senza applicazioni parziali, export identico alla bozza salvata e
assenza di richieste programmi al nanodac durante l'editing locale.

### Archivio programmi, backup e preparazione dei file nativi

**Cicli forno → Archivio locale e backup programmi** apre la gestione locale.
Nella lista dei programmi del forno sono presenti anche **Backup programmi…**,
**Importa 1 o più programmi…** e **Gestisci archivio locale**. Al primo backup,
se l'archivio è vuoto, viene chiesto di scegliere il clone iTools o i file
nativi: non viene effettuata una scansione con caricamento dei programmi.

Il formato portabile è `.aypi-forno-backup.json`, distinto dalla bozza singola
`.aypi-forno.json`. Contiene tutte le versioni selezionate, i file `.uipz`
originali in base64 e, quando presente, il clone `.uic` completo originale.
SHA-256 verifica il contenuto complessivo e ciascun file; gzip verifica anche
il CRC dei programmi. Il collegamento di ogni originale al proprio clone viene
controllato sul nome e sull'hash, non solo sul nome. Gli hash rilevano
corruzioni, non costituiscono una certificazione di funzionamento hardware.
La data del file clone è esposta come data sorgente, senza fingere che il
backup sia una nuova lettura dello stato attuale del forno.

L'importazione multipla accetta `.uic`, `.uipz`, backup AyPi e bozze singole.
Tutti i file sono validati prima dell'unica scrittura locale: un file corrotto
annulla l'intera importazione. Le copie con lo stesso nome ricevono ID distinti,
senza sovrascrivere per nome. Il sottoinsieme XML nanodac 811 osservato viene
letto conservativamente; file validi di versioni/tipi non gestiti rimangono
conservati integralmente ma non editabili. I file originali non sono ricompressi.

**Salva versione nell’archivio** dall'editor salva una nuova versione locale,
preservando l'originale associato quando si è partiti da una voce dell'archivio.
La bozza di lavoro continua ad avere il proprio salvataggio automatico distinto.
I nomi segmento vuoti sono automatici (numero corrente); i nomi manuali sono
conservati. Fine compare come ultimo segmento numerato e ha un nome impostabile.
Gli eventi sono separati con pulsanti a icona **croce / spunta** (OFF / ON): possono essere predisposti
singolarmente, ma non azionati dalla vista.

**Elimina selezionati solo dal PC** è una cancellazione logica e recuperabile
tramite **Mostra anche eliminati dal PC → Recupera eliminati locali**. Gli
originali sono conservati. Il backup completo comprende anche gli eliminati;
quello della selezione comprende soltanto le voci selezionate.

**Prepara ripristino degli originali…** estrae in una nuova cartella i `.uipz`
identici ai byte importati, uno per sottocartella per evitare conflitti di nomi.
**Esporta versioni locali .uipz…** genera file per le versioni modificate/nuove,
confronta la rilettura con il modello dell'editor e li marca come generati e
non collaudati su hardware. Un manifest `VERIFICA.json` elenca nomi, hash e
origine dei file. I programmi originali e quelli generati sono distinguibili.
L'XML/gzip è coerente con i nove originali forniti; la rilettura software non
dimostra che un programma sia stato accettato, salvato e rieseguito dal forno.

Il pulsante **Invio al forno bloccato** rimane disabilitato anche dopo un backup:
non esistono endpoint di Store/Delete o azionamento relè. Il successivo collaudo
del ripristino deve essere concordato prima di qualsiasi invio reale.
Non usare il ripristino dell'intero clone come caricamento selettivo: secondo
HA030554 §Programmer/Cloning può sostituire configurazione e archivio programmi.
Riferimento ufficiale: [manuale Eurotherm](https://www.eurotherm.com/?wpdmdl=27991).

L'archivio di lavoro è `<userData AyPi>/forno/program-library.json`, con ID,
revisioni e scrittura atomica/rilettura. File non riconosciuti o oltre 32 MB sono
rifiutati; un errore non viene sostituito con un archivio vuoto. La gestione e
la preparazione dei backup non dipendono da backend, collector o rete.

Per creare un backup offline da un clone senza aprire l'app:
`node tools/backup-forno-clone.cjs "percorso/forno.uic" "cartella backup"`
(dopo compilazione client). Il comando crea una cartella nuova e include clone
identico, backup JSON, nove file nativi nel caso del clone fornito e riepilogo.
Sul clone reale del 02/11/2026 08:14:14 sono stati verificati nove programmi,
senza contattare il dispositivo. Il ripristino sul dispositivo non è stato eseguito.

Verifiche aggiuntive: `node --test tools/test-forno-program-library.cjs`.
Comprendono conteggio/CRC del clone con BOM e CRLF, confronto dei nove originali,
confronto indipendente del ciclo 1 con la lettura FC03, valori zero delle stasi,
nomi XML e Fine, rigenerazione/rilettura, importazione non parziale, backup
alterato, originali non sovrascritti, eliminazione recuperabile, revisioni,
versioni sconosciute e rifiuto del caricamento temporaneo nel servizio backend.
Il test Electron copre anche importazione di nove originali, backup, preparazione
dei file identici, modifica del solo E2, nuova versione, eliminazione/recupero e
assenza di richieste al forno durante tutte queste operazioni locali.

Scheda **MES - SCADA → Apri FORGE → Scada Forno**.
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

Gli intervalli di messaggi e storico vengono limitati a 366 giorni **dopo**
l'arrotondamento ai millisecondi interi. Questo evita richieste di 366 giorni
più 1 ms quando zoom/scorrimento producono estremi frazionari; l'eventuale
margine di precaricamento o allineamento viene ridotto mantenendo la fine
dell'intervallo. La validazione del backend rimane invariata.

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
In **Impostazioni** si possono scegliere anche il tema blu e quello scuro,
divisioni X/Y, frequenza delle etichette, decimali dei gradi, intensita della griglia,
spessore curva, punti, legenda, intervallo min/max e apertura della diagnostica.
L'opacità del tooltip continuo è regolabile da 0% a 100%, con default 100% e
anteprima immediata; chiudendo senza salvare si ripristina il valore precedente.
I quattro valori live restano nell'intestazione anche consultando lo storico;
i selettori compatti delle curve si trovano al centro della barra Andamento termico.
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
richiamata da FORGE dopo essere stata ripristinata a dimensioni normali.
Il marchio nell'intestazione usa la geometria Ay/Pi con alone e barra obliqua
gia presente nel MES. Lo splash di apertura è collocato nell'hub FORGE;
il forno apre direttamente la propria interfaccia, senza animazioni introduttive
o blocchi dei controlli durante l'attesa del backend. Stato acquisizione,
caricamento dello storico ed eventuali errori rimangono visibili nel pannello.
Il pulsante Aggiorna e la spia di stato nell'intestazione permettono di verificare
la raccolta senza dover aprire la diagnostica dettagliata.
