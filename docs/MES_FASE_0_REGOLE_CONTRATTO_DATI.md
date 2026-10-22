# MES e Pianificazione — Fase 0

## Regole di dominio e contratto dati

**Stato:** baseline operativa approvata; Fase 0 completata  
**Data:** 22 ottobre 2026  
**Ambito:** evoluzione di Pianificazione Produzione e PLC Reader nel modulo unico **MES e Pianificazione**

---

## 1. Obiettivo della fase 0

Questa fase definisce il linguaggio comune e le regole che dovranno essere rispettate da database, importatore CSV, futura applicazione di acquisizione, backend e interfaccia.

Non introduce ancora automazioni sulla produzione. Serve a evitare che le schermate, il database e il lettore PLC attribuiscano significati differenti allo stesso conteggio.

I principi fondamentali sono:

1. gli eventi grezzi provenienti dalla macchina non vengono modificati o eliminati;
2. il contatore mostrato per un ordine è un contatore logico MES;
3. ogni ordine attivato in macchina parte da un nuovo contatore logico;
4. i pezzi prodotti senza un ordine attivo rimangono non attribuiti;
5. l'operatore decide come trattare i pezzi non attribuiti quando attiva un ordine;
6. correzioni, esclusioni e attribuzioni sono sempre tracciate;
7. CSV e futuro SQLite di acquisizione espongono lo stesso contratto applicativo;
8. pianificazione ed esecuzione sono collegate, ma un ordine può essere eseguito senza essere già posizionato nel Gantt.

---

## 2. Glossario condiviso

### Ordine di produzione

Contenitore amministrativo e produttivo identificato da un numero ordine. Può comprendere una o più fasi.

### Fase di lavoro

Unità operativa pianificabile e attivabile su una macchina. È la futura evoluzione dell'attuale lavorazione del pianificatore.

### Evento macchina

Rilevazione immutabile proveniente da PLC, robot, CSV o altra sorgente. Un evento può rappresentare uno o più pezzi in base al moltiplicatore configurato.

### Sessione macchina

Intervallo durante il quale una macchina è collegata a una fase, in modalità attrezzaggio o produzione.

### Contatore grezzo

Conteggio osservato dalla sorgente. Può ripartire da zero quando viene riavviato il PLC Reader e non rappresenta direttamente il totale dell'ordine.

### Contatore logico MES

Conteggio relativo alla sessione e alla fase attive. Viene inizializzato a ogni attivazione e può includere quantità pregresse esplicitamente attribuite dall'operatore.

### Pezzi non attribuiti

Pezzi rilevati su una macchina mentre non esiste una sessione di produzione attiva. Non avanzano alcun ordine fino alla decisione di un operatore.

### Rettifica

Operazione manuale che aggiunge, sottrae, attribuisce o esclude quantità. Non altera gli eventi grezzi e richiede autore, data, causale e valore precedente/successivo.

---

## 3. Separazione delle responsabilità

Il flusso dati previsto è:

```text
PLC / Robot
    ↓
CSV temporaneo oppure futuro SQLite di acquisizione
    ↓
Adattatore di importazione
    ↓
Registro immutabile degli eventi macchina
    ↓
Attribuzione a una sessione o al contenitore "non attribuiti"
    ↓
Proiezione dei totali MES
    ↓
Pianificatore, console macchina, griglia dati e analisi
```

Il formato della sorgente non deve comparire nelle regole del pianificatore. Cambiare da CSV a SQLite dovrà richiedere un nuovo adattatore, non una riscrittura del MES.

---

## 4. Identificativi

Gli identificativi interni devono essere stabili e indipendenti dai nomi mostrati all'utente.

