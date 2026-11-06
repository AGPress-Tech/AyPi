# Installer aziendali AyPi 1.4.1 — 6 novembre 2026

Distribuzione privata richiesta dall'utente: installazione backend su DL360 e client sui PC aziendali, senza configurazione SQL manuale.

## Installazione

1. Eseguire `dist-backend/AyPi Backend Setup 1.4.1.exe` su **DL360**, con elevazione amministrativa.
2. Eseguire `dist/AyPi Setup 1.4.1.exe` sui client.
3. Aprire la scheda **Analisi**: Analisi Venduto per Articolo è disponibile a tutti. Per Controllo di gestione premere F2 e inserire `AGPress`.

Il backend configura automaticamente SQL, verifica connessione e accesso alle tabelle contabili, registra il task SYSTEM all'avvio e lo avvia. Apre la porta TCP 3000 per il proprio eseguibile, limitata alla sottorete locale. Il client usa l'indirizzo aziendale predefinito `http://192.168.1.240:3000`; eventuali override di ambiente esistenti mantengono la precedenza. Non occorre installare SQL Server o driver ODBC sui client.

I movimenti vengono letti dal database quando richiesti. Il file `ExportMovimenti.xlsx` resta necessario sulla condivisione aziendale per Calcoli e Filtri, senza aggiornare il foglio Bilancino.

La distribuzione aggiornata comprende anche [Analisi Venduto per Articolo](ricerca-per-articolo.md) e [Analisi Offerte per Articolo](offerte-per-articolo.md), senza Excel intermedio e senza autenticazione amministratore. Le API operative sono separate dalle API economiche protette. Nessuna credenziale SQL è inclusa nel client.

## Account SQL e provisioning

Creato e verificato direttamente su `DL360\SQL2017`, database `NuovaAGP`, il login `AyPiAnalytics`, con password casuale. Appartiene a `db_datareader` e `db_denydatawriter`: lettura di tutte le tabelle e viste utente del database, scritture DML negate, nessun ruolo amministrativo o permesso DDL assegnato. Non sono concessi accessi agli altri database aziendali.

L'ultimo controllo ha verificato 839 oggetti leggibili e zero oggetti scrivibili. La creazione/configurazione di questo account è già stata eseguita da questo PC tramite SQL; non richiede accesso Windows remoto al server. Nessun dato aziendale è stato modificato dalle verifiche.

Il pacchetto backend è **riservato all'uso interno**: contiene il materiale di provisioning del login dedicato. La cifratura di trasporto nel pacchetto non impedisce a chi possiede l'installer di recuperare tale credenziale. Non pubblicare questo installer su GitHub o altri canali pubblici. Il client non contiene il provisioning o credenziali SQL. Nessuna password SQL è salvata nei sorgenti versionati.

Durante l'installazione su DL360, lo script ricifra il segreto con DPAPI LocalMachine e limita l'accesso al file in ProgramData a SYSTEM, amministratori e identità di installazione. Dopo il controllo SQL, elimina il payload temporaneo dai file installati. Una copia DPAPI di un altro PC non viene usata come configurazione finale. Il pacchetto rifiuta l'installazione SQL su computer diversi da DL360.

## Riferimento di distribuzione

Il checkout corrente comprende modifiche pregresse e una formattazione generale successiva al backend storico 1.4.0. Per questa distribuzione completa si usa `tools/baselines/backend-release-2026-11-06.json`, un manifest congelato di sorgenti, compilati, dipendenze, risorse e script. Il controllo rifiuta modifiche, aggiunte e file mancanti e non rigenera automaticamente il manifest durante la build.

I riferimenti storici non sono stati sovrascritti: `verify-backend-baseline.cjs --historical` e `--legacy-reviewed` continuano a mostrare le differenze rispetto ai precedenti pacchetti. Il nuovo manifest attesta l'integrità del contenuto corrente e non afferma equivalenza funzionale o binaria con il backend 1.4.0. Nessun cambiamento ai sorgenti Forno/MES è stato introdotto per generare questi installer.

## Verifiche

- Compilazione client, backend e launcher; controllo asset runtime.
- Test automatici contabilità, API SQL, autenticazione, obiettivi, regressioni Forno/MES, allegati e vincoli di distribuzione.
- Test UI Electron nei due temi e alle tre risoluzioni previste.
- Corretto il test degli allegati per inviare `previousCode` quando aggiorna un progetto esistente, come richiesto dall'API; nessuna modifica al comportamento del backend.
- Script effettivo di provisioning provato su questo PC con destinazione temporanea e account dedicato; verifica SQL riuscita.
- Esecuzione dai pacchetti ASAR finali: API SQL → client con gzip → worker contabile → parametri Excel reali, 331.982 movimenti e zero date invalide.
- La prova usa un server HTTP isolato: non avvia acquisizioni industriali o altri servizi del backend.

Non è stata eseguita l'installazione su DL360: l'accesso amministrativo Windows remoto non è disponibile da questa sessione. L'installazione completa del task SYSTEM e del firewall va quindi eseguita dal relativo installer sul server.
