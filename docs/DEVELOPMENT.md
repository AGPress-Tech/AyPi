# Sviluppo AyPi

Installare Node.js e le dipendenze con `npm ci`.

## Avvio e build

- `npm run build:ts`: compila main e renderer in `dist-ts`.
- `npx electron .`: avvia il client compilato.
- `npm run start:bluearchive`: build e avvio della preview del portale.
- `npm run build`: genera l'installer desktop in `dist`.
- `npm run dist:backend`: compila, verifica la baseline e genera il backend
  in `dist-backend`. Non installa il server e non scrive sul forno.
- `npm run check:assets`: verifica i riferimenti HTML/CSS degli asset compilati.

Le build non richiedono le cartelle temporanee di indagini precedenti.
Android richiede inoltre JDK e Android SDK configurati nell'ambiente locale.

## Sorgenti e output

- `src/main`: Electron, IPC e accesso ai servizi.
- `src/renderer`: pagine, script e stili.
- `backend/src`: servizi centrali e acquisizione.
- `src/backend-app`: launcher del backend.
- `modules/updater.js`: updater attivo, copiato durante la build.
- `tools`: build, controlli e test con simulatori o cartelle temporanee.

`dist-ts`, `backend-dist` e `dist-backend-app` sono compilati rigenerabili.
`dist` e `dist-backend` contengono i pacchetti locali. Non sono sorgenti.
Gli snapshot e i vecchi installer possono essere archiviati fuori dal checkout.
Non rimuovere migrazioni o compatibilita dei database solo perche indicate
come legacy: servono le installazioni esistenti.

## Verifiche

```powershell
npm run test:forno:programs
npm run test:forno
npm run test:forno:view
npm run test:forno:transport
node tools/test-forno-ui.cjs
npm run verify:backend:baseline
```

Compilare il backend e il launcher prima dei test che leggono i compilati.
I test dei programmi usano simulatori: non inviano scritture al forno reale.
La baseline storica e la revisione corrente sono entrambe necessarie al
controllo della distribuzione; le vecchie revisioni intermedie non lo sono.

Per gli altri moduli i test mirati sono in `tools/test-*.cjs` e
`tools/test-production-planner-state.js`. Le verifiche Electron si eseguono
con `node tools/test-<nome>.cjs`, quelle Node con `node --test`.

Vedere anche [architettura](ARCHITECTURE.md), [rilasci](RELEASING.md) e
[programmi forno](forno.md).