| Entità | Identificativo proposto | Nota |
|---|---|---|
| Macchina | `machineId` | Mantiene il codice aziendale, per esempio `21D450` |
| Ordine | `orderId` UUID | Il numero ordine resta un campo aziendale modificabile |
| Fase | `phaseId` UUID | Identifica univocamente la fase anche se viene spostata |
| Sessione | `sessionId` UUID | Una fase può avere più sessioni nel tempo |
| Evento macchina | `eventId` deterministico | Impedisce duplicati durante una nuova importazione |
| Rettifica | `adjustmentId` UUID | Sempre accompagnata da audit |
| Risoluzione non attribuiti | `resolutionId` UUID | Registra la scelta fatta all'attivazione |

Per i CSV correnti, `eventId` sarà derivato almeno da:

```text
identità sorgente + sessione/cartella + file + riga + contenuto normalizzato
```

La stessa riga riletta più volte dovrà produrre sempre lo stesso identificativo.

---

## 5. Stati

### 5.1 Stato di pianificazione della fase

Lo stato di pianificazione è separato dallo stato operativo.

- `BACKLOG`: non posizionata nel Gantt;
- `SCHEDULED`: assegnata a macchina, data e ora;
- `ARCHIVED`: nascosta dalla vista operativa ma conservata.

Una fase `BACKLOG` può comunque essere attivata direttamente in macchina.

### 5.2 Stato operativo della fase

- `NOT_STARTED`: mai avviata;
- `SETUP`: attrezzaggio in corso;
- `RUNNING`: produzione in corso;
- `PAUSED`: sessione temporaneamente sospesa;
- `COMPLETED`: chiusa dall'operatore;
- `CANCELLED`: annullata senza cancellarne lo storico.

Transizioni ammesse nella prima versione:

```text
NOT_STARTED → SETUP → RUNNING → PAUSED → RUNNING → COMPLETED
NOT_STARTED → RUNNING
SETUP → PAUSED
SETUP → RUNNING
NOT_STARTED / SETUP / RUNNING / PAUSED → CANCELLED
```

### 5.3 Stato macchina derivato

- `OFFLINE`;
- `IDLE`;
- `UNASSIGNED_COUNTING`: online, senza ordine, con pezzi non attribuiti;
- `SETUP`;
- `PRODUCING`;
- `PAUSED`;
- `DOWNTIME`.

Nella prima versione una macchina può avere al massimo una sessione attiva.

---

## 6. Regole del contatore

### 6.1 Azzeramento all'attivazione

Quando viene attivata una fase:

1. viene chiusa o verificata l'eventuale sessione precedente;
2. viene acquisito il riferimento corrente della sorgente;
3. il contatore logico della nuova sessione viene inizializzato a zero;
4. vengono esaminati gli eventuali pezzi non attribuiti;
5. solo dopo la decisione dell'operatore la sessione passa a produzione o attrezzaggio.

Il PLC Reader attuale è passivo e non trasmette comandi al PLC. Di conseguenza l'azzeramento iniziale è logico nel MES. Un eventuale azzeramento fisico del contatore PLC sarà possibile solo se una futura integrazione espone esplicitamente un comando sicuro e autorizzato.

### 6.2 Pezzi prodotti senza ordine attivo

Ogni evento valido ricevuto senza una sessione attiva incrementa il contenitore dei pezzi non attribuiti della macchina.

Questi pezzi:

- non aggiornano alcun ordine;
- non aggiornano alcuna barra di avanzamento;
- rimangono visibili sulla console macchina;
- devono essere risolti all'attivazione della produzione successiva;
- non vengono eliminati dal registro eventi.

### 6.3 Domanda obbligatoria all'attivazione

Se sono presenti pezzi non attribuiti, prima dell'avvio il sistema mostra almeno:

- quantità rilevata;
- intervallo temporale interessato;
- ultima produzione chiusa sulla macchina;
- ordine/fase che si sta attivando.

Azioni disponibili:

1. **Attribuisci tutto all'ordine**: il contatore è stato inizializzato a zero e riceve subito un accredito iniziale pari ai pezzi non attribuiti;
2. **Azzera e inizia da zero**: tutti i pezzi precedenti vengono esclusi dall'ordine;
3. **Attribuisci parzialmente**: l'operatore indica la quantità da accreditare e la parte restante viene esclusa;
4. **Annulla attivazione**: nessun dato viene modificato e la fase non parte.

