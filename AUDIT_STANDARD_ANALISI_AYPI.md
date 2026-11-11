# Verifica degli standard UI delle analisi AyPi

Data: 11 novembre 2026. Riferimento: [STANDARD_UI_ANALISI_AYPI.md](STANDARD_UI_ANALISI_AYPI.md).

## Aggiornamento dopo l’allineamento

Le sezioni successive conservano la fotografia **precedente** all’intervento. L’allineamento richiesto è stato implementato senza rimuovere le viste tabellari:

- Torneria: reset che conserva il contesto manuale, cronologia del contesto grafico e caricamento della modalità Rendimenti salvata; editing degli assi nel menu Grafici.
- Gestione: controlli condivisi, focus con tastiera, vista ampia, grafici aggiuntivi e preset personali; selezioni multiple di categorie/gruppi/mesi/anni con totali visibili, quota selezionata nei KPI e dettagli collegati. Obiettivi e calcoli contabili originari conservati.
- Pianificatore, MES e Calendar: workspace condiviso con editor/preset aggiuntivi, controlli e focus, selezioni collegate; filtri e tabelle originali conservati. Preferenze locali preesistenti mantenute.
- Layout basso: riquadri Gestione e KPI MES compattati; filtri dettagliati del Pianificatore accessibili da Altri filtri. Le ricerche Venduto/Offerte rimangono tabellari, con nota dati consultabile.

Nuove verifiche: `tools/test-analysis-ui-preferences.cjs` per autorizzazioni, validazione e persistenza; `tools/test-analysis-workspace-ui.cjs` per i tre moduli aggiuntivi nei due temi; `tools/audit-analysis-ui.cjs` aggiornato per confermare la correzione dei comportamenti riprodotti. Restano valide le suite cliente e navigazione. Le nuove funzioni del workspace sono descritte nella guida standard.

## Esito e perimetro dell’audit iniziale

**I moduli non sono ancora tutti allineati allo stesso standard.** Analisi cliente è il modulo più vicino al comportamento richiesto; Torneria è il riferimento visivo ma presenta anche due comportamenti da correggere; Controllo di gestione mantiene una propria interazione grafica, meno uniforme.

Questa è una verifica, non una modifica dei moduli: nessuna tabella, funzione operativa o filtro è stato rimosso. Sono stati aggiunti soltanto questo rapporto e uno strumento di audit.

La richiesta dell’utente è mantenere uno standard per **funzioni esistenti e layout**. Venduto e Offerte per articolo sono ricerche tabellari: l’assenza di una dashboard grafica non viene classificata come difetto e non comporta la loro sostituzione. La mancanza di una funzione viene distinta da un comportamento incoerente di una funzione già disponibile.

Verifica dinamica dei moduli principali: Torneria, Analisi cliente, Venduto per articolo, Offerte per articolo, Controllo di gestione. Ricognizione aggiuntiva del codice delle analisi Pianificatore produzione, MES e Calendar; per queste ultime non è stata eseguita una verifica completa in Electron.

## Matrice di confronto

