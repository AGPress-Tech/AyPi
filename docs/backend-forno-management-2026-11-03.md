# Gestione dei programmi del forno - 03/11/2026

Richiesta dell'operatore dopo collaudo reale riuscito di TEST_Forno: abilitare
creazione, lettura in Reset, modifica, sovrascrittura ed eliminazione anche dei
programmi preesistenti. Nessun comando Run remoto. Nessuna modifica reale ai
programmi eseguita da Codex durante lo sviluppo di questa revisione.

Modalita produzione predefinita: manage. tests resta selezionabile esplicitamente
per limitarsi ai TEST_ creati e verificati da questa installazione; off e valori
non riconosciuti disabilitano le mutazioni. Configurazione esplicita e ambiente
mantengono la precedenza. In sviluppo il default resta off.

Diff esaminata rispetto alla revisione precedente:

- program-transfer-plan.ts: nomi ordinari ASCII, 1-20 caratteri e senza caratteri
  riservati; profilo tests conserva il vincolo TEST_. Invariata la scrittura dei
  soli parametri abilitati CH1/tre eventi/rampe a tempo.
- program-transfer.ts: inspect carica solo in Reset, con backup fsync e journal
  prima del Load; conferma due immagini coerenti, elenco invariato e Amended=0.
  Ritorna ricetta e riferimento di lettura legato a operatore, dispositivo, nome
  e immagine, valido due ore. Snapshot e ticket non sopravvivono al riavvio.
- Una destinazione gia presente richiede selezione esplicita Sovrascrivi e una
  lettura valida. Nomi diversi solo per maiuscole sono rifiutati. Anche l'eliminazione
  richiede una lettura attuale; ultimo programma non eliminabile senza alternativa.
- Prima di scrivere o eliminare un file esistente, dopo backup e journal,
  nuovo Load del file e confronto col riferimento. Un cambiamento del solo file
  salvato, anche senza cambiamento apparente della RAM, blocca Store/Delete.
- Confronto dopo Store/Load e verifica dell'elenco invariati. Delete interessa
  un solo nome, dopo aver caricato un altro file in Reset se necessario. Nessuna
  API Run, uscita fisica o Delete All. Errori senza retry e blocco persistente.
- Il backup include immagine nativa completa, ricetta precedente, elenco e
  richiesta. Il desktop conserva ricevuta completa e, quando rappresentabile,
  la bozza precedente .before.aypi-forno.json e una versione nell'archivio locale.
- service/routes/main IPC: inspect nella stessa esclusione reciproca e nello
  stesso controllo di origine desktop; nessuna estensione del gateway mobile.
- Launcher config: default produzione manage; main propagazione invariata.
  Template runtime aggiornato. Nessun cambiamento a dipendenze o scheduler.

Interfaccia: Invia al forno dall'editor, scelta Nuovo/Sovrascrivi, riepilogo e
conferma esplicita con nome della destinazione. Lista in Reset: selezione carica
il programma per leggerlo, Modifica apre l'editor, Elimina dal forno prepara
la cancellazione. Archivio e cancellazione locale restano distinti dal forno.
Una bozza rinominata propone un nuovo file; non seleziona implicitamente la
sovrascrittura dell'originale. Dopo una mutazione occorre una lettura aggiornata
prima di un'altra modifica. Nessun invio automatico durante il salvataggio locale.

Formati non rappresentabili senza perdita (es. due canali o rampe a velocita)
restano consultabili e non vengono convertiti silenziosamente nell'editor.
Backup nativo completo conservato anche quando non e ricostruibile una bozza.

Verifiche: trasferimenti simulati comprendono nomi ordinari, sovrascrittura dei
preesistenti, backup precedente, lettura di altro programma, cancellazione,
conflitti, cambio modalita, errore Load persistente, confronto del file salvato,
Run/Hold e nessun Run. UI Electron prova lettura, editor, riferimenti e conferme.
La baseline conserva gli otto compilati revisionabili e i 94 file storici invariati.

Verifica finale: 55 test automatici superati e UI Electron completa, inclusi
lettura in Reset, modifica, sovrascrittura, bozza rinominata come nuovo file
ed eliminazione con conferma. Typecheck renderer e build desktop/backend
superati. Verificati otto compilati backend e cinque file desktop nell'ASAR.
Nessuna installazione, pubblicazione o mutazione sul forno eseguita.

Installer verificati:

- dist-backend/AyPi Backend Setup 1.4.1.exe SHA-256 c32f6569af62afd13b0942f8af77aeba1d4ff574a405d7d581c9a22a3ae4561a
- dist/AyPi Setup 1.4.1.exe SHA-256 65aa4daa0916041517a8b03bbb42001ee6531926bc537b5f48fd576b46241da2