Una risoluzione confermata contiene:

```ts
type UnassignedCountResolution = {
    resolutionId: string;
    machineId: string;
    phaseId: string;
    sessionId: string;
    detectedPieces: number;
    attributedPieces: number;
    excludedPieces: number;
    reasonCode: string;
    note: string;
    actor: string;
    resolvedAt: string;
};
```

Deve valere sempre:

```text
detectedPieces = attributedPieces + excludedPieces
```

### 6.4 Conteggio durante una sessione

Con una sessione `RUNNING`, ogni nuovo evento valido incrementa la quantità rilevata della sessione.

La quantità buona della fase è composta da:

```text
pezzi buoni = pezzi attribuiti automaticamente
             + accrediti manuali
             - storni manuali
             - pezzi classificati come scarto
```

Nessun totale derivato può diventare negativo.

### 6.5 Chiusura della sessione

Alla chiusura:

- il totale della sessione viene congelato;
- i nuovi eventi successivi tornano tra i non attribuiti;
- il raggiungimento della quantità obiettivo non chiude automaticamente la fase;
- al 100% viene chiesta conferma all'operatore;
- l'eventuale sovrapproduzione viene conservata e resa visibile.

---

## 7. Attrezzaggio

L'attrezzaggio è una sessione distinta dalla produzione.

Durante `SETUP`:

- tutti gli eventi macchina vengono registrati;
- i conteggi non avanzano automaticamente la quantità buona;
- viene misurato il tempo effettivo di attrezzaggio;
- i pezzi rilevati sono classificati come conteggi di attrezzaggio in attesa di riconciliazione.

Alla chiusura dell'attrezzaggio l'operatore indica:

- pezzi buoni prodotti durante l'attrezzaggio;
- pezzi di prova o scarto;
- eventuali pezzi da escludere;
- se iniziare immediatamente la produzione.

Deve valere:

```text
pezzi rilevati in attrezzaggio = buoni + scarti/prove + esclusi
```

I pezzi buoni confermati diventano l'accredito iniziale della produzione. La durata effettiva dell'attrezzaggio resta confrontabile con la durata prevista.

---

## 8. Rettifiche manuali

Una rettifica non modifica direttamente un evento macchina. Produce un nuovo evento applicativo.

```ts
type ProductionAdjustment = {
    adjustmentId: string;
    machineId: string;
    phaseId: string;
    sessionId?: string;
    kind:
        | "OPENING_CREDIT"
        | "GOOD_PIECES_ADD"
        | "GOOD_PIECES_REMOVE"
        | "SCRAP_ADD"
        | "SCRAP_REMOVE"
        | "UNASSIGNED_EXCLUSION"
        | "SETUP_RECONCILIATION";
    quantity: number;
    reasonCode: string;
    note: string;
    actor: string;
    createdAt: string;
};
```

Regole:

- `quantity` è sempre positiva; il verso è espresso da `kind`;
- una rettifica richiede una causale;
- la correzione di una rettifica crea una nuova rettifica opposta;
- autore e timestamp sono obbligatori;
- le rettifiche concorrono ai totali, ma restano distinguibili dai pezzi rilevati automaticamente.

---

## 9. Contratto minimo dell'evento macchina

```ts
type MachineCounterEvent = {
    eventId: string;
    source: "PLC_CSV" | "PLC_SQLITE" | "ROBOT" | "DEMO";
    sourceSessionId: string;
    sourcePosition: string;
    machineId: string;
    occurredAt: string;
    receivedAt: string;
    pulseDelta: number;
    pieceDelta: number;
    multiplier: number;
    signal?: {
        mac?: string;
        frameId?: string;
        byte?: number;
        bit?: number;
    };
    raw?: Record<string, unknown>;
};
```

