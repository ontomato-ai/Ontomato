import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {productSubscriptionTargetSchema,type ProductSubscriptionTarget,type ProductSubscriptionEvent,type PanelDefinitionSnapshot,type ProductDefinitionTarget,type ProductDefinitionRevision,type ProductDefinitionStreamFrame} from '@ontomato/contracts/product-subscriptions';
import type {ProductOwner} from '../product-governance/grants';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {executeDefinition} from '../business-definitions/definitions';
import {HttpError} from '../../utils/errors';
import {readDefinitionTrigger} from '../business-definitions/triggers';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {productDefinitionChangedEventSchema,type ProductDefinitionChangedEvent} from '@ontomato/contracts/product-panels';
import {findCurrentProduct,type CurrentProductKind} from '../../infrastructure/product-current';
import {panelManifestSchema} from '@ontomato/contracts/panel-manifest';
import {requireProductGrant} from '../product-governance/grants';

type Subscription={id:string;owner:ProductOwner;credentials:AssistantCredentials;target:ProductSubscriptionTarget;expiresAt:number;fingerprint?:string;members?:Set<string>;events:ProductSubscriptionEvent[];busy:boolean;evaluation?:Promise<void>};
const subscriptions=new Map<string,Subscription>();
type AuthorStream = {
  owner: ProductOwner;
  targets: readonly ProductDefinitionTarget[];
  send: (frame: ProductDefinitionStreamFrame) => void;
};
const authorStreams = new Set<AuthorStream>();

function assertSubscriptionCapacity(owner:ProductOwner){
  const owned=({owner:other}:{owner:ProductOwner})=>other.domainId===owner.domainId&&other.userId===owner.userId;
  if([...subscriptions.values(),...authorStreams].filter(owned).length>=10)
    throw new HttpError(429,'Too many active subscriptions','SUBSCRIPTION_LIMIT');
}

