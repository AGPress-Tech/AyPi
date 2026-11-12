export type BomRequest={article?:string;bom?:string};
export function validateBomRequest(value:unknown):BomRequest{
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Ricerca distinta non valida.');
    const clean:BomRequest={};
    for(const [key,v] of Object.entries(value)){
        if(!['article','bom'].includes(key)||typeof v!=='string'||!v.trim()||v.length>128)throw Error('Codice distinta/articolo non valido.');
        clean[key]=v.trim();
    }
    return clean;
}
// Legge le distinte anagrafiche, non le tabelle temporanee delle simulazioni ERP.
export function bomAnalysisQuery(value:unknown){
    const input=validateBomRequest(value),bindings=Object.entries(input).map(([name,value])=>({name,value}));
    return {bindings,sql:`SELECT TOP (100001)
      b.BOM bom,b.Description bomDescription,b.UoM bomUnit,
      CASE WHEN b.Disabled='1' THEN 1 ELSE 0 END disabled,
      CASE WHEN b.InProduction='1' THEN 1 ELSE 0 END inProduction,
      CASE WHEN b.Configurable='1' THEN 1 ELSE 0 END configurable,
      CASE WHEN b.UsePercQty='1' THEN 1 ELSE 0 END percentageBasis,
      CASE WHEN b.SalesDocOnly='1' THEN 1 ELSE 0 END salesOnly,
      b.CreationDate created,b.LastModificationDate modified,b.Notes bomNotes,
      c.Line line,c.SubId subId,c.Component component,c.Description description,
      c.ComponentType componentType,c.UoM unit,c.Qty quantity,c.PercQty percentage,
      c.Variant variant,c.ScrapQty scrapQuantity,c.ScrapUM scrapUnit,c.Waste waste,
      c.WastePerc wastePercent,c.Notes notes,c.TechnicalData technicalData,
      CASE WHEN c.ValidityStartingDate>'18000101' THEN c.ValidityStartingDate END validFrom,
      CASE WHEN c.ValidityEndingDate>'18000101' THEN c.ValidityEndingDate END validTo,
      CASE WHEN c.FixedComponent='1' THEN 1 ELSE 0 END fixedComponent,
      CASE WHEN c.FixedQty='1' THEN 1 ELSE 0 END fixedQuantity,
      CASE WHEN c.ToExplode='1' THEN 1 ELSE 0 END toExplode,
      c.Drawing drawing,c.StructureCode structureCode,c.ItemType itemType,
      g.NetWeight netWeight,g.GrossWeight grossWeight,
      CASE WHEN child.BOM IS NOT NULL THEN 1 ELSE 0 END hasBom
      FROM MA_BillOfMaterials b
      LEFT JOIN MA_BillOfMaterialsComp c ON c.BOM=b.BOM
      LEFT JOIN MA_ItemsGoodsData g ON g.Item=c.Component
      LEFT JOIN MA_BillOfMaterials child ON child.BOM=c.Component
      ${bindings.length?'WHERE '+bindings.map(p=>p.name==='bom'?'b.BOM=@bom':'c.Component=@article').join(' AND '):''}
      ORDER BY b.BOM,c.Line`};
}
