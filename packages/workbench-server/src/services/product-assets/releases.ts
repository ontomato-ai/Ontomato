import {createHash} from 'node:crypto';
import {z} from 'zod';
import {productAssetSchema,productReferences,type ProductAsset} from '@ontomato/contracts/product-assets';
import {assertLegacyProductWrite} from './panel-boundary';
import {getProduct,lockProducts,type ProductOwner} from './store';
import {validateProduct,validatePageBindings} from './validation';
import {transaction} from '../../infrastructure/postgres-transaction';
import {qualifiedTable as t,getPostgresPool} from '../../infrastructure/postgres';
import {DashboardMetricClient} from '../dashboard/metric-client';
import {backendPost,backendPut,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {HttpError} from '../../utils/errors';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {readDefinition} from './definitions';
import {validateComposition} from './composition';
import {randomUUID} from 'node:crypto';
import {requireProductUse,withProductGrants} from './grants';
import {platformObjectProvider} from './platform-objects';
import {agentPrincipalCredentials} from './agent-principal';
import {synchronizeProductOntology} from './ontology';
import {definitionTriggerSchema} from '@ontomato/contracts/product-subscriptions';
import {readDefinitionTrigger} from './triggers';
import {nativeAgentAsset,nativeApplicationAsset} from './platform-assets';

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
export const productReleaseDiffSchema=z.object({assets:z.array(z.object({id:z.string(),change:z.enum(['added','removed','updated']),fromRevision:z.number().optional(),toRevision:z.number().optional()})),contracts:z.array(z.object({kind:z.string(),id:z.string(),change:z.enum(['added','removed','changed'])}))});
type Snapshot=z.infer<typeof releaseSnapshotSchema>;
async function publishApplicationIdentity(bundle:ProductAsset,releaseId:string,credentials:AssistantCredentials){
  if(bundle.document.kind!=='application')return;
  const response=await backendPut('product-application-publication',config.dataQuery.baseUrl+'/platform/applications/'+encodeURIComponent(bundle.id)+'/product-publication',{releaseId,declaration:{names:{en:bundle.name},descriptions:{en:bundle.description},icon:'pages',groups:[],permissions:[]}},{...credentials,retries:1});
  if(JSON.parse(response.text).success!==true)throw new HttpError(503,'Application directory publication failed','PRODUCT_UNAVAILABLE');
}
export function productReleaseDiff(previous:Snapshot,next:Snapshot):z.infer<typeof productReleaseDiffSchema>{
  const before=new Map(previous.assets.map(asset=>[asset.id,asset])),after=new Map(next.assets.map(asset=>[asset.id,asset]));
  const assets:z.infer<typeof productReleaseDiffSchema>['assets']=[];
  for(const id of new Set([...before.keys(),...after.keys()])){
    const old=before.get(id),current=after.get(id);
    if(!old||!current||old.revision!==current.revision)assets.push({id,change:!old?'added':!current?'removed':'updated',...(old?{fromRevision:old.revision}:{}),...(current?{toRevision:current.revision}:{})});
  }
  const oldContracts=new Map(previous.contracts.map(contract=>[`${contract.kind}:${contract.id}`,contract])),newContracts=new Map(next.contracts.map(contract=>[`${contract.kind}:${contract.id}`,contract]));
  const contracts:z.infer<typeof productReleaseDiffSchema>['contracts']=[];
  for(const key of new Set([...oldContracts.keys(),...newContracts.keys()])){
    const old=oldContracts.get(key),current=newContracts.get(key),contract=current??old!;
    if(!old||!current||old.hash!==current.hash)contracts.push({kind:contract.kind,id:contract.id,change:!old?'added':!current?'removed':'changed'});
  }
  return {assets,contracts};
}
/** Retry the directory side effect from a frozen publication, never a later draft. */
export async function synchronizeBundlePublication(owner:ProductOwner,id:string,credentials:AssistantCredentials){
  await assertLegacyProductWrite(owner,credentials,{id});
  return synchronizeAuthorizedBundlePublication(owner,id,credentials);
}
async function synchronizeAuthorizedBundlePublication(owner:ProductOwner,id:string,credentials:AssistantCredentials){
  await transaction(async client=>{
    await lockProducts(client,owner);
    const pending=await client.query(`SELECT release_id FROM ${t('product_publication_outbox')} WHERE domain_id=$1 AND bundle_id=$2`,[owner.domainId,id]);
    if(!pending.rows[0])return;
    if(!(await getProduct(owner,id,client)).editable)throw new HttpError(403,'Bundle edit Grant required','PRODUCT_FORBIDDEN');
    const releaseId=pending.rows[0].release_id;
    const snapshot=await readProductRelease(owner,releaseId,id);
    await publishApplicationIdentity(snapshotAsset(snapshot,id),releaseId,credentials);
    await client.query(`DELETE FROM ${t('product_publication_outbox')} WHERE domain_id=$1 AND bundle_id=$2 AND release_id=$3`,[owner.domainId,id,releaseId]);
  });
}
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
    const response=await backendPost('projection-object-contract',config.dataQuery.baseUrl+'/ontology/query/schema',{classNames:[id]}, {headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
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
  const response=await backendPost('product-release-action',config.dataQuery.baseUrl+'/action/queryById',{id},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  const result=JSON.parse(response.text);
  if(!result.success||result.data?.status!=='PUBLISHED'||!result.data.function)throw new HttpError(409,'Action is no longer available','PRODUCT_CONTRACT_CHANGED');
  return {parameters:result.data.function.parameters,outputs:result.data.function.returnDef};
}
/** Pure traversal is shared by publication tests; the recursion stack rejects cycles. */
export async function captureProductTree(roots:string[],read:(id:string)=>Promise<ProductAsset>){
  const captured=new Map<string,ProductAsset>();
  const visit=async(id:string,path:Set<string>)=>{
    if(path.has(id))throw new HttpError(400,'Cyclic release dependency','PRODUCT_CYCLE');
    if(captured.has(id))return;
    const asset=structuredClone(await read(id));const next=new Set(path).add(id);
    if(asset.document.kind==='page')delete asset.document.workspace;
    for(const reference of productReferences(asset.document).filter(reference=>reference.kind==='asset'))await visit(reference.id,next);
    captured.set(id,structuredClone({...asset,editable:false}));
  };
  for(const id of roots)await visit(id,new Set());
  return [...captured.values()];
}
export async function captureProductRelease(owner:ProductOwner,roots:string[],credentials:AssistantCredentials,triggerIds:string[]=[]):Promise<Snapshot>{
  for(const id of roots)await assertLegacyProductWrite(owner,credentials,{id});
  return withProductGrants(owner,()=>captureAuthorizedRelease(owner,roots,credentials,triggerIds));
}
async function captureAuthorizedRelease(owner:ProductOwner,roots:string[],credentials:AssistantCredentials,triggerIds:string[]):Promise<Snapshot>{
  await synchronizeProductOntology(owner);
  const assets=await transaction(async client=>{await lockProducts(client,owner);return captureProductTree(roots,id=>getProduct(owner,id,client));});
  for(const asset of assets)if(['widget','widget-group','operation-panel','layout-template'].includes(asset.document.kind))throw new HttpError(409,'Migrate legacy presentation assets before creating a V2 release','PRODUCT_UNPINNABLE_DEPENDENCY');
  const profile=assets.find(asset=>roots.includes(asset.id)&&asset.document.kind==='agent-profile');
  if(profile?.document.kind==='agent-profile')credentials=await agentPrincipalCredentials(owner.domainId,profile.document.principalId,credentials.locale,owner.userId);
  const contracts:Snapshot['contracts']=[];const seen=new Set<string>();
  const byId=new Map(assets.map(asset=>[asset.id,asset]));
  const readCaptured=async(id:string)=>{const asset=byId.get(id);if(!asset)throw new HttpError(409,'Release dependency is missing','PRODUCT_UNAVAILABLE');return asset;};
  for(const asset of assets){
    if(await nativeAgentAsset(owner.domainId,asset.id)||await nativeApplicationAsset(owner.domainId,asset.id))throw new HttpError(409,'Platform-native assets use their registered execution boundary; they cannot be frozen as declarative projections','PRODUCT_UNPINNABLE_DEPENDENCY');
    await validateComposition(asset.id,asset,readCaptured);
    await validatePageBindings(owner,asset,readCaptured,credentials);
    await validateProduct(owner,asset,credentials);
    if(asset.document.kind==='object-view'||asset.document.kind==='dashboard')throw new HttpError(409,'Migrate service-owned view definitions before creating a pinned release','PRODUCT_UNPINNABLE_DEPENDENCY');
    const sources=new Set<string>();let complete=true;
    for(const reference of productReferences(asset.document)){
      if(reference.kind==='object-type')sources.add(reference.id);
      if(reference.kind==='definition')sources.add((await readDefinition(owner,reference.id)).objectType);
      if(reference.kind==='metric'){
        const metric=await new DashboardMetricClient(owner.domainId,credentials).describe(reference.id);
        if(!metric.sourceObjectTypes)complete=false;
        for(const type of metric.sourceObjectTypes??[])sources.add(type);
      }
    }
    if(complete)asset.sourceObjectTypes=[...sources].sort();
  }
  for(const asset of assets)for(const reference of productReferences(asset.document)){
    if(!['metric','action','definition','object-type'].includes(reference.kind))continue;
    const kind=reference.kind as 'metric'|'action'|'definition'|'object-type';
    const key=`${reference.kind}:${reference.id}`;if(seen.has(key))continue;seen.add(key);
    contracts.push({kind,id:reference.id,contractVersion:2,hash:contractHash(await readContract(owner,credentials,kind,reference.id))});
  }
  const triggers=await Promise.all(triggerIds.map(id=>readDefinitionTrigger(owner,id)));
  for(const trigger of triggers){
    const projection=assets.find(asset=>asset.document.kind==='collection-view'&&asset.document.renders.id===trigger.definitionId);
    if(!projection)throw new HttpError(400,'Declare a CollectionView for every Trigger Definition','PRODUCT_MANIFEST_REQUIRED');
    contracts.push({kind:'trigger',id:trigger.id,contractVersion:2,hash:contractHash(trigger)});
  }
  return releaseSnapshotSchema.parse({schemaVersion:1,roots,assets,contracts,...(triggers.length?{triggers}:{})});
}
export function snapshotAsset(snapshot:Snapshot,id:string){
  const asset=snapshot.assets.find(asset=>asset.id===id);
  if(!asset)throw new HttpError(404,'Asset is not part of this release','PRODUCT_UNAVAILABLE');
  return structuredClone(asset);
}
export async function saveProductRelease(owner:ProductOwner,releaseId:string,applicationId:string,snapshot:Snapshot,client:Pick<ReturnType<typeof getPostgresPool>,'query'>=getPostgresPool()){
  await client.query(`INSERT INTO ${t('product_releases')} (domain_id,release_id,application_id,owner_id,snapshot) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING`,[owner.domainId,releaseId,applicationId,owner.userId,JSON.stringify(snapshot)]);
}
export async function readProductRelease(owner:ProductOwner,releaseId:string,applicationId?:string){
  const result=await getPostgresPool().query(`SELECT snapshot FROM ${t('product_releases')} WHERE domain_id=$1 AND release_id=$2 AND ${applicationId?'application_id=$3':'owner_id=$3'}`,[owner.domainId,releaseId,applicationId??owner.userId]);
  if(!result.rows[0])throw new HttpError(409,'This historical release has no product snapshot; publish a reviewed release first','PRODUCT_RELEASE_UNPINNED');
  return releaseSnapshotSchema.parse(result.rows[0].snapshot);
}
export async function validateReleaseContracts(owner:ProductOwner,snapshot:Snapshot,credentials:AssistantCredentials){
  return withProductGrants(owner,()=>validateAuthorizedContracts(owner,snapshot,credentials));
}
async function validateAuthorizedContracts(owner:ProductOwner,snapshot:Snapshot,credentials:AssistantCredentials){
  // A frozen presentation never freezes an old permission decision.
  for(const asset of snapshot.assets)await getProduct(owner,asset.id);
  const profile=snapshot.assets.find(asset=>snapshot.roots.includes(asset.id)&&asset.document.kind==='agent-profile');
  if(profile?.document.kind==='agent-profile')credentials=await agentPrincipalCredentials(owner.domainId,profile.document.principalId,credentials.locale,owner.userId);
  for(const contract of snapshot.contracts){
    if(contract.kind==='object-type'&&contract.id.startsWith('platform:')&&profile?.document.kind==='agent-profile')await requireProductUse({...owner,userId:profile.document.principalId},contract.id);
    if(contract.hash!==contractHash(await readContract(owner,credentials,contract.kind,contract.id,contract.contractVersion??1)))throw new HttpError(409,'A referenced capability contract changed; upgrade this product release explicitly','PRODUCT_CONTRACT_CHANGED');
  }
}

export async function productReleaseIssues(owner:ProductOwner,snapshot:Snapshot,credentials:AssistantCredentials){
  return withProductGrants(owner,()=>authorizedReleaseIssues(owner,snapshot,credentials));
}
async function authorizedReleaseIssues(owner:ProductOwner,snapshot:Snapshot,credentials:AssistantCredentials){
  // Access failures still reject the request; only contract drift degrades a projection.
  for(const asset of snapshot.assets)await getProduct(owner,asset.id);
  const profile=snapshot.assets.find(asset=>snapshot.roots.includes(asset.id)&&asset.document.kind==='agent-profile');
  if(profile?.document.kind==='agent-profile')credentials=await agentPrincipalCredentials(owner.domainId,profile.document.principalId,credentials.locale,owner.userId);
  const changed=new Set<string>();
  for(const contract of snapshot.contracts){
    if(contract.kind==='object-type'&&contract.id.startsWith('platform:')&&profile?.document.kind==='agent-profile')await requireProductUse({...owner,userId:profile.document.principalId},contract.id);
    try{if(contract.hash!==contractHash(await readContract(owner,credentials,contract.kind,contract.id,contract.contractVersion??1)))changed.add(`${contract.kind}:${contract.id}`);}
    catch(error){if(error instanceof HttpError&&error.code==='PRODUCT_CONTRACT_CHANGED')changed.add(`${contract.kind}:${contract.id}`);else throw error;}
  }
  const triggerDefinitions=new Set((snapshot.triggers??[]).filter(trigger=>changed.has(`trigger:${trigger.id}`)).map(trigger=>trigger.definitionId));
  return snapshot.assets.filter(asset=>productReferences(asset.document).some(reference=>changed.has(`${reference.kind}:${reference.id}`)||reference.kind==='definition'&&triggerDefinitions.has(reference.id))).map(asset=>({assetId:asset.id,code:'PRODUCT_CONTRACT_CHANGED',message:'A referenced capability contract changed; explicitly upgrade this product release'}));
}

export async function publishProductBundle(owner:ProductOwner,id:string,revision:number,credentials:AssistantCredentials){
  await assertLegacyProductWrite(owner,credentials,{id});
  const bundle=await getProduct(owner,id);
  if(!bundle.editable)throw new HttpError(403,'Bundle edit permission required','PRODUCT_FORBIDDEN');
  if(bundle.revision!==revision)throw new HttpError(409,'Bundle changed; reload before publishing','PRODUCT_CONFLICT');
  if(!['agent-profile','application'].includes(bundle.document.kind))throw new HttpError(400,'Publish an Application or AgentProfile bundle','INVALID_PRODUCT_TYPE');
  if(bundle.document.kind==='application'&&bundle.document.workspaceId)throw new HttpError(400,'Source applications publish through the workspace release service','INVALID_PRODUCT_TYPE');
  if(bundle.document.kind==='application'&&!bundle.document.navigationId)throw new HttpError(400,'Declarative Applications require a Navigation root','INVALID_NAVIGATION');
  if(bundle.document.kind==='application'&&bundle.document.applicationId!==id)throw new HttpError(400,'Application bundle and governance identity must use the same ID','INVALID_PRODUCT_TARGET');
  if(bundle.document.kind==='application'&&!/^app-[a-z0-9-]{1,59}$/.test(id))throw new HttpError(400,'Application identities require an app- prefix and lowercase letters, numbers or hyphens','INVALID_PRODUCT_TARGET');
  const snapshot=await withProductGrants(owner,()=>captureAuthorizedRelease(owner,[id],credentials,[]));
  if(snapshotAsset(snapshot,id).revision!==revision)throw new HttpError(409,'Bundle changed during capture','PRODUCT_CONFLICT');
  const releaseId=randomUUID();
  await transaction(async client=>{
    await lockProducts(client,owner);
    const current=await getProduct(owner,id,client);
    if(!current.editable)throw new HttpError(403,'Bundle edit permission required','PRODUCT_FORBIDDEN');
    if(current.revision!==revision)throw new HttpError(409,'Bundle changed during publication','PRODUCT_CONFLICT');
    for(const captured of snapshot.assets)if((await getProduct(owner,captured.id,client)).revision!==captured.revision)throw new HttpError(409,'A projection changed during publication; retry with the latest dependencies','PRODUCT_CONFLICT');
    await saveProductRelease(owner,releaseId,id,snapshot,client);
    await client.query(`INSERT INTO ${t('product_bundle_heads')} (domain_id,bundle_id,release_id) VALUES($1,$2,$3) ON CONFLICT(domain_id,bundle_id) DO UPDATE SET release_id=EXCLUDED.release_id`,[owner.domainId,id,releaseId]);
    if(bundle.document.kind==='application')await client.query(`INSERT INTO ${t('product_publication_outbox')} (domain_id,bundle_id,release_id) VALUES($1,$2,$3) ON CONFLICT(domain_id,bundle_id) DO UPDATE SET release_id=EXCLUDED.release_id`,[owner.domainId,id,releaseId]);
  });
  if(bundle.document.kind==='application')await synchronizeAuthorizedBundlePublication(owner,id,credentials);
  return {releaseId};
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
  if(!head.rows[0])throw new HttpError(409,'Publish this bundle before running it','PRODUCT_RELEASE_UNPINNED');
  const pending=await getPostgresPool().query(`SELECT release_id FROM ${t('product_publication_outbox')} WHERE domain_id=$1 AND bundle_id=$2`,[owner.domainId,id]);
  if(pending.rows[0])throw new HttpError(409,'Application directory synchronization is pending; retry publication synchronization','PRODUCT_PUBLICATION_PENDING');
  const snapshot=await readProductRelease(owner,head.rows[0].release_id,id);
  return {releaseId:head.rows[0].release_id,snapshot};
}
export async function rollbackProductBundle(owner:ProductOwner,id:string,releaseId:string,credentials:AssistantCredentials){
  await assertLegacyProductWrite(owner,credentials,{id});
  const bundle=await getProduct(owner,id);
  if(!bundle.editable)throw new HttpError(403,'Bundle edit permission required','PRODUCT_FORBIDDEN');
  if(!['agent-profile','application'].includes(bundle.document.kind)||bundle.document.kind==='application'&&bundle.document.workspaceId)throw new HttpError(400,'Expected a declarative Application or AgentProfile','INVALID_PRODUCT_TYPE');
  const snapshot=await readProductRelease(owner,releaseId,id);
  if(snapshotAsset(snapshot,id).document.kind!==bundle.document.kind)throw new HttpError(400,'Bundle release type mismatch','INVALID_PRODUCT_TYPE');
  await productReleaseIssues(owner,snapshot,credentials);
  await transaction(async client=>{
    await lockProducts(client,owner);
    if(!(await getProduct(owner,id,client)).editable)throw new HttpError(403,'Bundle edit permission required','PRODUCT_FORBIDDEN');
    await client.query(`INSERT INTO ${t('product_bundle_heads')} (domain_id,bundle_id,release_id) VALUES($1,$2,$3) ON CONFLICT(domain_id,bundle_id) DO UPDATE SET release_id=EXCLUDED.release_id`,[owner.domainId,id,releaseId]);
    if(bundle.document.kind==='application')await client.query(`INSERT INTO ${t('product_publication_outbox')} (domain_id,bundle_id,release_id) VALUES($1,$2,$3) ON CONFLICT(domain_id,bundle_id) DO UPDATE SET release_id=EXCLUDED.release_id`,[owner.domainId,id,releaseId]);
  });
  if(bundle.document.kind==='application')await synchronizeAuthorizedBundlePublication(owner,id,credentials);
  return {releaseId};
}
export async function listProductBundleReleases(owner:ProductOwner,id:string){
  const bundle=await getProduct(owner,id);
  if(!bundle.editable)throw new HttpError(403,'Bundle edit permission required','PRODUCT_FORBIDDEN');
  const result=await getPostgresPool().query(`SELECT release.release_id AS "releaseId",release.created_at AS "createdAt",head.release_id=release.release_id AS active FROM ${t('product_releases')} release LEFT JOIN ${t('product_bundle_heads')} head ON head.domain_id=release.domain_id AND head.bundle_id=release.application_id WHERE release.domain_id=$1 AND release.application_id=$2 ORDER BY release.created_at DESC LIMIT 100`,[owner.domainId,id]);
  return {releases:result.rows};
}