| Aspetto | Torneria | Analisi cliente | Venduto / Offerte per articolo | Controllo di gestione |
| --- | --- | --- | --- | --- |
| Marchio e colori operativi condivisi | Sì | Sì | Sì | Sì |
| Struttura dei controlli grafico condivisa | Sì; resta il controllo locale Assi | Sì | Non applicabile: ricerca tabellare | No |
| Grafici collegati | Sì | Sì | Non applicabile | Collegamenti locali, non un unico stato condiviso |
| Ctrl/Cmd per selezione multipla grafica | Sì per selezioni dimensionali | Sì | Non applicabile | Non presente nei grafici esaminati |
| Totali visibili e quota selezionata | Sì | Sì | Non applicabile | Non uniforme; la classifica viene ristretta |
| Reset grafico conserva filtri manuali | **No: cancella le dimensioni condivise** | Sì, verificato | Reset della ricerca separato | Manca il reset grafico condiviso |
| Focus grafico, Escape, gestione tastiera | Presente | Presente e verificato | Non applicabile | Non disponibile |
| Vista compatta / ampia | Presente | Presente | Layout tabellare proprio | Non disponibile |
| Grafici personalizzati e preset grafici | Presenti; anomalia al caricamento della modalità Rendimenti | Presenti | Non disponibili; colonne personali disponibili | Non disponibili; obiettivi personali disponibili |
| Filtri operativi | Anni, mesi, dimensioni, ricerca e intervalli | Cliente, documenti, date, anni, articoli, stato, U.M., valuta e intervalli | Regole multiple per codice, cliente, documento, date, quantità, prezzi e U.M.; consegne/residui negli ordini | Fonte, periodi, confronti e anni; categoria/gruppo/ricerca nella vista conti |
| Divisori verticali tabelle | Presenti | Presenti | Presenti | Presenti |
| Tabelle conservate e navigabili | Sì | Sì | Sì: contenuto principale | Sì: conto economico e dettaglio conti |

«Presente» non certifica ogni combinazione possibile di dati. I filtri sono stati confrontati con le funzionalità implementate; non è una certificazione della copertura di tutti i campi del database.

## Scostamenti verificati

### 1. Torneria: il reset grafico elimina una scelta manuale

**Priorità alta, comportamento riprodotto in Electron.** Selezionando M1 dal picker Macchine e premendo il reset di un grafico, il chip M1 scompare. Il codice usa lo stesso stato dimensionale per picker e grafici e `resetChartSelections()` svuota macchine, clienti e articoli.

Riferimenti: [resetChartSelections](src/renderer/scripts/turning-analysis.ts:556), [choose](src/renderer/scripts/turning-analysis.ts:88).

Allineamento richiesto: distinguere filtri manuali e selezioni dei grafici. Il reset grafico deve cancellare soltanto le seconde; Ripristina deve mantenere il ruolo di reset generale. Tabelle e KPI devono usare l’intersezione corretta dei due stati.

### 2. Torneria: la modalità grafica salvata nei Rendimenti viene sovrascritta

**Priorità alta, verificata nel codice e in Electron.** Durante il primo caricamento, `load()` imposta sempre `chartPreferences.pages.performance.scatter.mode = 'scatter'` se esiste una configurazione della pagina. Nella prova, una preferenza salvata come Bolle è stata presentata come dispersione 2D.

Riferimento: [caricamento preferenze](src/renderer/scripts/turning-analysis.ts:605).

Allineamento richiesto: rispettare la modalità validata e salvata. Applicare un valore predefinito soltanto quando la preferenza manca o richiede una migrazione esplicita.

### 3. Controllo di gestione: le interazioni grafiche seguono un flusso diverso

**Priorità alta per la coerenza richiesta.** Nell’overview, il clic su una categoria restringe i gruppi; il clic sul gruppo apre la vista Dettaglio conti. Nell’area Obiettivi il grafico di composizione filtra la propria classifica. Queste sono funzioni utili, ma non equivalgono a selezioni condivise fra tutte le viste.

Nella prova overview con dati sintetici, una selezione ha ridotto i gruppi da 11 a 1, lasciando invariati i KPI e senza evidenziazione di una quota sul totale. Il callback non gestisce Ctrl/Cmd. I grafici mensile/storico sono rappresentazioni del periodo senza lo stesso collegamento interattivo.

Riferimenti: [factory grafici](src/renderer/scripts/management.ts:136), [overview](src/renderer/scripts/management.ts:164), [andamento](src/renderer/scripts/management.ts:277), [grafici obiettivi](src/renderer/modules/management-goals.ts:82).

Allineamento richiesto: un modello coerente di selezioni, evidenziazione e reset. **Conservare i KPI/margini del perimetro completo quando questa è la loro definizione contabile**: rendere esplicito il totale e affiancare l’eventuale quota selezionata. Non trasformare implicitamente un margine globale in un margine parziale per uniformare il solo aspetto visivo. Conservare il collegamento al dettaglio dei conti.

