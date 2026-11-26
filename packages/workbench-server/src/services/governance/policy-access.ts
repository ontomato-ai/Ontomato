import { z } from "zod";
import { runtimeJsonValueSchema, type RuntimeJsonObject, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { entryDependencySchema, entryRootsSchema } from "@ontomato/contracts/entry-dependencies";
import { panelRecordSchema, type PanelRecord, type PanelRecordFieldValue } from "@ontomato/contracts/panel-projection";
import { isDomainComponentId } from "@ontomato/contracts/product-record-id";
import { config } from "../../config/application";
import { getPostgresPool } from "../../infrastructure/postgres";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendPost } from "../../utils/backend-client";
import { productDefinitionOwnerHeaders } from "../product-governance/grants";
import { readPanelDependencies } from "../product-panels/entry-dependency-store";
import { listObjectDetailPanelMappings } from "../product-panels/object-detail";
import { loadPolicyWorkbenchCatalog, readPolicyWorkbenchObjects, type PolicyWorkbenchCatalog } from "./policy-catalog";

const id = z.string().min(1);
const scope = entryDependencySchema.shape.scope.unwrap();
const itemKeySchema = z.object({ kind: id, id: z.string(), verb: id });
const policyGrantSchema = itemKeySchema.extend({ policyId: id, scope: scope.nullable() });
const acceptedObjectSchema = itemKeySchema.extend({ scope: scope.nullish() }).strict();

const actionTargetSchema = z.object({
  actionId: id,
  className: id,
  objectId: id,
  fields: z.record(z.string(), runtimeJsonValueSchema).optional(),
}).strict();

export const previewPolicyEntryGrantInputSchema = z.object({
  entryIds: z.array(id),
}).strict();
export const grantPolicyEntriesInputSchema = z.object({
  entryIds: z.array(id),
  acceptedObjects: z.array(acceptedObjectSchema),
}).strict();
export const grantPolicyEntriesResultSchema = z.object({
  policyId: id,
  grantedEntryCount: z.number().int().nonnegative(),
  grantedObjectCount: z.number().int().nonnegative(),
});
export const revokePolicyEntriesInputSchema = grantPolicyEntriesInputSchema;
export const revokePolicyEntriesResultSchema = z.object({
  policyId: id,
  revokedEntryCount: z.number().int().nonnegative(),
  revokedObjectCount: z.number().int().nonnegative(),
});
export const resolvePendingPolicyGrantsInputSchema = z.object({
  resolutions: z.array(z.object({ id: z.number().int().positive(), confirm: z.boolean(), scope: scope.nullish() }).strict()),
}).strict();
export const resolvePendingPolicyGrantsResultSchema = z.object({
  policyId: id,
  resolvedCount: z.number().int().nonnegative(),
});
export const inspectPolicyAccessInputSchema = z.object({
  subjectId: id,
  entryId: id,
  actionTargets: z.array(actionTargetSchema).optional(),
}).strict();
export const memberAccessContextInputSchema = z.object({
  inspectingPolicyId: id.optional(),
}).strict();
export const inspectMemberAccessInputSchema = z.object({
  entryId: id,
  actionTargets: z.array(actionTargetSchema).optional(),
}).strict();
export const grantMemberAccessInputSchema = z.object({
  policyId: id,
  entryIds: z.array(id),
  acceptedObjects: z.array(acceptedObjectSchema),
}).strict();

const publishedActionSchema = z.object({
  id, name: z.string(), targetClass: z.string().nullish(), targetKeyField: z.string().nullish(),
});
const workflowStepSchema = z.object({
  actionId: id, workflowId: id, workflowName: z.string(), version: z.number().int(),
  stepNo: z.number().int(), stepName: z.string().nullish(),
});
const entryRootsResultSchema = z.object({
  policyId: id.nullish(),
  entries: z.array(entryRootsSchema.extend({
    entryId: id, appId: id, useId: id, label: z.string(), entryEntitlement: z.boolean(),
  })),
  existingGrants: z.array(policyGrantSchema),
  targetPolicyRoleIds: z.array(id),
  publishedActions: z.array(publishedActionSchema),
  workflowStepActions: z.array(workflowStepSchema),
});
const pendingListResultSchema = z.object({
  policyId: id,
  canManage: z.boolean(),
  targetPolicyRoleIds: z.array(id),
  items: z.array(z.object({
    id: z.number().int(), source: z.string(), changeKey: z.string(), actorId: z.string(), entryId: z.string().nullable(),
    kind: id, targetId: z.string(), verb: id, scope: scope.nullable(),
  })),
});

