# Standard UI dei moduli di analisi AyPi

Riferimento: **AyPi · Analisi produzione Torneria**. Ricognizione del codice: 11 novembre 2026.

Questo documento conserva le scelte di interfaccia da riutilizzare quando si creano o aggiornano i moduli AyPi. Va letto insieme ad [AGENTS.md](AGENTS.md). Le richieste successive dell’utente prevalgono e, quando introducono una convenzione comune, devono aggiornare entrambi i riferimenti pertinenti.

Le sezioni «Torneria attuale» descrivono il codice esaminato. Le sezioni «Regole comuni» comprendono anche le preferenze consolidate nelle analisi commerciali. Una regola comune non implica che ogni modulo storico sia già stato adeguato.

## 1. Principio di continuità

Un’azione già presente deve mantenere icona, etichetta, dimensioni, posizione e comportamento riconoscibili. Prima di aggiungere CSS o controlli, cercare il componente condiviso e il comportamento corrispondente in Torneria.

L’interfaccia serve a esplorare dati: filtri e KPI devono lasciare la maggior parte dell’altezza a grafici e tabelle. Evitare testi promozionali, grandi introduzioni e spiegazioni tecniche ripetute. Metadati della fonte e dettagli di calcolo appartengono alla vista dedicata.

## 2. Mappa delle sorgenti da consultare

| Ambito | Riferimento nel repository |
| --- | --- |
| Struttura e dialoghi Torneria | [turning-analysis.html](src/renderer/pages/turning-analysis.html) |
| Rendering, selezioni e interazioni | [turning-analysis.ts](src/renderer/scripts/turning-analysis.ts) |
| Layout, pannelli, focus, editor | [turning-analysis.css](src/renderer/styles/turning-analysis.css) |
| Colori e controlli operativi comuni | [aypi-operations-ui.css](src/renderer/styles/utilities/aypi-operations-ui.css) |
| Marchio AyPi | [aypi-module-brand.css](src/renderer/styles/utilities/aypi-module-brand.css) |
| Tema iniziale della finestra | [utility-layout-bootstrap.js](src/renderer/scripts/utility-layout-bootstrap.js) |
| Toolbar grafico condivisa | [analysis-chart-controls.ts](src/renderer/modules/analysis-chart-controls.ts) |
| Evidenziazione selezioni riutilizzabile | [analysis-selection-highlight.ts](src/renderer/modules/analysis-selection-highlight.ts) |
| Etichette e tacche degli assi | [chart-axis.ts](src/renderer/modules/chart-axis.ts) |
| Grafico spaziale interattivo | [turning-scatter3d.ts](src/renderer/modules/turning-scatter3d.ts) |
| Preferenze, limiti e validazione grafici Torneria | [chart-presets.ts](src/main/modules/turning-analysis/chart-presets.ts) |
| Calcolo cumulativi | [chart-values.ts](src/main/modules/turning-analysis/chart-values.ts) |
| Modello e aggregazioni Torneria | [model.ts](src/main/modules/turning-analysis/model.ts) |
| Finestre, lettura, salvataggi ed export | [ipc.ts](src/main/modules/turning-analysis/ipc.ts) |
| Ordinamento condiviso | [table-sorting.ts](src/renderer/modules/table-sorting.ts), [analysis-sorting.ts](src/main/modules/analysis-sorting.ts) |
| Divisori e tabelle collegate | [table-sorting.css](src/renderer/styles/table-sorting.css) |
| Navigazione fra moduli | [analysis-navigation.ts](src/main/modules/analysis-navigation.ts), [analysis-navigation-model.ts](src/main/modules/analysis-navigation-model.ts) |
| Menu contestuali e documenti collegati | [analysis-links.ts](src/renderer/modules/analysis-links.ts), [document-links.ts](src/renderer/modules/document-links.ts) |
| Applicazione delle regole ai documenti commerciali | [customer-analysis.ts](src/renderer/scripts/customer-analysis.ts), [customer-analysis.css](src/renderer/styles/customer-analysis.css) |

