import type Chart from 'chart.js/auto';

/** Rivela solo le nuove porzioni di curva; assi e dati già visibili restano fermi. */
export function createChartReveal() {
    let chart: Chart<'line'>;
    let frame=0,at=0;
    let oldRange: {start:number;end:number}|null=null;
    let running=false;
    const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
    function paint() {
        if(!running)return;
        if(performance.now()-at>=320)running=false;
        chart.draw();if(running)frame=requestAnimationFrame(paint);
    }
    return {
        plugin: {
            id:'forno-reveal',
            beforeDatasetsDraw(instance:Chart<'line'>) {
                const {ctx,chartArea,scales}=instance;ctx.save();
                if(!running)return;
                const progress=Math.min(1,(performance.now()-at)/320),p=1-Math.pow(1-progress,2);
                const x=(t:number)=>Math.max(chartArea.left,Math.min(chartArea.right,scales.x.getPixelForValue(t)));
                ctx.beginPath();
                if(!oldRange || oldRange.end<scales.x.min || oldRange.start>scales.x.max) {
                    // Senza una traccia precedente in vista, compare tutta la curva.
                    ctx.globalAlpha=p;
                    return;
                }
                else {
                    const left=x(oldRange.start),right=x(oldRange.end);
                    ctx.rect(left,chartArea.top,Math.max(0,right-left),chartArea.height);
                    const extension=(left-chartArea.left)*p;
                    ctx.rect(left-extension,chartArea.top,extension,chartArea.height);
                    ctx.rect(right,chartArea.top,(chartArea.right-right)*p,chartArea.height);
                }
                ctx.clip();
            },
            afterDatasetsDraw(instance:Chart<'line'>){instance.ctx.restore();},
        },
        start(instance:Chart<'line'>,previous:{start:number;end:number}|null) {
            cancelAnimationFrame(frame);chart=instance;oldRange=previous;at=performance.now();
            running=!reducedMotion.matches;if(running)frame=requestAnimationFrame(paint);
        },
        stop(){cancelAnimationFrame(frame);running=false;},
    };
}
