import fs from 'fs';
import path from 'path';
import { parse } from 'protobufjs';
import { gzip } from 'zlib';
import { promisify } from 'util';
import type { IncomingMessage, ServerResponse } from 'http';
const root=parse(fs.readFileSync(path.resolve(__dirname,'../../../assets/forno-transport.proto'),'utf8')).root;
const History=root.lookupType('aypi.forno.History'),Frame=root.lookupType('aypi.forno.Frame');
const fields=['samples','valid','missing','min','max','mean','delta','first','last','firstTime','lastTime','minTime','maxTime'];
const stats=(s:any)=>fields.map(key=>s[key]===null||s[key]===undefined?NaN:s[key]);
export const HISTORY_MIME='application/vnd.aypi.forno.v1+protobuf';
export function encodeHistory(value:any):Buffer {
    const channels=value.channels||[{id:1,...value}];
    return Buffer.from(History.encode({version:1,fromMs:value.fromMs,toMs:value.toMs,requestedIntervalMs:value.requestedIntervalMs,effectiveIntervalMs:value.effectiveIntervalMs,snapshotMs:value.snapshotMs||0,
        channels:channels.map((c:any)=>({id:c.id,stats:{values:stats(c.stats)},buckets:c.buckets.flatMap((b:any)=>[b.fromMs,b.toMs,...stats(b)])}))}).finish());
}
export function encodeFrame(value:any):Buffer {return Buffer.from(Frame.encode({version:1,...value}).finish());}
const compress=promisify(gzip);
export async function sendHistory(req:IncomingMessage,res:ServerResponse,bytes:Uint8Array){
    const acceptsGzip=String(req.headers['accept-encoding']||'').split(',').some(value=>/^gzip(?:\s*;\s*q=(?!0(?:\.0*)?(?:\s|$))[\d.]+)?\s*$/i.test(value.trim()));
    const raw=Buffer.from(bytes),body=acceptsGzip?await compress(raw,{level:1}):raw;
    res.writeHead(200,{'Content-Type':HISTORY_MIME,'Content-Length':body.length,'Vary':'Accept, Accept-Encoding','Cache-Control':'no-store',...(acceptsGzip?{'Content-Encoding':'gzip'}:{})});res.end(body);
}