const inspectedItemSchema = itemKeySchema.extend({
  allowed: z.boolean(),
  code: z.string().nullish(),
  reason: z.string().nullish(),
  sources: z.array(z.object({
    type: z.enum(["policy", "ownership", "distribution", "workflow_step"]),
    policyId: id.nullish(),
    roleIds: z.array(id).optional(),
    ownerId: id.nullish(),
    rule: z.string().nullish(),
    scope: scope.nullish(),
    workflowId: id.nullish(),
    workflowName: z.string().nullish(),
    version: z.number().int().nullish(),
    stepNo: z.number().int().nullish(),
  })),
  effectiveScopes: z.array(scope).optional(),
  targetDecisions: z.array(z.object({
    actionId: id.nullish(), className: id, objectId: id, allowed: z.boolean(),
    code: z.string().nullish(), reason: z.string().nullish(),
  })).optional(),
});
const inspectResultSchema = z.object({
  subjectId: id,
  entryId: id,
  targetPolicyId: id.nullish(),
  targetPolicyRoleIds: z.array(id),
  subjectRoleIds: z.array(id),
  entry: inspectedItemSchema,
  items: z.array(inspectedItemSchema),
});

const graphFactsSchema = z.object({
  rolePolicies: z.array(z.object({ roleId: id, policyId: id, kind: z.enum(["MANAGEMENT", "OBJECT"]) })),
  domainPolicyId: id,
  entries: z.array(z.object({ id, applicationId: id, names: z.record(z.string()), pageKey: id })),
  policyGrants: z.array(z.object({ policyId: id, targetKind: id, targetKey: z.string(), verb: id, scope: scope.nullish() })),
});
export type AuthorizationGraphFacts = z.infer<typeof graphFactsSchema>;

async function policyPost<T>(viewer: AssistantCredentials, endpoint: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await backendPost(
    `policy-authorization-${endpoint}`, `${config.dataQuery.baseUrl}/authorization/policies/${endpoint}`,
    body, { headers: productDefinitionOwnerHeaders(viewer), retries: 1 },
  );
  return schema.parse(JSON.parse(response.text));
}

export function readAuthorizationGraphFacts(viewer: AssistantCredentials): Promise<AuthorizationGraphFacts> {
  return policyPost(viewer, "graph-facts", {}, graphFactsSchema);
}

type ItemKey = z.infer<typeof itemKeySchema>;
type EntryRootsResult = z.infer<typeof entryRootsResultSchema>;
type WorkflowStep = z.infer<typeof workflowStepSchema>;
type WorkbenchObjects = Awaited<ReturnType<typeof readPolicyWorkbenchObjects>>;
type InspectionInput = z.infer<typeof inspectPolicyAccessInputSchema>;

const objectDetailPrefix = "object-detail:";
const itemKey = ({ kind, id, verb }: ItemKey) => JSON.stringify([kind, id, verb]);
const executeAction = ({ kind, verb }: ItemKey) => kind === "ACTION" && verb === "EXECUTE";

