# Inventario magazzino — piano di progetto

Stato: raccolta requisiti e prototipo operativo in memoria. I gruppi automatici di carico/scarico aggiornano la mappa e generano uno storico di sessione; algoritmo definitivo, database e audit persistente restano da realizzare.

## 1. Obiettivo

Gestire lo stock di articoli conservati in cassoni, proponendo carico, scarico e spostamenti con uno **slotting ottimizzato**. L'obiettivo non è riempire ogni vuoto nel modo più compatto possibile, ma ridurre le movimentazioni necessarie e mantenere efficiente il prelievo.

Il sistema dovrà supportare sia proposte automatiche sia operazioni manuali forzate dall'operatore.

## 2. Struttura fisica comunicata

- 5 file di scaffalature, identificate con lettere maiuscole: `A`, `B`, `C`, `D`, `E`.
- 96 cassoni per fila, per una capacità totale teorica di 480 cassoni.
- 3 livelli verticali: `a` in basso, `b` al centro, `c` in alto.
- Per ciascun livello: 16 cassoni anteriori e 16 posteriori.
- La corrispondenza fra numeri dispari/pari e lato anteriore/posteriore dipende dall'orientamento configurato per ciascuna fila.
- Una posizione completa è composta da fila, numero e livello, per esempio `A1a` oppure `A2c`.
- Il prelievo avviene sempre dal lato anteriore.
- La struttura non è necessariamente uniforme: ogni fila può avere una capacità diversa, espressa come numero di cassoni standard.
- Poiché ogni modulo fisico contiene 2 lati × 3 livelli, la capacità configurabile di una fila deve essere un multiplo di 6.

### Orientamento delle file

Ogni fila possiede un'impostazione fisica **Standard/Invertita** che determina la numerazione vista da sinistra:

- **Standard**: numeri dispari sul lato anteriore e numeri pari sul lato posteriore;
- **Invertita**: numeri dispari sul lato posteriore e numeri pari sul lato anteriore.

La configurazione iniziale è `A`, `C`, `E` standard e `B`, `D` invertite. Le coppie di scaffalature `B-C` e `D-E` sono infatti schiena contro schiena: senza inversione, il lato indicato come anteriore per `B` e `D` risulterebbe rivolto verso la scaffalatura adiacente e quindi inaccessibile dal corridoio. La lettura delle posizioni parte sempre da sinistra, indipendentemente dall'orientamento.

Questa impostazione deve restare modificabile per ogni fila esistente o futura e deve essere usata da mappa, dettaglio, database, ricerca e algoritmi di carico, scarico e riassetto. Non è quindi una semplice trasformazione grafica. Le nuove file con lettera pari vengono proposte invertite per impostazione predefinita, ma l'operatore può cambiarle dal pannello struttura.

### Tipologie di unità logistica

Il magazzino contiene due tipologie distinte:

- **Cassone**: occupa un singolo slot e può essere impilato sui livelli `a`, `b` e `c`, rispettando i vincoli verticali;
- **Pallet**: occupa obbligatoriamente due slot accoppiati, uno anteriore e uno posteriore dello stesso modulo fisico, per esempio `A3a + A4a`.

Un pallet può essere collocato soltanto a terra, sul livello `a`. L'intera colonna deve essere libera: non può esserci alcun cassone o pallet sui livelli `b` e `c`, né sopra né sotto l'unità. I due slot condividono un unico identificativo pallet e ogni carico, scarico o spostamento dovrà trattarli come un'unità indivisibile. Quando il pallet è presente, le quattro posizioni superiori della coppia fronte/retro vengono mostrate in grigio e rese non interagibili; la vista database le identifica come **Bloccato da pallet** e il riepilogo le esclude dagli slot disponibili.

### Schema di numerazione

Per far tornare i 96 posti per fila, la base visuale assume 16 colonne fisiche, ciascuna con una coppia fronte/retro. In una fila standard:

- colonna fisica 1: `1` davanti e `2` dietro;
- colonna fisica 2: `3` davanti e `4` dietro;
- ...
- colonna fisica 16: `31` davanti e `32` dietro.

Ogni numero esiste ai livelli `a`, `b`, `c`.

In una fila invertita la coppia numerica rimane nella stessa colonna fisica, ma i due lati sono scambiati: nella prima colonna `1` è dietro e `2` davanti, nella seconda `3` è dietro e `4` davanti, e così via.

## 3. Regole funzionali già definite

### Carico automatico

