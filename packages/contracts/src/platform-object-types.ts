import { z } from "zod";

export const DASHBOARD_CARD = "platform:DashboardCard";
export const EXECUTE_OBJECT_ACTION = "actions.execute";
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
export const APPLICATION_PANEL_USE = "platform:ApplicationPanelUse";
export const ONTOLOGY_TYPE = "platform:OntologyType";
export const ONTOLOGY_RELATION_KIND = "platform:OntologyRelationKind";

export const platformOntologyLayers = ["fact", "capability", "governance", "product"] as const;

export type PanelReadParameterId = keyof typeof import("./panel-projection").panelReadParameterSchemas;
export type PanelReadResultId = keyof typeof import("./panel-operations").panelReadResultSchemas;

type PanelReadSignature =
  | { parameterMode: "fixed"; params: Readonly<Record<string, PanelReadParameterId>>; requiredParams?: readonly string[] }
  | { parameterMode: "owner"; parameter: PanelReadParameterId };

export type PlatformReadDeclaration = PanelReadSignature & {
  source: "type" | "object";
  result: PanelReadResultId;
};

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

export const RUN_NOW = "schedules.runNow";
export const DELETE_AGENT = "agents.delete";
export const SET_ACTION_STATUS = "actions.setStatus";
export const DELETE_ACTION = "actions.delete";
export const DELETE_METRIC_VIEW = "metricViews.delete";
export const SET_METRIC_VIEW_STATUS = "metricViews.setStatus";
export const TEST_METRIC_VIEW = "metricViews.test";
export const TEST_EXECUTE_METRIC_VIEW = "metricViews.testExecute";
export const DELETE_FUNCTION = "functions.delete";
export const APPROVE_KNOWLEDGE = "knowledge.approve";
export const DELETE_KNOWLEDGE = "knowledge.delete";
export const DELETE_SKILL = "skills.delete";
export const IMPORT_SKILL = "skills.import";
export const EXPORT_SKILL = "skills.export";
export const EXPORT_FEEDBACK = "feedback.export";
export const DELETE_OBJECT_TYPE = "objectTypes.delete";
export const DELETE_ATTRIBUTE = "attributes.delete";
export const DELETE_RELATIONSHIP = "relationships.delete";
export const SET_PRIMARY_KEY = "attributes.setPrimaryKey";
const referenceReads = {
  options: { source: "type", parameterMode: "fixed", params: {}, result: "panelOptionList" },
  resolve: { source: "type", parameterMode: "fixed", params: { values: "optionValues" }, requiredParams: ["values"], result: "panelOptionList" },
} as const satisfies NonNullable<PlatformObjectTypeDeclaration["reads"]>;

