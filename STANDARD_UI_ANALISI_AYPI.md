# Standard UI dei moduli di analisi AyPi

Riferimento: **AyPi · Analisi produzione Torneria**. Ricognizione del codice: 11 novembre 2026.

Questo documento conserva le scelte di interfaccia da riutilizzare quando si creano o aggiornano i moduli AyPi. Va letto insieme ad [AGENTS.md](AGENTS.md). Le richieste successive dell’utente prevalgono e, quando introducono una convenzione comune, devono aggiornare entrambi i riferimenti pertinenti.

Le sezioni «Torneria attuale» descrivono il codice esaminato. Le sezioni «Regole comuni» comprendono anche le preferenze consolidate nelle analisi commerciali. Una regola comune non implica che ogni modulo storico sia già stato adeguato.

## 1. Principio di continuità

La dicitura **Vista Excel** indica la possibilità di filtrare e ordinare i dati: mostrare solo i nomi effettivi delle colonne, senza lettere Excel o colonna tecnica con i numeri di riga, anche nell'esportazione.

La Vista Excel legge esclusivamente il foglio **Completo** (nome senza distinzione maiuscole/minuscole), senza selettore di altri fogli. Esclude dalla proiezione dati, dai filtri e dall'export **Mese esatto**, **Anno**, **Rapporto formattazione**. **s/pezzo ideale**, **s/pezzo reale** (anche intestazione originale «s/pezzo reali») e **€/pezzo ideale** sono disponibili ma nascoste inizialmente, riattivabili da Colonne. Le chiavi interne mantengono le posizioni originali per non disallineare i valori dopo l'esclusione. Questa scelta riguarda la vista dei dati originali; i riferimenti di capacità e valorizzazione necessari alle altre analisi mantengono le rispettive letture.

I numeri della Vista Excel mostrano **al massimo due decimali**, con virgola italiana e senza zeri obbligatori. Valori originali, confronti numerici, ordinamenti ed export conservano la precisione del dato; le date mantengono il formato data.

In Manutenzioni, Dashboard e Manutenzioni effettuate includono nei filtri avanzati la riga **Esercizi**, come Analisi clienti: caselle multiple per gli anni di esecuzione, **Tutti** e **Ultimi 2** (gli ultimi due anni presenti nei dati). Nessun anno selezionato equivale a tutti. La scelta restringe insieme KPI, grafici, tabella ed export, si interseca con le date manuali e si conserva nei preset e passando fra queste due sezioni. Non applicare anni di esecuzione all'anagrafica macchine o alle notifiche delle scadenze. `analysis-year-picker.ts` condivide il markup fra i moduli; le Manutenzioni salvano le scelte come intervalli annuali nel formato condizioni già supportato dal backend.

Convenzione comune aggiornata il 12 novembre 2026: le intestazioni delle tabelle restano ferme durante lo scorrimento verticale, inclusa la prima colonna fissata orizzontalmente. `table-sorting.css` mantiene l'intero `thead` sopra le celle del corpo; il bootstrap carica questo stile anche nelle pagine che non lo includono già. I divisori verticali rimangono visibili.

I pannelli filtro si chiudono al clic/tocco esterno, conservando selezioni e valori. Passare il mouse fuori dal pannello non lo chiude. `utility-layout-bootstrap.js` gestisce i contenitori filtro condivisi e i selettori colonne, anche generati dopo il caricamento; non richiude esplosi e dettagli documentali. Per nuovi contenitori nativi usare `details[data-filter-popover]`. I selettori personalizzati del gestore prodotti mantengono i propri gestori di clic esterno.

I pulsanti di inserimento hanno bordo e testo nel colore di accento del tema, con fondo tenue (`analysis-create-button`); le azioni primarie già piene mantengono il proprio stile. Il bootstrap riconosce anche i pulsanti aggiunti dinamicamente. Blue Archive usa il blu, AGPress il proprio oro.