- L'operatore indica l'intero blocco da caricare, composto da uno o più articoli e dalle rispettive quantità.
- Ogni richiesta di carico raccoglie: articolo, cliente, riferimento ordine, quantità, stato parziale (`Sì/No`) e tipologia (`Cassone/Pallet`).
- Se la tipologia è pallet, ogni unità richiesta consuma una coppia fronte/retro a terra e l'algoritmo deve escludere qualsiasi colonna verticalmente occupata.
- A magazzino vuoto si preferiscono inizialmente gli slot posteriori, perché l'accesso è frontale.
- I cassoni dello stesso carico vanno raggruppati in pile complete da 3 quando possibile.
- Il sistema non deve semplicemente saturare i primi vuoti disponibili.
- Deve ridurre le future movimentazioni e usare gli spazi parziali quando questo non peggiora la disposizione complessiva.
- La scansione da sinistra verso destra e la preferenza posteriore → anteriore costituiscono il criterio iniziale, ma possono essere superate quando una diversa combinazione dell'intero carico riduce realmente movimentazioni o frammentazione.
- Le piccole quantità possono completare livelli liberi sopra pile già esistenti, anche di articoli diversi, se i supporti sono validi e questo riduce il numero di divisioni senza peggiorare l'accessibilità futura.
- Esempio ricevuto: 4 cassoni di `1400A` → `A2a`, `A2b`, `A2c`, `A1a`.
- Esempio ricevuto: 6 cassoni → preferire una distribuzione `3 + 3`, possibilmente su una coppia fronte/retro libera, invece di `3 + 2 + 1`.

#### Pianificazione congiunta del blocco

Le righe di un carico non devono essere elaborate e confermate una alla volta. Il motore deve ricevere prima **tutti i cassoni e pallet di tutti gli articoli del blocco**, quindi cercare la combinazione complessiva migliore. Una soluzione ottima per il primo articolo isolato potrebbe infatti impedire una disposizione migliore per quelli successivi.

La proposta deve includere sia lo stato finale sia una sequenza eseguibile delle operazioni. Movimentazioni temporanee comuni devono essere accorpate: se l'apertura di una zona anteriore permette di lavorare su più unità posteriori dello stesso blocco, il fronte va rimosso e ripristinato una sola volta quando possibile, anziché ripetere l'operazione per ogni articolo.

Questo concetto vale anche per blocchi misti di carico e scarico, se l'operatività reale consente di dichiararli insieme. Prima di implementarlo va definito quando un blocco è considerato completo, chi può modificarlo dopo il calcolo e cosa accade se quantità o priorità cambiano durante l'esecuzione.

Il flusso dell'interfaccia è articolato in tre fasi:

1. **Composizione**: ogni articolo viene aggiunto al gruppo senza modificare il magazzino; le righe possono essere modificate o rimosse;
2. **Anteprima**: vengono mostrati riepilogo, quantità complessive e tutte le righe prima di richiedere il calcolo definitivo;
3. **Conferma**: il gruppo viene congelato, validato integralmente e applicato in modo atomico. Il prototipo usa un primo motore euristico: se non riesce a collocare o prelevare tutte le unità non modifica il magazzino; se riesce aggiorna immediatamente mappa, ricerca, riepiloghi e vista database.

Dall'anteprima è possibile tornare alla composizione per correggere le righe o aggiungere altri articoli. L'annullamento elimina l'intero gruppo e riporta alla mappa; la semplice chiusura della finestra conserva invece la bozza in memoria.

### Scarico automatico

- Applicare FIFO: prelevare prima i cassoni più vecchi.
- Il riferimento ordine è un filtro opzionale, non un dato obbligatorio per individuare l'articolo da prelevare.
- Se l'operatore specifica il riferimento ordine, il motore limita i candidati alle unità dell'articolo associate a quel riferimento e applica FIFO all'interno dell'insieme risultante.
- Se il riferimento ordine non viene specificato, il motore considera tutte le unità dell'articolo richiesto, indipendentemente dall'ordine, e preleva sempre prima le più vecchie.
- Il formato del riferimento è `AA/NNNNN` oppure `AA/NNNNN/C`: `AA` rappresenta l'anno, `NNNNN` il progressivo e il suffisso `/C` identifica i contratti. Il suffisso non modifica la priorità FIFO.
- Ottimizzare lo spazio e ridurre le movimentazioni necessarie per raggiungere i cassoni.
- Un prelievo può prevedere un movimento intermedio: un cassone viene estratto, usato o controllato e può poi tornare in magazzino.
- La struttura deve rispettare la gravità verticale: `b` richiede `a` occupato e `c` richiede `a` e `b` occupati sullo stesso numero.
- Se viene prelevato un cassone intermedio, quelli sopra scendono automaticamente per chiudere il vuoto. Esempio: prelevando `A1b`, il contenuto di `A1c` passa ad `A1b`.
- Una posizione anteriore non può restare occupata se la corrispondente posizione posteriore è libera. Nelle file standard l'anteriore è dispari e il posteriore pari; nelle file invertite vale il contrario.
- Quando il retro si libera e davanti sono presenti cassoni, il piano di ottimizzazione può spostarli dietro per liberare slot frontali. La scelta esatta dipenderà dal costo delle movimentazioni e dalle regole ancora da definire.
- Nel prelievo di più unità dello stesso articolo, una pila posteriore completa può essere preferibile a una combinazione di unità anteriori e posteriori quando quest'ultima richiederebbe più movimentazioni, sempre nel rispetto della priorità FIFO applicabile.

