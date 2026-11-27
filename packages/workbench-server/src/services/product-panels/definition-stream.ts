import type {PanelDefinitionSnapshot,PanelMemberSnapshot,ProductDefinitionTarget,ProductDefinitionRevision,ProductDefinitionStreamFrame} from '@ontomato/contracts/product-subscriptions';
import {productPanelSchema,type ProductDefinitionChangedEvent,type ProductPanel} from '@ontomato/contracts/product-panels';
import {candidateProjectionIds} from '@ontomato/contracts/panel-manifest';
import type {ProductOwner} from '../product-governance/service-authentication';
import type {AssistantCredentials} from '../../platform/agent-runtime/runtime';
import {HttpError} from '../../utils/errors';
import {currentProductRecord,findCurrentProduct,type CurrentProductKind} from '../../infrastructure/product-current';
import {requireCurrentDefinitionUse} from './access';
import {resolvePanelMemberPath} from './member-path';
import {readCurrentProjectionRecords} from './current';

type AuthorStream = {
  owner: ProductOwner;
  targets: readonly ProductDefinitionTarget[];
  send: (frame: ProductDefinitionStreamFrame) => void;
  close: () => void;
};
const authorStreams = new Set<AuthorStream>();

function assertSubscriptionCapacity(owner:ProductOwner){
  const owned=({owner:other}:{owner:ProductOwner})=>other.domainId===owner.domainId&&other.userId===owner.userId;
  if([...authorStreams].filter(owned).length>=10)
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
export async function requirePanelDefinitions(
  owner: ProductOwner, credentials: AssistantCredentials, panelId: string,
): Promise<PanelDefinitionSnapshot> {
  const row = await requireDefinition(owner, credentials, 'panel', panelId);
  const panel = productPanelSchema.parse(currentProductRecord(row, false));
  return snapshotPanelDefinitions(owner, credentials, panel);
}

export async function snapshotPanelDefinitions(
  owner: ProductOwner, credentials: AssistantCredentials, panel: ProductPanel,
): Promise<PanelDefinitionSnapshot> {
  const root = { id: panel.id, revision: panel.revision };
  const fixedMembers = Object.entries(panel.manifest.members).filter(([, { target }]) =>
    'projectionId' in target || 'panelId' in target);
  const candidates = Object.values(panel.manifest.members).flatMap(({ target }) => candidateProjectionIds(target));
  const [members, candidateRecords] = await Promise.all([
    Promise.all(fixedMembers.map(async ([member]): Promise<PanelMemberSnapshot> => {
      const memberPath = [{ member }] as [{ member: string }];
      try {
        const resolved = await resolvePanelMemberPath(owner, credentials, panel, memberPath);
        const { id, revision } = resolved.kind === 'projection' ? resolved.projection : resolved.panel;
        return { status: 'ready', memberPath, target: { kind: resolved.kind, id }, revision };
      } catch (error) {
        if (error instanceof HttpError && error.status === 403) return { status: 'forbidden', memberPath };
        throw error;
      }
    })),
    candidates.length ? readCurrentProjectionRecords(owner, credentials, candidates) : new Map(),
  ]);
  const projections = new Map<string, { id: string; revision: number }>();
  for (const member of members) {
    if (member.status === 'ready' && member.target.kind === 'projection')
      projections.set(member.target.id, { id: member.target.id, revision: member.revision });
  }
  const unavailableProjections: NonNullable<PanelDefinitionSnapshot['unavailableProjections']> = {};
  for (const [id, item] of candidateRecords) {
    if (item.ok) projections.set(id, { id, revision: item.projection.revision });
    else if (item.error instanceof HttpError && (item.error.status === 403 || item.error.status === 404)) {
      unavailableProjections[id] = {
        status: 'unavailable', httpStatus: item.error.status, message: item.error.message,
      };
    } else throw item.error;
  }
  return { panel: root, members, projections: [...projections.values()], ...(Object.keys(unavailableProjections).length && { unavailableProjections }) };
}
export async function requireDefinition(owner:ProductOwner,credentials:AssistantCredentials,kind:CurrentProductKind,id:string){
  const row=await currentDefinition(owner.domainId,kind,id);
  await requireCurrentDefinitionUse(kind,row,owner.domainId,credentials);
  return row;
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
  const follows=(stream:AuthorStream)=>observes(stream,domainId,target);
  if([...authorStreams].some(follows)){
    const definition=await definitionRevision(domainId,target);
    for(const stream of authorStreams)
      if(follows(stream))stream.send({kind:'definition-changed',definition});
  }
}