### 4. Controllo di gestione: assenti i controlli grafico comuni

**Priorità media.** I grafici non espongono la toolbar reset/espansione condivisa. Mancano il focus con gestione tastiera e l’alternanza compatta/ampia.

Riferimento: [struttura della pagina](src/renderer/pages/management.html).

L’editor Grafici e i preset grafici non sono implementati: questa è una **funzione assente**, non un editor esistente da correggere. I target/obiettivi personali già presenti hanno un altro scopo e devono essere preservati. Se si vuole estendere anche questa funzionalità, seguire il flusso comune senza sostituire le viste tabellari.

### 5. Controllo di gestione: lo spazio riservato ai grafici è sbilanciato nelle finestre basse

**Priorità media, verifica visiva a 1000 × 680.** Nella vista Obiettivi e KPI le tre schede superiori occupano gran parte dell’altezza. Nell’audit il canvas dell’anello era alto circa 89 px e la classifica richiedeva scorrimento interno. Nell’overview i canvas erano alti circa 173 px; i filtri occupavano due righe.

Non è stato rilevato overflow orizzontale dell’intera pagina nelle dimensioni esaminate. Il problema è l’equilibrio dello spazio, non la perdita delle tabelle.

Riferimento: [layout gestione](src/renderer/styles/management.css).

Allineamento richiesto: compattare i riquadri superiori nelle finestre basse e consentire focus/vista ampia per leggere i grafici.

### 6. Metadati e testi informativi ancora distribuiti nelle viste operative

**Priorità bassa.** Il Controllo di gestione mantiene una riga di stato con fonte, conteggio e ora e un footer informativo. Venduto/Offerte mostrano spiegazioni nel pannello filtri e una nota dati fissa. Sono residui di layout diversi dalla convenzione che concentra i dettagli nella vista informativa.

Riferimenti: [stato gestione](src/renderer/scripts/management.ts:395), [Venduto](src/renderer/pages/article-orders.html:18), [Offerte](src/renderer/pages/article-offers.html:18).

Allineamento richiesto: mantenere messaggi operativi/errori e spostare le spiegazioni persistenti in un punto informativo consultabile, preservando accesso e significato.

### 7. Torneria: configurazione Assi ancora disponibile direttamente sul pannello

**Priorità bassa.** Nei Rendimenti esiste un pulsante Assi che apre la configurazione; il menu Grafici permette già di modificare gli assi. È una variante locale rispetto alla regola che raccoglie l’editing nel menu Grafici.

Riferimento: [pannello Rendimenti](src/renderer/scripts/turning-analysis.ts:442).

Allineamento richiesto: un punto di modifica coerente. La scelta rapida della visualizzazione 2D/3D/Bolle può essere valutata separatamente dall’editor completo.

## Cosa risulta già coerente

### Analisi cliente

Le prove hanno verificato selezione articolo/mese, combinazione delle dimensioni, Ctrl multiplo, permanenza delle categorie totali, serie evidenziate, cumulativo, reset che conserva EUR scelto manualmente, KPI e tabelle aggiornati insieme.

Verificati anche toolbar condivisa, focus e tastiera, vista ampia, editor, preset, export, pagine tabellari, popup documento e conservazione dei dati dopo un errore di caricamento. La suite è passata sia in Blue Archive sia nel tema standard.

I preset includono filtri e vista, mentre quelli Torneria salvano il layout grafico: è una differenza esplicita del modello, non un motivo per cancellare funzioni. Anche l’assenza del 3D nell’analisi cliente non è un difetto di uniformità delle azioni disponibili.

### Venduto e Offerte per articolo

Sono due viste dello stesso renderer, con filtri coerenti fra loro, colonne selezionabili, ordinamento condiviso, divisori verticali, export e documenti collegati. Sono state aperte con risultati sintetici in entrambi i temi, a 1480 × 900 e 1000 × 680, senza overflow orizzontale dell’intera pagina.

