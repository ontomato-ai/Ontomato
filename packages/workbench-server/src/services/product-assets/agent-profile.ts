import {getProduct} from './store';
import type {ProductOwner} from '../product-governance/grants';
import {validateProduct} from './validation';
import {backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import {HttpError} from '../../utils/errors';
import {readDefinition} from './definitions';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {qualifiedTable as t,getPostgresPool} from '../../infrastructure/postgres';
import {snapshotAsset,readProductRelease,productReleaseIssues,readActiveProductBundle} from './releases';
import type {ProductAsset} from '@ontomato/contracts/product-assets';
import {executeDefinition} from './definitions';
import {DashboardMetricClient} from '../dashboard/metric-client';
import {resolveViewParameters} from '@ontomato/contracts/object-views';
import {runtimeJsonObjectSchema} from '@ontomato/contracts/agent-runtime-values';
import {withProductGrants,currentProductGrants,requireProductUse} from './grants';
import {readPlatformObjects} from './platform-objects';
import {credentialsForDefinition} from '../assistant/execution';
import {nativeProfileId} from './platform-assets';

/** Profile assembly exposes interfaces, never grants execution privileges. */
export async function assembleAgentProfile(owner:ProductOwner,credentials:AssistantCredentials,id:string,pinnedAssets?:ProductAsset[],issues:{assetId:string;code:string;message:string}[]=[], executionCredentials?:AssistantCredentials){
  return withProductGrants(owner,()=>assembleAuthorizedProfile(owner,credentials,id,pinnedAssets,issues,executionCredentials));
}
async function assembleAuthorizedProfile(owner:ProductOwner,credentials:AssistantCredentials,id:string,pinnedAssets?:ProductAsset[],issues:{assetId:string;code:string;message:string}[]=[], executionCredentials?:AssistantCredentials){
  const read=async(assetId:string)=>{
    await getProduct(owner,assetId);
    if(!pinnedAssets)return getProduct(owner,assetId);
    const asset=pinnedAssets.find(asset=>asset.id===assetId);
    if(!asset)throw new HttpError(404,'Projection is not in this profile release','PRODUCT_UNAVAILABLE');
    return asset;
  };
  const profile=await read(id);
  if(profile.document.kind!=='agent-profile')throw new HttpError(400,'Choose an AgentProfile','INVALID_AGENT_PROFILE');
  credentials=executionCredentials ?? await credentialsForDefinition(owner,profile.document.agentId,credentials);
  const tools=[];
  for(const assetId of profile.document.tools){
    if(issues.some(issue=>issue.assetId===assetId))continue;
    const asset=await read(assetId);await validateProduct(owner,asset,credentials);
    if(asset.document.kind==='action-view'){
      const response=await backendPost('profile-action-form',config.dataQuery.baseUrl+'/action/form',{id:asset.document.renders.id},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey,credentials.headers),retries:1});
      const form=JSON.parse(response.text);if(!form.success)throw new HttpError(409,'Profile Action form unavailable','PROFILE_TOOL_UNAVAILABLE');
      tools.push({assetId,kind:'action',id:asset.document.renders.id,name:asset.name,description:asset.description,parameters:form.data.fields});
    }else if(asset.document.kind==='metric-widget'){
      const metric=await new DashboardMetricClient(owner.domainId,credentials).describe(asset.document.renders.id);
      tools.push({assetId,kind:'metric',id:asset.document.renders.id,name:asset.name,description:asset.description,parameters:metric.parameterDefs,outputs:metric.outputColumns});
    }
    else if(asset.document.kind==='collection-view'){
      const definition=await readDefinition(owner,asset.document.renders.id);
      tools.push({assetId,kind:'collection',id:definition.id,name:asset.name,parameters:definition.parameters});
    }else throw new HttpError(400,'Profile tool is not a supported projection','INVALID_AGENT_PROFILE');
  }
  const contextViews=[];
  for(const assetId of profile.document.contextViews){
    if(issues.some(issue=>issue.assetId===assetId))continue;
    const view=await read(assetId);
    if(view.document.kind!=='object-projection'||!['text','3d'].includes(view.document.renderer)||!view.document.fields.length)throw new HttpError(400,'Context must use text or 3D ObjectViews with explicit fields','INVALID_AGENT_PROFILE');
    contextViews.push({assetId,objectType:view.document.renders.id,fields:view.document.fields});
  }
  return {id,agentId:profile.document.agentId,instructions:profile.document.instructions,tools,contextViews,issues};
}
export async function renderAgentObjectContext(owner:ProductOwner,credentials:AssistantCredentials,profileId:string,selection:{className:string;primaryKey:string}){
  await requireProductUse(owner,profileId);
  const {snapshot}=await readActiveProductBundle(owner,profileId);
  const frozen=snapshotAsset(snapshot,profileId);
  if(frozen.document.kind!=='agent-profile')throw new HttpError(400,'Choose an AgentProfile','INVALID_AGENT_PROFILE');
  const executionCredentials=await credentialsForDefinition(owner,frozen.document.agentId,credentials);
  const issues=await productReleaseIssues(owner,snapshot,executionCredentials);
  const profile=await assembleAgentProfile(owner,credentials,profileId,snapshot.assets,issues,executionCredentials);
  return readProfileObjectContext(owner,profile,executionCredentials,selection);
}
async function readProfileObjectContext(owner:ProductOwner,profile:Awaited<ReturnType<typeof assembleAgentProfile>>,credentials:AssistantCredentials,selection:{className:string;primaryKey:string}){

  const executionOwner={...owner,userId:credentials.executionUserId??owner.userId};
  const views=profile.contextViews.filter(view=>view.objectType===selection.className);
  if(!views.length)throw new HttpError(404,'Profile has no text view for this object type','OBJECT_CONTEXT_UNAVAILABLE');
  const fields=[...new Set(views.flatMap(view=>view.fields))];
  if(!fields.length)throw new HttpError(400,'Text ObjectView must declare fields','INVALID_PRODUCT_FIELD');
  if(selection.className.startsWith('platform:')){
    await requireProductUse(executionOwner,selection.className);
    const rows=await readPlatformObjects(executionOwner,credentials,selection.className,{},['id',...fields]);
    const object=rows.find(row=>row.id===selection.primaryKey);
    if(!object)throw new HttpError(404,'Platform context object unavailable','OBJECT_CONTEXT_UNAVAILABLE');
    return {objectType:selection.className,primaryKey:selection.primaryKey,values:Object.fromEntries(fields.map(field=>[field,object[field]??null]))};
  }
  const response=await backendPost('profile-object-context',config.dataQuery.baseUrl+'/data/queryInfoByNode',{id:`${selection.className}:${selection.primaryKey}`,class:selection.className},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey,credentials.headers),retries:1});
  const result=JSON.parse(response.text);
  if(!result.success)throw new HttpError(403,'Object context unavailable','OBJECT_CONTEXT_UNAVAILABLE');
  const record=result.data?.data??{};
  return {objectType:selection.className,primaryKey:selection.primaryKey,values:Object.fromEntries(fields.map(field=>[field,record[field]??null]))};
}
export async function agentProfileForAgent(owner:ProductOwner,credentials:AssistantCredentials,agentId:string,executionCredentials?:AssistantCredentials){
  return withProductGrants(owner,()=>authorizedProfileForAgent(owner,credentials,agentId,executionCredentials));
}
export interface ProfileSessionSource { profileId:string; releaseId?:string; contextObjects?:{className:string;primaryKey:string}[] }
export async function profileSourceForSession(owner:ProductOwner,sessionId:string,agentId:string):Promise<ProfileSessionSource|null>{
  const result=await getPostgresPool().query(`SELECT profile_id,release_id,context_objects FROM ${t('product_profile_sessions')} WHERE domain_id=$1 AND session_id=$2`,[owner.domainId,sessionId]);
  if(result.rows[0])return {profileId:result.rows[0].profile_id,releaseId:result.rows[0].release_id,contextObjects:result.rows[0].context_objects??[]};
  if(await nativeProfileId(owner.domainId,agentId))return null;
  const id=await profileIdForAgent(owner,agentId);
  return id===null?null:{profileId:id};
}
export async function profileForSession(owner:ProductOwner,credentials:AssistantCredentials,sessionId:string,agentId:string,executionCredentials?:AssistantCredentials,suppliedSource?:ProfileSessionSource|null){
  const source=suppliedSource===undefined?await profileSourceForSession(owner,sessionId,agentId):suppliedSource;
  if(source===null)return null;
  if(!source.releaseId)return withProductGrants(owner,()=>authorizedProfileForAgent(owner,credentials,agentId,executionCredentials,source.profileId));
  const {profileId:id,releaseId}=source;
  await requireProductUse(owner,id);
  const snapshot=await readProductRelease(owner,releaseId,id);
  const profile=snapshotAsset(snapshot,id);
  if(profile.document.kind!=='agent-profile'||profile.document.agentId!==agentId)throw new HttpError(409,'Profile agent changed','AGENT_PROFILE_AGENT_CHANGED');
  executionCredentials ??= await credentialsForDefinition(owner,agentId,credentials);
  const issues=await productReleaseIssues(owner,snapshot,executionCredentials);
  const assembled=await assembleAgentProfile(owner,credentials,id,snapshot.assets,issues,executionCredentials);
  const objectContext=[];
  for(const selection of source.contextObjects??[])if(assembled.contextViews.some(view=>view.objectType===selection.className))objectContext.push(await readProfileObjectContext(owner,assembled,executionCredentials,selection));
  return {...assembled,releaseId,objectContext};
}
async function authorizedProfileForAgent(owner:ProductOwner,credentials:AssistantCredentials,agentId:string,executionCredentials?:AssistantCredentials,knownId?:string){
  const id=knownId??await profileIdForAgent(owner,agentId);
  if(id===null)return null;
  const {snapshot,releaseId}=await readActiveProductBundle(owner,id);
  const profile=snapshotAsset(snapshot,id);
  if(profile.document.kind!=='agent-profile'||profile.document.agentId!==agentId)throw new HttpError(409,'Published Profile references another agent','AGENT_PROFILE_AGENT_CHANGED');
  executionCredentials ??= await credentialsForDefinition(owner,agentId,credentials);
  const issues=await productReleaseIssues(owner,snapshot,executionCredentials);
  return {...await assembleAgentProfile(owner,credentials,id,snapshot.assets,issues,executionCredentials),releaseId};
}
/** Directory projection needs the execution surface, without assembling instructions or tools. */
export async function profileIdForAgent(owner:ProductOwner,agentId:string):Promise<string|null>{
 return withProductGrants(owner,async()=>{
  const access=currentProductGrants(owner);
  const result=await getPostgresPool().query(`SELECT asset.id FROM ${t('product_bundle_heads')} head JOIN ${t('product_releases')} release ON release.domain_id=head.domain_id AND release.release_id=head.release_id JOIN ${t('product_assets')} asset ON asset.domain_id=head.domain_id AND asset.id=head.bundle_id WHERE head.domain_id=$1 AND asset.id=ANY($3::text[]) AND EXISTS(SELECT 1 FROM jsonb_array_elements(release.snapshot->'assets') frozen WHERE frozen->>'id'=head.bundle_id AND frozen->'document'->>'kind'='agent-profile' AND frozen->'document'->>'agentId'=$2) ORDER BY asset.id LIMIT 2`,[owner.domainId,agentId,[...access.use]]);
  if(result.rows.length>1)throw new HttpError(409,'Agent has multiple active Profiles; select one explicitly','AGENT_PROFILE_AMBIGUOUS');
  return result.rows[0]?.id??null;
 });
}
export async function executeProfileTool(owner:ProductOwner,credentials:AssistantCredentials,profileId:string,assetId:string,parameters:Record<string,unknown>,releaseId?:string,sessionId?:string,executionCredentials?:AssistantCredentials){
  await requireProductUse(owner,profileId);
  const snapshot=releaseId?await readProductRelease(owner,releaseId,profileId):(await readActiveProductBundle(owner,profileId)).snapshot;
  const profile=snapshotAsset(snapshot,profileId);
  if(profile.document.kind!=='agent-profile'||!profile.document.tools.includes(assetId))throw new HttpError(403,'Tool is outside this Profile release','PROFILE_TOOL_UNAVAILABLE');
  const tool=snapshotAsset(snapshot,assetId);
  credentials=executionCredentials ?? await credentialsForDefinition(owner,profile.document.agentId,credentials);
  const issues=await productReleaseIssues(owner,snapshot,credentials);
  if(issues.some(issue=>issue.assetId===assetId))throw new HttpError(409,'Tool capability contract changed; explicitly upgrade the Profile release','PRODUCT_CONTRACT_CHANGED');
  const executionOwner={...owner,userId:credentials.executionUserId??owner.userId};
  let pageState:Record<string,unknown>={};
  if(sessionId){
    if(!releaseId)throw new HttpError(400,'Session-bound tools require a pinned release','PROFILE_CONTEXT_REQUIRED');
    const session=await getPostgresPool().query(`SELECT binding.page_state FROM ${t('product_profile_sessions')} binding JOIN ${t('assistant_sessions')} session ON session.id=binding.session_id::uuid AND session.domain_id=binding.domain_id WHERE binding.domain_id=$1 AND binding.session_id=$2 AND binding.profile_id=$3 AND binding.release_id=$4 AND session.owner_id=$5`,[owner.domainId,sessionId,profileId,releaseId,owner.userId]);
    if(!session.rows[0])throw new HttpError(403,'Profile tool session is outside this release or owner','PROFILE_CONTEXT_REQUIRED');
    pageState=session.rows[0].page_state??{};
  }
  const boundParameters=()=>{
    if(!('parameters' in tool.document))return {};
    const bound=resolveViewParameters(tool.document.parameters,{},pageState);
    if(Object.values(bound).some(value=>value===undefined))throw new HttpError(409,'Tool requires a bound typed Page context','PROFILE_CONTEXT_REQUIRED');
    return bound;
  };
  if(tool.document.kind==='collection-view'){
    const definition=await readDefinition(owner,tool.document.renders.id);
    if(definition.objectType.startsWith('platform:'))await requireProductUse(executionOwner,definition.objectType);
    const result=await executeDefinition(executionOwner,credentials,tool.document.renders.id,{...boundParameters(),...parameters},tool.document.fields,0);
    return {...result,page:{offset:0,pageSize:50,hasMore:result.rows.length===50}};
  }
  if(tool.document.kind==='metric-widget'){
    const client=new DashboardMetricClient(owner.domainId,credentials);
    const definition=await client.describe(tool.document.renders.id);
    const defaults=Object.fromEntries(definition.parameterDefs.filter(parameter=>Object.hasOwn(parameter,'value')&&parameter.value!==null).map(parameter=>[String(parameter.name),parameter.value]));
    return client.execute({kind:'metric',metricId:tool.document.renders.id,parameters:runtimeJsonObjectSchema.parse({...defaults,...boundParameters(),...parameters})},definition.revision);
  }
  if(tool.document.kind==='action-view'){
    const bound=boundParameters();
    for(const name of tool.document.readOnlyParameters)if(Object.hasOwn(parameters,name)&&JSON.stringify(parameters[name])!==JSON.stringify(bound[name]))throw new HttpError(400,'Read-only Action parameter cannot be overridden','INVALID_PRODUCT_PARAMETER');
    const formResponse=await backendPost('profile-action-parse',config.dataQuery.baseUrl+'/action/form',{id:tool.document.renders.id,parameters:bound,values:Object.fromEntries(Object.entries(parameters).map(([name,value])=>[name,typeof value==='string'?value:JSON.stringify(value)])),readOnlyParameters:tool.document.readOnlyParameters},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey,credentials.headers),retries:1});
    const form=JSON.parse(formResponse.text);
    if(!form.success||!form.data?.parameters||Array.isArray(form.data.fields)&&Object.keys(parameters).some(name=>!form.data.fields.some((field:{key:string})=>field.key===name)))throw new HttpError(400,'Action tool parameters failed signature validation','INVALID_PRODUCT_PARAMETER');
    const values=form.data.parameters;
    const body=new FormData();body.set('id',tool.document.renders.id);body.set('param',JSON.stringify(values));
    const response=await backendPost('profile-action-execute',config.dataQuery.baseUrl+'/action/execute',body,{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey,credentials.headers),retries:1});
    const result=JSON.parse(response.text);
    if(!result.success)throw new HttpError(400,result.message??'Action execution failed','PROFILE_ACTION_FAILED');
    return result.data;
  }
  throw new HttpError(400,'Unsupported Profile tool projection','INVALID_AGENT_PROFILE');
}
