// The avatar stays in the user's library. No model or textures are redistributed.
export const NOZOMI_SOURCE = String.raw`D:\Other\L2DBA\3D\Tachibana Nozomi\VRM\Tachibana Nozomi.vrm`;
const expressions = new Set(['BrowInnerUp','BrowOuterUpLeft','BrowOuterUpRight','EyeBlinkLeft','EyeBlinkRight','EyeSquintLeft','EyeSquintRight','JawOpen','MouthSmileLeft','MouthSmileRight','EXP_Lovely_MouthClose','EXP_Laughing','EXP_Smug']);
/** Retain the needed morphs and compact the GLB in memory, without changing the source. */
export async function loadNozomiAsset() {
    const fs = require('fs/promises'), data:Buffer = await fs.readFile(NOZOMI_SOURCE);
    if(data.readUInt32LE(0)!==0x46546c67 || data.readUInt32LE(4)!==2) throw Error('Formato VRM non valido.');
    const jsonLength=data.readUInt32LE(12), json=JSON.parse(data.toString('utf8',20,20+jsonLength)), binaryStart=28+jsonLength;
    const vrm=json.extensions?.VRM;if(!vrm?.humanoid?.humanBones?.length)throw Error('Scheletro VRM non disponibile.');
    const groups=vrm.blendShapeMaster.blendShapeGroups.filter((g:any)=>expressions.has(g.name));
    for(let meshIndex=0;meshIndex<json.meshes.length;meshIndex++){
        const mesh=json.meshes[meshIndex], targets=[...new Set<number>(groups.flatMap((g:any)=>g.binds.filter((b:any)=>b.mesh===meshIndex).map((b:any)=>b.index)))].sort((a,b)=>a-b);
        if(!mesh.primitives[0].targets)continue;
        for(const primitive of mesh.primitives)primitive.targets=targets.map(i=>primitive.targets[i]);
        if(mesh.weights)mesh.weights=targets.map(i=>mesh.weights[i]||0);
        for(const g of groups)for(const b of g.binds)if(b.mesh===meshIndex)b.index=targets.indexOf(b.index);
    }
    vrm.blendShapeMaster.blendShapeGroups=groups;
    const used=new Set<number>();
    for(const mesh of json.meshes)for(const p of mesh.primitives){Object.values<number>(p.attributes).forEach(i=>used.add(i));if(p.indices!=null)used.add(p.indices);for(const t of p.targets||[])Object.values<number>(t).forEach(i=>used.add(i));}
    for(const skin of json.skins||[])if(skin.inverseBindMatrices!=null)used.add(skin.inverseBindMatrices);
    const accessorMap=new Map([...used].map((n,i)=>[n,i]));
    json.accessors=[...used].map(i=>json.accessors[i]);
    for(const mesh of json.meshes)for(const p of mesh.primitives){for(const k in p.attributes)p.attributes[k]=accessorMap.get(p.attributes[k]);if(p.indices!=null)p.indices=accessorMap.get(p.indices);for(const t of p.targets||[])for(const k in t)t[k]=accessorMap.get(t[k]);}
    for(const skin of json.skins||[])if(skin.inverseBindMatrices!=null)skin.inverseBindMatrices=accessorMap.get(skin.inverseBindMatrices);
    const views=new Set<number>();for(const a of json.accessors){if(a.bufferView!=null)views.add(a.bufferView);if(a.sparse){views.add(a.sparse.indices.bufferView);views.add(a.sparse.values.bufferView);}}
    for(const i of json.images||[])if(i.bufferView!=null)views.add(i.bufferView);
    const viewMap=new Map([...views].map((n,i)=>[n,i])),chunks:Buffer[]=[];let size=0;
    json.bufferViews=[...views].map(i=>{const v=json.bufferViews[i],chunk=data.subarray(binaryStart+(v.byteOffset||0),binaryStart+(v.byteOffset||0)+v.byteLength),offset=size;chunks.push(chunk);size+=chunk.length;const pad=(4-size%4)%4;if(pad){chunks.push(Buffer.alloc(pad));size+=pad;}return {...v,buffer:0,byteOffset:offset};});
    for(const a of json.accessors){if(a.bufferView!=null)a.bufferView=viewMap.get(a.bufferView);if(a.sparse){a.sparse.indices.bufferView=viewMap.get(a.sparse.indices.bufferView);a.sparse.values.bufferView=viewMap.get(a.sparse.values.bufferView);}}
    for(const i of json.images||[])if(i.bufferView!=null)i.bufferView=viewMap.get(i.bufferView);
    json.buffers=[{byteLength:size}];let text=Buffer.from(JSON.stringify(json));if(text.length%4)text=Buffer.concat([text,Buffer.alloc(4-text.length%4,32)]);
    const output=Buffer.alloc(28+text.length+size);output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);output.writeUInt32LE(text.length,12);output.writeUInt32LE(0x4e4f534a,16);text.copy(output,20);output.writeUInt32LE(size,20+text.length);output.writeUInt32LE(0x004e4942,24+text.length);Buffer.concat(chunks,size).copy(output,28+text.length);
    return {buffer:output.buffer.slice(output.byteOffset,output.byteOffset+output.byteLength) as ArrayBuffer,vrm};
}
