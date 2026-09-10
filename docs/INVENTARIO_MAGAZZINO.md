# Inventario magazzino — piano di progetto

Stato: raccolta requisiti e base visuale iniziale. Le funzioni operative non sono ancora abilitate.

## 1. Obiettivo

Gestire lo stock di articoli conservati in cassoni, proponendo carico, scarico e spostamenti con uno **slotting ottimizzato**. L'obiettivo non è riempire ogni vuoto nel modo più compatto possibile, ma ridurre le movimentazioni necessarie e mantenere efficiente il prelievo.

Il sistema dovrà supportare sia proposte automatiche sia operazioni manuali forzate dall'operatore.

## 2. Struttura fisica comunicata

- 5 file di scaffalature, identificate con lettere maiuscole: `A`, `B`, `C`, `D`, `E`.
- 96 cassoni per fila, per una capacità totale teorica di 480 cassoni.
- 3 livelli verticali: `a` in basso, `b` al centro, `c` in alto.
- Per ciascun livello: 16 cassoni anteriori e 16 posteriori.
- I numeri dispari identificano il lato anteriore; i numeri pari il lato posteriore.
- Una posizione completa è composta da fila, numero e livello, per esempio `A1a` oppure `A2c`.
- Il prelievo avviene sempre dal lato anteriore.
- La struttura non è necessariamente uniforme: ogni fila può avere una capacità diversa, espressa come numero di cassoni standard.
- Poiché ogni modulo fisico contiene 2 lati × 3 livelli, la capacità configurabile di una fila deve essere un multiplo di 6.

### Tipologie di unità logistica

Il magazzino contiene due tipologie distinte:

- **Cassone**: occupa un singolo slot e può essere impilato sui livelli `a`, `b` e `c`, rispettando i vincoli verticali;
- **Pallet**: occupa obbligatoriamente due slot accoppiati, uno anteriore e uno posteriore dello stesso modulo fisico, per esempio `A3a + A4a`.

Un pallet può essere collocato soltanto a terra, sul livello `a`. L'intera colonna deve essere libera: non può esserci alcun cassone o pallet sui livelli `b` e `c`, né sopra né sotto l'unità. I due slot condividono un unico identificativo pallet e ogni carico, scarico o spostamento dovrà trattarli come un'unità indivisibile.

### Interpretazione iniziale da confermare

Per far tornare i 96 posti per fila, la base visuale assume 16 colonne fisiche, ciascuna con una coppia fronte/retro:

- colonna fisica 1: `1` davanti e `2` dietro;
- colonna fisica 2: `3` davanti e `4` dietro;
- ...
- colonna fisica 16: `31` davanti e `32` dietro.

Ogni numero esiste ai livelli `a`, `b`, `c`. Questa interpretazione deve essere confermata, in particolare rispetto all'esempio `A16a/b/c`.

## 3. Regole funzionali già definite

### Carico automatico

- L'operatore indica articolo e numero di cassoni da caricare.
- Ogni richiesta di carico raccoglie: articolo, cliente, riferimento ordine, quantità, stato parziale (`Sì/No`) e tipologia (`Cassone/Pallet`).
- Se la tipologia è pallet, ogni unità richiesta consuma una coppia fronte/retro a terra e l'algoritmo deve escludere qualsiasi colonna verticalmente occupata.
- A magazzino vuoto si preferiscono inizialmente gli slot posteriori, perché l'accesso è frontale.
- I cassoni dello stesso carico vanno raggruppati in pile complete da 3 quando possibile.
- Il sistema non deve semplicemente saturare i primi vuoti disponibili.
- Deve ridurre le future movimentazioni e usare gli spazi parziali quando questo non peggiora la disposizione complessiva.
- Esempio ricevuto: 4 cassoni di `1400A` → `A2a`, `A2b`, `A2c`, `A1a`.
- Esempio ricevuto: 6 cassoni → preferire una distribuzione `3 + 3`, possibilmente su una coppia fronte/retro libera, invece di `3 + 2 + 1`.

### Scarico automatico

- Applicare FIFO: prelevare prima i cassoni più vecchi.
- Ottimizzare lo spazio e ridurre le movimentazioni necessarie per raggiungere i cassoni.
- Un prelievo può prevedere un movimento intermedio: un cassone viene estratto, usato o controllato e può poi tornare in magazzino.
- La struttura deve rispettare la gravità verticale: `b` richiede `a` occupato e `c` richiede `a` e `b` occupati sullo stesso numero.
- Se viene prelevato un cassone intermedio, quelli sopra scendono automaticamente per chiudere il vuoto. Esempio: prelevando `A1b`, il contenuto di `A1c` passa ad `A1b`.
- Una posizione anteriore dispari non può restare occupata se la corrispondente posizione posteriore pari è libera.
- Quando il retro si libera e davanti sono presenti cassoni, il piano di ottimizzazione può spostarli dietro per liberare slot frontali. La scelta esatta dipenderà dal costo delle movimentazioni e dalle regole ancora da definire.

### Interrogazione (asking)

- Cercare un articolo e listare tutti i relativi cassoni con le loro posizioni.
- La base corrente permette di cercare e ispezionare una coordinata fisica e usa solo cassoni dimostrativi; non contiene ancora giacenze reali.
- La ricerca testuale trasversale deve poter interrogare contemporaneamente articolo, cliente, riferimento ordine, tag e stati **Parziale** e **In movimento**.
- Più parole nella stessa ricerca vengono combinate: ogni parola deve comparire in almeno uno dei campi abilitati.
- I risultati devono essere evidenziati sulla mappa anche quando appartengono a file non visibili.
- Oltre all'evidenziazione serve un report scritto con ubicazione, articolo, cliente, riferimento ordine e stati rilevanti.
- Le righe del report devono essere selezionabili tramite spunta per preparare uno scarico multiplo. Il comando operativo verrà abilitato solo dopo aver definito la zona speciale di movimentazione.

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

