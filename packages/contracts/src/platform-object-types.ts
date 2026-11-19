import { z } from "zod";

export const SCHEDULED_TASK = "platform:ScheduledTask";
export const AGENT_DEFINITION = "platform:AgentDefinition";
export const SKILL = "platform:Skill";
export const MODEL_OPTION = "platform:ModelOption";
export const MCP_SERVICE_OPTION = "platform:McpServiceOption";
export const USER = "platform:User";
export const OBJECT_TYPE = "platform:ObjectType";
export const ATTRIBUTE = "platform:Attribute";
export const RELATIONSHIP = "platform:Relationship";
export const METRIC_VIEW = "platform:MetricView";
export const FUNCTION = "platform:Function";

export const BUSINESS_KNOWLEDGE = "platform:BusinessKnowledge";
export const KNOWLEDGE_GOVERNANCE_RECORD = "platform:KnowledgeGovernanceRecord";
export const FEEDBACK_RECORD = "platform:FeedbackRecord";

export const ACTION = "platform:Action";
export const WORKFLOW = "platform:Workflow";
export const TRIGGER = "platform:Trigger";
export const DEFINITION = "platform:Definition";
export const ROLE = "platform:Role";
export const SDK_COMPONENT = "platform:SDKComponent";
export const PRODUCT_PROJECTION = "platform:ProductProjection";
export const PRODUCT_PANEL = "platform:ProductPanel";
export const APPLICATION = "platform:Application";
export const ONTOLOGY_TYPE = "platform:OntologyType";
export const ONTOLOGY_RELATION_KIND = "platform:OntologyRelationKind";

export const platformOntologyLayers = ["fact", "capability", "governance", "product"] as const;

export interface PlatformReadDeclaration {
  source: "type" | "object" | "operation";
  params: Readonly<Record<string, "formValues" | "changedField">>;
  result: "panelRecordList" | "panelRecord" | "panelFormDescription" | "panelOperationDescriptor";
}

export interface PlatformObjectTypeDeclaration {
  labelKey?: string;
  /** Set for types that have a declared place in the four-layer ontology. */
  layer?: typeof platformOntologyLayers[number];
  reads?: Readonly<Record<string, PlatformReadDeclaration>>;
  operations?: readonly string[];
  /** Named child collections owned by each instance of this type. */
  childCollections?: readonly string[];
}

const describeType = (name: string, layer?: PlatformObjectTypeDeclaration["layer"]): PlatformObjectTypeDeclaration => ({
  labelKey: `platformOntology.types.${name}`,
  ...(layer && { layer }),
});

const runNow: typeof import("./panel-client-requests").RUN_NOW = "schedules.runNow";

/** Type-level metadata shared by projection bindings and ontology catalogues. */
export const platformObjectTypes: Readonly<Record<string, PlatformObjectTypeDeclaration>> = {
  [SCHEDULED_TASK]: {
    ...describeType("scheduledTask"),
    reads: {
      list: { source: "type", params: {}, result: "panelRecordList" },
      record: { source: "object", params: {}, result: "panelRecord" },
      form: { source: "object", params: { values: "formValues", changedField: "changedField" }, result: "panelFormDescription" },
      [`${runNow}.describe`]: { source: "operation", params: {}, result: "panelOperationDescriptor" },
    },
    operations: [`${SCHEDULED_TASK}.save`, runNow],
  },
  [MODEL_OPTION]: describeType("modelOption"),
  [MCP_SERVICE_OPTION]: describeType("mcpServiceOption"),
  [OBJECT_TYPE]: describeType("objectType", "fact"),
  [ATTRIBUTE]: describeType("attribute", "fact"),
  [RELATIONSHIP]: describeType("relationship", "fact"),
  [METRIC_VIEW]: describeType("metricView", "capability"),
  [FUNCTION]: describeType("function", "capability"),
  [ACTION]: describeType("action", "capability"),
  [WORKFLOW]: describeType("workflow", "capability"),
  [TRIGGER]: describeType("trigger", "capability"),
  [SKILL]: { ...describeType("skill", "capability"), childCollections: ["files"] },
  [BUSINESS_KNOWLEDGE]: describeType("businessKnowledge", "capability"),
  [DEFINITION]: describeType("definition", "capability"),
  [USER]: describeType("user", "governance"),
  [ROLE]: describeType("role", "governance"),
  [SDK_COMPONENT]: describeType("sdkComponent", "product"),
  [PRODUCT_PROJECTION]: describeType("productProjection", "product"),
  [PRODUCT_PANEL]: describeType("productPanel", "product"),
  [APPLICATION]: describeType("application", "product"),
  [AGENT_DEFINITION]: describeType("agentDefinition", "product"),
  [ONTOLOGY_TYPE]: describeType("ontologyType"),
  [ONTOLOGY_RELATION_KIND]: describeType("ontologyRelationKind"),
  [KNOWLEDGE_GOVERNANCE_RECORD]: { ...describeType("knowledgeGovernanceRecord"), childCollections: ["issues", "sources"] },
  [FEEDBACK_RECORD]: describeType("feedbackRecord"),
};

