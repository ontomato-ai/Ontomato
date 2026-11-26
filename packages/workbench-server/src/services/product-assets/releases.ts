import {createHash} from 'node:crypto';
import {z} from 'zod';
import {productAssetSchema,productReferences} from '@ontomato/contracts/product-assets';
import {getProduct} from './store';
import {type ProductOwner} from '../product-governance/grants';
import {qualifiedTable as t,getPostgresPool} from '../../infrastructure/postgres';
import {DashboardMetricClient} from '../dashboard/metric-client';
import {backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {HttpError} from '../../utils/errors';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {readDefinition} from '../business-definitions/definitions';
import {requireProductUse,withProductGrants} from './grants';
import {platformObjectProvider} from './platform-objects';
import {definitionTriggerSchema} from '@ontomato/contracts/product-subscriptions';
import {readDefinitionTrigger} from '../business-definitions/triggers';

export const releaseSnapshotSchema=z.object({schemaVersion:z.literal(1),roots:z.array(z.string()),assets:z.array(productAssetSchema),triggers:z.array(definitionTriggerSchema).optional(),contracts:z.array(z.object({kind:z.enum(['metric','action','definition','object-type','trigger']),id:z.string(),hash:z.string().min(1),contractVersion:z.union([z.literal(1),z.literal(2)]).optional()}))}).superRefine((snapshot,context)=>{
  const ids=new Set(snapshot.assets.map(asset=>asset.id));
  if(ids.size!==snapshot.assets.length)context.addIssue({code:'custom',message:'Duplicate release asset identity'});
  for(const id of snapshot.roots)if(!ids.has(id))context.addIssue({code:'custom',message:`Release root is missing: ${id}`});
  const contracts=new Set(snapshot.contracts.map(contract=>`${contract.kind}:${contract.id}`));
  if(new Set((snapshot.triggers??[]).map(trigger=>trigger.id)).size!==(snapshot.triggers??[]).length)context.addIssue({code:'custom',message:'Duplicate release Trigger identity'});
  for(const trigger of snapshot.triggers??[])if(!contracts.has(`trigger:${trigger.id}`)||!contracts.has(`definition:${trigger.definitionId}`))context.addIssue({code:'custom',message:'Trigger release dependency is missing'});
  if(contracts.size!==snapshot.contracts.length)context.addIssue({code:'custom',message:'Duplicate release capability contract'});
  for(const asset of snapshot.assets)for(const reference of productReferences(asset.document)){
    if(reference.kind==='asset'&&!ids.has(reference.id))context.addIssue({code:'custom',message:`Release child is missing: ${reference.id}`});
    if(['metric','action','definition','object-type'].includes(reference.kind)&&!contracts.has(`${reference.kind}:${reference.id}`))context.addIssue({code:'custom',message:`Release contract is missing: ${reference.kind}:${reference.id}`});
  }
});
type Snapshot=z.infer<typeof releaseSnapshotSchema>;
function canonical(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value)??'null';
}
export function contractHash(value:unknown){return createHash('sha256').update(canonical(value)).digest('hex');}
async function readContract(owner:ProductOwner,credentials:AssistantCredentials,kind:'metric'|'action'|'definition'|'object-type'|'trigger',id:string,version:1|2=2):Promise<Record<string,unknown>>{
  if(kind==='trigger')return readDefinitionTrigger(owner,id);
  if(kind==='definition'){
    const definition=await readDefinition(owner,id);
    if(version===1)return {objectType:definition.objectType,parameters:definition.parameters,predicate:definition.predicate};
    const object=await readContract(owner,credentials,'object-type',definition.objectType);
    return {objectType:definition.objectType,parameters:definition.parameters,predicate:definition.predicate,object};
  }
  if(kind==='object-type'){
    if(id.startsWith('platform:'))return {className:id,attributes:Object.entries(platformObjectProvider(id).fields).sort(([a],[b])=>a.localeCompare(b)).map(([name,type])=>({name,type,primaryKey:name==='id'}))};
    const response=await backendPost('projection-object-contract',config.dataQuery.baseUrl+'/ontology/query/schema',{classNames:[id]}, {headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey,credentials.headers),retries:1});
    const result=JSON.parse(response.text);const object=result.classes?.find((item:{className:string})=>item.className===id);
    if(!object)throw new HttpError(409,'Object type no longer available','PRODUCT_CONTRACT_CHANGED');
    if(version===1)return {className:id,attributes:object.attrs.map((attribute:{name:string;type:string;primaryKey?:boolean})=>({name:attribute.name,type:attribute.type,primaryKey:attribute.primaryKey}))};
    const attributes=object.attrs.map((attribute:{name:string;type:string;primaryKey?:boolean})=>({name:attribute.name,type:attribute.type,primaryKey:attribute.primaryKey})).sort((a:{name:string},b:{name:string})=>a.name.localeCompare(b.name));
    const relationships=(result.relationships??[]).filter((relation:{fromclass:string;toclass:string})=>relation.fromclass===id||relation.toclass===id).map((relation:{name:string;fromclass:string;toclass:string})=>({name:relation.name,fromclass:relation.fromclass,toclass:relation.toclass})).sort((a:{name:string},b:{name:string})=>a.name.localeCompare(b.name));
    return {className:id,attributes,relationships};
  }
  if(kind==='metric'){
    const metric=await new DashboardMetricClient(owner.domainId,credentials).describe(id);
    if(metric.status!=='PUBLISHED')throw new HttpError(409,'Metric is no longer published','PRODUCT_CONTRACT_CHANGED');
    return {parameters:metric.parameterDefs,outputs:metric.outputColumns};
  }
  const response=await backendPost('product-release-action',config.dataQuery.baseUrl+'/action/queryById',{id},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey,credentials.headers),retries:1});
  const result=JSON.parse(response.text);
  if(!result.success||result.data?.status!=='PUBLISHED'||!result.data.function)throw new HttpError(409,'Action is no longer available','PRODUCT_CONTRACT_CHANGED');
  return {parameters:result.data.function.parameters,outputs:result.data.function.returnDef};
}
export function snapshotAsset(snapshot:Snapshot,id:string){
  const asset=snapshot.assets.find(asset=>asset.id===id);
  if(!asset)throw new HttpError(404,'Asset is not part of this release','PRODUCT_UNAVAILABLE');
  return structuredClone(asset);
}
export async function readProductRelease(owner:ProductOwner,releaseId:string,applicationId?:string){
  const result=await getPostgresPool().query(`SELECT snapshot FROM ${t('product_releases')} WHERE domain_id=$1 AND release_id=$2 AND ${applicationId?'application_id=$3':'owner_id=$3'}`,[owner.domainId,releaseId,applicationId??owner.userId]);
  if(!result.rows[0])throw new HttpError(409,'This historical release has no product snapshot','PRODUCT_RELEASE_UNPINNED');
  return releaseSnapshotSchema.parse(result.rows[0].snapshot);
}
export async function validateReleaseContracts(owner:ProductOwner,snapshot:Snapshot,credentials:AssistantCredentials){
  return withProductGrants(owner,()=>validateAuthorizedContracts(owner,snapshot,credentials));
}
async function validateAuthorizedContracts(owner:ProductOwner,snapshot:Snapshot,credentials:AssistantCredentials){
  // A frozen presentation never freezes an old permission decision.
  for(const asset of snapshot.assets)await getProduct(owner,asset.id);
  for(const contract of snapshot.contracts){
    if(contract.kind==='object-type'&&contract.id.startsWith('platform:'))await requireProductUse(owner,contract.id);
    if(contract.hash!==contractHash(await readContract(owner,credentials,contract.kind,contract.id,contract.contractVersion??1)))throw new HttpError(409,'A referenced capability contract changed','PRODUCT_CONTRACT_CHANGED');
  }
}

