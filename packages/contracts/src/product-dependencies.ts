import {productReferences,type ProductAsset,type ProductReference} from './product-assets';

/** Traverse only the caller-visible product snapshot; hidden parent names never enter the result. */
export function productDependencies(root:ProductAsset,assets:ProductAsset[]){
  const byId=new Map(assets.map(asset=>[asset.id,asset]));
  const walk=(asset:ProductAsset,seen=new Set<string>()):ProductReference[]=>{
    if(seen.has(asset.id))return [];
    seen.add(asset.id);
    return productReferences(asset.document).flatMap(reference=>{
      const child=reference.kind==='asset'?byId.get(reference.id):undefined;
      return child?[reference,...walk(child,seen)]:[reference];
    });
  };
  const references=[...new Map(walk(root).map(reference=>[`${reference.kind}:${reference.id}`,reference])).values()];
  const usedBy=assets.filter(asset=>asset.id!==root.id&&walk(asset).some(reference=>reference.kind==='asset'&&reference.id===root.id)).map(asset=>({id:asset.id,name:asset.name}));
  return {references,usedBy};
}
