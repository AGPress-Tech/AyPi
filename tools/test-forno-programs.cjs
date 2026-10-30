const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { readStoredPrograms, createStoredProgramsReader } = require('../backend-dist/modules/forno/programs');
const { readProgramRecipe } = require('../backend-dist/modules/forno/program-recipe');

async function fixture(run, respond) {
    const requests = [], sockets = new Set();
    const server = net.createServer(socket => {
        sockets.add(socket); socket.on('close', () => sockets.delete(socket));
        let buffer = Buffer.alloc(0);
        socket.on('data', chunk => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 12) {
                const length = buffer.readUInt16BE(4) + 6;
                if (buffer.length < length) break;
                const p = buffer.subarray(0, length); buffer = buffer.subarray(length);
                const request = { fc: p[7], address: p.readUInt16BE(8), value: p.readUInt16BE(10) };
                if (request.fc === 16) request.words = Array.from({length:request.value},(_,i)=>p.readUInt16BE(13+2*i));
                requests.push(request);
                const words = respond(request, socket);
                if (words === null) continue;
                const r = request.fc === 6 || request.fc === 16 ? Buffer.from(p.subarray(0,12)) : Buffer.alloc(9 + words.length * 2);
                if(request.fc === 16) r.writeUInt16BE(6,4);
                if (request.fc === 3) {
                    p.copy(r, 0, 0, 7); r.writeUInt16BE(3 + words.length * 2, 4);
                    r[7] = 3; r[8] = words.length * 2;
                    words.forEach((v, i) => r.writeUInt16BE(v, 9 + i * 2));
                }
                // Header frammentato: il client deve attendere il frame intero.
                socket.write(r.subarray(0, 5)); socket.write(r.subarray(5));
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try { await run({ host: '127.0.0.1', port: server.address().port, unit: 255 }, requests); }
    finally { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
}
const encode = name => Array.from({ length: 21 }, (_, i) => name.charCodeAt(i) || 0);

test('elenco aggiornato: attende Complete, legge i nomi Unicode e termina al primo vuoto', async () => {
    let polls = 0, disconnected = false;
    await fixture(async (config, requests) => {
        const result = await readStoredPrograms(config);
        assert.deepEqual(result.programs, ['Ciclo_1_530_8h', 'Ricottura è <test>']);
        assert(Number.isSafeInteger(result.readAtMs));
        assert.deepEqual(requests.filter(r => r.fc !== 3), [{ fc: 6, address: 14976, value: 1 }]);
        assert(requests.every(r => r.address === 14928 || r.address === 14976 || (r.address >= 30976 && r.address <= 30978 && r.value === 21)));
    }, (r, socket) => {
        if (r.fc === 6) return [];
        if (r.address === 14928) return [1,1];
        if (r.address === 14976) return [++polls === 1 ? 1 : 0];
        if (!disconnected) { disconnected = true; socket.destroy(); return null; }
        return encode(['Ciclo_1_530_8h', 'Ricottura è <test>', ''][r.address - 30976]);
    });
});

test('archivio vuoto distinto da errore di comunicazione', async () => {
    await fixture(async config => assert.deepEqual((await readStoredPrograms(config)).programs, []), r => r.fc === 6 ? [] : r.address === 14928 ? [1,1] : r.address === 14976 ? [0] : encode(''));
    await fixture(async config => assert.rejects(readStoredPrograms(config), /interrotta/), (_r, socket) => { socket.destroy(); return null; });
});

test('fino a 100 file senza letture oltre la tabella', async () => {
    await fixture(async (config, requests) => {
        const result = await readStoredPrograms(config);
        assert.equal(result.programs.length, 100); assert.equal(result.programs[99], 'Ciclo 100');
        assert.equal(requests.at(-1).address, 31075);
    }, r => r.fc === 6 ? [] : r.address === 14928 ? [1,1] : r.address === 14976 ? [0] : encode('Ciclo ' + (r.address - 30975)));
});

test('Run e Hold: accesso al ciclo caricato senza Get Listing né altre scritture',async()=>{
    for(const mode of [2,4])await fixture(async(config,requests)=>{
        const result=await readStoredPrograms(config);
        assert.deepEqual(result.programs,['Ciclo in corso']);assert.equal(result.scope,'current');assert.equal(result.mode,mode);
        assert(requests.every(r=>r.fc===3));assert.deepEqual(requests.map(r=>r.address),[14928,27323]);
        const recipe=await readProgramRecipe(config,'Ciclo in corso');assert.equal(recipe.name,'Ciclo in corso');
        assert(requests.every(r=>r.fc===3));
    },(r,socket)=>{
        if(r.address===14928)return [mode,mode];
        if(r.address===27323)return encode('Ciclo in corso');
        return recipeDeviceForRunning(r,socket);
    });
});
const recipeDeviceForRunning=recipeDevice().reply;

test('Get Listing rifiutato se parte un ciclo: recupero del programma caricato',async()=>{
    let started=false;
    await fixture(async(config,requests)=>{
        const result=await readStoredPrograms(config);assert.equal(result.scope,'current');assert.deepEqual(result.programs,['Ciclo in corso']);
        assert.deepEqual(requests.filter(r=>r.fc!==3),[{fc:6,address:14976,value:1}]);
    },(r,socket)=>{
        if(r.address===14928)return started?[2,2]:[1,1];
        if(r.address===27323)return encode('Ciclo in corso');
        if(r.fc===6){started=true;socket.destroy();return null;}
        throw Error('Unexpected request');
    });
});

test('richieste simultanee condivise, nuova lettura dopo successo o errore', async () => {
    let calls = 0, finish;
    const read = createStoredProgramsReader(() => { calls++; return new Promise((resolve, reject) => { finish = { resolve, reject }; }); });
    const first = read(), second = read(); assert.equal(first, second); assert.equal(calls, 1);
    finish.resolve({ programs: [], readAtMs: 1 }); await first;
    const failed = read(); assert.equal(calls, 2); finish.reject(Error('offline')); await assert.rejects(failed, /offline/);
    const next = read(); assert.equal(calls, 3); finish.resolve({ programs: ['Nuovo'], readAtMs: 2 }); assert.deepEqual((await next).programs, ['Nuovo']);
});

function recipeDevice(options={}) {
    let name='Ciclo originale',entry='',loads=[],revision=1,externallyRunning=false;
    const reply=(r,socket)=>{
        if(r.fc===16){assert.equal(r.address,27281);entry=String.fromCharCode(...r.words).split('\0')[0];return [];}
        if(r.fc===6){
            if(r.address===14912){assert.equal(r.value,2);loads.push(entry);name=entry;revision++;}
            else {assert.equal(r.address,14976);assert.equal(r.value,1);}return [];
        }
        if(r.address===14928)return [options.running||externallyRunning?2:1,options.running||externallyRunning?2:1];
        if(r.address===27323)return encode(name);
        if(r.address===14916)return [options.amended?1:0];
        if(r.address===4256)return [revision];
        if(r.address===14880)return [1,0,0,0,1,0,0,0,0,0,0,0];
        if(r.address===15008)return [0,0,0,0,0,0,0,0];
        if(r.address===14912)return r.value===1?[1]:[1,1];
        if(r.address===14976)return [0];
        if(r.address>=30976&&r.address<=31075)return encode(['Ciclo originale','Altro ciclo',''][r.address-30976]);
        if(r.address>=27344&&r.address<=27869)return encode(String((r.address-27344)/21+1));
        if(r.address>=62848&&r.address<65536){
            if(options.failRecipe&&name==='Altro ciclo'){if(options.runOnFailure)externallyRunning=true;socket.destroy();return null;}
            const index=(r.address-62848)/96,b=Buffer.alloc(144);
            // Nativo: enum nel primo word, float32 e millisecondi big endian.
            b.writeUInt16BE(index===0?1:index===1?2:0,0);
            b.writeUInt32BE(index===1?14400000:0,4);b.writeFloatBE(375,8);
            b.writeUInt32BE(7200000,16);b.writeFloatBE(0.1,24);b.writeUInt16BE(1,32);
            return Array.from({length:72},(_,i)=>b.readUInt16BE(i*2));
        }
        throw Error('Unexpected register '+r.address);
    };
    return {reply,get loads(){return loads;},get name(){return name;}};
}

test('ricetta caricata: soltanto FC03, tempi nativi in ms e target float32',async()=>{
    const device=recipeDevice();
    await fixture(async(config,requests)=>{
        const recipe=await readProgramRecipe(config,'Ciclo originale');
        assert.equal(recipe.segments[0].targets[0],375);assert.equal(recipe.segments[0].rampSeconds[0],7200);
        assert.equal(recipe.segments[1].durationSeconds,14400);assert.equal(recipe.segments[2].type,0);
        assert(requests.every(r=>r.fc===3));
    },device.reply);
});

test('altro ciclo: chiede autorizzazione senza Load; Run e modifiche non salvate bloccano il caricamento',async()=>{
    for(const options of [{},{running:true},{amended:true}]){
        const device=recipeDevice(options);
        await fixture(async(config,requests)=>{
            if(options.running||options.amended)await assert.rejects(readProgramRecipe(config,'Altro ciclo',true),/esecuzione|modifiche non salvate/);
            else assert.deepEqual(await readProgramRecipe(config,'Altro ciclo'),{needsTemporaryLoad:true,currentProgram:'Ciclo originale'});
            assert(requests.every(r=>r.fc===3));
        },device.reply);
    }
});

test('lettura autorizzata: ripristina il programma iniziale anche dopo errore, nessun comando Run/Reset/Store',async()=>{
    for(const failRecipe of [false,true]){
        const device=recipeDevice({failRecipe});
        await fixture(async(config,requests)=>{
            if(failRecipe)await assert.rejects(readProgramRecipe(config,'Altro ciclo',true,'Ciclo originale'),/interrotta/);
            else assert.equal((await readProgramRecipe(config,'Altro ciclo',true,'Ciclo originale')).name,'Altro ciclo');
            assert.deepEqual(device.loads,['Altro ciclo','Ciclo originale']);assert.equal(device.name,'Ciclo originale');
            assert(requests.filter(r=>r.fc!==3).every(r=>r.address===27281||r.address===14912||r.address===14976));
        },device.reply);
    }
});

test('ripristino sospeso con errore esplicito se il forno viene avviato dal pannello',async()=>{
    const device=recipeDevice({failRecipe:true,runOnFailure:true});
    await fixture(async(config,requests)=>{
        await assert.rejects(readProgramRecipe(config,'Altro ciclo',true,'Ciclo originale'),/Ripristino.*non confermato/);
        assert.deepEqual(device.loads,['Altro ciclo']);
        assert(!requests.some(r=>r.fc!==3&&[14904,14905,14906,14907,14908].includes(r.address)));
    },device.reply);
});

test('conferma riferita a un programma iniziale diverso: nessuna scrittura',async()=>{
    const device=recipeDevice();
    await fixture(async(config,requests)=>{
        await assert.rejects(readProgramRecipe(config,'Altro ciclo',true,'Vecchio ciclo'),/cambiato dopo la conferma/);
        assert(requests.every(r=>r.fc===3));
    },device.reply);
});
