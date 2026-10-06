# Piano di restyling e miglioramento AyPi

## Stato del documento

- **Tipo:** piano di lavoro, non specifica grafica definitiva.
- **Data di prima stesura:** 6 ottobre 2026.
- **Ambito principale:** modalità **AGPress standard**.
- **Vincolo:** la modalità **Blue Archive** è considerata già soddisfacente e non
  deve subire un restyling. Gli interventi condivisi potranno riguardarla solo se
  sono correzioni tecniche neutrali, compatibili e prive di modifiche visive.
- **Obiettivo:** rendere AyPi coerente, moderna, reattiva e comprensibile anche
  durante operazioni molto lunghe, senza riscrivere inutilmente funzioni già
  esistenti.

### Direzione visuale concordata

La modalità AGPress usa **la stessa shell della modalità Blue Archive**, senza
reinterpretazioni strutturali: markup, proporzioni, topbar, testi, disposizione
dei pulsanti, dimensioni della finestra, transizioni di pagina e animazioni delle
finestre devono restare identici. La differenza è affidata esclusivamente al tema
cromatico antracite/ambra.

Nella variante AGPress vengono rimossi soltanto Arona/Plana e gli effetti legati
al puntatore (aura, scia, particelle e inclinazione delle card). La shell condivisa
usa la finestra desktop 1360×820, la navigazione orizzontale nella topbar, lo
stesso hero e gli accessi rapidi in quattro colonne della modalità Blue Archive.
Il menu laterale legacy non fa più parte del flusso principale.

Vincoli specifici:

- Calendar e Purchasing non vengono restilizzati;
- Inventario Magazzino conserva l'interfaccia e cambia soltanto il login;
- Pianificazione conserva struttura e qualità della barra superiore, da
  ricondurre alla palette AGPress;
- Ticket Support viene riallineato nella tipografia e nei colori;
- Schede Attrezzaggio può cambiare home, submenu ed elenco, mentre compilazione,
  contenuti delle schede e anteprime di stampa rimangono invariati.

## 1. Sintesi esecutiva

Il lavoro non va affrontato come una serie di ritocchi CSS separati. AyPi è una
suite composta da molte pagine Electron, utility, addon e applicativi esterni;
perciò servono due fondazioni comuni:

1. un **design system AGPress** con layout, componenti e comportamenti riusabili;
2. un **sistema condiviso per i lavori lunghi** con stato, avanzamento,
   annullamento, errori e risultati.

L'ordine consigliato è:

1. censire schermate e misurare le prestazioni attuali;
2. definire il nuovo linguaggio visivo AGPress e i componenti condivisi;
3. realizzare una shell/prototipo AGPress su una pagina principale;
4. introdurre subito feedback affidabile per le operazioni lunghe;
5. ottimizzare le utility filesystem più critiche;
6. migrare le altre sezioni per ondate, senza cambiare la logica di dominio;
7. uniformare guide, messaggi, accessibilità e test;
8. rimuovere il codice legacy solo dopo il completamento di ogni migrazione.

Questo ordine permette di ottenere presto miglioramenti visibili senza
duplicare il lavoro e senza legare il restyling alla riscrittura simultanea di
tutta l'applicazione.

## 2. Fotografia tecnica attuale

L'analisi iniziale del repository ha rilevato:

- 35 pagine HTML, 46 file CSS e 143 file TypeScript nel renderer;
- molte pagine principali (`Moduli`, `Programmi`, `Articoli`, `Produzioni`, ecc.)
  con CSS separati e regole di base duplicate;
- un design system condiviso già avviato per Blue Archive, ma nessun equivalente
  generale per AGPress;
- dialoghi nativi centralizzati solo in parte tramite
  `scripts/shared/dialogs.ts`, accanto a numerose famiglie di modali custom;
- guide distribuite tra documenti Markdown, HTML dedicato e modali interni;
- file monolitici ancora in corso di rifattorizzazione, soprattutto in
  Gerarchia e nelle utility più ricche;
- assenza di una suite automatizzata generale: sono presenti build TypeScript e
  alcuni smoke test mirati.

### Criticità prestazionali già confermate

- **Elenca File** usa `readdirSync` e `statSync` nel renderer: su alberi grandi
  blocca il thread dell'interfaccia.
