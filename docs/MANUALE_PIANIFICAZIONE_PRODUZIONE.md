# AyPi — Manuale completo del modulo Pianificazione Produzione

> Manuale operativo e funzionale del megamodulo **Pianificazione reparti** e della relativa finestra **Analisi produzione**.  
> Revisione del documento: 29 luglio 2026. Riferimento applicativo: AyPi 1.3.2.

---

## Indice

1. [Scopo del modulo](#1-scopo-del-modulo)
2. [Apertura e struttura della finestra](#2-apertura-e-struttura-della-finestra)
3. [Sincronizzazione, aggiornamento e lavoro multiutente](#3-sincronizzazione-aggiornamento-e-lavoro-multiutente)
4. [Indicatori riepilogativi](#4-indicatori-riepilogativi)
5. [Navigazione nel calendario](#5-navigazione-nel-calendario)
6. [Filtri del pianificatore](#6-filtri-del-pianificatore)
7. [Pannello Articoli](#7-pannello-articoli)
8. [Lettura del Gantt](#8-lettura-del-gantt)
9. [Creazione di una lavorazione](#9-creazione-di-una-lavorazione)
10. [Selezione facilitata della macchina](#10-selezione-facilitata-della-macchina)
11. [Spostamento e ridimensionamento delle lavorazioni](#11-spostamento-e-ridimensionamento-delle-lavorazioni)
12. [Menu contestuale delle lavorazioni](#12-menu-contestuale-delle-lavorazioni)
13. [Stati della lavorazione e avanzamento](#13-stati-della-lavorazione-e-avanzamento)
14. [Disponibilità del materiale](#14-disponibilità-del-materiale)
15. [Collegamenti tra lavorazioni](#15-collegamenti-tra-lavorazioni)
16. [Gestione delle macchine](#16-gestione-delle-macchine)
17. [Fermi macchina](#17-fermi-macchina)
18. [Chiusure e ferie](#18-chiusure-e-ferie)
19. [Fine settimana, indisponibilità e calcolo delle durate](#19-fine-settimana-indisponibilità-e-calcolo-delle-durate)
20. [Archivio automatico](#20-archivio-automatico)
21. [Finestra Analisi produzione](#21-finestra-analisi-produzione)
22. [Filtri dell’Analisi](#22-filtri-dellanalisi)
23. [Indicatori dell’Analisi e formule](#23-indicatori-dellanalisi-e-formule)
24. [Grafici standard](#24-grafici-standard)
25. [Analisi personalizzate](#25-analisi-personalizzate)
26. [Tabelle analitiche](#26-tabelle-analitiche)
27. [Esportazione in Excel](#27-esportazione-in-excel)
28. [Procedure operative consigliate](#28-procedure-operative-consigliate)
29. [Conferme, errori e protezione dei dati](#29-conferme-errori-e-protezione-dei-dati)
30. [Prestazioni con molti dati](#30-prestazioni-con-molti-dati)
31. [Risoluzione dei problemi](#31-risoluzione-dei-problemi)
32. [Glossario](#32-glossario)

---

## 1. Scopo del modulo

**Pianificazione reparti** sostituisce la gestione frammentata tramite molti calendari Excel con un ambiente unico e condiviso. Consente di:

- registrare gli articoli da produrre;
- lasciare una lavorazione **Da pianificare** oppure assegnarla subito a una macchina;
- organizzare le lavorazioni per macchina e giorno;
- spostare e ridimensionare le barre direttamente nel Gantt;
- rappresentare più lavorazioni contemporanee sulla stessa macchina;
- gestire reparti, categorie e ordinamento delle macchine;
- registrare guasti, manutenzioni, chiusure e ferie;
- monitorare disponibilità materiale, stato e avanzamento della produzione;
- collegare lavorazioni precedenti e successive;
- lavorare contemporaneamente da più postazioni;
- consultare statistiche, grafici, tabelle e analisi personalizzate;
- esportare in Excel il risultato di qualsiasi analisi filtrata.

Il modulo non impone un vincolo di capacità esclusiva: **una macchina può avere più articoli nello stesso giorno**. Le lavorazioni sovrapposte vengono mostrate su livelli distinti della stessa riga.

---

## 2. Apertura e struttura della finestra

Il pianificatore si apre in una **finestra AyPi dedicata**, separata da AyPi Home e dagli altri moduli. In questo modo può essere mantenuto aperto, spostato su un altro monitor e usato senza occupare la finestra principale.

### Schermata iniziale

All’apertura viene usato lo splash coerente con la modalità dalla quale è stato avviato il modulo:

- dalla modalità **AyPi standard** compare l’immagine nero/argento **AyPi Pianificazione**; viene mostrata al primo avvio del pianificatore nella sessione, rimane pienamente visibile per circa 800 ms e completa la dissolvenza entro circa 1,6 secondi;
- dalla modalità **Blue Archive** compare il boot animato con griglia tecnica, sweep luminoso, emblema AyPi e avanzamento `Dati → Macchine → Lavorazioni → Calendario`;
- facendo clic sullo splash è possibile saltarlo;
- la coda luminosa del puntatore è attiva durante lo splash soltanto in modalità Blue Archive.

Lo splash non cambia l’interfaccia operativa del pianificatore: terminata l’animazione, il modulo mantiene la propria grafica unica.

La schermata è suddivisa nelle seguenti aree:

1. **Barra superiore**, con stato di sincronizzazione e comandi principali.
2. **Riepilogo**, con Programmate, Da pianificare e In ritardo.
3. **Navigazione temporale e filtri**.
4. **Pannello Articoli**, a sinistra.
5. **Legenda**, sopra il calendario.
6. **Gantt**, con una riga per macchina e una colonna per giorno.

### Pulsanti della barra superiore

| Pulsante | Funzione |
|---|---|
| **Aggiorna** | Richiede immediatamente lo stato più recente al backend. |
| **Annulla** | Ripristina l’ultimo stato precedente disponibile. Equivale a `Ctrl+Z` quando non si sta scrivendo in un campo o usando un form. |
| **Analisi** | Apre la finestra dedicata alle analisi di produzione. |
| **Fermi macchina** | Apre la gestione di guasti e manutenzioni per una singola macchina. |
| **Chiusure / Ferie** | Apre la gestione delle indisponibilità aziendali, di reparto o di più macchine. |
| **Macchine** | Apre l’anagrafica delle macchine, dei reparti, delle categorie e dell’ordine nel Gantt. |
| **+ Nuova lavorazione** | Apre il modulo per creare un nuovo articolo/ordine di produzione. |

### Adattamento alle finestre ridotte

Ridimensionando la finestra, font, logo, spaziature e pulsanti della barra superiore diventano progressivamente più compatti. Sotto i **965 px** di larghezza i comandi vengono disposti su più righe, così le scritte restano contenute nei pulsanti e tutti i comandi continuano a essere utilizzabili.

---

## 3. Sincronizzazione, aggiornamento e lavoro multiutente

Il pianificatore usa un archivio centralizzato sul backend. Tutti gli utenti autorizzati lavorano quindi sullo stesso insieme di macchine, lavorazioni, collegamenti e indisponibilità.

### Aggiornamento iniziale

All’apertura, la finestra:

1. contatta il backend;
2. scarica lo stato più recente;
3. costruisce filtri, pannello Articoli e Gantt;
4. apre il canale di aggiornamento in tempo reale.

### WebSocket

Gli aggiornamenti in tempo reale sono trasmessi tramite WebSocket, sullo stesso host e sulla stessa porta HTTP del backend, con percorso `/ws`. Non è necessaria una seconda porta dedicata.

Quando un altro operatore salva una modifica, gli altri pianificatori aperti ricevono la notifica e ricaricano i dati. Questo riguarda, per esempio:

- creazione, modifica, copia o eliminazione di una lavorazione;
- spostamento o ridimensionamento nel Gantt;
- cambio di stato o avanzamento;
- cambio di disponibilità materiale;
- creazione o rimozione di collegamenti;
- modifica di macchine e loro ordinamento;
- fermi macchina;
- chiusure e ferie.

### Riconnessione automatica e watchdog

Il client non richiede un intervento manuale dopo una normale caduta di rete o il riavvio del backend:

- tenta la riconnessione con attese progressive di circa 1, 2, 4, 8 e 16 secondi, fino a un massimo di circa 30 secondi;
- aggiunge una piccola variazione casuale, evitando che molte postazioni si ricolleghino nello stesso istante;
- dopo la riconnessione esegue una risincronizzazione dei moduli;
- il server controlla periodicamente la vitalità delle connessioni con heartbeat;
- il client verifica che l’handshake venga completato entro 15 secondi;
- se non rileva attività per 70 secondi considera il collegamento bloccato, lo chiude e avvia una nuova connessione;
- un errore esplicito del socket provoca lo stesso recupero automatico.

Durante il recupero, l’indicatore della barra passa a uno stato di connessione, offline o riconnessione e ne conserva il motivo nel suggerimento visualizzato al passaggio del mouse.

### Indicatore di sincronizzazione

Accanto al pulsante **Aggiorna** è presente un indicatore che può mostrare stati come:

- caricamento o connessione;
- sincronizzazione in corso;
- sincronizzato/aggiornato;
- aggiornamento ricevuto da un altro utente;
- offline o connessione non disponibile.

L’orario visualizzato è l’ora locale della postazione relativa all’ultimo aggiornamento correttamente acquisito.

### Pulsante Aggiorna

Il tempo reale è automatico, ma **Aggiorna** permette di forzare una verifica immediata. È utile:

- dopo una momentanea perdita di rete;
- se si sospetta che una modifica altrui non sia ancora comparsa;
- dopo il riavvio del backend;
- come controllo manuale prima di una modifica importante.

### Rete temporaneamente assente

Se il WebSocket non è disponibile, l’app utilizza anche un controllo HTTP periodico di sicurezza, normalmente ogni 10 secondi. Le modifiche locali in attesa non vengono scartate automaticamente: il pianificatore tenta di riallinearsi e di salvare nuovamente quando possibile.

### Modifica concorrente

Ogni stato possiede una revisione. Se due utenti modificano partendo dalla stessa vecchia revisione, il backend evita che l’ultimo salvataggio cancelli silenziosamente il lavoro precedente. Il client recupera lo stato più recente e può chiedere all’operatore di ripetere l’operazione.

Questa protezione riguarda la **concorrenza tra utenti** e non va confusa con la sovrapposizione produttiva: più articoli sulla stessa macchina e nello stesso giorno sono ammessi.

---

## 4. Indicatori riepilogativi

### Programmate

Conta tutte le lavorazioni:

- assegnate a una macchina;
- non ancora nello stato **Terminato**.

Il valore è generale e non dipende dal periodo di 7, 14 o 28 giorni attualmente visibile.

### Da pianificare

Conta le lavorazioni prive di macchina. Questi elementi si trovano nella relativa vista del pannello Articoli e possono essere trascinati nel Gantt.

### In ritardo

Conta le lavorazioni che hanno superato la **Prima consegna** senza essere completate nei termini previsti.

La data di riferimento del ritardo è quindi **Prima consegna**, non Consegna finale. La Consegna finale rimane un’informazione opzionale e non guida questo indicatore.

---

## 5. Navigazione nel calendario

### Frecce sinistra e destra

I pulsanti **‹** e **›** spostano l’intero intervallo visibile di **un giorno alla volta**. Il numero di colonne non cambia.

Esempio: in una vista di 14 giorni, premendo la freccia destra vengono ancora mostrati 14 giorni, ma l’intervallo parte dal giorno successivo.

### Pulsante Oggi

Con un clic normale:

- porta il calendario alla data odierna;
- colloca oggi nella **seconda colonna** visibile.

La prima colonna mostra quindi il giorno precedente e la seconda evidenzia oggi.

### Clic destro su Oggi

Con il tasto destro si apre un selettore calendario. Dopo aver scelto una data:

- il Gantt naviga direttamente a quel periodo;
- la data scelta viene collocata nella **seconda colonna**, come avviene con Oggi.

Questa funzione è utile per raggiungere rapidamente date lontane senza ripetere molti clic.

### Trascinamento delle intestazioni dei giorni

Le intestazioni non sono selezionabili come testo. È possibile:

1. premere il pulsante sinistro del mouse sull’area dei giorni;
2. trascinare orizzontalmente;
3. rilasciare quando si è raggiunto il periodo desiderato.

Il calendario scorre in modo fluido a sinistra o a destra. Questa azione serve solo a navigare e non sposta le lavorazioni.

### Vista 7, 14 o 28 giorni

Il selettore determina quanti giorni devono entrare contemporaneamente nella larghezza disponibile:

- **7 giorni**: colonne più larghe, dettaglio maggiore;
- **14 giorni**: equilibrio tra dettaglio e orizzonte;
- **28 giorni**: colonne più strette, visione più estesa.

Non si tratta di scatti temporali fissi: frecce e trascinamento continuano a spostare la vista giorno per giorno.

---

## 6. Filtri del pianificatore

I filtri sono combinabili. Se si selezionano più valori nello stesso gruppo, vengono ammessi tutti i valori selezionati di quel gruppo; gruppi diversi restringono insieme il risultato.

### Codice articolo

Il campo dedicato all’articolo usa una ricerca progressiva ancorata all’inizio. Se non viene indicato diversamente, il sistema considera automaticamente un `%` alla fine di ciò che viene scritto.

Di conseguenza:

- `1144` trova `1144`, `11440`, `1144A` e in generale tutti i codici che iniziano con `1144`;
- non trova `A1144`, perché l’inizio deve corrispondere;
- la ricerca continua ad aggiornarsi mentre l’operatore digita.

Il confronto non distingue maiuscole e minuscole.

#### Wildcard disponibili

| Simbolo | Significato | Esempio |
|---|---|---|
| `%` | Zero o più caratteri | `%1144` trova tutti i codici che contengono `1144`. |
| `_` | Un singolo carattere | `T_00` trova `T100`, `TA00`, ecc. |
| `[]` | Un carattere compreso nell’insieme | `[AB]400` trova `A400` e `B400`. |
| `[^]` | Un carattere non compreso nell’insieme | `[^T]400` esclude `T400`. |
| `-` | Un carattere compreso nell’intervallo indicato dentro `[]` | `[0-9]00` trova codici come `400`. |
| `{}` | Tratta come letterale il contenuto racchiuso | `{%}400` cerca un `%` reale; `A{_}B` cerca `_`. |
| `|` | Termina il modello esattamente nel punto indicato | `1144|` trova esclusivamente `1144`. |

Il terminatore `|` permette di costruire facilmente ricerche con fine esatta:

- `%1144|` trova i codici che terminano con `1144`;
- `T%50|` trova i codici che iniziano con `T` e terminano con `50`;
- `1144|` ripristina una ricerca completamente esatta;
- `{|}` cerca una barra verticale reale invece di usarla come terminatore.

I caratteri scritti dopo un `|` non fanno parte del modello. Parentesi incomplete, intervalli non validi o altri input malformati vengono trattati in sicurezza come testo letterale e non interrompono il filtro.

### Altri dettagli

Il secondo campo di ricerca riguarda le altre informazioni della lavorazione, tra cui:

- cliente;
- fase di lavorazione;
- materiale/lega;
- macchina;
- reparto;
- categoria;
- date di consegna;
- quantità e unità;
- Kg/Fasci di barra;
- proprietario barra/materiale;
- stato materiale;
- stato lavorazione;
- priorità;
- note.

Anche questa ricerca è precisa rispetto ai valori indicizzati e non sostituisce il filtro esatto del codice articolo.

### Reparti

Permette di selezionare uno o più reparti. Vengono mantenute le righe delle macchine appartenenti ai reparti scelti.

### Categorie

Permette di selezionare una o più categorie di macchina. La categoria è indipendente dal reparto: due macchine possono appartenere allo stesso reparto ma a categorie differenti.

### Macchine

Permette di selezionare una o più macchine specifiche.

### Filtri macchina a cascata

I tre menu **Reparti**, **Categorie** e **Macchine** restano separati e sono tutti multi-select, ma le opzioni vengono proposte gerarchicamente:

1. scegliendo uno o più reparti, nel menu Categorie rimangono soltanto le categorie realmente presenti nei reparti scelti;
2. il menu Macchine mostra soltanto le macchine appartenenti ai reparti e alle categorie correnti;
3. aggiungendo o togliendo categorie, l’elenco delle macchine viene aggiornato immediatamente;
4. una categoria o una macchina già selezionata viene rimossa automaticamente se una nuova scelta superiore la rende incompatibile;
5. deselezionando reparti o categorie, le opzioni disponibili si ampliano nuovamente.

Più valori selezionati nello stesso menu vengono interpretati come alternative valide; i livelli differenti vengono invece combinati per restringere il risultato.

### Disponibilità materiale

Permette di selezionare uno o più stati:

- Disponibile;
- Parzialmente disponibile;
- In arrivo;
- Non disponibile;
- Da verificare.

### Sparizione automatica delle righe vuote

Quando si filtra per articolo, cliente, dettagli, lotto storico importato o altre informazioni della lavorazione, le righe delle macchine che non contengono alcun risultato vengono nascoste automaticamente.

Questo comportamento rende il Gantt leggibile anche con decine di macchine.

### Mostra archivio

È disattivato per impostazione predefinita. Quando viene attivato, rende visibili anche le lavorazioni archiviate automaticamente.

L’archivio non elimina alcun dato: cambia soltanto ciò che viene visualizzato.

---

## 7. Pannello Articoli

Il pannello a sinistra può mostrare due viste.

### Vista Da pianificare

Mostra tutte le lavorazioni senza macchina. Ogni scheda può riportare:

- codice articolo e fase;
- cliente;
- durata;
- quantità;
- priorità;
- eventuali collegamenti.

Per pianificare una scheda:

1. premere sulla scheda;
2. trascinarla sulla riga della macchina;
3. posizionarla sul giorno desiderato;
4. rilasciare.

Durante il trascinamento compare l’anteprima della barra nella posizione di destinazione.

### Vista Lista filtrata

Mostra tutte le lavorazioni che rispettano i filtri correnti, comprese quelle già collocate nel calendario.

Facendo clic su una voce:

- il Gantt raggiunge la macchina e il periodo corretti;
- la data della lavorazione viene portata nell’area visibile;
- il giorno di riferimento viene posizionato come seconda colonna;
- se l’elemento è archiviato, il pianificatore abilita la visualizzazione necessaria per raggiungerlo.

Questa vista è particolarmente utile quando la ricerca produce risultati distribuiti su periodi molto lontani.

---

## 8. Lettura del Gantt

### Righe

Ogni riga rappresenta una macchina. L’ordine è quello definito nel pannello **Macchine** ed è condiviso tra tutti gli utenti.

### Colonne

Ogni colonna rappresenta un giorno di calendario. Sabati e domeniche hanno intestazione e celle con una colorazione leggera differente.

### Barre

Ogni barra rappresenta una lavorazione. Le informazioni più importanti restano leggibili anche quando:

- la barra inizia prima dell’intervallo visibile;
- la barra termina dopo l’intervallo visibile;
- sono presenti più lavorazioni sulla stessa macchina.

Se una barra prosegue oltre il bordo, il lato tagliato utilizza un indicatore di continuazione: il bordo dello schermo non viene mostrato come falsa fine della lavorazione.

### Sovrapposizioni

Più articoli possono occupare la stessa macchina e gli stessi giorni. Il Gantt li dispone su tracce verticali separate nella medesima riga.

### Legenda materiale

- **Disponibile**;
- **Parzialmente disponibile**, con resa mista verde/gialla;
- **In arrivo**;
- **Non disponibile**;
- **Da verificare**.

### Legenda lavorazione

- **Non ancora iniziato**;
- **In corso**;
- **Terminato**;
- **Fermo macchina**.

### Avanzamento nella barra

Una lavorazione In corso mostra graficamente la quota di giorni già processati rispetto alla durata totale.

Esempio: una lavorazione di 10 giorni con avanzamento 4 mostra il 40% della barra come lavorato.

### Popup al passaggio del mouse

Passando il mouse sulla barra compare un popup informativo. A seconda dei dati compilati può mostrare:

- articolo e fase;
- cliente;
- materiale/lega;
- macchina;
- periodo pianificato;
- durata;
- stato lavorazione;
- giorni processati;
- quantità e unità;
- Kg/Fasci di barra;
- proprietario barra/materiale;
- prima consegna e relativa quantità;
- consegna finale, se presente;
- disponibilità materiale;
- collegamento precedente e successivo;
- note, preservando le righe del testo.

Il popup scompare quando il puntatore lascia l’elemento.

---

## 9. Creazione di una lavorazione

Premere **+ Nuova lavorazione** per aprire il form.

### Campi del form

| Campo | Obbligo | Descrizione |
|---|---:|---|
| **Codice articolo** | Sì | Identificativo esatto dell’articolo. |
| **Cliente** | Sì | Cliente associato alla produzione. |
| **Fase di lavorazione** | No | Fase o operazione prevista. |
| **Materiale / Lega** | No | Materiale tecnico, lega o qualità. |
| **Quantità** | No | Quantità totale prevista. |
| **Unità** | Sì | Pezzi oppure kg. |
| **Kg / Fasci di barra** | No | Testo libero, per esempio `1.200 kg / 3 fasci`. |
| **Proprietario barra / materiale** | No | Cliente, azienda, fornitore o altro proprietario. |
| **Macchina** | No | Una macchina specifica oppure Da pianificare. |
| **Priorità** | Sì | Normale, Alta o Urgente. |
| **Inizio previsto** | Dipende | Utilizzabile solo dopo aver scelto una macchina. |
| **Durata produzione** | Sì | Numero intero di giorni lavorativi, minimo 1. |
| **Consegna finale** | No | Informazione opzionale; non determina il ritardo principale. |
| **Prima consegna** | No | Data usata come riferimento per puntualità e ritardo. |
| **Quantità prima consegna** | No | Quantità prevista alla prima consegna. |
| **Stato materiale** | Sì | Uno dei cinque stati disponibili. |
| **Stato lavorazione** | Sì | Non ancora iniziato, In corso o Terminato. |
| **Note** | No | Annotazioni fino a 600 caratteri. |

### Da pianificare

Se la macchina è **Da pianificare**:

- il campo Inizio previsto non è utilizzabile;
- la lavorazione compare nel pannello Da pianificare;
- la data verrà definita quando la scheda sarà trascinata su una macchina.

### Durata, non data di fine

L’operatore inserisce il numero di giorni di produzione. La data di fine viene calcolata dal sistema considerando:

- il giorno di partenza;
- i giorni lavorativi;
- sabati e domeniche;
- indisponibilità della macchina;
- chiusure e ferie applicabili.

### Salvataggio e annullamento

- **Salva lavorazione** chiede conferma prima di registrare.
- **Annulla** o la chiusura del form chiedono conferma quando è necessario abbandonare l’operazione.
- In caso di dati mancanti o non validi, il form mostra un messaggio e non salva.

Il form usa conferme native dell’app per mantenere correttamente il focus e la possibilità di scrivere nei campi.

---

## 10. Selezione facilitata della macchina

Poiché l’anagrafica può contenere circa 90 macchine, la scelta non avviene tramite un semplice elenco molto lungo.

Aprendo il selettore Macchina sono disponibili:

- ricerca per nome macchina, reparto o categoria;
- pulsanti-filtro per reparto;
- pulsanti-filtro per categoria;
- schede macchina con colore e dettagli;
- opzione **Da pianificare**;
- azzeramento dei filtri del selettore.

Procedura consigliata:

1. scegliere prima un reparto o una categoria;
2. restringere ulteriormente con la ricerca;
3. selezionare la scheda della macchina;
4. verificare nome e dettagli mostrati nel pulsante del form.

I filtri di questo selettore servono soltanto a trovare la macchina: non modificano i filtri del Gantt.

---

## 11. Spostamento e ridimensionamento delle lavorazioni

### Spostare una lavorazione

1. Premere sulla barra.
2. Trascinarla orizzontalmente per cambiare data.
3. Trascinarla verticalmente per cambiare macchina.
4. Controllare l’anteprima nella nuova posizione.
5. Rilasciare per salvare.

L’anteprima mostra direttamente la barra nella posizione prevista, non soltanto l’evidenziazione dell’intera riga.

### Scorrimento automatico durante il trascinamento

Non è necessario rilasciare ripetutamente una lavorazione per raggiungere date o macchine lontane.

Mantenendo la barra trascinata:

- vicino al bordo sinistro, il calendario scorre verso i giorni precedenti;
- vicino al bordo destro, il calendario scorre verso i giorni successivi;
- vicino al bordo superiore, l’elenco scorre verso le macchine precedenti;
- vicino al bordo inferiore, l’elenco scorre verso le macchine successive.

La velocità aumenta avvicinandosi al bordo. L’anteprima rimane agganciata alla lavorazione e viene aggiornata mentre cambiano il periodo e la riga sottostante. Un leggero indicatore azzurro sul bordo segnala la direzione di scorrimento attiva.

Lo scorrimento non parte istantaneamente: viene applicato un leggero ritardo di circa **480 ms**. Questo permette di depositare una lavorazione vicino ai bordi o nel pannello Da pianificare senza provocare uno spostamento involontario del calendario.

Allontanando il puntatore dai bordi lo scorrimento si interrompe; rilasciando la barra, la lavorazione viene salvata sulla macchina e sul giorno mostrati dall’ultima anteprima.

### Rimandare Da pianificare

Una lavorazione già programmata può essere trascinata nel pannello Da pianificare. Perde l’assegnazione alla macchina e la data di inizio diventa non specificabile fino a una nuova pianificazione.

### Ridimensionare

Le maniglie alle estremità della barra permettono di:

- trascinare il bordo sinistro per modificare l’inizio e la lunghezza;
- trascinare il bordo destro per modificare la fine e la lunghezza.

Il ridimensionamento è una decisione manuale dell’operatore.

### Stabilità della durata

Dopo l’importazione o la creazione, lo spostamento di una barra **non deve cambiarne casualmente la lunghezza**. La durata produttiva resta invariata e viene modificata soltanto tramite:

- ridimensionamento manuale;
- modifica esplicita del campo Durata;
- effetto previsto di nuove indisponibilità che introducono giorni non lavorabili.

### Spostamento su sabato o domenica

Se una lavorazione con durata produttiva viene collocata su un fine settimana, il sistema porta l’avvio operativo al primo giorno feriale utile e prolunga la barra per conservare tutti i giorni lavorativi richiesti.

Un ridimensionamento manuale successivo rimane comunque possibile.

### Annullare una modifica

Il pulsante **Annulla** e la scorciatoia `Ctrl+Z` ripristinano l’ultimo stato precedente disponibile.

Caratteristiche:

- la cronologia conserva fino a **40 passaggi** locali;
- ogni annullamento viene salvato e sincronizzato come una normale modifica, quindi viene trasmesso agli altri operatori;
- il suggerimento del pulsante indica quanti passaggi sono disponibili;
- il pulsante è disabilitato quando non esiste nulla da annullare;
- `Ctrl+Z` non viene intercettato mentre si sta scrivendo in un campo, usando un selettore o lavorando dentro un form: in questi casi resta disponibile l’annullamento testuale nativo;
- la scorciatoia globale non opera mentre è aperta una finestra di dialogo, per evitare modifiche accidentali allo stato sottostante.

La cronologia è locale alla sessione del pianificatore e viene azzerata quando viene acquisito uno stato remoto completo. Non sostituisce quindi un sistema storico permanente o un backup.

---

## 12. Menu contestuale delle lavorazioni

Fare clic con il tasto destro su una barra o su una scheda lavorazione.

Il menu si posiziona automaticamente all’interno dello schermo; se l’elemento è vicino al bordo inferiore o laterale, menu e sottomenu vengono spostati per evitare voci tagliate.

I sottomenu si aprono lateralmente in stile menu contestuale Windows. Un piccolo ritardo di attraversamento consente di muovere il puntatore dal menu al sottomenu senza chiudere tutto. Passando invece a un’altra voce principale, il vecchio sottomenu viene chiuso immediatamente.

### Modifica

Apre il form con i dati della lavorazione. È possibile correggere qualsiasi campo. Il salvataggio e l’annullamento richiedono conferma.

### Copia

Apre il form di una **nuova** lavorazione precompilata con i valori dell’originale.

La copia:

- riceve un identificativo nuovo;
- non modifica l’articolo di origine;
- può essere cambiata prima del salvataggio;
- viene registrata solo dopo conferma.

### Collega

Apre il selettore per creare un collegamento precedente/successivo. Per le regole complete vedere [Collegamenti tra lavorazioni](#15-collegamenti-tra-lavorazioni).

### Scollega

Rimuove i collegamenti della lavorazione, dopo la conferma prevista. Se l’interfaccia propone uno specifico lato, rimuove quel rapporto; il comando generale elimina i rapporti presenti.

### Disponibilità materiale

Apre un sottomenu dal quale cambiare rapidamente lo stato del materiale senza aprire il form completo.

### Lavorazione

Apre un sottomenu con:

- Non ancora iniziato;
- In corso;
- Terminato.

La voce In corso è sia cliccabile sia dotata di un ulteriore sottomenu per i giorni processati.

### Elimina

Chiede una conferma esplicita e poi elimina la lavorazione. L’eliminazione non equivale all’archiviazione. Subito dopo l’operazione può essere possibile ripristinare lo stato precedente con **Annulla**, finché quel passaggio è ancora presente nella cronologia locale; oltre tale cronologia, l’eliminazione è definitiva dall’interfaccia ordinaria.

---

## 13. Stati della lavorazione e avanzamento

### Non ancora iniziato

È lo stato predefinito di una nuova lavorazione. L’avanzamento è pari a zero.

### In corso

Può essere impostato in due modi.

**Clic diretto su In corso**

- imposta lo stato In corso;
- imposta a 0 i giorni produttivi effettuati;
- salva la modifica;
- chiude immediatamente il menu contestuale.

**Sottomenu dei giorni**

Mostra i valori da 1 fino alla durata totale. Il valore corrente è evidenziato. Scegliendo un numero:

- lo stato diventa In corso;
- i giorni processati diventano il valore scelto;
- la barra mostra la corrispondente percentuale di avanzamento.

Esempio: giorno 4 selezionato su una durata di 10 = 4 giorni processati e 40% visivo.

### Terminato

Imposta:

- stato Terminato;
- avanzamento pari alla durata totale;
- data/ora di completamento, usata per archivio e analisi.

### Modifica successiva

Lo stato e i giorni processati possono essere cambiati nuovamente. Il sistema aggiorna indicatori, barra, archivio e analisi sulla base del nuovo valore.

---

## 14. Disponibilità del materiale

Gli stati disponibili sono:

1. **Disponibile** — il materiale è pronto.
2. **Parzialmente disponibile** — è presente solo una parte del fabbisogno.
3. **In arrivo** — il materiale è stato previsto/ordinato ma non è ancora disponibile.
4. **Non disponibile** — il materiale necessario manca.
5. **Da verificare** — la situazione richiede un controllo.

Lo stato può essere modificato:

- dal form di creazione;
- dal form Modifica;
- rapidamente dal sottomenu del tasto destro.

Il cambio rapido produce lo stesso risultato del salvataggio dal form: aggiorna il dato condiviso e chiude il menu.

Lo stato è visibile:

- nella resa cromatica della barra;
- nel popup;
- nei filtri del pianificatore;
- nei filtri, grafici, tabelle ed esportazioni dell’Analisi.

---

## 15. Collegamenti tra lavorazioni

I collegamenti rappresentano una sequenza logica, per esempio una fase che deve precederne un’altra.

### Struttura consentita

Ogni lavorazione può avere:

- un solo collegamento **precedente**;
- un solo collegamento **successivo**.

Può quindi avere entrambi, diventando l’elemento centrale di una catena.

### Vincoli

Non è possibile:

- collegare una lavorazione a se stessa;
- occupare due volte lo stesso lato;
- creare un ciclo;
- collegare come nuova destinazione una lavorazione completata;
- usare una candidata non più compatibile con le regole temporali.

Le candidate ammesse sono lavorazioni ancora da produrre:

- Da pianificare;
- oppure già in calendario ma future;
- non nello stato Terminato.

### Selettore Collega

Il comando **Collega** apre una finestra dedicata. I filtri disponibili sono:

- **Cliente**;
- intervallo della **Prima consegna**;
- intervallo della **Data di produzione**.

La lista mostra soltanto candidati compatibili. Selezionare l’articolo/lotto operativo desiderato e il verso del collegamento.

### Rappresentazione

Il collegamento appare come una linea leggera tratteggiata tra i punti di attacco.

Se l’altro articolo è fuori dall’intervallo visibile:

- la linea non scompare;
- prosegue verso il bordo corretto del Gantt;
- comunica chiaramente che esiste una relazione fuori vista.

### Navigazione tramite punti di attacco

Facendo clic sul punto iniziale o finale:

- il calendario raggiunge la lavorazione precedente o successiva;
- porta il relativo periodo in vista;
- scorre fino alla macchina interessata.

### Scollegamento

Usare **Scollega** dal menu contestuale o il comando disponibile nel selettore. La rimozione del rapporto aggiorna entrambi gli articoli e scompare per tutti gli utenti dopo la sincronizzazione.

---

## 16. Gestione delle macchine

Premere **Macchine** nella barra superiore.

### Dati di una macchina

Ogni macchina possiede:

- nome;
- reparto;
- categoria;
- colore;
- posizione nell’ordinamento condiviso.

### Aggiungere una macchina

Compilare:

1. Nome macchina;
2. Reparto;
3. Categoria;
4. premere **Aggiungi**.

La nuova macchina diventa disponibile nel form delle lavorazioni, nei filtri, nel Gantt e nell’Analisi.

### Modificare

Le informazioni possono essere modificate dalla relativa riga. Cambiando reparto o categoria può cambiare anche il colore associato al gruppo.

### Rimuovere

La rimozione richiede conferma. Le lavorazioni assegnate non vengono eliminate: tornano **Da pianificare**.

### Colori automatici

I colori seguono la coppia:

`Reparto + Categoria`

- stesso reparto e stessa categoria = stesso colore;
- reparto diverso = colore diverso;
- categoria diversa = colore diverso;
- entrambi diversi = colore diverso.

La logica viene applicata anche alle macchine già esistenti e mantiene coerenza visiva tra anagrafica, selettori e Gantt.

### Riordinamento condiviso

Usare la maniglia della riga:

1. premere e mantenere;
2. trascinare la macchina verso l’alto o il basso;
3. rilasciare nella nuova posizione.

L’ordine:

- viene salvato centralmente;
- si riflette nel Gantt;
- è uguale per tutti gli utenti;
- non è una preferenza personale.

### Scorrimento automatico durante il riordino

Avvicinando la macchina trascinata al bordo superiore o inferiore della lista, il pannello scorre automaticamente continuando a mantenere l’elemento selezionato.

La velocità aumenta avvicinandosi al bordo. Questo consente di spostare una macchina anche attraverso elenchi di 80–90 elementi senza rilasciarla.

---

## 17. Fermi macchina

Il pannello **Fermi macchina** serve per indisponibilità riferite a **una sola macchina**.

### Tipi

- **Guasto**;
- **Manutenzione**.

### Campi

- macchina;
- tipo;
- data Dal;
- data Al;
- descrizione opzionale.

### Aggiunta

Premere **Aggiungi indisponibilità**. Il periodo viene rappresentato sulla riga della macchina e influisce sul calcolo delle lavorazioni che lo attraversano.

### Modifica del periodo

Fare clic con il tasto destro:

- sul blocco nel Gantt;
- oppure sulla voce nel pannello.

Si apre il form **Modifica periodo**, dal quale cambiare Dal e Al. La modifica riguarda soltanto quel guasto o quella manutenzione e quella macchina.

### Eliminazione

La rimozione richiede conferma. Dopo l’eliminazione, le durate visive interessate vengono ricalcolate in base alle indisponibilità rimaste.

---

## 18. Chiusure e ferie

Il pannello **Chiusure / Ferie** gestisce regole applicabili a un insieme di risorse.

### Tipi

- **Chiusura**;
- **Ferie**.

### Campi

- tipo;
- data Dal;
- data Al;
- descrizione opzionale;
- destinatari.

### Destinatari

È possibile applicare la regola:

- a **Tutta l’azienda**;
- a uno o più reparti;
- a una o più macchine;
- a una combinazione di reparti e macchine.

La selezione di un reparto comprende le relative macchine. L’interfaccia mostra quante macchine saranno coinvolte.

### Aggiunta

Premere **Applica chiusura / ferie**. Il sistema crea un unico gruppo logico condiviso sulle risorse scelte.

### Modifica

Fare clic con il tasto destro sulla chiusura/ferie nel Gantt o nella lista. La modifica del periodo viene applicata a **tutte le macchine e a tutti i reparti appartenenti a quella specifica regola**.

### Eliminazione

L’eliminazione rimuove l’intero gruppo, non soltanto il blocco visivo della riga su cui è stato aperto il menu.

---

## 19. Fine settimana, indisponibilità e calcolo delle durate

### Giorni produttivi

La durata inserita rappresenta giorni di produzione effettivi. Nel calcolo iniziale non vengono consumati:

- sabati;
- domeniche;
- giorni di fermo macchina;
- chiusure;
- ferie applicate alla macchina.

### Esempio senza indisponibilità

Una lavorazione di 3 giorni che viene collocata di domenica viene pianificata sui primi tre giorni feriali utili, invece di terminare la domenica.

### Sovrapposizione con un’indisponibilità

Se una lavorazione già pianificata attraversa ferie, chiusure, guasti o manutenzioni, quei giorni vengono mostrati come indisponibili e la fine viene spinta in avanti quanto necessario per mantenere il numero di giorni produttivi.

In altre parole, la barra va **oltre** l’indisponibilità.

### Inserimento di un’indisponibilità in una pianificazione esistente

L’aggiunta di un nuovo giorno non lavorabile si comporta come l’inserimento di tempo nel calendario della macchina:

- una lavorazione che termina prima del fermo non cambia;
- una lavorazione che attraversa il fermo mantiene l’inizio e si allunga per recuperare i giorni produttivi persi;
- una lavorazione pianificata dopo il fermo slitta in avanti dello stesso numero di giornate produttive appena bloccate;
- tutte le successive lavorazioni aperte della macchina subiscono lo stesso scorrimento;
- sabati, domeniche e giorni già indisponibili non vengono conteggiati due volte;
- le lavorazioni già Terminate restano storiche e non vengono riscritte.

Esempio: aggiungendo una manutenzione di un giorno il 25, una lavorazione aperta prevista dal 27 viene spostata al 28. Se invece la manutenzione cade durante una lavorazione già iniziata nel calendario, la sua fine avanza di un giorno e anche le lavorazioni successive scorrono in avanti.

La stessa regola viene applicata a guasti, manutenzioni, chiusure e ferie. Se una nuova regola si sovrappone a un’indisponibilità già esistente, producono scorrimento soltanto i giorni realmente nuovi.

### Modifica manuale

L’operatore può comunque accorciare o allungare manualmente la lavorazione con le maniglie. Il sistema non cambia arbitrariamente la durata durante un normale spostamento.

### Celle del fine settimana

Sabato e domenica sono riconoscibili sia nell’intestazione sia nell’intera colonna grazie a una colorazione leggera uniforme.

---

## 20. Archivio automatico

Una lavorazione viene nascosta dalla vista standard quando:

- è nello stato **Terminato**;
- ha raggiunto il 100% dell’avanzamento;
- la data di completamento è precedente di oltre un mese.

### Comportamento predefinito

**Mostra archivio** è disattivato, quindi gli elementi storici non appesantiscono la consultazione quotidiana.

### Visualizzare lo storico

Attivare **Mostra archivio**. I filtri continuano a essere applicati anche agli elementi archiviati.

### Cosa non fa l’archivio

- non cancella dati;
- non rimuove le lavorazioni dalle analisi;
- non impedisce l’esportazione;
- non modifica lo stato;
- non è equivalente al comando Elimina.

---

## 21. Finestra Analisi produzione

Premere **Analisi** nella barra del pianificatore. Si apre una finestra indipendente dedicata a statistiche e reporting.

### Pulsanti superiori

| Pulsante | Funzione |
|---|---|
| **Aggiorna** | Scarica immediatamente i dati più recenti. |
| **Esporta Excel** | Crea un file `.xlsx` con filtri, riepiloghi, dettagli e analisi personalizzate. |
| **Chiudi** | Chiude soltanto la finestra Analisi. |

### Aggiornamento in tempo reale

Anche l’Analisi ascolta gli eventi del pianificatore. Quando cambiano i dati, programma un aggiornamento rapido senza obbligare l’operatore a riaprire la finestra.

### Impostazione iniziale

Per impostazione predefinita:

- viene considerato **tutto lo storico**;
- nessuna macchina, categoria o reparto selezionato equivale a **tutti**;
- nessuno stato selezionato equivale a **tutti gli stati**;
- la granularità temporale è **Mese**.

---

## 22. Filtri dell’Analisi

Premere **Applica filtri** per aggiornare KPI, grafici, tabelle e contenuto esportabile.

Premere **Ripristina** per tornare a:

- tutto lo storico;
- nessuna limitazione di reparto, categoria o macchina;
- tutti gli stati;
- tutte le unità;
- granularità mensile.

### Periodo rapido

Opzioni:

- Tutto lo storico;
- Mese corrente;
- Ultimi 3 mesi;
- Ultimi 6 mesi;
- Ultimi 12 mesi;
- Anno corrente;
- Personalizzato.

### Intervallo Produzione

Filtra le lavorazioni il cui periodo produttivo si sovrappone all’intervallo Da–A.

### Intervallo Prima consegna

Filtra in base alla data di prima consegna.

### Intervallo Completamento

Filtra in base alla data effettiva registrata per le lavorazioni terminate.

### Codice articolo esatto

Richiede corrispondenza esatta. `400` non include `T400`.

### Cliente esatto

Richiede la corrispondenza esatta del cliente.

### Stato lavorazione

- Tutti gli stati;
- Non ancora iniziato;
- In corso;
- Terminato.

### Stato materiale

- Tutti gli stati;
- Disponibile;
- Parzialmente disponibile;
- In arrivo;
- Non disponibile;
- Da verificare.

### Unità

- Tutte;
- Pezzi;
- Kg.

### Granularità temporale

Definisce il raggruppamento dei grafici e delle tabelle per periodo:

- Giorno;
- Settimana;
- Mese;
- Trimestre;
- Anno.

### Filtro unificato Risorse produttive

Un unico componente gestisce contemporaneamente reparti, categorie e macchine.

Contiene:

- ricerca per macchina, reparto o categoria;
- pulsanti per i reparti;
- pulsanti per le categorie;
- elenco a schede delle macchine;
- riepilogo della selezione;
- pulsante **Mostra tutto**.

#### Uso

1. Selezionare uno o più reparti e/o categorie per restringere le macchine proposte.
2. Usare la ricerca se necessario.
3. Fare clic su una macchina per selezionarla.
4. Fare nuovamente clic sulla stessa macchina per deselezionarla.

Non è necessario usare `Ctrl` per selezioni multiple.

#### Regola “nessuna selezione”

- nessun reparto = tutti i reparti;
- nessuna categoria = tutte le categorie;
- nessuna macchina = tutte le macchine compatibili.

Deselezionando l’ultima macchina si torna quindi a mostrare tutte le macchine del perimetro corrente.

#### Stabilità dell’elenco

Selezionare o deselezionare una macchina non ricostruisce inutilmente l’elenco e non riporta la barra di scorrimento in cima. La posizione di consultazione viene mantenuta.

#### Mostra tutto

Rimuove selezioni e ricerca del componente Risorse produttive e ripristina tutte le risorse.

### Solo produzioni completate

Esclude lavorazioni aperte e pianificate, mantenendo soltanto quelle nello stato Terminato.

### Riepilogo filtri attivi

Sotto i controlli viene mostrato un riepilogo testuale del perimetro applicato. Se non esistono limitazioni, compare l’indicazione di tutto lo storico disponibile.

---

## 23. Indicatori dell’Analisi e formule

Tutti gli indicatori sono calcolati esclusivamente sulle righe che rispettano i filtri applicati.

### Lavorazioni

Numero totale delle lavorazioni filtrate. La nota indica quante sono completate.

### Articoli distinti

Numero di codici articolo differenti, confrontati senza distinguere maiuscole e minuscole.

### Pezzi prodotti

È una **stima basata sull’avanzamento**, non una rilevazione automatica di contapezzi.

Per ogni lavorazione in pezzi:

`pezzi stimati prodotti = quantità pianificata × avanzamento`

Esempio: 1.000 pezzi, 4 giorni su 10 = stima di 400 pezzi.

Una lavorazione Terminata vale sempre 100%.

### Kg prodotti

Usa la stessa logica, ma soltanto per lavorazioni con unità `kg`:

`kg stimati prodotti = kg pianificati × avanzamento`

Il campo testuale **Kg/Fasci di barra** è informativo e non sostituisce la quantità numerica con unità kg.

### Puntualità

Sono ammissibili al calcolo soltanto le lavorazioni:

- terminate;
- con una Prima consegna valida;
- con una data di completamento valida.

Formula:

`puntualità % = completate entro la Prima consegna / completate valutabili × 100`

Se non esistono lavorazioni valutabili, il valore viene mostrato come non disponibile.

### Completamento medio

Per ogni lavorazione:

`avanzamento = giorni processati / durata`

Il valore è limitato tra 0% e 100%; Terminato vale 100%. Il KPI è la media degli avanzamenti di tutte le lavorazioni filtrate.

### Durata media

Media aritmetica dei giorni di durata registrati nelle lavorazioni filtrate.

### Macchine coinvolte

Numero di macchine distinte presenti nei risultati. Le lavorazioni Da pianificare non aggiungono una macchina al conteggio.

### Reparti coinvolti

Numero di reparti distinti associati ai risultati.

### Data di completamento usata

Per una lavorazione Terminata viene utilizzata:

1. la data `completedAt`, se disponibile;
2. altrimenti la fine pianificata della barra.

---

## 24. Grafici standard

### Produzione nel tempo

Grafico a linea con:

- pezzi prodotti stimati;
- kg prodotti stimati;
- raggruppamento secondo la granularità temporale scelta.

### Quantità per macchina

Grafico a barre orizzontali con le principali macchine ordinate per pezzi prodotti stimati. La vista grafica mostra fino alle prime 15.

### Reparti

Confronta per reparto:

- numero di lavorazioni;
- numero di articoli distinti.

### Stato lavorazioni

Grafico ad anello suddiviso tra:

- Non ancora iniziato;
- In corso;
- Terminato.

### Puntualità per reparto

Grafico percentuale per reparto. La colorazione facilita la lettura:

- verde da 90% in su;
- ambra da 70% a meno di 90%;
- rosso sotto 70%.

I reparti senza casi valutabili non producono una percentuale significativa.

---

## 25. Analisi personalizzate

La sezione **Crea le viste degli operatori** consente di aggiungere analisi senza modificare il programma.

### Dimensioni disponibili

È possibile raggruppare per:

- Macchina;
- Reparto;
- Categoria macchina;
- Articolo;
- Cliente;
- Stato materiale;
- Stato lavorazione;
- Periodo.

### Metriche disponibili

- Numero lavorazioni;
- Articoli distinti;
- Pezzi prodotti;
- Pezzi pianificati;
- Kg prodotti;
- Completamento medio %;
- Puntualità %;
- Durata media.

### Visualizzazioni

- Barre;
- Linea;
- Anello;
- Tabella.

### Creazione

1. scegliere Raggruppa per;
2. scegliere la Metrica;
3. scegliere la Visualizzazione;
4. premere **+ Aggiungi analisi**.

La vista viene aggiunta alla griglia e usa gli stessi filtri globali dell’Analisi.

### Rimozione

Ogni analisi personale possiede un comando di rimozione. La rimozione elimina la configurazione locale, non i dati di produzione.

### Limite visivo

Per mantenere leggibili grafici con molte categorie, una vista personalizzata rappresenta fino ai primi 25 gruppi ordinati secondo la metrica.

### Persistenza

Le configurazioni delle analisi personalizzate vengono salvate nel profilo locale dell’app sulla postazione. Non sono attualmente un’impostazione condivisa tra tutti gli utenti.

I dati mostrati, invece, restano quelli centralizzati e aggiornati del pianificatore.

---

## 26. Tabelle analitiche

Le tabelle sono sezioni espandibili. Possono essere aperte o chiuse senza cambiare i filtri.

### Analisi per macchina

Raggruppa i risultati per singola macchina.

### Analisi per reparto

Raggruppa i risultati per reparto.

### Analisi per articolo

Raggruppa i risultati per codice articolo.

### Analisi temporale

Raggruppa secondo Giorno, Settimana, Mese, Trimestre o Anno.

### Dettaglio lavorazioni filtrate

Mostra le singole lavorazioni che compongono il risultato.

Per preservare le prestazioni dell’interfaccia, la tabella dettagliata a video è limitata alle prime 1.000 righe. L’esportazione Excel include invece l’intero insieme filtrato.

### Colonne aggregate

Le tabelle di riepilogo possono includere:

- gruppo;
- numero lavorazioni;
- articoli distinti;
- pezzi prodotti stimati;
- kg prodotti stimati;
- completamento medio;
- puntualità;
- durata media.

---

## 27. Esportazione in Excel

Premere **Esporta Excel**.

### Regole

- vengono esportati i dati dei filtri attualmente applicati;
- se non esistono risultati, il file non viene generato;
- viene aperta la scelta del percorso;
- il nome proposto segue il formato `analisi_produzione_AAAA-MM-GG.xlsx`.

### Fogli generati

Il file può contenere:

1. **Riepilogo**;
2. **Per macchina**;
3. **Per reparto**;
4. **Per categoria**;
5. **Per articolo**;
6. **Per cliente**;
7. **Per materiale**;
8. **Per stato**;
9. **Per periodo**;
10. **Dettaglio**;
11. **Filtri**;
12. un foglio per ciascuna **Analisi personalizzata**.

### Contenuto del Dettaglio

Comprende le informazioni disponibili delle lavorazioni, tra cui:

- articolo;
- cliente;
- fase;
- materiale/lega;
- macchina, reparto e categoria;
- quantità e unità;
- Kg/Fasci di barra;
- proprietario barra/materiale;
- inizio, fine e durata;
- prima consegna e quantità;
- consegna finale opzionale;
- stato materiale;
- stato lavorazione;
- avanzamento;
- priorità;
- note;
- dati di completamento.

### Usabilità del file

I fogli sono predisposti con:

- intestazioni;
- filtri automatici;
- prima riga bloccata;
- larghezze coerenti con il contenuto.

L’Excel è quindi utilizzabile sia come report sia come base per ulteriori elaborazioni esterne.

---

## 28. Procedure operative consigliate

### Inserire una lavorazione già assegnata

1. Premere **+ Nuova lavorazione**.
2. Compilare articolo e cliente.
3. Compilare le informazioni tecniche disponibili.
4. Scegliere macchina e data iniziale.
5. Inserire la durata in giorni lavorativi.
6. Indicare Prima consegna se deve essere monitorata la puntualità.
7. Impostare materiale e stato.
8. Salvare e confermare.

### Inserire una lavorazione ancora senza macchina

1. Creare la lavorazione.
2. Lasciare Macchina su **Da pianificare**.
3. Inserire la durata.
4. Salvare.
5. In seguito trascinare la scheda dal pannello Articoli sul Gantt.

### Aggiornare l’avanzamento giornaliero

1. Fare clic destro sulla barra.
2. Aprire **Lavorazione → In corso**.
3. Scegliere i giorni processati.
4. Verificare il riempimento della barra.

Se la lavorazione è appena avviata, fare clic direttamente su In corso per registrare zero giorni effettuati.

### Segnalare un materiale parziale

1. Fare clic destro.
2. Aprire **Disponibilità materiale**.
3. Selezionare **Parzialmente disponibile**.

### Gestire un guasto

1. Aprire **Fermi macchina**.
2. Scegliere macchina e tipo Guasto.
3. Inserire intervallo e descrizione.
4. Salvare.
5. Controllare l’estensione delle lavorazioni che attraversano il periodo.

### Gestire ferie di un reparto

1. Aprire **Chiusure / Ferie**.
2. Scegliere Ferie.
3. Inserire l’intervallo.
4. Selezionare il reparto.
5. Controllare il numero di macchine coinvolte.
6. Applicare.

### Cercare rapidamente un articolo

1. Iniziare a digitare il codice nel filtro Articolo: il `%` finale implicito mostra subito i codici con lo stesso inizio.
2. Se necessario, usare `%` all’inizio per cercare il testo in qualsiasi posizione.
3. Aggiungere `|` quando la parte finale deve essere esatta.
4. Aprire **Lista filtrata**.
5. Fare clic sul risultato per raggiungerlo.

Esempi:

- `T` mostra tutti i codici che iniziano per T;
- `%1144` mostra tutti i codici che contengono 1144;
- `T%50|` mostra i codici che iniziano per T e terminano per 50;
- `1144|` cerca esclusivamente il codice 1144.

### Preparare un report mensile

1. Aprire Analisi.
2. Scegliere Mese corrente o un intervallo personalizzato.
3. Impostare granularità Giorno o Settimana.
4. Se necessario selezionare risorse e Solo produzioni completate.
5. Applicare i filtri.
6. Controllare KPI e grafici.
7. Esportare in Excel.

---

## 29. Conferme, errori e protezione dei dati

### Operazioni che richiedono conferma

Tra le operazioni protette rientrano:

- salvataggio di una modifica;
- annullamento con dati in modifica;
- eliminazione di una lavorazione;
- rimozione di una macchina;
- rimozione di un fermo;
- rimozione di una chiusura/ferie;
- scollegamento, quando previsto.

### Eliminazione e archivio

- **Elimina** rimuove la lavorazione, con possibilità di usare immediatamente Annulla finché il passaggio è ancora nella cronologia locale.
- **Archivio** nasconde automaticamente ma conserva.

Prima di eliminare una lavorazione storica, verificare se sia sufficiente impostarla Terminata e lasciarla archiviare.

### Annulla non è un backup

La cronologia dei 40 passaggi è pensata per correggere rapidamente un errore operativo. Può essere azzerata da un riallineamento completo con il backend e non deve essere considerata un archivio permanente delle versioni.

### Validazione

Il salvataggio viene impedito se:

- mancano i campi obbligatori;
- la durata è inferiore a 1;
- un intervallo termina prima di iniziare;
- la macchina o il collegamento non sono più validi;
- la revisione dei dati è stata superata da una modifica altrui.

---

## 30. Prestazioni con molti dati

Il modulo è progettato per conservare lo storico senza cancellarlo. Per alleggerire il lavoro quotidiano:

- gli elementi completati da oltre un mese sono nascosti di default;
- le righe macchina senza risultati filtrati scompaiono;
- la vista mostra soltanto 7, 14 o 28 giorni alla volta;
- i grafici limitano il numero di gruppi rappresentati;
- il dettaglio analitico a schermo si ferma a 1.000 righe;
- l’elenco macchine dell’Analisi mantiene scroll e focus durante le selezioni;
- l’Excel può contenere tutti i risultati senza obbligare il browser grafico a renderli simultaneamente.

Con migliaia di articoli è consigliato:

1. lasciare disattivato Mostra archivio durante la pianificazione;
2. usare ricerche articolo mirate, aggiungendo `|` quando serve una corrispondenza esatta;
3. scegliere il minor intervallo visivo sufficiente;
4. usare la Lista filtrata per saltare direttamente al risultato;
5. svolgere le consultazioni storiche estese nella finestra Analisi.

---

## 31. Risoluzione dei problemi

### Non compaiono dati

1. Controllare l’indicatore di sincronizzazione.
2. Premere **Aggiorna**.
3. Verificare i filtri attivi.
4. Premere Mostra tutto o Ripristina nella finestra interessata.
5. Verificare che il backend sia raggiungibile.

### Una lavorazione terminata non si vede

Potrebbe essere archiviata. Attivare **Mostra archivio** e cercare il codice con il terminatore `|` se è necessaria una corrispondenza esatta, per esempio `1144|`.

### Se tolgo l’ultima macchina nell’Analisi compare tutto

È il comportamento previsto: nessuna macchina selezionata significa **tutte le macchine**.

### La barra è più lunga dei giorni inseriti

Controllare:

- fine settimana;
- guasti;
- manutenzioni;
- ferie;
- chiusure.

La durata esprime giorni produttivi, mentre la barra comprende anche i giorni di calendario attraversati.

### La barra prosegue fuori dallo schermo

L’indicatore sul bordo segnala che la lavorazione continua oltre il periodo visibile. Navigare con le frecce o trascinare le intestazioni.

### La linea di collegamento termina sul bordo

Il secondo articolo è fuori vista. Fare clic sul punto di attacco per raggiungerlo.

### Il form non accetta input

Il modulo usa finestre dedicate e conferme native per preservare il focus. Se la finestra ha perso il focus per un passaggio di sistema:

1. fare clic sulla barra del titolo della finestra;
2. tornare nel campo;
3. se necessario chiudere e riaprire il form, senza chiudere il pianificatore.

Se il problema continua, annotare quale form e quale operazione lo precedono per consentire una verifica mirata.

### Il tempo reale non aggiorna

1. Premere Aggiorna.
2. Controllare che il backend risponda.
3. Verificare che la porta del backend sia raggiungibile.
4. Osservare se la barra passa automaticamente da Offline/Riconnessione a Sincronizzato.
5. Verificare nei log la presenza di “Connessione WebSocket aperta” oppure di un messaggio di watchdog, handshake o riconnessione automatica.

Il WebSocket usa la porta del backend e il percorso `/ws`.

Il watchdog può impiegare fino a circa 70 secondi per riconoscere una connessione apparentemente aperta ma completamente inattiva. Nel frattempo il controllo HTTP periodico continua a verificare gli aggiornamenti del pianificatore.

### Lettura dei log

Il Backend Logger privilegia una vista compatta: ogni operazione viene presentata come azione con relativo esito, evitando di mostrare come eventi principali tutti i passaggi tecnici intermedi. Identificativi richiesta, metodo, URL e altri dettagli restano disponibili quando servono per la diagnosi.

Per una segnalazione utile annotare:

- data e ora approssimativa;
- postazione e utente;
- modulo Pianificazione Produzione;
- azione eseguita;
- esito o messaggio mostrato;
- eventuale stato Realtime/Offline indicato nella barra.

### Dati cambiati mentre stavo lavorando

Un altro utente potrebbe aver salvato una revisione più recente. Ricaricare i dati, verificare la modifica ricevuta e ripetere la propria operazione sullo stato aggiornato.

---

## 32. Glossario

**Articolo**  
Codice esatto del prodotto o semilavorato.

**Lavorazione**  
Unità pianificata nel Gantt. Può rappresentare un articolo, una fase o un ordine operativo.

**Da pianificare**  
Lavorazione senza macchina e senza inizio previsto utilizzabile.

**Durata produzione**  
Numero di giorni lavorativi necessari, non semplice differenza tra due date.

**Prima consegna**  
Data principale usata per ritardo e puntualità.

**Consegna finale**  
Informazione opzionale; non guida l’indicatore In ritardo.

**Giorni processati**  
Parte della durata già eseguita, usata per il riempimento della barra e le stime analitiche.

**Fermo macchina**  
Guasto o manutenzione di una singola macchina.

**Chiusura/Ferie**  
Indisponibilità applicabile a tutta l’azienda, a reparti o a più macchine.

**Categoria macchina**  
Classificazione trasversale al reparto, usata per colori, ricerca, filtri e analisi.

**Archivio**  
Vista nascosta delle lavorazioni terminate al 100% da oltre un mese. Non comporta eliminazione.

**Collegamento precedente/successivo**  
Relazione direzionale tra due lavorazioni ancora da produrre.

**Puntualità**  
Percentuale delle lavorazioni terminate entro la Prima consegna tra quelle effettivamente valutabili.

**Produzione stimata**  
Quantità pianificata moltiplicata per la percentuale di avanzamento; non è una misurazione automatica della macchina.

**Revisione**  
Numero usato dal backend per proteggere i dati da salvataggi concorrenti obsoleti.

**WebSocket**  
Canale con cui le finestre ricevono in tempo reale le modifiche salvate dagli altri operatori.

**Watchdog realtime**

Controllo del client che riconosce handshake incompleti, socket inattivi o errori di connessione e forza una riconnessione automatica.

**Wildcard**

Simbolo usato nella ricerca articolo per descrivere un modello invece di un singolo codice; per esempio `%`, `_`, `[]` o `|`.

**Terminatore `|`**

Simbolo che impone la fine esatta del modello articolo nel punto in cui viene scritto.

**Annulla / Ctrl+Z**

Ripristino di uno stato precedente mediante la cronologia locale, fino a 40 passaggi.

---

## Nota di manutenzione tecnica

Il supporto legacy mantenuto per client precedenti è previsto come temporaneo. In occasione del prossimo aggiornamento maggiore, indicativamente **1.3.3**, dovrà essere rivalutato e, dopo l’aggiornamento di tutte le postazioni, rimosso.
