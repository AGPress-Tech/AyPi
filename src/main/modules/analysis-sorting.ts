export type SortCriterion={key:string;direction:'asc'|'desc'};
export type SortValue=string|number|boolean|null|undefined;
export function changeSorting(current:readonly SortCriterion[],key:string,remove=false):SortCriterion[]{
    const index=current.findIndex(item=>item.key===key);
    if(remove)return current.filter(item=>item.key!==key);
    if(index<0)return [...current,{key,direction:'asc'}];
    return current.map((item,i)=>i===index?{...item,direction:item.direction==='asc'?'desc':'asc'}:item);
}
const collator=new Intl.Collator('it',{numeric:true,sensitivity:'base'});
export function compareSortedValues(a:SortValue,b:SortValue,direction:'asc'|'desc'){
    const missing=(value:SortValue)=>value==null||typeof value==='number'&&!Number.isFinite(value);
    if(missing(a)||missing(b))return missing(a)?(missing(b)?0:1):-1;
    const comparison=typeof a==='number'&&typeof b==='number'?a-b:typeof a==='boolean'&&typeof b==='boolean'?Number(a)-Number(b):collator.compare(String(a),String(b));
    return direction==='asc'?comparison:-comparison;
}
export function sortByCriteria<T>(items:readonly T[],sort:readonly SortCriterion[],value:(item:T,key:string)=>SortValue):T[]{
    if(!sort.length)return [...items];
    return items.map((item,index)=>({item,index})).sort((a,b)=>{
        for(const criterion of sort){const comparison=compareSortedValues(value(a.item,criterion.key),value(b.item,criterion.key),criterion.direction);if(comparison)return comparison;}
        return a.index-b.index;
    }).map(entry=>entry.item);
}
export function sortHierarchy<T>(rows:readonly T[],sort:readonly SortCriterion[],options:{value:(row:T,key:string)=>SortValue;depth:(row:T)=>number;pinned:(row:T)=>boolean}):T[]{
    type Node={row:T;children:Node[]};
    const roots:Node[]=[],stack:Node[]=[];
    for(const row of rows){const depth=options.depth(row);while(stack.length&&options.depth(stack[stack.length-1].row)>=depth)stack.pop();const node={row,children:[]};(stack.length?stack[stack.length-1].children:roots).push(node);stack.push(node);}
    function flatten(nodes:Node[]):T[]{
        const output:T[]=[],batch:Node[]=[];
        const flush=()=>{for(const node of sortByCriteria(batch,sort,(n,key)=>options.value(n.row,key))){output.push(node.row,...flatten(node.children));}batch.length=0;};
        for(const node of nodes){if(options.pinned(node.row)){flush();output.push(node.row,...flatten(node.children));}else batch.push(node);}flush();return output;
    }
    return flatten(roots);
}