- **Confronta Cartelle** usa scansioni e letture metadati sincrone nel renderer,
  con chiamate `statSync` ripetute.
- **Batch Rinomina** raccoglie i file in modo sincrono prima di preparare
  l'anteprima.
- **Gerarchia** possiede già una scansione asincrona e comunica i conteggi, ma
  visita in modo sequenziale ogni elemento, conserva l'intero risultato in
  memoria e svolge anche rendering e analisi consistenti. Il conteggio attuale
  non equivale a una percentuale realmente conoscibile in anticipo.

Questi casi spiegano perché l'app possa apparire bloccata pur continuando a
lavorare.

## 3. Obiettivi e non-obiettivi

### Obiettivi

- Dare a tutte le schermate AGPress una stessa identità visiva.
- Riutilizzare componenti e funzioni invece di copiarli o riscriverli.
- Mantenere l'interfaccia reattiva durante scansioni, confronti ed esportazioni.
- Mostrare sempre cosa sta facendo l'app, da quanto tempo e se è possibile
  annullare.
- Rendere coerenti menu, toolbar, modali, prompt, tabelle, form, notifiche,
  stati vuoti, errori e guide.
- Migrare gradualmente, con rilasci piccoli e reversibili.
- Conservare il comportamento delle funzioni amministrative (`F2`), del cambio
  modalità (`F4`) e delle funzioni Blue Archive (`F6`).

### Non-obiettivi della prima iniziativa

- Ridisegnare Blue Archive.
- Riscrivere in blocco tutti i moduli o la loro logica di dominio.
- Modificare i file Access/Excel esterni soltanto per adeguarli graficamente ad
  AyPi; la coerenza deve riguardare prima di tutto il launcher, i flussi e i
  messaggi controllati dall'app.
- Sostituire per forza i dialoghi di sistema per scelta file/cartelle, che è
  preferibile rimangano nativi.
- Aggiungere nuove grandi funzioni prima di aver stabilizzato le fondamenta.

## 4. Principi di progetto

1. **Un componente, una responsabilità.** La stessa conferma, notifica o barra
   di avanzamento non deve avere implementazioni indipendenti per modulo.
2. **Tema separato dalla struttura.** Il markup e il comportamento dei
   componenti restano comuni; i token AGPress e Blue Archive ne definiscono
   l'aspetto dove realmente condivisibile.
3. **Progressi onesti.** Una percentuale viene mostrata solo quando il totale è
   noto o stimabile con un metodo dichiarato. Negli altri casi si usa uno stato
   indeterminato con contatori reali.
4. **Nessun blocco del renderer.** File system, hashing, confronti e grandi
   trasformazioni non devono monopolizzare il thread UI.
5. **Migrazione verticale.** Ogni tranche completa una schermata o un flusso
   utilizzabile; niente sostituzioni globali non verificabili.
6. **Compatibilità prima della pulizia.** CSS e funzioni legacy vengono rimossi
   solo quando non hanno più consumatori.
7. **Prestazioni misurate.** Ogni ottimizzazione parte da un dataset di test e
   da una baseline ripetibile.

## 5. Architettura target dell'interfaccia

### 5.1 Design system AGPress

Creare una cartella condivisa, per esempio:

```text
src/renderer/
  styles/shared/
    tokens.css
    theme-agpress.css
    layout.css
    components/
  scripts/shared/ui/
    dialog.ts
    notification.ts
    task-progress.ts
    guide.ts
    empty-state.ts
```

La struttura definitiva va concordata con il refactoring già in corso, ma deve
contenere almeno:

- token semantici per colori, spaziature, raggi, ombre, tipografia e livelli;
- shell della finestra, header, navigazione laterale e toolbar;
- pulsanti `primary`, `secondary`, `danger`, `ghost` e `icon`;
- campi, select, checkbox, tab e filtri;
- card, tabelle, badge e stati vuoti;
- modali, conferme, prompt, notifiche e messaggi inline;
- progress bar, spinner, skeleton e pannello di avanzamento;
- contenitore standard per manuali e guide;
- regole responsive per finestre ridimensionabili;
- stati `hover`, `focus-visible`, `active`, `disabled`, `loading` ed errore.

