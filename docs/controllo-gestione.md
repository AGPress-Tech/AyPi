# Controllo di gestione AyPi

Le tabelle supportano [ordinamenti multipli](ordinamento-analisi.md), con priorità numerate sulle intestazioni, Ctrl+clic per rimuovere un criterio e pulsante **Rimuovi ordinamenti** per azzerare la sequenza. Le gerarchie e i blocchi contabili rimangono uniti; le colonne degli anni restano cronologiche e i delta conservano la propria base di confronto.

Nella home aprire la scheda **Analisi**, dopo Utilities. **Controllo di gestione** è visibile a tutti ma grigio senza accesso amministratore: il clic mostra un avviso o il messaggio dell’assistente nel tema Blue Archive. Premere **F2** e autenticarsi con la password amministratore esistente (`AGPress`) per abilitarlo. Il vecchio pulsante nel menu in alto a destra è stato rimosso. Disattivando la modalità admin con F2 si chiude anche il modulo e si svuota la cache della sessione. L’autorizzazione è verificata nel processo principale anche per apertura, lettura ed esportazione.

La modalità predefinita **SQL · aggiornati** legge il Bilancino tramite il backend da `DL360\SQL2017 / NuovaAGP`, usando la query originale dell’Excel. **Calcoli** e **Filtri** rimangono nel file `\\Dl360\pubbliche\TECH\Controlli di Gestione\ExportMovimenti.xlsx`, che non viene modificato. Non occorre più aggiornare il foglio Bilancino per ottenere i nuovi movimenti. La modalità **Excel · istantanea** legge invece tutti e tre i fogli dell’export, per scelta esplicita dell’utente.

L’elaborazione avviene in un worker per mantenere reattiva AyPi; non occorrono Python o Power BI. All’apertura e su **Aggiorna dati** si richiede una lettura nuova; i dettagli dei conti rimangono coerenti con quella stessa lettura. Se il backend o il file non sono disponibili, i dati precedenti restano visibili con un avviso e la loro data: non si passa automaticamente a un’altra sorgente. L’integrazione SQL richiede l’aggiornamento del backend e la configurazione delle credenziali solo sul server. Vedere [configurazione e collaudo SQL](backend-analytics-2026-11-06.md).

Sono disponibili overview con selezione delle categorie e dei gruppi, conto economico espandibile, scostamenti in euro e percentuale, andamento mensile e cumulato, confronto storico di tutti gli anni presenti, dettaglio conti e ripartizioni, copertura mensile e verifiche dell’importazione.

Nel conto economico si possono espandere **categoria → gruppo → codice conto → anno → singoli movimenti**. Aprendo un conto si vedono solo i riepiloghi degli anni selezionati, inizialmente chiusi: ciascun anno si apre e si chiude indipendentemente e carica soltanto le proprie registrazioni. I conti mostrano il codice effettivo, la descrizione e la quota complessiva applicata al gruppo. Per ciascun movimento sono visibili data di competenza, riga originale, descrizione, valore contabile, quota, Dare/Avere quando presenti, data di registrazione e valore gestionale nell’anno corrispondente. I delta tra registrazioni distinte restano vuoti. Il riepilogo finale dei movimenti espansi riporta il totale dell’anno.

Il dettaglio usa la stessa lettura Excel dei saldi, con le medesime esclusioni e regole di ripartizione. L’indice dei movimenti dei conti mappati rimane in memoria nel processo principale; la pagina richiede solo il conto e i periodi espansi, con autorizzazione e verifica della lettura di origine. Le registrazioni arrivano in blocchi progressivi: scorrendo verso il fondo si carica il blocco successivo, disponibile anche dal pulsante **Carica altri movimenti**. Cambiando periodo o aggiornando i dati si chiudono i movimenti espansi per evitare dettagli riferiti a un confronto precedente.