async function entryContext(viewer: AssistantCredentials, domainId: string, policyId: string | undefined, entryIds: string[]) {
  const roots = await policyPost(viewer, "entry-roots", { policyId, entryIds }, entryRootsResultSchema);
  const client = getPostgresPool();
  const selected = new Set(entryIds);
  const detailIds = new Set(entryIds.filter(id => id.startsWith(objectDetailPrefix)));
  const details = detailIds.size ? await listObjectDetailPanelMappings(domainId, client) : [];
  const detailPanels = new Map(details
    .map(({ className, panelId }) => [objectDetailPrefix + className, panelId] as const)
    .filter(([entryId]) => detailIds.has(entryId)));
  const entries = roots.entries.filter(entry => selected.has(entry.entryId)).map(entry => {
    const panelId = detailPanels.get(entry.entryId);
    return panelId ? { ...entry, panelIds: [...new Set([...entry.panelIds, panelId])] } : entry;
  });
  const entryPanels = new Map(entries.map(entry => [entry.entryId, new Set(entry.panelIds)] as const));
  const seenEntries = new Set(entries.map(entry => entry.entryId));
  for (const [entryId, panelId] of detailPanels) {
    if (seenEntries.has(entryId)) continue;
    const className = entryId.slice(objectDetailPrefix.length);
    entries.push({
      entryId, appId: "object-detail", useId: className, label: className,
      panelIds: [panelId], agentIds: [], entryEntitlement: false,
    });
  }

  const panelIds = [...new Set([...entries.flatMap(entry => entry.panelIds), ...detailPanels.values()])];
  const dependencies = await readPanelDependencies(client, domainId, panelIds);
  const direct = new Map<string, ItemKey>();
  const entryObjects = new Map<string, Map<string, ItemKey>>();
  const add = (item: ItemKey, owners: string[] = []) => {
    direct.set(itemKey(item), item);
    for (const entryId of owners) entryObjects.get(entryId)?.set(itemKey(item), item);
  };
  for (const entry of entries) {
    entryObjects.set(entry.entryId, new Map());
    for (const id of entry.agentIds) add({ kind: "AGENT", id, verb: "USE" }, [entry.entryId]);
  }
  for (const panelId of panelIds) {
    const owners = entries.filter(entry => entryPanels.get(entry.entryId)?.has(panelId)).map(entry => entry.entryId);
    add({ kind: "PANEL", id: panelId, verb: "USE" }, owners);
    for (const { objectType, objectKey, verb } of dependencies.get(panelId) ?? []) {
      add({ kind: objectType, id: objectKey, verb }, owners);
    }
  }

  const workflows = new Set([...direct.values()].filter(item => item.kind === "WORKFLOW").map(item => item.id));
  const steps = new Map<string, WorkflowStep[]>();
  for (const step of roots.workflowStepActions) {
    if (!workflows.has(step.workflowId)) continue;
    const key = itemKey({ kind: "ACTION", id: step.actionId, verb: "EXECUTE" });
    const previous = steps.get(key) ?? [];
    previous.push(step);
    steps.set(key, previous);
  }
  const items = new Map(direct);
  for (const [key, [step]] of steps) items.set(key, { kind: "ACTION", id: step.actionId, verb: "EXECUTE" });
  return { ...roots, entries, items, direct, steps, entryObjects };
}

function labelFor(catalog: PolicyWorkbenchCatalog, actions: EntryRootsResult["publishedActions"] = []) {
  const byId = (options: { id: string; label: string }[]) => new Map(options.map(option => [option.id, option.label]));
  const labels: Partial<Record<string, Map<string, string>>> = {
    PANEL: byId(catalog.panels), PROJECTION: byId(catalog.projections), COMPONENT: byId(catalog.components),
    AGENT: byId(catalog.agents), ACTION: byId(actions.map(({ id, name }) => ({ id, label: name }))),
  };
  return (kind: string, id: string) => labels[kind]?.get(id) ?? id;
}

function fixedProduct({ kind, id }: ItemKey, { fixedProductIds }: WorkbenchObjects) {
  return (kind === "PANEL" || kind === "PROJECTION") && fixedProductIds[kind].has(id);
}

function fixedByDistribution(item: ItemKey, objects: WorkbenchObjects) {
  return fixedProduct(item, objects)
    || (item.kind === "COMPONENT" && !isDomainComponentId(item.id))
    || (item.kind === "AGENT" && (item.id.startsWith("preset:") || objects.presetAgentIds.has(item.id)));
}

