import { unpackBlock, type Sample } from './archive';
import { qualityLabel } from './modbus';

function rows(db:any,channel:number,from:number,to:number):Sample[] {
    const multi=channel!==1;
    if(multi&&!db.prepare("SELECT 1 FROM sqlite_master WHERE name='blocks_channels'").get())return [];
    const result:Sample[]=[];
    const center=(from+to)/2;
    const previous=db.prepare(multi?'SELECT start,payload FROM blocks_channels WHERE channel=? AND start<=? ORDER BY start DESC LIMIT 1':'SELECT start,payload FROM blocks WHERE start<=? ORDER BY start DESC LIMIT 1').get(...(multi?[channel,center]:[center]));
    const next=from===to?null:db.prepare(multi?'SELECT start,payload FROM blocks_channels WHERE channel=? AND start>? ORDER BY start LIMIT 1':'SELECT start,payload FROM blocks WHERE start>? ORDER BY start LIMIT 1').get(...(multi?[channel,center]:[center]));
    for(const block of [previous,next])if(block)for(const row of unpackBlock(block.start,block.payload))if(row.t>=from&&row.t<=to)result.push(row);
    const pending=db.prepare(multi?'SELECT t,v,q FROM pending_channels WHERE channel=? AND t BETWEEN ? AND ? ORDER BY t':'SELECT t,v,q FROM pending WHERE t BETWEEN ? AND ? ORDER BY t');
    result.push(...pending.all(...(multi?[channel,from,to]:[from,to])));return result;
}

/** Campione originale più vicino: nessuna interpolazione e nessun salto sui buchi. */
export function sampleAt(db:any,timestampMs:number,toleranceMs=500,manageTransaction=true) {
    if(!Number.isSafeInteger(timestampMs)||timestampMs<0||!Number.isInteger(toleranceMs)||toleranceMs<500||toleranceMs>300000)throw new Error('Istante campione non valido');
    if(manageTransaction)db.exec('BEGIN');
    try {
        const nearby=rows(db,1,timestampMs-toleranceMs,timestampMs+toleranceMs);
        nearby.sort((a,b)=>Math.abs(a.t-timestampMs)-Math.abs(b.t-timestampMs)||a.t-b.t);
        const t=nearby[0]?.t??null;
        const channels=[1,2,3,4].map(id=>{
            const sample=t===null?undefined:id===1?nearby[0]:rows(db,id,t,t)[0];
            return {id,name:'Canale '+id,temperature:sample?.q===0&&sample.v!==null?sample.v/10:null,quality:sample?qualityLabel(sample.q):'unavailable'};
        });
        const valid=channels.filter(c=>c.temperature!==null);
        return {requestedMs:timestampMs,timestampMs:t,channels,mean:valid.length?valid.reduce((sum,c)=>sum+c.temperature!,0)/valid.length:null};
    }finally{if(manageTransaction)db.exec('ROLLBACK');}
}