### Normalizzazione locale della coppia fronte/retro

Quando, nella stessa coppia fisica, una pila anteriore è completa in altezza e quella posteriore è incompleta, la disposizione rende costoso il refill del retro. In occasione di una movimentazione reale che interessa quella coppia, il sistema deve valutare lo scambio delle due pile:

- pila completa sul lato posteriore;
- pila incompleta sul lato anteriore, quindi direttamente accessibile per essere completata.

Lo scambio non deve essere eseguito come manutenzione continua né a ogni ricalcolo della mappa. Va proposto soltanto quando la coppia viene già interessata da un carico, scarico o spostamento e quando il beneficio futuro giustifica il costo aggiuntivo. La simulazione mostra, dopo un prelievo, lo scambio delle posizioni `3-4` proprio per portare davanti la pila rimasta incompleta.

### Movimentazioni fisiche implicite per accedere al retro

La configurazione finale delle ubicazioni non descrive da sola tutto il lavoro svolto dall'operatore. Quando una posizione a terra anteriore e la corrispondente posteriore sono entrambe occupate, ma sopra il cassone posteriore esistono livelli liberi, il caricamento su quei livelli richiede comunque di:

1. prelevare temporaneamente il cassone anteriore per liberare l'accesso;
2. caricare uno o più cassoni sopra la posizione posteriore;
3. riposizionare il cassone anteriore nella sua ubicazione originale.

Il cassone anteriore non cambia ubicazione nello stato iniziale/finale e questi passaggi possono non essere mostrati singolarmente nell'interfaccia operativa, perché l'operatore li esegue come parte naturale dell'azione. Devono però essere sempre calcolati dal motore come **movimentazioni fisiche implicite**: incidono sul costo, sul tempo stimato, sul confronto fra proposte, sul carico di lavoro umano e sull'eventuale limite massimo `X`.

Il modello dovrà pertanto distinguere almeno:

- **spostamento logistico**: l'unità cambia ubicazione registrata;
- **manipolazione temporanea**: l'unità viene rimossa e rimessa nella stessa ubicazione;
- **movimentazione fisica totale**: tutte le prese, rimozioni temporanee, depositi e riposizionamenti necessari a completare il piano.

L'algoritmo non dovrà considerare gratuito l'accesso ai livelli posteriori e dovrà preferire, a parità di risultato, soluzioni che richiedono meno rimozioni temporanee del fronte. Anche quando i singoli gesti non vengono guidati a schermo, il piano dovrà comunicare chiaramente che una proposta comporta movimentazioni accessorie.

### Interrogazione (asking)

- Cercare un articolo e listare tutti i relativi cassoni con le loro posizioni.
- La base corrente permette di cercare e ispezionare una coordinata fisica e usa solo cassoni dimostrativi; non contiene ancora giacenze reali.
- La ricerca testuale trasversale deve poter interrogare contemporaneamente articolo, cliente, riferimento ordine, tag e stati **Parziale** e **In movimento**.
- Più parole nella stessa ricerca vengono combinate: ogni parola deve comparire in almeno uno dei campi abilitati.
- I risultati devono essere evidenziati sulla mappa anche quando appartengono a file non visibili.
- Oltre all'evidenziazione serve un report scritto con ubicazione, articolo, cliente, riferimento ordine e stati rilevanti.
- Le righe del report sono selezionabili tramite spunta e possono essere aggiunte direttamente a un gruppo di scarico. Le due ubicazioni dello stesso pallet vengono deduplicate come una sola unità logistica. Il prototipo esegue già il prelievo logico e aggiorna le giacenze; la futura zona speciale di movimentazione servirà a rappresentare l'esecuzione fisica intermedia.
- Per mantenere pulita la schermata operativa, filtri e report sono raccolti in una finestra dedicata aperta dal pulsante **Ricerca e prelievo**. La chiusura della finestra non cancella ricerca, selezioni o evidenziazioni presenti sulla mappa.
- Una barra rapida resta visibile nella toolbar per cercare ed evidenziare immediatamente gli slot. Il suo testo è sincronizzato bidirezionalmente con il campo della finestra **Ricerca e prelievo** e utilizza gli stessi campi di ricerca abilitati.

### Stato “In movimento” e zona di movimentazione

- **In movimento** identifica un cassone già rimosso dalla propria ubicazione durante lo spostamento intermedio che precede lo scarico definitivo.
- Dovrà esistere una zona speciale di movimentazione, separata dagli slot ordinari.
- Restano da definire capacità, coordinate, permanenza massima, concorrenza tra operatori e possibili destinazioni dalla zona speciale.
- La ricerca deve includere i cassoni in movimento anche se non occupano temporaneamente uno slot ordinario.

### Tag

- Assegnare tag ai singoli cassoni.
- Primo caso esplicito: marcare un cassone come preferito per il prossimo prelievo.
- La precedenza dei tag rispetto a FIFO e ottimizzazione deve ancora essere definita.

### Modalità di visualizzazione ed evidenziazione