Filtri avanzati: campi standard etichettati, compatti e affiancati come nel Controllo di gestione, seguiti da **Filtri personalizzati** e preset. Implementato nelle Manutenzioni con campi pertinenti alla sezione (responsabile, anno, frequenza, autore, note, intervalli di esecuzione/scadenza e ritardo); condizioni personalizzate su tutte le colonne e preset esistenti conservati. Gli altri moduli mantengono i propri campi di dominio: questa regola non significa che ogni costruttore storico sia già stato ridisegnato.

Verifica: `tools/audit-analysis-ui.cjs` controlla scorrimento/intestazioni e chiusura esterna in Controllo di gestione, Torneria, Venduto e Offerte; `tools/test-maintenance-ui.cjs` verifica anche campi standard, condizioni/preset, bordo dei pulsanti e ingombro del popup, in entrambi i temi a dimensioni normali e minime.

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
| Focus, layout, editor e preset riutilizzabili | [analysis-workspace.ts](src/renderer/modules/analysis-workspace.ts), [analysis-workspace.css](src/renderer/styles/utilities/analysis-workspace.css) |
| Persistenza e validazione del workspace | [analysis-ui-preferences.ts](src/main/modules/analysis-ui-preferences.ts), [analysis-ui-model.ts](src/main/modules/analysis-ui-model.ts) |
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
| Distinte e componenti del gestionale | [bom-analysis.html](src/renderer/pages/bom-analysis.html), [bom-analysis.ts](src/renderer/scripts/bom-analysis.ts), [modello filtri e colonne](src/main/modules/bom-analysis/model.ts) |

Le funzioni interne del renderer Torneria sono riferimenti di comportamento; non sono tutte componenti già esportate. Riutilizzare i moduli condivisi disponibili. Per una nuova estrazione, mantenere il comportamento delle schermate che già li usano.

## 3. Finestra e struttura della pagina

### Torneria attuale

- Finestra Electron iniziale 1520 × 960; minimo 1000 × 680; apertura massimizzata e riuso della finestra esistente.
- `body.aypi-operations.turning-window`, testata `.topbar`, area `main`, navigazione, filtri condivisi, stato, KPI e contenuto.
- Testata: logo AyPi, soprattitolo piccolo, titolo del modulo e azioni sulla destra.
- Azioni: **Grafici**, **Vista ampia / Vista compatta**, **Capacità macchine**, **Esporta Excel**, **Aggiorna dati**, **Chiudi**.
- Sezioni: Dashboard, Confronti, Macchine, Clienti, Articoli e registrazioni, Rendimenti, Simulatore, Origine e verifiche.
- Dal 13 novembre 2026 è presente anche **Vista Excel**: lettura separata, su richiesta, del solo foglio COMPLETO e delle colonne ammesse del file, comprese righe escluse dalle analisi. Filtri di colonna, ricerca, condizioni OR nello stesso campo e AND fra campi, ordinamenti multipli, scelta colonne e caricamento progressivo; esportazione di tutti i risultati filtrati del foglio corrente con valori e formati numerici/data originali. I filtri analitici e gli anni selezionati nelle altre pagine non limitano questa vista. Macro e formule non vengono eseguite: sono esposti i risultati memorizzati, con formula nel tooltip. Il sorgente rimane invariato. `Aggiorna dati` invalida anche questa lettura.

La Vista Excel riutilizza ordinamento e divisori condivisi; i filtri colonna sono nella seconda riga dell'intestazione fissata. I menu direzionali articolo/cliente sono disponibili nelle rispettive celle di COMPLETO. Sorgenti: `turning-analysis/workbook-table.ts`, worker/IPC Torneria e `turning-workbook-view.ts`; verifica reale Electron e worker con `tools/test-turning-workbook-ui.cjs`. La lettura rifiuta oltre tre milioni di celle dichiarate senza troncamento silenzioso. I grafici e i filtri analitici conservano il loro comportamento nelle altre sezioni.

