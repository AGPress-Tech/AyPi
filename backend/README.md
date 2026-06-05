# AyPi Backend

Backend generale di `AyPi`.

Primo modulo migrato:

- `ferie-permessi`

Comandi dal repository root:

- `npm run start:backend`
- `npm run build:backend`
- `npm run start:backend:tray`
- `npm run dist:backend`

Profili:

- `start:backend` usa profilo `dev`
  - host `127.0.0.1`
  - dati `C:\Users\admin\Desktop\AyPi\AGPRESS`
- `dist:backend` produce un installer Windows per il backend server
  - host `192.168.1.240`
  - calendar `\\Dl360\pubbliche\TECH\AyPi\AGPRESS\AyPi Calendar`
  - general `\\Dl360\pubbliche\TECH\AyPi\AGPRESS\General`

Configurazione runtime opzionale:

- file `aypi-backend.runtime.json` accanto all'exe
- oppure env:
  - `AYPI_BACKEND_HOST`
  - `AYPI_BACKEND_ADVERTISED_HOST`
  - `AYPI_BACKEND_PORT`
  - `AYPI_FP_CALENDAR_DIR`
  - `AYPI_FP_GENERAL_DIR`
  - `AYPI_LOG_DIR`

Avvio automatico server:

- senza wrapper esterni, usare il task script:
  - `backend/scripts/install-server-task.ps1`
  - `backend/scripts/uninstall-server-task.ps1`
- il task avvia l'exe con `--headless`
