import { performance } from 'perf_hooks';
import { unpackBlock, type Sample } from './archive';

/** Lettura progressiva: un blocco compresso per volta, senza esportare il raw. */
function* samples(db:any,channel:number,start:number,end:number):Generator<Sample> {
    const multi=channel!==1;
    if(multi&&!db.prepare("SELECT 1 FROM sqlite_master WHERE name='blocks_channels'").get())return;
    const blocks=db.prepare(multi?'SELECT start,payload FROM blocks_channels WHERE channel=? AND start<=? AND end>=? ORDER BY start':'SELECT start,payload FROM blocks WHERE start<=? AND end>=? ORDER BY start');
    for(const block of blocks.iterate(...(multi?[channel,end,start]:[end,start]))) {
        for(const row of unpackBlock(block.start,block.payload))if(row.t>=start&&row.t<=end)yield row;
    }
    const pending=db.prepare(multi?'SELECT t,v,q FROM pending_channels WHERE channel=? AND t BETWEEN ? AND ? ORDER BY t':'SELECT t,v,q FROM pending WHERE t BETWEEN ? AND ? ORDER BY t');
    yield* pending.iterate(...(multi?[channel,start,end]:[start,end]));
}

type Point={t:number;v:number};
class ExtremumQueue {
    private values:Point[]=[];
    private head=0;
    constructor(private minimum:boolean){}
    add(point:Point) {
        while(this.values.length>this.head&&(this.minimum?this.values[this.values.length-1].v>=point.v:this.values[this.values.length-1].v<=point.v))this.values.pop();
        this.values.push(point);
    }
    expire(before:number) {
        while(this.head<this.values.length&&this.values[this.head].t<before)this.head++;
        if(this.head>2048&&this.head*2>this.values.length){this.values=this.values.slice(this.head);this.head=0;}
    }
    first(){return this.values[this.head];}
}

class SeriesAnalysis {
    private low=new ExtremumQueue(true);
    private high=new ExtremumQueue(false);
    private firstAttempt:number|null=null;
    private total=0;
    readonly stats={samples:0,valid:0,missing:0,min:null as number|null,max:null as number|null,mean:null as number|null,delta:null as number|null};
    readonly windows={count:0,meanDelta:null as number|null,maxDelta:null as null|{fromMs:number;toMs:number;min:number;max:number;delta:number;minTime:number;maxTime:number}};
    private deltaSum=0;
    constructor(readonly id:number,readonly name:string,private windowMs:number){}
    add(t:number,value:number|null) {
        this.firstAttempt??=t;this.stats.samples++;
        if(value===null)this.stats.missing++;
        else {
            this.stats.valid++;this.total+=value;
            this.stats.min=this.stats.min===null?value:Math.min(this.stats.min,value);
            this.stats.max=this.stats.max===null?value:Math.max(this.stats.max,value);
            this.low.add({t,v:value});this.high.add({t,v:value});
        }
        this.low.expire(t-this.windowMs);this.high.expire(t-this.windowMs);
        const min=this.low.first(),max=this.high.first();
        // Solo finestre della durata richiesta, interamente interne alla selezione.
        if(t-this.firstAttempt<this.windowMs||!min||!max)return;
        const delta=max.v-min.v;this.windows.count++;this.deltaSum+=delta;
        if(!this.windows.maxDelta||delta>this.windows.maxDelta.delta)this.windows.maxDelta={fromMs:t-this.windowMs,toMs:t,min:min.v,max:max.v,delta,minTime:min.t,maxTime:max.t};
    }
    result() {
        this.stats.mean=this.stats.valid?this.total/this.stats.valid:null;
        this.stats.delta=this.stats.valid?this.stats.max!-this.stats.min!:null;
        this.windows.meanDelta=this.windows.count?this.deltaSum/this.windows.count:null;
        return {id:this.id,name:this.name,stats:this.stats,windows:this.windows};
    }
}

export function analyzeChannels(db:any,start:number,end:number,windowSeconds:number) {
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end-start>366*86400000||!Number.isFinite(windowSeconds)||windowSeconds<0.5||windowSeconds>86400||!Number.isSafeInteger(windowSeconds*1000))throw new Error('Intervallo di analisi non valido');
    const deadline=performance.now()+9000;
    db.exec('BEGIN');
    const iterators=[1,2,3,4].map(id=>samples(db,id,start,end));
    try {
        const channels=[1,2,3,4].map(id=>new SeriesAnalysis(id,'Canale '+id,windowSeconds*1000));
        const combined=new SeriesAnalysis(0,'Tutti i canali',windowSeconds*1000);
        const heads=iterators.map(i=>i.next());let frames=0;
        while(heads.some(h=>!h.done)) {
            if((frames++&4095)===0&&(frames>2000000||performance.now()>deadline))throw new Error('Analisi troppo ampia: selezionare un intervallo più breve');
            const t=Math.min(...heads.filter(h=>!h.done).map(h=>h.value.t));
            let total=0,count=0;
            for(let i=0;i<4;i++) {
                const head=heads[i];if(head.done||head.value.t!==t)continue;
                const row=head.value,value=row.q===0&&row.v!==null?row.v/10:null;
                channels[i].add(t,value);if(value!==null){total+=value;count++;}
                heads[i]=iterators[i].next();
            }
            combined.add(t,count?total/count:null);
        }
        return {fromMs:start,toMs:end,windowSeconds,combined:combined.result(),channels:channels.map(c=>c.result())};
    } finally {
        for(const iterator of iterators)iterator.return(undefined);
        db.exec('ROLLBACK');
    }
}