Nelle tabelle Manutenzioni, l'ordinamento iniziale è per codice macchina crescente con confronto alfanumerico. Le azioni della riga sono nel menu nativo al tasto destro: Modifica, Elimina e, per le manutenzioni previste, Inserisci manutenzione ordinaria. La conferma di eliminazione rimane obbligatoria e il codice nella prima colonna apre ancora la scheda. I filtri avanzati separano il gruppo di campi standard, Filtri personalizzati e Preset personali, con geometria compatta ispirata ai blocchi del Controllo di gestione. I contenitori scorrevoli dei form lasciano spazio all'intero anello di focus, evitando bordi tagliati.
- Scheda attiva riconoscibile tramite testo e indicatore inferiore nel colore di accento.

### Regole comuni

Riprendere questa gerarchia, adattando solo sezioni e azioni proprie del dominio. Mantenere le azioni globali nella testata e quelle del singolo grafico nel suo pannello. Impostare esplicitamente dimensioni minime e comportamento di apertura.

## 4. Colori, caratteri e geometrie

I form di login mantengono il marchio e la geometria dei moduli AyPi, con la palette del tema selezionato: Blue Archive azzurro/ciano oppure AGPress oro/ambra. Il componente riutilizzabile [aypi-login.css](src/renderer/styles/utilities/aypi-login.css), classe `.aypi-login-dialog`, riprende card compatta, bordo superiore, angoli asimmetrici e reticolo leggero già presenti nei login dei moduli. Mantiene label/azioni leggibili, errori visibili, focus del dialogo ed Escape. Il tema va inizializzato dal bootstrap prima del primo rendering; verificare i colori effettivi, non soltanto il parametro dell’URL.

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

**Implementazione Torneria aggiornata:** il contesto precedente della singola dimensione viene conservato in `chartDimensionContext`; il reset grafico lo ripristina, insieme al precedente intervallo mensile/annuale quando modificato dai grafici. Un intervento manuale sul picker della dimensione sostituisce il relativo contesto interattivo. La cronologia include il contesto dei grafici. L’analisi cliente usa uno stato di selezione grafica separato.

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

### Selezione rettangolare nelle linee e nelle barre

Non aggiungere un tooltip nativo al passaggio del mouse sull’intera area del grafico con le istruzioni di selezione. Restano disponibili i tooltip dei dati e le interazioni di selezione.

Riutilizzare [analysis-chart-area-selection.ts](src/renderer/modules/analysis-chart-area-selection.ts), registrato dalla toolbar condivisa. Trascinare con il pulsante sinistro all’interno dell’area dati disegna un rettangolo: seleziona i punti delle linee contenuti nell’area e le barre intersecate, anche orizzontali o negative. Serie nascoste e valori nulli sono esclusi; le categorie presenti in più serie vengono deduplicate.

Senza modificatori, l’area sostituisce la selezione della relativa dimensione. Con Ctrl/Cmd aggiunge o rimuove in blocco le categorie intercettate. Escape annulla il trascinamento senza modificare filtri o chiudere il grafico espanso. Un’area senza dati non cambia la selezione. Un semplice clic mantiene il comportamento precedente.

Ogni grafico espone `options.onAreaSelect(indices, multiple)` e applica tutte le categorie **in un solo aggiornamento**, tramite `mergeAreaSelection()`: non simulare una sequenza di clic che ricrea il grafico per ogni punto. Il workspace propaga il callback anche ai grafici derivati. MES riutilizza lo stesso gesto per le barre HTML. Anelli e grafici spaziali conservano le proprie interazioni.

In Torneria la selezione rettangolare temporale conserva i mesi del contesto come sfondo e applica una selezione distinta di mesi ai risultati, anche non contigui. Reset, chip e cronologia devono gestire tale stato insieme alle selezioni dimensionali.

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

### Workspace condiviso introdotto nell’allineamento

Gestione, Pianificatore produzione, MES e Calendar usano `installAnalysisWorkspace()` per toolbar, focus, tastiera, vista ampia, visibilità, grafici aggiuntivi ed editor/preset. Il modulo accetta adattatori per i dati del dominio; supporta anche il focus di un grafico HTML, come il riepilogo MES.

I grafici aggiuntivi del workspace sono viste derivate dalle serie aggregate già disponibili: scelta di origine, titolo, barre/linee/anello e numero di voci; Gestione e MES espongono anche misure del dominio. Non costituiscono un nuovo motore di query libero. Non sostituire i builder specifici più ricchi già esistenti.

