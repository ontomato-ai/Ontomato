import { z } from "zod";

export const DASHBOARD = "platform:Dashboard";
export const DASHBOARD_CARD = "platform:DashboardCard";
export const FAVORITE = "platform:Favorite";
export const EXECUTE_OBJECT_ACTION = "actions.execute";
export const SCHEDULED_TASK = "platform:ScheduledTask";
export const CREATE_SCHEDULED_TASK = `${SCHEDULED_TASK}.create`;
export const SET_SCHEDULED_TASK_ENABLED = `${SCHEDULED_TASK}.setEnabled`;
export const DELETE_SCHEDULED_TASK = `${SCHEDULED_TASK}.delete`;
export const RENEW_SCHEDULED_TASK_CREDENTIAL = "schedules.renewCredential";
export const AGENT_DEFINITION = "platform:AgentDefinition";
export type AgentDefinitionCategory = "custom" | "preset" | "system";
export const SKILL = "platform:Skill";
export const MODEL_OPTION = "platform:ModelOption";
export const PUBLISHED_MCP_SERVICE = "platform:PublishedMcpService";
export const EXTERNAL_MCP_SERVICE = "platform:ExternalMcpService";
export const CREATE_EXTERNAL_MCP_SERVICE = `${EXTERNAL_MCP_SERVICE}.create`;
export const DELETE_EXTERNAL_MCP_SERVICE = "externalMcp.delete";
export const AUDIT_LOG = "platform:AuditLog";
export const GENERAL_SETTINGS = "platform:GeneralSettings";
export const DATA_ADAPTER_CONFIG = "platform:DataAdapterConfig";
export const MODEL_CONNECTION = "platform:ModelConnection";
export const MODEL_ENTRY = "platform:ModelEntry";
export const MODEL_USAGE = "platform:ModelUsage";
export const USER = "platform:User";
export const OBJECT_TYPE = "platform:ObjectType";
export const ATTRIBUTE = "platform:Attribute";
export const RELATIONSHIP = "platform:Relationship";
export const METRIC_VIEW = "platform:MetricView";
export const FUNCTION = "platform:Function";

export const BUSINESS_KNOWLEDGE = "platform:BusinessKnowledge";
export const FEEDBACK_RECORD = "platform:FeedbackRecord";
export const OPS_KNOWLEDGE = "platform:OpsKnowledge";
export const TURN_EVIDENCE = "platform:TurnEvidence";
export const AUTOTEST_CASE_SET = "platform:AutotestCaseSet";
export const AUTOTEST_RUN = "platform:AutotestRun";
export const AUTOTEST_CASE_ARTIFACT = "platform:AutotestCaseArtifact";

export const ACTION = "platform:Action";
export const WORKFLOW = "platform:Workflow";
export const TRIGGER = "platform:Trigger";
export const DEFINITION = "platform:Definition";
export const ROLE = "platform:Role";
export const PERMISSION_POLICY = "platform:PermissionPolicy";
export const ORG_UNIT = "platform:OrgUnit";
export const ORG_MEMBERSHIP = "platform:OrgMembership";
export const ORG_POSITION = "platform:OrgPosition";
export const ORG_GRANT = "platform:OrgGrant";
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

export type PanelReadOutputType = {
  readonly kind: "scalar";
  readonly type: "boolean" | "string" | "number";
};

export type PlatformReadDeclaration = PanelReadSignature & {
  source: "type" | "object";
  result: PanelReadResultId;
  /**
   * Object type of each row returned by a collection read when rows belong to a different ontology type than the
   * read's owner (for example `platform:Application.usedPanels` returns `platform:ProductPanel` rows).
   */
  rowType?: string;
  /**
   * Named, typed scalar read-only outputs explicitly published by the owner of this read (for example permission
   * conclusions or navigation targets). Panels may consume only these owner-declared outputs, never arbitrary fields.
   */
  outputs?: Readonly<Record<string, PanelReadOutputType>>;
};

