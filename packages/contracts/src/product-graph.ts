import {z} from 'zod';

export const productGraphSchema=z.object({
  nodes:z.array(z.object({id:z.string(),assetId:z.string().optional(),name:z.string(),kind:z.string(),category:z.enum(['element','composition','bundle','ontology','principal']),revision:z.number().int().positive().optional(),isTemplate:z.boolean().optional(),embeddable:z.boolean().optional()}).strict()),
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
