/** Preferenze locali del grafico: nessuna impostazione modifica il collector. */
export const EVENT_LABELS={collector_started:'Avvio raccolta eventi',state_snapshot:'Stato iniziale / ripristino',program_run:'Avvio ciclo (Run)',program_hold:'Pausa (Hold)',program_resume:'Ripresa (Resume)',program_reset:'Reset ciclo',program_complete:'Fine ciclo',segment_start:'Inizio segmento',segment_end:'Uscita segmento',holdback:'Holdback',waiting:'Attesa',pv_event:'Eventi PV',digital_event:'Uscite evento',config_revision:'Revisione configurazione',communication_lost:'Interruzione lettura eventi',communication_restored:'Ripristino lettura eventi'};
export type FornoViewSettings = {
    version: 1;
    theme: 'classic' | 'blue' | 'dark';
    scaleMode: 'auto' | 'zeroMax' | 'manual';
    yMin:number; yMax:number;
    yFixedStep:boolean; yDegreeStep:number; ySubdivisions:number;
    analysisWindowSeconds:number;
    continuousTooltip:boolean;
    continuousTooltipOpacity:number;
    showNotes:boolean;showEvents:boolean;eventTypes:string[];
    xDivisions: number; yDivisions: number;
    xLabelEvery: number; yLabelEvery: number;
    temperatureDecimals: number;
    dateLabels: 'datetime' | 'time';
    showLegend: boolean; showEnvelope: boolean; showPoints: boolean; showDiagnostics: boolean;
    lineWidth: number; gridOpacity: number;
    resolutionMs: number; periodMs: number;
    visibleChannels: number[];
};
export const DEFAULT_VIEW_SETTINGS: FornoViewSettings = {
    version: 1, theme: 'classic', scaleMode: 'auto', xDivisions: 8, yDivisions: 8,
    xLabelEvery: 2, yLabelEvery: 1, temperatureDecimals: 1, dateLabels: 'datetime',
    showLegend: true, showEnvelope: true, showPoints: false, showDiagnostics: false,
    lineWidth: 2, gridOpacity: 18, resolutionMs: 1000, periodMs: 600000,
    visibleChannels: [1, 2, 3, 4],
    yMin:0,yMax:1000,yFixedStep:false,yDegreeStep:10,ySubdivisions:5,analysisWindowSeconds:60,
    continuousTooltip:false,continuousTooltipOpacity:100,
    showNotes:true,showEvents:false,eventTypes:Object.keys(EVENT_LABELS),
};
export const RESOLUTIONS = [500, 1000, 2000, 5000, 10000, 30000, 60000, 300000, 3600000];
export const PERIODS = [60000, 600000, 3600000, 86400000, 604800000, 2592000000];
export function normalizeViewSettings(input: unknown): FornoViewSettings {
    const value: any = input && typeof input === 'object' ? input : {};
    const result = { ...DEFAULT_VIEW_SETTINGS, visibleChannels: [...DEFAULT_VIEW_SETTINGS.visibleChannels],eventTypes:[...DEFAULT_VIEW_SETTINGS.eventTypes] };
    if(Array.isArray(value.eventTypes)&&value.eventTypes.every((t:unknown)=>typeof t==='string'&&Object.prototype.hasOwnProperty.call(EVENT_LABELS,t)))result.eventTypes=[...new Set<string>(value.eventTypes)];
    if (Array.isArray(value.visibleChannels) && value.visibleChannels.every((id:unknown) => Number.isInteger(id) && Number(id)>=1 && Number(id)<=4)) result.visibleChannels = [...new Set<number>(value.visibleChannels)];
    for (const key of ['showLegend', 'showEnvelope', 'showPoints', 'showDiagnostics','yFixedStep','continuousTooltip','showNotes','showEvents']) if (typeof value[key] === 'boolean') result[key] = value[key];
    if(Number.isFinite(value.yMin)&&Number.isFinite(value.yMax)&&value.yMin>=-10000&&value.yMax<=10000&&value.yMax>value.yMin){result.yMin=value.yMin;result.yMax=value.yMax;}
    if(Number.isFinite(value.yDegreeStep)&&value.yDegreeStep>=0.01&&value.yDegreeStep<=1000)result.yDegreeStep=value.yDegreeStep;
    if(Number.isInteger(value.ySubdivisions)&&value.ySubdivisions>=1&&value.ySubdivisions<=10)result.ySubdivisions=value.ySubdivisions;
    if(Number.isFinite(value.analysisWindowSeconds)&&value.analysisWindowSeconds>=0.5&&value.analysisWindowSeconds<=86400&&Number.isSafeInteger(value.analysisWindowSeconds*1000))result.analysisWindowSeconds=value.analysisWindowSeconds;
    for (const [key, min, max] of [['xDivisions', 2, 40], ['yDivisions', 2, 30], ['xLabelEvery', 1, 40], ['yLabelEvery', 1, 30], ['temperatureDecimals', 0, 3], ['lineWidth', 1, 5], ['gridOpacity', 5, 60], ['continuousTooltipOpacity',0,100]] as const) {
        if (Number.isInteger(value[key]) && value[key] >= min && value[key] <= max) result[key] = value[key];
    }
    if (['classic', 'blue', 'dark'].includes(value.theme)) result.theme = value.theme;
    if (['auto', 'zeroMax','manual'].includes(value.scaleMode)) result.scaleMode = value.scaleMode;
    if (['datetime', 'time'].includes(value.dateLabels)) result.dateLabels = value.dateLabels;
    if (RESOLUTIONS.includes(value.resolutionMs)) result.resolutionMs = value.resolutionMs;
    if (PERIODS.includes(value.periodMs)) result.periodMs = value.periodMs;
    return result;
}
/** Numero di intervalli, quindi n + 1 linee; gli estremi sono sempre esatti. */
export function divisionTicks(min: number, max: number, divisions: number) {
    return Array.from({ length: divisions + 1 }, (_, i) => ({ value: i === divisions ? max : min + (max - min) * i / divisions }));
}
export function shouldLabel(index: number, count: number, every: number) {
    return index === 0 || index === count - 1 || index % every === 0;
}
export function dayRange(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Selezionare una data valida');
    const [y, m, d] = value.split('-').map(Number);
    const start = new Date(y, m - 1, d);
    if (start.getFullYear() !== y || start.getMonth() !== m - 1 || start.getDate() !== d) throw new Error('Data non valida');
    const next = new Date(y, m - 1, d + 1);
    return { start: start.getTime(), end: next.getTime() - 1 };
}