Le funzioni interne del renderer Torneria sono riferimenti di comportamento; non sono tutte componenti già esportate. Riutilizzare i moduli condivisi disponibili. Per una nuova estrazione, mantenere il comportamento delle schermate che già li usano.

## 3. Finestra e struttura della pagina

### Torneria attuale

- Finestra Electron iniziale 1520 × 960; minimo 1000 × 680; apertura massimizzata e riuso della finestra esistente.
- `body.aypi-operations.turning-window`, testata `.topbar`, area `main`, navigazione, filtri condivisi, stato, KPI e contenuto.
- Testata: logo AyPi, soprattitolo piccolo, titolo del modulo e azioni sulla destra.
- Azioni: **Grafici**, **Vista ampia / Vista compatta**, **Capacità macchine**, **Esporta Excel**, **Aggiorna dati**, **Chiudi**.
- Sezioni: Dashboard, Confronti, Macchine, Clienti, Articoli e registrazioni, Rendimenti, Simulatore, Origine e verifiche.
- Scheda attiva riconoscibile tramite testo e indicatore inferiore nel colore di accento.

### Regole comuni

Riprendere questa gerarchia, adattando solo sezioni e azioni proprie del dominio. Mantenere le azioni globali nella testata e quelle del singolo grafico nel suo pannello. Impostare esplicitamente dimensioni minime e comportamento di apertura.

## 4. Colori, caratteri e geometrie

Usare le variabili `--ops-*` del foglio operativo condiviso. Il tema è applicato nel `<head>` dal bootstrap, prima del rendering.

| Token | Blue Archive | Standard |
| --- | --- | --- |
| `--ops-accent` | `#168eea` | `#cc930e` |
| `--ops-accent-2` | `#31c8f3` | `#e5b33e` |
| `--ops-ink` | `#173451` | `#332f2b` |
| `--ops-muted` | `#648097` | `#827760` |
| `--ops-line` | `#d9e8f1` | `#e8dfce` |
| `--ops-soft` | `#e8f8ff` | `#fff6e2` |
| `--ops-bg` | `#f2f8fc` | `#f7f4ed` |

- Font operativo: Segoe UI, Yu Gothic UI, sans-serif. I grafici ereditano il font calcolato della pagina.
- Titoli scuri, testi secondari attenuati, fondi chiari, bordi sottili e angoli coerenti con i pannelli esistenti.
- Il colore di accento del tema identifica l’anno più recente; gli anni precedenti usano la palette di confronto del renderer.
- Non assegnare un significato favorevole/sfavorevole basandosi solo sul segno: una quota di attrezzaggio crescente ha interpretazione diversa da un ricavo crescente.
- Evitare nuove palette locali per rappresentare la stessa azione o misura già disponibile.

## 5. Filtri e contesto

### Torneria attuale

- Selezione di uno o più esercizi, scorciatoie Ultimi 2 / Ultimi 4 / Tutti, intervallo di mesi da–a.
- Picker Macchine, Clienti e Articoli con ricerca, checkbox, riepilogo e azzeramento della dimensione.
- Altri filtri raccoglie ricerca libera e intervalli numerici per resa, prezzo e quantità.
- Chip rimovibili per le selezioni; visualizzazione compatta dei primi valori e riepilogo dei successivi.
- Annullamento dell’ultima selezione con cronologia fino a 30 stati; Ripristina per il ripristino generale.
- Nelle viste raggruppate: confronto fra anni selezionati oppure analisi di un singolo anno.

### Regole comuni

Conservare un unico stato condiviso per aggiornare coerentemente grafici, indicatori e tabelle. Validare gli intervalli, mostrare errori vicino al contesto interessato e mantenere la selezione utilizzabile.