function policyRecord(id: string, fields: Record<string, RuntimeJsonValue | undefined>): PanelRecord {
  const recordFields: Record<string, PanelRecordFieldValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value == null) continue;
    recordFields[key] = typeof value === "object" ? { kind: "json", value } : value;
  }
  return panelRecordSchema.parse({ primaryKey: id, label: id, fields: recordFields });
}

export async function previewEntryGrantPayload(
  viewer: AssistantCredentials, domainId: string, policyId: string, entryIds: string[],
): Promise<RuntimeJsonObject> {
  const context = await entryContext(viewer, domainId, policyId, entryIds);
  const objects = await readPolicyWorkbenchObjects(domainId, viewer.locale, true);
  const label = labelFor(objects.catalog, context.publishedActions);
  const actions = new Map(context.publishedActions.map(action => [action.id, action]));
  const grants = new Map<string, EntryRootsResult["existingGrants"]>();
  for (const grant of context.existingGrants) {
    const key = itemKey(grant);
    const existing = grants.get(key) ?? [];
    existing.push(grant);
    grants.set(key, existing);
  }
  const candidates = [...context.items].map(([key, item]) => {
    const existing = grants.get(key) ?? [];
    const alreadyGranted = existing.length > 0;
    const fixed = fixedByDistribution(item, objects);
    const workflowSteps = context.steps.get(key);
    const grantable = !fixed && context.direct.has(key);
    const action = executeAction(item) ? actions.get(item.id) : undefined;
    return {
      ...item, label: label(item.kind, item.id), grantable, alreadyGranted,
      defaultSelected: grantable && !alreadyGranted,
      ...(fixed ? { fixedByDistribution: true, distributionRule: "builtin_asset" } : {}),
      ...(workflowSteps ? { workflowAuthorized: true, workflowSteps } : {}),
      ...(executeAction(item) ? { existingScopes: existing.flatMap(grant => grant.scope ? [grant.scope] : []) } : {}),
      ...(grantable && executeAction(item) ? {
        requiresScope: true, targetClass: action?.targetClass ?? null, targetKeyField: action?.targetKeyField ?? null,
      } : {}),
    };
  });
  return {
    policyId, entries: context.entries, candidates, existingGrants: context.existingGrants,
    entryObjects: Object.fromEntries([...context.entryObjects].map(([entryId, objects]) => [entryId, [...objects.values()]])),
    targetPolicyRoleIds: context.targetPolicyRoleIds, publishedActions: context.publishedActions,
    summary: {
      entryCount: context.entries.length,
      candidateCount: candidates.length,
      grantableCount: candidates.filter(candidate => candidate.grantable).length,
      defaultSelectedCount: candidates.filter(candidate => candidate.defaultSelected).length,
    },
  };
}

export async function previewEntryGrant(viewer: AssistantCredentials, domainId: string, policyId: string, entryIds: string[]) {
  return policyRecord(policyId, await previewEntryGrantPayload(viewer, domainId, policyId, entryIds));
}

export function grantPolicyEntries(viewer: AssistantCredentials, policyId: string, input: unknown) {
  return policyPost(viewer, "entries:grant", {
    policyId: id.parse(policyId), ...grantPolicyEntriesInputSchema.parse(input),
  }, grantPolicyEntriesResultSchema);
}

export function revokePolicyEntries(viewer: AssistantCredentials, policyId: string, input: unknown) {
  return policyPost(viewer, "entries:revoke", {
    policyId: id.parse(policyId), ...revokePolicyEntriesInputSchema.parse(input),
  }, revokePolicyEntriesResultSchema);
}

export async function listPendingPolicyGrantsPayload(
  viewer: AssistantCredentials, domainId: string, policyId: string,
): Promise<RuntimeJsonObject> {
  const result = await policyPost(viewer, "pending:list", { policyId }, pendingListResultSchema);
  const label = labelFor(await loadPolicyWorkbenchCatalog(domainId, viewer.locale));
  return {
    ...result, items: result.items.map(item => ({ ...item, label: label(item.kind, item.targetId) })),
  };
}