Il modulo ha una finestra autonoma, senza dipendenza dalla minimizzazione della finestra principale, si apre massimizzato e segue il tema attivo di AyPi. Marchio, intestazione e palette sono condivisi con FORGE/MES. Testata, navigazione e filtri sono compatti; overview, grafici e margini si adattano all’altezza disponibile senza scorrimento della pagina. Le tabelle scorrono all’interno dei rispettivi pannelli, con intestazioni e prima colonna fisse. Non usano paginazione; l’esportazione include tutte le righe.

Il filtro separa **Analisi** (anno, mese iniziale e finale) e **Confronto** (anno e periodo). L’opzione predefinita **Stessi mesi** segue automaticamente il periodo dell’analisi. **Scegli mesi** rende visibili i due mesi del confronto per impostare un periodo diverso. **Ripristina** propone gli ultimi due esercizi, da gennaio all’ultimo mese disponibile nell’esercizio principale, e riattiva Stessi mesi.

**Altri anni** permette di aggiungere esercizi al confronto con caselle di selezione; **Ultimi 4** seleziona rapidamente gli ultimi quattro esercizi disponibili fino all’anno dell’analisi. Gli anni aggiuntivi usano il periodo di Confronto. La selezione alimenta i grafici di overview, le serie mensili, il conto economico, il dettaglio e l’esportazione. I KPI e il riepilogo dei margini restano riferiti all’anno di Analisi, con delta rispetto all’anno di Confronto indicato nella scheda. Il grafico storico e il riepilogo degli esercizi mantengono tutti gli anni disponibili.

Le colonne degli anni sono sempre ordinate dal più vecchio al più recente, indipendentemente dall’ordine nei selettori. Nel conto economico il delta tra ogni coppia di anni consecutivi è calcolato come anno successivo meno anno precedente ed è mostrato in euro e percentuale: rosso se negativo, verde se positivo. L’ordine e i formati colorati dei delta sono mantenuti anche nel file Excel. Il grafico mensile mostra soltanto l’unione dei mesi selezionati nei periodi di confronto, senza spazio per mesi esterni all’intervallo.

Il menu degli indicatori segue lo stesso ordine del conto economico, inserendo Margine 1, Margine 2, Totale Algeria e Margine 3 nella rispettiva posizione. Gli indicatori sintetici Ricavi gestionali e Costi gestionali sono aggiunti in fondo. I tooltip dei grafici richiedono il contatto con una barra o un punto e vengono chiusi quando il mouse esce dal grafico.

La navigazione riprende quella della home AyPi: testo senza cornice, colore al passaggio del mouse e sottolineatura obliqua della scheda attiva, adattata al tema.

## Obiettivi e KPI

La scheda **Obiettivi e KPI** mostra tre indicatori a semicerchio: Ricavi di Produzione, Margine 3 e Costi gestionali. I consuntivi si riferiscono all’anno e ai mesi di Analisi. Il confronto storico rimane un riferimento esplicito; non diventa automaticamente un obiettivo.

**Imposta obiettivo** consente di inserire un importo in euro oppure riprendere, su scelta dell’utente, il valore dell’anno di confronto. L’obiettivo è specifico per indicatore, anno e intervallo di mesi: un obiettivo gennaio–dicembre resta distinto da uno gennaio–luglio. Il margine ammette anche un obiettivo di pareggio a zero; ricavi e costi richiedono importi positivi. Non vengono annualizzati i consuntivi parziali.

Per ricavi e margine il raggiungimento richiede un consuntivo almeno pari all’obiettivo. Per i costi si mostra il budget utilizzato, con residuo o superamento; rimanere entro il limite è un risultato favorevole. Questa valutazione degli obiettivi è separata dai colori dei delta delle tabelle, che rimangono invariati.

Gli obiettivi sono personali e persistono su questo PC in `management-targets.json` nella cartella dati di AyPi. Le scritture sono serializzate e atomiche; un file incoerente non viene sovrascritto automaticamente. Si possono modificare o rimuovere dal rispettivo indicatore. L’export Excel aggiunge il foglio Obiettivi quando i periodi esportati contengono obiettivi configurati.

