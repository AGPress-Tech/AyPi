# UI consistency

- Every AyPi wordmark uses the shared geometry in `utilities/aypi-module-brand.css`: Ay, Pi, ellipse/halo and diagonal slash. Retain all four parts in headers and logins; keep the host theme palette and intended size. Audit all existing wordmark variants when changing branding (`tools/test-aypi-brand-ui.cjs`).
- Similar module headers share a compact 70px minimum height, 9px vertical padding and small explicit title margins through the shared operations styles. Allow responsive wrapping when necessary instead of clipping controls. Settings actions stay on one row; remove buttons are square and align with their input fields.

- Before creating or updating AyPi analysis modules, read [STANDARD_UI_ANALISI_AYPI.md](STANDARD_UI_ANALISI_AYPI.md). It records the Torneria reference, shared source files, established interactions and verification requirements. Keep it updated when user requests change a common UI convention; distinguish current implementation from required behavior.

- Use the established AyPi module UI when adding or changing analysis screens. Analisi Torneria is the reference for chart controls, chart focus, layout controls, chart editors and presets.
- Reuse shared components and styles rather than creating alternate icons, labels, sizes or interactions for existing actions.
- Analysis table context menus use `analysis-links.ts` and `analysis-navigation.ts`: offer verified related modules for the clicked article/supplier/customer/document cell, reuse open windows and apply the exact context without closing the source view. Keep purchase and sales document identifiers distinct; generic value cells must not inherit row-wide navigation actions.
- Module login forms retain the shared AyPi branding and theme palette: Blue Archive or AGPress. Reuse `utilities/aypi-login.css` and initialize the selected theme before rendering; do not hardcode a blue login for both themes.
- Always retain visible vertical column dividers in tables, for both headers and data cells. Use the shared analysis table styles so users can clearly associate values with their headings.
- Keep the entire table header fixed during vertical scrolling, above pinned body columns. Filter panels close on an outside pointer click, retaining their values; use the shared bootstrap behavior. Creation buttons use the theme accent outline. Advanced filters show labeled standard fields first, with custom conditions and presets available afterward.
- Chart headers use the shared `analysis-chart-controls.ts` reset/expand controls and the `.chart-icon` styles. Chart editing belongs in the Grafici menu. Expanded charts use `.chart-focused`, Escape to close, focus restoration and keyboard focus containment.
- Verify changes in Electron at normal and minimum supported window sizes. Check consistency with the existing module, not only whether the new screen works in isolation.
- Keep filters and KPI areas compact so charts and tables retain most of the window height. Put source metadata and calculation explanations in the dedicated information view rather than repeating them in headers, footers and success messages.
- Leave enough internal padding in scrolling forms and filter panels to keep input focus outlines fully visible.
- Show order and offer quantities/amounts in separate columns, with one aligned entry per unit or currency. Omit zero-value missing-unit/missing-currency placeholders, but preserve nonzero values whose unit or currency is missing.
- Link dashboard charts through shared selections, as in Torneria: preserve visible totals, highlight the selected share, support Ctrl/Cmd multiple selections, update KPIs/tables together, and let chart reset preserve manual filters. Document detail dialogs should use nearly the full available viewport with internal scrolling.

- Long tables append subsequent rows on scrolling instead of Previous/Next pagination; preserve existing rows, expanded details, scroll position and full-selection sorting/filtering/export. Reuse `table-scroll-loader.ts` for local data.
- Shared chart visibility menus keep checkboxes beside their labels. Legends use readable, high-contrast text and adapt their placement to available panel space; preserve series toggles and keyboard access.