Le classi non dovranno contenere il nome di una singola feature. Le eccezioni
locali resteranno nel CSS del modulo e dovranno essere limitate al layout o a
visualizzazioni davvero specialistiche.

### 5.2 Nuova shell AGPress

Il nuovo concept dovrà essere industriale, sobrio e moderno, coerente con il
marchio AGPress, senza imitare Blue Archive. Direzione proposta da validare con
un prototipo:

- navigazione laterale sempre leggibile, comprimibile e con sezione attiva;
- header compatto con titolo, contesto, azioni e stato applicazione;
- home a card per aree (`Moduli`, `Articoli`, `Produzioni`, `Utility`, ecc.);
- gerarchia visiva chiara tra azione primaria e secondarie;
- superfici neutre e contrastate, con colore AGPress usato come accento;
- densità adatta all'uso desktop aziendale, non eccessivamente ariosa;
- stato amministratore sempre riconoscibile e mai affidato al solo colore;
- versione, aggiornamenti, rete e backend raccolti in una zona di stato comune;
- timer, meteo e add-in integrati come strumenti, non come elementi flottanti
  con posizioni assolute.

Prima di estendere il concept si dovranno produrre tre viste rappresentative:

1. home/navigazione AGPress;
2. utility operativa con form, tabella e avanzamento (`Elenca File`);
3. modulo ricco con modali e guida (`Inventario` o `Pianificazione`).

### 5.3 Dialoghi e messaggi

Distinguere nettamente:

- **dialoghi OS:** selezione cartella/file, salvataggio e integrazioni di
  sistema; restano nativi;
- **dialoghi applicativi:** conferme, prompt, errori operativi, guide e dettagli;
  adottano il componente AyPi condiviso;
- **notifiche non bloccanti:** successo, informazioni e avvisi che non
  richiedono una decisione;
- **errori contestuali:** mostrati vicino al campo o all'operazione che li ha
  generati.

Il componente dialogo deve gestire focus iniziale, `Esc`, ritorno del focus,
azione predefinita, azione pericolosa, testo selezionabile nei dettagli tecnici
e attributi ARIA.

### 5.4 Manuali e guide

Definire un unico modello di contenuto:

- titolo e versione della guida;
- indice e ricerca;
- sezioni, procedure numerate, note, avvisi e scorciatoie;
- immagini opzionali con didascalia;
- collegamenti contestuali dalla schermata interessata;
- sorgente unica per evitare differenze tra guida interna e documento esterno.

Nel lungo periodo conviene generare sia la guida in-app sia l'eventuale HTML o
Markdown distribuibile dalla stessa sorgente strutturata.

## 6. Infrastruttura condivisa per i lavori lunghi

### 6.1 Contratto di un task

Ogni operazione lunga dovrebbe esporre almeno:

```text
id, tipo, stato, fase, elementiCompletati, elementiTotali?,
percorsoCorrente?, tempoTrascorso, annullabile, risultato?, errore?
```

Stati minimi: `idle`, `queued`, `running`, `cancelling`, `completed`, `failed`,
`cancelled`.

### 6.2 Feedback visuale

Durante il lavoro mostrare:

- nome e fase dell'operazione;
- spinner o progress bar;
- percentuale solo quando attendibile;
- file/cartelle elaborati e, se utile, percorso corrente abbreviato;
- tempo trascorso;
- pulsante Annulla quando tecnicamente sicuro;
- messaggio conclusivo con durata, risultati ed elementi non leggibili.

Gli aggiornamenti UI vanno limitati indicativamente a 5-10 al secondo per non
trasformare il rendering del progresso in un nuovo collo di bottiglia.

### 6.3 Percentuale reale e stato indeterminato

Per una scansione ricorsiva il totale non è noto all'inizio. Sono ammesse tre
strategie:

1. **indeterminata a singolo passaggio:** più veloce, mostra conteggi reali ma
   non una percentuale;
2. **due passaggi:** prima conta, poi elabora; offre percentuale reale ma raddoppia
   una parte dell'I/O;
3. **avanzamento per fasi:** percentuale pesata tra scansione, analisi, rendering
   ed esportazione, dichiarando che la stima riguarda le fasi e non il numero
   esatto di file.

