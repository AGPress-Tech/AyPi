# AyPi Architecture

## Overview
- Electron app with a main process (`main.js`) and multiple renderer pages under `pages/`.
- Main process owns window lifecycle, tray integration, update flow, and IPC endpoints.
- Renderer pages handle UI and domain logic for each section (Modules, Programs, Articles, Productions, Robot, Calculator, Utilities).
- Utilities are their own HTML pages with dedicated scripts and styles.

## Structure
- `main.js`: app bootstrap, tray, single-instance lock, main window, IPC for tray data.
- `modules/`
  - `fileManager.js`: IPC handlers, dialog helpers, and creation/management of utility windows.
  - `updater.js`: auto-update integration.
  - `robotManager.js`: robot-related IPC and flows.
  - `utils.js`: shared renderer-side helpers (sidebar, clock, add-in install).
- `pages/`
  - Root navigation pages (Modules, Programs, Articles, Productions, Robot, Calculator, Utilities).
  - Utility pages under `pages/utilities/` (e.g., timers, batch rename, compare folders).
- `scripts/`
  - Section scripts (e.g., `programmi-scripts.js`, `robot-scripts.js`).
  - Utility scripts under `scripts/utilities/` (e.g., timers, batch rename).
- `styles/`
  - Page styles and utility styles under `styles/utilities/`.
- `assets/`: icons and static assets.

## Main flows
1) App start
   - Electron initializes, locks single instance, creates main window.
   - Tray is created and menu is built.
   - Auto-updater is initialized.
2) Utilities navigation
   - UI triggers IPC events to open utility windows.
   - `modules/fileManager.js` creates and manages windows.
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
   - Renderer downloads and installs the Excel add-in with helpers in `modules/utils.js`.

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
