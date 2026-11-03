import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { createProgramConnection, type Connection } from './programs';
import { buildTransferPlan, digest, programName, type Field } from './program-transfer-plan';
import { decodeRecipeSegment, type ProgramRecipe } from './program-recipe';

type Client = ReturnType<typeof createProgramConnection>;
type Config = Connection & { dbPath: string };
const fail = (message: string): never => { throw new Error(message); };
const decode = (words: number[]) => String.fromCharCode(...words).split('\0')[0];
const pause = () => new Promise(resolve => setTimeout(resolve, 80));
function atomic(file: string, value: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.' + randomUUID() + '.tmp', bytes = JSON.stringify(value, null, 2) + '\n';
    const fd = fs.openSync(tmp, 'wx'); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file); if (fs.readFileSync(file, 'utf8') !== bytes) fail('Rilettura del registro trasferimenti non coincidente.');
}
const folder = (c: Config) => path.join(path.dirname(c.dbPath), 'forno-program-transfers');
const stateFile = (c: Config) => path.join(folder(c), 'state.json');
function registry(c: Config): any {
    const file = stateFile(c); if (!fs.existsSync(file)) return { version: 1, device: [c.host,c.port,c.unit], owned: {}, pending: null };
    const value = JSON.parse(fs.readFileSync(file,'utf8'));
    if (value.version!==1 || !value.owned || JSON.stringify(value.device)!==JSON.stringify([c.host,c.port,c.unit])) fail('Registro trasferimenti non valido per questo forno.');
    return value;
}
async function reset(client: Client, expectedName?: string, clean = false) {
    const [mode,status] = await client.read(14928,2), [operation] = await client.read(14912,1), [amended] = await client.read(14916,1), name = decode(await client.read(27323,21));
    if (operation!==1) fail('Chiudere la lista programmi sul pannello e tornare alla schermata del ciclo in Reset. Operazione file occupata/selezionata: '+operation+'.');
    if (mode!==1 || status!==1 || (clean && amended!==0) || (expectedName!==undefined && name!==expectedName)) fail('Operazione bloccata: richiesti Reset, nome atteso e nessuna modifica esterna.');
    return { mode,status,amended,name };
}
async function listing(client: Client) {
    await reset(client); await client.refreshList();
    while ((await client.read(14976,1))[0]!==0) await pause();
    return readListing(client);
}
async function readListing(client: Client) {
    const names: string[]=[];
    for(let i=0;i<100;i++){const name=decode(await client.read(30976+i,21));if(!name)break;names.push(name);}
    if(new Set(names.map(n=>n.toLowerCase())).size!==names.length)fail('Nomi ambigui nell’archivio forno.');
    return names;
}
async function image(client: Client) {
    const before=await reset(client), [revision]=await client.read(4256,1);
    const settings=await client.read(15008,8), features=await client.read(14848,4), setup=[...await client.read(14880,5),...await client.read(14890,4)], resetEvents=await client.read(14894,8), resetUser=await client.read(32768+14902*2,4);
    const limits: number[]=[];
    for(const address of [5726,5727,5982,5983]){const words=await client.read(32768+address*2,2),b=Buffer.alloc(4);words.forEach((n,i)=>b.writeUInt16BE(n,i*2));limits.push(b.readFloatBE());}
    const segments=[];
    for(let i=0;i<26;i++)segments.push({words:await client.read(32768+(15040+48*i)*2,72),name:await client.read(27344+21*i,21)});
    const after=await reset(client), [endRevision]=await client.read(4256,1);
    if(digest(before)!==digest(after)||revision!==endRevision)fail('Il forno è cambiato durante la lettura.');
    return { before,revision,settings,features,setup,resetEvents,resetUser,limits,segments };
}
function checkMachine(s: Awaited<ReturnType<typeof image>>) {
    if(s.setup[0]!==1 || s.setup[8]!==3 || s.features[0] || s.features[1] || !s.features[2])fail('Trasferimento limitato al forno CH1, tre eventi, User Value attivo e Holdback/PV nativi disabilitati.');
    if(s.resetEvents.some(Boolean))fail('Per il collaudo sono richieste tutte le uscite evento di Reset OFF.');
    const min=Math.max(0,s.limits[1],s.limits[3]),max=Math.min(s.limits[0],s.limits[2]);
    if(!Number.isFinite(min)||!Number.isFinite(max)||min>=max)fail('Limiti termici dei loop non validi.');
    return {min,max};
}
async function compare(client: Client, fields: Field[]) {
    for(const field of fields){const got=await client.read(field.address,field.words.length);
        if(field.bool ? Boolean(got[0])!==Boolean(field.words[0]) : digest(got)!==digest(field.words))fail('Rilettura diversa: '+field.label+' (registro '+field.address+').');}
}
async function operation(client: Client, op: 2|4|8, name: string, expectedLoaded?: string) {
    await reset(client,expectedLoaded); await client.selectFilename(name); await reset(client,expectedLoaded); await client.fileOperation(op);
    while(true){const [state,status]=await client.read(14912,2);if(state===1){if(status!==1)fail('Operazione file non riuscita: '+(await client.read(14917,1))[0]);break;}await pause();}
    await reset(client,op===2?name:undefined);
}
const tickets=new Map<string,any>();
const snapshots=new Map<string,any>();
export const transferMode=()=>['tests','manage'].includes(process.env.AYPI_FORNO_PROGRAM_TRANSFERS||'')?process.env.AYPI_FORNO_PROGRAM_TRANSFERS:'off';
export function transfersEnabled(){return transferMode()!=='off';}
const deviceKey=(config:Config)=>JSON.stringify([config.host,config.port,config.unit,config.dbPath]);
function recipeFromImage(s:Awaited<ReturnType<typeof image>>):ProgramRecipe {
    const channels=s.setup[0],segments=[];
    for(let i=0;i<26;i++){const segment=decodeRecipeSegment(i+1,decode(s.segments[i].name),s.segments[i].words,channels);segments.push(segment);if(segment.type===0)break;}
    return {name:s.before.name,readAtMs:Date.now(),channels,rampStyle:s.settings[5],rampUnits:s.settings.slice(6,6+channels),servoTo:s.setup.slice(5,5+channels),holdback:s.features[0]&&s.settings[0]===1?s.settings.slice(1,1+channels):[],segments,maxEvents:s.setup[8],resetEvents:s.resetEvents.map(Boolean),resetEventRaw:s.resetEvents,resetUserValues:Array.from({length:channels},(_,i)=>{const b=Buffer.alloc(4);b.writeUInt16BE(s.resetUser[2*i],0);b.writeUInt16BE(s.resetUser[2*i+1],2);return b.readFloatBE();}),features:{holdback:!!s.features[0],pvEvents:!!s.features[1],userValues:!!s.features[2],messages:!!s.features[3]}};
}
/** La selezione esplicita carica il file in Reset, senza Store o Run. */
export async function inspectProgram(config:Config,input:any,actor:string,connect=createProgramConnection){
    if(transferMode()!=='manage')fail('Aggiornare il backend: la gestione completa dei programmi non e abilitata.');
    const state=registry(config);if(state.pending)fail('Tentativo precedente da verificare: '+state.pending.backup);
    programName(input?.name);const name=input.name,client=connect(config,180000),id=randomUUID(),backup=path.join(folder(config),id+'.json');let changed=false;
    try{
        await reset(client,undefined,true);const names=await listing(client);if(!names.includes(name))fail('Programma non presente sul forno.');
        const before=await image(client);
        {
            atomic(backup,{format:'aypi-forno-transfer-backup',version:1,id,createdAt:Date.now(),device:[config.host,config.port,config.unit],actor,action:'inspect',name,before,storedPrograms:names,previousEntry:null,sha256:digest({before,names})});
            state.pending={id,name,action:'inspect',backup,startedAt:Date.now(),stage:'load-for-inspection'};atomic(stateFile(config),state);changed=true;
            await operation(client,2,name,before.before.name);await reset(client,name,true);
        }
        const loaded=await image(client);await reset(client,name,true);
        if(digest(loaded)!==digest(await image(client)))fail('Il programma e cambiato durante la lettura.');
        if(digest(await listing(client))!==digest(names))fail('Archivio cambiato durante la lettura.');
        if(changed){atomic(path.join(folder(config),id+'.receipt.json'),{id,action:'inspect',name,verified:true,backup,completedAt:Date.now(),current:loaded.before,imageSha256:digest(loaded)});state.pending=null;atomic(stateFile(config),state);changed=false;}
        for(const [key,value]of snapshots)if(value.expiresAt<Date.now())snapshots.delete(key);
        if(snapshots.size>=100)snapshots.delete(snapshots.keys().next().value);
        const token=randomUUID();snapshots.set(token,{name,image:loaded,actor,configKey:deviceKey(config),expiresAt:Date.now()+7200000});
        return {...recipeFromImage(loaded),editToken:token,loadedInReset:true};
    }catch(error){if(changed){state.pending={...state.pending,lastError:(error as Error).message,failedAt:Date.now()};atomic(stateFile(config),state);throw Error('Caricamento non verificato. Nessun Run. Controllare il backup '+backup+'. '+(error as Error).message);}throw error;}finally{client.close();}
}
export async function transferContext(config: Config, connect=createProgramConnection) {
    const state=registry(config),client=connect(config,120000);
    try {const current=await reset(client);return {enabled:transfersEnabled(),current,programs:state.pending?await readListing(client):await listing(client),managed:Object.keys(state.owned),managedPrograms:Object.entries(state.owned).map(([name,entry]:[string,any])=>({name,draft:entry.plan.draft,verifiedAt:entry.verifiedAt})),pending:state.pending,mode:transferMode(),backupDirectory:folder(config)};}finally{client.close();}
}
export async function prepareTransfer(config: Config, input: any, actor: string, connect=createProgramConnection) {
    if(!transfersEnabled())fail('Aggiornare il backend e abilitare AYPI_FORNO_PROGRAM_TRANSFERS=tests sul server.');
    const state=registry(config);if(state.pending)fail('Operazione precedente non verificata: controllare il forno e il backup '+state.pending.backup+(state.pending.lastError?'. Causa precedente ('+state.pending.stage+'): '+state.pending.lastError:''));
    const action=input?.action;if(!['upload','delete','load'].includes(action))fail('Azione non valida.');
    const full=transferMode()==='manage';
    const name=action==='upload'?input.draft?.name:input.name;programName(name,!full);
    const client=connect(config,120000);
    try{
        await reset(client,undefined,true);const names=await listing(client),before=await image(client),limits=checkMachine(before);
        const entry=state.owned[name],exists=names.some(n=>n.toLowerCase()===name.toLowerCase());
        if(exists&&!names.includes(name))fail('Il nome differisce solo per maiuscole/minuscole: usare il nome esatto presente sul forno.');
        if(!full){
            if(exists&&!entry)fail('Questo programma esiste gia e non e una prova creata da AyPi: e protetto.');
            if(action!=='upload'&&!entry)fail('Operazione consentita solo sulle prove create da questa installazione.');
            if(action!=='upload'&&!exists)fail('Programma di prova non presente sul forno.');
            if(action!=='load'&&exists){if(before.before.name!==name)fail('Caricare prima questa prova per verificarla.');await compare(client,entry.plan.fields);}
        }else{
            if(action!=='upload'&&!exists)fail('Programma non presente sul forno.');
            if(action==='upload'&&exists&&input.overwrite!==true)fail('Il nome esiste gia: scegliere esplicitamente Sovrascrivi programma.');
            if(action==='upload'&&!exists&&input.overwrite===true)fail('Il programma da sovrascrivere non esiste piu.');
            if(exists){
                const snapshot=snapshots.get(input.expectedSnapshot);
                if(!snapshot||snapshot.expiresAt<Date.now()||snapshot.actor!==actor||snapshot.configKey!==deviceKey(config)||snapshot.name!==name)fail('Riaprire il programma dal forno prima di modificarlo o eliminarlo: lettura di riferimento assente o scaduta.');
                if(before.before.name!==name||digest(snapshot.image)!==digest(before))fail('Il programma sul forno e cambiato: riaprirlo prima di procedere.');
            }
        }
        if(action==='upload'&&!exists&&names.length>=100)fail('Archivio del forno pieno.');
        const plan=action==='upload'?buildTransferPlan(input.draft,limits,full):(full?{fields:[],draft:null}:entry.plan);
        const restoreName=entry?.restoreName&&names.includes(entry.restoreName)?entry.restoreName:(before.before.name!==name&&names.includes(before.before.name)?before.before.name:names.find(n=>n!==name&&!state.owned[n])||names.find(n=>n!==name)||'');
        if(action==='delete'&&before.before.name===name&&!restoreName)fail('Prima di eliminare la prova caricata, caricare dal pannello un altro programma salvato.');
        const token=randomUUID(),expiresAt=Date.now()+180000;
        const ticket={token,expiresAt,action,name,plan,actor,before,names,restoreName,mode:transferMode(),exists,entryHash:entry?digest(entry):null,configKey:JSON.stringify([config.host,config.port,config.unit,config.dbPath])};
        for(const [key,value] of tickets)if(value.expiresAt<Date.now())tickets.delete(key);
        if(tickets.size>=20)fail('Troppe verifiche in attesa: riprovare fra tre minuti.');tickets.set(token,ticket);
        return {token,expiresAt,action,name,exists,segments:plan.draft?.steps.length||recipeFromImage(before).segments.length,program:plan.draft,recipe:action==='upload'?null:recipeFromImage(before),limits,currentProgram:before.before.name,events:(plan.draft?.steps||[]).map((s:any,i:number)=>({phase:i+1,events:s.events})),changes:plan.fields.map((f:Field)=>f.label),backupDirectory:folder(config),message:action==='load'?'Caricamento in Reset, senza Run':action==='delete'?'Eliminazione del solo programma selezionato; backup completo prima della modifica':exists?'SOVRASCRITTURA del programma esistente: backup, scrittura, Store e Load con confronto. Nessun Run.':'Nuovo programma: backup, scrittura, Store e Load con confronto. Nessun Run.'};
    }finally{client.close();}
}
export async function executeTransfer(config: Config, input: any, actor: string, connect=createProgramConnection) {
    if(!transfersEnabled())fail('Trasferimenti di collaudo disabilitati.');
    const ticket=tickets.get(input?.token);if(!ticket||ticket.expiresAt<Date.now()||ticket.actor!==actor||ticket.configKey!==JSON.stringify([config.host,config.port,config.unit,config.dbPath]))fail('Verifica scaduta o non valida: preparare nuovamente l’operazione.');
    if(ticket.mode!==transferMode())fail('Modalita trasferimenti cambiata: preparare nuovamente.');
    tickets.delete(input.token);const state=registry(config);if(state.pending)fail('Operazione precedente non verificata.');
    if((state.owned[ticket.name]?digest(state.owned[ticket.name]):null)!==ticket.entryHash)fail('Registro prove cambiato: verificare nuovamente.');
    const client=connect(config,180000),id=randomUUID(),backup=path.join(folder(config),id+'.json');let changed=false,stage='preflight';let lastField:Field|null=null;
    try{
        await reset(client,undefined,true);const names=await listing(client),before=await image(client);
        if(digest(before)!==digest(ticket.before)||digest(names)!==digest(ticket.names))fail('Il forno è cambiato dopo la verifica: nessuna scrittura effettuata.');
        atomic(backup,{format:'aypi-forno-transfer-backup',version:1,id,createdAt:Date.now(),device:[config.host,config.port,config.unit],actor,action:ticket.action,name:ticket.name,before,storedPrograms:names,previousEntry:state.owned[ticket.name]||null,recipeBefore:recipeFromImage(before),requested:ticket.plan,targetExisted:ticket.exists,sha256:digest({before,names})});
        state.pending={id,name:ticket.name,action:ticket.action,backup,startedAt:Date.now()};atomic(stateFile(config),state);
        changed=true;
        if(ticket.mode==='manage'&&ticket.exists){
            stage='verify-stored-target';await operation(client,2,ticket.name,before.before.name);await reset(client,ticket.name,true);
            if(!restoredImageComparison(await image(client),before).matches)fail('Il file salvato e cambiato dopo la lettura: nessuna sovrascrittura o eliminazione eseguita.');
        }
        if(ticket.action==='upload'){
            // Fine esplicita prima delle altre fasi: nessun segmento della vecchia coda diventa parte della prova.
            const endBase=15040+48*(ticket.plan.draft.steps.length-1);
            stage='stage-ram';
            for(const field of ticket.plan.fields.filter(f=>f.address<15040)){await reset(client,before.before.name);lastField=field;await client.writeRecipe(field.address,field.words);await compare(client,[field]);}
            await reset(client,before.before.name);lastField={address:endBase,words:[0],label:'Fine di delimitazione'};await client.writeRecipe(endBase,[0]);
            await reset(client,before.before.name);lastField={address:endBase+8,words:[1],label:'Reset Fine di delimitazione'};await client.writeRecipe(endBase+8,[1]);
            for(const field of ticket.plan.fields.filter(f=>f.address>=15040)){await reset(client,before.before.name);lastField=field;await client.writeRecipe(field.address,field.words);}
            stage='compare-before-store';await compare(client,ticket.plan.fields);await reset(client,before.before.name);
            stage='store';lastField=null;await operation(client,4,ticket.name,before.before.name);
            const stored=await reset(client,undefined,true);
            stage='load';await operation(client,2,ticket.name,stored.name);await reset(client,ticket.name,true);
            stage='compare-after-load';await compare(client,ticket.plan.fields);
            const loadedImage=await image(client);checkMachine(loadedImage);
            if(digest(loadedImage.features)!==digest(before.features)||digest(loadedImage.setup)!==digest(before.setup)||digest(loadedImage.resetEvents)!==digest(before.resetEvents)||digest(loadedImage.resetUser)!==digest(before.resetUser))fail('Configurazione o uscite di Reset cambiate durante il trasferimento.');
            const afterNames=await listing(client),expected=[...new Set([...names,ticket.name])].sort();
            if(digest([...afterNames].sort())!==digest(expected))fail('Elenco programmi inatteso dopo Store.');
            state.owned[ticket.name]={plan:ticket.plan,restoreName:ticket.restoreName,backup,verifiedAt:Date.now()};
        }else if(ticket.action==='load'){
            if(ticket.mode!=='manage')await operation(client,2,ticket.name,before.before.name);await reset(client,ticket.name,true);await compare(client,ticket.plan.fields);
        }else{
            if(before.before.name===ticket.name){if(!names.includes(ticket.restoreName))fail('Programma iniziale da ripristinare non presente.');await operation(client,2,ticket.restoreName,ticket.name);await reset(client,ticket.restoreName,true);}
            await operation(client,8,ticket.name);const afterNames=await listing(client);
            if(digest([...afterNames].sort())!==digest(names.filter(n=>n!==ticket.name).sort()))fail('Elenco programmi inatteso dopo Delete.');
            delete state.owned[ticket.name];
        }
        const current=await reset(client,undefined,true);
        const receipt={id,action:ticket.action,name:ticket.name,verified:true,current,backup,backupData:JSON.parse(fs.readFileSync(backup,'utf8')),draft:ticket.plan.draft,completedAt:Date.now(),message:'Operazione verificata. Forno in Reset; nessun comando Run inviato.'};atomic(path.join(folder(config),id+'.receipt.json'),receipt);state.pending=null;atomic(stateFile(config),state);return receipt;
    }catch(error){if(changed){try{state.pending={...state.pending,stage,lastField,lastError:(error as Error).message,failedAt:Date.now()};atomic(stateFile(config),state);}catch{/* il backup e il pending precedente restano conservati */}throw new Error('Esito non verificato: non ripetere l’operazione. Nessun Run inviato. La copia di lavoro in RAM puo essere parziale: non avviarla ne salvarla. Backup '+backup+'. Fase '+stage+(lastField?' / '+lastField.label+' / registro '+lastField.address:'')+'. '+(error as Error).message);}throw error;}finally{client.close();}
}


