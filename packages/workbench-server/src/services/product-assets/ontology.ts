import {z} from 'zod';
import {productDefaultTexts,type ProductAsset} from '@ontomato/contracts/product-assets';
import {productGraph,productGraphSchema} from '@ontomato/contracts/product-graph';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {backendPost,backendGet,buildBackendHeaders} from '../../utils/backend-client';
import {environment} from '../../config/environment';
import {config} from '../../config/application';
import {HttpError} from '../../utils/errors';
import type {ProductOwner} from '../product-governance/grants';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {readProductGrantRecords} from '../product-governance/grants';
import {DashboardMetricClient} from '../dashboard/metric-client';
import {readDefinition} from '../business-definitions/definitions';
import {platformObjectTypes} from './platform-objects';
import {assistantStore} from '../assistant/store';
import {assistantName} from '../assistant/labels';

export function ontologyRegistration(asset:ProductAsset){
  const document=asset.document;
  if('renders' in document)return {id:asset.id,kind:document.kind,name:asset.name,revision:asset.revision,targetKind:document.renders.kind,targetId:document.renders.id,isDefault:document.isDefault};
  if(document.kind==='agent-profile')return {id:asset.id,kind:document.kind,name:asset.name,revision:asset.revision,targetKind:'AgentDefinition',targetId:document.agentId,isDefault:false};
  if(document.kind==='application')return {id:asset.id,kind:document.kind,name:asset.name,revision:asset.revision,targetKind:null,targetId:null,isDefault:false};
  return null;
}
async function request(operation:string,body:unknown){
  const token=environment.agentRuntime().queryServiceToken;
  if(!token)throw new HttpError(503,'Ontology registration service credential unavailable','PRODUCT_ONTOLOGY_UNAVAILABLE');
  const response=await backendPost('product-ontology-'+operation,config.dataQuery.baseUrl+'/ontology/products/service/'+operation,body,{headers:{'Content-Type':'application/json','X-Ontomato-Query-Service-Token':token},retries:1});
  return JSON.parse(response.text);
}
/** An outbox commits with the product document; failed remote synchronization remains retryable. */
export async function synchronizeProductOntology(owner:ProductOwner){
  const rows=await getPostgresPool().query(`SELECT asset_id,revision,registration FROM ${t('product_ontology_outbox')} WHERE domain_id=$1 ORDER BY asset_id`,[owner.domainId]);
  for(const row of rows.rows){
    const result=row.registration?await request('register',{domainId:owner.domainId,nodes:[row.registration]}):await request('remove',{domainId:owner.domainId,id:row.asset_id,revision:row.revision});
    if(result.success!==true)throw new HttpError(503,'Product ontology synchronization failed','PRODUCT_ONTOLOGY_UNAVAILABLE');
    await getPostgresPool().query(`UPDATE ${t('product_assets')} SET ontology_registered_revision=$3 WHERE domain_id=$1 AND id=$2 AND revision=$3`,[owner.domainId,row.asset_id,row.revision]);
    await getPostgresPool().query(`DELETE FROM ${t('product_ontology_outbox')} WHERE domain_id=$1 AND asset_id=$2 AND revision=$3`,[owner.domainId,row.asset_id,row.revision]);
  }
}
export const ontologyProductGraphSchema=z.object({nodes:z.array(z.object({id:z.string(),kind:z.string(),name:z.string(),revision:z.number()})),edges:z.array(z.object({source:z.string(),relation:z.enum(['renders','embodies']),target_kind:z.string(),target_id:z.string(),is_default:z.boolean()}))});
export async function readProductOntology(owner:ProductOwner){
  await synchronizeProductOntology(owner);
  return ontologyProductGraphSchema.parse(await request('graph',{domainId:owner.domainId,userId:owner.userId}));
}
export async function registeredProductGraph(owner:ProductOwner,assets:ProductAsset[],credentials?:AssistantCredentials){
  const graph=productGraph(assets),ontology=await readProductOntology(owner);
  const targets:Record<string,string>={ObjectType:'object-type',Definition:'definition',MetricView:'metric',Action:'action',AgentDefinition:'agent'};
  const registered=new Set(ontology.edges.map(edge=>JSON.stringify([`asset:${edge.source}`,edge.relation,`${targets[edge.target_kind]}:${edge.target_id}`])));
  const registrations=new Map(ontology.nodes.map(node=>[node.id,node]));
  for(const asset of assets)if(ontologyRegistration(asset)&&(registrations.get(asset.id)?.revision!==asset.revision||registrations.get(asset.id)?.kind!==asset.document.kind))throw new HttpError(409,'Product ontology registration is not current; retry after synchronization','PRODUCT_ONTOLOGY_PENDING');
  for(const edge of graph.edges)if(['renders','embodies'].includes(edge.relation)){
    if(!registered.has(JSON.stringify([edge.source,edge.relation,edge.target])))throw new HttpError(409,'Product ontology relationship is not synchronized','PRODUCT_ONTOLOGY_PENDING');
    edge.storage='ontology';
  }
  if(credentials)for(const asset of assets.filter(asset=>asset.editable&&['application','agent-profile'].includes(asset.document.kind))){
    const {grants}=await readProductGrantRecords(asset.id,credentials);
    for(const grant of grants){
      const id=`grant:${grant.principalKind}:${grant.principalId}`;
      if(!graph.nodes.some(node=>node.id===id))graph.nodes.push({id,name:grant.principalId,kind:grant.principalKind,category:'principal'});
      if(!graph.edges.some(edge=>edge.source===id&&edge.target===`asset:${asset.id}`&&edge.relation===grant.verb))graph.edges.push({source:id,target:`asset:${asset.id}`,relation:grant.verb,storage:'governance'});
    }
  }
  if(credentials)await resolveGraphNames(owner,graph,credentials);
  return productGraphSchema.parse(graph);
}