Separare concettualmente il contesto manuale dalle selezioni prodotte dai grafici. Un reset del grafico deve rimuovere le selezioni interattive conservando i filtri manuali. Il ripristino generale è un’azione distinta.

**Dettaglio del codice Torneria da considerare negli aggiornamenti:** `resetChartSelections()` attualmente svuota le dimensioni Macchine/Clienti/Articoli condivise anche con i picker e ripristina il precedente intervallo mensile quando esiste `chartMonthContext`. Non copiarlo assumendo che distingua già la provenienza manuale o grafica. L’analisi cliente usa uno stato di selezione grafica separato.

## 6. KPI

Torneria presenta sei indicatori: ricavo valorizzato, ore di impegno macchina, pezzi lavorati per fase, resa complessiva, registrazioni e quota attrezzaggio.

- Etichetta piccola, valore principale leggibile e confronto con il periodo pertinente.
- Formato compatto quando necessario; valore preciso consultabile nel titolo/tooltip.
- Dati mancanti mostrati come `—`; un rapporto senza base valida non deve diventare infinito o una percentuale inventata.
- Le quantità sommate per registrazione/fase non equivalgono automaticamente a pezzi finiti distinti.
- Tenere l’area compatta. Non trasformare ogni KPI in una grande scheda esplicativa.

## 7. Pannello grafico e toolbar

Struttura di riferimento: `.panel.chart-panel` → `.panel-head` con titolo/sottotitolo e `.panel-actions` → `.chart` → `.chart-viewport` → `canvas`.

Il contenitore del canvas deve poter ridursi (`min-width: 0`, `min-height: 0`) e seguire lo spazio disponibile. Evitare dimensioni intrinseche del canvas che allarghino la griglia.

Usare **`analysisChartControls()`** e **`setChartExpanded()`**:

| Azione | Controllo condiviso | Comportamento |
| --- | --- | --- |
| Mensile / Cumulativo | `data-cumulative`, etichetta con `⇄` | Alterna il tipo di andamento quando pertinente |
| Reset | `.chart-icon`, `data-reset-chart`, `↺` | Azzera il contesto interattivo del grafico secondo le regole comuni |
| Espandi / Riduci | `.chart-icon`, `data-expand-chart`, `⤢` / `⤡` | Apre/chiude il focus del grafico |

Dimensioni di riferimento delle icone: 27 × 27 px, carattere 17 px, fondo trasparente, colore attenuato. Il CSS attuale prevede adattamenti sotto 1250 px; riutilizzarli senza inventare varianti per ogni schermata.

La modifica dei grafici appartiene al menu **Grafici**. Non aggiungere un pulsante «Modifica» a ogni intestazione. Tutti i controlli devono avere etichette accessibili, tooltip e stato premuto dove pertinente.

## 8. Grafici collegati e selezioni

Il comportamento visivo di riferimento è quello della Torneria:

1. Un clic seleziona una voce; un secondo clic sull’unica voce selezionata la deseleziona.
2. Ctrl/Cmd + clic aggiunge o rimuove una voce dalla selezione multipla.
3. La selezione si propaga a KPI, tabelle e altri grafici, mantenendo il contesto temporale coerente.
4. I totali rimangono leggibili sullo sfondo e la quota selezionata viene evidenziata con il colore pieno.
5. Cambiare selezione non deve far scomparire tutte le categorie di confronto.

Torneria distingue righe di contesto (`chartRows`) e righe filtrate (`scopeRows`). Le selezioni dimensionali evidenziano una quota dei totali. Le selezioni temporali hanno un contesto dedicato. I grafici usano evidenziazioni per barre e anelli; nelle animazioni di selezione è presente una transizione di circa 420 ms e viene considerata la preferenza di movimento ridotto.

Per nuovi moduli, il plugin condiviso `analysis-selection-highlight.ts`, già usato dall’analisi cliente, è il riferimento riutilizzabile per evidenziare barre/anelli. Non presumere che sia già il motore delle animazioni interne della Torneria.

