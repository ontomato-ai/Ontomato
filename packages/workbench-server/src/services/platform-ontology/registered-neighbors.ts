import { platformOntologyNeighborsRequestSchema, type PlatformOntologyNeighborsRequest, type PlatformOntologyNodeRef } from "@ontomato/contracts/platform-ontology";
import type { PlatformRelationKindDeclaration } from "@ontomato/contracts/platform-object-types";
import { z } from "zod";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { assistantStore } from "../assistant/store";
import { graphPolicyGrantSchema } from "../governance/policy-access";
import { definitionVisibleInRange } from "../product-panels/access";
import type { JavaPanelReadResult, JavaPanelViewer } from "../product-panels/java-panel-reads";
import {
  knowledgeDirectorySchema, workflowDirectorySchema, workflowStepFactsSchema,
  normalizeOntologySubjectId, ontologyApplicationName, orgGrantInstanceDirectorySchema, parseOntologyMeta,
  PlatformOntologyOwnerReaders, readOntologyOwnerFact, readOntologyRoleNameFacts, readOntologyVisibilityFact,
  type OntologyReadFact, type OwnerReadResult, type ProjectionBindingSource, type RawDefinition, type RawProductPanel, type RawProductProjection,
} from "./owners";
import { presentOntologyNeighborDisplay } from "./panel-reads";
import {
  assemblePlatformOntologyNeighbors, evaluateAgentExecutionUser, evaluateDefinitionObjectType, evaluatePanelContainment,
  evaluatePolicyActionGrants, evaluatePolicyDataPermissions, evaluatePolicyEntryGrants, evaluatePolicyObjectGrants, evaluateProjectionBindings,
  evaluateProjectionComponent, evaluateWorkflowStepOwnership,
  isModelInstanceType, isPanelContainmentKind, modelInstanceObjects, modelRelationEdges, neighborCandidate, ontologyAgentDefinitionObject,
  ontologyDefinitionObjects, organizationGrantObject, parseAttributeKey, planPlatformOntologyInstanceDirectory, selectPlatformOntologyRelations,
  policyCreateKindsSchema, policyCreationDetail, policyObjectTargetKinds, sdkComponentObjects,
  PROVENANCE_NAME_LIMIT, summarizeUserProvenance, userOntologyObject, withDomainSharedDetail, workflowOntologyObject, type ModelInstanceType, type OwnerObjectsResult, type RelationEvalResult,
} from "./query";
import {
  ACTION, AGENT_DEFINITION, APPLICATION, ATTRIBUTE, BUSINESS_KNOWLEDGE, DEFINITION, FUNCTION, METRIC_VIEW,
  OBJECT_TYPE, ONTOLOGY_TYPE, ORG_GRANT, ORG_POSITION, ORG_UNIT, PERMISSION_POLICY, PLATFORM_ONTOLOGY_RELATION_KINDS,
  PRODUCT_PANEL, PRODUCT_PROJECTION, ROLE, SDK_COMPONENT, SKILL, TRIGGER, USER, WORKFLOW,
} from "./schema";

const id = z.string().min(1);
const nameSchema = z.object({ id, name: z.string().nullish(), loginCode: z.string().nullish(), detail: z.string().nullish() });
const governanceLinks = z.object({
  links: z.array(z.object({ fromId: id, toId: id })),
  fromNames: z.array(nameSchema),
  toNames: z.array(nameSchema),
});
const organizationGrantLinks = governanceLinks.omit({ fromNames: true }).extend({ grants: orgGrantInstanceDirectorySchema });
const governanceCenter = z.object({ names: z.array(nameSchema), emptyDirectory: z.boolean() });
const provenanceNames = z.object({ names: z.array(z.string()), total: z.number().int().nonnegative() });
const userProvenance = z.record(z.object({ created: provenanceNames, reviewed: provenanceNames }));
const userProvenanceSources = [ACTION, WORKFLOW, METRIC_VIEW] as const;
const subjectsCount = z.object({ total: z.number().int().nonnegative() });
const orgGrantRoleNames = ["orgGrantRoleDirectoryNames", "orgGrantWorkflowRoleNames"] as const;
const workflowStepRelation = "role.owns-workflow-step";
const workflowActionRelation = "workflow.step-references-action";
const workflowActionLinks = governanceLinks.pick({ links: true }).extend({ workflows: workflowDirectorySchema });
const policyDataRelation = "permission-policy.governs-object-type";
const policyDataObjectTypeNamesRead = "policyDataObjectTypeNames";
const policyEntryRelation = "permission-policy.can-enter-application";
const entryApplicationNamesRead = "entryGrantApplicationNames";
const entryPolicyNamesRead = "entryGrantPolicyNames";
const policyActionRelation = "permission-policy.can-execute-action";
const policyObjectRelation = "permission-policy.can-use-object";
const objectGrantPoliciesRead = "objectGrantPolicies";
const objectGrantPoliciesSchema = z.object({ names: nameSchema.array(), createKinds: policyCreateKindsSchema });
const policyObjectSharedRead = "policyObjectSharedUses";
const policyObjectSharedSchema = z.object({ PANEL: id.array().optional(), AGENT: id.array().optional() });
const policyObjectJavaNames = [
  [FUNCTION, "policyObjectFunctionNames"], [METRIC_VIEW, "policyObjectMetricNames"],
  [WORKFLOW, "policyObjectWorkflowNames"], [TRIGGER, "policyObjectTriggerNames"],
] as const;
const triggerTargetKinds = {
  "trigger.targets-workflow": "workflow",
  "trigger.targets-action": "action",
} as const;
const triggerRows = z.array(z.intersection(z.object({ id, title: z.string() }), z.discriminatedUnion("targetKind", [
  z.object({ targetKind: z.literal("workflow"), targetId: id }),
  z.object({ targetKind: z.literal("action"), targetId: id }),
  z.object({ targetKind: z.literal("application"), targetId: z.null() }),
])));
const triggerTargetNames = z.array(z.object({ className: z.enum([WORKFLOW, ACTION]), names: z.array(nameSchema) }));
const applicationLinks = z.array(z.object({ id, names: z.record(z.string()), kind: z.string(), panelIds: z.array(id) }));
const entryApplicationNames = z.object({ applications: applicationLinks, shared: z.array(id) });
const modelFacts = z.object({
  classDef: z.array(z.unknown()),
  relationDef: z.union([z.array(z.unknown()), z.record(z.unknown())]),
}).transform(parseOntologyMeta);
const modelNeighborFacts = z.object({
  center: z.unknown(),
  relations: z.unknown().transform(value => z.record(z.unknown()).safeParse(value)),
});
type Name = z.infer<typeof nameSchema>;

function failed(reason: string) { return { ok: false as const, status: "failed" as const, reason }; }