Le celle possono mostrare:

- ubicazione;
- articolo;
- cliente;
- riferimento ordine;
- ubicazione, articolo e riferimento ordine insieme.

La cella selezionata ha un bordo blu scuro spesso. Le altre celle corrispondenti hanno un bordo azzurro spesso, anche quando appartengono a un'altra fila. Il criterio dipende dalla modalità attiva:

- ubicazione → stesso articolo;
- articolo → stesso articolo;
- cliente → stesso cliente;
- riferimento ordine → stesso riferimento ordine;
- vista combinata → stesso articolo e stesso riferimento ordine.

Le linguette `A–E` indicano quando una fila non visibile contiene corrispondenze.

Il selettore del contenuto delle celle è allineato alle linguette delle file e non presenta un'etichetta superiore, per mantenere compatta la toolbar. La dimensione dei testi viene calcolata per ogni pulsante partendo dalla misura più leggibile e riducendola soltanto quando articolo, cliente o ordine non entrano nello spazio disponibile. La legenda distingue inoltre i pallet con un indicatore rosso pastello.

Nella vista combinata ogni cella occupata mostra su tre righe distinte ubicazione, articolo e riferimento ordine, mantenendo invariata la larghezza della scaffalatura.

La densità della mappa è selezionabile dal pannello strumenti flottante sul bordo sinistro:

- **Metà scaffale**, modalità predefinita: mostra alternativamente le posizioni `1–16` e `17–32`, con celle più larghe e testi più leggibili;
- **Scaffale completo**: mostra tutte le posizioni `1â€“32` contemporaneamente.

Nella vista a metà scaffale le frecce laterali permettono di passare da una zona all'altra. Se un cassone selezionato si trova nella metà nascosta, la relativa freccia viene evidenziata. Gli indicatori viola dei vincoli non vengono mostrati sulla mappa: la configurazione resta disponibile nel pannello strumenti e gli eventuali conflitti reali continuano a essere segnalati.

Il pannello si apre passando sul pulsante hamburger blu scuro posto immediatamente prima del titolo “Inventario magazzino”. Si sovrappone alla pagina senza modificarne le dimensioni e oscura leggermente il contenuto sottostante. Si richiude automaticamente quando il puntatore esce dalla sua area. Ospita la scelta della densità, l'accesso ai vincoli cliente e la configurazione della struttura fisica.

La configurazione strutturale permette di aggiungere o rimuovere file e assegnare a ciascuna la propria capacità in cassoni. Il prototipo impedisce di rimuovere o accorciare una fila quando l'operazione escluderebbe ubicazioni già occupate. Le modifiche sono per ora mantenute soltanto in memoria.

### Vista analitica del database

Il modulo dispone di una navigazione interna a schede, simile alle pagine di un browser:

- **Mappa magazzino** per l'uso operativo;
- **Vista database** per analisi e controllo complessivo.

La vista database elenca tutte le ubicazioni previste dalla struttura configurata, comprese quelle libere, in una tabella stile foglio di calcolo. Espone geometria dello slot, stato, identificativo dell'unità logistica, tipologia, articolo, cliente, ordine, tag e stato del contenuto. Può essere filtrata testualmente oppure limitata ai soli slot occupati. Tutte le intestazioni sono ordinabili in modo alfanumerico naturale, crescente o decrescente, quindi per esempio `A2a` precede correttamente `A10a`.

Una riga può essere selezionata e aperta sulla mappa tramite pulsante o doppio clic. Le future funzioni di esportazione e analisi useranno questa stessa vista senza duplicare il modello dati.

Se la riga selezionata contiene un articolo, il comando **Analisi articolo** apre un riepilogo dedicato. Mostra unità logistiche complessive, distinzione fra cassoni e pallet, slot fisicamente impegnati, riferimenti ordine e clienti distinti, parziali, unità in movimento, file interessate, ubicazioni, tag e distribuzione delle unità per ordine. Un pallet viene contato una sola volta come unità logistica, pur mantenendo visibili entrambi gli slot occupati.

### Stato parziale

- Il menu contestuale con tasto destro permette di attivare o rimuovere lo stato **parziale** su un cassone.
- Parziale significa contenuto maggiore dello 0% e minore del 100%.
- Uno slot libero non può essere parziale.
- La quantità o percentuale esatta non è ancora modellata e dovrà essere definita prima della persistenza.

### Operazioni manuali

Il prototipo consente la riallocazione di un solo cassone alla volta tramite menu contestuale:

- tasto destro sul cassone e comando **Rialloca**;
- tasto destro su uno slot libero e comando **Inserisci qui**;
- tasto destro su un altro cassone e comando **Scambia posizioni**.

Inserimento e scambio vengono rifiutati se violano vincoli cliente, sostegno verticale, occupazione da pallet o relazione fronte/retro. Per scelta esplicita, queste forzature manuali **non entrano nello storico dei movimenti automatici**.

