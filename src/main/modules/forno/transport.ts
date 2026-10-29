import fs from 'fs';
import path from 'path';
import { parse } from 'protobufjs';
const root=parse(fs.readFileSync(path.resolve(__dirname,'../../assets/forno-transport.proto'),'utf8')).root;
const History=root.lookupType('aypi.forno.History'),Frame=root.lookupType('aypi.forno.Frame');
const fields=['samples','valid','missing','min','max','mean','delta','first','last','firstTime','lastTime','minTime','maxTime'];
export const HISTORY_MIME='application/vnd.aypi.forno.v1+protobuf';
function stats(values:number[]){if(values.length!==fields.length)throw new Error('Statistiche forno non valide');return Object.fromEntries(fields.map((key,i)=>[key,Number.isNaN(values[i])?null:values[i]]));}
export function decodeHistory(bytes:Uint8Array):any {
    const value:any=History.toObject(History.decode(bytes),{defaults:true});
    if(value.version!==1||!value.channels.length||value.channels.length>4||value.effectiveIntervalMs<500)throw new Error('Formato storico forno non supportato');
    const ids=new Set<number>();
    const channels=value.channels.map((c:any)=>{
        if(c.id<1||c.id>4||ids.has(c.id)||c.buckets.length%15||c.buckets.length>4000*15)throw new Error('Canale storico non valido');ids.add(c.id);
        const buckets=[];for(let i=0;i<c.buckets.length;i+=15)buckets.push({fromMs:c.buckets[i],toMs:c.buckets[i+1],...stats(c.buckets.slice(i+2,i+15))});
        return {id:c.id,name:'Canale '+c.id,fromMs:value.fromMs,toMs:value.toMs,requestedIntervalMs:value.requestedIntervalMs,effectiveIntervalMs:value.effectiveIntervalMs,stats:stats(c.stats.values),buckets};
    });
    return {...channels[0],channels,snapshotMs:value.snapshotMs};
}
export function decodeFrame(bytes:Uint8Array):any {
    const frame:any=Frame.toObject(Frame.decode(bytes),{defaults:true});
    if(frame.version!==1||frame.values.length!==4||frame.qualities.length!==4||!Number.isSafeInteger(frame.timestampMs)||frame.timestampMs<0||frame.intervalMs<500||!frame.epoch||!frame.sequence)throw new Error('Campione live non valido');
    frame.values=frame.values.map((v:number)=>v===-2147483648?null:v);
    return frame;
}
