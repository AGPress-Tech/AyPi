import type Chart from 'chart.js/auto';

type Range = { start: number; end: number };
type Callbacks = {
    range(): Range;
    move(start: number, end: number): void;
    commit(): void;
    select(start: number, end: number): void;
};

/** Camera locale: nessuna richiesta di rete durante il movimento del mouse. */
export function attachChartInteractions(chart: Chart<'line'>, callbacks: Callbacks) {
    const canvas=chart.canvas;
    const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let frame=0, zoom: (Range & { from: Range; at: number }) | null=null;
    let pending: Range | null=null;
    let drag: (Range & { x: number; current: number; width: number; left: number; select: boolean }) | null=null;
    let suppressClick=false;
    const hoverRadius=24;
    let hoverPosition:{clientX:number;clientY:number}|null=null;
    let settled=false,latched=false;
    function point(event: Pick<MouseEvent,'clientX'|'clientY'>) {
        const rect=canvas.getBoundingClientRect();
        return {x:(event.clientX-rect.left)*chart.width/rect.width,y:(event.clientY-rect.top)*chart.height/rect.height};
    }
    function inside(p:{x:number;y:number}) {
        const a=chart.chartArea;return p.x>=a.left&&p.x<=a.right&&p.y>=a.top&&p.y<=a.bottom;
    }
    function clearTooltip(draw=true) {
        const hasTooltip=!!chart.tooltip?.getActiveElements().length;
        const hasActive=chart.getActiveElements().length>0;
        if(hasTooltip)chart.tooltip!.setActiveElements([],{x:0,y:0});
        if(hasActive)chart.setActiveElements([]);
        if(draw&&(hasTooltip||hasActive))chart.draw();
    }
    function hideTooltip() {
        clearTimeout(hoverTimer);hoverTimer=undefined;
        hoverPosition=null;settled=false;latched=false;clearTooltip();
    }
    function stopMotion() {cancelAnimationFrame(frame);frame=0;zoom=null;pending=null;}
    function paint(now:number) {
        frame=0;
        if(pending) {const p=pending;pending=null;callbacks.move(p.start,p.end);}
        if(zoom) {
            const progress=Math.min(1,(now-zoom.at)/160),ease=1-Math.pow(1-progress,3);
            callbacks.move(zoom.from.start+(zoom.start-zoom.from.start)*ease,zoom.from.end+(zoom.end-zoom.from.end)*ease);
            if(progress<1)frame=requestAnimationFrame(paint);else zoom=null;
        }
    }
    function requestPaint() {if(!frame)frame=requestAnimationFrame(paint);}
    function pan() {
        if(!drag||drag.select)return;
        const shift=(drag.x-drag.current)/drag.width*(drag.end-drag.start);
        pending={start:drag.start+shift,end:drag.end+shift};requestPaint();
    }
    function showTooltip(p:{x:number;y:number}) {
        if(drag||zoom||pending||!inside(p))return;
        // Distance to actual finite line segments, including both endpoints.
        // A nearest-index lookup alone also matches far outside the data range.
        let best=hoverRadius*hoverRadius,hit:{datasetIndex:number;index:number}|null=null;
        for(let datasetIndex=2;datasetIndex<chart.data.datasets.length;datasetIndex+=3) {
            if(!chart.isDatasetVisible(datasetIndex))continue;
            const points=chart.getDatasetMeta(datasetIndex).data as any[];
            for(let i=0;i<points.length;i++) {
                const b=points[i];if(b.skip||!Number.isFinite(b.y))continue;
                const previous=points[i-1],a=previous&&!previous.skip&&Number.isFinite(previous.y)?previous:b;
                const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
                // Una volta aperto, segue il tempo sotto il cursore fermo anche
                // quando la temperatura o la scala verticale cambiano nel live.
                const projection=latched?(dx?(p.x-a.x)/dx:0):length?((p.x-a.x)*dx+(p.y-a.y)*dy)/length:0;
                const t=Math.max(0,Math.min(1,projection));
                const distance=(p.x-a.x-t*dx)**2+(latched?0:(p.y-a.y-t*dy)**2);
                if(distance<=best){best=distance;hit={datasetIndex,index:t<0.5&&a!==b?i-1:i};}
            }
        }
        if(!hit){latched=false;clearTooltip();return;}
        const active=[];
        for(let datasetIndex=2;datasetIndex<chart.data.datasets.length;datasetIndex+=3) {
            const item=chart.getDatasetMeta(datasetIndex).data[hit.index] as any;
            if(chart.isDatasetVisible(datasetIndex)&&item&&!item.skip)active.push({datasetIndex,index:hit.index});
        }
        latched=true;
        chart.tooltip!.setActiveElements(active,p);chart.draw();
    }
    function onMove(event: PointerEvent) {
        if(!drag&&hoverPosition?.clientX===event.clientX&&hoverPosition?.clientY===event.clientY)return;
        const p=point(event);hideTooltip();
        if(drag) {
            drag.current=drag.select?Math.max(drag.left,Math.min(drag.left+drag.width,p.x)):p.x;
            if(drag.select)chart.draw();else pan();
            return;
        }
        canvas.style.cursor=inside(p)?event.ctrlKey?'crosshair':'grab':'default';
        if(inside(p)) {
            hoverPosition={clientX:event.clientX,clientY:event.clientY};
            hoverTimer=setTimeout(()=>{hoverTimer=undefined;settled=true;if(hoverPosition)showTooltip(point(hoverPosition));},500);
        }
    }
    function onDown(event: PointerEvent) {
        const p=point(event);if(event.button!==0||!inside(p))return;
        hideTooltip();clearTimeout(wheelTimer);wheelTimer=undefined;stopMotion();
        const range={start:chart.scales.x.min,end:chart.scales.x.max};
        drag={...range,x:p.x,current:p.x,width:chart.chartArea.width,left:chart.chartArea.left,select:event.ctrlKey};
        canvas.style.cursor=drag.select?'crosshair':'grabbing';canvas.setPointerCapture(event.pointerId);
    }
    function onUp(event: PointerEvent) {
        if(!drag)return;
        const p=drag;
        if(Math.abs(p.current-p.x)>=4)pan();
        if(pending){const next=pending;stopMotion();callbacks.move(next.start,next.end);}
        drag=null;canvas.style.cursor='grab';chart.draw();
        if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
        suppressClick=Math.abs(p.current-p.x)>=4;
        if(!suppressClick)return;
        if(p.select) {
            const at=(x:number)=>p.start+(x-p.left)/p.width*(p.end-p.start);
            callbacks.select(Math.round(Math.min(at(p.x),at(p.current))),Math.round(Math.max(at(p.x),at(p.current))));
        }else callbacks.commit();
    }
    function onCancel(event: PointerEvent) {
        if(!drag)return;
        const p=drag;drag=null;stopMotion();hideTooltip();canvas.style.cursor='grab';
        if(!p.select)callbacks.move(p.start,p.end);
        if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
        chart.draw();
    }
    function onWheel(event: WheelEvent) {
        const p=point(event);if(!inside(p)||drag)return;
        event.preventDefault();hideTooltip();
        const range=zoom||callbacks.range(),ratio=(p.x-chart.chartArea.left)/chart.chartArea.width;
        const factor=event.deltaY<0?0.8:1.25,span=Math.max(1000,Math.min(365*86400000,(range.end-range.start)*factor));
        const anchor=range.start+ratio*(range.end-range.start),start=Math.max(0,anchor-ratio*span);
        if(reducedMotion.matches)callbacks.move(start,start+span);
        else {zoom={start,end:start+span,from:callbacks.range(),at:performance.now()};requestPaint();}
        clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelTimer=undefined;callbacks.commit();},240);
    }
    function onClick(event:MouseEvent) {
        // Chart.js usa il click anche per attivare i punti: nel plot serve solo
        // la navigazione, mentre i click sulla legenda restano disponibili.
        if(suppressClick||inside(point(event))){event.stopImmediatePropagation();hideTooltip();}
        suppressClick=false;
    }
    function onLeave(){hideTooltip();if(!drag)canvas.style.cursor='default';}
    canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerdown',onDown);
    canvas.addEventListener('pointerup',onUp);canvas.addEventListener('pointercancel',onCancel);
    canvas.addEventListener('pointerleave',onLeave);canvas.addEventListener('wheel',onWheel,{passive:false});
    canvas.addEventListener('click',onClick,true);
    return {
        hideTooltip,
        // Rimuove gli indici prima che cambino i dataset, senza perdere lo stato
        // del cursore. Il tooltip viene ricostruito nello stesso aggiornamento.
        beforeChartUpdate(){clearTooltip(false);},
        afterChartUpdate(){if(hoverPosition&&settled)showTooltip(point(hoverPosition));},
        get busy(){return !!(drag||zoom||wheelTimer);},
        drawSelection() {
            if(!drag?.select)return;
            const {ctx,chartArea}=chart;ctx.save();ctx.fillStyle='#2994dc22';ctx.strokeStyle='#2994dc';
            ctx.fillRect(drag.x,chartArea.top,drag.current-drag.x,chartArea.height);
            ctx.strokeRect(drag.x,chartArea.top,drag.current-drag.x,chartArea.height);ctx.restore();
        },
        dispose() {
            hideTooltip();stopMotion();clearTimeout(wheelTimer);
            canvas.removeEventListener('pointermove',onMove);canvas.removeEventListener('pointerdown',onDown);
            canvas.removeEventListener('pointerup',onUp);canvas.removeEventListener('pointercancel',onCancel);
            canvas.removeEventListener('pointerleave',onLeave);canvas.removeEventListener('wheel',onWheel);
            canvas.removeEventListener('click',onClick,true);
        },
    };
}