/** Display metadata is resolved with the current caller's permissions, never service privileges. */
async function resolveGraphNames(owner:ProductOwner,graph:ReturnType<typeof productGraph>,credentials:AssistantCredentials){
  const headers=buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey);
  const post=async(path:string,body:unknown)=>JSON.parse((await backendPost('product-graph-label',config.dataQuery.baseUrl+path,body,{headers,retries:1})).text);
  const catalogs=new Map<string,Promise<Record<string,string>>>();
  function catalog(kind:string){
    if(!catalogs.has(kind))catalogs.set(kind,(async()=>{
      try{
        if(kind==='object-type'){
          const result=await post('/admin/getMetas',{});
          return Object.fromEntries((result.data?.classDef??[]).map((item:{className:string;showName?:string;classDesc?:string})=>[item.className,item.showName||item.classDesc]));
        }
        if(kind==='AgentDefinition')return Object.fromEntries((await assistantStore.agents(owner.domainId)).map(agent=>[agent.id,assistantName(agent,credentials.locale)]));
        const result=await post(kind==='role'?'/role/getRoleInfoPage':'/user/getUserInfoPage',{pageNum:1,pageSize:1000,cdt:''});
        return Object.fromEntries((result.data?.data??[]).map((item:{id:string;roleName?:string;userName?:string;loginCode?:string})=>[item.id,item.roleName||item.userName||item.loginCode]));
      }catch{return {};}
    })());
    return catalogs.get(kind)!;
  }
  await Promise.all(graph.nodes.filter(node=>!node.assetId).map(async node=>{
    const raw=node.name;
    try{
      let name:string|undefined;
      if(node.kind==='domain')name=productDefaultTexts.graphDomainMembers;
      else if(node.kind==='AgentDefinition')name=(await catalog('AgentDefinition'))[raw];
      else if(node.kind==='role'||node.kind==='principal')name=(await catalog(node.kind))[raw];
      else if(node.kind==='metric')name=(await new DashboardMetricClient(owner.domainId,credentials).describe(raw)).name;
      else if(node.kind==='definition'){
        const definition=await readDefinition(owner,raw);
        name=platformObjectTypes().find(type=>type.objectType===definition.objectType)?.name||definition.name;
      }
      else if(node.kind==='action')name=(await post('/action/queryById',{id:raw})).data?.name;
      else if(node.kind==='object-type'){
        name=platformObjectTypes().find(type=>type.objectType===raw)?.name||(await catalog('object-type'))[raw];
      }
      else if(node.kind==='application'){
        const result=JSON.parse((await backendGet('product-graph-application',config.dataQuery.baseUrl+'/platform/applications/'+encodeURIComponent(raw),{headers,retries:1})).text);
        const names=result.data?.names;name=names?.[credentials.locale??'']||names?.['zh-CN']||names?.en;
      }
      node.name=name||({role:productDefaultTexts.graphRoleUnavailable,principal:productDefaultTexts.graphPrincipalUnavailable,AgentDefinition:productDefaultTexts.graphNameUnavailable,metric:productDefaultTexts.graphMetricUnavailable,action:productDefaultTexts.graphActionUnavailable,definition:productDefaultTexts.graphDefinitionUnavailable,'object-type':productDefaultTexts.graphObjectTypeUnavailable,application:productDefaultTexts.graphApplicationUnavailable} as Record<string,string>)[node.kind]||productDefaultTexts.graphNameUnavailable;
    }catch{node.name=productDefaultTexts.graphNameUnavailable;}
  }));
}
