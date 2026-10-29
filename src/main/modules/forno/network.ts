import http from 'http';
import https from 'https';
import WebSocket from 'ws';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import { resolveAypiBackendBaseUrl } from '../file-manager/backend-client';
import { HISTORY_MIME,decodeHistory,decodeFrame } from './transport';
const unzip=promisify(gunzip);
/** Negotiation keeps an updated client compatible with the previous backend. */
export function requestFornoHistory(query:URLSearchParams):Promise<any>{
    const url=new URL('/api/forno/history?'+query,resolveAypiBackendBaseUrl());
    return new Promise((resolve,reject)=>{
        const request=(url.protocol==='https:'?https:http).get(url,{headers:{Accept:HISTORY_MIME,'Accept-Encoding':'gzip','x-aypi-client':'AyPi-Electron-Main','x-aypi-user':process.env.USERNAME||'Operatore AyPi'}},response=>{
            const chunks:Buffer[]=[];let size=0;
            response.on('data',chunk=>{size+=chunk.length;if(size>16*1024*1024){request.destroy(new Error('Risposta storico troppo grande'));return;}chunks.push(Buffer.from(chunk));});
            response.on('error',reject);
            response.on('end',()=>{void(async()=>{
                let bytes=Buffer.concat(chunks);
                if(response.headers['content-encoding']==='gzip')bytes=await unzip(bytes,{maxOutputLength:16*1024*1024});
                if((response.statusCode||0)<200||(response.statusCode||0)>=300){let message='Errore storico forno';try{message=JSON.parse(bytes.toString()).error||message;}catch{}throw new Error(message);}
                resolve(String(response.headers['content-type']).startsWith(HISTORY_MIME)?decodeHistory(bytes):JSON.parse(bytes.toString()));
            })().catch(reject);});
        });
        request.setTimeout(18000,()=>request.destroy(new Error('Timeout storico forno')));request.on('error',reject);
    });
}
export function openFornoLive(deliver:(channel:string,value:any)=>void){
    let stopped=false,socket:WebSocket|null=null,retry:NodeJS.Timeout|undefined,watchdog:NodeJS.Timeout|undefined,attempt=0;
    let epoch='',sequence=0,lastFrame=0,staleAfter=10000;
    const connect=()=>{
        if(stopped)return;
        const url=new URL('/api/forno/live',resolveAypiBackendBaseUrl());url.protocol=url.protocol==='https:'?'wss:':'ws:';
        const current=new WebSocket(url,{handshakeTimeout:5000,maxPayload:4096,perMessageDeflate:false});socket=current;lastFrame=Date.now();
        current.on('message',(raw,isBinary)=>{
            if(stopped||socket!==current)return;
            try{
                if(!isBinary)throw new Error('Formato live non valido');
                const frame=decodeFrame(Buffer.from(raw as Buffer));
                if(frame.epoch===epoch&&frame.sequence<=sequence)return;
                const resync=frame.epoch!==epoch||frame.sequence!==sequence+1;
                epoch=frame.epoch;sequence=frame.sequence;lastFrame=Date.now();staleAfter=Math.max(10000,frame.intervalMs*3);attempt=0;
                deliver('forno-live-frame',{...frame,resync});
            }catch{current.terminate();}
        });
        current.on('error',()=>{});
        current.on('close',()=>{
            if(socket!==current)return;socket=null;clearInterval(watchdog);deliver('forno-live-state',{online:false});
            if(!stopped)retry=setTimeout(connect,Math.min(30000,1000*2**Math.min(attempt++,5))+Math.random()*500);
        });
        watchdog=setInterval(()=>{if(Date.now()-lastFrame>staleAfter)current.terminate();},2000);
    };
    connect();
    return ()=>{stopped=true;clearTimeout(retry);clearInterval(watchdog);const current=socket;socket=null;current?.terminate();};
}