export interface PlatformObjectTypeDeclaration {
  labelKey?: string;
  /** Set for types that have a declared place in the four-layer ontology. */
  layer?: typeof platformOntologyLayers[number];
  /**
   * When this object type's primary key is composite `<encodeURIComponent(parentPrimaryKey)>/<encodeURIComponent(localKey)>`,
   * declares the owning parent object type so deep-link URLs can omit the redundant parent prefix whenever the manifest
   * carries a unique matching parent deep-link state field.
   */
  parentKeyType?: string;
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
export const FAVORITE_AGENT = "agents.favorite";
export const UNFAVORITE_AGENT = "agents.unfavorite";
export const FAVORITE_APPLICATION = "applications.favorite";
export const UNFAVORITE_APPLICATION = "applications.unfavorite";
export const ADD_FAVORITE = "favorites.add";
export const REMOVE_FAVORITE = "favorites.remove";
export const SET_ACTION_STATUS = "actions.setStatus";
export const DELETE_ACTION = "actions.delete";
export const SET_TRIGGER_STATUS = "triggers.setStatus";
export const DELETE_TRIGGER = "triggers.delete";
export const ACTIVATE_WORKFLOW = "workflows.activate";
export const DEACTIVATE_WORKFLOW = "workflows.deactivate";
export const DELETE_WORKFLOW = "workflows.delete";
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
export const BUILD_TURN_EVIDENCE = "turnEvidence.build";
export const REFRESH_TURN_EVIDENCE = "turnEvidence.refresh";
export const KEEP_TURN_EVIDENCE = "turnEvidence.keep";
export const UNKEEP_TURN_EVIDENCE = "turnEvidence.unkeep";
export const DELETE_TURN_EVIDENCE = "turnEvidence.delete";
export const DOWNLOAD_TURN_EVIDENCE = "turnEvidence.download";
export const CREATE_AUTOTEST_CASE_SET = "autotestCaseSet.create";
export const IMPORT_AUTOTEST_CASE_SET = "autotestCaseSet.import";
export const DELETE_AUTOTEST_CASE_SET = "autotestCaseSet.delete";
export const KEEP_AUTOTEST_RUN = "autotestRun.keep";
export const UNKEEP_AUTOTEST_RUN = "autotestRun.unkeep";
export const DOWNLOAD_AUTOTEST_RUN = "autotestRun.download";
export const DELETE_AUTOTEST_RUN = "autotestRun.delete";
export const DOWNLOAD_AUTOTEST_CASE_ARTIFACT = "autotestCaseArtifact.download";
export const DELETE_MODEL_CONNECTION = "modelConnections.delete";
export const DISCOVER_MODEL_CONNECTION = "modelConnections.discover";
export const TEST_MODEL_CONNECTION = "modelConnections.test";
export const ADD_MODEL_ENTRY = "modelConnections.addModel";
export const DELETE_MODEL_ENTRY = "modelEntries.delete";
export const REBUILD_VECTORS = "modelUsage.rebuildVectors";
export const PAUSE_VECTOR_REBUILD = "modelUsage.pauseVectorRebuild";
export const TEST_DATA_ADAPTER_CONNECTION = "dataAdapters.testConnection";
export const SAVE_OBJECT_DETAIL_PANEL = `${OBJECT_TYPE}.saveDetailPanel`;
export const CLEAR_OBJECT_DETAIL_PANEL = "objectTypes.clearDetailPanel";
export const CREATE_DASHBOARD = "dashboards.create";
export const RENAME_DASHBOARD = "dashboards.rename";
export const DELETE_DASHBOARD = "dashboards.delete";
export const SAVE_DASHBOARD_LAYOUT = "dashboards.saveLayout";
export const CREATE_DASHBOARD_GROUP = "dashboards.createGroup";
export const RENAME_DASHBOARD_GROUP = "dashboards.renameGroup";
export const DELETE_DASHBOARD_GROUP = "dashboards.deleteGroup";
export const RENAME_DASHBOARD_CARD = "dashboardCards.rename";
export const DELETE_DASHBOARD_CARD = "dashboardCards.delete";
export const DELETE_OBJECT_TYPE = "objectTypes.delete";
export const DELETE_ATTRIBUTE = "attributes.delete";
export const DELETE_RELATIONSHIP = "relationships.delete";
export const SET_PRIMARY_KEY = "attributes.setPrimaryKey";
export const REMOVE_USER = "users.remove";
export const RESET_USER_PASSWORD = "users.resetPassword";
export const ADD_USER_MEMBER = "users.addMember";
export const GENERATE_USER_API_KEY = "users.generateApiKey";
export const REGENERATE_USER_API_KEY = "users.regenerateApiKey";
export const REVOKE_USER_API_KEY = "users.revokeApiKey";
export const ISSUE_USER_API_KEY_BATCH = "users.issueApiKeyBatch";
export const DELETE_ROLE = "roles.delete";
export const DELETE_PERMISSION_POLICY = "permissionPolicies.delete";
export const REFRESH_POLICY_API_CATALOG = "permissionPolicies.refreshApiCatalog";
export const DELETE_ORG_UNIT = "orgUnits.delete";
export const ADD_ORG_UNIT_MEMBER = "orgUnits.addMember";
export const SET_ORG_MEMBERSHIP_LOCKED = "orgMemberships.setLocked";
export const REMOVE_ORG_MEMBERSHIP = "orgMemberships.remove";
export const DELETE_ORG_POSITION = "orgPositions.delete";
export const DELETE_ORG_GRANT = "orgGrants.delete";
const governancePageQuery = {
  query: { source: "type", parameterMode: "fixed", params: { search: "keyword", page: "page" }, result: "panelRecordQuery" },
} as const;
const referenceReads = {
  options: { source: "type", parameterMode: "fixed", params: {}, result: "panelOptionList" },
  resolve: { source: "type", parameterMode: "fixed", params: { values: "optionValues" }, requiredParams: ["values"], result: "panelOptionList" },
} as const satisfies NonNullable<PlatformObjectTypeDeclaration["reads"]>;

const metadataList = { list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" } } as const;
const objectListRead = { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" } as const;
const countRead = { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordQuery" } as const;
const ontologyTypeDetailList = {
  source: "type", parameterMode: "fixed", params: { type: "ontologyType" },
  requiredParams: ["type"], result: "panelRecordList",
} as const satisfies PlatformReadDeclaration;
/** A catalogue searched and paged like the business knowledge list, for definitions with no further filter. */
const definitionQuery = {
  query: { source: "type", parameterMode: "fixed", params: { search: "keyword", cursor: "cursor", size: "size" }, result: "panelRecordQuery" },
} as const;
const definitionFormParams = { values: "panelFormValues", changedField: "changedField" } as const;
const customerQueryParams = { search: "keyword", page: "page", size: "size", filters: "recordFilters", sort: "recordSort" } as const;
const customerQuery = { source: "type", parameterMode: "fixed", params: customerQueryParams, result: "panelRecordQuery" } as const;
const modelReads = {
  record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
  form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
  createForm: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
} as const;
const catalogueQuery = {
  source: "type", parameterMode: "fixed",
  params: { search: "keyword", scope: "productScope", sort: "productSort", cursor: "cursor", size: "size" },
} as const;
const catalogueRecord = { source: "object", parameterMode: "fixed", params: {} } as const;
const productCatalogueFormReads = { form: modelReads.form, createForm: modelReads.createForm };
const productCatalogueOperations = (type: string, collection: string) => [
  `${type}.save`, `${collection}.copy`, `${collection}.delete`, `${collection}.grant`, `${collection}.revoke`, `${collection}.share`,
];
const modelListByClass = { source: "type", parameterMode: "fixed", params: { className: "className" }, result: "panelRecordList" } as const;

/** Type-level metadata shared by projection bindings and ontology catalogues. */
export const platformObjectTypes: Readonly<Record<string, PlatformObjectTypeDeclaration>> = {
  [SCHEDULED_TASK]: {
    ...describeType("scheduledTask", "capability"),
    reads: {
      list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      counts: { source: "type", parameterMode: "fixed", params: { by: "keyword" }, result: "panelGroupCounts" },
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          revision: { kind: "scalar", type: "number" },
          enabled: { kind: "scalar", type: "boolean" },
          paused: { kind: "scalar", type: "boolean" },
          pauseCode: { kind: "scalar", type: "string" },
          latestResultPath: { kind: "scalar", type: "string" },
          isRunning: { kind: "scalar", type: "boolean" },
        },
      },
      form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      createForm: { source: "type", parameterMode: "fixed", params: { ...definitionFormParams, defaultAppId: "keyword" }, result: "panelFormDescription" },
      runs: { source: "object", parameterMode: "fixed", params: { cursor: "cursor" }, result: "scheduledTaskRunPage" },
      run: {
        source: "object", parameterMode: "fixed", params: { runId: "scheduledRunId" },
        requiredParams: ["runId"], result: "scheduledTaskRun",
      },
      runRecords: { source: "object", parameterMode: "fixed", params: { cursor: "cursor" }, result: "panelRecordQuery" },
      runRecord: {
        source: "object", parameterMode: "fixed", params: { runId: "scheduledRunId" },
        requiredParams: ["runId"], result: "panelRecord",
        outputs: {
          resultPath: { kind: "scalar", type: "string" },
          isRunning: { kind: "scalar", type: "boolean" },
        },
      },
    },
    operations: [`${SCHEDULED_TASK}.save`, RUN_NOW, CREATE_SCHEDULED_TASK, SET_SCHEDULED_TASK_ENABLED, DELETE_SCHEDULED_TASK],
  },
  [PUBLISHED_MCP_SERVICE]: {
    ...describeType("publishedMcpService"),
    reads: { ...metadataList, record: modelReads.record, tools: objectListRead },
  },
  [EXTERNAL_MCP_SERVICE]: {
    ...describeType("externalMcpService"),
    reads: {
      ...referenceReads,
      ...metadataList,
      ...modelReads,
      tools: objectListRead,
    },
    operations: [CREATE_EXTERNAL_MCP_SERVICE, `${EXTERNAL_MCP_SERVICE}.save`, DELETE_EXTERNAL_MCP_SERVICE],
  },
  [AUDIT_LOG]: {
    ...describeType("auditLog"),
    reads: {
      query: {
        source: "type", parameterMode: "fixed",
        params: { business: "auditLogBusiness", operation: "auditLogOperation", page: "page" },
        result: "panelRecordQuery",
      },
      record: modelReads.record,
    },
  },
  [GENERAL_SETTINGS]: {
    ...describeType("generalSettings"), reads: { ...metadataList, record: modelReads.record, form: modelReads.form },
    operations: [`${GENERAL_SETTINGS}.save`],
  },
  [MODEL_OPTION]: { ...describeType("modelOption"), reads: referenceReads },
  [OBJECT_TYPE]: {
    ...describeType("objectType", "fact"),
    reads: {
      ...modelReads, ...metadataList, ...referenceReads, count: countRead,
      instances: { ...customerQuery, params: { className: "className", ...customerQueryParams }, requiredParams: ["className"] },
      instanceRecord: {
        source: "type", parameterMode: "fixed", params: { object: "graphNode" },
        requiredParams: ["object"], result: "panelRecord",
      },
      instanceNeighbors: {
        source: "type", parameterMode: "fixed",
        params: { node: "graphNode", relationKinds: "relationKinds", targetClass: "className", direction: "neighborDirection",
          limit: "neighborsLimit", offset: "nonNegativeInt" },
        requiredParams: ["node"], result: "panelGraphNeighbors",
      },
      instanceGraphOverview: { source: "type", parameterMode: "fixed", params: {}, result: "panelGraphOverview" },
      instanceGraphConnections: {
        source: "type", parameterMode: "fixed", params: { version: "keyword", sampleToken: "keyword" },
        requiredParams: ["version"], result: "panelGraphConnections",
      },
      instanceGraphStatistics: { source: "type", parameterMode: "fixed", params: {}, result: "panelGraphCounts" },
      instanceGraphSearch: {
        source: "type", parameterMode: "fixed",
        params: { search: "keyword", className: "className", version: "keyword" }, result: "panelRecordQuery",
      },
      detailPanel: {
        ...modelReads.record,
        outputs: {
          configured: { kind: "scalar", type: "boolean" },
          panelId: { kind: "scalar", type: "string" },
          panelStatus: { kind: "scalar", type: "string" },
          canConfigure: { kind: "scalar", type: "boolean" },
        },
      },
      detailPanelForm: modelReads.form,
      record: {
        ...modelReads.record,
        outputs: {
          className: { kind: "scalar", type: "string" },
          primaryKeyStatus: { kind: "scalar", type: "string" },
          primaryKeyName: { kind: "scalar", type: "string" },
          primaryKeyShowName: { kind: "scalar", type: "string" },
          primaryKeyCount: { kind: "scalar", type: "number" },
          attributeCount: { kind: "scalar", type: "number" },
          businessKeyCount: { kind: "scalar", type: "number" },
          relationshipCount: { kind: "scalar", type: "number" },
        },
      },
    },
    operations: [`${OBJECT_TYPE}.save`, DELETE_OBJECT_TYPE, SAVE_OBJECT_DETAIL_PANEL, CLEAR_OBJECT_DETAIL_PANEL],
  },
  [ATTRIBUTE]: {
    ...describeType("attribute", "fact"),
    reads: {
      ...modelReads, list: modelListByClass, count: countRead,
      record: {
        ...modelReads.record,
        outputs: {
          isPrimaryKey: { kind: "scalar", type: "boolean" },
          className: { kind: "scalar", type: "string" },
        },
      },
    },
    operations: [`${ATTRIBUTE}.save`, DELETE_ATTRIBUTE, SET_PRIMARY_KEY],
  },
  [RELATIONSHIP]: {
    ...describeType("relationship", "fact"),
    reads: { ...modelReads, list: modelListByClass, count: countRead },
    operations: [`${RELATIONSHIP}.save`, DELETE_RELATIONSHIP],
  },
  [METRIC_VIEW]: {
    ...describeType("metricView", "capability"),
    reads: {
      query: {
        source: "type", parameterMode: "fixed",
        params: {
          search: "keyword",
          status: "metricViewStatus",
          origin: "metricViewOrigin",
          cursor: "cursor",
          size: "size",
        },
        result: "panelRecordQuery",
      },
      ...modelReads,
      result: { source: "object", parameterMode: "owner", parameter: "ontologyParameter", result: "metricOutput" },
    },
    operations: [`${METRIC_VIEW}.save`, SET_METRIC_VIEW_STATUS, DELETE_METRIC_VIEW, TEST_METRIC_VIEW, TEST_EXECUTE_METRIC_VIEW],
  },
  [DASHBOARD]: {
    ...describeType("dashboard"),
    childCollections: ["cards"],
    reads: {
      list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          name: { kind: "scalar", type: "string" },
          groupCount: { kind: "scalar", type: "number" },
          cardCount: { kind: "scalar", type: "number" },
        },
      },
      cards: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: DASHBOARD_CARD },
    },
    operations: [
      CREATE_DASHBOARD,
      RENAME_DASHBOARD,
      DELETE_DASHBOARD,
      SAVE_DASHBOARD_LAYOUT,
      CREATE_DASHBOARD_GROUP,
      RENAME_DASHBOARD_GROUP,
      DELETE_DASHBOARD_GROUP,
    ],
  },
  [DASHBOARD_CARD]: {
    ...describeType("dashboardCard"),
    parentKeyType: DASHBOARD,
    reads: {
      chartTemplate: { source: "object", parameterMode: "fixed", params: {}, result: "chartTemplate" },
      result: { source: "object", parameterMode: "owner", parameter: "ontologyParameter", result: "metricOutput" },
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          name: { kind: "scalar", type: "string" },
          kind: { kind: "scalar", type: "string" },
          metricId: { kind: "scalar", type: "string" },
        },
      },
      form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      metricSource: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
    },
    operations: [
      RENAME_DASHBOARD_CARD,
      DELETE_DASHBOARD_CARD,
      `${DASHBOARD_CARD}.save`,
    ],
  },
  [FUNCTION]: {
    ...describeType("function", "capability"),
    reads: {
      query: {
        source: "type", parameterMode: "fixed",
        params: { search: "keyword", operation: "functionOperation", cursor: "cursor", size: "size" },
        result: "panelRecordQuery",
      },
      ...modelReads,
    },
    operations: [`${FUNCTION}.save`, DELETE_FUNCTION],
  },
  [ACTION]: {
    ...describeType("action", "capability"),
    childCollections: ["parameters", "codeSegments"],
    reads: {
      ...metadataList, count: countRead,
      record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
      form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      createForm: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      definition: { source: "object", parameterMode: "fixed", params: {}, result: "actionDefinition" },
      explanation: { source: "object", parameterMode: "fixed", params: {}, result: "actionExplanation" },
      derivedSummary: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
      derivedEffects: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      derivedParameters: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      derivedConditions: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      annotatedExplanation: { source: "object", parameterMode: "fixed", params: {}, result: "annotatedCode" },
    },
    operations: [`${ACTION}.save`, SET_ACTION_STATUS, DELETE_ACTION],
  },
  [WORKFLOW]: {
    ...describeType("workflow", "capability"),
    reads: {
      ...metadataList, ...definitionQuery, count: countRead,
      record: modelReads.record,
      form: { source: "object", parameterMode: "fixed", params: {}, result: "panelFormDescription" },
      createForm: modelReads.createForm,
      grantCaseScopedSteps: objectListRead,
      grantInForce: objectListRead,
      grantSuperseded: objectListRead,
      grantDirect: objectListRead,
    },
    operations: [`${WORKFLOW}.save`, ACTIVATE_WORKFLOW, DEACTIVATE_WORKFLOW, DELETE_WORKFLOW],
  },
  [TRIGGER]: {
    ...describeType("trigger", "capability"),
    reads: { ...metadataList, ...definitionQuery, ...modelReads, count: countRead, armedCount: countRead },
    operations: [`${TRIGGER}.save`, SET_TRIGGER_STATUS, DELETE_TRIGGER],
  },
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
    operations: [IMPORT_SKILL, DELETE_SKILL, EXPORT_SKILL],
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
      ...governancePageQuery,
      ...modelReads,
      effectivePermissions: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
      effectiveOrgShares: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      effectiveApiPermissions: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      effectiveSubjectDataPermissions: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      effectiveManagedDataPermissions: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      effectiveDataPermissions: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      lookupAccount: {
        source: "type", parameterMode: "fixed", params: { keyword: "keyword", page: "page" }, result: "panelOptionList",
      },
    },
    operations: [
      `${USER}.save`, REMOVE_USER, RESET_USER_PASSWORD, ADD_USER_MEMBER,
      GENERATE_USER_API_KEY, REGENERATE_USER_API_KEY, REVOKE_USER_API_KEY, ISSUE_USER_API_KEY_BATCH,
    ],
  },
  [ROLE]: {
    ...describeType("role", "governance"),
    reads: {
      ...referenceReads,
      options: { source: "type", parameterMode: "fixed", params: { keyword: "keyword", page: "page" }, result: "panelOptionList" },
      ...governancePageQuery,
      ...modelReads,
    },
    operations: [`${ROLE}.save`, DELETE_ROLE],
  },
  [PERMISSION_POLICY]: {
    ...describeType("permissionPolicy", "governance"),
    reads: {
      ...referenceReads,
      ...governancePageQuery,
      ...modelReads,
    },
    operations: [
      `${PERMISSION_POLICY}.save`, DELETE_PERMISSION_POLICY,
      REFRESH_POLICY_API_CATALOG,
    ],
  },
  [ORG_UNIT]: {
    ...describeType("orgUnit", "fact"),
    reads: {
      ...metadataList,
      ...referenceReads,
      record: modelReads.record,
      form: modelReads.form,
      createForm: {
        source: "type", parameterMode: "fixed", params: { ...definitionFormParams, parentId: "keyword" }, result: "panelFormDescription",
      },
      members: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: ORG_MEMBERSHIP },
      memberCandidates: { source: "object", parameterMode: "fixed", params: { keyword: "keyword" }, result: "panelOptionList" },
      positions: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: ORG_POSITION },
      grants: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: ORG_GRANT },
      inheritedGrants: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: ORG_GRANT },
    },
    operations: [`${ORG_UNIT}.save`, DELETE_ORG_UNIT, ADD_ORG_UNIT_MEMBER],
  },
  [ORG_MEMBERSHIP]: {
    ...describeType("orgMembership"),
    reads: { record: modelReads.record },
    operations: [SET_ORG_MEMBERSHIP_LOCKED, REMOVE_ORG_MEMBERSHIP],
  },
  [ORG_POSITION]: {
    ...describeType("orgPosition", "fact"),
    reads: {
      record: modelReads.record,
      form: modelReads.form,
      createForm: {
        source: "type", parameterMode: "fixed", params: { ...definitionFormParams, orgId: "keyword" },
        requiredParams: ["orgId"], result: "panelFormDescription",
      },
    },
    operations: [`${ORG_POSITION}.save`, DELETE_ORG_POSITION],
  },
  [ORG_GRANT]: {
    ...describeType("orgGrant", "governance"),
    reads: { record: modelReads.record, form: modelReads.form },
    operations: [`${ORG_GRANT}.save`, DELETE_ORG_GRANT],
  },
  [SDK_COMPONENT]: {
    ...describeType("sdkComponent", "product"),
    reads: {
      count: countRead,
      catalogue: { source: "type", parameterMode: "fixed", params: { search: "keyword" }, result: "panelRecordList" },
      definition: { source: "object", parameterMode: "fixed", params: {}, result: "sdkComponentDefinition" },
      record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
      dataRows: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      configRows: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      inputRows: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      outputRows: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      operationRows: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
    },
  },
  [PRODUCT_PROJECTION]: {
    ...describeType("productProjection", "product"),
    reads: {
      ...productCatalogueFormReads,
      query: { ...catalogueQuery, result: "panelRecordQuery" },
      record: {
        ...catalogueRecord,
        result: "panelRecord",
        outputs: {
          canEdit: { kind: "scalar", type: "boolean" },
          canGrant: { kind: "scalar", type: "boolean" },
          canDelete: { kind: "scalar", type: "boolean" },
          canCopy: { kind: "scalar", type: "boolean" },
          isBuiltin: { kind: "scalar", type: "boolean" },
          isChart: { kind: "scalar", type: "boolean" },
          domainShared: { kind: "scalar", type: "boolean" },
          revision: { kind: "scalar", type: "number" },
          usedByCount: { kind: "scalar", type: "number" },
          hiddenUsedByCount: { kind: "scalar", type: "number" },
        },
      },
      usedBy: { ...catalogueRecord, result: "productProjectionUsedBy" },
      usedByRows: { ...catalogueRecord, result: "panelRecordList", rowType: PRODUCT_PANEL },
      grants: { ...catalogueRecord, result: "productCatalogueGrants" },
      grantRows: { ...catalogueRecord, result: "panelRecordList" },
      dataRows: { ...catalogueRecord, result: "panelRecordList" },
      configRows: { ...catalogueRecord, result: "panelRecordList" },
      inputRows: { ...catalogueRecord, result: "panelRecordList" },
      outputRows: { ...catalogueRecord, result: "panelRecordList" },
      operationRows: { ...catalogueRecord, result: "panelRecordList" },
    },
    operations: productCatalogueOperations(PRODUCT_PROJECTION, "productProjections"),
  },
  [PRODUCT_PANEL]: {
    ...describeType("productPanel", "product"),
    reads: {
      options: { ...referenceReads.options, params: { keyword: "keyword", page: "page" } },
      ...productCatalogueFormReads,
      query: { ...catalogueQuery, params: { ...catalogueQuery.params, template: "productTemplate" }, result: "panelRecordQuery" },
      unavailable: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      record: {
        ...catalogueRecord,
        result: "panelRecord",
        outputs: {
          canEdit: { kind: "scalar", type: "boolean" },
          canGrant: { kind: "scalar", type: "boolean" },
          canDelete: { kind: "scalar", type: "boolean" },
          isBuiltin: { kind: "scalar", type: "boolean" },
          isTemplate: { kind: "scalar", type: "boolean" },
          domainShared: { kind: "scalar", type: "boolean" },
          revision: { kind: "scalar", type: "number" },
          hiddenUsedByCount: { kind: "scalar", type: "number" },
          unavailable: { kind: "scalar", type: "boolean" },
          unavailableReason: { kind: "scalar", type: "string" },
        },
      },
      usedBy: { ...catalogueRecord, result: "productPanelUsedBy" },
      usedByRows: { ...catalogueRecord, result: "panelRecordList" },
      grants: { ...catalogueRecord, result: "productCatalogueGrants" },
      grantRows: { ...catalogueRecord, result: "panelRecordList" },
      members: { ...catalogueRecord, result: "productPanelMembers" },
      memberRows: { ...catalogueRecord, result: "panelRecordList" },
      sourceFiles: { ...catalogueRecord, result: "panelRecordList" },
      sourceFile: {
        source: "object", parameterMode: "fixed", params: { path: "skillFilePath" },
        requiredParams: ["path"], result: "panelRecord",
      },
    },
    operations: productCatalogueOperations(PRODUCT_PANEL, "productPanels"),
  },
  [APPLICATION]: {
    ...describeType("application", "product"),
    reads: {
      query: {
        source: "type", parameterMode: "fixed",
        params: { search: "keyword", scope: "applicationScope", sort: "applicationSort", cursor: "cursor", size: "size" },
        result: "panelRecordQuery",
      },
      available: {
        source: "type", parameterMode: "fixed",
        params: { category: "applicationGalleryCategory", search: "keyword", favoritesOnly: "favoritesOnly" },
        result: "panelRecordList",
        outputs: {
          openPath: { kind: "scalar", type: "string" },
        },
      },
      record: {
        ...catalogueRecord,
        result: "panelRecord",
        outputs: {
          canMaintain: { kind: "scalar", type: "boolean" },
          canEditEntries: { kind: "scalar", type: "boolean" },
          canGrant: { kind: "scalar", type: "boolean" },
          domainShared: { kind: "scalar", type: "boolean" },
          openPath: { kind: "scalar", type: "string" },
        },
      },
      entries: { ...catalogueRecord, result: "applicationEntries" },
      entryRows: { ...catalogueRecord, result: "panelRecordList" },
      usedPanels: { ...catalogueRecord, result: "panelRecordList", rowType: PRODUCT_PANEL },
      grants: { ...catalogueRecord, result: "productCatalogueGrants" },
      grantRows: { ...catalogueRecord, result: "panelRecordList" },
      form: {
        ...modelReads.form,
        params: { ...definitionFormParams, section: "applicationFormSection", entryId: "applicationEntryId" },
        requiredParams: ["section"],
      },
      createForm: modelReads.createForm,
    },
    operations: [
      `${APPLICATION}.save`, "applications.delete", "applications.addEntry", "applications.updateEntry",
      "applications.deleteEntry", "applications.grant", "applications.share",
      FAVORITE_APPLICATION, UNFAVORITE_APPLICATION, RENEW_SCHEDULED_TASK_CREDENTIAL,
    ],
  },
  [APPLICATION_PANEL_USE]: {
    ...describeType("applicationPanelUse"),
    reads: { visible: { source: "type", parameterMode: "fixed", params: {}, result: "panelApplicationMenu" } },
  },
  [AGENT_DEFINITION]: {
    ...describeType("agentDefinition", "product"),
    reads: {
      ...metadataList, count: countRead,
      available: {
        source: "type", parameterMode: "fixed",
        params: { search: "keyword", favoritesOnly: "favoritesOnly" },
        result: "panelRecordList",
        outputs: {
          openPath: { kind: "scalar", type: "string" },
        },
      },
      record: {
        ...catalogueRecord, result: "panelRecord",
        outputs: {
          category: { kind: "scalar", type: "string" },
          canEdit: { kind: "scalar", type: "boolean" },
          canGrant: { kind: "scalar", type: "boolean" },
          domainShared: { kind: "scalar", type: "boolean" },
        },
      },
      grants: { ...catalogueRecord, result: "productCatalogueGrants" },
      grantRows: { ...catalogueRecord, result: "panelRecordList" },
      form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      createForm: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
    },
    operations: [`${AGENT_DEFINITION}.save`, DELETE_AGENT, FAVORITE_AGENT, UNFAVORITE_AGENT, "agents.grant", "agents.revoke", "agents.share"],
  },
  [ONTOLOGY_TYPE]: {
    ...describeType("ontologyType"),
    reads: {
      schema: { source: "type", parameterMode: "fixed", params: {}, result: "panelGraphSchema" },
      counts: { source: "type", parameterMode: "fixed", params: {}, result: "panelGraphCounts" },
      countRows: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      start: { source: "type", parameterMode: "fixed", params: {}, result: "panelGraphStart" },
      neighbors: {
        source: "type", parameterMode: "fixed", params: { node: "graphNode", relationKinds: "relationKinds", layers: "layers" },
        requiredParams: ["node"], result: "panelGraphNeighbors",
      },
      objects: {
        source: "type", parameterMode: "fixed", params: { type: "ontologyType", search: "keyword", page: "page" },
        requiredParams: ["type"], result: "panelOntologyObjects",
      },
      ...metadataList,
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          directoryPath: { kind: "scalar", type: "string" },
          directoryName: { kind: "scalar", type: "string" },
        },
      },
      properties: ontologyTypeDetailList,
      typeRelations: ontologyTypeDetailList,
      reads: ontologyTypeDetailList,
      operations: ontologyTypeDetailList,
    },
  },
  [ONTOLOGY_RELATION_KIND]: { ...describeType("ontologyRelationKind"), reads: metadataList },
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
    operations: [EXPORT_FEEDBACK],
  },
  [MODEL_CONNECTION]: {
    ...describeType("modelConnection"),
    reads: {
      ...metadataList,
      record: {
        ...modelReads.record,
        outputs: {
          provider: { kind: "scalar", type: "string" },
          supportsEmbeddings: { kind: "scalar", type: "boolean" },
          modelCount: { kind: "scalar", type: "number" },
        },
      },
      form: modelReads.form,
      createForm: modelReads.createForm,
      createModelForm: modelReads.form,
      models: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: MODEL_ENTRY },
      usages: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
    },
    operations: [
      `${MODEL_CONNECTION}.save`,
      DELETE_MODEL_CONNECTION,
      DISCOVER_MODEL_CONNECTION,
      TEST_MODEL_CONNECTION,
      ADD_MODEL_ENTRY,
    ],
  },
  [MODEL_ENTRY]: {
    ...describeType("modelEntry"),
    reads: {
      record: modelReads.record,
      form: modelReads.form,
    },
    operations: [`${MODEL_ENTRY}.save`, DELETE_MODEL_ENTRY],
  },
  [MODEL_USAGE]: {
    ...describeType("modelUsage"),
    reads: {
      form: modelReads.form,
      vectorRebuild: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          configured: { kind: "scalar", type: "boolean" },
          state: { kind: "scalar", type: "string" },
          tone: { kind: "scalar", type: "string" },
          alive: { kind: "scalar", type: "boolean" },
          canRebuild: { kind: "scalar", type: "boolean" },
          canResume: { kind: "scalar", type: "boolean" },
          canPause: { kind: "scalar", type: "boolean" },
        },
      },
    },
    operations: [`${MODEL_USAGE}.save`, REBUILD_VECTORS, PAUSE_VECTOR_REBUILD],
  },
  [OPS_KNOWLEDGE]: {
    ...describeType("opsKnowledge"),
    reads: {
      files: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      record: {
        source: "type", parameterMode: "fixed", params: { path: "opsFilePath" }, requiredParams: ["path"], result: "panelRecord",
      },
    },
  },
  [TURN_EVIDENCE]: {
    ...describeType("turnEvidence"),
    childCollections: ["files", "evidenceRuns", "evidenceGaps"],
    reads: {
      list: { source: "type", parameterMode: "fixed", params: { search: "keyword" }, result: "panelRecordList" },
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          status: { kind: "scalar", type: "string" },
          kept: { kind: "scalar", type: "boolean" },
          hasEvidence: { kind: "scalar", type: "boolean" },
        },
      },
      evidenceRuns: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      evidenceGaps: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      files: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      file: {
        source: "object", parameterMode: "fixed", params: { path: "opsFilePath" }, requiredParams: ["path"], result: "panelRecord",
      },
    },
    operations: [
      BUILD_TURN_EVIDENCE,
      REFRESH_TURN_EVIDENCE,
      KEEP_TURN_EVIDENCE,
      UNKEEP_TURN_EVIDENCE,
      DELETE_TURN_EVIDENCE,
      DOWNLOAD_TURN_EVIDENCE,
    ],
  },
  [AUTOTEST_CASE_SET]: {
    ...describeType("autotestCaseSet"),
    reads: {
      list: { source: "type", parameterMode: "fixed", params: { search: "keyword" }, result: "panelRecordList" },
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          caseCount: { kind: "scalar", type: "number" },
        },
      },
      form: {
        source: "object", parameterMode: "fixed",
        params: { ...definitionFormParams, editMode: "autotestCaseEditMode" },
        result: "panelFormDescription",
      },
    },
    operations: [
      CREATE_AUTOTEST_CASE_SET,
      IMPORT_AUTOTEST_CASE_SET,
      `${AUTOTEST_CASE_SET}.save`,
      DELETE_AUTOTEST_CASE_SET,
    ],
  },
  [AUTOTEST_RUN]: {
    ...describeType("autotestRun"),
    childCollections: ["results"],
    reads: {
      list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          status: { kind: "scalar", type: "string" },
          active: { kind: "scalar", type: "boolean" },
          kept: { kind: "scalar", type: "boolean" },
        },
      },
      results: {
        source: "object", parameterMode: "fixed",
        params: { verdict: "autotestVerdict" },
        result: "panelRecordList",
        rowType: AUTOTEST_CASE_ARTIFACT,
      },
    },
    operations: [
      KEEP_AUTOTEST_RUN,
      UNKEEP_AUTOTEST_RUN,
      DOWNLOAD_AUTOTEST_RUN,
      DELETE_AUTOTEST_RUN,
    ],
  },
  [AUTOTEST_CASE_ARTIFACT]: {
    ...describeType("autotestCaseArtifact"),
    childCollections: ["files", "evidenceRuns", "evidenceGaps"],
    reads: {
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          runId: { kind: "scalar", type: "string" },
          caseId: { kind: "scalar", type: "string" },
          hasEvidence: { kind: "scalar", type: "boolean" },
        },
      },
      evidenceRuns: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      evidenceGaps: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      files: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      file: {
        source: "object", parameterMode: "fixed", params: { path: "opsFilePath" }, requiredParams: ["path"], result: "panelRecord",
      },
    },
    operations: [DOWNLOAD_AUTOTEST_CASE_ARTIFACT],
  },
  [DATA_ADAPTER_CONFIG]: {
    ...describeType("dataAdapterConfig"),
    reads: {
      record: {
        ...modelReads.record,
        outputs: {
          currentType: { kind: "scalar", type: "string" },
          mode: { kind: "scalar", type: "string" },
          configured: { kind: "scalar", type: "boolean" },
        },
      },
      form: modelReads.form,
    },
    operations: [`${DATA_ADAPTER_CONFIG}.save`, TEST_DATA_ADAPTER_CONNECTION],
  },
  [FAVORITE]: {
    ...describeType("favorite"),
    reads: {
      list: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      record: {
        source: "type",
        parameterMode: "fixed",
        params: { object: "graphNode" },
        requiredParams: ["object"],
        result: "panelRecord",
        outputs: {
          favorited: { kind: "scalar", type: "boolean" },
          className: { kind: "scalar", type: "string" },
          primaryKey: { kind: "scalar", type: "string" },
          title: { kind: "scalar", type: "string" },
        },
      },
    },
    operations: [ADD_FAVORITE, REMOVE_FAVORITE],
  },
};

