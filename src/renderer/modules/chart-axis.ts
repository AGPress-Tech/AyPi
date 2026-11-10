/** Readable labels in source units, including compressed coordinates. */
export const countMetric=(key:string)=>['quantity','registrations','orders','customers','articles'].includes(key);
export function axisLabel(value:number,key=''){
    return new Intl.NumberFormat('it-IT',{maximumFractionDigits:countMetric(key)?0:Math.abs(value)>=10?0:2}).format(value);
}
export function axisTicks(min:number,max:number,key='',compressed=false){
    if(!Number.isFinite(min)||!Number.isFinite(max))return [0,1];
    if(min===max)max=min+1;
    const integer=countMetric(key),nice=(v:number)=>{
        if(v===0)return 0;
        const scale=10**Math.floor(Math.log10(Math.abs(v))),rounded=Math.round(v/scale*2)/2*scale;
        return integer?Math.round(rounded):Number(rounded.toPrecision(10));
    };
    if(compressed){
        const transform=(v:number)=>Math.sign(v)*Math.log1p(Math.abs(v)),inverse=(v:number)=>Math.sign(v)*Math.expm1(Math.abs(v));
        const lo=transform(min),hi=transform(max),values=Array.from({length:7},(_,i)=>nice(inverse(lo+(hi-lo)*i/6)));
        return [...new Set(values)].filter(v=>v>=min&&v<=max);
    }
    const rough=(max-min)/5,power=10**Math.floor(Math.log10(rough)),fraction=rough/power;
    const step=Math.max(integer?1:Number.MIN_VALUE,(fraction<=1?1:fraction<=2?2:fraction<=2.5?2.5:fraction<=5?5:10)*power);
    const ticks:number[]=[];for(let v=Math.ceil(min/step)*step;v<=max+step*1e-8&&ticks.length<30;v+=step)ticks.push(Number(v.toPrecision(12)));
    return ticks.length?ticks:[nice(min)];
}