Vincoli:

- `eventId` è univoco;
- `occurredAt` usa ISO 8601 con offset o UTC;
- `pieceDelta` deve essere maggiore di zero per un impulso produttivo;
- `pieceDelta = pulseDelta × multiplier`, salvo adattatori esplicitamente documentati;
- gli eventi duplicati vengono ignorati senza errore e senza ricalcolare due volte la produzione;
- un evento importato non viene aggiornato distruttivamente.

### Mappatura del CSV corrente `impulsi.csv`

| CSV attuale | Evento MES |
|---|---|
| `timestamp_locale` | `occurredAt` |
| `macchina` | `machineId` |
| `mac`, `frame_id`, `byte_sdu`, `bit` | `signal` |
| differenza di `impulso_sessione` | `pulseDelta` |
| differenza di `pezzi_sessione` | `pieceDelta` |
| `moltiplicatore` | `multiplier` |

I contatori cumulativi del CSV sono riferimenti di controllo. L'importatore deve produrre delta e riconoscere riavvii, nuove cartelle e ripartenze da zero.

---

## 10. Contratto minimo della fase

```ts
type ProductionPhase = {
    phaseId: string;
    orderId: string;
    phaseCode: string;
    articleCode: string;
    targetQuantity: number;
    unit: "pz" | "kg";
    standardCycleSeconds: number;
    plannedSetupSeconds: number;
    plannedMachineId?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    planningStatus: "BACKLOG" | "SCHEDULED" | "ARCHIVED";
    executionStatus:
        | "NOT_STARTED"
        | "SETUP"
        | "RUNNING"
        | "PAUSED"
        | "COMPLETED"
        | "CANCELLED";
};
```

Per le fasi alimentate dal contapezzi, l'unità operativa iniziale è `pz`. Le fasi in `kg` restano pianificabili ma non ricevono automaticamente impulsi finché non viene definita una conversione esplicita.

---

## 11. Formule condivise

### 11.1 Durata prevista iniziale

```text
durata prevista secondi = attrezzaggio previsto secondi
                           + quantità obiettivo × tempo standard per pezzo
```

### 11.2 Durata residua

```text
pezzi mancanti = max(0, quantità obiettivo - pezzi buoni)

durata residua = attrezzaggio residuo
                  + pezzi mancanti × tempo standard per pezzo
```

### 11.3 Avanzamento

```text
avanzamento % = min(100, pezzi buoni / quantità obiettivo × 100)
```

La sovrapproduzione viene mostrata separatamente e non porta la barra oltre il 100%.

### 11.4 Tempo ciclo

```text
tempo ultimo colpo = timestamp impulso corrente - timestamp impulso precedente valido

tempo reale per pezzo = tempo del colpo / moltiplicatore
```

Devono essere escluse dal calcolo medio almeno:

- sessioni in pausa;
- periodi di attrezzaggio, salvo analisi specifica;
- perdita di connessione;
- intervalli superiori alla soglia di pausa configurata;
- impulsi duplicati o invalidi.

Saranno mostrati:

- tempo standard per pezzo;
- tempo dell'ultimo ciclo valido;
- media mobile recente;
- media dell'intera sessione;
- scostamento percentuale dallo standard.

---

## 12. Regole del Gantt

1. una fase può esistere senza macchina e senza data;
2. una fase non pianificata può essere attivata in macchina;
3. posizionando una fase nel Gantt, la fine viene calcolata automaticamente;
4. il calcolo usa durata residua, calendario macchina, turni e indisponibilità;
5. quantità, tempo ciclo o attrezzaggio modificati provocano il ricalcolo della durata futura;
6. la produzione consuntivata non viene riscritta da una modifica di pianificazione;
7. il riempimento della barra deriva dai pezzi buoni, non dai giorni trascorsi;
8. al completamento la barra resta storicizzata con date previste ed effettive.