/** Il Load ripristina i parametri applicabili, ma puo conservare EndType di una
 * precedente delimitazione in una fase tornata Ramp/Dwell/etc. HA030554: EndType
 * si applica solo a Type=End. Tutti gli altri word, nomi e configurazioni restano
 * confrontati integralmente. Conservare nella ricevuta anche queste differenze. */
function restoredImageComparison(current: Awaited<ReturnType<typeof image>>, original: Awaited<ReturnType<typeof image>>) {
    const normalized=JSON.parse(JSON.stringify(current)),inactiveFields: {phase:number;address:number;before:number;after:number;reason:string}[]=[];
    for(let i=0;i<26;i++){
        const before=original.segments[i].words,after=current.segments[i].words;
        if(before[0]===after[0]&&[1,2,3,4,5].includes(before[0])&&[0,1].includes(before[16])&&[0,1].includes(after[16])&&before[16]!==after[16]){
            normalized.segments[i].words[16]=before[16];
            inactiveFields.push({phase:i+1,address:15040+48*i+8,before:before[16],after:after[16],reason:'EndType non applicabile: segmento non Fine'});
        }
    }
    return {matches:digest(normalized)===digest(original),inactiveFields};
}

/** Sblocca soltanto una NUOVA prova assente, con parametri programma ripristinati dal backup.
 * Non ripristina ricette, non Store/Delete/Load e non cancella la traccia del tentativo. */
