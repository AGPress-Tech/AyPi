# Ripristino backend del 30 ottobre 2026

Riferimento: `dist-backend/AyPi Backend Setup 1.4.0.exe`, modificato alle
13:38:30 del 30/10/2026. SHA-256:
`fa3e843d051f92d3937c67ad86634f9fc2ee42482a24dcb5c738d2e131185409`.

Il riferimento è stato estratto senza eseguire l'installer. Il confronto ha
trovato una sola differenza nei 96 JavaScript compilati del backend e del
launcher: `modules/mobile-gateway/server.js`. Sono stati rimossi dal sorgente
l'import delle rotte forno, la loro registrazione nel gateway Android e la
voce forno nella risposta health. Dopo la compilazione, tutti i 96 file e i
quattro script di installazione corrispondono byte per byte al riferimento.
Anche le versioni dichiarate delle dipendenze runtime coincidono.

Le API forno sul server desktop, i cicli, i grafici delle ricette e le correzioni
desktop restano presenti. Il lavoro Android è conservato ma sospeso: il gateway
mobile non offre le API forno. Gli altri moduli mobile tornano al comportamento
delle 13:38.

## Protezione delle prossime build

`npm run dist:backend` compila e poi esegue `npm run verify:backend:baseline`
prima di creare l'installer. Il controllo verifica gli hash registrati in
`tools/baselines/backend-1.4.0-1338.json` e rifiuta JavaScript aggiuntivi nelle
cartelle compilate. Se il backend cambia, la creazione del pacchetto si ferma.
Le future modifiche intenzionali richiederanno una revisione di questo vincolo.
Il comando di build desktop resta indipendente.

Il numero versione generale del progetto resta 1.4.1 per preservare il lavoro
desktop; non identifica il contenuto del backend ripristinato. Non è stato
prodotto né installato un nuovo backend: quello delle 13:38 già reinstallato
dall'utente resta il riferimento da utilizzare.

I pacchetti backend 1.4.1, la cartella backend estratta e il bundle misto
desktop/backend/Android sono archiviati localmente sotto
`.snapshots/backend-prima-ripristino-1338-20261030/pacchetti-ritirati/`.
Gli installer desktop e il backend 1.4.0 delle 13:38 restano nelle cartelle
originali. La stessa snapshot conserva il sorgente gateway prima del ripristino.

## Verifiche e limiti

Superati: compilazione backend e launcher, corrispondenza dei 100 file,
test delle API desktop e dell'assenza delle API forno nel gateway mobile,
lettura ricette e ripristino simulati, acquisizione/storico/eventi/note,
trasporto dati e interfaccia Electron desktop. I test usano servizi simulati
e porte locali; nessuna prova sul forno fisico durante questo ripristino.

Non sono state modificate regole firewall, configurazioni di rete o
l'installazione sul server. Il confronto del codice non permette di stabilire
la causa del blocco di rete segnalato: servirebbero i log del server/firewall.
