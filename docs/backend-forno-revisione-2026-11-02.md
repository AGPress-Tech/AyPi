# Revisione del backend per il programmatore forno

Il blocco della distribuzione ha rilevato due differenze rispetto all'installer
1.4.0 del 30/10/2026 alle 13:38. Sono le modifiche richieste per la lettura
completa dei programmi e per impedire caricamenti sul forno durante il lavoro
sull'archivio locale. Non si ripristinano le vecchie versioni di questi file,
perché si perderebbero gli eventi ausiliari e il blocco del caricamento.

## Confronto effettuato

I due JavaScript originali sono stati estratti dall'ASAR conservato in
`.tmp-backend-rollback-1338/resources/app.asar`. Prima del confronto sono
stati verificati contro gli hash del riferimento storico:

- `program-recipe.js`: `0cb5fba79589592c2542f016645494e787a7de1482a3f4dfd0e10c6abbb1be59`.
- `service.js`: `02215dc408ccabdda273068e2f88a1eeb01ddf2edcad585c479f445e03965b4a`.

Il diff di `program-recipe.js` aggiunge esclusivamente:

- Decodifica degli otto eventi per segmento, inclusi bool nativi a maschera
  (1/2/4), valori utente, soglie e criteri di Holdback/Wait/eventi PV.
- Conservazione dei word originali dei segmenti.
- Tre letture FC03 per massimo eventi/stati di Reset, funzioni abilitate e
  valori utente di Reset, con validazione del massimo di otto eventi.
- Esposizione dei nuovi campi nella risposta della ricetta.

Non modifica il trasporto Modbus, non aggiunge scritture e non modifica la
raccolta delle temperature. Il diff di `service.js` aggiunge soltanto il
rifiuto HTTP 409 di `allowTemporaryLoad:true`, prima di accedere al forno.
Il percorso pubblico non può quindi attivare il precedente Load temporaneo.
L'editor, l'archivio, i backup e la preparazione dei file nativi restano locali
nel client; nessuna API di Store/Delete o azionamento relè viene introdotta.

## Riferimenti di distribuzione

`tools/baselines/backend-1.4.0-1338.json` rimane immutato. Il nuovo manifest
`tools/baselines/backend-forno-programmatore-2026-11-02.json` registra per i
soli due file gli hash precedenti, quelli revisionati, gli hash dei relativi
sorgenti e la motivazione. È collegato allo SHA-256 dell'installer storico.

`npm run verify:backend:baseline` richiede la combinazione completa revisionata:
98 file ancora identici al riferimento storico e i due file forno identici
alla revisione, con i sorgenti corrispondenti. Le dipendenze devono restare
identiche; i JavaScript aggiuntivi continuano a bloccare il pacchetto. Non
sono accettate combinazioni miste con il vecchio servizio, né eccezioni sul
gateway mobile, sul launcher o sugli script di installazione.

`node tools/verify-backend-baseline.cjs --historical` mantiene il confronto
integrale originario; sulla nuova build segnala intenzionalmente le due
differenze. Non è una modalità per aggirare il controllo della distribuzione.

## Verifiche

- `node --test tools/test-backend-baseline.cjs`: accettazione dei soli hash
  esaminati; rifiuto di modifiche a compilati/sorgenti/gateway, dipendenze,
  file aggiuntivi o mancanti e revisioni non riferite alla baseline.
- Test programmi, lettura degli eventi e archivio locale, incluso il rifiuto
  del caricamento temporaneo prima dell'accesso al dispositivo.
- `node --test tools/test-forno-mobile-gateway.cjs`: gateway Android ancora
  senza API forno; rotte desktop presenti.

Le verifiche usano simulatori e file locali. Nessuna modifica al server
installato, alle regole di rete o ai programmi del forno è necessaria per
produrre il pacchetto locale.

## Pacchetto locale prodotto

`npm run dist:backend` completato: `dist-backend/AyPi Backend Setup 1.4.1.exe`.
SHA-256: `673bf4d69960dd3ad6cda4f0126f143e46cdaa9d74cbc42f202c7804195f2819`.
Verificati nell'ASAR/risorse del pacchetto tutti i 100 file attesi e l'assenza
di JavaScript aggiuntivi nelle due cartelle compilate. L'installer storico
1.4.0 conserva il proprio SHA-256 originario.

Superato anche `node tools/test-forno-packaged-messages.cjs`, che usa
l'eseguibile distribuito, un nanodac TCP simulato e un database temporaneo:
quattro canali, eventi, note, conflitti HTTP 409, storico e riconnessione.
Il pacchetto è stato creato e verificato localmente, senza installarlo sul server.