La strategia predefinita consigliata per cartelle enormi è il singolo passaggio
con contatori; la percentuale determinata va usata per esportazioni o fasi in cui
il totale è già noto. Non usare barre che avanzano a tempo senza relazione con
il lavoro eseguito.

### 6.4 Esecuzione tecnica

- Spostare le scansioni fuori dal renderer, preferibilmente in worker thread o
  in un servizio del processo principale con IPC asincrono.
- Usare API asincrone e concorrenza limitata, evitando sia la sequenzialità
  completa sia migliaia di richieste simultanee.
- Evitare `stat` quando `Dirent` fornisce già il tipo; leggere i metadati solo
  se richiesti dal risultato.
- Trasmettere risultati in batch e non un evento per ogni file.
- Supportare `AbortSignal` o un equivalente per l'annullamento cooperativo.
- Separare scansione, trasformazione, ordinamento, rendering ed export per poter
  misurare ogni fase.
- Per risultati enormi usare paginazione o virtualizzazione delle righe e
  rendering incrementale dell'albero.
- Conservare errori di accesso come risultato parziale consultabile, senza
  interrompere necessariamente l'intera scansione.

## 7. Piano per fasi

### Fase 0 — Baseline e inventario

**Scopo:** sapere cosa migrare e misurare i miglioramenti.

Attività:

- censire tutte le pagine con tema, componenti, dialoghi, guide e dipendenze;
- classificare le schermate come launcher, utility operativa, dashboard o
  editor complesso;
- creare dataset locali ripetibili, ad esempio 1.000, 10.000 e 100.000 file,
  con alberi profondi ed errori di permesso simulabili;
- registrare tempi, memoria, tempo al primo feedback e blocchi UI per Elenca
  File, Gerarchia, Confronta Cartelle e Batch Rinomina;
- acquisire screenshot della modalità AGPress attuale come riferimento;
- aggiungere una checklist visiva e funzionale per ogni pagina.

**Uscita:** matrice completa delle schermate e report baseline versionato.

### Fase 1 — Fondazioni UI AGPress

**Scopo:** stabilire regole prima di ridisegnare i singoli moduli.

Attività:

- approvare palette, tipografia, densità, griglia e iconografia;
- implementare token AGPress e componenti base;
- creare dialogo, notifica, stato vuoto, guida e task progress condivisi;
- documentare esempi d'uso e regole di composizione;
- predisporre una pagina laboratorio/component showcase;
- verificare contrasto, zoom, tastiera e focus.

**Uscita:** design system AGPress v1 utilizzabile, senza migrazione massiva.

### Fase 2 — Shell e prototipo verticale

**Scopo:** validare il nuovo design su flussi reali.

Attività:

- sostituire sidebar, header e home AGPress con la nuova shell;
- mantenere invariati routing, scorciatoie e modalità amministratore;
- migrare `Elenca File` come prima utility completa;
- migrare un modulo ricco scelto tra Inventario e Pianificazione;
- raccogliere feedback dagli utenti reali prima di propagare il design.

**Uscita:** prototipo navigabile e decisione finale sul concept AGPress.

### Fase 3 — Task manager e feedback delle operazioni lunghe

**Scopo:** eliminare la percezione di crash anche prima di tutte le
ottimizzazioni.

Attività:

- implementare il contratto condiviso dei task;
- aggiungere overlay/pannello di avanzamento accessibile e riusabile;
- integrare conteggi, fasi, durata, annullamento e riepilogo errori;
- impedire avvii duplicati della stessa operazione;
- definire comportamento alla chiusura finestra e durante cambio pagina;
- aggiungere log diagnostici con `taskId` e tempi per fase.

**Uscita:** infrastruttura unica collegata almeno a Elenca File e Gerarchia.

### Fase 4 — Ottimizzazione delle utility filesystem

Ordine consigliato:

1. **Elenca File:** rimuovere I/O sincrono, risultati in batch, rendering
   virtualizzato/paginato ed export separato.
2. **Confronta Cartelle:** una scansione per lato, metadati senza duplicazioni,
   confronto in strutture indicizzate e progressi per fase.
3. **Batch Rinomina:** raccolta asincrona, anteprima incrementale e separazione
   netta tra scansione e applicazione delle rinomine.
