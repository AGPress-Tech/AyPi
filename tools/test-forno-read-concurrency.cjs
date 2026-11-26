// Run with Electron (isolated synthetic archive; never contacts the furnace).
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { app } = require('electron');
const { EventEmitter } = require('node:events');
const { Worker } = require('node:worker_threads');
app.whenReady().then(async () => {
    let reader;
    try {
        const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-forno-reads-'));
        const { MultiChannelArchive } = require('../backend-dist/modules/forno/multi-archive');
        const { history } = require('../backend-dist/modules/forno/archive');
        const archive = new MultiChannelArchive(path.join(dir, 'archive.db'), { host: 'fixture', port: 502, unit: 1, address: 100, scale: .1 });
        const base = 1795000000000;
        for (let i = 0; i < 600; i++) archive.appendFrame([1,2,3,4].map(channel => ({ t: base + i * 500 + (i >= 300 ? 100000 : 0), v: i + channel, q: i % 17 === 0 ? 1 : 0 })));
        archive.close();
        const db = require('../backend-dist/modules/forno/archive').openDatabase(path.join(dir, 'archive.db'), { readonly: true });
        // Reference query scans the original range; optimized query must retain boundaries,
        // gaps, invalid samples and every channel exactly.
        const reference = { exec: sql => db.exec(sql), prepare(sql) {
            if (!sql.includes('COALESCE((SELECT MAX(start)')) return db.prepare(sql);
            const multi = sql.includes('blocks_channels');
            const statement = db.prepare(multi ? 'SELECT * FROM blocks_channels WHERE channel=? AND start<=? AND end>=? ORDER BY start' : 'SELECT * FROM blocks WHERE start<=? AND end>=? ORDER BY start');
            return { iterate(...args) { return statement.iterate(...(multi ? [args[0],args[4],args[5]] : [args[2],args[3]])); } };
        } };
        for (const [from,to] of [[base-1000,base-1],[base,base+600000],[base+59123,base+200123],[base+160000,base+170000],[base+299999,base+500000]]) {
            for (let channel=1;channel<=4;channel++) assert.deepEqual(history(db,from,to,1000,80,channel),history(reference,from,to,1000,80,channel));
        }
        db.close();
        reader = new Worker(path.join(root, 'backend-dist/modules/forno/worker.js'), { workerData: { dbPath: path.join(dir, 'archive.db'), intervalMs: 500 } });
        const reply = request => new Promise((resolve,reject) => { reader.once('message',resolve); reader.once('error',reject); reader.postMessage(request); });
        assert.match((await reply({ id:1,command:'history',deadlineMs:Date.now()-1 })).error,/scaduta/);
        const sample = await reply({ id:2,command:'sample',timestampMs:base+1000,deadlineMs:Date.now()+5000 });
        assert.equal(sample.result.timestampMs,base+1000); assert.equal(sample.result.channels.length,4);
        await reader.terminate(); reader=null;
        const cp = require('node:child_process'), originalFork = cp.fork;
        const fake = new EventEmitter(); fake.stderr = new EventEmitter(); fake.connected=true;
        const sent=[]; fake.send=(request,callback) => { sent.push(request); callback?.(); }; fake.kill=()=>{};
        cp.fork=()=> { queueMicrotask(()=>fake.emit('message',{type:'ready'})); return fake; };
        const config=require('../backend-dist/modules/forno/config'), originalConfig=config.getFornoConfig;
        config.getFornoConfig=()=>({enabled:true});
        const service=require('../backend-dist/modules/forno/service');
        await service.startFornoService();
        const first=service.fornoRequest('history',{fromMs:1,toMs:2});
        const second=service.fornoRequest('history',{fromMs:1,toMs:2});
        assert.equal(first,second); assert.equal(sent.length,1); assert(sent[0].deadlineMs>Date.now());
        const cursor=service.fornoRequest('sample',{timestampMs:1}); assert.equal(sent.length,2);
        fake.emit('message',{id:sent[1].id,result:{sample:true}}); assert.deepEqual(await cursor,{sample:true});
        fake.emit('message',{id:sent[0].id,result:{history:true}}); await Promise.all([first,second]);
        const fresh=service.fornoRequest('history',{fromMs:1,toMs:2}); assert.equal(sent.length,3,'No stale live-history cache');
        fake.emit('message',{id:sent[2].id,result:{fresh:true}}); await fresh;
        const batchStart=sent.length;
        const historyBatch=Array.from({length:8},(_,i)=>service.fornoRequest('history',{fromMs:10+i,toMs:100}));
        await assert.rejects(service.fornoRequest('history',{fromMs:99,toMs:100}),/Troppe richieste/);
        const interactive=service.fornoRequest('sample',{timestampMs:100});
        assert.equal(sent.length,batchStart+9,'A full history queue must retain interactive capacity');
        for (const request of sent.slice(batchStart)) fake.emit('message',{id:request.id,result:{ok:true}});
        await Promise.all([...historyBatch,interactive]);
        fake.send=(request,callback)=>{ callback?.(); fake.emit('message',{id:request.id,result:{stopped:true}}); queueMicrotask(()=>fake.emit('close',0)); };
        await service.stopFornoService(); cp.fork=originalFork; config.getFornoConfig=originalConfig;
        console.log('OK: exact history across four channels/boundaries/gaps; expired queued reads skipped; sample worker; shared concurrent reads, independent cursor and fresh subsequent reads.');
        app.exit(0);
    } catch(error) { console.error(error); if(reader) await reader.terminate(); app.exit(1); }
});