function ownerFact<T>(reply: JavaPanelReadResult | undefined, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fact: string): OwnerReadResult<T> {
  if (reply?.status === "forbidden") return { ok: false, status: "refused", reason: reply.error };
  if (reply?.status === "error") return failed(reply.error);
  if (reply?.status !== "ready") return failed(`Missing ontology fact: ${fact}`);
  const parsed = schema.safeParse(reply.payload);
  return parsed.success ? { ok: true, data: parsed.data } : failed(parsed.error.message);
}

function modelSection(payload: unknown, name: string) {
  return readOntologyOwnerFact(payload === undefined ? undefined : { status: "ready", payload }, modelFacts, name);
}

function relationFailure(fact: { status: "refused" | "failed" | "unavailable"; reason: string }): RelationEvalResult {
  return { status: fact.status, reason: fact.reason, edges: [] };
}

function namedObject(className: string, row: Name) {
  const login = row.loginCode?.trim();
  const detail = row.detail?.trim() ?? login;
  return {
    node: { className, primaryKey: row.id },
    label: row.name?.trim() || login || row.id,
    ...(detail && { detail }),
  };
}

function isOrganizationMemberRelation(id: string) {
  return id === "user.member-of-org-unit" || id === "user.holds-org-position";
}

function isOrganizationGrantRelation(id: string) {
  return id === "org-grant.applies-to-org-unit" || id === "org-grant.applies-to-org-position" || id === "org-grant.grants-role";
}

function isFunctionDependencyRelation(id: string) {
  return id === "action.uses-function" || id === "metric-view.uses-function";
}

function isObjectTypeDependencyRelation(id: string) {
  return id === "function.reads-object-type" || id === "action.targets-object-type";
}

function isTriggerTargetRelation(id: string): id is keyof typeof triggerTargetKinds {
  return Object.hasOwn(triggerTargetKinds, id);
}

function ownerReadsScopedRelation({ id, owner, from }: PlatformRelationKindDeclaration) {
  return owner === "java-identity" || owner === "java-application-catalog"
    || (owner === "java-permission-policy" && from === ROLE)
    || id === "org-unit.has-child" || id === "org-unit.has-position"
    || isOrganizationMemberRelation(id) || isOrganizationGrantRelation(id)
    || isFunctionDependencyRelation(id) || isObjectTypeDependencyRelation(id)
    || id === workflowStepRelation || id === workflowActionRelation || id === policyDataRelation || id === policyEntryRelation
    || id === policyActionRelation || id === policyObjectRelation;
}

const bindingLabelTypes = new Set<string>([ACTION, METRIC_VIEW, FUNCTION, TRIGGER, BUSINESS_KNOWLEDGE, WORKFLOW]);

function bindingEndpointFact({ className, primaryKey }: PlatformOntologyNodeRef): OntologyReadFact | undefined {
  if (className === TRIGGER) return { call: { type: ONTOLOGY_TYPE, name: "triggerCenter", parameters: { primaryKey } } };
  if (className === WORKFLOW) return { call: { type: ONTOLOGY_TYPE, name: "workflowCenter", parameters: { primaryKey } } };
  if (className === FUNCTION) return { call: { type: ONTOLOGY_TYPE, name: "functionCenter", parameters: { primaryKey } } };
  if (className === ACTION || className === METRIC_VIEW) return { call: {
    type: ONTOLOGY_TYPE, name: className === ACTION ? "action.uses-function" : "metric-view.uses-function",
    parameters: { className, primaryKey, from: className, to: FUNCTION, direction: "outgoing", includeLinks: false },
  } };
  if (isModelInstanceType(className)) return { call: { type: ONTOLOGY_TYPE, name: "modelNeighbors", parameters: {
    className, primaryKey, relations: [], ...(className === ATTRIBUTE && { attributeKey: parseAttributeKey(primaryKey) }),
  } } };
  if ([USER, ROLE, PERMISSION_POLICY, ORG_UNIT, ORG_POSITION].includes(className))
    return { call: { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: { className, primaryKey } } };
  if (className === ORG_GRANT)
    return { call: { type: ONTOLOGY_TYPE, name: "orgGrantCenter", parameters: { primaryKey } } };
  if (className === APPLICATION) return { call: { type: ONTOLOGY_TYPE, name: "application.uses-panel", parameters: {
    className, primaryKey, from: APPLICATION, to: PRODUCT_PANEL, direction: "outgoing", includeLinks: false,
  } } };
  if (className === BUSINESS_KNOWLEDGE)
    return { call: { type: className, name: "record", parameters: { primaryKey } } };
}

function workflowObjects(reply: JavaPanelReadResult | undefined): OwnerObjectsResult {
  const workflows = ownerFact(reply, workflowDirectorySchema, "workflowCenter");
  return workflows.ok ? { ok: true, data: workflows.data.map(workflowOntologyObject) } : workflows;
}

function dependencyObjects(className: string, reply: JavaPanelReadResult | undefined, objectTypeDependencyKind?: string): OwnerObjectsResult {
  const rows = className === FUNCTION && !objectTypeDependencyKind ? ownerFact(reply, z.array(nameSchema), "functionCenter")
    : ownerFact(reply, governanceLinks.transform(facts => facts.fromNames), objectTypeDependencyKind ?? "function dependency center");
  return rows.ok ? { ok: true, data: rows.data.map(row => namedObject(className, row)) } : rows;
}

function triggerObjects(rows: OwnerReadResult<z.infer<typeof triggerRows>>): OwnerObjectsResult {
  return rows.ok ? { ok: true, data: rows.data.map(row => ({
    node: { className: TRIGGER, primaryKey: row.id }, label: row.title, detail: row.targetKind,
  })) } : rows;
}

function bindingKnowledgeObjects(reply: JavaPanelReadResult | undefined): OwnerObjectsResult {
  if (reply?.status === "empty" || (reply?.status === "error" && reply.code === "KNOWLEDGE_UNAVAILABLE"))
    return { ok: true, data: [] };
  const schema = z.object({ entry: z.record(z.unknown()) }).transform(({ entry }) =>
    knowledgeDirectorySchema.parse({ entries: { entry } }));
  const res = readOntologyOwnerFact(reply, schema, BUSINESS_KNOWLEDGE);
  return res.ok ? { ok: true, data: res.data.map(row => namedObject(BUSINESS_KNOWLEDGE, { id: row.id, name: row.title })) } : res;
}

