# AyPi Releasing

## Versioning
- Update version in `package.json`.

## Build
```bash
npm run build
```

## Auto updates
- Updates are managed by the updater module and electron-builder publish config.
- Releases are published to GitHub as configured in `package.json`.

## Promemoria per la prossima release maggiore

Target probabile: **1.3.3**.

- Verificare che tutte le postazioni AyPi siano state aggiornate alla versione
  che usa il WebSocket centralizzato (`/ws`).
- Quando non risultano più client precedenti, rimuovere la compatibilità
  long polling del pianificatore:
  - endpoint `GET /api/production-planner/changes/:revision`;
  - `waitForProductionPlannerRevision` e `releaseProductionPlannerWaiters`;
  - esclusione dell'endpoint legacy dai log HTTP in `backend/src/app.ts`.
- Conservare il controllo HTTP della revisione come fallback del client
  WebSocket, senza ripristinare il ciclo long polling.
