import fs from 'fs';
import path from 'path';
import {createHash} from 'crypto';
import {backendConfig} from '../../config';
import {logger} from '../../shared/logging/logger';
import {cleanupMaintenanceArchive,importMaintenance,maintenanceSnapshot} from './service';

/** Consumed by the sole backend DB owner, after its normal process/port lock. */
export function initializeMaintenanceArchive(){
    const file=path.join(path.dirname(backendConfig.database.path),'maintenance-import.pending.json');
    const snapshot=maintenanceSnapshot();
    if(fs.existsSync(file)){
        const raw=fs.readFileSync(file),digest=createHash('sha256').update(raw).digest('hex');
        if(snapshot.importInfo?.seedHash===digest){fs.unlinkSync(file);}
        else if(snapshot.importInfo||snapshot.machines.length||snapshot.plans.length||snapshot.records.length){
            logger.warn('Maintenance import not applied: archive already contains data',{module:'maintenance',event:'maintenance_import_skipped',file});
        }else{
            const seed=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));
            const info=importMaintenance({...seed,seedHash:digest},'Migrazione AyPi');
            // Commit and persist precede removal; a crash here is idempotent on restart.
            fs.unlinkSync(file);
            logger.info('Maintenance automatic import complete',{module:'maintenance',event:'maintenance_import_complete',machines:info.machines,plans:info.plans,ordinary:info.ordinary,extraordinary:info.extraordinary,attachments:info.attachments});
        }
    }
    cleanupMaintenanceArchive();
}