`Ctrl+clic` aggiunge o rimuove singoli slot da una selezione; il trascinamento disegna un'area e seleziona gli slot intersecati. Una selezione multipla può essere usata soltanto per impostare/rimuovere lo stato parziale o applicare lo stesso vincolo cliente agli slot scelti. Non può avviare riallocazioni multiple.

Sugli slot, liberi o occupati, il menu contestuale permette di gestire whitelist e blacklist della singola ubicazione. Il vincolo appartiene allo slot, non al contenitore che vi si trova in quel momento.

### Storico dei movimenti automatici

Ogni gruppo automatico di carico o scarico completato produce un blocco identificato come `MV_AA-MM-GG_HH:mm`. Se più gruppi vengono completati nello stesso minuto, dal secondo viene aggiunto un suffisso progressivo (`_02`, `_03`, ...) per mantenere l'identificativo univoco.

Il riepilogo operativo e lo storico mostrano esclusivamente quanto richiesto all'operatore:

- `Articolo X`;
- `Posizioni A1a, A1b, A1c, ...` caricate o rimosse.

Non vengono descritte le preparazioni esterne al magazzino. Lo storico distingue carico e scarico e conserva l'ordine cronologico delle operazioni. Nel prototipo corrente rimane soltanto nella memoria della finestra: al riavvio viene perso. La versione definitiva dovrà persistere movimento, righe, ubicazioni, data/ora e operatore nel database, senza includere le riallocazioni manuali nello storico automatico.

### Vincoli cliente per fila e slot

Ogni fila e ogni singolo slot possono avere regole opzionali di allocazione per cliente:

- **whitelist**: ammette esclusivamente i clienti elencati;
- **blacklist**: vieta i clienti elencati;
- nessuna lista: non applica restrizioni a quel livello.

La gerarchia è intenzionalmente restrittiva:

1. viene valutata per prima la regola della fila;
2. se la fila rifiuta il cliente, nessuna regola dello slot può riabilitarlo;
3. se la fila ammette il cliente, lo slot può ancora vietarlo o applicare una whitelist più stretta.

Quindi la regola dello slot può soltanto restringere quella della fila, mai ampliarla. Per esempio:

- file `D` ed `E`: whitelist `FANTINI`;
- file `A`, `B` e `C`: blacklist `FANTINI`.

Il configuratore segnala i clienti inseriti contemporaneamente in whitelist e blacklist. Dopo ogni modifica vengono inoltre controllati i cassoni già presenti: eventuali occupazioni non conformi sono evidenziate nella mappa, nel dettaglio slot e nella vista database, indicando se il conflitto deriva dalla fila o dallo slot.

Nel prototipo le regole sono mantenute soltanto in memoria. La versione operativa dovrà salvarle nel database, registrare autore e data della modifica e impedirne l'aggiramento nei flussi automatici e manuali.

## 4. Modello dati proposto

Entità iniziali, da validare prima di creare la persistenza definitiva:

- **Fila**: codice, capacità, orientamento standard/invertito e vincoli di accessibilità.
- **Slot**: coordinata, fila, colonna fisica, lato, livello, stato e possibili vincoli/blocchi.
- **Cassone**: identificativo univoco, articolo, lotto, quantità/parziale, data di ingresso, tag e stato.
- **Occupazione**: relazione temporale tra cassone e slot.
- **Movimento automatico**: blocco `MV_*` di carico o scarico con righe articolo, ubicazioni interessate, operatore e data/ora. Le riallocazioni manuali sono escluse da questa entità per requisito.
- **Piano di movimentazione**: sequenza proposta dall'algoritmo, con punteggio e motivazioni.
- **Blocco operativo**: insieme completo delle righe di carico e/o scarico da ottimizzare congiuntamente, con stato, versione, priorità e responsabile.
- **Riga del blocco**: articolo, cliente, riferimento ordine, quantità, tipologia e vincoli specifici richiesti dall'operatore.

Un cassone deve avere un identificativo proprio anche quando più cassoni contengono lo stesso articolo. Questo è necessario per FIFO, tag e audit dei movimenti.

## 5. Algoritmo di slotting — direzione iniziale

L'algoritmo dovrà produrre e confrontare più distribuzioni candidate, non applicare un semplice ordinamento del primo slot libero. Il punteggio potrà considerare:

1. numero atteso di movimentazioni;
2. completezza delle pile (`3 + 3` preferibile a `3 + 2 + 1`);
3. uso del retro prima del fronte quando la struttura è vuota o equivalente;
4. raggruppamento dello stesso articolo;
5. accessibilità dei cassoni più vecchi;
6. frammentazione residua degli spazi;
7. priorità/tag;
8. eventuali incompatibilità fisiche o merceologiche.

I pesi non sono ancora definiti. Prima dell'implementazione serviranno casi di prova reali con risultato atteso.

### Requisiti ricavati dalla simulazione del 11 settembre 2026

Il PDF `Gestione Magazzino.pdf` descrive una simulazione ridotta a sei coppie (`1-2` … `11-12`) e tre livelli. I colori rappresentano articoli diversi e non stati logistici.

