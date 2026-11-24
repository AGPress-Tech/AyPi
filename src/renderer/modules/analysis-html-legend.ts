import type { Plugin } from "chart.js";
type LegendState = {
    panel: HTMLElement;
    viewport: HTMLElement;
    wrapper: HTMLElement;
    list: HTMLUListElement;
    signature: string;
};
const states = new WeakMap<object, LegendState>(),
    enabled = new WeakSet<object>();
/** HTML text stays crisp at every scale and is independent of selection opacity. */
export const analysisHtmlLegend: Plugin = {
    id: "analysisHtmlLegend",
    beforeInit(chart) {
        if (chart.options.plugins?.legend?.display) {
            enabled.add(chart);
            chart.options.plugins.legend.display = false;
        }
    },
    afterUpdate(chart) {
        if (!enabled.has(chart)) return;
        let state = states.get(chart);
        if (!state) {
            const viewport = chart.canvas?.parentElement,
                panel = viewport?.closest<HTMLElement>(
                    ".panel,.chart-panel,.chart-card",
                );
            if (!viewport || !panel) return;
            const wrapper = document.createElement("div"),
                list = document.createElement("ul");
            wrapper.className = "analysis-chart-content";
            list.className = "analysis-html-legend";
            list.setAttribute("aria-label", "Legenda del grafico");
            viewport.before(wrapper);
            wrapper.append(viewport, list);
            panel.classList.add("analysis-html-legend-panel");
            state = { panel, viewport, wrapper, list, signature: "" };
            states.set(chart, state);
        }
        const items = chart.options.plugins.legend.labels.generateLabels(chart),
            datasets = chart.data.datasets as any[];
        const rendered = items.map((item) => {
            const dataset = datasets[item.datasetIndex ?? 0],
                colors = dataset?.highlightColors;
            let swatch = colors?.[item.index ?? 0] || item.fillStyle;
            if (!colors && typeof dataset?.borderColor === "string")
                swatch = dataset.borderColor;
            return {
                item,
                swatch: typeof swatch === "string" ? swatch : "#718397",
            };
        });
        const signature = JSON.stringify(
            rendered.map(({ item, swatch }) => [
                item.text,
                item.hidden,
                swatch,
                item.index,
                item.datasetIndex,
            ]),
        );
        if (signature === state.signature) return;
        state.signature = signature;
        const focused = state.list.contains(document.activeElement)
            ? (document.activeElement as HTMLElement).dataset.legendIndex
            : null;
        state.list.replaceChildren(
            ...rendered.map(({ item, swatch }, index) => {
                const row = document.createElement("li"),
                    button = document.createElement("button"),
                    sample = document.createElement("span"),
                    text = document.createElement("span");
                button.type = "button";
                button.dataset.legendIndex = String(index);
                button.setAttribute("aria-pressed", String(!item.hidden));
                button.className = item.hidden ? "is-hidden" : "";
                sample.className = "analysis-legend-swatch";
                sample.style.backgroundColor = swatch;
                sample.setAttribute("aria-hidden", "true");
                text.textContent = item.text;
                button.append(sample, text);
                button.onclick = () => {
                    if (
                        (chart.config as any).type === "doughnut" ||
                        (chart.config as any).type === "pie"
                    )
                        chart.toggleDataVisibility(item.index!);
                    else
                        chart.setDatasetVisibility(
                            item.datasetIndex!,
                            !chart.isDatasetVisible(item.datasetIndex!),
                        );
                    chart.update();
                };
                row.append(button);
                return row;
            }),
        );
        if (focused != null)
            state.list
                .querySelector<HTMLElement>(`[data-legend-index="${focused}"]`)
                ?.focus({ preventScroll: true });
    },
    afterDestroy(chart) {
        const state = states.get(chart);
        if (state) {
            state.wrapper.replaceWith(state.viewport);
            state.panel.classList.remove("analysis-html-legend-panel");
            states.delete(chart);
        }
        enabled.delete(chart);
    },
};