Le preferenze sono versionate, con massimo 12 grafici e 10 preset, e salvate nei file `analysis-ui-management.json`, `analysis-ui-production.json`, `analysis-ui-mes.json`, `analysis-ui-calendar.json`. I preset condivisi salvano il layout e i grafici, mantenendo indipendenti i filtri manuali. Il main verifica la pagina chiamante e conserva i file corrotti. Le vecchie viste MES e le analisi personalizzate del Pianificatore rimangono disponibili nella loro posizione originaria: nessuna cancellazione o migrazione implicita.

In Gestione i KPI contabili principali rimangono totali del perimetro manuale. La selezione interattiva viene presentata come quota aggiuntiva e filtra i dettagli, senza rietichettare come totale un risultato parziale. Nel Pianificatore e Calendar i grafici mantengono la base completa, con la quota selezionata evidenziata; KPI e tabelle seguono la selezione. MES conserva il riepilogo di base delle macchine e richiede al servizio il dettaglio della selezione.

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

Usare [analysis-excel.ts](src/main/modules/analysis-excel.ts) per i tipi e i formati dei file: numeri come celle numeriche; formato intero senza separatore finale oppure decimali espliciti in base al valore; pesi articolo con tre decimali fissi. Non usare suffissi di soli decimali facoltativi (`.######`), che possono lasciare un separatore finale sugli interi. Le date devono essere seriali Excel con formato `dd/mm/yyyy`, i periodi mensili `mm/yyyy`, le date/ore `dd/mm/yyyy hh:mm:ss` e le durate MES valori numerici con formato `[h]:mm:ss`. Codici articolo/documento e zeri iniziali restano testo. Verificare i tipi rileggendo il file XLSX, non solo l’anteprima a schermo.

Nelle analisi Venduto/Offerte per articolo, quantità ordinate/offerte, consegnate e residue hanno al massimo tre decimali visibili, senza zeri aggiunti. Il valore numerico originale del gestionale rimane invariato nella cella Excel: il limite riguarda il formato, non un arrotondamento dei dati prima dell’esportazione.

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

### Gestione manutenzioni nativa

Il pulsante esistente **Gestione manutenzioni** apre la finestra AyPi massimizzata (minimo 1000 × 680), in sostituzione dell’apertura diretta di Access. All’ingresso si seleziona un dipendente dalla stessa lista/reparti condivisi degli altri moduli; nessuna password, anche se il nome appartiene a un amministratore. Tutti gli operatori possono gestire macchine, manutenzioni ordinarie previste e interventi effettuati. L’identità selezionata viene registrata sulle creazioni e modifiche; eliminazioni e variazioni conservano un audit nel backend.

I dati risiedono nel **database core del backend `aypi.db`**, nelle tabelle `maintenance_entities`, `maintenance_attachments`, `maintenance_audit`, `maintenance_settings`; nessun archivio operativo locale. Le revisioni per scheda impediscono la sovrascrittura concorrente da PC diversi. Preferenze grafici, colonne e preset filtri sono personali per dipendente e risiedono nello stesso database.

Sezioni: Dashboard, Notifiche, Manutenzioni effettuate, Macchine, Manutenzioni previste, Origine e verifiche. Riutilizzare `analysis-workspace.ts`, toolbar/reset/focus condivisi, editor grafici/preset, plugin di selezione e selezione rettangolare. Le selezioni dei grafici aggiornano KPI e tabella interventi, mantenendo i totali di contesto; il reset grafico conserva i filtri manuali. I filtri includono reparti/macchine multipli, tipo, intervallo date, ricerca libera e condizioni modulari per campo (OR fra alternative dello stesso campo, AND fra campi, intervalli e mancanti). Tabelle con ordinamento multiplo, colonne selezionabili, divisori verticali e caricamento progressivo; export di tutte le righe filtrate, con date Excel reali.