Regole di calcolo e rappresentazione:

- AND fra dimensioni selezionate diverse; OR fra più valori della medesima dimensione.
- Distinguere totale e selezione nei tooltip quando entrambi sono rappresentati.
- Allineare serie selezionate e totali sulle stesse categorie e sullo stesso calendario.
- Nel cumulativo, la somma selezionata deve proseguire nei periodi successivi anche in assenza di nuove righe selezionate.
- Usare anelli per misure additive compatibili; valori negativi richiedono una rappresentazione adeguata, come le barre.
- Usare le unità originali nelle etichette degli assi, anche quando la coordinata è compressa.
- Usare i formatter comuni con locale `it-IT`; conteggi senza decimali arbitrari, valute e rapporti con unità esplicite.

## 9. Focus e massimizzazione del grafico

Il focus di un grafico è diverso dalla massimizzazione della finestra Electron.

- Pannello con classe `.chart-focused`; sfondo `#chartBackdrop`, oscuramento e sfocatura.
- Torneria usa un margine di `4vh 3vw`, pannello fisso e canvas ridimensionato nello spazio disponibile.
- Intestazione più leggibile nel focus; controllo di espansione trasformato in riduzione.
- `role="dialog"`, `aria-modal="true"`, nome accessibile dal titolo.
- Escape chiude il focus; il focus da tastiera torna al pulsante di espansione.
- Tab e Shift+Tab restano nei controlli del pannello espanso.
- Il backdrop permette di uscire; non deve rimanere attivo quando il grafico scompare durante un nuovo rendering.
- Ridimensionare i grafici all’apertura, alla chiusura e quando cambia lo spazio disponibile.

## 10. Vista compatta e vista ampia

**Vista compatta:** sfrutta l’altezza della finestra, distribuisce lo spazio fra grafici e tabelle e mantiene scorrimenti interni nelle aree previste.

**Vista ampia:** `body[data-layout="expanded"]`, scorrimento verticale della pagina, testata sticky, sezioni disposte su una colonna e grafici più alti. Torneria usa per molti pannelli `height: clamp(420px, 70vh, 780px)`.

Il pulsante deve mostrare l’azione disponibile («Vista ampia» oppure «Vista compatta») e aggiornare `aria-pressed`. Il layout della pagina è incluso nelle preferenze grafici Torneria.

Breakpoint attuali da consultare: larghezza 1250/1100 px e altezza 780 px. Sulle finestre basse Torneria compatta testata, filtri e KPI; in alcune viste diverse dalla dashboard nasconde la fascia KPI. Non copiare questa scelta senza verificare l’utilità nel modulo di destinazione.

## 11. Grafici personalizzati, editor e preset

### Torneria attuale

Il menu Grafici contiene visibilità dei grafici, configurazione del grafico spaziale, creazione/modifica dei grafici personalizzati, preset della pagina e salvataggio/ripristino della pagina.

- Tipi personalizzati: barre orizzontali, linee, anello, mappa 3D ruotabile, bolle.
- Dimensioni: macchina, cliente, articolo, mese, anno.
- Indicatori: ricavo, pezzi, ore produzione/attrezzaggio/totali, resa, quota attrezzaggio, registrazioni, ordini distinti, clienti, articoli.
- Scorciatoie: ricavi mensili, ore per macchina, pezzi per articolo, resa per cliente, quota attrezzaggio, mappa 3D e bolle.
- Ambito del grafico: anno KPI oppure tutti gli anni selezionati.
- Per grafici spaziali: assi X/Y/Z, tre misure diverse, opzione di compressione X; le bolle richiedono una grandezza non negativa.
- Limiti Torneria: 8 grafici aggiuntivi e 10 preset per pagina; da 3 a 30 voci; titolo fino a 100 caratteri; nome preset fino a 60.
- Le linee richiedono una dimensione temporale; gli anelli richiedono misure additive ammesse dalla validazione.
- Preferenze versionate (`version: 1`), organizzate per pagina, con validazione anche nel main process.
- I preset Torneria riguardano il layout dei grafici; i filtri dati restano indipendenti. L’analisi cliente ha un proprio modello di preset che include anche filtri/selezioni: non confondere i due formati.