4. **Gerarchia:** concorrenza limitata, rendering lazy, statistiche fuori dal
   percorso critico e cancellazione cooperativa.

Per ogni utility:

- mantenere output ed export compatibili;
- misurare prima/dopo sugli stessi dataset;
- verificare junction, link simbolici, percorsi lunghi, file spariti durante la
  scansione, accesso negato e cartelle di rete lente;
- evitare cicli ricorsivi seguendo solo le directory previste dalla policy;
- produrre risultati parziali e conteggio errori quando possibile.

**Uscita:** renderer sempre reattivo e report prestazionale comparativo.

### Fase 5 — Migrazione visuale per ondate

| Ondata | Aree | Motivo |
| --- | --- | --- |
| A | Moduli, Programmi, Articoli, Produzioni, Robot, Calcolatore, Utilities | Stabilizza navigazione e launcher comuni. |
| B | Elenca File, Gerarchia, Confronta Cartelle, Batch Rinomina, QR, Timer | Convalida componenti su utility simili ma concrete. |
| C | Ticket Support, Calendario, Gestione Acquisti, Pianificazione | Condivide molti form, tabelle, filtri, modali e ruoli. |
| D | Schede Attrezzaggio, Registrazioni Progettazione, Inventario | Interfacce specialistiche da migrare senza appiattirne le funzioni. |
| E | Stato Robot, verifiche rete, admin manager e finestre secondarie | Completa casi tecnici, stati live e strumenti amministrativi. |

Ogni ondata deve riutilizzare i componenti della precedente. Se emerge un nuovo
pattern generale, va aggiunto al design system prima di copiarlo in più moduli.

### Fase 6 — Guide, testi e coerenza funzionale

**Scopo:** uniformare non solo l'aspetto, ma anche il modo in cui AyPi comunica.

Attività:

- glossario unico per azioni, stati ed errori;
- titoli, etichette, conferme e messaggi coerenti;
- template unico per guide e help contestuale;
- distinzione costante tra Salva, Applica, Conferma, Esegui e Annulla;
- nessuna informazione affidata unicamente al colore;
- dettagli tecnici espandibili negli errori, con messaggio principale leggibile;
- revisione di scorciatoie, tooltip e stato amministratore.

**Uscita:** content guide e manuali migrati al formato condiviso.

### Fase 7 — Consolidamento e rimozione legacy

**Scopo:** chiudere la migrazione senza lasciare due sistemi permanenti.

Attività:

- rimuovere regole CSS duplicate e modali sostituiti;
- impedire nuove varianti locali tramite convenzioni o controlli automatici;
- aggiungere smoke test per componenti e flussi principali;
- aggiornare `ARCHITECTURE.md`, `DEVELOPMENT.md` e documentazione release;
- eseguire controllo completo AGPress e regressione mirata Blue Archive;
- creare una checklist obbligatoria per le nuove feature.

**Uscita:** AGPress v2 come interfaccia standard e legacy non più referenziato.

## 8. Criteri di accettazione misurabili

### Reattività

- Entro 150 ms dall'avvio di un lavoro lungo compare uno stato visivo.
- L'interfaccia continua a ridisegnarsi e la finestra resta spostabile durante
  la scansione.
- Il comando di annullamento viene recepito entro 1 secondo, salvo una singola
  operazione OS non interrompibile già in corso.
- Gli aggiornamenti di progresso non superano la frequenza stabilita e non
  causano crescita incontrollata del DOM.
- Su ogni dataset di benchmark sono registrati durata, picco memoria, numero di
  elementi ed errori; i risultati vengono confrontati con la baseline.

### Coerenza UI

- Tutte le pagine AGPress usano token e componenti condivisi per gli elementi
  standard.
- Nessun nuovo colore o dimensione ricorrente viene codificato localmente senza
  motivazione.
- Modali e guide rispettano tastiera, focus ed etichette accessibili.
- Tutti i flussi hanno stati di caricamento, vuoto, errore e completamento.
- A zoom 100%, 125% e 150% le azioni principali restano raggiungibili.

### Compatibilità

- Build TypeScript e backend completate con successo.
- Apertura dei moduli esterni e funzioni admin invariate.
- Export confrontati con fixture o output attesi.
- Blue Archive sottoposta a smoke test visivo e funzionale dopo modifiche
  condivise, senza variazioni estetiche involontarie.