Le ordinarie previste sono associate a una macchina e hanno una frequenza opzionale in mesi di calendario. La scadenza deriva soltanto dall’ultima esecuzione valida e dalla frequenza attuale, con adattamento alla fine del mese. Nessuna scadenza manuale. Senza frequenza o senza esecuzioni precedenti, nessuna notifica. Le date future sono vietate nelle nuove registrazioni e nelle correzioni; nella migrazione vengono esclusi record con date future/mancanti/non valide, definizioni senza macchina o descrizione, interventi vuoti e collegamenti macchina/manutenzione incoerenti. Le vecchie prossime date manuali vengono scartate, anche dai metadati storici.

Il pannello notifiche è solo interno: reparto → macchina → righe scadute, con ultima esecuzione, scadenza e giorni di ritardo. Mostra anche le macchine senza scadute, con gruppi inizialmente chiusi. Tasto destro sulla manutenzione o pulsante **Inserisci manutenzione** apre macchina e manutenzione precompilate, con data odierna modificabile. La disattivazione delle macchine/definizioni conserva lo storico; macchine con dati collegati non vengono eliminate. Una definizione con storico non può essere spostata su un’altra macchina: si crea una nuova definizione.

**Migrazione senza operazioni al primo accesso:** i dati sono importati direttamente tramite il backend, su archivio ancora vuoto, con `tools/import-maintenance-live.cjs --apply`. Il tool acquisisce una copia locale verificata del database Access, la legge con DAO in sola lettura, applica la pulizia, salva un backup del database AyPi e scrive soltanto tramite le API del backend attivo; non modifica il file SQLite aperto dal servizio. Il rapporto di migrazione è conservato in `.private/maintenance-migration-report.json`.

**Importazioni successive:** mantenere in Origine e verifiche il pulsante **Confronta e importa Access**. Acquisisce una copia locale stabile, mostra l’anteprima delle aggiunte e le differenze campo per campo fra Access e AyPi, quindi **Aggiungi mancanti** inserisce soltanto voci assenti. Nessuna sovrascrittura automatica delle schede esistenti, delle frequenze, delle disattivazioni o delle eliminazioni AyPi. Il confronto usa tipo e ID originali; per le schede nate in AyPi accetta solo corrispondenze naturali univoche e conserva gli alias per i confronti futuri. Gli allegati vengono deduplicati per registrazione/percorso o contenuto; quelli rimossi in AyPi non vengono ripristinati. Confronti ambigui e dipendenze eliminate sono segnalati, non importati. Il backend mantiene l’anteprima per operatore per dieci minuti e ricalcola le aggiunte nella transazione finale, evitando duplicati anche con importazioni simultanee. **Conferma confronto**, quando non ci sono aggiunte, conserva le corrispondenze senza modificare le schede. L’anteprima non scrive dati. Il dialogo ampio conserva tabelle con divisori, tema Blue Archive/AGPress, chiusura ×/Escape e ritorno del focus.

Lo script `maintenance-access.ps1` mantiene codici/ID storici, campi macchina (compresi i tipi di attrezzatura multivalore), catalogo, ordinarie, straordinarie e allegati validi. I file di rete restano collegati; gli allegati soltanto incorporati vengono conservati nel DB, senza duplicare i documenti già in rete. File omonimi multipli vengono confrontati con SHA-256. Il backend applica nuovamente la pulizia, registra le esclusioni, importa in transazione e rifiuta sovrascritture di archivi già inizializzati. Il bootstrap può consumare un file predisposto `maintenance-import.pending.json` accanto ad `aypi.db`, dopo l’acquisizione del lock del servizio; digest e metadati evitano duplicazioni al riavvio. Una pulizia una tantum aggiorna le importazioni eseguite con la prima versione del modulo. **Le frequenze importate restano vuote**, perché Access non le archivia nel catalogo: l’operatore le imposta sulle manutenzioni previste.

**Compatibilità durante il passaggio:** il file Access e il percorso configurato non vengono rimossi, rinominati o bloccati. I client vecchi continuano ad aprirlo direttamente; il nuovo client apre il modulo nativo. Access e AyPi sono archivi indipendenti: gli inserimenti successivi in Access non vengono sincronizzati automaticamente nel nuovo modulo.

