# [**AyPi**](https://data.agpress-srl.it/) Module Manager

Questo applicativo è stato sviluppato per gli operatori [**AGPress**](https://agpress-srl.it/) per poter visualizzare
ed interagire con più semplicità con ogni modulo **AyPi** presente in rete.

La scheda **Analisi** della home raccoglie il [Controllo di Gestione](docs/controllo-gestione.md), riservato agli amministratori con F2, **Analisi commerciali** e Analisi Torneria. Analisi commerciali apre un modulo con tre accessi: [Venduto per articolo](docs/ricerca-per-articolo.md), [Offerte per articolo](docs/offerte-per-articolo.md) e Analisi per cliente, disponibili a tutti.

Con il tasto destro su articoli e clienti delle analisi si possono aprire gli altri moduli con il contesto selezionato, riutilizzando le finestre già aperte. La Torneria apre le registrazioni dell’articolo su tutti gli anni disponibili. La freccia accanto a un documento espande offerte o ordini effettivamente collegati nel gestionale; il collegamento è consultabile anche nel dettaglio documento del cliente. I riferimenti provengono dalle righe ordine, dalle testate offerta e da MA_CrossReferences, senza deduzioni basate su numeri, date o articoli simili. Le offerte intestate a contatti non vengono trattate come clienti. I collegamenti documentali richiedono il backend aggiornato con `/api/erp/document-links`.

Nel modulo Analisi commerciali è disponibile **Analisi per cliente**, dal database del gestionale: selezione cliente, ordini e offerte, righe articolo, stati di consegna e annullamento, quantità e residui per U.M., imponibili e stime per valuta, storico annuale, grafici interattivi e personalizzati, preset personali, vista ampia e grafici massimizzabili. I filtri sono condivisi e l’esportazione Excel include tutte le righe filtrate, documenti e riepiloghi mensili e annuali. Richiede l’aggiornamento del backend con gli endpoint `/api/erp/customer-search` e `/api/erp/customer-analysis`; non richiede nuove credenziali SQL. Sono disponibili data documento, inserimento documento e riga (TBCreated), consegna prevista e confermata e validità offerta; manca la consegna effettiva. L’imponibile riga (TaxableAmount) è separato dalle stime quantità × prezzo. I valori non sono fatturato e non viene stimata la conversione offerta → ordine.

La stessa scheda include [Analisi Torneria](docs/analisi-torneria.md), disponibile a tutti: dashboard interattiva, confronti fra più anni, macchine, clienti, articoli, registrazioni e rendimenti dal foglio COMPLETO di Controllo_Valorizzazione.xlsm. Il modulo legge il file di rete dal client e non richiede un aggiornamento del backend.

In Analisi Torneria ogni pagina dispone di un menu Grafici con visibilità, grafici personalizzati e preset personali salvabili. La mappa 3D delle registrazioni confronta pezzi, resa e ore con assi selezionabili, oppure si può passare a bolle e dispersione 2D.

La pagina Simulatore cerca un articolo nei consuntivi e confronta scenari di prezzo, tempo ciclo e lotto, includendo l'attrezzaggio: calcola la resa ottenibile oppure il prezzo/ciclo per raggiungere un obiettivo. Dati reali, risultati e ipotesi sono esportabili separatamente; la sorgente resta invariata. La dispersione in Rendimenti ora si apre in 2D.

Le tabelle delle analisi supportano [ordinamenti multipli](docs/ordinamento-analisi.md) con priorità mantenute, Ctrl+clic per rimuovere un criterio e pulsante per azzerare gli ordinamenti.

`npm run dist:backend` ricompila backend e applicazione tray dai sorgenti attuali, rimuove i vecchi output e controlla la corrispondenza dei compilati prima di creare l’installer privato. Nuovi moduli e modifiche al progetto non richiedono aggiornamenti dei manifest storici. `npm run verify:backend:build` ripete la verifica corrente; `npm run verify:backend:baseline` rimane un confronto facoltativo con la release congelata e può segnalare le differenze introdotte dalle nuove funzionalità.

Al momento supporta in 7 pagine di navigazione, **Moduli**, **Programmi**, **Articoli**, **Produzioni**, **Robot**, **Calcolatore** e **Utilities**, con i seguenti moduli:<br/>
<ul>
<li><b>Gestione Manutenzioni</b></li>
<li><b>Valutazione Fornitori</b></li>
<li><b>Gestione Utensili e Attrezzature</b></li>
<li><b>Gestione Stampi</b></li>
<li><b>Gestione Morsetti</b></li>
<li><b>Strumenti di Misura</b></li>
<li><b>DDT Fornitori</b></li>
<li><b>Tutte le Registrazioni Produzioni dei Reparti</b></li>
<li><b>Tutti i Programmi di Pianificazione dei Reparti e Consegne</b></li>
<li><b>Cicli di Lavorazione</b></li>
<li><b>Tavole e Disegni</b></li>
<li><b>Visualizzazione Stati Robot</b></li>
<li><b>Verifica Connessioni e Identificazione Robot in Rete</b></li>
<li><b>Calcolatore Parametri Utensili CNC</b></li>
<li><b>Elenco Files Cartella in Excel</b></li>
<li><b>Rinomina Files in Batch</b></li>
<li><b>Generatore QR/Barcode</b></li>
<li><b>Confronta Cartelle</b></li>
<li><b>Analizzatore Gerarchia Cartelle</b></li>
<li><b>Calendario Aziendale - AyPi Calendar</b></li>
<li><b>Modulo Acquisti e Interventi - AyPi Purchasing</b></li>
<li><b>AyPi - Ticket Support</b></li>
<li><b>Schede Attrezzaggio Transfer</b></li>
</ul>
<br/>
L'applicazione si aggiorna automaticamente all'avvio, verificando la connessione a Internet e alla rete interna. È inoltre in grado di notificare all'utente eventuali modifiche ai moduli, come rimozioni, spostamenti o utilizzi da parte di altri operatori. Tramite l'orologio digitale presente nella sidebar, è possibile impostare timer (anche preconfigurati) e cronometri.
Inoltre, integra un pulsante dedicato per scaricare e aggiornare l'<b>AyPi addin</b> per <b>Excel</b>.

Questo applicativo può essere accompagnato da un bot telegram che consente al momento l'uso del modulo <b>AyPi Calendar</b> in remoto e da mobile (Android e iOS).