## 9. Strategia di test

- Test unitari per trasformazioni pure, filtri, confronto e calcolo progresso.
- Test del servizio scanner con directory temporanee reali.
- Test IPC per eventi di avanzamento, cancellazione, errore e chiusura finestra.
- Smoke test DOM per apertura/chiusura dialoghi e gestione del focus.
- Snapshot o screenshot controllati dei componenti AGPress principali.
- Test manuale su condivisione di rete, non soltanto su SSD locale.
- Profilazione di CPU, memoria e numero di nodi DOM sui dataset grandi.

## 10. Rischi e contromisure

| Rischio | Contromisura |
| --- | --- |
| Restyling e refactoring logico insieme causano regressioni | Separare le tranche; conservare i contratti esistenti. |
| Un CSS globale rompe moduli specialistici | Token e componenti opt-in durante la migrazione. |
| Percentuale falsa o bloccata | Usare stato indeterminato finché il totale non è noto. |
| Troppi eventi di progresso rallentano la UI | Throttling e invio in batch. |
| Scansioni parallele saturano dischi o rete | Concorrenza configurabile e limitata. |
| Tabelle/alberi enormi bloccano dopo la scansione | Virtualizzazione, lazy rendering e paginazione. |
| Modifiche condivise alterano Blue Archive | Separazione dei token e smoke test dedicato. |
| La migrazione resta incompleta e duplica tutto | Definition of Done e rimozione legacy per singola pagina. |

## 11. Definition of Done per una schermata migrata

Una pagina è considerata migrata solo quando:

- usa shell e componenti AGPress condivisi;
- non duplica regole generiche già presenti nel design system;
- conserva tutte le funzioni precedenti;
- gestisce loading, vuoto, errore, successo e disabilitazione delle azioni;
- è utilizzabile da tastiera e mantiene correttamente il focus;
- i lavori lunghi non bloccano la UI e possono essere monitorati;
- testi e guida seguono il modello comune;
- build e test pertinenti passano;
- è stata controllata alle dimensioni finestra e agli zoom concordati;
- l'eventuale CSS/JS legacy non più usato è stato rimosso.

## 12. Decisioni da prendere prima dell'implementazione visuale

1. Confermare palette, font e livello di densità della nuova AGPress.
2. Scegliere se la sidebar debba essere sempre visibile o comprimibile a icone.
3. Scegliere il primo modulo ricco del prototipo: Inventario o Pianificazione.
4. Definire il comportamento dei task quando una finestra viene chiusa: annulla,
   continua in background o chiede conferma.
5. Stabilire i dataset reali rappresentativi e i tempi attuali sulle cartelle di
   rete aziendali.
6. Decidere se le guide debbano funzionare anche completamente offline.
7. Confermare quali finestre possono mostrare più task contemporaneamente.

## 13. Primo ciclo operativo consigliato

Il primo ciclo può essere circoscritto e già dimostrabile:

1. inventario visuale completo e benchmark delle quattro utility filesystem;
2. moodboard/wireframe AGPress e approvazione del concept;
3. token, pulsanti, campi, dialogo, notifica e progress panel;
4. nuova shell su home e navigazione;
5. migrazione completa di Elenca File con scansione asincrona e annullamento;
6. prova su cartella locale e condivisione di rete di grandi dimensioni;
7. revisione con utenti, correzioni e decisione di procedere con l'ondata A/B.

Questo ciclo fornisce contemporaneamente un esempio del nuovo design, la base
riusabile e la soluzione concreta a uno dei problemi prestazionali più visibili.

## 14. Tracciamento suggerito

Per trasformare il piano in backlog, ogni attività dovrà indicare:

- area e schermata;
- problema osservato;
- componente condiviso coinvolto;
- baseline e risultato atteso;
- dipendenze;
- rischio Blue Archive;
- test richiesti;
- stato: `da analizzare`, `pronto`, `in corso`, `in revisione`, `completato`.

Il presente documento rimane la roadmap generale; specifiche visuali, benchmark
e checklist di migrazione dovranno vivere in documenti separati e versionati,
collegati da qui.
