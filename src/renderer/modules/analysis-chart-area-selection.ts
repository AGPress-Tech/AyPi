import Chart from 'chart.js/auto';
import type {ChartType,Plugin} from 'chart.js';

declare module 'chart.js' {
    interface CoreChartOptions<TType extends ChartType>{onAreaSelect?:(indices:number[],multiple:boolean)=>void;}
}

/** A plain drag replaces the selection; Ctrl/Cmd toggles each distinct value once. */
export function mergeAreaSelection<T>(current:readonly T[],values:readonly T[],multiple:boolean):T[]{
    const unique=[...new Set(values)];if(!unique.length)return [...current];
    if(!multiple)return unique;
    const result=new Set(current);for(const value of unique)result.has(value)?result.delete(value):result.add(value);
    return [...result];
}
type Point={x:number;y:number};
type Drag={chart:Chart;pointer:number;start:Point;end:Point;multiple:boolean;moved:boolean;box:HTMLDivElement;cursor:string};
let active:Drag|null=null,suppressed:{canvas:HTMLElement;id:string;until:number}|null=null;
const disposers=new WeakMap<Chart,()=>void>();
const isSuppressed=(canvas:HTMLElement)=>!!suppressed&&performance.now()<suppressed.until&&(canvas===suppressed.canvas||!!canvas.id&&canvas.id===suppressed.id);
function cancel(suppress=false){
    const drag=active;if(!drag)return;active=null;drag.box.remove();
    drag.chart.canvas.style.cursor=drag.cursor;
    if(drag.chart.canvas.hasPointerCapture?.(drag.pointer))drag.chart.canvas.releasePointerCapture(drag.pointer);
    if(suppress&&drag.moved)suppressed={canvas:drag.chart.canvas,id:drag.chart.canvas.id,until:performance.now()+500};
}
/** Select rendered points or intersected bar rectangles, excluding hidden/null series. */
export function chartAreaIndices(chart:Chart,start:Point,end:Point):number[]{
    const left=Math.min(start.x,end.x),right=Math.max(start.x,end.x),top=Math.min(start.y,end.y),bottom=Math.max(start.y,end.y),indices=new Set<number>();
    chart.data.datasets.forEach((_dataset,index)=>{
        if(!chart.isDatasetVisible(index))return;
        const meta=chart.getDatasetMeta(index);if(!['bar','line'].includes(meta.type))return;
        meta.data.forEach((element:any,i)=>{
            const parsed=(meta.controller as any).getParsed(i);if(element.skip||!parsed||parsed.x==null||parsed.y==null)return;
            const p=element.getProps(['x','y','base','width','height'],true);
            if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return;
            if(meta.type==='bar'){
                const horizontal=chart.options.indexAxis==='y';
                const x1=horizontal?Math.min(p.x,p.base):p.x-p.width/2,x2=horizontal?Math.max(p.x,p.base):p.x+p.width/2;
                const y1=horizontal?p.y-p.height/2:Math.min(p.y,p.base),y2=horizontal?p.y+p.height/2:Math.max(p.y,p.base);
                if(x2>=left&&x1<=right&&y2>=top&&y1<=bottom)indices.add(i);
            }else if(p.x>=left-3&&p.x<=right+3&&p.y>=top-3&&p.y<=bottom+3)indices.add(i);
        });
    });
    return [...indices].sort((a,b)=>a-b);
}
let listenersInstalled=false;
function installGlobalListeners(){
    if(listenersInstalled)return;listenersInstalled=true;
    document.addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest<HTMLElement>('canvas,[data-analysis-area-host]'):null;if(target&&isSuppressed(target)){suppressed=null;event.preventDefault();event.stopImmediatePropagation();}},true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active){event.preventDefault();event.stopImmediatePropagation();cancel(true);}},true);
    window.addEventListener('blur',()=>cancel(true));window.addEventListener('resize',()=>cancel(true));
}
const areaSelection:Plugin={
    id:'analysis-area-selection',
    afterInit(chart){
        if(!['bar','line'].includes((chart.config as any).type))return;
        installGlobalListeners();const canvas=chart.canvas;
        const coordinates=(event:PointerEvent)=>{const rect=canvas.getBoundingClientRect(),area=chart.chartArea;return {x:Math.max(area.left,Math.min(area.right,(event.clientX-rect.left)*chart.width/rect.width)),y:Math.max(area.top,Math.min(area.bottom,(event.clientY-rect.top)*chart.height/rect.height))}};
        const down=(event:PointerEvent)=>{
            if(event.button!==0||event.isPrimary===false||typeof chart.options.onAreaSelect!=='function')return;
            if(isSuppressed(canvas))suppressed=null;
            const rect=canvas.getBoundingClientRect(),area=chart.chartArea,x=(event.clientX-rect.left)*chart.width/rect.width,y=(event.clientY-rect.top)*chart.height/rect.height;
            if(x<area.left||x>area.right||y<area.top||y>area.bottom)return;
            event.preventDefault();
            cancel();const box=document.createElement('div');box.className='analysis-area-selection';box.setAttribute('aria-hidden','true');
            const accent=getComputedStyle(document.body).getPropertyValue('--ops-accent').trim()||'#168eea';
            Object.assign(box.style,{position:'fixed',pointerEvents:'none',zIndex:'2000',border:`1px solid ${accent}`,background:`color-mix(in srgb, ${accent} 16%, transparent)`,display:'none'});document.body.append(box);
            active={chart,pointer:event.pointerId,start:{x,y},end:{x,y},multiple:event.ctrlKey||event.metaKey,moved:false,box,cursor:canvas.style.cursor};canvas.setPointerCapture?.(event.pointerId);
        };
        const move=(event:PointerEvent)=>{
            const drag=active;if(!drag||drag.chart!==chart||drag.pointer!==event.pointerId)return;
            drag.end=coordinates(event);const rect=canvas.getBoundingClientRect(),sx=rect.width/chart.width,sy=rect.height/chart.height;
            if(Math.hypot((drag.end.x-drag.start.x)*sx,(drag.end.y-drag.start.y)*sy)<6&&!drag.moved)return;
            drag.moved=true;event.preventDefault();canvas.style.cursor='crosshair';
            Object.assign(drag.box.style,{display:'block',left:rect.left+Math.min(drag.start.x,drag.end.x)*sx+'px',top:rect.top+Math.min(drag.start.y,drag.end.y)*sy+'px',width:Math.abs(drag.end.x-drag.start.x)*sx+'px',height:Math.abs(drag.end.y-drag.start.y)*sy+'px'});
        };
        const up=(event:PointerEvent)=>{
            const drag=active;if(!drag||drag.chart!==chart||drag.pointer!==event.pointerId)return;
            drag.end=coordinates(event);const indices=drag.moved?chartAreaIndices(chart,drag.start,drag.end):[],multiple=drag.multiple||event.ctrlKey||event.metaKey,handler=chart.options.onAreaSelect;
            cancel(drag.moved);if(indices.length)handler?.(indices,multiple);
        };
        const abort=()=>{if(active?.chart===chart)cancel(true)};
        canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',abort);canvas.addEventListener('lostpointercapture',abort);
        disposers.set(chart,()=>{abort();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',abort);canvas.removeEventListener('lostpointercapture',abort)});
    },
    beforeEvent(chart,args){if(active?.moved&&active.chart===chart||args.event.type==='click'&&isSuppressed(chart.canvas))return false;},
    beforeDestroy(chart){disposers.get(chart)?.();disposers.delete(chart);},
};
Chart.register(areaSelection);

/** The same brush interaction for the MES stacked bars rendered as HTML. */
export function installHtmlAreaSelection(host:HTMLElement,items:()=>HTMLElement[],select:(indices:number[],multiple:boolean)=>void){
    if(host.hasAttribute('data-analysis-area-host'))return;
    host.dataset.analysisAreaHost='true';
    const adapter={canvas:host,config:{type:'bar'},get width(){return host.getBoundingClientRect().width},get height(){return host.getBoundingClientRect().height},get chartArea(){return {left:0,top:0,right:this.width,bottom:this.height}},options:{indexAxis:'y',onAreaSelect:select},data:{datasets:[{}]},isDatasetVisible:()=>true,getDatasetMeta:()=>({type:'bar',controller:{getParsed:(i:number)=>({x:1,y:i})},data:items().map(item=>({getProps:()=>{const parent=host.getBoundingClientRect(),r=item.getBoundingClientRect();return {x:r.right-parent.left,base:r.left-parent.left,y:r.top-parent.top+r.height/2,width:r.width,height:r.height}}}))})} as unknown as Chart;
    areaSelection.afterInit?.(adapter,{},{});
}
