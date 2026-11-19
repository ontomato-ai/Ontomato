import {z} from 'zod';
import type {PanelDefinitionSnapshot,ProductDefinitionTarget,ProductDefinitionRevision,ProductDefinitionStreamFrame} from '@ontomato/contracts/product-subscriptions';
import type {ProductDefinitionChangedEvent} from '@ontomato/contracts/product-panels';
import type {ProductOwner} from '../product-governance/grants';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {HttpError} from '../../utils/errors';
import {findCurrentProduct,type CurrentProductKind} from '../../infrastructure/product-current';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {directPanelManifestSchema,panelManifestSchema} from '@ontomato/contracts/panel-manifest';
import {requireProductGrant} from '../product-governance/grants';
import {checkpoint,subscriptions} from './subscription-state';

type AuthorStream = {
  owner: ProductOwner;
  targets: readonly ProductDefinitionTarget[];
  send: (frame: ProductDefinitionStreamFrame) => void;
  close: () => void;
};
const authorStreams = new Set<AuthorStream>();
const definitionManifestSchema = z.union([panelManifestSchema, directPanelManifestSchema]);

export function assertSubscriptionCapacity(owner:ProductOwner){
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
    attach(send: AuthorStream['send'], close: AuthorStream['close']) {
      assertSubscriptionCapacity(owner);
      const stream = { owner, targets, send, close };
      authorStreams.add(stream);
      return () => authorStreams.delete(stream);
    },
    snapshot: () => Promise.all(targets.map(target => definitionRevision(owner.domainId, target))),
  };
}
export async function requirePanelDefinitions(owner:ProductOwner,credentials:AssistantCredentials,panelId:string):Promise<PanelDefinitionSnapshot>{
  const panel=await requireDefinition(owner,credentials,'panel',panelId);
  const manifest=definitionManifestSchema.parse(panel.definition.manifest);
  const projectionIds=new Set('members' in manifest
    ? Object.values(manifest.members).map(member=>member.target.projectionId)
    : Object.values(manifest.slots).map(slot=>slot.projectionId));
  const projections=[];
  for(const id of projectionIds){
    const projection=await requireDefinition(owner,credentials,'projection',id);
    projections.push({id,revision:projection.revision});
  }
  return {panel:{id:panelId,revision:panel.revision},projections};
}
export async function requireDefinition(owner:ProductOwner,credentials:AssistantCredentials,kind:CurrentProductKind,id:string){
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

function observes(stream: AuthorStream, domainId: string, target: ProductDefinitionTarget) {
  return stream.owner.domainId === domainId && stream.targets.some(({kind, id}) => kind === target.kind && id === target.id);
}

/** Reconnecting a closed collection uses the existing unavailable-definition response. */
export function closeDeletedDefinitionStreams(domainId: string, target: ProductDefinitionTarget) {
  for (const stream of authorStreams) {
    if (!observes(stream, domainId, target)) continue;
    authorStreams.delete(stream);
    stream.close();
  }
}

/** An author's stream follows only the explicitly authorized collection. */
export async function notifyProductDefinitionChanged(event:ProductDefinitionChangedEvent){
  const {domainId,target}=event;
  const matches=({kind,id}:ProductDefinitionTarget)=>kind===target.kind&&id===target.id;
  const follows=(stream:AuthorStream)=>observes(stream,domainId,target);
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
