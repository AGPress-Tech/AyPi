import type {Plugin,ChartType} from 'chart.js';
declare module 'chart.js' {
    interface ChartDatasetProperties<TType extends ChartType,TData>{highlightValues?:number[];highlightColor?:string;highlightColors?:string[];highlightSeries?:boolean;}
}

/** Keep full totals visible and paint the selected share using the original colour. */
export const analysisSelectionHighlight:Plugin={
    id:'analysis-selection-highlight',
    afterDatasetDraw(chart,args){
        const source=chart.data.datasets[args.index] as any;
        if(!source.highlightValues)return;
        const meta=chart.getDatasetMeta(args.index),ctx=chart.ctx;
        ctx.save();ctx.beginPath();ctx.rect(chart.chartArea.left,chart.chartArea.top,chart.chartArea.width,chart.chartArea.height);ctx.clip();
        if(meta.type==='bar'){
            const horizontal=chart.options.indexAxis==='y';
            meta.data.forEach((element:any,i)=>{
                const value=source.highlightValues[i];if(value==null||!Number.isFinite(value)||value===0)return;
                const end=meta.vScale!.getPixelForValue(value);ctx.fillStyle=source.highlightColor||source.borderColor;
                if(horizontal)ctx.fillRect(Math.min(element.base,end),element.y-element.height/2,Math.abs(end-element.base),element.height);
                else ctx.fillRect(element.x-element.width/2,Math.min(element.base,end),element.width,Math.abs(end-element.base));
            });
        }else if(meta.type==='doughnut'){
            meta.data.forEach((arc:any,i)=>{
                const total=Number(source.data[i]),fraction=total>0?Math.max(0,Math.min(1,Number(source.highlightValues[i])/total)):0;if(!fraction)return;
                const end=arc.startAngle+(arc.endAngle-arc.startAngle)*fraction;
                ctx.beginPath();ctx.arc(arc.x,arc.y,arc.outerRadius,arc.startAngle,end);ctx.arc(arc.x,arc.y,arc.innerRadius,end,arc.startAngle,true);ctx.closePath();ctx.fillStyle=source.highlightColors[i];ctx.fill();
            });
        }
        ctx.restore();
    },
};
