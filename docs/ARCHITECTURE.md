# AyPi Architecture

## Overview
- Electron app with TypeScript sources under `src/main` and `src/renderer`.
- Main process owns window lifecycle, tray integration, update flow, and IPC endpoints.
- `src/renderer/pages/bluearchive-preview.html` is the single portal for both AGPress and Blue Archive; its sections include Modules, Programs, Articles, Productions, MES - SCADA, Calculator and Utilities.
- Utilities are their own HTML pages with dedicated scripts and styles.

## Structure
- `src/main/main.ts`: app bootstrap, tray, single-instance lock, main window and theme switching.
- `src/main/modules/`: window management and IPC; `file-manager/` contains domain-specific handlers, `robotManager.ts` serves the current robot console, `forgeHub.ts` opens FORGE and `fornoReader.ts` opens furnace supervision.
- `modules/updater.js`: active auto-update integration, copied into the main build.
- `src/renderer/pages/`: the portal and dedicated operational windows; utilities under `utilities/`, shared HTML under `partials/`.
- `src/renderer/scripts/`: portal controller, operational controllers and shared modules. Robot diagnostics live in `forge/robot-console.ts`.
- `src/renderer/modules/utils.ts`: add-in installation and common window helpers; the old standalone portal/sidebar have been removed.
- `src/renderer/styles/`: window styles and shared UI; FORGE animations are under `forge/`.
- `backend/src/`: collection, business services, database persistence and transports. The client reads data through the backend.
- `src/backend-app/`: packaged backend launcher and log viewer.
- `tools/build-ts.js`: creates `dist-ts` from sources. Generated output is recreated on every build.
- `assets/`: icons and static assets.

## Main flows
1) App start
   - Electron initializes, locks single instance, creates main window.
   - Tray is created and menu is built.
   - Auto-updater is initialized.
2) Utilities navigation
   - UI triggers IPC events to open utility windows.
   - `src/main/modules/fileManager.ts` creates and manages windows.
3) Timers/stopwatch
   - Renderer keeps timer state and uses real time deltas for accuracy.
   - IPC sends updates to tray on demand and on state changes.
   - Tray menu requests updates before showing values.
4) Updates
   - `modules/updater` handles auto-update flow.
5) File access
   - Renderer requests dialogs and file operations via IPC.
   - Main process performs OS actions (open, save, open path).
6) Add-in install
   - Renderer downloads and installs the Excel add-in with helpers in `src/renderer/modules/utils.ts`.

## IPC model
- Renderer -> Main
  - Open utility windows.
  - File and folder dialogs.
  - Tray updates for timers/stopwatch.
  - File open requests.
- Main -> Renderer
  - Tray refresh requests before menu opens.
  - Utility window initial data (when needed).

## Window management
- Main window is the entry point for navigation.
- Utility windows are opened without destroying the main window.
- Timers window is hidden on close and can be reopened from tray or UI.

## Data and state
- Most runtime state is kept in renderer memory per window.
- Some presets are stored in `localStorage` (e.g., timers presets).
- User data is stored in `AyPiUserData` under OS app data folder.