La sequenza conferma questi comportamenti:

1. `3 × 1400`: creazione di una pila posteriore completa;
2. `2 × 1500`: creazione di una pila posteriore adiacente da due livelli;
3. inserimento congiunto di `4 × 1600`, `1 × 1700`, `6 × 1800`, `7 × 1900`, `3 × 2000`: uso prioritario di pile complete e collocazione dei resti in livelli già supportati;
4. `4 × 2100`, `4 × 2200` e ulteriori `2 × 1500`: completamento di spazi verticali disponibili e riduzione delle divisioni;
5. scarico di `2 × 1500` con FIFO e `2 × 2200`: compattazione verticale e scambio locale fronte/retro per rendere accessibile una pila incompleta;
6. carico di `3 × 1700`: completamento prioritario delle pile parziali compatibili;
7. scarico di `3 × 1600`: preferenza per una pila posteriore completa rispetto a una composizione `1 anteriore + 2 posteriori`, indicata come più costosa da movimentare.

La simulazione rafforza quindi che il punteggio deve misurare almeno: numero di pile/divisioni create, pile completate, livelli supportati riutilizzati, aperture temporanee del fronte, scambi fronte/retro, manipolazioni complessive e accessibilità lasciata ai refill successivi.

### Riassetto automatico dello stock esistente

Il sistema dovrà poter generare un piano di **auto-sorting** dell'intero stock già presente, comprendendo sia cassoni sia pallet. Lo scopo è migliorare distribuzione, accessibilità e utilizzo dello spazio applicando gli stessi criteri del motore di storing/slotting, senza confonderlo con un semplice riordino compatto.

Il piano deve rispettare almeno:

- orientamento fisico di ogni fila e reale accessibilità dal corridoio;
- gravità verticale e dipendenze fra livelli `a`, `b`, `c`;
- vincoli indivisibili e blocchi verticali dei pallet;
- whitelist e blacklist cliente di fila e slot;
- FIFO, tag, priorità operative e ordini urgenti;
- capacità della zona di movimentazione e necessità di appoggi temporanei;
- occupazioni riservate o modificate contemporaneamente da altri operatori.

L'operatore potrà indicare un **numero massimo `X` di spostamenti manuali**. Questo valore è un limite rigido: l'algoritmo dovrà proporre il miglior miglioramento raggiungibile entro il budget, anche quando non coincide con l'assetto teoricamente ottimo. Prima di fissare la metrica va chiarito se uno “spostamento” indica un viaggio del mezzo, una presa/deposito, un cambio di ubicazione o l'intera sequenza origine-destinazione.

Nel calcolo del limite `X` dovranno rientrare anche le manipolazioni temporanee necessarie a rimuovere un cassone anteriore, operare sul retro e riposizionarlo, pur non producendo un cambio di ubicazione finale. L'interfaccia potrà aggregarle in un'unica istruzione operativa, ma il costo usato dall'ottimizzatore non potrà ometterle.

#### Lato umano dell'operazione

Il riassetto non dovrà essere applicato in autonomia. Il flusso previsto è:

1. simulazione senza modificare le giacenze;
2. confronto sintetico prima/dopo, con beneficio atteso e costo operativo;
3. approvazione del responsabile;
4. esecuzione in piccoli lotti ordinati, assegnabili a uno o più operatori;
5. conferma o scansione di origine, unità e destinazione a ogni passo;
6. possibilità di pausa, ripresa, annullamento controllato e ricalcolo in caso di imprevisto.

Il piano deve ridurre percorsi inutili, movimentazioni ripetute e cambi frequenti di zona; considerare peso, ergonomia, mezzi disponibili, turni e sicurezza dei corridoi; non bloccare prelievi urgenti o vie di passaggio. Per ogni movimento deve spiegare in modo semplice il motivo e il vantaggio. Cicli di scambio fra slot occupati richiedono una posizione temporanea esplicita nella zona di movimentazione. Tutte le conferme, deviazioni manuali ed eccezioni devono rimanere tracciate nell'audit.

Fra gli indicatori da mostrare prima dell'avvio: movimentazioni previste, distanza o tempo stimato, pile consolidate, slot frontali liberati, frammentazione ridotta, articoli resi più accessibili, conflitti risolti e margine residuo rispetto al limite `X`.

## 6. Vincoli da chiarire

