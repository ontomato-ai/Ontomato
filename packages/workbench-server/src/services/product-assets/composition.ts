import {productReferences,productWidgets,type ProductAsset,type ProductAssetInput} from '@ontomato/contracts/product-assets';
import {HttpError} from '../../utils/errors';
import {pageParameterAcceptsPath,pageParameterCompatible} from '@ontomato/contracts/product-page-state';

export {normalizeComposition} from '../../utils/product-composition';

/** Composition validation follows the proposed root, never the persisted old root. */
export async function validateComposition(rootId:string,input:ProductAssetInput,read:(id:string)=>Promise<ProductAsset>){
  const visit=async(id:string,document:ProductAssetInput['document'],path:Set<string>,displayOnly:boolean):Promise<void>=>{
    if(path.has(id))throw new HttpError(400,'Product composition contains a cycle','PRODUCT_CYCLE');
    const next=new Set(path).add(id);
    const onlyDisplay=displayOnly||(document.kind==='page'&&document.embeddable===true);
    if(document.kind==='application'&&document.navigationId&&(await read(document.navigationId)).document.kind!=='navigation')throw new HttpError(400,'Application navigation must reference Navigation','INVALID_NAVIGATION');
    if(onlyDisplay&&productWidgets(document).some(widget=>widget.kind==='action'))throw new HttpError(400,'Embeddable pages cannot contain Actions','INVALID_EMBEDDABLE_PAGE');
    if(onlyDisplay&&document.kind==='object-projection'&&document.layout?.tabs.some(tab=>tab.sections.some(section=>section.widgets.some(widget=>widget.kind==='action'))))throw new HttpError(400,'Embeddable pages cannot contain Actions through ObjectViews','INVALID_EMBEDDABLE_PAGE');
    if(document.kind==='navigation'){
      if(!document.nodes.some(node=>node.id===document.entry)||new Set(document.nodes.map(node=>node.id)).size!==document.nodes.length||new Set(document.nodes.map(node=>node.path)).size!==document.nodes.length)throw new HttpError(400,'Invalid navigation graph','INVALID_NAVIGATION');
      for(const node of document.nodes)if((await read(node.pageId)).document.kind!=='page')throw new HttpError(400,'Navigation nodes must reference Pages','INVALID_NAVIGATION');
    }
    if(document.kind==='agent-profile'){
      for(const reference of document.tools){const target=await read(reference);if(!['action-view','collection-view','metric-widget'].includes(target.document.kind))throw new HttpError(400,'Profile tools must reference projections','INVALID_AGENT_PROFILE');}
      for(const reference of document.contextViews){const target=await read(reference);if(target.document.kind!=='object-projection'||!['text','3d'].includes(target.document.renderer)||!target.document.fields.length)throw new HttpError(400,'Profile context must reference text or 3D ObjectViews with explicit context fields','INVALID_AGENT_PROFILE');}
    }
    for(const reference of productReferences(document).filter(reference=>reference.kind==='asset')){
      const child=reference.id===rootId?{document:input.document}:await read(reference.id);
      if(document.kind==='page'&&child.document.kind==='navigation')throw new HttpError(400,'Navigation belongs to the Application root, not a Page placement','INVALID_PRODUCT_CHILD');
      if(document.kind==='application'&&!document.workspaceId&&reference.id!==document.navigationId&&child.document.kind!=='page')throw new HttpError(400,'Declarative Applications compose Page roots and Navigation; place projections in a Page','INVALID_PRODUCT_CHILD');
      if(document.kind==='page'&&child.document.kind==='agent-profile'){
        for(const toolId of child.document.tools){const tool=await read(toolId);if('parameters' in tool.document)for(const binding of Object.values(tool.document.parameters))if(binding.source==='variable'&&!pageParameterAcceptsPath(document.params??{},binding.path))throw new HttpError(400,`Declare a typed Page parameter for Profile tool binding: ${binding.path}`,'INVALID_PAGE_PARAMETER');}
      }
      if(document.kind==='page'&&['metric-widget','action-view','collection-view'].includes(child.document.kind)&&'parameters' in child.document){
        for(const binding of Object.values(child.document.parameters))if(binding.source==='variable'&&!pageParameterAcceptsPath(document.params??{},binding.path))throw new HttpError(400,`Declare a typed page parameter for: ${binding.path}`,'INVALID_PAGE_PARAMETER');
      }
      if(document.kind==='page'&&child.document.kind==='page')for(const [name,type] of Object.entries(child.document.params??{})){
        const provided=document.params?.[name];
        if(!provided||!pageParameterCompatible(provided,type))throw new HttpError(400,`Nested Page parameter has no compatible source: ${name}`,'INVALID_PAGE_PARAMETER');
      }
      if(child.document.kind==='application'||child.document.kind==='page'&&child.document.isTemplate)throw new HttpError(400,'Choose a runnable page instead of an application or template','INVALID_PRODUCT_CHILD');
      await visit(reference.id,child.document,next,onlyDisplay);
    }
  };
  await visit(rootId,input.document,new Set(),false);
}

/** Updating a shared leaf must preserve the invariants of every existing parent. */
export async function validateAffectedCompositions(id:string,candidate:ProductAssetInput,parents:ProductAsset[],read:(id:string)=>Promise<ProductAsset>){
  const affected=new Set([id]);
  let added=true;
  while(added){
    added=false;
    for(const parent of parents)if(!affected.has(parent.id)&&productReferences(parent.document).some(reference=>reference.kind==='asset'&&affected.has(reference.id))){affected.add(parent.id);added=true;}
  }
  const candidateRead=async(reference:string)=>reference===id?({...candidate,id} as ProductAsset):read(reference);
  for(const parent of parents)if(parent.id!==id&&affected.has(parent.id))await validateComposition(parent.id,parent,candidateRead);
}