export async function prepareRegisteredOntologyNeighbors(owner: JavaPanelViewer, credentials: AssistantCredentials, params: Record<string, unknown>) {
  const input = platformOntologyNeighborsRequestSchema.parse(params);
  const applicable = selectPlatformOntologyRelations(input);
  const { className, primaryKey } = input.node;
  const facts: OntologyReadFact[] = [];
  const add = (fact: OntologyReadFact) => facts.push(fact) - 1;
  const center = { ...input.node, ...(className === ATTRIBUTE && { attributeKey: parseAttributeKey(primaryKey) }) };
  const directionOf = (spec: PlatformRelationKindDeclaration) =>
    spec.from === spec.to ? input.direction ?? "both" : className === spec.from ? "outgoing" : "incoming";
  const scopeOf = (spec: PlatformRelationKindDeclaration) => ({
    ...center, from: spec.from, to: spec.to as string, direction: directionOf(spec),
  });
  const policyObject = applicable.some(spec => spec.id === policyObjectRelation);
  const objectTargets = policyObject ? policyObjectTargetKinds(input) : [];
  const objectOutgoing = className === PERMISSION_POLICY;
  const objectScope = (targetKinds: string[]) => ({
    className, primaryKey, targetKinds, direction: objectOutgoing ? "outgoing" : "incoming",
  });
  const objectGrantScope = objectScope(objectTargets.map(([kind]) => kind));
  const relationPositions = new Map(applicable.filter(spec => ownerReadsScopedRelation(spec)
    || (isTriggerTargetRelation(spec.id) && className !== TRIGGER)).map(spec => [spec.id, add({
    call: { type: ONTOLOGY_TYPE, name: spec.id, parameters: spec.id === policyObjectRelation ? objectGrantScope : scopeOf(spec) },
  })]));
  const triggerCenter = className === TRIGGER ? add({
    call: { type: ONTOLOGY_TYPE, name: "triggerCenter", parameters: { primaryKey } },
  }) : undefined;
  const targetKinds = className === TRIGGER
    ? applicable.map(spec => spec.id).filter(isTriggerTargetRelation).map(id => triggerTargetKinds[id]) : [];
  const triggerNames = targetKinds.length ? add({
    call: { type: ONTOLOGY_TYPE, name: "triggerTargetNames", parameters: { primaryKey, targetKinds } },
  }) : undefined;
  const appRelation = PLATFORM_ONTOLOGY_RELATION_KINDS.find(spec => spec.owner === "java-application-catalog")!;
  const appEdges = relationPositions.get(appRelation.id);
  const appCenter = className === APPLICATION ? appEdges ?? add({
    call: { type: ONTOLOGY_TYPE, name: appRelation.id, parameters: { ...scopeOf(appRelation), includeLinks: false } },
  }) : undefined;
  const functionSource = PLATFORM_ONTOLOGY_RELATION_KINDS.find(spec =>
    spec.from === className && isFunctionDependencyRelation(spec.id));
  const objectTypeDependency = applicable.find(spec => spec.from === className && isObjectTypeDependencyRelation(spec.id));
  const dependencyCenter = objectTypeDependency ? relationPositions.get(objectTypeDependency.id) : className === FUNCTION ? add({
    call: { type: ONTOLOGY_TYPE, name: "functionCenter", parameters: { primaryKey } },
  }) : functionSource && (relationPositions.get(functionSource.id) ?? add({
    call: { type: ONTOLOGY_TYPE, name: functionSource.id, parameters: { ...scopeOf(functionSource), includeLinks: false } },
  }));
  const directory = [USER, ROLE, PERMISSION_POLICY, ORG_UNIT, ORG_POSITION].includes(className) ? add({
    call: { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: { className, primaryKey } },
  }) : undefined;
  const policyData = applicable.find(spec => spec.id === policyDataRelation && spec.from === className);
  const policyDataObjectTypeNames = policyData && add({
    call: { type: ONTOLOGY_TYPE, name: policyDataObjectTypeNamesRead, parameters: scopeOf(policyData) },
  });
  const policyEntry = applicable.find(spec => spec.id === policyEntryRelation);
  const entryEndpointNames = policyEntry && add({
    call: { type: ONTOLOGY_TYPE, name: className === PERMISSION_POLICY ? entryApplicationNamesRead : entryPolicyNamesRead,
      parameters: scopeOf(policyEntry) },
  });
  const policyAction = applicable.find(spec => spec.id === policyActionRelation);
  const actionEndpointNames = policyAction && add({
    call: { type: ONTOLOGY_TYPE, name: className === PERMISSION_POLICY ? "policyGrantActionNames" : "actionGrantPolicyNames",
      parameters: scopeOf(policyAction) },
  });
  const objectGrantPolicies = policyObject ? add({
    call: { type: ONTOLOGY_TYPE, name: objectGrantPoliciesRead, parameters: objectGrantScope },
  }) : undefined;
  const objectNames = objectOutgoing ? policyObjectJavaNames.flatMap(([type, name]) => {
    const kinds = objectTargets.filter(([, target]) => target === type).map(([kind]) => kind);
    return kinds.length ? [{ type, name, index: add({
      call: { type: ONTOLOGY_TYPE, name, parameters: objectScope(kinds) },
    }) }] : [];
  }) : [];
  const sharedObjectKinds = objectOutgoing ? objectTargets.map(([kind]) => kind)
    .filter(kind => kind === "PANEL" || kind === "AGENT") : [];
  const objectShared = sharedObjectKinds.length ? add({
    call: { type: ONTOLOGY_TYPE, name: policyObjectSharedRead, parameters: objectScope(sharedObjectKinds) },
  }) : undefined;
  const grantCenter = className === ORG_GRANT ? add({
    call: { type: ONTOLOGY_TYPE, name: "orgGrantCenter", parameters: { primaryKey } },
  }) : undefined;
  const grantRoles = className === ORG_GRANT && applicable.find(spec => spec.id === "org-grant.grants-role");
  const grantRoleNames = grantRoles ? orgGrantRoleNames.map(name => add({
    call: { type: ONTOLOGY_TYPE, name, parameters: scopeOf(grantRoles) },
  })) : undefined;
  const workflowActions = applicable.find(spec => spec.id === workflowActionRelation);
  const workflowCenter = className === WORKFLOW && !workflowActions ? add({
    call: { type: ONTOLOGY_TYPE, name: "workflowCenter", parameters: { primaryKey } },
  }) : undefined;
  const workflowActionNames = className === WORKFLOW && workflowActions ? add({
    call: { type: ONTOLOGY_TYPE, name: "workflowStepActionNames", parameters: scopeOf(workflowActions) },
  }) : undefined;
  const memberRelation = applicable.find(spec => spec.to === className && isOrganizationMemberRelation(spec.id));
  const organizationMemberNames = memberRelation && add({
    call: { type: ONTOLOGY_TYPE, name: "organizationMemberNames", parameters: scopeOf(memberRelation) },
  });
  const definition = className === DEFINITION
    ? await new PlatformOntologyOwnerReaders(owner, credentials).definitions({ id: primaryKey }) : undefined;
  const definitionEdge = definition && applicable.some(spec => spec.id === "definition.based-on-object-type")
    ? evaluateDefinitionObjectType(input.node, definition) : undefined;
  const modelCenter = isModelInstanceType(className) ? center : definitionEdge?.edges[0]?.to;
  const modelNeighbors = modelCenter ? add({
    call: { type: ONTOLOGY_TYPE, name: "modelNeighbors", parameters: {
      ...modelCenter,
      relations: applicable.filter(spec => spec.owner === "java-ontology")
        .map(spec => ({ kind: spec.id, direction: directionOf(spec) })),
    } },
  }) : undefined;
  const dependencyObjectTypeNames = objectTypeDependency && add({
    call: { type: ONTOLOGY_TYPE, name: "dependencyObjectTypeNames", parameters: scopeOf(objectTypeDependency) },
  });
  const hasProjectionBinding = applicable.some(spec => spec.id === "projection.binds-target");
  const bindingSource = className === PRODUCT_PROJECTION && hasProjectionBinding && input.direction !== "incoming"
    ? await new PlatformOntologyOwnerReaders(owner, credentials).projectionBindingSource(primaryKey) : undefined;
  const binding = bindingSource?.ok && bindingSource.data
    ? evaluateProjectionBindings(input.node, { ok: true, data: [bindingSource.data.projection] }).edges
    : [];
  const invitedBindings = binding.flatMap(edge => neighborCandidate(input, edge)?.opposite ?? []);
  const bindingRecord = hasProjectionBinding && className === BUSINESS_KNOWLEDGE
    ? add({ call: { type: className, name: "record", parameters: { primaryKey } } }) : undefined;
  const bindingEndpoints = invitedBindings.flatMap(target => {
    const fact = bindingEndpointFact(target);
    return fact ? [{ target, index: add(fact) }] : [];
  });
  const provenanceIds = className === USER && hasProjectionBinding ? [primaryKey]
    : invitedBindings.filter(target => target.className === USER).map(target => target.primaryKey);
  const provenancePositions = provenanceIds.length ? userProvenanceSources.map(type => add({
    call: { type, name: "userProvenanceByMember", parameters: { memberIds: provenanceIds, limit: PROVENANCE_NAME_LIMIT } },
  })) : [];
  const panelScope = className === PRODUCT_PANEL || appEdges !== undefined || applicable.some(spec => isPanelContainmentKind(spec.id))
    || invitedBindings.some(target => target.className === PRODUCT_PANEL)
    || sharedObjectKinds.includes("PANEL")
    ? add({ visibleKinds: [{ kind: "PANEL", verbs: ["USE"] }] }) : undefined;
  const sharingIds = (type: string) => [
    ...(hasProjectionBinding && className === type ? [primaryKey] : []),
    ...invitedBindings.filter(target => target.className === type).map(target => target.primaryKey),
  ];
  const panelIds = [...new Set([
    ...sharingIds(PRODUCT_PANEL), ...(policyObject && className === PRODUCT_PANEL ? [primaryKey] : []),
  ])];
  const panelSharing = panelIds.length ? add({ call: {
    type: ONTOLOGY_TYPE, name: "domainSharedUse", parameters: {
      kind: "PANEL",
      ...(!applicable.some(spec => spec.id === "panel.contains-panel") && { ids: panelIds }),
    },
  } }) : undefined;
  const appIds = [...new Set([
    ...sharingIds(APPLICATION), ...(policyEntry && className === APPLICATION ? [primaryKey] : []),
  ])];
  const appSharing = appIds.length
    ? add({ call: { type: APPLICATION, name: "ontologyDomainShared", parameters: { ids: appIds } } }) : undefined;
  const projectionScope = className === PRODUCT_PROJECTION || applicable.some(spec =>
    spec.id === "panel.contains-projection" || spec.id === "projection.uses-component" || spec.id === "projection.binds-target")
    || (objectOutgoing && objectTargets.some(([, target]) => target === PRODUCT_PROJECTION))
    ? add({ visibleKinds: [{ kind: "PROJECTION", verbs: ["USE"] }] }) : undefined;

  const executionEdge = applicable.some(spec => spec.id === "agent.executes-as-user");
  const readAgents = className === AGENT_DEFINITION || executionEdge
    || invitedBindings.some(target => target.className === AGENT_DEFINITION);
  const agentScope = readAgents || sharedObjectKinds.includes("AGENT")
    ? add({ visibleKinds: [{ kind: "AGENT", verbs: ["VIEW"] }] }) : undefined;
  const agentSharing = readAgents ? add({
    call: { type: ONTOLOGY_TYPE, name: "domainSharedUse", parameters: {
      kind: "AGENT", ...(policyObject && className === AGENT_DEFINITION && { ids: [primaryKey] }),
    } },
  }) : undefined;
  const executionUserId = className === AGENT_DEFINITION && executionEdge
    ? await assistantStore.agentDefinitionExecutionUserId(owner.domainId, primaryKey) : null;
  const executionMember = executionUserId ? add({
    call: { type: ONTOLOGY_TYPE, name: "governanceCenter", parameters: { className: USER, primaryKey: executionUserId } },
  }) : undefined;
  // The scoped member lookup reports directory emptiness only when it looks up the viewer.
  const executionMemberCount = executionUserId === "admin" && owner.userId === "system" ? add({
    call: { type: ONTOLOGY_TYPE, name: "subjectsCount", parameters: {} },
  }) : undefined;

  return {
    facts,
    present: (viewer: JavaPanelViewer, results: readonly JavaPanelReadResult[]) =>
      presentNeighbors(input, applicable, viewer, credentials, {
        appCenter: appCenter === undefined ? undefined : results[appCenter],
        appEdges: appEdges === undefined ? undefined : results[appEdges],
        dependencyCenter: dependencyCenter === undefined ? undefined : results[dependencyCenter],
        objectTypeDependencyKind: objectTypeDependency?.id,
        directory: directory === undefined ? undefined : results[directory],
        policyDataObjectTypeNames: policyDataObjectTypeNames === undefined ? undefined : results[policyDataObjectTypeNames],
        entryEndpointNames: entryEndpointNames === undefined ? undefined : results[entryEndpointNames],
        actionEndpointNames: actionEndpointNames === undefined ? undefined : results[actionEndpointNames],
        objectGrantPolicies: objectGrantPolicies === undefined ? undefined : results[objectGrantPolicies],
        objectNames: objectNames.map(({ type, name, index }) => ({ type, name, reply: results[index] })),
        objectShared: objectShared === undefined ? undefined : results[objectShared],
        grantCenter: grantCenter === undefined ? undefined : results[grantCenter],
        grantRoleNames: grantRoleNames?.map(index => results[index]),
        triggerCenter: triggerCenter === undefined ? undefined : results[triggerCenter],
        triggerTargetNames: triggerNames === undefined ? undefined : results[triggerNames],
        workflowCenter: workflowCenter === undefined ? undefined : results[workflowCenter],
        workflowActionNames: workflowActionNames === undefined ? undefined : results[workflowActionNames],
        organizationMemberNames: organizationMemberNames === undefined ? undefined : results[organizationMemberNames],
        modelNeighbors: modelNeighbors === undefined ? undefined : results[modelNeighbors],
        dependencyObjectTypeNames: dependencyObjectTypeNames === undefined ? undefined : results[dependencyObjectTypeNames],
        definition,
        definitionEdge,
        hasProjectionBinding,
        bindingSource,
        binding,
        userProvenance: provenancePositions.map(index => results[index]),
        bindingRecord: bindingRecord === undefined ? undefined : results[bindingRecord],
        bindingEndpoints: bindingEndpoints.map(({ target, index }) => ({ target, reply: results[index] })),
        panelSharing: panelSharing === undefined ? undefined : results[panelSharing],
        appSharing: appSharing === undefined ? undefined : results[appSharing],
        panelScope: panelScope === undefined ? undefined : results[panelScope],
        projectionScope: projectionScope === undefined ? undefined : results[projectionScope],
        agentScope: agentScope === undefined ? undefined : results[agentScope],
        agentSharing: agentSharing === undefined ? undefined : results[agentSharing],
        executionUserId,
        executionMember: executionMember === undefined ? undefined : results[executionMember],
        executionMemberCount: executionMemberCount === undefined ? undefined : results[executionMemberCount],
        relations: new Map([...relationPositions].map(([key, index]) => [key, results[index]])),
      }),
  };
}

