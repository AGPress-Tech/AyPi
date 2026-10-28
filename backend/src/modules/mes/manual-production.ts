import { randomUUID } from "crypto";
import { getMesSqliteDatabase, runMesSqliteTransaction } from "../../shared/db/mes-sqlite";
import { HttpError } from "../../shared/http/errors";
import { createOperationQueue } from "../../shared/ops/queue";
import { initializeMesSqliteStore, rebuildOperatingTail, storeMachineEvents } from "./repository";

const enqueue = createOperationQueue('mes-manual');
export function declareManualProduction(input: {
    declarationId: string; sessionId: string; baseRevision: number; kind: 'START' | 'STOP' | 'PIECES';
    quantity: number; reasonCode: string; note: string; actor: string; now?: string;
}) {
    return enqueue('declare', () => {
        initializeMesSqliteStore();
        return runMesSqliteTransaction((database) => {
            const existing = database.exec(`SELECT session_id, kind, quantity FROM mes_manual_declarations WHERE declaration_id = ?`, [input.declarationId])?.[0]?.values?.[0];
            if (existing) {
                if (existing[0] !== input.sessionId || existing[1] !== input.kind || Number(existing[2]) !== input.quantity) throw new HttpError(409, 'Identificativo dichiarazione già utilizzato.');
                return { declarationId: input.declarationId, duplicate: true };
            }
            const result = database.exec("SELECT * FROM mes_machine_sessions WHERE session_id = ?", [input.sessionId]);
            const raw = result?.[0]?.values?.[0];
            const session: any = raw ? Object.fromEntries(result[0].columns.map((column: string, i: number) => [column, raw[i]])) : null;
            if (!session || session.status !== 'ACTIVE') throw new HttpError(409, 'Serve un ordine attivo sulla macchina.');
            if (session.collection_mode !== 'MANUAL') throw new HttpError(409, 'Questa attivazione usa la rilevazione PLC. Le rettifiche si inseriscono dal contapezzi.');
            if (Number(session.revision) !== input.baseRevision) throw new HttpError(409, 'La sessione è cambiata: aggiorna e riprova.');
            if (!input.actor.trim()) throw new HttpError(400, 'Seleziona un operatore.');
            if (input.kind === 'PIECES' && (!Number.isSafeInteger(input.quantity) || input.quantity <= 0)) throw new HttpError(400, 'Indica una quantità intera positiva.');
            if (input.kind !== 'PIECES' && session.mode === 'SETUP') throw new HttpError(409, "Termina l'attrezzaggio prima di dichiarare avvio o fermo.");
            if (input.kind === 'START' && session.manual_state === 'PRODUCTION') throw new HttpError(409, 'La macchina è già dichiarata in produzione.');
            if (input.kind === 'STOP' && session.manual_state !== 'PRODUCTION') throw new HttpError(409, 'La macchina risulta già ferma.');
            const now = input.now || new Date().toISOString();
            database.run(`INSERT INTO mes_manual_declarations (declaration_id,session_id,machine_id,kind,quantity,occurred_at,actor,reason_code,note)
                VALUES (?,?,?,?,?,?,?,?,?)`, [input.declarationId,input.sessionId,session.machine_id,input.kind,input.quantity,now,input.actor,input.reasonCode,input.note]);
            if (input.kind === 'PIECES') {
                storeMachineEvents([{ eventId:`manual:${input.declarationId}`, source:'MANUAL', sourceSessionId:input.sessionId,
                    sourcePosition:input.declarationId,machineId:session.machine_id,occurredAt:now,receivedAt:now,
                    pulseDelta:0,pieceDelta:input.quantity,multiplier:1,raw:{ declarationId:input.declarationId } }],
                    { importId:randomUUID(),source:'MANUAL',sourceSessionId:input.sessionId,sourceFile:'Dichiarazione manuale',
                        totalRows:1,validRows:1,insertedEvents:0,duplicateEvents:0,rejectedRows:0,issues:[],importedAt:now }, input.actor);
            } else database.run("UPDATE mes_machine_sessions SET manual_state = ? WHERE session_id = ?", [input.kind === 'START' ? 'PRODUCTION' : 'STOPPED', input.sessionId]);
            database.run("UPDATE mes_machine_sessions SET revision = revision + 1 WHERE session_id = ?", [input.sessionId]);
            rebuildOperatingTail(database,session.machine_id,session.started_at,now);
            database.run(`INSERT INTO mes_audit_log(audit_id,entity_type,entity_id,action,payload_json,occurred_at,actor,request_id)
                VALUES (?,?,?,'MANUAL_DECLARATION',?,?,?,?)`, [randomUUID(),'SESSION',input.sessionId,JSON.stringify(input),now,input.actor,input.declarationId]);
            return { declarationId:input.declarationId,duplicate:false };
        });
    });
}