/** Form save IDs other than the default `${typeId}.save`. */
const platformNamedFormSaves: ReadonlySet<string> = new Set([
  CREATE_SCHEDULED_TASK,
  ADD_MODEL_ENTRY,
  CREATE_EXTERNAL_MCP_SERVICE,
  SAVE_OBJECT_DETAIL_PANEL,
]);

/** Platform operation IDs whose server handler is a `form.save` rather than an action. */
export const platformFormSaveOperations: ReadonlySet<string> = new Set(
  Object.entries(platformObjectTypes).flatMap(([typeId, declaration]) =>
    (declaration.operations ?? []).filter(id => id === `${typeId}.save` || platformNamedFormSaves.has(id)),
  ),
);

/** Whether a `PlatformOperation` ID is a registered platform `form.save` operation. */
export function isPlatformFormSaveOperation(operationId: string): boolean {
  return platformFormSaveOperations.has(operationId);
}

/** These families apply to the class or relationship identified by the current domain catalogue. */
export const customerOntologyReads: Readonly<Record<string, PlatformReadDeclaration>> = {
  query: customerQuery,
  record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
  form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
  createForm: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
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
  relation("org-unit.has-child", ORG_UNIT, ORG_UNIT, "java-organization"),
  relation("org-unit.has-position", ORG_UNIT, ORG_POSITION, "java-organization"),
  relation("user.member-of-org-unit", USER, ORG_UNIT, "java-organization"),
  relation("user.holds-org-position", USER, ORG_POSITION, "java-organization"),
  relation("org-grant.applies-to-org-unit", ORG_GRANT, ORG_UNIT, "java-organization"),
  relation("org-grant.applies-to-org-position", ORG_GRANT, ORG_POSITION, "java-organization"),
  relation("org-grant.grants-role", ORG_GRANT, ROLE, "java-organization"),
  relation("role.uses-permission-policy", ROLE, PERMISSION_POLICY, "java-permission-policy"),
  relation("permission-policy.governs-object-type", PERMISSION_POLICY, OBJECT_TYPE, "java-permission-policy"),
  relation("role.can-execute-action", ROLE, ACTION, "java-grants"),
  relation("role.can-author-workflow", ROLE, WORKFLOW, "java-platform-access", true),
  relation("role.owns-workflow-step", ROLE, WORKFLOW, "java-workflow", true),
  relation("role.can-use-product", ROLE, [AGENT_DEFINITION, PRODUCT_PANEL, APPLICATION], "java-product-grants"),
  relation("role.can-view-product", ROLE, AGENT_DEFINITION, "java-product-grants"),
  relation("role.can-edit-product", ROLE, [AGENT_DEFINITION, PRODUCT_PANEL, APPLICATION], "java-product-grants"),
  relation("user.can-use-product", USER, [AGENT_DEFINITION, PRODUCT_PANEL, APPLICATION], "java-product-grants"),
  relation("user.can-view-product", USER, AGENT_DEFINITION, "java-product-grants"),
  relation("user.can-edit-product", USER, [AGENT_DEFINITION, PRODUCT_PANEL, APPLICATION], "java-product-grants"),
  relation("user.created-action", USER, ACTION, "java-action"),
  relation("user.created-workflow", USER, WORKFLOW, "java-workflow"),
  relation("user.created-metric-view", USER, METRIC_VIEW, "java-metric"),
  relation("user.published-action", USER, ACTION, "java-action"),
  relation("user.published-workflow", USER, WORKFLOW, "java-workflow"),
  relation("user.published-metric-view", USER, METRIC_VIEW, "java-metric"),
  relation("projection.uses-component", PRODUCT_PROJECTION, SDK_COMPONENT, "node-product-panels"),
  relation("projection.binds-target", PRODUCT_PROJECTION, declaredTypes, "node-product-panels"),
  relation("panel.contains-projection", PRODUCT_PANEL, PRODUCT_PROJECTION, "node-product-panels"),
  relation("panel.contains-panel", PRODUCT_PANEL, PRODUCT_PANEL, "node-product-panels"),
  relation("panel.provides-skill", PRODUCT_PANEL, SKILL, "node-product-panels", true),
  relation("application.uses-panel", APPLICATION, PRODUCT_PANEL, "java-application-catalog"),
  relation("agent.uses-skill", AGENT_DEFINITION, SKILL, "node-assistant"),
  relation("agent.executes-as-user", AGENT_DEFINITION, USER, "node-assistant"),
];