function projectionObjects(rows: OwnerReadResult<RawProductProjection[]>): OwnerObjectsResult {
  return rows.ok ? { ok: true, data: rows.data.map(row => ({
    node: { className: PRODUCT_PROJECTION, primaryKey: row.id }, label: row.name, detail: row.componentId,
  })) } : rows;
}

async function presentNeighbors(
  input: PlatformOntologyNeighborsRequest, applicable: readonly PlatformRelationKindDeclaration[],
  viewer: JavaPanelViewer, credentials: AssistantCredentials,
  facts: {
    appCenter?: JavaPanelReadResult; appEdges?: JavaPanelReadResult; directory?: JavaPanelReadResult;
    policyDataObjectTypeNames?: JavaPanelReadResult; entryEndpointNames?: JavaPanelReadResult;
    actionEndpointNames?: JavaPanelReadResult;
    objectGrantPolicies?: JavaPanelReadResult; objectShared?: JavaPanelReadResult;
    objectNames: readonly { type: string; name: string; reply: JavaPanelReadResult | undefined }[];
    grantCenter?: JavaPanelReadResult; grantRoleNames?: readonly JavaPanelReadResult[];
    triggerCenter?: JavaPanelReadResult; triggerTargetNames?: JavaPanelReadResult;
    workflowCenter?: JavaPanelReadResult; workflowActionNames?: JavaPanelReadResult;
    organizationMemberNames?: JavaPanelReadResult; modelNeighbors?: JavaPanelReadResult;
    dependencyObjectTypeNames?: JavaPanelReadResult;
    definition?: OwnerReadResult<RawDefinition[]>; definitionEdge?: RelationEvalResult;
    dependencyCenter?: JavaPanelReadResult; objectTypeDependencyKind?: string;
    hasProjectionBinding: boolean; bindingSource?: OwnerReadResult<ProjectionBindingSource | undefined>;
    binding: RelationEvalResult["edges"];
    userProvenance: readonly JavaPanelReadResult[];
    bindingRecord?: JavaPanelReadResult; bindingEndpoints: readonly { target: PlatformOntologyNodeRef; reply: JavaPanelReadResult }[];
    panelSharing?: JavaPanelReadResult; appSharing?: JavaPanelReadResult;
    panelScope?: JavaPanelReadResult; projectionScope?: JavaPanelReadResult;
    agentScope?: JavaPanelReadResult; agentSharing?: JavaPanelReadResult;
    executionUserId: string | null; executionMember?: JavaPanelReadResult; executionMemberCount?: JavaPanelReadResult;
    relations: ReadonlyMap<string, JavaPanelReadResult>;
  },
) {
  const { className, primaryKey } = input.node;
  const model = isModelInstanceType(className) || facts.definitionEdge?.edges.length
    ? readOntologyOwnerFact(facts.modelNeighbors, modelNeighborFacts, "modelNeighbors") : undefined;
  const appRows = facts.appEdges && ownerFact(facts.appEdges, applicationLinks, "application.uses-panel");
  const names = new Map<string, Map<string, Name>>();
  const addNames = (type: string, rows: readonly Name[]) => {
    const current = names.get(type) ?? new Map();
    for (const row of rows) current.set(row.id, row);
    names.set(type, current);
  };
  const readers = new PlatformOntologyOwnerReaders(viewer, credentials);
  const panelRange = readOntologyVisibilityFact(facts.panelScope, "PANEL", "USE");
  const projectionRange = readOntologyVisibilityFact(facts.projectionScope, "PROJECTION", "USE");
  const policyObject = facts.relations.has(policyObjectRelation);
  const objectGrantPolicies = ownerFact(facts.objectGrantPolicies, objectGrantPoliciesSchema, objectGrantPoliciesRead);
  const objectShared = facts.objectShared && ownerFact(facts.objectShared, policyObjectSharedSchema, policyObjectSharedRead);
  const policyName = (row: Name): Name => objectGrantPolicies.ok ? {
    ...row, detail: policyCreationDetail(objectGrantPolicies.data.createKinds, row.id, credentials.locale),
  } : row;
  const sharedPanels = facts.panelSharing && ownerFact(facts.panelSharing, z.array(id), "shared panels");
  const sharedApps = facts.appSharing && ownerFact(facts.appSharing, z.array(id), "shared applications");
  const panelObjects = (rows: OwnerReadResult<RawProductPanel[]>): OwnerObjectsResult => rows.ok ? {
    ok: true, data: rows.data.map(row => ({
      node: { className: PRODUCT_PANEL, primaryKey: row.id }, label: row.name,
      detail: withDomainSharedDetail(row.description || undefined,
        (!!sharedPanels?.ok && sharedPanels.data.includes(row.id))
          || (!!objectShared?.ok && objectShared.data.PANEL?.includes(row.id) === true), credentials.locale),
    })),
  } : rows;
  const applicationName = (raw: z.infer<typeof applicationLinks>[number], shared: readonly string[]): Name => {
    const row = ontologyApplicationName(raw, credentials.locale);
    return { id: row.id, name: row.name,
      detail: withDomainSharedDetail(row.kind, shared.includes(row.id), credentials.locale) };
  };
  const sharedApplicationIds = sharedApps?.ok ? sharedApps.data : [];
  const readPanels = async (ids?: readonly string[]): Promise<OwnerReadResult<RawProductPanel[]>> =>
    panelRange.ok ? readers.productPanels({ range: panelRange.data, ids }) : panelRange;
  const readProjections = async (selection: Parameters<typeof readers.productProjections>[1]) =>
    projectionRange.ok ? readers.productProjections(projectionRange.data, selection) : projectionRange;
  const projectionCenter = async (): Promise<OwnerReadResult<RawProductProjection[]>> => {
    if (!projectionRange.ok) return projectionRange;
    const source = facts.bindingSource;
    if (!source) return readProjections({ ids: [primaryKey] });
    if (!source.ok) return source;
    return { ok: true, data: source.data && definitionVisibleInRange(source.data.row, projectionRange.data, viewer.domainId)
      ? [source.data.projection] : [] };
  };
  const bindingProjections = () => readProjections({ bindingTarget: input.node });
  const componentProjections = () => readProjections({ componentId: primaryKey });
  let reverseBindingRows: OwnerReadResult<RawProductProjection[]> | undefined;
  const sdkDirectory = planPlatformOntologyInstanceDirectory(readers, SDK_COMPONENT, false)!;

  const directory = ownerFact(facts.directory, governanceCenter, "governance center");
  const provenance = facts.userProvenance.map(reply => ownerFact(reply, userProvenance, "user provenance"));
  function bindingUserObject(row: Name) {
    const member = { id: row.id, loginCode: row.loginCode?.trim(), displayName: row.name?.trim() };
    const summaries = provenance.flatMap(source => source.ok && source.data[member.id] ? [source.data[member.id]] : []);
    const combine = (kind: "created" | "reviewed") => ({
      names: summaries.flatMap(summary => summary[kind].names),
      total: summaries.reduce((total, summary) => total + summary[kind].total, 0),
    });
    return userOntologyObject(member, summarizeUserProvenance(combine("created"), combine("reviewed"), credentials.locale));
  }
  const executionMember = ownerFact(facts.executionMember, governanceCenter, "execution user");
  const normalizeSubjectId = (id: string) => normalizeOntologySubjectId(id, viewer.userId, () => {
    if (className === USER) return directory.ok && directory.data.emptyDirectory;
    if (!executionMember.ok) return false;
    const count = ownerFact(facts.executionMemberCount, subjectsCount, "subjectsCount");
    return count.ok && count.data.total === 0;
  });

  const agentRange = readOntologyVisibilityFact(facts.agentScope, "AGENT", "VIEW");
  const agentSharing = ownerFact(facts.agentSharing, z.array(id), "domainSharedUse");
  const sharedAgentIds = new Set([
    ...(agentSharing.ok ? agentSharing.data : []), ...(objectShared?.ok ? objectShared.data.AGENT ?? [] : []),
  ]);
  async function agentObjects(ids: readonly string[]): Promise<OwnerObjectsResult> {
    if (!agentRange.ok) return agentRange;
    const rows = await readers.agentDefinitions(agentRange.data, ids);
    return rows.ok ? { ok: true, data: rows.data.map(agent =>
      ontologyAgentDefinitionObject(agent, sharedAgentIds.has(agent.id), credentials.locale)) } : rows;
  }

  const panelIds = new Set(className === PRODUCT_PANEL ? [primaryKey] : []);
  if (appRows?.ok) for (const row of appRows.data) for (const id of row.panelIds) panelIds.add(id);
  const panels: OwnerReadResult<RawProductPanel[]> = panelIds.size
    ? await readPanels([...panelIds]) : panelRange.ok ? { ok: true, data: [] } : panelRange;
  const definitionsOfCenterType = () => readers.definitions({ objectType: primaryKey });
  const modelObjects = (type: ModelInstanceType): OwnerObjectsResult => {
    const reply = model!;
    if (!reply.ok) return reply;
    const res = modelSection(reply.data.center, "model center");
    return res.ok ? { ok: true, data: modelInstanceObjects(type, res.data) } : res;
  };

  const workflowSteps = ownerFact(facts.relations.get(workflowStepRelation), workflowStepFactsSchema, workflowStepRelation);
  const workflowActions = facts.relations.has(workflowActionRelation)
    ? ownerFact(facts.relations.get(workflowActionRelation), workflowActionLinks, workflowActionRelation) : undefined;
  const trigger = className === TRIGGER ? ownerFact(facts.triggerCenter, triggerRows, "triggerCenter") : undefined;
  if (facts.triggerTargetNames) {
    const endpoints = ownerFact(facts.triggerTargetNames, triggerTargetNames, "triggerTargetNames");
    if (endpoints.ok) for (const { className, names } of endpoints.data) addNames(className, names);
  }
  const center = async (): Promise<OwnerObjectsResult & { emptyDirectory?: boolean }> => {
    if (trigger) return triggerObjects(trigger);
    if (className === WORKFLOW) {
      if (workflowActions) return workflowActions.ok
        ? { ok: true, data: workflowActions.data.workflows.map(workflowOntologyObject) } : workflowActions;
      return workflowObjects(facts.workflowCenter);
    }
    if (className === FUNCTION || className === ACTION || className === METRIC_VIEW)
      return dependencyObjects(className, facts.dependencyCenter, facts.objectTypeDependencyKind);
    if (className === PRODUCT_PANEL) return panelObjects(panels);
    if (className === PRODUCT_PROJECTION) return projectionObjects(await projectionCenter());
    if (className === SDK_COMPONENT)
      return policyObject ? sdkComponentObjects(await readers.sdkComponents([primaryKey])) : sdkDirectory.read();
    if (className === AGENT_DEFINITION) return agentObjects([primaryKey]);
    if (className === ORG_GRANT) {
      const grants = ownerFact(facts.grantCenter, orgGrantInstanceDirectorySchema, "orgGrantCenter");
      return grants.ok ? { ok: true, data: grants.data.map(grant => organizationGrantObject(grant, credentials.locale)) } : grants;
    }
    if (className === APPLICATION) {
      const result = ownerFact(facts.appCenter, applicationLinks, "application center");
      if (!result.ok) return result;
      return { ok: true, data: result.data.map(raw => {
        return namedObject(className, applicationName(raw, sharedApplicationIds));
      }) };
    }
    if (className === DEFINITION) return ontologyDefinitionObjects(facts.definition!);
    if (isModelInstanceType(className)) return modelObjects(className);
    if (facts.hasProjectionBinding && className === BUSINESS_KNOWLEDGE)
      return bindingKnowledgeObjects(facts.bindingRecord);
    if (facts.hasProjectionBinding && className === SKILL)
      return { ok: false, status: "unavailable", reason: "Skill needs its scoped ontology label owner and skill-library admission" };
    return directory.ok ? {
      ok: true, data: className === USER && facts.hasProjectionBinding
        ? directory.data.names.map(bindingUserObject) : directory.data.names.map(row =>
          namedObject(className, className === PERMISSION_POLICY && policyObject ? policyName(row) : row)),
      emptyDirectory: directory.data.emptyDirectory,
    } : directory;
  };
  const centerRows = await center();
  const result = await assemblePlatformOntologyNeighbors(viewer, input, viewer.userName, applicable, {
    center: async () => centerRows,
    async objects(type, ids) {
      if (type === DEFINITION) {
        if (className === DEFINITION) return centerRows;
        if (className !== PRODUCT_PROJECTION) return ontologyDefinitionObjects(await definitionsOfCenterType());
        const results = await Promise.all(ids.map(id => readers.definitions({ id })));
        return { ok: true, data: results.flatMap(result => result.ok ? result.data.map(row => namedObject(DEFINITION, { ...row, detail: row.objectType })) : []) };
      }
      if (type === OBJECT_TYPE && className === DEFINITION) return modelObjects(OBJECT_TYPE);
      if (type === OBJECT_TYPE && (className === ACTION || className === FUNCTION)) {
        const result = readOntologyOwnerFact(facts.dependencyObjectTypeNames, modelFacts, "dependencyObjectTypeNames");
        return result.ok ? { ok: true, data: modelInstanceObjects(OBJECT_TYPE, result.data) } : result;
      }
      if (type === PRODUCT_PANEL) {
        if (!panels.ok) return panels;
        const remaining = ids.filter(id => !panelIds.has(id));
        if (remaining.length === 0) return panelObjects(panels);
        const endpoints = await readPanels(remaining);
        return panelObjects(endpoints.ok ? { ok: true, data: [...panels.data, ...endpoints.data] } : endpoints);
      }
      if (type === PRODUCT_PROJECTION) {
        if (className === PRODUCT_PROJECTION) {
          if (!centerRows.ok) return centerRows;
          const others = ids.filter(id => id !== primaryKey);
          if (others.length === 0) return centerRows;
          const rows = projectionObjects(await readProjections({ ids: others }));
          return rows.ok ? { ok: true, data: [...centerRows.data, ...rows.data] } : rows;
        }
        if (reverseBindingRows?.ok) {
          const known = new Map(reverseBindingRows.data.map(row => [row.id, row]));
          const missing = ids.filter(id => !known.has(id));
          if (missing.length === 0) return projectionObjects(reverseBindingRows);
          const extra = await readProjections({ ids: missing });
          return projectionObjects(extra.ok ? { ok: true, data: [...known.values(), ...extra.data] } : extra);
        }
        return projectionObjects(await (className === SDK_COMPONENT ? componentProjections() : readProjections({ ids })));
      }
      if (type === SDK_COMPONENT) return className === SDK_COMPONENT ? centerRows
        : policyObject ? sdkComponentObjects(await readers.sdkComponents(ids)) : sdkDirectory.read();
      if (type === AGENT_DEFINITION) return className === AGENT_DEFINITION ? centerRows : agentObjects(ids);
      if (type === USER && className === AGENT_DEFINITION) {
        return executionMember.ok ? {
          ok: true, data: executionMember.data.names.map(member => namedObject(USER, member)),
        } : executionMember;
      }
      if (type === WORKFLOW) {
        if (className === WORKFLOW) return centerRows;
        if (className === ROLE) return workflowSteps.ok
          ? { ok: true, data: workflowSteps.data.workflows.map(workflowOntologyObject) } : workflowSteps;
        if (className === ACTION && workflowActions) return workflowActions.ok
          ? { ok: true, data: workflowActions.data.workflows.map(workflowOntologyObject) } : workflowActions;
      }
      if (type === ROLE && facts.grantRoleNames) {
        const [directory, grants] = facts.grantRoleNames;
        const roles = readOntologyRoleNameFacts(directory, grants, ...orgGrantRoleNames);
        if (roles.ok) addNames(ROLE, roles.data.roles.map(role => ({ id: role.id, name: role.code })));
      }
      if (type === USER && facts.organizationMemberNames) {
        const members = ownerFact(facts.organizationMemberNames, z.array(nameSchema), "organizationMemberNames");
        if (members.ok) addNames(USER, members.data);
      }
      for (const { target, reply } of facts.bindingEndpoints) {
        if (type !== target.className || !ids.includes(target.primaryKey)) continue;
        let objects: OwnerObjectsResult;
        if (isModelInstanceType(type)) {
          const fact = readOntologyOwnerFact(reply, modelNeighborFacts, "modelNeighbors");
          if (!fact.ok) continue;
          const res = modelSection(fact.data.center, "binding model target");
          objects = res.ok ? { ok: true, data: modelInstanceObjects(type, res.data) } : res;
        } else if (bindingLabelTypes.has(type)) {
          if (type === WORKFLOW) objects = workflowObjects(reply);
          else if (type === TRIGGER) objects = triggerObjects(ownerFact(reply, triggerRows, "triggerCenter"));
          else if (type === BUSINESS_KNOWLEDGE) objects = bindingKnowledgeObjects(reply);
          else objects = dependencyObjects(type, reply);
        } else if (type === ORG_GRANT) {
          const grants = ownerFact(reply, orgGrantInstanceDirectorySchema, "orgGrantCenter");
          objects = grants.ok ? { ok: true, data: grants.data.map(grant => organizationGrantObject(grant, credentials.locale)) } : grants;
        } else if (type === APPLICATION) {
          const applications = ownerFact(reply, applicationLinks, "application target");
          if (!applications.ok) continue;
          addNames(type, applications.data.map(app => applicationName(app, sharedApplicationIds)));
          continue;
        } else {
          const people = ownerFact(reply, governanceCenter, "binding governance target");
          if (people.ok) {
            if (type === USER) {
              addNames(type, people.data.names.map(row => {
                const user = bindingUserObject(row);
                return { id: row.id, name: user.label, detail: user.detail };
              }));
            } else addNames(type, people.data.names);
          }
          continue;
        }
        if (objects.ok) addNames(type, objects.data.map(row => ({ id: row.node.primaryKey, name: row.label, detail: row.detail })));
      }
      const endpoints = [...(names.get(type)?.values() ?? [])].map(row => namedObject(type, row));
      const centerObjects = type === className && centerRows.ok ? centerRows.data : [];
      return { ok: true, data: [...endpoints, ...centerObjects] };
    },
    async relation(spec) {
      if (spec.id === policyObjectRelation) {
        const result = ownerFact(facts.relations.get(spec.id), graphPolicyGrantSchema.array(), spec.id);
        if (result.ok) {
          if (objectGrantPolicies.ok) addNames(PERMISSION_POLICY, objectGrantPolicies.data.names.map(policyName));
          for (const { type, name, reply } of facts.objectNames) {
            const labels = ownerFact(reply, nameSchema.array(), name);
            if (labels.ok) addNames(type, labels.data);
          }
        }
        return evaluatePolicyObjectGrants(input.node, result, credentials.locale);
      }
      if (spec.id === policyActionRelation) {
        const result = ownerFact(facts.relations.get(spec.id), graphPolicyGrantSchema.array(), spec.id);
        if (result.ok) {
          const outgoing = className === PERMISSION_POLICY;
          const labels = ownerFact(facts.actionEndpointNames, nameSchema.array(),
            outgoing ? "policyGrantActionNames" : "actionGrantPolicyNames");
          if (labels.ok) addNames(outgoing ? ACTION : PERMISSION_POLICY, labels.data);
        }
        return evaluatePolicyActionGrants(input.node, result, credentials.locale);
      }
      if (spec.id === policyEntryRelation) {
        const result = ownerFact(facts.relations.get(spec.id), graphPolicyGrantSchema.array(), spec.id);
        if (result.ok && className === PERMISSION_POLICY) {
          const labels = ownerFact(facts.entryEndpointNames, entryApplicationNames, entryApplicationNamesRead);
          if (labels.ok) addNames(APPLICATION, labels.data.applications.map(app => applicationName(app, labels.data.shared)));
        } else if (result.ok) {
          const labels = ownerFact(facts.entryEndpointNames, nameSchema.array(), entryPolicyNamesRead);
          if (labels.ok) addNames(PERMISSION_POLICY, labels.data);
        }
        return evaluatePolicyEntryGrants(input.node, result, credentials.locale);
      }
      if (spec.id === "projection.binds-target") {
        if (!projectionRange.ok) return relationFailure(projectionRange);
        if (className !== PRODUCT_PROJECTION) {
          reverseBindingRows = await bindingProjections();
          return evaluateProjectionBindings(input.node, reverseBindingRows);
        }
        return { status: "ok", edges: facts.binding };
      }
      if (isTriggerTargetRelation(spec.id)) {
        const rows = trigger ?? ownerFact(facts.relations.get(spec.id), triggerRows, spec.id);
        if (!rows.ok) return relationFailure(rows);
        const targetKind = triggerTargetKinds[spec.id];
        return { status: "ok", edges: rows.data.flatMap(row => row.targetKind === targetKind ? [{
          from: { className: TRIGGER, primaryKey: row.id },
          to: { className: spec.to as string, primaryKey: row.targetId },
          fromLabel: row.title,
          fromDetail: row.targetKind,
        }] : []) };
      }
      if (spec.id === "definition.based-on-object-type")
        return facts.definitionEdge ?? evaluateDefinitionObjectType(input.node, await definitionsOfCenterType());
      if (spec.id === workflowStepRelation)
        return evaluateWorkflowStepOwnership(input.node,
          workflowSteps.ok ? { ok: true, data: workflowSteps.data.links } : workflowSteps, credentials.locale);
      if (spec.id === "agent.executes-as-user") {
        if (!agentRange.ok) return relationFailure(agentRange);
        // The assembler has admitted the center through the AGENT/VIEW directory before reading its edges.
        const agents = className === AGENT_DEFINITION
          ? { ok: true as const, data: [{ id: primaryKey, executionUserId: facts.executionUserId }] }
          : await readers.agentExecutionUserRelations(undefined, {
            view: agentRange.data,
            executionUserIds: primaryKey === "system" && await normalizeSubjectId("admin") === primaryKey
              ? [primaryKey, "admin"] : [primaryKey],
          });
        return evaluateAgentExecutionUser(input.node, agents, normalizeSubjectId);
      }
      if (spec.id === "projection.uses-component") {
        const projections = className === SDK_COMPONENT ? await componentProjections() : await projectionCenter();
        return evaluateProjectionComponent(input.node, projections);
      }
      if (isPanelContainmentKind(spec.id)) {
        if (!panelRange.ok) return relationFailure(panelRange);
        const targetKind = spec.id === "panel.contains-panel" ? "panel" : "projection";
        const targetRange = targetKind === "panel" ? panelRange : projectionRange;
        if (!targetRange.ok) return relationFailure(targetRange);
        const onlyCenter = className === PRODUCT_PANEL
          && (targetKind === "projection" || input.direction === "outgoing");
        return evaluatePanelContainment(spec.id, input.node, input.direction, {
          panels: () => onlyCenter ? Promise.resolve(panels) : readPanels(),
          targets: ids => readers.productDefinitionIdsInRange(targetKind, targetRange.data, ids),
          objectDetailPanelMappings: () => readers.objectDetailPanelMappings(),
        });
      }
      if (spec.owner === "java-application-catalog") {
        const rows = appRows ?? failed("Missing ontology fact: application.uses-panel");
        if (!rows.ok) return relationFailure(rows);
        if (!panels.ok) return relationFailure(panels);
        return { status: "ok", edges: rows.data.flatMap(raw => {
          const app = ontologyApplicationName(raw, credentials.locale);
          addNames(APPLICATION, [{ id: app.id, name: app.name, detail: app.kind }]);
          return raw.panelIds.map(panel => ({
            from: { className: APPLICATION, primaryKey: app.id },
            to: { className: PRODUCT_PANEL, primaryKey: panel },
            fromLabel: app.name,
          }));
        }) };
      }
      if (spec.owner === "java-ontology") {
        const reply = model!;
        if (!reply.ok) return relationFailure(reply);
        const sections = reply.data.relations;
        if (!sections.success) return relationFailure(failed(sections.error.message));
        const result = modelSection(sections.data[spec.id], spec.id);
        if (!result.ok) return relationFailure(result);
        for (const type of [spec.from, spec.to] as ModelInstanceType[]) {
          addNames(type, modelInstanceObjects(type, result.data).map(row => ({
            id: row.node.primaryKey, name: row.label, detail: row.detail,
          })));
        }
        return { status: "ok", edges: modelRelationEdges(spec.id, input.node, result.data) };
      }
      const reply = facts.relations.get(spec.id);
      const to = spec.to as string;
      const result = isOrganizationGrantRelation(spec.id)
        ? ownerFact(reply, organizationGrantLinks, spec.id)
        : spec.id === workflowActionRelation ? workflowActions! : ownerFact(reply, governanceLinks, spec.id);
      if (!result.ok) return relationFailure(result);
      if ("workflows" in result.data) {
        if (className === WORKFLOW) {
          const actions = ownerFact(facts.workflowActionNames, z.array(nameSchema), "workflowStepActionNames");
          if (actions.ok) addNames(ACTION, actions.data);
        }
      } else {
        if ("grants" in result.data) {
          addNames(ORG_GRANT, result.data.grants.map(grant => ({
            id: grant.id, name: organizationGrantObject(grant, credentials.locale).label,
          })));
        } else {
          addNames(spec.from, result.data.fromNames);
        }
        addNames(to, result.data.toNames);
      }
      if (spec.id === policyDataRelation) {
        if (className === PERMISSION_POLICY) {
          const model = readOntologyOwnerFact(facts.policyDataObjectTypeNames, modelFacts, policyDataObjectTypeNamesRead);
          if (model.ok) addNames(OBJECT_TYPE, modelInstanceObjects(OBJECT_TYPE, model.data).map(row => ({
            id: row.node.primaryKey, name: row.label, detail: row.detail,
          })));
        }
        return evaluatePolicyDataPermissions(input.node, { ok: true,
          data: result.data.links.map(({ fromId, toId }) => ({ policyId: fromId, className: toId })),
        });
      }
      return { status: "ok", edges: result.data.links.map(({ fromId, toId }) => ({
        from: { className: spec.from, primaryKey: fromId },
        to: { className: to, primaryKey: toId },
      })) };
    },
  });
  return presentOntologyNeighborDisplay(result, credentials.locale);
}