- Relazione fisica tra livelli: è consentito occupare `b` o `c` se il posto sotto è vuoto?
- I cassoni sono tutti uguali per dimensioni, peso e impilabilità?
- Un cassone contiene sempre un solo articolo e lotto?
- Significato esatto di “parziale”: cassone non pieno, quantità residua o prelievo parziale temporaneo?
- Il rientro dopo movimento intermedio conserva data FIFO originale oppure ne genera una nuova?
- Quale data determina formalmente l'anzianità FIFO: ingresso fisico del singolo cassone, registrazione del carico, lotto oppure sequenza ricavata dal riferimento ordine? Il codice ordine non deve diventare implicitamente la sorgente FIFO senza questa conferma.
- È possibile mescolare articoli diversi nella stessa pila verticale? In quali casi?
- Lo scorrimento verticale è una conseguenza fisica gestita come un solo movimento oppure deve generare un movimento di audit per ogni cassone che cambia coordinata?
- Lo spostamento fronte → retro è sempre automatico o deve prima essere confermato dall'operatore?
- Esistono corridoi, ostacoli o file più costose da raggiungere?
- Come vengono misurati gli spostamenti del limite `X`: viaggi, prese/depositi o cambi di ubicazione? Il limite vale per piano, turno o operatore?
- Nel PDF viene nuovamente indicato `A1a` come posteriore e `A2a` come anteriore, mentre la configurazione attuale della fila `A` è standard (`A1a` anteriore, `A2a` posteriore): confermare se la simulazione usa una numerazione astratta oppure se va invertito anche l'orientamento iniziale di `A`.
- Quali finestre orarie e quali mezzi/operatori possono essere usati per un riassetto automatico?
- Un blocco operativo può contenere contemporaneamente carichi e scarichi oppure i due flussi devono restare separati?
- Qual è l'evento che chiude il blocco e autorizza il calcolo: conferma manuale, fine documento di trasporto, ordine o timeout?
- Nella simulazione finale, dopo lo scarico di `3 × 1600`, la rappresentazione sembra non mostrare il quarto cassone `1600` precedentemente presente sul fronte: verificare se è un'omissione grafica, uno spostamento implicito o un ulteriore prelievo.
- Quali tag sono bloccanti e quali sono semplici preferenze?
- Chi può forzare una proposta automatica e come viene registrata l'autorizzazione?
- Il sistema dovrà funzionare su più postazioni contemporaneamente?
- Qual è la sorgente ufficiale dell'anagrafica articoli?
- Le regole cliente devono usare una selezione dall'anagrafica ufficiale oppure consentire anche valori liberi?
- Chi può modificare whitelist e blacklist e serve un'approvazione amministrativa?
- Una modifica che rende non conforme un cassone già presente deve essere bloccata oppure consentita con un piano obbligatorio di riallocazione?
- Come viene identificata fisicamente la zona speciale di movimentazione e quanti cassoni può contenere?
- Una selezione multipla dal report genera un unico piano di scarico o più movimenti indipendenti?
- In quale momento un cassone passa da “In movimento” a “Scaricato” o “Rientrato”?

## 7. Roadmap proposta

1. Confermare geometria, nomenclatura e vincoli fisici.
2. Definire cassone, articolo, lotto, quantità/parziali e ciclo di vita.
3. Preparare una matrice di scenari di carico/scarico con risultati attesi.
4. Definire persistenza, concorrenza e audit dei movimenti.
5. Implementare operazioni manuali e validazioni.
6. Implementare il motore di proposte automatiche e renderne spiegabile il punteggio.
7. Implementare la simulazione di riassetto automatico con budget massimo di movimenti e piano a lotti.
8. Aggiungere ricerca articolo, tag e prelievo FIFO.
9. Collaudare su una copia dei dati prima dell'uso operativo.

## 7.1 Visualizzazione 3D futura

È richiesta una futura rappresentazione tridimensionale delle scaffalature, da valutare con **Three.js** oppure **Babylon.js**. L'idea iniziale è mostrare gli slot come elementi impilati nello spazio, mantenendo le coordinate reali e illuminando selezione, corrispondenze e risultati di ricerca.

La scelta del motore verrà fatta più avanti considerando peso del pacchetto, prestazioni nell'app Electron, facilità di selezione degli slot, accessibilità e sincronizzazione con la mappa 2D. La vista 2D resterà comunque disponibile come interfaccia operativa e fallback.

## 8. Base realizzata