export function platformHasChildCollection(parentType: string, collection: string): boolean {
  return platformObjectTypes[parentType]?.childCollections?.includes(collection) ?? false;
}

const identifier = z.string().min(1);
export const platformRelationKindDeclarationSchema = z.object({
  id: identifier,
  from: identifier,
  to: z.union([identifier, z.array(identifier).readonly()]),
  labelKey: identifier,
  derived: z.boolean(),
  owner: identifier,
}).strict();
export type PlatformRelationKindDeclaration = z.infer<typeof platformRelationKindDeclarationSchema>;

const relation = (
  id: string, from: string, to: PlatformRelationKindDeclaration["to"], owner: string, derived = false,
): PlatformRelationKindDeclaration => ({ id, from, to, labelKey: `platformOntology.relations.${id}`, derived, owner });

const declaredTypes = Object.keys(platformObjectTypes);

/** The declared topology and the owner each instance lookup must ask. */
export const platformRelationKinds: readonly PlatformRelationKindDeclaration[] = [
  relation("object-type.has-attribute", OBJECT_TYPE, ATTRIBUTE, "java-ontology"),
  relation("relationship.from-object-type", RELATIONSHIP, OBJECT_TYPE, "java-ontology"),
  relation("relationship.to-object-type", RELATIONSHIP, OBJECT_TYPE, "java-ontology"),
  relation("metric-view.uses-function", METRIC_VIEW, FUNCTION, "java-metric"),
  relation("action.uses-function", ACTION, FUNCTION, "java-action"),
  relation("function.reads-object-type", FUNCTION, OBJECT_TYPE, "java-function"),
  relation("action.targets-object-type", ACTION, OBJECT_TYPE, "java-action"),
  relation("definition.based-on-object-type", DEFINITION, OBJECT_TYPE, "node-business-definitions"),
  relation("workflow.step-references-action", WORKFLOW, ACTION, "java-workflow"),
  relation("trigger.targets-workflow", TRIGGER, WORKFLOW, "java-trigger"),
  relation("trigger.targets-action", TRIGGER, ACTION, "java-trigger"),
  relation("user.holds-role", USER, ROLE, "java-identity"),
  relation("role.can-execute-action", ROLE, ACTION, "java-grants"),
  relation("role.can-author-workflow", ROLE, WORKFLOW, "java-platform-access", true),
  relation("role.owns-workflow-step", ROLE, WORKFLOW, "java-workflow", true),
  relation("user.created-action", USER, ACTION, "java-action"),
  relation("user.created-workflow", USER, WORKFLOW, "java-workflow"),
  relation("user.created-metric-view", USER, METRIC_VIEW, "java-metric"),
  relation("user.published-action", USER, ACTION, "java-action"),
  relation("user.published-workflow", USER, WORKFLOW, "java-workflow"),
  relation("user.published-metric-view", USER, METRIC_VIEW, "java-metric"),
  relation("projection.uses-component", PRODUCT_PROJECTION, SDK_COMPONENT, "node-product-panels"),
  relation("projection.binds-target", PRODUCT_PROJECTION, declaredTypes, "node-product-panels"),
  relation("panel.contains-projection", PRODUCT_PANEL, PRODUCT_PROJECTION, "node-product-panels"),
  relation("application.uses-panel", APPLICATION, PRODUCT_PANEL, "java-application-catalog"),
  relation("agent.uses-skill", AGENT_DEFINITION, SKILL, "node-assistant"),
  relation("agent.executes-as-user", AGENT_DEFINITION, USER, "node-assistant"),
];
