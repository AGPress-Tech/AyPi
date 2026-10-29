/** Griglia ancorata ai multipli dei gradi, con limite al numero di linee. */
export function degreeTicks(min:number,max:number,step:number,subdivisions:number) {
    const original=step;
    if((max-min)/step>300){step*=Math.ceil((max-min)/step/300);subdivisions=1;}
    if((max-min)/step*subdivisions>500)subdivisions=1;
    const minor=step/subdivisions,ticks:{value:number;major:boolean}[]=[{value:min,major:false}];
    for(let k=Math.ceil((min+minor*1e-8)/minor),last=Math.floor((max-minor*1e-8)/minor);k<=last;k++)ticks.push({value:Number((k*minor).toFixed(9)),major:Math.abs(k%subdivisions)<1e-8});
    ticks.push({value:max,major:false});
    return {ticks,effectiveStep:step,adapted:step!==original};
}

/** datetime-local: rifiuta date normalizzate e ore inesistenti al cambio DST. */
export function parseLocalDateTime(value:string) {
    const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
    if(!match)throw new Error('Inserire data e ora valide');
    const [,y,m,d,h,min,s='0',ms='0']=match;
    const date=new Date(+y,+m-1,+d,+h,+min,+s,Number(ms.padEnd(3,'0')));
    if(date.getFullYear()!==+y||date.getMonth()!==+m-1||date.getDate()!==+d||date.getHours()!==+h||date.getMinutes()!==+min||date.getSeconds()!==+s)throw new Error('Data o ora non valida (verificare il cambio di ora legale)');
    return date.getTime();
}
export function formatLocalInput(t:number) {
    const d=new Date(t),pad=(v:number,n=2)=>String(v).padStart(n,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
}
