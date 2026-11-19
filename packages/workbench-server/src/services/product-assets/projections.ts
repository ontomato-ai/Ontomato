import {getProduct} from './store';
import type {ProductOwner} from '../product-governance/grants';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {HttpError} from '../../utils/errors';
import {withProductGrants} from './grants';
import {backendGet,backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {platformObjectTypes} from './platform-objects';
import {defaultProjectionWarningsSchema} from '@ontomato/contracts/product-graph';
import {readProductOntology} from './ontology';

/** Coverage warnings describe visible published elements; they never create placeholder faces. */
export async function validateDefaultProjections(owner:ProductOwner,credentials:AssistantCredentials){
  return withProductGrants(owner,async()=>{
    const headers=buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey);
    const [overviewResponse,metricResponse,actionResponse,definitions]=await Promise.all([
      backendGet('projection-coverage-objects',config.dataQuery.baseUrl+'/ontology/query/overview',{headers,retries:1}),
      backendPost('projection-coverage-metrics',config.dataQuery.baseUrl+'/metricView/queryList',{status:'PUBLISHED'},{headers,retries:1}),
      backendPost('projection-coverage-actions',config.dataQuery.baseUrl+'/action/queryList',{status:'PUBLISHED'},{headers,retries:1}),
      getPostgresPool().query(`SELECT id,definition->>'name' AS name FROM ${t('business_definitions')} WHERE domain_id=$1 AND status='PUBLISHED'`,[owner.domainId]),
    ]);
    const overview=JSON.parse(overviewResponse.text),metrics=JSON.parse(metricResponse.text),actions=JSON.parse(actionResponse.text);
    if(!Array.isArray(overview.classes)||metrics.success!==true||!Array.isArray(metrics.data)||actions.success!==true||!Array.isArray(actions.data))throw new HttpError(503,'Published ontology catalog unavailable','PRODUCT_UNAVAILABLE');
    const elements=[
      ...overview.classes.map((object:{name:string;description?:string})=>({kind:'ObjectType',id:object.name,name:object.description||object.name})),
      ...platformObjectTypes().map(object=>({kind:'ObjectType',id:object.objectType,name:object.name})),
      ...metrics.data.filter((metric:{status:string})=>metric.status==='PUBLISHED').map((metric:{id:string;name:string})=>({kind:'MetricView',id:metric.id,name:metric.name})),
      ...actions.data.filter((action:{status:string})=>action.status==='PUBLISHED').map((action:{id:string;name:string})=>({kind:'Action',id:action.id,name:action.name})),
      ...definitions.rows.map(definition=>({kind:'Definition',id:definition.id,name:definition.name??definition.id})),
    ];
    const published=[...new Map(elements.map(element=>[JSON.stringify([element.kind,element.id]),element])).values()];
    const graph=await readProductOntology(owner);
    const covered=new Set(graph.edges.filter(edge=>edge.relation==='renders'&&edge.is_default).map(edge=>JSON.stringify([edge.target_kind,edge.target_id])));
    return defaultProjectionWarningsSchema.parse({warnings:published.filter(element=>!covered.has(JSON.stringify([element.kind,element.id]))).map(element=>({...element,severity:'warning',code:'DEFAULT_PROJECTION_MISSING'}))});
  });
}

export async function discoverProjections(owner:ProductOwner,kind:string,id:string){
  return withProductGrants(owner,()=>discoverAuthorized(owner,kind,id));
}
async function discoverAuthorized(owner:ProductOwner,kind:string,id:string){
  if(!['ObjectType','Definition','MetricView','Action'].includes(kind))throw new HttpError(400,'Unknown projection target kind','INVALID_PRODUCT_TARGET');
  const graph=await readProductOntology(owner);
  const edges=graph.edges.filter(edge=>edge.relation==='renders'&&edge.target_kind===kind&&edge.target_id===id).sort((a,b)=>Number(b.is_default)-Number(a.is_default)||a.source.localeCompare(b.source)).slice(0,100);
  const assets=await Promise.all(edges.map(edge=>getProduct(owner,edge.source)));
  for(const asset of assets)if(graph.nodes.find(node=>node.id===asset.id)?.revision!==asset.revision||!('renders' in asset.document)||asset.document.renders.kind!==kind||asset.document.renders.id!==id)throw new HttpError(409,'Projection registration changed; retry discovery','PRODUCT_ONTOLOGY_PENDING');
  return {assets,warnings:assets.some(asset=>'renders' in asset.document&&asset.document.isDefault)?[]:[{code:'DEFAULT_PROJECTION_MISSING',message:'No visible default projection is registered for this element'}]};
}
