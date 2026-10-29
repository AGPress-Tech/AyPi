import type http from 'http';
import type { Duplex } from 'stream';
import WebSocket,{WebSocketServer} from 'ws';
import { subscribeFornoFrames } from './service';
import { encodeFrame } from './transport';
const hubs=new WeakMap<http.Server,()=>void>();
/** One committed frame is encoded once and broadcast; no per-client DB queries. */
export function attachFornoLive(server:http.Server){
    if(hubs.has(server))return;
    const wss=new WebSocketServer({noServer:true,maxPayload:1024,perMessageDeflate:false});
    const alive=new Set<WebSocket>();let latest:Buffer|null=null;
    const unsubscribe=subscribeFornoFrames(frame=>{
        latest=encodeFrame(frame);
        for(const ws of wss.clients){
            if(ws.readyState!==WebSocket.OPEN)continue;
            if(ws.bufferedAmount>65536){ws.close(1013,'Client lento: riconnettersi');continue;}
            ws.send(latest,{binary:true});
        }
    });
    const upgrade=(req:http.IncomingMessage,socket:Duplex,head:Buffer)=>{
        if(new URL(req.url||'/','http://localhost').pathname!=='/api/forno/live')return;
        if(wss.clients.size>=128){socket.destroy();return;}
        wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
    };
    wss.on('connection',ws=>{alive.add(ws);ws.on('pong',()=>alive.add(ws));ws.on('error',()=>{});ws.on('close',()=>alive.delete(ws));if(latest)ws.send(latest,{binary:true});});
    wss.on('error',()=>{});
    const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!alive.delete(ws)){ws.terminate();continue;}ws.ping();}},30000);heartbeat.unref();
    server.on('upgrade',upgrade);
    let closed=false;
    const close=()=>{if(closed)return;closed=true;unsubscribe();clearInterval(heartbeat);server.off('upgrade',upgrade);for(const ws of wss.clients)ws.terminate();wss.close();hubs.delete(server);};
    hubs.set(server,close);server.once('close',close);
}
export function closeFornoLive(server:http.Server){hubs.get(server)?.();}
