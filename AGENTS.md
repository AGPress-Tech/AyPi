# UI consistency

- Before creating or updating AyPi analysis modules, read [STANDARD_UI_ANALISI_AYPI.md](STANDARD_UI_ANALISI_AYPI.md). It records the Torneria reference, shared source files, established interactions and verification requirements. Keep it updated when user requests change a common UI convention; distinguish current implementation from required behavior.

- Use the established AyPi module UI when adding or changing analysis screens. Analisi Torneria is the reference for chart controls, chart focus, layout controls, chart editors and presets.
- Reuse shared components and styles rather than creating alternate icons, labels, sizes or interactions for existing actions.
- Always retain visible vertical column dividers in tables, for both headers and data cells. Use the shared analysis table styles so users can clearly associate values with their headings.
- Chart headers use the shared `analysis-chart-controls.ts` reset/expand controls and the `.chart-icon` styles. Chart editing belongs in the Grafici menu. Expanded charts use `.chart-focused`, Escape to close, focus restoration and keyboard focus containment.
- Verify changes in Electron at normal and minimum supported window sizes. Check consistency with the existing module, not only whether the new screen works in isolation.
- Keep filters and KPI areas compact so charts and tables retain most of the window height. Put source metadata and calculation explanations in the dedicated information view rather than repeating them in headers, footers and success messages.
- Show order and offer quantities/amounts in separate columns, with one aligned entry per unit or currency. Omit zero-value missing-unit/missing-currency placeholders, but preserve nonzero values whose unit or currency is missing.
- Link dashboard charts through shared selections, as in Torneria: preserve visible totals, highlight the selected share, support Ctrl/Cmd multiple selections, update KPIs/tables together, and let chart reset preserve manual filters. Document detail dialogs should use nearly the full available viewport with internal scrolling.