export async function authorizeDefinitionStream(
  owner: ProductOwner, credentials: AssistantCredentials, requested: readonly ProductDefinitionTarget[],
) {
  const targets = [...new Map(requested.map(target => [`${target.kind}:${target.id}`, target])).values()];
  await Promise.all(targets.map(({ kind, id }) => requireDefinition(owner, credentials, kind, id)));
  return {
    attach(send: AuthorStream['send']) {
      assertSubscriptionCapacity(owner);
      const stream = { owner, targets, send };
      authorStreams.add(stream);
      return () => authorStreams.delete(stream);
    },
    snapshot: () => Promise.all(targets.map(target => definitionRevision(owner.domainId, target))),
  };
}
let timer:ReturnType<typeof setInterval>|undefined;
const intervalMs=10_000;
const persistedState=z.object({fingerprint:z.string().optional(),members:z.array(z.string()).max(10000),events:z.array(z.union([productDefinitionChangedEventSchema,z.object({kind:z.enum(['changed','entered','left']),targetId:z.string(),revision:z.string(),observedAt:z.string(),memberKeys:z.array(z.string()).optional()})])).max(20)});
const resuming=new Map<string,Promise<unknown>>();
async function checkpoint(subscription:Subscription){
  if(subscriptions.get(subscription.id)!==subscription)return;
  await getPostgresPool().query(`INSERT INTO ${t('product_subscriptions')} (domain_id,principal_id,id,target,expires_at,state) VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb) ON CONFLICT(domain_id,principal_id,id) DO UPDATE SET expires_at=EXCLUDED.expires_at,state=EXCLUDED.state`,[subscription.owner.domainId,subscription.owner.userId,subscription.id,JSON.stringify(subscription.target),new Date(subscription.expiresAt),JSON.stringify({fingerprint:subscription.fingerprint,members:[...subscription.members??[]],events:subscription.events})]);
}
function evaluate(subscription:Subscription):Promise<void>{
  if(subscription.evaluation)return subscription.evaluation;
  const evaluation=evaluateOnce(subscription);
  const settled=evaluation.finally(()=>{if(subscription.evaluation===settled)subscription.evaluation=undefined;});
  subscription.evaluation=settled;
  return settled;
}
async function evaluateOnce(subscription:Subscription){
  subscription.busy=true;
  try{
    if(subscription.target.kind==='product-definition'){
      const {kind,id}=subscription.target.target;
      await requireDefinition(subscription.owner,subscription.credentials,kind,id);
      await checkpoint(subscription);
      return;
    }
    const hash=createHash('sha256');
    const trigger=subscription.target.kind==='trigger'?await readDefinitionTrigger(subscription.owner,subscription.target.id):null;
    const definitionId=trigger?.definitionId??subscription.target.id;
    const fields=subscription.target.kind==='definition'?subscription.target.fields:[trigger!.keyField];
    const members=new Set<string>();
    for(let offset=0;;offset+=50){
      if(offset>10_000)throw new HttpError(422,'Subscription exceeds the supported collection size','SUBSCRIPTION_COLLECTION_LIMIT');
      const result=await executeDefinition(subscription.owner,subscription.credentials,definitionId,subscription.target.parameters,fields,offset);
      if(trigger)for(const row of result.rows){const value=row[trigger.keyField];if(value===null||value===undefined)throw new HttpError(409,'Trigger member key unavailable','TRIGGER_KEY_UNAVAILABLE');members.add(String(value));}
      if(offset===10_000&&result.rows.length)throw new HttpError(422,'Subscription exceeds the supported collection size','SUBSCRIPTION_COLLECTION_LIMIT');
      hash.update(JSON.stringify(result));
      if(result.rows.length<50)break;
    }
    const fingerprint=trigger?createHash('sha256').update(JSON.stringify([...members].sort())).digest('hex'):hash.digest('hex');
    if(subscription.fingerprint&&subscription.fingerprint!==fingerprint){
      const keys=trigger?.event==='entered'?[...members].filter(key=>!subscription.members?.has(key)):trigger?.event==='left'?[...subscription.members??[]].filter(key=>!members.has(key)):undefined;
      if(!keys||keys.length)subscription.events.push({kind:trigger?.event??'changed',targetId:subscription.target.id,revision:fingerprint,observedAt:new Date().toISOString(),...(keys?{memberKeys:keys}: {})});
      subscription.events=subscription.events.slice(-20);
    }
    if(subscriptions.get(subscription.id)!==subscription)return;
    subscription.fingerprint=fingerprint;
    subscription.members=members;
    await checkpoint(subscription);
  }finally{subscription.busy=false;}
}
export async function requirePanelDefinitions(owner:ProductOwner,credentials:AssistantCredentials,panelId:string):Promise<PanelDefinitionSnapshot>{
  const panel=await requireDefinition(owner,credentials,'panel',panelId);
  const {slots}=panelManifestSchema.parse(panel.definition.manifest);
  const projectionIds=new Set(Object.values(slots).map(slot=>slot.projectionId));
  const projections=[];
  for(const id of projectionIds){
    const projection=await requireDefinition(owner,credentials,'projection',id);
    projections.push({id,revision:projection.revision});
  }
  return {panel:{id:panelId,revision:panel.revision},projections};
}
async function requireDefinition(owner:ProductOwner,credentials:AssistantCredentials,kind:CurrentProductKind,id:string){
  await requireProductGrant(id,'use',credentials);
  return currentDefinition(owner.domainId,kind,id);
}
async function currentDefinition(domainId:string,kind:CurrentProductKind,id:string){
  const record=await findCurrentProduct(domainId,kind,id);
  if(!record)throw new HttpError(404,'Current product definition not found','PRODUCT_UNAVAILABLE');
  return record;
}
async function definitionRevision(domainId:string,target:ProductDefinitionTarget):Promise<ProductDefinitionRevision>{
  const {revision}=await currentDefinition(domainId,target.kind,target.id);
  return {...target,revision};
}
function ensureScheduler(){
  if(timer)return;
  timer=setInterval(()=>{
    for(const [id,subscription] of subscriptions){
      if(subscription.expiresAt<=Date.now()){subscriptions.delete(id);void removeCheckpoint(subscription).catch(()=>{});continue;}
      if(subscription.target.kind!=='product-definition')void evaluate(subscription).catch(()=>{subscriptions.delete(id);void removeCheckpoint(subscription).catch(()=>{});});
    }
    if(!subscriptions.size&&timer){clearInterval(timer);timer=undefined;}
  },intervalMs);
  timer.unref();
}
export async function subscribeProduct(owner:ProductOwner,credentials:AssistantCredentials,target:ProductSubscriptionTarget){
  assertSubscriptionCapacity(owner);
  const id=randomUUID(),subscription:Subscription={id,owner,credentials,target,expiresAt:Date.now()+60_000,events:[],busy:false};
  subscriptions.set(id,subscription);
  try{await getPostgresPool().query(`DELETE FROM ${t('product_subscriptions')} WHERE expires_at<=now()`);await evaluate(subscription);}catch(error){subscriptions.delete(id);await removeCheckpoint(subscription);throw error;}
  ensureScheduler();
  return {id,intervalMs,expiresAt:new Date(subscription.expiresAt).toISOString()};
}
function owned(owner:ProductOwner,id:string){
  const subscription=subscriptions.get(id);
  if(!subscription||subscription.expiresAt<=Date.now()||subscription.owner.domainId!==owner.domainId||subscription.owner.userId!==owner.userId)throw new HttpError(404,'Subscription unavailable','SUBSCRIPTION_UNAVAILABLE');
  return subscription;
}
export function pollProductSubscription(owner:ProductOwner,id:string,credentials?:AssistantCredentials){
  const subscription=owned(owner,id);subscription.expiresAt=Date.now()+60_000;
  if(credentials)subscription.credentials=credentials;
  return {events:subscription.events.splice(0),expiresAt:new Date(subscription.expiresAt).toISOString()};
}
export function unsubscribeProduct(owner:ProductOwner,id:string){owned(owner,id);subscriptions.delete(id);}