const metadataList = { list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" } } as const;
/** A catalogue searched and paged like the business knowledge list, for definitions with no further filter. */
const definitionQuery = {
  query: { source: "type", parameterMode: "fixed", params: { search: "keyword", cursor: "cursor", size: "size" }, result: "panelRecordQuery" },
} as const;
const definitionFormParams = { values: "panelFormValues", changedField: "changedField" } as const;
const modelReads = {
  record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
  form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
  createForm: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
} as const;
const modelListByClass = { source: "type", parameterMode: "fixed", params: { className: "className" }, result: "panelRecordList" } as const;

/** Type-level metadata shared by projection bindings and ontology catalogues. */
export const platformObjectTypes: Readonly<Record<string, PlatformObjectTypeDeclaration>> = {
  [SCHEDULED_TASK]: {
    ...describeType("scheduledTask"),
    reads: {
      list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
      form: { source: "object", parameterMode: "fixed", params: { values: "formValues", changedField: "changedField" }, result: "panelFormDescription" },
    },
    operations: [`${SCHEDULED_TASK}.save`, RUN_NOW],
  },
  [MODEL_OPTION]: { ...describeType("modelOption"), reads: referenceReads },
  [MCP_SERVICE_OPTION]: { ...describeType("mcpServiceOption"), reads: referenceReads },
  [OBJECT_TYPE]: {
    ...describeType("objectType", "fact"),
    reads: { ...modelReads, ...metadataList },
    operations: [`${OBJECT_TYPE}.save`, DELETE_OBJECT_TYPE],
  },
  [ATTRIBUTE]: {
    ...describeType("attribute", "fact"),
    reads: {
      ...modelReads, list: modelListByClass,
    },
    operations: [`${ATTRIBUTE}.save`, DELETE_ATTRIBUTE, SET_PRIMARY_KEY],
  },
  [RELATIONSHIP]: {
    ...describeType("relationship", "fact"),
    reads: { ...modelReads, list: modelListByClass },
    operations: [`${RELATIONSHIP}.save`, DELETE_RELATIONSHIP],
  },
  [METRIC_VIEW]: {
    ...describeType("metricView", "capability"),
    reads: {
      ...definitionQuery,
      ...modelReads,
      result: { source: "object", parameterMode: "owner", parameter: "ontologyParameter", result: "metricOutput" },
    },
    operations: [`${METRIC_VIEW}.save`, SET_METRIC_VIEW_STATUS, DELETE_METRIC_VIEW, TEST_METRIC_VIEW, TEST_EXECUTE_METRIC_VIEW],
  },
  [DASHBOARD_CARD]: {
    ...describeType("dashboardCard"),
    reads: {
      chartTemplate: { source: "object", parameterMode: "fixed", params: {}, result: "chartTemplate" },
      result: { source: "object", parameterMode: "owner", parameter: "ontologyParameter", result: "metricOutput" },
    },
  },
  [FUNCTION]: {
    ...describeType("function", "capability"),
    reads: { ...definitionQuery, ...modelReads },
    operations: [`${FUNCTION}.save`, DELETE_FUNCTION],
  },
  [ACTION]: {
    ...describeType("action", "capability"),
    reads: {
      ...metadataList,
      record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
      form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      createForm: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      definition: { source: "object", parameterMode: "fixed", params: {}, result: "actionDefinition" },
      explanation: { source: "object", parameterMode: "fixed", params: {}, result: "actionExplanation" },
    },
    operations: [`${ACTION}.save`, SET_ACTION_STATUS, DELETE_ACTION],
  },
  [WORKFLOW]: describeType("workflow", "capability"),
  [TRIGGER]: describeType("trigger", "capability"),
  [SKILL]: {
    ...describeType("skill", "capability"),
    childCollections: ["files"],
    reads: {
      // `options` and `resolve` pick skills for an agent; `query` is the library catalogue, read-only provider packages included.
      ...referenceReads,
      query: { source: "type", parameterMode: "fixed", params: { search: "keyword", cursor: "cursor", size: "size" }, result: "panelRecordQuery" },
      record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
      files: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      file: {
        source: "object", parameterMode: "fixed", params: { path: "skillFilePath" }, requiredParams: ["path"], result: "panelRecord",
      },
    },
    operations: [DELETE_SKILL],
  },
  [BUSINESS_KNOWLEDGE]: {
    ...describeType("businessKnowledge", "capability"),
    reads: {
      query: {
        source: "type", parameterMode: "fixed",
        params: { search: "keyword", status: "knowledgeStatus", cursor: "cursor", size: "size" },
        result: "panelRecordQuery",
      },
      counts: {
        source: "type", parameterMode: "fixed", params: { by: "knowledgeCountField", search: "keyword" },
        requiredParams: ["by"], result: "panelGroupCounts",
      },
      record: { source: "object", parameterMode: "fixed", params: { search: "keyword" }, result: "panelRecord" },
      form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      createForm: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
    },
    operations: [`${BUSINESS_KNOWLEDGE}.save`, APPROVE_KNOWLEDGE, DELETE_KNOWLEDGE],
  },
  [DEFINITION]: describeType("definition", "capability"),
  [USER]: {
    ...describeType("user", "governance"),
    reads: {
      ...referenceReads,
      options: { source: "type", parameterMode: "fixed", params: { keyword: "keyword", page: "page" }, result: "panelOptionList" },
    },
  },
  [ROLE]: describeType("role", "governance"),
  [SDK_COMPONENT]: {
    ...describeType("sdkComponent", "product"),
    reads: {
      catalogue: { source: "type", parameterMode: "fixed", params: { search: "keyword" }, result: "panelRecordList" },
      definition: { source: "object", parameterMode: "fixed", params: {}, result: "sdkComponentDefinition" },
    },
  },
  [PRODUCT_PROJECTION]: describeType("productProjection", "product"),
  [PRODUCT_PANEL]: describeType("productPanel", "product"),
  [APPLICATION]: describeType("application", "product"),
  [APPLICATION_PANEL_USE]: {
    ...describeType("applicationPanelUse", "product"),
    reads: { visible: { source: "type", parameterMode: "fixed", params: {}, result: "panelApplicationMenu" } },
  },
  [AGENT_DEFINITION]: {
    ...describeType("agentDefinition", "product"),
    reads: {
      ...metadataList,
      record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
      form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      createForm: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
    },
    operations: [`${AGENT_DEFINITION}.save`, DELETE_AGENT],
  },
  [ONTOLOGY_TYPE]: {
    ...describeType("ontologyType"),
    reads: {
      schema: { source: "type", parameterMode: "fixed", params: {}, result: "panelGraphSchema" },
      counts: { source: "type", parameterMode: "fixed", params: {}, result: "panelGraphCounts" },
      start: { source: "type", parameterMode: "fixed", params: {}, result: "panelGraphStart" },
      neighbors: {
        source: "type", parameterMode: "fixed", params: { node: "graphNode", relationKinds: "relationKinds", layers: "layers" },
        requiredParams: ["node"], result: "panelGraphNeighbors",
      },
      objects: {
        source: "type", parameterMode: "fixed", params: { type: "ontologyType", search: "keyword", page: "page" },
        requiredParams: ["type"], result: "panelOntologyObjects",
      },
    },
  },
  [ONTOLOGY_RELATION_KIND]: describeType("ontologyRelationKind"),
  [KNOWLEDGE_GOVERNANCE_RECORD]: {
    ...describeType("knowledgeGovernanceRecord"),
    childCollections: ["issues", "sources"],
    reads: {
      record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
      issues: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      sources: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      // One registered source, read in segments: each row is a passage and the owner encodes its position in the cursor.
      sourcePage: {
        source: "object", parameterMode: "fixed", params: { source: "governanceSource", cursor: "cursor" },
        requiredParams: ["source"], result: "panelRecordQuery",
      },
    },
  },
  [FEEDBACK_RECORD]: {
    ...describeType("feedbackRecord"),
    reads: {
      query: {
        source: "type", parameterMode: "fixed",
        params: { search: "keyword", sourceType: "feedbackSourceType", rating: "feedbackRating", cursor: "cursor", size: "size" },
        result: "panelRecordQuery",
      },
      // Counts by one filter apply the search and the other filter, so each choice shows what selecting it would list.
      counts: {
        source: "type", parameterMode: "fixed",
        params: { by: "feedbackCountField", search: "keyword", sourceType: "feedbackSourceType", rating: "feedbackRating" },
        requiredParams: ["by"], result: "panelGroupCounts",
      },
      record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
    },
  },
};

/** These families apply to the class or relationship identified by the current domain catalogue. */
export const customerOntologyReads: Readonly<Record<string, PlatformReadDeclaration>> = {
  query: { source: "type", parameterMode: "fixed", params: { search: "keyword", page: "page" }, result: "panelRecordQuery" },
  record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
};
export const customerRelationReads: Readonly<Record<string, PlatformReadDeclaration>> = {
  neighbors: {
    source: "type", parameterMode: "fixed", params: { node: "graphNode", relationKinds: "relationKinds", limit: "neighborsLimit" },
    requiredParams: ["node"], result: "panelRelationNeighbors",
  },
};
export function platformHasChildCollection(parentType: string, collection: string): boolean {
  return platformObjectTypes[parentType]?.childCollections?.includes(collection) ?? false;
}

const identifier = z.string().min(1);
export const platformRelationKindDeclarationSchema = z.object({
  id: identifier,
  from: identifier,
  to: z.union([identifier, z.array(identifier)]),
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