La struttura laterale dei filtri differisce dal cruscotto Torneria: è appropriata a ricerche tabellari più articolate. Va uniformata la presentazione delle azioni comuni, senza imporre lo stesso numero di pannelli o aggiungere grafici non richiesti.

### Tabelle e collegamenti

I campioni di intestazioni/celle verificati mostrano divisori verticali nei moduli principali. La suite di navigazione ha verificato menu specifici per campo, esclusione di destinazioni senza dati, apertura dei documenti con ID esatto, collegamenti reciproci, riuso delle finestre e chiusura del dettaglio con il pulsante superiore.

## Analisi aggiuntive: ricognizione del codice

Questi risultati non hanno lo stesso livello di verifica dinamica dei moduli principali.

| Modulo | Funzioni da conservare | Differenze dallo standard |
| --- | --- | --- |
| Analisi Pianificatore produzione | Filtri, grafici, analisi personalizzate, tabelle ed export | Struttura e CSS propri; grafici personalizzati salvati in localStorage; assenza della toolbar/focus comuni e di callback di selezione grafica comparabili a Torneria nei grafici esaminati |
| Analisi MES e ordini | Filtri, selezione macchine, tabelle, export, viste salvate | Grafico HTML con selezione singola della macchina che ricarica il report; preset locali di filtri/colonne/vista, non editor di grafici come Torneria; stile e componenti propri |
| Analisi Calendar | Filtri e dashboard assenze | Renderer e stile propri; grafici Chart.js senza le selezioni condivise, il focus e la toolbar dei moduli di analisi principali nel codice esaminato |

Riferimenti: [Pianificatore](src/renderer/scripts/utilities/production-planner-analysis.ts:403), [persistenza personalizzazioni Pianificatore](src/renderer/scripts/utilities/production-planner-analysis.ts:646), [interazione MES](src/renderer/scripts/utilities/mes-analysis.ts:483), [viste MES](src/renderer/scripts/utilities/mes-analysis.ts:502), [Calendar](src/renderer/scripts/utilities/ferie-permessi-analysis.ts:738).

Nessuna migrazione dei dati locali è stata eseguita. Prima di uniformare la persistenza, prevedere il recupero delle configurazioni personali esistenti.

## Prove eseguite e limiti

- `npm run build:ts`: superato.
- `node tools/test-customer-analysis.cjs`: superato.
- Suite Electron analisi cliente: superata in Blue Archive e standard, comprese dimensioni piccole e comportamenti interattivi.
- Suite Electron navigazione: superata.
- [tools/audit-analysis-ui.cjs](tools/audit-analysis-ui.cjs): 36 acquisizioni di viste principali, entrambi i temi, dimensioni 1480 × 900 e 1000 × 680; riproduzione delle anomalie reset Torneria, preferenza Rendimenti e interazioni Gestione.
- Output riproducibile e screenshot in `.tmp-analysis-audit/`, compreso `audit.json`. Questi artefatti temporanei sono esclusi dal versionamento.

Le prove usano dati sintetici e un profilo Electron isolato: non alterano file sorgente di rete, configurazioni personali o dati del gestionale. Non certificano i risultati contabili reali né ogni combinazione dei filtri. Il superamento delle suite funzionali **non equivale** alla conformità allo standard: l’audit descrive espressamente gli scostamenti ancora presenti.

## Ordine suggerito degli allineamenti

1. Correggere reset e ripristino della modalità salvata della Torneria.
2. Applicare toolbar/focus condivisi ai grafici esistenti del Controllo di gestione.
3. Uniformare selezioni ed evidenziazioni della Gestione mantenendo le definizioni dei KPI globali e tutti i dettagli tabellari.
4. Ribilanciare layout bassi e messaggi informativi.
5. Allineare progressivamente le analisi aggiuntive, preservando funzioni e configurazioni personali.

L’aggiunta di editor/preset grafici dove oggi mancano è un’estensione separata, da distinguere dall’allineamento delle funzioni già esistenti.
