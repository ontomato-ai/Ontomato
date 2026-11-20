import type {PanelDefinitionSnapshot,PanelMemberSnapshot,ProductDefinitionTarget,ProductDefinitionRevision,ProductDefinitionStreamFrame} from '@ontomato/contracts/product-subscriptions';
import {productPanelSchema,type ProductDefinitionChangedEvent} from '@ontomato/contracts/product-panels';
import type {ProductOwner} from '../product-governance/grants';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {HttpError} from '../../utils/errors';
import {currentProductRecord,findCurrentProduct,type CurrentProductKind} from '../../infrastructure/product-current';
import {getPostgresPool,qualifiedTable as t} from '../../infrastructure/postgres';
import {requireProductGrant} from '../product-governance/grants';
import {resolvePanelMemberPath} from './member-path';
import {checkpoint,subscriptions} from './subscription-state';

type AuthorStream = {
  owner: ProductOwner;
  targets: readonly ProductDefinitionTarget[];
  send: (frame: ProductDefinitionStreamFrame) => void;
  close: () => void;
};
const authorStreams = new Set<AuthorStream>();

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
  const row = await requireDefinition(owner, credentials, 'panel', panelId);
  const panel = productPanelSchema.parse(currentProductRecord(row, false));
  const fixedMembers = Object.entries(panel.manifest.members).filter(([, { target }]) =>
    'projectionId' in target || 'panelId' in target);
  const members = await Promise.all(fixedMembers.map(async ([member]): Promise<PanelMemberSnapshot> => {
    const memberPath = [{ member }] as [{ member: string }];
    try {
      const resolved = await resolvePanelMemberPath(owner, credentials, panel, memberPath);
      const { id, revision } = resolved.kind === 'projection' ? resolved.projection : resolved.panel;
      return { status: 'ready', memberPath, target: { kind: resolved.kind, id }, revision };
    } catch (error) {
      if (error instanceof HttpError && error.status === 403) return { status: 'forbidden', memberPath };
      throw error;
    }
  }));
  const projections = new Map<string, { id: string; revision: number }>();
  for (const member of members) {
    if (member.status === 'ready' && member.target.kind === 'projection')
      projections.set(member.target.id, { id: member.target.id, revision: member.revision });
  }
  return { panel: { id: panelId, revision: panel.revision }, members, projections: [...projections.values()] };
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
