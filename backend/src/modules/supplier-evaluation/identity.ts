/** Analysis identity only: ERP codes, legal entities and stored evaluations remain intact. */
export function supplierNameKey(name:unknown){
    return typeof name==='string'?name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('it'):'';
}
export function buildSupplierIdentities(suppliers:any[]){
    const names=new Map<string,any[]>();
    for(const supplier of suppliers){const key=supplierNameKey(supplier.name)||'unnamed:'+supplier.id;names.set(key,[...(names.get(key)||[]),supplier]);}
    const byId=new Map<string,any>();
    const groups=[...names.values()].map(members=>{
        const ordered=[...members].sort((a,b)=>Number(a.legacy)-Number(b.legacy)||String(a.code||a.id).localeCompare(String(b.code||b.id),'it',{numeric:true}));
        const representative=ordered[0],unique=(key:string)=>[...new Set<string>(ordered.map(s=>String(s[key]||'')).filter(Boolean))];
        const criticalities=unique('criticality'),codes=unique('code');
        const group={...representative,memberIds:ordered.map(s=>s.id),codes,code:codes.join(' / '),criticalities,criticality:criticalities.length===1?criticalities[0]:'',notes:unique('notes').join(' · '),taxId:unique('taxId').join(' / '),fiscalCode:unique('fiscalCode').join(' / '),hasLegacy:ordered.some(s=>s.legacy),hasLinked:ordered.some(s=>!s.legacy),legacy:ordered.every(s=>s.legacy),disabled:ordered.every(s=>s.disabled)};
        for(const member of ordered)byId.set(member.id,group);
        return group;
    });
    return {groups,byId};
}
