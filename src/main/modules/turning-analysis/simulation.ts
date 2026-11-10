import {TurningRecord} from './model';
export type SimulationScenario={mode:'manual'|'targetPrice'|'targetCycle';cycleSource:'real'|'sheet';includeSetup:boolean;quantity?:number;price?:number;cycle?:number;setup?:number;target?:number};
export type SimulationResult={id:number;ok:boolean;message:string;quantity:number|null;price:number|null;cycle:number|null;setup:number|null;production:number|null;hours:number|null;denominator:number|null;revenue:number|null;rate:number|null;target:number|null;requiredPrice:number|null;requiredCycle:number|null;realRate:number|null;deltaRate:number|null;deltaPercent:number|null;deltaPrice:number|null;deltaCycle:number|null;gapTarget:number|null};
export const defaultSimulation=():SimulationScenario=>({mode:'manual',cycleSource:'real',includeSetup:true});
export type ProductionHypothesis={driver:'rate'|'cycle'|'price';value?:number;cycleSource:'real'|'sheet';includeSetup:boolean;quantity?:number;setup?:number};
export const defaultHypothesis=():ProductionHypothesis=>({driver:'rate',cycleSource:'real',includeSetup:true});
export function validateHypothesis(input:ProductionHypothesis):ProductionHypothesis{
    if(!input||!['rate','cycle','price'].includes(input.driver)||Object.keys(input).some(k=>!['driver','value','cycleSource','includeSetup','quantity','setup'].includes(k)))throw Error('Scegli il parametro da modificare.');
    validateSimulation({mode:'manual',cycleSource:input.cycleSource,includeSetup:input.includeSetup,quantity:input.quantity,setup:input.setup,...input.value===undefined?{}:{[input.driver==='rate'?'target':input.driver]:input.value}});
    return {...input};
}
/** Two mutually exclusive alternatives for the same historical production. */
export function simulateAlternatives(records:readonly TurningRecord[],input:ProductionHypothesis){
    const s=validateHypothesis(input);
    return records.flatMap(record=>{
        const base={cycleSource:s.cycleSource,includeSetup:s.includeSetup,quantity:s.quantity,setup:s.setup};
        const denominator=s.includeSetup?record.hours:record.production;
        const realRate=denominator!==null&&denominator>0&&record.revenue!==null?record.revenue/denominator:null;
        const target=s.driver==='rate'?(s.value??realRate):realRate;
        const common={...base,target:target??undefined};
        const specs:(SimulationScenario&{label:string})[]=s.driver==='rate'?
            [{...common,mode:'targetCycle' as const,label:'A · Cambia tempo, conserva prezzo'},{...common,mode:'targetPrice' as const,label:'B · Cambia prezzo, conserva tempo'}]:s.driver==='cycle'?
            [{...base,mode:'manual' as const,cycle:s.value,label:'A · Nuovo tempo, conserva prezzo'},{...common,mode:'targetPrice' as const,cycle:s.value,label:'B · Nuovo tempo e prezzo, conserva resa'}]:
            [{...base,mode:'manual' as const,price:s.value,label:'A · Nuovo prezzo, conserva tempo'},{...common,mode:'targetCycle' as const,price:s.value,label:'B · Nuovo prezzo e tempo, conserva resa'}];
        return specs.map(({label,...scenario},index)=>{
            // A missing real reference must never silently become the optimal rate.
            const result=simulateRecord({...record,ideal:target},scenario);
            return {...result,variant:index===0?'A':'B',variantLabel:label};
        });
    });
}
export function validateSimulation(input:unknown):SimulationScenario{
    const s=input as any;if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['mode','cycleSource','includeSetup','quantity','price','cycle','setup','target'].includes(k))||!['manual','targetPrice','targetCycle'].includes(s.mode)||!['real','sheet'].includes(s.cycleSource)||typeof s.includeSetup!=='boolean')throw Error('Scenario di simulazione non valido.');
    const result:SimulationScenario={mode:s.mode,cycleSource:s.cycleSource,includeSetup:s.includeSetup};
    for(const key of ['quantity','price','cycle','setup','target'] as const)if(s[key]!==undefined){if(typeof s[key]!=='number'||!Number.isFinite(s[key])||s[key]>1e12||(['price','setup'].includes(key)?s[key]<0:s[key]<=0))throw Error('I valori devono essere numerici e positivi; prezzo e attrezzaggio possono essere zero.');result[key]=s[key];}
    return result;
}
export function simulateRecord(record:TurningRecord,scenario:SimulationScenario):SimulationResult{
    const s=validateSimulation(scenario),q=s.quantity??record.quantity,setup=s.setup??record.setup,target=s.target??record.ideal;
    let price=s.price??record.unitPrice,cycle=s.cycle??(s.cycleSource==='sheet'?record.sheetCycle:record.cycle);
    const realHours=s.includeSetup?record.hours:record.production,realRate=realHours!==null&&realHours>0&&record.revenue!==null?record.revenue/realHours:null;
    const result:SimulationResult={id:record.id,ok:false,message:'',quantity:q,price:s.mode==='targetPrice'?null:price,cycle:s.mode==='targetCycle'?null:cycle,setup,production:null,hours:null,denominator:null,revenue:null,rate:null,target,requiredPrice:null,requiredCycle:null,realRate,deltaRate:null,deltaPercent:null,deltaPrice:null,deltaCycle:null,gapTarget:null};
    const fail=(message:string)=>({...result,message});
    if(q===null||!Number.isFinite(q)||q<=0)return fail('Lotto nullo, negativo o mancante: imposta un lotto simulato positivo.');
    if(setup===null||!Number.isFinite(setup)||setup<0)return fail('Ore di attrezzaggio mancanti o negative: imposta un valore valido.');
    const fixed=s.includeSetup?setup:0;
    const usableTarget=target!==null&&Number.isFinite(target)&&target>0;
    if(s.mode!=='manual'&&!usableTarget)return fail('Resa ottimale assente: imposta un obiettivo €/h.');
    if(s.mode==='targetCycle'){
        if(price===null||!Number.isFinite(price)||price<0)return fail('Prezzo mancante o negativo: imposta un prezzo valido.');
        const allowed=q*price/target!-fixed;
        if(!Number.isFinite(allowed)||allowed<=0)return fail('Obiettivo non raggiungibile a velocità finita: prezzo e lotto non coprono il tempo fisso di attrezzaggio.');
        cycle=allowed*3600/q;result.cycle=cycle;
    }
    if(cycle===null||!Number.isFinite(cycle)||cycle<0)return fail(s.cycleSource==='sheet'?'Tempo scheda assente o non valido: imposta secondi/pezzo simulati.':'Tempo ciclo reale assente o non valido: imposta secondi/pezzo simulati.');
    const production=q*cycle/3600,hours=setup+production,denominator=fixed+production;
    if(!Number.isFinite(hours)||denominator<=0)return fail('Ore compatibili con la resa nulle o fuori scala.');
    if(s.mode==='targetPrice'){price=target!*denominator/q;result.price=price;}
    if(price===null||!Number.isFinite(price)||price<0)return fail('Prezzo mancante o negativo: imposta un prezzo simulato valido.');
    const revenue=q*price,rate=revenue/denominator;
    if(!Number.isFinite(revenue)||!Number.isFinite(rate))return fail('Valori fuori scala: riduci le ipotesi della simulazione.');
    const requiredPrice=usableTarget?target!*denominator/q:null,allowed=usableTarget?revenue/target!-fixed:null,requiredCycle=allowed!==null&&allowed>0?allowed*3600/q:null;
    return {...result,ok:true,message:usableTarget?'Calcolo riuscito':'Calcolo riuscito · riferimento ottimale assente',price,cycle,production,hours,denominator,revenue,rate,requiredPrice,requiredCycle,
        deltaRate:realRate===null?null:rate-realRate,deltaPercent:realRate===null||Math.abs(realRate)<1e-9?null:(rate-realRate)/Math.abs(realRate),deltaPrice:record.unitPrice===null?null:price-record.unitPrice,deltaCycle:record.cycle===null?null:cycle-record.cycle,gapTarget:usableTarget?rate-target!:null};
}
export function simulateRecords(records:readonly TurningRecord[],scenario:SimulationScenario){validateSimulation(scenario);return records.map(record=>simulateRecord(record,scenario));}
export function simulationSummary(records:readonly TurningRecord[],results:readonly SimulationResult[],scenario:SimulationScenario){
    const valid=results.filter(r=>r.ok),ids=new Set(valid.map(r=>r.id)),original=records.filter(r=>ids.has(r.id)),denominator=valid.reduce((s,r)=>s+r.denominator!,0),revenue=valid.reduce((s,r)=>s+r.revenue!,0),originalDenominator=original.reduce((s,r)=>s+((scenario.includeSetup?r.hours:r.production)??0),0),originalRevenue=original.reduce((s,r)=>s+(r.revenue??0),0);
    const incomplete=original.some(r=>r.revenue===null||(scenario.includeSetup?r.hours:r.production)===null),realRate=originalDenominator>0&&!incomplete?originalRevenue/originalDenominator:null,rate=denominator>0?revenue/denominator:null;
    return {count:results.length,valid:valid.length,failed:results.length-valid.length,quantity:valid.reduce((s,r)=>s+r.quantity!,0),setup:valid.reduce((s,r)=>s+r.setup!,0),production:valid.reduce((s,r)=>s+r.production!,0),hours:valid.reduce((s,r)=>s+r.hours!,0),denominator,revenue,realRate,rate,delta:realRate!==null&&rate!==null?rate-realRate:null,deltaPercent:realRate!==null&&rate!==null&&Math.abs(realRate)>1e-9?(rate-realRate)/Math.abs(realRate):null};
}