La vista database elenca tutte le ubicazioni previste dalla struttura configurata, comprese quelle libere, in una tabella stile foglio di calcolo. Espone geometria dello slot, stato, identificativo dell'unità logistica, tipologia, articolo, cliente, ordine, tag e stato del contenuto. Può essere filtrata testualmente oppure limitata ai soli slot occupati.

Una riga può essere selezionata e aperta sulla mappa tramite pulsante o doppio clic. Le future funzioni di esportazione e analisi useranno questa stessa vista senza duplicare il modello dati.

### Stato parziale

- Il menu contestuale con tasto destro permette di attivare o rimuovere lo stato **parziale** su un cassone.
- Parziale significa contenuto maggiore dello 0% e minore del 100%.
- Uno slot libero non può essere parziale.
- La quantità o percentuale esatta non è ancora modellata e dovrà essere definita prima della persistenza.

### Operazioni manuali

L'operatore potrà forzare:

- carico diretto in una posizione scelta;
- scarico diretto;
- spostamento da una posizione a un'altra;
- scelta di un cassone specifico.

Ogni forzatura dovrà comunque validare i vincoli fisici e lasciare una traccia nella cronologia.

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

- **Slot**: coordinata, fila, colonna fisica, lato, livello, stato e possibili vincoli/blocchi.
- **Cassone**: identificativo univoco, articolo, lotto, quantità/parziale, data di ingresso, tag e stato.
- **Occupazione**: relazione temporale tra cassone e slot.
- **Movimento**: carico, scarico, spostamento, estrazione intermedia o rientro; origine, destinazione, operatore e data/ora.
- **Piano di movimentazione**: sequenza proposta dall'algoritmo, con punteggio e motivazioni.

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

## 6. Vincoli da chiarire

- Conferma della numerazione completa: `1–32` oppure altra convenzione.
- Relazione fisica tra livelli: è consentito occupare `b` o `c` se il posto sotto è vuoto?
- I cassoni sono tutti uguali per dimensioni, peso e impilabilità?
- Un cassone contiene sempre un solo articolo e lotto?
- Significato esatto di “parziale”: cassone non pieno, quantità residua o prelievo parziale temporaneo?
- Il rientro dopo movimento intermedio conserva data FIFO originale oppure ne genera una nuova?
- È possibile mescolare articoli diversi nella stessa pila verticale? In quali casi?
- Lo scorrimento verticale è una conseguenza fisica gestita come un solo movimento oppure deve generare un movimento di audit per ogni cassone che cambia coordinata?
- Lo spostamento fronte → retro è sempre automatico o deve prima essere confermato dall'operatore?
- Esistono corridoi, ostacoli o file più costose da raggiungere?
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
7. Aggiungere ricerca articolo, tag e prelievo FIFO.
8. Collaudare su una copia dei dati prima dell'uso operativo.

## 7.1 Visualizzazione 3D futura

È richiesta una futura rappresentazione tridimensionale delle scaffalature, da valutare con **Three.js** oppure **Babylon.js**. L'idea iniziale è mostrare gli slot come elementi impilati nello spazio, mantenendo le coordinate reali e illuminando selezione, corrispondenze e risultati di ricerca.

La scelta del motore verrà fatta più avanti considerando peso del pacchetto, prestazioni nell'app Electron, facilità di selezione degli slot, accessibilità e sincronizzazione con la mappa 2D. La vista 2D resterà comunque disponibile come interfaccia operativa e fallback.

## 8. Base realizzata

- Pulsante “Inventario magazzino” nella pagina Articoli.
- Finestra dedicata al modulo.
- Visualizzazione delle file `A–E`, dei livelli `a–c` e delle coppie fronte/retro.
- Ricerca e dettaglio di una coordinata.
- Modalità di etichettatura per ubicazione, articolo, cliente, ordine e vista combinata.
- Evidenziazione della selezione e dei cassoni corrispondenti, comprese le altre file.
- Menu contestuale per simulare in memoria lo stato parziale.
- Ricerca testuale combinata per articolo, cliente, ordine, tag, parziale e in movimento.
- Report scritto dei risultati con selezione multipla già predisposta; avvio scarico ancora disabilitato.
- Ricerca principale integrata nella toolbar della mappa, con criteri e report nella colonna laterale.
- Vista database a 480 righe con filtro, selezione e ritorno diretto alla posizione sulla mappa.
- Configuratore whitelist/blacklist per fila e slot, valutazione gerarchica e rilevazione dei conflitti esistenti.
- Pannello strumenti flottante con selezione della densità `1–16 / 17–32` oppure `1–32` e accesso ai vincoli cliente.
- Configurazione in memoria del numero di file e della capacità individuale di ciascuna fila.
- Modulo iniziale di carico con articolo, cliente, riferimento ordine, quantità, parziale e tipologia.
- Distinzione fra cassone e pallet, con pallet dimostrativo associato a una coppia fronte/retro a terra.
- Un piccolo set di dati dimostrativi non persistenti per verificare la grafica; non rappresenta la giacenza reale.
- Operazioni di carico, scarico, spostamento e tag mostrate ma disabilitate fino alla definizione dei requisiti.
