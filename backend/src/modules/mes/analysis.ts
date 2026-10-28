import { getMesSqliteDatabase } from '../../shared/db/mes-sqlite';
import { initializeMesSqliteStore, loadAcquisitionStatus } from './repository';
import { loadProductionPlannerSnapshot } from '../production-planner/repository';

function rows(sql: string, params: any[] = []): any[] {
    const result=getMesSqliteDatabase().exec(sql,params);
    return (result?.[0]?.values || []).map((r: any[])=>Object.fromEntries(result[0].columns.map((c: string,i: number)=>[c,r[i]])));
}
export type AnalysisFilter={ from:string;to:string;machineIds?:string[];department?:string;article?:string;order?:string;operator?:string; };
const seconds=(from:number,to:number)=>Math.max(0,(to-from)/1000);
const empty=()=>({countedPieces:0,scrapPieces:0,manualPieces:0,plcPieces:0,adjustmentPieces:0,
    productionSeconds:0,setupSeconds:0,stoppedSeconds:0,unmonitoredSeconds:0,operatorSeconds:0});
const norm=(value:unknown)=>String(value||'').trim().toUpperCase();

export function mesAnalysis(filter:AnalysisFilter) {
    initializeMesSqliteStore();
    loadAcquisitionStatus();
    const from=Date.parse(filter.from),to=Math.min(Date.parse(filter.to),Date.now());
    const start=new Date(from).toISOString(),end=new Date(Math.max(from,to)).toISOString();
    const planner:any=loadProductionPlannerSnapshot().state || {machines:[],jobs:[],unavailabilities:[]};
    const machines=new Map<string,any>((planner.machines||[]).map((m:any)=>[norm(m.id),{machineId:norm(m.id),name:m.name,department:m.department||'',category:m.category||''}]));
    const sessions=rows(`SELECT s.*,p.order_id,p.phase_code,p.article_code,p.target_quantity,p.execution_status,
        p.planning_status,p.planned_machine_id,p.scheduled_start,p.scheduled_end,
        COALESCE(s.standard_cycle_snapshot,p.standard_cycle_seconds) AS standard_cycle_seconds,
        o.order_number,o.customer,o.order_type,o.first_delivery_at,o.due_at,o.priority,p.archived_at
        FROM mes_machine_sessions s JOIN mes_phases p ON p.phase_id=s.phase_id JOIN mes_orders o ON o.order_id=p.order_id`);
    for(const s of sessions) if(!machines.has(norm(s.machine_id))) machines.set(norm(s.machine_id),{machineId:norm(s.machine_id),name:s.machine_id,department:'',category:''});
    const operators=rows('SELECT * FROM mes_session_operator_intervals WHERE started_at < ? AND (ended_at = ? OR ended_at > ?)',[end,'',start]);
    const matching=sessions.filter(s=>{
        const machine=machines.get(norm(s.machine_id));
        return (!filter.machineIds?.length||filter.machineIds.map(norm).includes(norm(s.machine_id)))
            &&(!filter.department||machine?.department===filter.department)
            &&(!filter.article||norm(s.article_code).includes(norm(filter.article)))
            &&(!filter.order||norm(s.order_number).includes(norm(filter.order)))
            &&(!filter.operator||operators.some(o=>o.session_id===s.session_id&&o.operator_name===filter.operator));
    });
    const byId=new Map(matching.map(s=>[s.session_id,s]));
    const totals=new Map<string,any>();
    const facts=(id:string)=>{if(!totals.has(id))totals.set(id,empty());return totals.get(id);};
    const production=rows(`SELECT a.session_id,e.source,SUM(a.piece_quantity) AS pieces FROM mes_event_allocations a
        JOIN mes_machine_events e ON e.event_id=a.event_id
        WHERE a.allocation_kind IN ('PRODUCTION','SETUP_GOOD') AND e.occurred_at >= ? AND e.occurred_at < ?
        GROUP BY a.session_id,e.source
        UNION ALL
        SELECT a.session_id,'OPENING_CREDIT',SUM(a.piece_quantity) FROM mes_event_allocations a
        WHERE a.allocation_kind='OPENING_CREDIT' AND a.created_at >= ? AND a.created_at < ? GROUP BY a.session_id`,[start,end,start,end]);
    for(const p of production) if(byId.has(p.session_id)) {
        const f=facts(p.session_id),quantity=Number(p.pieces)||0; f.countedPieces+=quantity;
        if(p.source==='MANUAL')f.manualPieces+=quantity;else if(p.source!=='OPENING_CREDIT')f.plcPieces+=quantity;
        else f.adjustmentPieces+=quantity;
    }
    const adjustments=rows(`SELECT session_id,kind,SUM(quantity) AS quantity FROM mes_production_adjustments
        WHERE created_at >= ? AND created_at < ? GROUP BY session_id,kind`,[start,end]);
    for(const a of adjustments) if(byId.has(a.session_id)) {
        const f=facts(a.session_id),q=Number(a.quantity)||0;
        if(['GOOD_PIECES_ADD','GOOD_PIECES_REMOVE','SETUP_RECONCILIATION'].includes(a.kind)) {
            const quantity=a.kind==='GOOD_PIECES_REMOVE'?-q:q;f.countedPieces+=quantity;f.adjustmentPieces+=quantity;
            if(a.kind==='SETUP_RECONCILIATION'&&byId.get(a.session_id).collection_mode==='MANUAL')f.manualPieces+=quantity;
        } else if(a.kind==='SCRAP_PIECES_ADD')f.scrapPieces+=q;else if(a.kind==='SCRAP_PIECES_REMOVE')f.scrapPieces-=q;
    }
    // Late setup reconciliations keep their own declaration date in the audit log.
    const late=rows("SELECT entity_id,payload_json,occurred_at FROM mes_audit_log WHERE action='RECONCILE_LATE_SETUP'");
    const lateScrap=new Map<string,number>();
    for(const a of late) {
        const q=Number(JSON.parse(a.payload_json).scrapPieces)||0;
        lateScrap.set(a.entity_id,(lateScrap.get(a.entity_id)||0)+q);
        if(byId.has(a.entity_id)&&a.occurred_at>=start&&a.occurred_at<end)facts(a.entity_id).scrapPieces+=q;
    }
    for(const r of rows('SELECT session_id,scrap_pieces,reconciled_at FROM mes_setup_reconciliations WHERE reconciled_at >= ? AND reconciled_at < ?',[start,end])) {
        if(byId.has(r.session_id))facts(r.session_id).scrapPieces+=Number(r.scrap_pieces)-(lateScrap.get(r.session_id)||0);
    }
    const intervals=rows(`SELECT * FROM mes_machine_operating_intervals WHERE started_at < ? AND (ended_at='' OR ended_at > ?) ORDER BY machine_id,started_at`,[end,start]);
    const history:any[]=[];
    for(const i of intervals) {
        if(!byId.has(i.session_id))continue;
        const left=Math.max(from,Date.parse(i.started_at)),right=Math.min(to,i.ended_at?Date.parse(i.ended_at):to);
        if(right<=left)continue;
        const f=facts(i.session_id),duration=seconds(left,right);
        if(i.state==='PRODUCTION')f.productionSeconds+=duration;
        else if(i.state==='SETUP')f.setupSeconds+=duration;
        else if(i.state==='STOPPED'||i.state==='IDLE')f.stoppedSeconds+=duration;
        else f.unmonitoredSeconds+=duration;
        if(history.length<5000)history.push({machineId:norm(i.machine_id),sessionId:i.session_id,state:i.state,
            from:new Date(left).toISOString(),to:new Date(right).toISOString(),seconds:duration,
            source:i.source_session_id==='MANUAL'?'MANUAL':'PLC',orderNumber:byId.get(i.session_id).order_number});
    }
    for(const o of operators) if(byId.has(o.session_id))facts(o.session_id).operatorSeconds+=seconds(
        Math.max(from,Date.parse(o.started_at)),Math.min(to,o.ended_at?Date.parse(o.ended_at):to));
    const activationRows=new Map<string,any>();
    for(const s of matching) {
        const f=totals.get(s.session_id);
        const overlap=Date.parse(s.started_at)<to&&(!s.ended_at||Date.parse(s.ended_at)>from);
        if(!f&&!overlap)continue;
        const id=s.activation_id||s.session_id,machine=machines.get(norm(s.machine_id));
        if(!activationRows.has(id))activationRows.set(id,{id,phaseId:s.phase_id,orderId:s.order_id,
            machineId:machine.machineId,machine:machine.name,department:machine.department,
            orderNumber:s.order_number,article:s.article_code,phase:s.phase_code,customer:s.customer,
            source:s.collection_mode==='MANUAL'?'MANUAL':'PLC',from:s.started_at,to:s.ended_at,status:s.status,
            standardCycleSeconds:Number(s.standard_cycle_seconds)||0,targetQuantity:Number(s.target_quantity)||0,
            operators:[],expectedSeconds:0,...empty()});
        const row=activationRows.get(id);
        row.expectedSeconds+=seconds(Math.max(from,Date.parse(s.started_at)),Math.min(to,s.ended_at?Date.parse(s.ended_at):to));
        if(s.started_at<row.from)row.from=s.started_at;
        if(!s.ended_at){row.to='';row.status=s.status;}else if(row.to&&s.ended_at>row.to)row.to=s.ended_at;
        if(f)for(const field of Object.keys(empty()))row[field]+=f[field]||0;
        row.operators=[...new Set([...row.operators,...operators.filter(o=>o.session_id===s.session_id).map(o=>o.operator_name)])];
    }
    const activations=[...activationRows.values()].map(row=>({...row,
        unmonitoredSeconds:Math.max(row.unmonitoredSeconds,row.expectedSeconds-row.productionSeconds-row.setupSeconds-row.stoppedSeconds),
        observedSeconds:row.productionSeconds+row.setupSeconds+row.stoppedSeconds,
        coveragePercent:row.expectedSeconds>0?(row.productionSeconds+row.setupSeconds+row.stoppedSeconds)/row.expectedSeconds*100:null,
        actualCycleSeconds:row.countedPieces>0&&row.productionSeconds>0?row.productionSeconds/row.countedPieces:null}));
    const summary=empty();for(const row of activations)for(const field of Object.keys(summary))summary[field]+=row[field]||0;
    const cumulative=new Map<string,number>();
    for(const row of rows(`SELECT s.phase_id,SUM(a.piece_quantity) AS pieces FROM mes_event_allocations a
        JOIN mes_machine_sessions s ON s.session_id=a.session_id
        WHERE a.allocation_kind IN ('PRODUCTION','OPENING_CREDIT','SETUP_GOOD') GROUP BY s.phase_id
        UNION ALL SELECT phase_id,SUM(CASE WHEN kind='GOOD_PIECES_REMOVE' THEN -quantity ELSE quantity END)
        FROM mes_production_adjustments WHERE kind IN ('GOOD_PIECES_ADD','GOOD_PIECES_REMOVE','SETUP_RECONCILIATION') GROUP BY phase_id`)) {
        cumulative.set(row.phase_id,(cumulative.get(row.phase_id)||0)+Number(row.pieces||0));
    }
    const group=(key:string)=>{
        const groups=new Map<string,any>();
        for(const row of activations){const id=key==='machine'?row.machineId:key==='order'?row.phaseId:row.article;
            if(!groups.has(id))groups.set(id,{id,label:key==='machine'?row.machine:key==='order'?`${row.orderNumber} · ${row.phase}`:row.article,
                targetQuantity:key==='order'?row.targetQuantity:undefined,
                totalOrderPieces:key==='order'?Math.max(0,cumulative.get(row.phaseId)||0):undefined,
                remainingPieces:key==='order'?Math.max(0,row.targetQuantity-(cumulative.get(row.phaseId)||0)):undefined,
                ...empty(),activations:0});
            const g=groups.get(id);g.activations++;for(const field of Object.keys(empty()))g[field]+=row[field]||0;
        }return [...groups.values()];
    };
    return {from:start,to:end,generatedAt:new Date().toISOString(),summary,activations,
        byMachine:group('machine'),byOrder:group('order'),byArticle:group('article'),intervals:history,
        historyTruncated:intervals.filter(i=>byId.has(i.session_id)).length>5000,
        declarations:rows('SELECT * FROM mes_manual_declarations WHERE occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at DESC',[start,end])
            .filter(d=>byId.has(d.session_id)).map(d=>({id:d.declaration_id,machineId:d.machine_id,orderNumber:byId.get(d.session_id).order_number,
                kind:d.kind,quantity:Number(d.quantity),from:d.occurred_at,actor:d.actor,reason:d.reason_code,note:d.note})),
        machines:[...machines.values()],operators:[...new Set(operators.map(o=>o.operator_name))].sort(),
        basis:'Dati MES registrati. Tempi PLC e dichiarazioni manuali sono distinti. Le assenze di acquisizione non sono fermi.'};
}