export async function productReleaseIssues(owner:ProductOwner,snapshot:Snapshot,credentials:AssistantCredentials){
  return withProductGrants(owner,()=>authorizedReleaseIssues(owner,snapshot,credentials));
}
async function authorizedReleaseIssues(owner:ProductOwner,snapshot:Snapshot,credentials:AssistantCredentials){
  // Access failures still reject the request; only contract drift degrades a projection.
  for(const asset of snapshot.assets)await getProduct(owner,asset.id);
  const changed=new Set<string>();
  for(const contract of snapshot.contracts){
    if(contract.kind==='object-type'&&contract.id.startsWith('platform:'))await requireProductUse(owner,contract.id);
    try{if(contract.hash!==contractHash(await readContract(owner,credentials,contract.kind,contract.id,contract.contractVersion??1)))changed.add(`${contract.kind}:${contract.id}`);}
    catch(error){if(error instanceof HttpError&&error.code==='PRODUCT_CONTRACT_CHANGED')changed.add(`${contract.kind}:${contract.id}`);else throw error;}
  }
  const triggerDefinitions=new Set((snapshot.triggers??[]).filter(trigger=>changed.has(`trigger:${trigger.id}`)).map(trigger=>trigger.definitionId));
  return snapshot.assets.filter(asset=>productReferences(asset.document).some(reference=>changed.has(`${reference.kind}:${reference.id}`)||reference.kind==='definition'&&triggerDefinitions.has(reference.id))).map(asset=>({assetId:asset.id,code:'PRODUCT_CONTRACT_CHANGED',message:'A referenced capability contract changed'}));
}

export async function activeProductBundle(owner:ProductOwner,id:string,credentials:AssistantCredentials){
  const {releaseId,snapshot}=await readActiveProductBundle(owner,id);
  await validateReleaseContracts(owner,snapshot,credentials);
  return {releaseId,snapshot};
}
export async function readActiveProductBundle(owner:ProductOwner,id:string){
  await requireProductUse(owner,id);
  await getProduct(owner,id);
  const head=await getPostgresPool().query(`SELECT release_id FROM ${t('product_bundle_heads')} WHERE domain_id=$1 AND bundle_id=$2`,[owner.domainId,id]);
  if(!head.rows[0])throw new HttpError(409,'This bundle has no recorded release','PRODUCT_RELEASE_UNPINNED');
  const pending=await getPostgresPool().query(`SELECT release_id FROM ${t('product_publication_outbox')} WHERE domain_id=$1 AND bundle_id=$2`,[owner.domainId,id]);
  if(pending.rows[0])throw new HttpError(409,'Application directory synchronization is pending','PRODUCT_PUBLICATION_PENDING');
  const snapshot=await readProductRelease(owner,head.rows[0].release_id,id);
  return {releaseId:head.rows[0].release_id,snapshot};
}