/** An author's stream follows only the explicitly authorized collection. */
export async function notifyProductDefinitionChanged(event:ProductDefinitionChangedEvent){
  const {domainId,target}=event;
  const matches=({kind,id}:ProductDefinitionTarget)=>kind===target.kind&&id===target.id;
  const follows=(stream:AuthorStream)=>stream.owner.domainId===domainId&&stream.targets.some(matches);
  if([...authorStreams].some(follows)){
    const definition=await definitionRevision(domainId,target);
    for(const stream of authorStreams)
      if(follows(stream))stream.send({kind:'definition-changed',definition});
  }
  if(target.kind!=='projection')return;
  const db=getPostgresPool();
  const active=[...subscriptions.values()].filter(({owner,expiresAt,target})=>
    owner.domainId===domainId&&expiresAt>Date.now()&&target.kind==='product-definition'&&matches(target.target));
  for(const subscription of active){subscription.events.push(event);subscription.events=subscription.events.slice(-20);}
  await db.query(`UPDATE ${t('product_subscriptions')} SET state=jsonb_set(state,'{events}',
    (SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements((state->'events')||$2::jsonb) WITH ORDINALITY AS queued(value,ordinal)
      WHERE ordinal>jsonb_array_length((state->'events')||$2::jsonb)-20))
    WHERE domain_id=$1 AND target->>'kind'='product-definition' AND target->'target'=$3::jsonb
      AND expires_at>now() AND NOT(id=ANY($4::text[]))`,[event.domainId,JSON.stringify([event]),JSON.stringify(target),active.map(subscription=>subscription.id)]);
  await Promise.all(active.map(checkpoint));
}
async function removeCheckpoint(subscription:Subscription){await getPostgresPool().query(`DELETE FROM ${t('product_subscriptions')} WHERE domain_id=$1 AND principal_id=$2 AND id=$3`,[subscription.owner.domainId,subscription.owner.userId,subscription.id]);}
/** Rebind credentials on reconnect; persisted state contains no user tokens. */
export async function resumeProductSubscription(owner:ProductOwner,id:string,credentials:AssistantCredentials){
  const key=JSON.stringify([owner.domainId,owner.userId,id]);
  const pending=resuming.get(key);if(pending){await pending;return resumeProductSubscription(owner,id,credentials);}
  const restoring=restoreProductSubscription(owner,id,credentials);resuming.set(key,restoring);
  try{return await restoring;}finally{if(resuming.get(key)===restoring)resuming.delete(key);}
}
async function restoreProductSubscription(owner:ProductOwner,id:string,credentials:AssistantCredentials){
  const existing=subscriptions.get(id);
  if(existing&&(existing.owner.domainId!==owner.domainId||existing.owner.userId!==owner.userId))throw new HttpError(404,'Subscription unavailable','SUBSCRIPTION_UNAVAILABLE');
  if(existing&&existing.expiresAt<=Date.now()){subscriptions.delete(id);await removeCheckpoint(existing);throw new HttpError(404,'Subscription unavailable','SUBSCRIPTION_UNAVAILABLE');}
  if(!subscriptions.has(id)){
    const result=await getPostgresPool().query(`SELECT target,state,expires_at FROM ${t('product_subscriptions')} WHERE domain_id=$1 AND principal_id=$2 AND id=$3 AND expires_at>now()`,[owner.domainId,owner.userId,id]);
    const row=result.rows[0];if(!row)throw new HttpError(404,'Subscription unavailable','SUBSCRIPTION_UNAVAILABLE');
    assertSubscriptionCapacity(owner);
    const state=persistedState.parse(row.state);
    const subscription:Subscription={id,owner,credentials,target:productSubscriptionTargetSchema.parse(row.target),expiresAt:Date.now()+60_000,fingerprint:state.fingerprint,members:new Set(state.members),events:state.events,busy:false};
    subscriptions.set(id,subscription);
    ensureScheduler();
  }
  const subscription=owned(owner,id);
  if(subscription.evaluation)try{await subscription.evaluation;}catch(error){subscriptions.delete(id);await removeCheckpoint(subscription);throw error;}
  owned(owner,id);
  subscription.credentials=credentials;
  subscription.expiresAt=Date.now()+60_000;
  try{await evaluate(subscription);}catch(error){subscriptions.delete(id);await removeCheckpoint(subscription);throw error;}
  const result=pollProductSubscription(owner,id,credentials);
  try{await checkpoint(subscription);}catch(error){subscription.events.unshift(...result.events);throw error;}
  return result;
}
export async function deleteProductSubscription(owner:ProductOwner,id:string){
  const subscription=subscriptions.get(id);
  if(subscription){owned(owner,id);subscriptions.delete(id);await removeCheckpoint(subscription);return;}
  await getPostgresPool().query(`DELETE FROM ${t('product_subscriptions')} WHERE domain_id=$1 AND principal_id=$2 AND id=$3`,[owner.domainId,owner.userId,id]);
}