La composizione dei costi è esplorabile: selezionare una fetta o la sua legenda filtra la classifica dei gruppi. La classifica permette di scegliere Costi/Ricavi e Top 5/10/20; con molte voci scorre nel proprio pannello. Selezionare una barra apre il relativo gruppo nel dettaglio conti. Il pulsante Azzera filtro ripristina tutte le componenti.

Gli indicatori usano archi sottili, importi abbreviati in modo uniforme e marcatori distinti: continuo per l’obiettivo, tratteggiato per il confronto storico. Gli importi esatti restano nei riepiloghi e nei tooltip. Il grafico ad anello riporta il totale centrale e una legenda con importi e incidenze; la classifica mostra valori a fine barra e quote sui gruppi selezionati nei tooltip.

Un mese privo di movimenti è un dato assente nel grafico mensile. I riepiloghi indicano i mesi effettivamente disponibili: un esercizio incompleto non viene annualizzato. Gli scostamenti percentuali usano il valore assoluto del periodo di confronto; se è zero viene mostrato `n.d.`.

## Corrispondenza con il notebook

- Data: `DataCompetenza`; nessun limite artificiale agli anni disponibili.
- Esclusione delle scritture `TipoCodice = 5177346`.
- Codici di regola sotto gli 8 caratteri: prefisso; da 8 caratteri: conto esatto.
- Percentuali: accettati frazione, numero percentuale e stringhe con `%` o virgola decimale.
- Valore gestionale = saldo contabile × percentuale × −1, senza arrotondamenti intermedi.
- Margine 1: ricavi di produzione, variazioni rimanenze, incrementi immobilizzazioni e costi variabili.
- Margine 2: Margine 1 + costi fissi + ammortamenti e svalutazioni.
- Totale Algeria: ricavi, variazioni rimanenze e costi non legati alla produzione.
- Margine 3: Margine 2 + Totale Algeria + gestione finanziaria + gestione straordinaria.

I KPI ricavi/costi sommano rispettivamente le categorie positive/negative; il margine finale è M3. La selezione nel grafico categorie filtra i gruppi, mentre i KPI restano sull’intero perimetro gestionale.

I gruppi duplicati, i riferimenti a gruppi mancanti, le colonne obbligatorie assenti e gli importi non validi bloccano il nuovo caricamento. Le date non valide sono escluse con segnalazione. Sono riportati conti senza regole e ripartizioni superiori al 100%; non si correggono automaticamente le regole del file. I conti senza regole possono essere patrimoniali e non sono aggiunti al risultato.

**Esporta Excel** apre la scelta di destinazione e salva conto economico completo di tutti i gruppi, storico, dettaglio filtrato e metadati dei periodi e dell’origine. I valori esportati sono numerici. Il file sorgente non può essere scelto come destinazione. Budget e indici patrimoniali non sono stimati in assenza dei relativi dati e criteri.

## Verifica

```powershell
npm run build:ts
npx tsc -p tsconfig.renderer.json
node --test tools/test-management.cjs
node tools/test-management-ui.cjs
npm run check:assets
```

I test usano dati sintetici e non modificano la rete aziendale. Verificano navigazione della home, espansione indipendente dei movimenti per anno, caricamento progressivo, obiettivi con persistenza e rimozione per periodo, scritture concorrenti serializzate, pareggio e budget, collegamento tra grafici e dettaglio, confronto su quattro anni, ordine cronologico, colori dei delta invariati, ordine degli indicatori, intestazioni, hover, asse mensile, scroll, export, errore rete e revoca. Entrambi i temi sono verificati a 1920×1080, 1366×768 e 1024×680.

Verifica iniziale del file reale: 331.631 movimenti, 8.816 chiusure escluse, 322.815 movimenti inclusi e 7.677 punti mese/gruppo. Confronto indipendente mediante openpyxl e le regole del notebook: scarto massimo zero su tutti i punti. Nel file iniziale il conto `06021003` risulta allocato al 100% sia in Consumi Energetici sia in Altri Costi Variabili; entrambe le regole sono applicate e la sovrapposizione è segnalata.
