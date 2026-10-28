import { randomUUID } from 'crypto';
import { deflateSync } from 'zlib';
import { Archive, history, summarize, type Sample, type Identity } from './archive';
export class MultiChannelArchive {
    readonly core: Archive;
    readonly migrationBackup: string | null;
    private states = new Map<number,{last:number|null;first:number|null;count:number}>();
    constructor(file:string,identity:Identity) {
        this.core=new Archive(file,identity);
        const db=this.core.db;
        this.migrationBackup=null;
        try {
            const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE name='blocks_channels'").get();
            if(!exists && db.prepare('SELECT 1 FROM blocks LIMIT 1').get()) {
                this.migrationBackup=file+'.pre-multichannel-'+randomUUID()+'.bak';
                db.prepare('VACUUM INTO ?').run(this.migrationBackup);
            }
            db.transaction(()=>{
                db.exec(`CREATE TABLE IF NOT EXISTS pending_channels(channel INTEGER NOT NULL,t INTEGER NOT NULL,v INTEGER,q INTEGER NOT NULL,PRIMARY KEY(channel,t));
                    CREATE TABLE IF NOT EXISTS blocks_channels(channel INTEGER NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,count INTEGER NOT NULL,valid INTEGER NOT NULL,
                        minimum INTEGER,maximum INTEGER,total INTEGER NOT NULL,first_t INTEGER,first_v INTEGER,last_t INTEGER,last_v INTEGER,min_t INTEGER,max_t INTEGER,payload BLOB NOT NULL,PRIMARY KEY(channel,start));
                    CREATE INDEX IF NOT EXISTS idx_blocks_channels_end ON blocks_channels(channel,end);`);
                const expected=[1,2,3,4].map(id=>({id,address:identity.address+(id-1)*4,scale:identity.scale}));
                const stored=db.prepare("SELECT value FROM metadata WHERE key='channels-v2'").get();
                if(stored && JSON.stringify(JSON.parse(stored.value))!==JSON.stringify(expected))throw new Error('Configurazione canali diversa da quella archiviata');
                db.prepare("INSERT OR IGNORE INTO metadata VALUES ('channels-v2',?)").run(JSON.stringify(expected));
                for(const id of [2,3,4])this.seal(id);
            })();
            for(const id of [2,3,4])this.states.set(id,{last:db.prepare('SELECT MAX(end) t FROM blocks_channels WHERE channel=?').get(id).t,first:null,count:0});
        } catch(error){try{this.core.close();}catch{}throw error;}
    }
    appendFrame(samples:Sample[]) {
        if(samples.length!==4)throw new Error('Sono richiesti quattro campioni');
        const t=samples[0].t;
        for(const row of samples)if(row.t!==t||!Number.isSafeInteger(t)||t<0||!Number.isInteger(row.q)||row.q<0||row.q>255||(row.q===0&&row.v===null)||(row.v!==null&&(!Number.isInteger(row.v)||row.v< -32768||row.v>65535)))throw new Error('Campione multicanale non valido');
        for(const state of this.states.values())if(state.last!==null&&t<=state.last)throw new Error('Orologio non crescente');
        this.core.db.transaction(()=>{
            this.core.append(samples[0]);
            for(const id of [2,3,4]){
                const state=this.states.get(id)!,row=samples[id-1];
                if(state.first!==null&&t-state.first>0xffffffff){this.seal(id);state.count=0;state.first=null;}
                this.core.db.prepare('INSERT INTO pending_channels VALUES (?,?,?,?)').run(id,row.t,row.v,row.q);
                state.count++;state.last=t;if(state.first===null)state.first=t;
                if(state.count>=120){this.seal(id);state.count=0;state.first=null;}
            }
        })();
    }
    private seal(channel:number) {
        const db=this.core.db,rows:Sample[]=db.prepare('SELECT t,v,q FROM pending_channels WHERE channel=? ORDER BY t').all(channel);
        if(!rows.length)return;
        const start=rows[0].t,s=summarize(rows),raw=Buffer.alloc(rows.length*9);
        rows.forEach((r,i)=>{raw.writeUInt32LE(r.t-start,i*9);raw.writeInt32LE(r.v===null?-2147483648:r.v,i*9+4);raw[i*9+8]=r.q;});
        db.prepare('INSERT INTO blocks_channels VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(channel,start,rows[rows.length-1].t,s.count,s.valid,s.minimum,s.maximum,s.total,s.first_t,s.first_v,s.last_t,s.last_v,s.min_t,s.max_t,deflateSync(raw));
        db.prepare('DELETE FROM pending_channels WHERE channel=?').run(channel);
    }
    close(){try{this.core.db.transaction(()=>{for(const id of [2,3,4])this.seal(id);})();}finally{this.core.close();}}
}
export function historyChannels(db:any,start:number,end:number,interval=500,maxPoints=2000) {
    db.exec('BEGIN');
    try{
        const channels=[1,2,3,4].map(id=>({id,name:'Canale '+id,...history(db,start,end,interval,maxPoints,id,false)}));
        return {...channels[0],channels};
    }finally{db.exec('ROLLBACK');}
}