Poiché il pianificatore attuale lavora per giorni, il modello futuro conserverà date e ore. L'interfaccia potrà offrire sia una vista sintetica giornaliera sia una vista più precisa per turno/ora.

---

## 13. Invarianti applicative

Il backend deve garantire che:

1. esista al massimo una sessione attiva per macchina;
2. nella prima versione esista al massimo una sessione attiva per fase;
3. un evento grezzo non venga conteggiato due volte;
4. ogni evento sia attribuito, non attribuito oppure risolto/escluso in modo verificabile;
5. un contatore logico non diventi negativo;
6. una quantità scartata non avanzi il completamento;
7. ogni rettifica abbia autore e causale;
8. una fase completata non riceva nuovi conteggi senza una riapertura esplicita;
9. la perdita della connessione non generi impulsi artificiali;
10. il riavvio del reader o il reset del contatore sorgente non azzeri la produzione già consolidata.

---

## 14. Casi limite obbligatori

Devono essere coperti almeno questi scenari:

- riavvio del PLC Reader durante una produzione;
- CSV importato più volte;
- due file CSV con contatori che partono entrambi da zero;
- impulso con moltiplicatore maggiore di uno;
- attivazione con pezzi non attribuiti;
- attribuzione parziale dei pezzi non attribuiti;
- annullamento della finestra di attribuzione;
- pezzi prodotti subito dopo la chiusura di un ordine;
- ordine che raggiunge o supera il 100%;
- rettifica che tenterebbe di portare il totale sotto zero;
- macchina offline durante una sessione;
- cambio macchina della stessa fase;
- pausa e successiva ripresa;
- attrezzaggio con zero pezzi buoni;
- attrezzaggio con parte dei conteggi classificata come buona;
- modifica della quantità obiettivo mentre la fase è in produzione;
- concorrenza tra due operatori che tentano di attivare ordini sulla stessa macchina.

---

## 15. Criteri di accettazione della fase 0

La fase 0 è pronta per essere chiusa quando sono confermati:

- glossario e distinzione ordine/fase/sessione;
- significato dell'azzeramento logico;
- comportamento dei pezzi non attribuiti;
- stati e transizioni;
- regole dell'attrezzaggio;
- formula di durata e avanzamento;
- contratto minimo degli eventi;
- obblighi di audit;
- casi limite iniziali;
- decisioni aperte elencate nella sezione seguente.

---

## 16. Decisioni ancora da confermare

Questi punti non bloccano la definizione di base, ma dovranno essere decisi prima delle rispettive funzionalità:

1. formato e obbligatorietà del numero ordine aziendale;
2. possibilità futura di eseguire la stessa fase contemporaneamente su più macchine;
3. elenco delle causali standard per rettifiche, esclusioni, pause e scarti;
4. ruoli autorizzati a correggere quantità o riaprire una fase;
5. calendari, turni e pause pianificate delle macchine;
6. soglia oltre la quale un intervallo tra impulsi è considerato pausa e non ciclo;
7. gestione degli ordini espressi in kg;
8. regola aziendale sulla sovrapproduzione;
9. eventuale integrazione con lettori barcode o badge operatore;
10. durata di conservazione dei dati grezzi e politica di backup.

---

## 17. Primo collaudo verticale previsto

La prima implementazione dovrà dimostrare il flusso completo su una macchina:

1. importazione di un CSV reale;
2. creazione di un ordine e una fase da 100 pezzi;
3. definizione di tempo ciclo e attrezzaggio;
4. rilevazione di pezzi senza ordine attivo;
5. attivazione della fase e richiesta di attribuzione/azzeramento;
6. conteggio automatico dei nuovi impulsi;
7. rettifica manuale tracciata;
8. prova di attrezzaggio e riconciliazione;
9. aggiornamento automatico della barra;
10. chiusura confermata della fase;
11. verifica dei dati nella griglia analitica;
12. nuova importazione dello stesso CSV senza duplicazioni.

