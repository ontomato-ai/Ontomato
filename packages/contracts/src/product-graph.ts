import {z} from 'zod';
import {productReferences,productTypes,type ProductAsset,type ProductDocument} from './product-assets';

/** Category is derived from kind; it is never a separately editable asset property. */
export const productCategories=[
  {id:'bundle',name:'交付单元',description:'面向人交付应用，面向智能体交付工具与上下文'},
  {id:'composition',name:'组合资产',description:'通过已有资产引用组织页面与导航'},
  {id:'element',name:'投影资产',description:'一对一绑定已发布本体元素，供人与智能体共同消费'},
] as const;
export type ProductCategory=typeof productCategories[number]['id'];
export function productCategory(kind:ProductDocument['kind']):ProductCategory|'legacy'{
  return productTypes.find(type=>type.kind===kind)?.category??'legacy';
}
export const productGraphSchema=z.object({
  nodes:z.array(z.object({id:z.string(),assetId:z.string().optional(),name:z.string(),kind:z.string(),category:z.enum(['element','composition','bundle','ontology','principal','legacy']),revision:z.number().int().positive().optional(),isTemplate:z.boolean().optional(),embeddable:z.boolean().optional()}).strict()),
  edges:z.array(z.object({source:z.string(),target:z.string(),relation:z.enum(['renders','contains','navigates','tools','context','embodies','identity','depends-on','use','edit']),storage:z.enum(['ontology','product-index','governance'])}).strict()),
}).strict().superRefine((graph,context)=>{
  const ids=new Set(graph.nodes.map(node=>node.id));
  if(ids.size!==graph.nodes.length)context.addIssue({code:'custom',message:'Duplicate graph node identity'});
  const edges=new Set<string>();
  for(const edge of graph.edges){
    if(!ids.has(edge.source)||!ids.has(edge.target))context.addIssue({code:'custom',message:'Graph edge endpoint is unavailable'});
    const key=JSON.stringify([edge.source,edge.target,edge.relation]);
    if(edges.has(key))context.addIssue({code:'custom',message:'Duplicate graph relationship'});
    edges.add(key);
  }
});
export type ProductGraph=z.infer<typeof productGraphSchema>;
export const defaultProjectionWarningsSchema=z.object({warnings:z.array(z.object({kind:z.enum(['ObjectType','Definition','MetricView','Action']),id:z.string().min(1),name:z.string(),severity:z.literal('warning'),code:z.literal('DEFAULT_PROJECTION_MISSING')}).strict())}).strict();

/** Derive reference edges from the same visible documents used by admission and publication. */
export function productGraph(assets:ProductAsset[]):ProductGraph{
  const nodes=new Map<string,ProductGraph['nodes'][number]>();
  const edges=new Map<string,ProductGraph['edges'][number]>();
  const assetKey=(id:string)=>`asset:${id}`;
  for(const asset of assets)nodes.set(assetKey(asset.id),{id:assetKey(asset.id),assetId:asset.id,name:asset.name,kind:asset.document.kind,category:productCategory(asset.document.kind),revision:asset.revision,...(asset.document.kind==='page'?{isTemplate:asset.document.isTemplate??false,embeddable:asset.document.embeddable??false}:{})});
  const add=(source:string,target:string,relation:ProductGraph['edges'][number]['relation'],storage:ProductGraph['edges'][number]['storage'])=>edges.set(JSON.stringify([source,target,relation]),{source,target,relation,storage});
  for(const asset of assets){
    const source=assetKey(asset.id),document=asset.document;
    for(const reference of productReferences(document)){
      if(reference.kind==='asset'){
        const target=assetKey(reference.id);
        if(!nodes.has(target))continue;
        const relation=document.kind==='navigation'||document.kind==='application'&&document.navigationId===reference.id?'navigates':document.kind==='agent-profile'?(document.tools.includes(reference.id)?'tools':'context'):'contains';
        add(source,target,relation,'product-index');
        if(document.kind==='agent-profile'&&document.tools.includes(reference.id)&&document.contextViews.includes(reference.id))add(source,target,'context','product-index');
      }else{
        const target=`${reference.kind}:${reference.id}`;
        if(!nodes.has(target))nodes.set(target,{id:target,name:reference.id,kind:reference.kind,category:'ontology'});
        const renders='renders' in document&&document.renders.id===reference.id&&({MetricView:'metric',Action:'action',Definition:'definition',ObjectType:'object-type'} as const)[document.renders.kind]===reference.kind;
        add(source,target,renders?'renders':document.kind==='application'&&reference.kind==='application'?'identity':'depends-on','product-index');
      }
    }
    if(document.kind==='agent-profile'){
      const target=`agent:${document.agentId}`;
      nodes.set(target,{id:target,name:document.agentId,kind:'AgentDefinition',category:'ontology'});
      add(source,target,'embodies','product-index');
    }
  }
  return {nodes:[...nodes.values()],edges:[...edges.values()]};
}
