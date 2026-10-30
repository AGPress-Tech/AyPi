import Chart from 'chart.js/auto';
import { buildRecipeProfile, recipeDuration, type ProgramRecipe } from './recipe-profile';

export function createRecipeChart(root: HTMLElement, recipe: ProgramRecipe) {
    const node = (tag: string, className: string, text?: string) => { const n = document.createElement(tag); n.className = className; if (text !== undefined) n.textContent = text; return n; };
    const temperature = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 2 }) + ' °C';
    const color = (key: string) => getComputedStyle(document.documentElement).getPropertyValue(key).trim();
    let chart: Chart | null = null, selected = -1;
    const summary = node('div', 'recipe-summary');
    const layout = node('div', 'recipe-layout'), plotCard = node('section', 'recipe-plot-card');
    const plotHeading = node('div', 'recipe-plot-heading');
    plotHeading.append(node('div', 'eyebrow', 'PROFILO TEMPERATURA'), node('span', 'recipe-chart-key', recipe.channels === 1 ? 'Setpoint programmato · CH1' : 'Setpoint programmati · CH1 / CH2'));
    const plot = node('div', 'recipe-plot'), canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img'); plot.append(canvas);
    const startControl = node('label', 'recipe-start'); startControl.append(node('span', '', 'Temperatura iniziale dell’anteprima'));
    const input = document.createElement('input'); input.type = 'number'; input.min = '-10000'; input.max = '10000'; input.step = '0.1'; input.value = '0'; input.setAttribute('aria-label', 'Temperatura iniziale anteprima in gradi Celsius');
    startControl.append(input, node('span', '', '°C'));
    plotCard.append(plotHeading, plot, startControl, node('p', 'recipe-footnote', 'La partenza effettiva dipende dal setpoint o dalla temperatura del forno all’avvio. Questa anteprima non modifica il nanodac.'));
    const side = node('section', 'recipe-phases'); side.setAttribute('aria-label', 'Fasi del programma');
    layout.append(plotCard, side);
    const warnings = node('div', 'recipe-warnings');
    const source = node('p', 'recipe-source', 'Letto dal nanodac · ' + new Date(recipe.readAtMs).toLocaleString('it-IT'));
    root.replaceChildren(summary, layout, warnings, source);
    const buttons: HTMLButtonElement[] = [];
    function select(index: number) { selected = index; buttons.forEach((b, i) => { b.classList.toggle('selected', i === index); b.setAttribute('aria-pressed', String(i === index)); }); chart?.draw(); }
    function render() {
        if (!input.checkValidity()) return;
        const profile = buildRecipeProfile(recipe, Number(input.value));
        selected = -1; buttons.length = 0; chart?.destroy(); summary.replaceChildren(); side.replaceChildren(); warnings.replaceChildren();
        const metric = (label: string, value: string, kind = '') => { const n = node('div', 'recipe-metric ' + kind); n.append(node('span', '', label), node('strong', '', value)); return n; };
        summary.append(metric('Durata programmata', profile.durationSeconds === null ? 'Variabile' : recipeDuration(profile.durationSeconds), 'recipe-duration'), metric(profile.durationSeconds === null ? 'Massima nel tratto mostrato' : 'Temperatura massima', temperature(profile.maximum)), metric('Fasi visualizzate', String(profile.phases.length)), metric('Fine programma', profile.endType === 1 ? 'Reset' : profile.endType === 0 ? 'Mantieni' : 'Da determinare'));
        side.append(node('h3', '', 'Le fasi del ciclo'), node('p', 'recipe-phases-intro', 'Seleziona una fase per evidenziarla sul grafico.'));
        const phaseList = node('div', 'recipe-phase-list');
        for (const phase of profile.phases) {
            const s = phase.segment, button = document.createElement('button'); button.type = 'button'; button.className = 'recipe-phase'; button.dataset.kind = String(s.type); button.setAttribute('aria-pressed', 'false');
            const number = node('span', 'recipe-phase-number', String(s.number).padStart(2, '0'));
            const body = node('span', 'recipe-phase-body');
            const title = s.type === 1 ? (phase.end[0] >= phase.start[0] ? 'Rampa di salita' : 'Rampa di discesa') : s.type === 2 ? 'Sosta' : 'Salto di setpoint';
            body.append(node('strong', '', title), node('span', '', s.type === 2 ? temperature(phase.end[0]) : temperature(phase.start[0]) + ' → ' + temperature(phase.end[0])), node('small', '', recipeDuration(phase.from) + ' → ' + recipeDuration(phase.to)));
            if (recipe.channels === 2) body.append(node('small', '', 'CH2: ' + temperature(phase.start[1]) + ' → ' + temperature(phase.end[1])));
            if (s.name && s.name !== String(s.number)) body.append(node('small', 'recipe-segment-name', s.name));
            button.append(number, body, node('span', 'recipe-phase-duration', recipeDuration(phase.to - phase.from)));
            button.addEventListener('click', () => select(phase.index)); phaseList.append(button); buttons.push(button);
        }
        side.append(phaseList);
        for (const message of profile.warnings) warnings.append(node('p', '', message));
        const maxHours = Math.max(profile.shownSeconds / 3600, 1 / 60), ink = color('--ink'), muted = color('--muted'), line = color('--line');
        const colors = ['#ec8627', '#3296dc'];
        chart = new Chart(canvas, {
            type: 'line', data: { datasets: profile.points.map((points, ch) => ({ label: 'CH' + (ch + 1), data: points, parsing: false, borderColor: colors[ch], backgroundColor: colors[ch] + '13', borderWidth: 3, pointRadius: profile.phases.length > 40 ? 0 : 3, pointHoverRadius: 6, pointBackgroundColor: color('--surface'), pointBorderWidth: 2, tension: 0, fill: ch === 0 })) },
            options: { responsive: true, maintainAspectRatio: false, animation: false, normalized: false,
                layout: { padding: { top: 27, right: 17, left: 4 } },
                interaction: { mode: 'nearest', intersect: false },
                onClick: (_event, items) => { const item = items[0]; if (item) select(profile.points[item.datasetIndex][item.index].phase); },
                plugins: { legend: { display: recipe.channels === 2, labels: { color: muted, usePointStyle: true, boxWidth: 7 } },
                    tooltip: { displayColors: recipe.channels === 2, backgroundColor: '#182b3a', padding: 12, titleFont: { size: 12 }, bodyFont: { size: 13 }, callbacks: {
                        title: items => recipeDuration(Number(items[0]?.parsed.x || 0) * 3600),
                        label: context => `${context.dataset.label}: ${temperature(context.parsed.y)}`,
                        afterBody: items => { const point = items[0]?.raw as { phase: number }; const phase = profile.phases[point?.phase]; return phase ? `Fase ${phase.segment.number} · ${recipeDuration(phase.to - phase.from)}` : ''; },
                    } } },
                scales: { x: { type: 'linear', min: 0, max: maxHours, border: { display: false }, title: { display: true, text: 'Tempo dall’inizio [h]', color: muted }, grid: { color: line + '80' }, ticks: { color: muted, maxTicksLimit: 9, callback: value => Number(value).toLocaleString('it-IT', { maximumFractionDigits: 2 }) } },
                    y: { min: Math.min(0, Math.floor(profile.minimum / 50) * 50), suggestedMax: Math.ceil(profile.maximum / 50) * 50 + 30, border: { display: false }, title: { display: true, text: 'Temperatura [°C]', color: muted }, grid: { color: line + '80' }, ticks: { color: muted, maxTicksLimit: 7 } } } },
            plugins: [{ id: 'recipe-phases', beforeDatasetsDraw(c) {
                const { ctx, chartArea: area, scales } = c; ctx.save();
                for (const phase of profile.phases) {
                    const left = scales.x.getPixelForValue(phase.from / 3600), right = scales.x.getPixelForValue(phase.to / 3600);
                    ctx.fillStyle = selected === phase.index ? '#3296dc24' : phase.segment.type === 2 ? '#3296dc07' : '#ec862707';
                    ctx.fillRect(left, area.top, right - left, area.bottom - area.top);
                    if (right - left > 38 && profile.phases.length < 20) { ctx.fillStyle = selected === phase.index ? ink : muted; ctx.font = '600 10px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('FASE ' + phase.segment.number, (left + right) / 2, area.top - 14); }
                }
                ctx.restore();
            }, afterDatasetsDraw(c) {
                if (profile.phases.length > 20) return;
                const { ctx, scales } = c; ctx.save(); ctx.fillStyle = ink; ctx.font = '600 11px Segoe UI'; ctx.textAlign = 'center';
                let last = Number.NaN;
                profile.points[0].forEach((point, i) => { if (!i || point.y === last) return; last = point.y; ctx.fillText(temperature(point.y), Math.min(c.chartArea.right - 25, scales.x.getPixelForValue(point.x)), scales.y.getPixelForValue(point.y) - 12); });
                ctx.restore();
            } }],
        });
        canvas.setAttribute('aria-label', `${recipe.name}: profilo da ${temperature(Number(input.value))}, massimo ${temperature(profile.maximum)}, ${profile.durationSeconds === null ? 'durata variabile' : recipeDuration(profile.durationSeconds)}. Le fasi sono elencate a fianco.`);
    }
    input.addEventListener('change', () => { try { render(); } catch (error) { warnings.replaceChildren(node('p', '', (error as Error).message)); } });
    try { render(); } catch (error) { chart?.destroy(); throw error; }
    return () => chart?.destroy();
}