### Regole comuni

Mantenere lo stesso flusso editor/anteprima/salvataggio. I limiti e le misure possono cambiare per dominio, ma vanno dichiarati e validati. Non convertire automaticamente i formati dei preset fra moduli.

Salvataggi personali nel profilo Electron dell’utente. Torneria usa `turning-analysis.charts.json` e `turning-analysis.settings.json` in `app.getPath('userData')`. Scrittura tramite file temporaneo e rinomina; conservare i file corrotti invece di sovrascriverli silenziosamente. Non aggiungere copie alternative in localStorage.

## 12. Tabelle, gerarchie e quantità

- **Divisori verticali sempre visibili sia nelle intestazioni sia nelle celle.** Includere `table-sorting.css` e non annullarne i bordi.
- Numeri allineati a destra, testi a sinistra; intestazioni associate chiaramente ai valori.
- Riutilizzare ordinamento e indicatori condivisi; mantenere i raggruppamenti padre/figlio durante l’ordinamento gerarchico.
- Torneria usa selezione delle colonne, ordinamento multiplo, barra di riepilogo dell’ordinamento e caricamento progressivo iniziale di 250 righe.
- Le righe di totale devono essere riconoscibili e coerenti con l’intera selezione, anche quando sono mostrate solo alcune righe.
- Espansioni e dettaglio devono conservare il contesto senza forzare la perdita dei filtri.

Per documenti commerciali: quantità ordini e offerte in colonne distinte; importi ordini e offerte in colonne distinte; un valore allineato per ogni U.M. o valuta. Evitare stringhe con coppie separate da `/`. Omettere i segnaposto con valore zero e unità/valuta assente, preservando i valori non nulli privi di unità/valuta.

## 13. Dialoghi e dettagli documento

Distinguere piccoli dialoghi di configurazione da dettagli con molte colonne. I dettagli documento devono occupare quasi l’intero viewport, con scorrimento interno e intestazione/chiusura accessibili.

Riferimento commerciale attuale: larghezza `calc(100vw - 24px)`, altezza `calc(100vh - 32px)`, corpo flessibile con `min-height: 0` e overflow interno.

- Pulsante di chiusura in alto a destra e chiusura con Escape; eventuale Chiudi nel footer.
- Titolo concreto: tipo, numero e data documento. Sintesi breve del numero di righe.
- Evitare spiegazioni tecniche lunghe nel contenuto principale; usare la vista informativa o un tooltip pertinente.
- Offerte/ordini collegati espandibili con componenti condivisi e relazioni reali del gestionale.
- Non dedurre collegamenti da articoli, date o numeri simili.

## 14. Collegamenti fra moduli e menu contestuali

Il menu deve dipendere dalla cella cliccata: articolo → azioni articolo; cliente → azioni cliente; documento → azioni documento. Date, quantità e celle generiche non devono ereditare tutte le azioni della riga.

Mostrare soltanto destinazioni coerenti con dati verificati. Non proporre Torneria per un articolo senza registrazioni. Non assimilare un contatto commerciale a un cliente. Omettere azioni verso il modulo già aperto come origine.

Usare `analysis-links.ts` e il registro in `analysis-navigation.ts`. Il main verifica le destinazioni con i dati disponibili; la verifica può richiedere una lettura. Gli identificativi del documento devono essere esatti e il contesto IPC validato.

La navigazione deve riutilizzare la finestra, attendere che il renderer sia pronto e applicare il contesto al modulo. Per Torneria, l’apertura da articolo imposta il dettaglio registrazioni su tutti gli anni disponibili e tutti i mesi, evitando che un precedente filtro temporale nasconda i dati cercati.