- Pulsante “Inventario magazzino” nella pagina Articoli.
- Finestra dedicata al modulo.
- Visualizzazione delle file `A–E`, dei livelli `a–c` e delle coppie fronte/retro.
- Dettaglio flottante di una coordinata dopo circa un secondo di permanenza del puntatore sulla cella; la scheda si chiude uscendo dalla cella e non modifica la selezione.
- Modalità di etichettatura per ubicazione, articolo, cliente, ordine e vista combinata.
- Evidenziazione della selezione e dei cassoni corrispondenti, comprese le altre file.
- Menu contestuale per stato parziale, riallocazione singola, scambio e vincoli della singola ubicazione.
- Selezione multipla con `Ctrl+clic` o rettangolo trascinato, utilizzabile per parziale e vincoli ma non per spostamenti.
- Ricerca testuale combinata per articolo, cliente, ordine, tag, parziale e in movimento.
- Report scritto dei risultati con selezione multipla e passaggio diretto delle unità al gruppo di scarico.
- Pulsante compatto “Ricerca e prelievo” nella toolbar, con filtri e report selezionabile in una finestra dedicata.
- Barra di ricerca rapida sincronizzata con la finestra di ricerca avanzata.
- Vista database dinamica con filtro, selezione e ritorno diretto alla posizione sulla mappa.
- Ordinamento crescente/decrescente e alfanumerico naturale per tutte le colonne della vista database.
- Finestra di analisi aggregata per l'articolo selezionato, con conteggi per unità, tipologia, ordini, clienti, stati e ubicazioni.
- Configuratore whitelist/blacklist per fila e slot, valutazione gerarchica e rilevazione dei conflitti esistenti.
- Pannello strumenti flottante con selezione della densità `1–16 / 17–32` oppure `1–32` e accesso ai vincoli cliente.
- Configurazione in memoria del numero di file, della capacità individuale e dell'orientamento fronte/retro di ciascuna fila; `B` e `D` sono inizialmente invertite.
- Flusso in tre fasi per gruppi multi-articolo di carico e scarico: composizione, anteprima modificabile e conferma operativa atomica.
- Bozze separate di carico e scarico mantenute in memoria anche chiudendo la finestra; annullamento completo con ritorno alla mappa.
- Modulo di carico con articolo, cliente, riferimento ordine, quantità, parziale e tipologia; modulo di scarico manuale oppure alimentato dalle unità selezionate nella ricerca.
- Distinzione fra cassone e pallet, con pallet dimostrativo associato a una coppia fronte/retro a terra.
- Un piccolo set di dati dimostrativi non persistenti per verificare la grafica; non rappresenta la giacenza reale.
- Primo motore euristico di carico e scarico: la conferma aggiorna le giacenze in memoria, applica FIFO nello scarico e mostra soltanto articolo e posizioni interessate.
- Storico di sessione dei gruppi automatici con identificativi `MV_AA-MM-GG_HH:mm`; le operazioni nello stesso minuto ricevono un suffisso progressivo.
- Le riallocazioni manuali aggiornano la mappa ma non vengono inserite nello storico automatico. Persistenza su database e gestione completa dei tag restano da realizzare.

## Sistema di "peso" per allocazione/sorting

Posizionare prima cassoni nelle zone posteriori, a partire da sinistra.
Successivamente, posizionare i cassoni negli slot anteriori.
Prima di popolare un piano anteriore, i piani posteriori devono essere full.
Cercare di mettere i cassoni dello stesso articolo nella stessa fila (pesi che differenziano le file per assicurarci che è molto piu probabile avere tutti i cassoni di un articolo nella stessa fila)

Avrò di conseguenza dei pesi per i vari slot, file etc... dove quelli di posizione, vado da post a ant e da sx a destra.
Avrò i pesi di relazione che vanno per distanza da una divisione all'altra (dove per divisione si intente prima una colonna, esempio colonna A2) e poi per coppia di colonne, ovvero A2-A1.
Avrò successivamente i pesi per divisione, dove prediligo il completare divisioni (colonne) per fare in modo che lo score sia il numero di divisioni per il peso di divisione. Questo si calcola in relazione agli altri pesi empiricamente. (probabilmente esiste un modo migliore!)

Nel caso in cui i cassoni sono disposti il questa configurazione:
3 nella colonna A2, 2 nella colonna A1 e 3 nella colonna A4
aggiungendone 5 di tipo diverso (uguali fra loro), la disposizione corretta sarebbe:
- 3 in colonna A6 e 2 in colonna A3
- 2 in A6 e 3 in colonna A3
(dovrebbe in teoria avere lo stesso peso di movimentazione)
In teoria il peso maggiore lo danno le divisioni

Fare prove con vari pesi per assicurarci disposizioni ottimali (fare magari delle simulazioni con dati di esempio con X numero di cassoni compreso tra 1 e 20 per almeno 30 articoli diversi (comprendendo filtri white e blacklist dati da me))

Posso scegliere in fase di carico un sistema per gestire pesi "leggermente" variato, dove possono andare a fillare gli slot per MENO movimentazioni possibili, e una per miglior filling/sorting...

La movimentazioni dei cassoni avvengono nei seguenti modi:
- I cassoni vengono impilati e movimentati con un muletto
- Il muletto può alzare fino a 3 cassoni contemporaneamente.
- Per accedere ai cassoni posteriori deve prima "spostare temporaneamente nel corridoio" la colonna frontale.
- Il muletto può prendere solo il top e o due top cassoni di una colonna, ma non puo prendere contemporaneamente cassoni da lato anteriore e posteriore nella stessa movimentazione (perche avrebbe i cassoni "piu in basso" che intralcerebbero il movimento)
- Per prendere un cassone nel piano b e basta, deve prima spostare temporaneamente quello nel piano c, prelevare il b, e riposizionare il c sostituendolo nella posizione b ora libera
- se ho una colonna posteriore libera solo in piano c e ho 3 cassoni da inserire (uno in c e gli altri due in a e b frontali), devo comunque prima prendere un singolo cassone, posizionarlo in c e poi movimentare gli altri due insieme per posizionarli in a e b frontali....
- i pallet possono solo essere spostati uno alla volta.
