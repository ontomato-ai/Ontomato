import {businessDefinitionSchema,definitionCondition} from '@ontomato/contracts/business-definitions';
import {qualifiedTable as t,getPostgresPool as db} from '../../infrastructure/postgres';
import {HttpError} from '../../utils/errors';
import {backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import type {ProductOwner} from './store';
import {assertAppBuilderAccess} from '../app-builder/access';
import {platformObjectProvider,readPlatformObjects,withPlatformProjectionPreferences} from './platform-objects';
import {personalWorkspaceSchema} from '@ontomato/contracts/personal-workspace';

export async function readDefinition(owner:ProductOwner,id:string){
  const result=await db().query(`SELECT definition FROM ${t('business_definitions')} WHERE domain_id=$1 AND id=$2 AND status='PUBLISHED'`,[owner.domainId,id]);
  if(!result.rows[0])throw new HttpError(404,'Published Definition unavailable','DEFINITION_UNAVAILABLE');
  return businessDefinitionSchema.parse(result.rows[0].definition);
}
export async function saveDefinition(owner:ProductOwner,credentials:AssistantCredentials,value:unknown,expectedRevision:number){
  await assertAppBuilderAccess(credentials);
  const definition=businessDefinitionSchema.parse(value);
  const previous=await db().query(`SELECT status FROM ${t('business_definitions')} WHERE domain_id=$1 AND id=$2`,[owner.domainId,definition.id]);
  if(previous.rows[0]?.status==='PUBLISHED')throw new HttpError(409,'Published Definitions are immutable; create a new version identity','DEFINITION_PUBLISHED_IMMUTABLE');
  if(definition.revision!==expectedRevision+1)throw new HttpError(409,'Definition revision must advance once','DEFINITION_CONFLICT');
  const classes=definition.objectType.startsWith('platform:')?[{className:definition.objectType,attrs:Object.keys(platformObjectProvider(definition.objectType).fields).map(name=>({name}))}]:JSON.parse((await backendPost('definition-schema',config.dataQuery.baseUrl+'/ontology/query/schema',{classNames:[definition.objectType]}, {headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey,credentials.headers),retries:1})).text).classes;
  if(definition.objectType.startsWith('platform:')&&(definition.predicate||definition.parameters.length))throw new HttpError(400,'Platform Definitions use the provider signature without inline predicates','INVALID_DEFINITION');
  const object=Array.isArray(classes)?classes.find((item:{className:string})=>item.className===definition.objectType):null;
  if(!object||definition.predicate&&!object.attrs?.some((attribute:{name:string})=>attribute.name===definition.predicate!.field))throw new HttpError(400,'Definition references an unavailable object type or attribute','INVALID_DEFINITION');
  if(definition.predicate?.parameter&&!definition.parameters.some(parameter=>parameter.name===definition.predicate!.parameter))throw new HttpError(400,'Unknown predicate parameter','INVALID_DEFINITION');
  const result=expectedRevision===0
    ? await db().query(`INSERT INTO ${t('business_definitions')} (domain_id,id,status,definition) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING id`,[owner.domainId,definition.id,definition.status,JSON.stringify(definition)])
    : await db().query(`UPDATE ${t('business_definitions')} SET status=$3,definition=$4::jsonb WHERE domain_id=$1 AND id=$2 AND status<>'PUBLISHED' AND (definition->>'revision')::int=$5 RETURNING id`,[owner.domainId,definition.id,definition.status,JSON.stringify(definition),expectedRevision]);
  if(!result.rows.length)throw new HttpError(409,'Definition changed; reload first','DEFINITION_CONFLICT');
  return definition;
}
export async function executeDefinition(owner:ProductOwner,credentials:AssistantCredentials,id:string,parameters:Record<string,unknown>,fields:string[],offset:number,projectionId?:string){
  const definition=await readDefinition(owner,id);
  let condition:ReturnType<typeof definitionCondition>;
  try{condition=definitionCondition(definition,parameters);}catch(reason){throw new HttpError(400,reason instanceof Error?reason.message:'Invalid Definition parameters','INVALID_DEFINITION_PARAMETER');}
  if(!fields.length)throw new HttpError(400,'Select collection output fields','INVALID_PRODUCT_FIELD');
  if(definition.objectType.startsWith('platform:')){
    let preferences;
    if(projectionId){
      const {getProduct}=await import('./store');const projection=await getProduct(owner,projectionId);
      if(projection.document.kind!=='collection-view'||projection.document.renders.id!==id)throw new HttpError(400,'Projection Definition mismatch','INVALID_PRODUCT_TARGET');
      const overlay=await db().query(`SELECT preferences FROM ${t('product_user_overlays')} WHERE domain_id=$1 AND principal_id=$2 AND page_id=$3`,[owner.domainId,owner.userId,projectionId]);
      if(overlay.rows[0])preferences=personalWorkspaceSchema.parse(overlay.rows[0].preferences);
    }
    return withPlatformProjectionPreferences(preferences,async()=>({definitionId:id,revision:definition.revision,objectType:definition.objectType,rows:(await readPlatformObjects(owner,credentials,definition.objectType,parameters,[...new Set(['id',...fields])])).slice(offset,offset+50)}));
  }
  const schemaResponse=await backendPost('definition-query-schema',config.dataQuery.baseUrl+'/ontology/query/schema',{classNames:[definition.objectType]},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey,credentials.headers),retries:1});
  const schema=JSON.parse(schemaResponse.text);
  const object=schema.classes?.find((item:{className:string})=>item.className===definition.objectType);
  const primaryKey=object?.attrs?.find((attribute:{primaryKey?:boolean})=>attribute.primaryKey===true)?.name;
  if(!primaryKey)throw new HttpError(409,'Definition object type requires an accessible primary key','DEFINITION_SCHEMA_CHANGED');
  const visibleFields=new Set(object.attrs.map((attribute:{name:string})=>attribute.name));
  if(fields.some(field=>!visibleFields.has(field)))throw new HttpError(400,'Collection output references an unavailable attribute','INVALID_PRODUCT_FIELD');
  const response=await backendPost('definition-query',config.dataQuery.baseUrl+'/ontology/query/execute-dsl',{dsl:{answer:{steps:[{graph:{pattern_logic:'and',patterns:[{objects:[{idx:0,variable:'member',class:definition.objectType,...(condition?{conditions:{properties:condition}}:{})}],relationship:[]}]},output:{to_user:true,fields:fields.map(field=>({variable:'member',field,as:field})),sort:{fields:[{variable:'member',field:primaryKey,order:'asc'}]},limit:{count:50,offset}}}]}}},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey,credentials.headers),retries:1});
  const result=JSON.parse(response.text);if(result.success===false||result.error)throw new HttpError(400,result.message??'Definition query failed','DEFINITION_QUERY_FAILED');
  const rows=result.data?.[0]?.answer;
  if(result.truncated===true||result.data?.[0]?.truncated===true)throw new HttpError(422,'Definition query returned an incomplete result','DEFINITION_INCOMPLETE');
  if(!Array.isArray(rows))throw new HttpError(502,'Definition service returned an invalid row result','INVALID_DEFINITION_RESPONSE');
  return {definitionId:id,revision:definition.revision,objectType:definition.objectType,rows};
}