Riferimenti: [renderer](src/renderer/scripts/maintenance.ts), [pagina](src/renderer/pages/maintenance.html), [IPC](src/main/modules/maintenance/ipc.ts), [servizio backend](backend/src/modules/maintenance/service.ts), [confronto incrementale](backend/src/modules/maintenance/access-sync.ts), [calendario e validazione](backend/src/modules/maintenance/model.ts). Verifiche dedicate: `tools/test-maintenance.cjs`, `tools/test-maintenance-sync.cjs`, `tools/test-maintenance-ui.cjs`; quest’ultima usa Electron e un backend HTTP isolato con database temporaneo, due temi, dimensioni normale/minima, login, CRUD, notifiche, grafici, preset, confronto/importazione ed export.

### Modulo BoM e Articoli

Una sola card nelle Analisi commerciali apre la finestra massimizzata con due viste: **Articolo → Distinte** (legami diretti del componente) e **Distinta → Articoli** (composizione, comprese righe descrittive e distinte senza componenti). Riutilizza filtri compatti e tabelle commerciali, divisori verticali, selezione colonne, ordinamento multiplo e menu contestuali direzionali. I filtri coprono tutte le colonne, anche nascoste, con alternative OR per campo e AND tra campi. Non aggiungere grafici a una ricerca tabellare senza una misura e un uso pertinenti.

In entrambe le viste la tabella principale mostra **una sola riga per distinta**, con i soli dati dell’intestazione. I filtri sulle righe selezionano le distinte pertinenti senza duplicarle; componenti e quantità restano nell’esplosione e nel dettaglio, senza mostrare un componente arbitrario come riepilogo. Paginazione e ordinamento della tabella lavorano sulle distinte uniche. L’Excel propone **Riepilogo** (colonne visibili e una riga per distinta) oppure **Esploso completo** (tutte le righe e colonne delle distinte trovate, anche quelle escluse dai filtri sulle righe). L’esploso rimane per legami diretti, senza moltiplicare quantità tra livelli.

La freccina ▸ accanto al codice espande la composizione direttamente sotto la riga, come nei documenti commerciali; un secondo clic la richiude. Anche le sottodistinte sono espandibili. Il clic sul codice apre invece il dettaglio quasi a schermo intero, che conserva tutte le righe della distinta, ha chiusura ×/Escape, focus contenuto e ripristinato, ricerca interna e navigazione nelle sottodistinte con Indietro. **Apri nella ricerca** rende disponibili tutti i filtri anche sulla composizione del dettaglio. I menu mostrano soltanto destinazioni con dati verificati, anche aprendo questa analisi da un articolo negli altri moduli.

Fonte: `MA_BillOfMaterials` e `MA_BillOfMaterialsComp`, pesi da `MA_ItemsGoodsData`. Non usare tabelle temporanee di esplosione. Quantità originali per riga e U.M., senza somma tra unità o moltiplicazione tra livelli; massimo tre decimali visualizzati, valori numerici originali conservati nell’Excel. Le sostituzioni di variante e le modifiche ECO non sono applicate. Date sentinella ERP non valorizzate → mancanti. La lettura rifiuta oltre 100.000 righe senza troncare silenziosamente.

Colonne e massimo dieci preset personali di filtri/ordinamento/colonne sono validati nel main e salvati atomicamente in `bom-analysis.settings.json`; un file corrotto viene preservato. Verifiche dedicate: `tools/test-bom-analysis.cjs` e `tools/test-bom-analysis-ui.cjs`, quest’ultima in Electron sui due temi, 1500 × 940 e minimo 1000 × 680, con controllo del file Excel riletto.

Prima di lavorare a un modulo, leggere questa guida e individuare i riferimenti sorgente pertinenti. Applicare le convenzioni esistenti alla nuova funzionalità, evitando una nuova variante dello stesso controllo.

Quando cambia una convenzione comune su richiesta dell’utente, aggiornare questa guida nello stesso intervento. Documentare cosa è riutilizzabile, cosa è specifico del dominio e quali parti del codice storico devono ancora essere allineate. Non descrivere come già implementato un comportamento soltanto richiesto o previsto.
