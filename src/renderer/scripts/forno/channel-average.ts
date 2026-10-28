type ChannelReading = { id:number; name?:string; valid:number; mean:number|null };

/** Ogni canale valido ha lo stesso peso, anche con conteggi diversi nel periodo. */
export function channelAverage(readings:ChannelReading[]) {
    const channels=readings.filter(r=>r.valid>0&&r.mean!==null&&Number.isFinite(r.mean));
    return {
        temperature:channels.length?channels.reduce((sum,r)=>sum+r.mean!,0)/channels.length:null,
        channels:channels.map(r=>({id:r.id,name:r.name||'Canale '+r.id})),
    };
}
