import {definitionTriggerSchema} from '@ontomato/contracts/product-subscriptions';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {readDefinition} from './definitions';
import {assertAppBuilderAccess} from '../app-builder/access';
import {HttpError} from '../../utils/errors';
import type {ProductOwner} from './store';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {backendPost,buildBackendHeaders} from '../../utils/backend-client';
import {config} from '../../config/application';

export async function readDefinitionTrigger(owner:ProductOwner,id:string){
  const result=await getPostgresPool().query(`SELECT definition FROM ${t('definition_triggers')} WHERE domain_id=$1 AND id=$2 AND status='PUBLISHED'`,[owner.domainId,id]);
  if(!result.rows[0])throw new HttpError(404,'Published Trigger unavailable','TRIGGER_UNAVAILABLE');
  return definitionTriggerSchema.parse(result.rows[0].definition);
}
export async function saveDefinitionTrigger(owner:ProductOwner,credentials:AssistantCredentials,value:unknown,expectedRevision:number){
  await assertAppBuilderAccess(credentials);
  const trigger=definitionTriggerSchema.parse(value);const definition=await readDefinition(owner,trigger.definitionId);
  const response=await backendPost('trigger-key-schema',config.dataQuery.baseUrl+'/ontology/query/schema',{classNames:[definition.objectType]},{headers:buildBackendHeaders(credentials.token,undefined,credentials.locale,credentials.apiKey),retries:1});
  const object=JSON.parse(response.text).classes?.find((item:{className:string})=>item.className===definition.objectType);
  if(!object?.attrs?.some((attribute:{name:string;primaryKey?:boolean})=>attribute.name===trigger.keyField&&attribute.primaryKey===true))throw new HttpError(400,'Trigger membership key must be the ObjectType primary key','INVALID_TRIGGER_KEY');
  if(trigger.revision!==expectedRevision+1)throw new HttpError(409,'Trigger revision conflict','TRIGGER_CONFLICT');
  const result=expectedRevision===0
    ?await getPostgresPool().query(`INSERT INTO ${t('definition_triggers')} (domain_id,id,status,definition) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING id`,[owner.domainId,trigger.id,trigger.status,JSON.stringify(trigger)])
    :await getPostgresPool().query(`UPDATE ${t('definition_triggers')} SET status=$3,definition=$4::jsonb WHERE domain_id=$1 AND id=$2 AND status<>'PUBLISHED' AND (definition->>'revision')::int=$5 RETURNING id`,[owner.domainId,trigger.id,trigger.status,JSON.stringify(trigger),expectedRevision]);
  if(!result.rows.length)throw new HttpError(409,'Published Trigger is immutable or its revision changed','TRIGGER_CONFLICT');
  return trigger;
}
