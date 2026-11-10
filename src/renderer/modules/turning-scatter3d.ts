import {axisLabel,axisTicks} from './chart-axis';
export type SpatialPoint={id:number;x:number;y:number;z:number;color:string;selected:boolean;label:string};
type Axis={label:string;key?:string;compressed?:boolean};
/** Proiezione prospettica dei tre valori reali. Rendering su canvas per
 * funzionare anche sui client aziendali senza accelerazione WebGL. */
export class TurningScatter3D{
    readonly canvas:HTMLCanvasElement;
    private ctx:CanvasRenderingContext2D;
    private tooltip=document.createElement('div');
    private home=document.createElement('button');
    private observer:ResizeObserver;
    private points:SpatialPoint[]=[];
    private axes:Axis[]=[];
    private projected:{point:SpatialPoint;x:number;y:number;depth:number;r:number}[]=[];
    private yaw=.65;private pitch=-.45;private zoom=1;private pan={x:0,y:0};
    private width=1;private height=1;private active:number|null=null;
    private drag:{x:number;y:number;lastX:number;lastY:number;moved:boolean;pan:boolean}|null=null;
    private abort=new AbortController();
    constructor(canvas:HTMLCanvasElement,private onSelect:(id:number,multiple:boolean)=>void,private ink:string,private muted:string){
        this.canvas=canvas;this.ctx=canvas.getContext('2d')!;canvas.dataset.spatial='true';canvas.tabIndex=0;canvas.setAttribute('role','img');
        canvas.setAttribute('aria-label','Grafico tridimensionale. Trascina per ruotare, Ctrl e rotella per zoom, Maiusc e trascina per spostare. Frecce per ruotare, più e meno per zoom, Home per ripristinare.');
        this.tooltip.className='spatial-tooltip';this.tooltip.hidden=true;
        this.home.className='spatial-home';this.home.type='button';this.home.textContent='↺ Vista 3D';this.home.title='Ripristina rotazione, zoom e posizione';
        const signal=this.abort.signal;
        this.home.addEventListener('click',()=>this.resetCamera(),{signal});
        canvas.addEventListener('pointerdown',event=>{this.drag={x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,moved:false,pan:event.shiftKey};canvas.setPointerCapture(event.pointerId);this.tooltip.hidden=true;canvas.focus({preventScroll:true})},{signal});
        canvas.addEventListener('pointermove',event=>{
            const d=this.drag;
            if(d){const dx=event.clientX-d.lastX,dy=event.clientY-d.lastY;d.lastX=event.clientX;d.lastY=event.clientY;d.moved||=Math.hypot(event.clientX-d.x,event.clientY-d.y)>4;
                if(d.moved){if(d.pan){this.pan.x+=dx;this.pan.y+=dy}else{this.yaw+=dx*.008;this.pitch=Math.max(-1.3,Math.min(1.3,this.pitch+dy*.008));}this.active=null;this.draw();}return;}
            const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top,hit=this.hit(x,y);this.active=hit?.point.id??null;canvas.style.cursor=hit?'pointer':'grab';
            this.tooltip.hidden=!hit;
            if(hit){const p=hit.point;this.tooltip.textContent=p.label+'\n'+this.axes.map((a,i)=>a.label+': '+new Intl.NumberFormat('it-IT',{maximumFractionDigits:2}).format([p.x,p.y,p.z][i])).join('\n');this.tooltip.style.left=Math.max(8,Math.min(this.width-280,x+15))+'px';this.tooltip.style.top=Math.max(8,Math.min(this.height-130,y+12))+'px';}
            this.draw();
        },{signal});
        canvas.addEventListener('pointerup',event=>{const d=this.drag;this.drag=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(d&&!d.moved){const rect=canvas.getBoundingClientRect(),hit=this.hit(event.clientX-rect.left,event.clientY-rect.top);if(hit)this.onSelect(hit.point.id,event.ctrlKey||event.metaKey)}},{signal});
        canvas.addEventListener('pointercancel',()=>{this.drag=null},{signal});
        canvas.addEventListener('pointerleave',()=>{this.active=null;this.tooltip.hidden=true;this.draw()},{signal});
        canvas.addEventListener('wheel',event=>{if(!event.ctrlKey&&!event.metaKey&&!canvas.closest('.chart-focused'))return;event.preventDefault();this.zoom=Math.max(.45,Math.min(3.5,this.zoom*Math.exp(-event.deltaY*.001)));this.draw()},{signal,passive:false});
        canvas.addEventListener('dblclick',()=>this.resetCamera(),{signal});
        canvas.addEventListener('keydown',event=>{let handled=true;if(event.key==='ArrowLeft')this.yaw-=.1;else if(event.key==='ArrowRight')this.yaw+=.1;else if(event.key==='ArrowUp')this.pitch=Math.max(-1.3,this.pitch-.1);else if(event.key==='ArrowDown')this.pitch=Math.min(1.3,this.pitch+.1);else if(event.key==='+'||event.key==='=')this.zoom=Math.min(3.5,this.zoom*1.1);else if(event.key==='-')this.zoom=Math.max(.45,this.zoom/1.1);else if(event.key==='Home'){this.resetCamera();return}else handled=false;if(handled){event.preventDefault();this.draw()}},{signal});
        this.observer=new ResizeObserver(()=>this.resize());this.mount();
    }
    mount(){this.observer.disconnect();const parent=this.canvas.parentElement!;parent.append(this.tooltip,this.home);this.observer.observe(parent);this.resize();}
    update(points:SpatialPoint[],axes:Axis[]){this.points=points;this.axes=axes;this.active=null;this.tooltip.hidden=true;this.resize();}
    resetCamera(){this.yaw=.65;this.pitch=-.45;this.zoom=1;this.pan={x:0,y:0};this.draw();}
    resize(){const parent=this.canvas.parentElement;if(!parent)return;const style=getComputedStyle(parent);this.width=Math.max(1,parent.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight));this.height=Math.max(1,parent.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom));const dpi=Math.max(2,window.devicePixelRatio||1);this.canvas.width=Math.round(this.width*dpi);this.canvas.height=Math.round(this.height*dpi);this.canvas.style.width=this.width+'px';this.canvas.style.height=this.height+'px';this.ctx.setTransform(dpi,0,0,dpi,0,0);this.draw();}
    private hit(x:number,y:number){let best:typeof this.projected[number]|undefined,distance=100;for(const p of this.projected){const d=(p.x-x)**2+(p.y-y)**2;if(d<Math.max(7,p.r+4)**2&&d<distance){distance=d;best=p}}return best;}
    private project(x:number,y:number,z:number){const rx=x*Math.cos(this.yaw)-z*Math.sin(this.yaw),rz=x*Math.sin(this.yaw)+z*Math.cos(this.yaw),ry=y*Math.cos(this.pitch)-rz*Math.sin(this.pitch),depth=y*Math.sin(this.pitch)+rz*Math.cos(this.pitch),perspective=4/(4+depth),scale=Math.min(this.width*.26,this.height*.23)*this.zoom;return {x:this.width*.5+this.pan.x+rx*scale*perspective,y:this.height*.42+this.pan.y-ry*scale*perspective,depth};}
    draw(){
        const ctx=this.ctx;if(!ctx)return;ctx.clearRect(0,0,this.width,this.height);if(!this.axes.length)return;
        const transform=(v:number,index:number)=>this.axes[index].compressed?Math.sign(v)*Math.log1p(Math.abs(v)):v;
        const bounds=[0,1,2].map(index=>{const values=this.points.map(p=>transform([p.x,p.y,p.z][index],index));let min=0,max=1;for(const v of values){min=Math.min(min,v);max=Math.max(max,v)}return {min,max};});
        const normalize=(v:number,i:number)=>(transform(v,i)-bounds[i].min)/(bounds[i].max-bounds[i].min)*2-1;
        const line=(a:number[],b:number[],color:string,width=1)=>{const p=this.project(a[0],a[1],a[2]),q=this.project(b[0],b[1],b[2]);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke()};
        for(let i=0;i<=4;i++){const t=-1+i*.5;line([t,-1,-1],[t,-1,1],'#dce5eb');line([-1,-1,t],[1,-1,t],'#dce5eb');line([-1,t,-1],[1,t,-1],'#edf1f4');}
        for(const x of [-1,1])for(const y of [-1,1])line([x,y,-1],[x,y,1],'#e1e8ed');for(const x of [-1,1])for(const z of [-1,1])line([x,-1,z],[x,1,z],'#e1e8ed');for(const y of [-1,1])for(const z of [-1,1])line([-1,y,z],[1,y,z],'#e1e8ed');
        const origin=[-1,-1,-1],ends=[[1,-1,-1],[-1,1,-1],[-1,-1,1]];
        ctx.font='11px "Segoe UI",sans-serif';ctx.textBaseline='middle';ctx.textAlign='center';
        ends.forEach((end,index)=>{
            line(origin,end,this.muted,1.4);const axis=this.axes[index],bound=bounds[index];
            const inverse=(v:number)=>axis.compressed?Math.sign(v)*Math.expm1(Math.abs(v)):v;
            for(const value of axisTicks(inverse(bound.min),inverse(bound.max),axis.key,axis.compressed)){
                const t=(transform(value,index)-bound.min)/(bound.max-bound.min),world=[...origin];world[index]=-1+2*t;
                const p=this.project(world[0],world[1],world[2]);ctx.fillStyle=this.muted;ctx.textAlign=index===1?'right':'center';ctx.fillText(axisLabel(value,axis.key),p.x+(index===1?-10:0),p.y+(index===1?0:16));
            }
            const target=[...end];target[index]=1.35;const p=this.project(target[0],target[1],target[2]);ctx.font='600 12px "Segoe UI",sans-serif';ctx.textAlign='center';ctx.fillStyle=this.ink;ctx.fillText(['X','Y','Z'][index]+' · '+axis.label,Math.max(85,Math.min(this.width-85,p.x)),Math.max(16,Math.min(this.height-16,p.y)));ctx.font='11px "Segoe UI",sans-serif';
        });
        this.projected=this.points.map(point=>({...this.project(normalize(point.x,0),normalize(point.y,1),normalize(point.z,2)),point,r:point.selected?4:2.7})).sort((a,b)=>b.depth-a.depth);
        for(const p of this.projected){ctx.beginPath();ctx.arc(p.x,p.y,p.r+(this.active===p.point.id?2:0),0,Math.PI*2);ctx.fillStyle=p.point.color;ctx.fill();if(this.active===p.point.id){ctx.strokeStyle=this.ink;ctx.lineWidth=1.3;ctx.stroke();}}
        ctx.font='11px "Segoe UI",sans-serif';ctx.fillStyle=this.muted;ctx.textAlign='right';ctx.fillText(this.points.length?`${new Intl.NumberFormat('it-IT').format(this.points.length)} registrazioni`:'Nessuna registrazione con assi validi',this.width-8,14);
    }
    destroy(){this.abort.abort();this.observer.disconnect();this.tooltip.remove();this.home.remove();this.points=[];this.projected=[];}
}
