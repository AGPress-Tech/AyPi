export type LiveFrame={timestampMs:number;values:(number|null)[];qualities:number[];epoch:string;sequence:number;intervalMs:number;resync?:boolean};
/** Merge a committed original frame into globally aligned display buckets. */
export function appendLiveFrame(series:any[][],frame:LiveFrame,interval:number,start:number,end:number){
    const fromMs=Math.floor(frame.timestampMs/interval)*interval;
    for(let i=0;i<4;i++){
        const rows=series[i];let bucket=rows[rows.length-1];
        if(bucket?.fromMs>fromMs)continue;
        if(!bucket||bucket.fromMs!==fromMs){
            if(bucket)bucket.toMs=Math.min(end,bucket.fromMs+interval-1);
            bucket={fromMs,toMs:Math.min(end,fromMs+interval-1),samples:0,valid:0,missing:0,min:null,max:null,mean:null,delta:null,first:null,last:null,firstTime:null,lastTime:null,minTime:null,maxTime:null};rows.push(bucket);
        }
        bucket.toMs=Math.min(end,fromMs+interval-1);bucket.samples++;
        const value=frame.values[i];
        if(frame.qualities[i]===0&&value!==null){
            const temperature=value/10;
            bucket._totalTenths=(bucket._totalTenths??Math.round((bucket.mean??0)*bucket.valid*10))+value;bucket.valid++;bucket.mean=bucket._totalTenths/bucket.valid/10;
            if(bucket.min===null||temperature<bucket.min){bucket.min=temperature;bucket.minTime=frame.timestampMs;}
            if(bucket.max===null||temperature>bucket.max){bucket.max=temperature;bucket.maxTime=frame.timestampMs;}
            if(bucket.firstTime===null){bucket.firstTime=frame.timestampMs;bucket.first=temperature;}
            bucket.last=temperature;bucket.lastTime=frame.timestampMs;bucket.delta=Math.round((bucket.max-bucket.min)*10)/10;
        }else bucket.missing++;
        let drop=0;while(drop<rows.length&&rows[drop].toMs<start-(end-start)/2)drop++;if(drop)rows.splice(0,drop);
        if(rows.length>4000)rows.splice(0,rows.length-4000);
    }
}