## 15. Origine, caricamento ed esportazione

Torneria legge il foglio COMPLETO del file sorgente tramite worker; mantiene anche impostazioni di capacità e obiettivi personali. Le impostazioni non devono modificare il file di origine.

Usare la vista **Origine e verifiche** per percorso/fonte, qualità dati, anomalie e definizioni di calcolo. Lo stato principale va riservato a caricamenti utili e problemi che richiedono attenzione, evitando messaggi di successo ripetitivi.

L’export deve essere coerente con i dati e il contesto dichiarato, con unità e filtri comprensibili. Verificare i dati completi previsti dall’export, non solo le righe attualmente visibili nella tabella. In Torneria l’export richiede un nuovo `.xlsx`, distinto dal file sorgente.

## 16. Home e pagine di accesso ai moduli

La pagina Analisi commerciali è un’estensione della home: testata e griglia di moduli, senza grande infografica o testo promozionale.

- Pulsanti compatti di riferimento: 240 × 132 px, griglia che accoglie ulteriori moduli senza dilatare quelli presenti.
- Riutilizzare [aypi-module-cards.css](src/renderer/styles/utilities/aypi-module-cards.css).
- Sfondo condiviso con la home: [aypi-home-background.css](src/renderer/styles/utilities/aypi-home-background.css), classe `aypi-home-backdrop` e decorazione `.sky-grid`.
- Mantenere sfumatura, diagonale, reticolo e adattamento del tema. Questa convenzione riguarda la pagina di accesso; non impone di aggiungere decorazioni dietro ogni grafico operativo.

## 17. Verifica prima di consegnare un modulo

1. Confrontare visivamente controlli e interazioni con Torneria, non solo con la versione precedente del nuovo modulo.
2. Aprire in Electron a dimensione normale e minima dichiarata; per Torneria 1000 × 680. Verificare anche il tema standard e Blue Archive.
3. Controllare spazio utile, testi lunghi, toolbar, scroll interno e assenza di sovrapposizioni.
4. Provare clic, deselezione, Ctrl/Cmd multiplo e reset; verificare totali, quote evidenziate, KPI e tabelle insieme.
5. Provare focus grafico, riduzione, Escape, Tab/Shift+Tab e ritorno del focus.
6. Provare vista compatta/ampia e ridimensionamento senza deformare o duplicare i canvas.
7. Verificare editor, visibilità, preset, salvataggio e ricaricamento; conservazione di file personali non leggibili.
8. Verificare divisori verticali, numeri/unità, righe vuote e dati mancanti.
9. Provare menu contestuali sulle singole celle, destinazioni assenti e riuso delle finestre.
10. Per documenti, provare ×, Escape, scroll e relazioni espanse. Per export, verificare contenuto e ambito.

`npm run build:ts` verifica la compilazione. Le suite esistenti `tools/test-customer-analysis.cjs`, `tools/test-customer-analysis-ui.cjs` e `tools/test-analysis-navigation-ui.cjs` coprono parti del modello, dell’interfaccia e dei collegamenti; non costituiscono da sole una verifica completa di ogni vista Torneria. Avviare le suite UI con Electron, rimuovendo `ELECTRON_RUN_AS_NODE` dall’ambiente se presente.

Per una modifica solo documentale, controllare collegamenti e coerenza delle descrizioni; non serve avviare nuovamente i test dell’app.

## 18. Come usare e aggiornare questo riferimento

Prima di lavorare a un modulo, leggere questa guida e individuare i riferimenti sorgente pertinenti. Applicare le convenzioni esistenti alla nuova funzionalità, evitando una nuova variante dello stesso controllo.

Quando cambia una convenzione comune su richiesta dell’utente, aggiornare questa guida nello stesso intervento. Documentare cosa è riutilizzabile, cosa è specifico del dominio e quali parti del codice storico devono ancora essere allineate. Non descrivere come già implementato un comportamento soltanto richiesto o previsto.