export async function listPendingPolicyGrants(viewer: AssistantCredentials, domainId: string, policyId: string) {
  return policyRecord(policyId, await listPendingPolicyGrantsPayload(viewer, domainId, policyId));
}

export function resolvePendingPolicyGrants(viewer: AssistantCredentials, policyId: string, input: unknown) {
  return policyPost(viewer, "pending:resolve", {
    policyId: id.parse(policyId), ...resolvePendingPolicyGrantsInputSchema.parse(input),
  }, resolvePendingPolicyGrantsResultSchema);
}

function ownerIdFor(item: ItemKey, { ownerIds }: WorkbenchObjects) {
  switch (item.kind) {
    case "PANEL": case "PROJECTION": case "COMPONENT": case "AGENT":
      return ownerIds[item.kind].get(item.id);
  }
}

export async function inspectPolicyAccessPayload(
  viewer: AssistantCredentials, domainId: string, targetPolicyId: string | null | undefined,
  { subjectId, entryId, actionTargets }: InspectionInput,
): Promise<RuntimeJsonObject> {
  const context = await entryContext(viewer, domainId, targetPolicyId ?? undefined, [entryId]);
  const objects = await readPolicyWorkbenchObjects(domainId, viewer.locale, true);
  const result = await policyPost(viewer, "access:inspect", {
    subjectId, entryId, targetPolicyId, optionalActionTargets: actionTargets,
    items: [...context.items.values()].map(item => {
      if (fixedProduct(item, objects)) return { ...item, fixedProduct: true };
      const ownerId = ownerIdFor(item, objects);
      return ownerId ? { ...item, ownerFacts: { ownerId, state: "PUBLISHED" } } : item;
    }),
  }, inspectResultSchema);

  const label = labelFor(objects.catalog, context.publishedActions);
  const actions = new Map(context.publishedActions.map(action => [action.id, action]));
  const items = result.items.map(item => ({ ...item, label: label(item.kind, item.id) }));
  const missingGrantableItems = items.filter(item =>
    !item.allowed && context.direct.has(itemKey(item)) && !fixedByDistribution(item, objects)
      && !item.sources.some(source => source.type === "distribution"),
  ).map(({ kind, id, verb, label }) => {
    const action = actions.get(id);
    return { kind, id, verb, label, ...(executeAction({ kind, id, verb }) ? {
      requiresScope: true, targetClass: action?.targetClass ?? null, targetKeyField: action?.targetKeyField ?? null,
    } : {}) };
  });
  return {
    ...result, targetPolicyId: result.targetPolicyId ?? targetPolicyId ?? null,
    entry: { ...result.entry, label: context.entries.find(entry => entry.entryId === entryId)?.label ?? entryId },
    items, missingGrantableItems,
  };
}

export async function inspectPolicyAccess(
  viewer: AssistantCredentials, domainId: string, targetPolicyId: string | null | undefined,
  input: InspectionInput,
) {
  return policyRecord(input.entryId, await inspectPolicyAccessPayload(viewer, domainId, targetPolicyId, input));
}

/** Every entry the domain publishes, as the policy entry directory lists them. */
export async function listPolicyEntries(viewer: AssistantCredentials) {
  const roots = await policyPost(viewer, "entry-roots", { entryIds: [] }, entryRootsResultSchema);
  return roots.entries.map(({ entryId, appId, label, entryEntitlement }) => ({ entryId, appId, label, entryEntitlement }));
}

/**
 * Whether this viewer may change permission policies. The owner answers that question beside the pending grants of a
 * policy, so one policy ID is enough to ask it; the answer is the same management decision for every policy in the domain.
 */
export async function readPolicyChangePermission(viewer: AssistantCredentials, policyId: string): Promise<boolean> {
  const { canManage } = await policyPost(viewer, "pending:list", { policyId }, pendingListResultSchema);
  return canManage;
}