export async function reconcileUnchangedTransfer(config: Config, actor: string, connect=createProgramConnection) {
    if(!transfersEnabled())fail('Trasferimenti di collaudo disabilitati.');
    const state=registry(config),pending=state.pending;
    if(!pending) return {verified:true,message:'Nessun tentativo interrotto da riconciliare.'};
    if(pending.action!=='upload'||!/^[a-f0-9-]{36}$/.test(pending.id))fail('Recupero automatico non applicabile: verificare il forno con il backup.');
    const backupPath=path.join(folder(config),pending.id+'.json'),backup=JSON.parse(fs.readFileSync(backupPath,'utf8'));
    if(backup.format!=='aypi-forno-transfer-backup'||backup.id!==pending.id||backup.name!==pending.name||digest(backup.device)!==digest(state.device)||backup.previousEntry||backup.storedPrograms.includes(backup.name)||digest({before:backup.before,names:backup.storedPrograms})!==backup.sha256)fail('Backup non valido o prova gia esistente: nessuno sblocco eseguito.');
    const client=connect(config,120000);
    try {
        const before=await image(client);
        const comparison=restoredImageComparison(before,backup.before);
        if(before.before.amended!==0||!comparison.matches)fail('La RAM non coincide con i parametri del backup: nessuno sblocco.');
        await reset(client,backup.before.before.name,true);
        const names=await listing(client),after=await image(client);
        if(digest(names)!==digest(backup.storedPrograms)||names.includes(backup.name)||digest(after)!==digest(before)||!restoredImageComparison(after,backup.before).matches)fail('Archivio o RAM cambiati: nessuno sblocco.');
        const latest=registry(config);if(digest(latest)!==digest(state))fail('Registro trasferimenti cambiato durante la verifica.');
        const proof={format:'aypi-forno-transfer-reconciliation',version:1,id:pending.id,actor,verifiedAt:Date.now(),outcome:comparison.inactiveFields.length?'original-restored-test-absent':'original-unchanged-test-absent',inactiveFields:comparison.inactiveFields,backup:backupPath,backupSha256:backup.sha256,imageSha256:digest(after),programs:names};
        const receipt=path.join(folder(config),pending.id+'.reconciled.json');
        atomic(path.join(folder(config),pending.id+'.state-before-reconcile.json'),state);atomic(receipt,proof);
        state.pending=null;state.lastReconciliation=receipt;atomic(stateFile(config),state);
        return {verified:true,current:after.before,receipt,message:comparison.inactiveFields.length?'Sbloccato: parametri del programma originale ripristinati e prova assente. Differenze limitate a EndType inattivi, elencate nella ricevuta. Nessun Run.':'Sbloccato dopo confronto completo: programma originale invariato, prova assente. Nessun programma scritto o avviato.'};
    }finally{client.close();}
}
