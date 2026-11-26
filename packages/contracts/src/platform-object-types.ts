import { z } from "zod";


export const DASHBOARD = "platform:Dashboard";
export const DASHBOARD_CARD = "platform:DashboardCard";
export const FAVORITE = "platform:Favorite";
export const RECENT_VISIT = "platform:RecentVisit";
export const AGENT_SESSION = "platform:AgentSession";
export const EXECUTE_OBJECT_ACTION = "actions.execute";
export const AGENT_DEFINITION = "platform:AgentDefinition";
export type AgentDefinitionCategory = "custom" | "preset" | "system";
export const SKILL = "platform:Skill";
export const MODEL_OPTION = "platform:ModelOption";
export const PUBLISHED_MCP_SERVICE = "platform:PublishedMcpService";
export const EXTERNAL_MCP_SERVICE = "platform:ExternalMcpService";
export const CREATE_EXTERNAL_MCP_SERVICE = `${EXTERNAL_MCP_SERVICE}.create`;
export const CHECK_EXTERNAL_MCP_SERVICE = "externalMcp.check";
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
export const DSL_QUERY = "platform:DslQuery";

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
export const APPLICATION_CREATE_DRAFT = "applications.createDraft";
export const APPLICATION_UPDATE_BUILDER_META = "applications.updateBuilderMeta";
export const APPLICATION_DELETE_DRAFT = "applications.deleteDraft";
export const APPLICATION_RESTORE_SOURCE_COMMIT = "applications.restoreSourceCommit";
export const APPLICATION_SYNC_BUILDER_SOURCE = "applications.syncBuilderSource";
export const APPLICATION_PUBLISH_BUILDER_SOURCE = "applications.publishBuilderSource";
export const APPLICATION_ROLLBACK_BUILDER_RELEASE = "applications.rollbackBuilderRelease";
export const APPLICATION_RESTART_BUILD_TEST = "applications.restartBuildTest";
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

export const RUN_NOW = "triggers.runNow";
export const CREATE_TRIGGER = "triggers.create";
export const SET_TRIGGER_ENABLED = "triggers.setEnabled";
export const RENEW_TRIGGER_CREDENTIAL = "triggers.renewCredential";
export const DELETE_AGENT = "agents.delete";
export const ADD_FAVORITE = "favorites.add";
export const REMOVE_FAVORITE = "favorites.remove";
export const MOVE_FAVORITE = "favorites.move";
export const RENAME_AGENT_SESSION = "agentSessions.rename";
export const DELETE_AGENT_SESSION = "agentSessions.delete";
export const SET_HOME_PANEL = "productPanels.setAsHome";
export const RESET_HOME_PANEL = "productPanels.resetHome";
export const SET_ACTION_STATUS = "actions.setStatus";
export const TRIAL_ACTION = "actions.trial";
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
export const EXECUTE_DSL_QUERY = "dslQuery.execute";
export const DELETE_MODEL_CONNECTION = "modelConnections.delete";
export const DISCOVER_MODEL_CONNECTION = "modelConnections.discover";
export const TEST_MODEL_CONNECTION = "modelConnections.test";
export const ADD_MODEL_ENTRY = "modelConnections.addModel";
export const DELETE_MODEL_ENTRY = "modelEntries.delete";
export const REBUILD_VECTORS = "modelUsage.rebuildVectors";
export const PAUSE_VECTOR_REBUILD = "modelUsage.pauseVectorRebuild";
export const CHECK_DATA_ADAPTER_SANDBOX_PERMISSION = "dataAdapters.checkSandboxPermission";
export const CHECK_ACTION_SANDBOX_PERMISSION = "actions.checkSandboxPermission";
export const TEST_DATA_ADAPTER_CONNECTION = "dataAdapters.testConnection";
export const SAVE_DATA_ADAPTER_ROUTING = `${DATA_ADAPTER_CONFIG}.saveRouting`;
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
export const READ_MEMBER_ACCESS_CONTEXT = "users.accessContext";
export const INSPECT_MEMBER_ACCESS = "users.inspectAccess";
export const GRANT_MEMBER_ACCESS = "users.grantAccess";
export const DELETE_ROLE = "roles.delete";
export const DELETE_PERMISSION_POLICY = "permissionPolicies.delete";
export const REFRESH_POLICY_API_CATALOG = "permissionPolicies.refreshApiCatalog";
export const PREVIEW_POLICY_ENTRY_GRANT = "permissionPolicies.previewEntryGrant";
export const GRANT_POLICY_ENTRIES = "permissionPolicies.grantEntries";
export const LIST_PENDING_POLICY_GRANTS = "permissionPolicies.listPending";
export const RESOLVE_PENDING_POLICY_GRANT = "permissionPolicies.resolvePending";
export const INSPECT_POLICY_ACCESS = "permissionPolicies.inspectAccess";
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
const actionTrialOutputs = {
  actionStatus: { kind: "scalar", type: "string" },
  trialStatus: { kind: "scalar", type: "string" },
  trialStatusLabel: { kind: "scalar", type: "string" },
  lastTrialAt: { kind: "scalar", type: "string" },
  lastTrialError: { kind: "scalar", type: "string" },
  publishBlockedCode: { kind: "scalar", type: "string" },
  publishBlockedReason: { kind: "scalar", type: "string" },
} as const satisfies Readonly<Record<string, PanelReadOutputType>>;
const objectListRead = { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" } as const;
const countRead = { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordQuery" } as const;
const ontologyTypeDetailList = {
  source: "type", parameterMode: "fixed", params: { type: "ontologyType" },
  requiredParams: ["type"], result: "panelRecordList",
} as const satisfies PlatformReadDeclaration;
/** Every expanded edge that starts at or ends on the type, one row per edge rather than per relation kind. */
const ontologyTypeRelationList = {
  ...ontologyTypeDetailList, rowType: ONTOLOGY_RELATION_KIND,
} as const satisfies PlatformReadDeclaration;
const ontologyInstanceDetailPath = { kind: "scalar", type: "string" } as const;
/** Where the owner's own modeling editor opens the selected class or relation. */
const modelingPathOutput = { kind: "scalar", type: "string" } as const;
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

const triggerRowOutputs = {
  definitionStatus: { kind: "scalar", type: "string" },
  targetKind: { kind: "scalar", type: "string" },
  revision: { kind: "scalar", type: "number" },
  enabled: { kind: "scalar", type: "boolean" },
  paused: { kind: "scalar", type: "boolean" },
  pauseCode: { kind: "scalar", type: "string" },
  latestResultPath: { kind: "scalar", type: "string" },
  hasEarlierResult: { kind: "scalar", type: "boolean" },
  lastRunStatus: { kind: "scalar", type: "string" },
  isRunning: { kind: "scalar", type: "boolean" },
  needsIntervention: { kind: "scalar", type: "boolean" },
  attentionGroup: { kind: "scalar", type: "string" },
  latestRunId: { kind: "scalar", type: "string" },
  openPath: { kind: "scalar", type: "string" },
} as const;

/** Type-level metadata shared by projection bindings and ontology catalogues. */
export const platformObjectTypes: Readonly<Record<string, PlatformObjectTypeDeclaration>> = {
  [TRIGGER]: {
    ...describeType("trigger", "capability"),
    reads: {
      count: countRead,
      list: {
        source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList",
        outputs: triggerRowOutputs,
      },
      catalogue: {
        source: "type", parameterMode: "fixed", params: { scope: "keyword", search: "keyword", status: "keyword" }, result: "panelRecordList",
        outputs: triggerRowOutputs,
      },
      counts: { source: "type", parameterMode: "fixed", params: { by: "keyword" }, result: "panelGroupCounts" },
      status: {
        source: "type", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          hasCredentialPaused: { kind: "scalar", type: "boolean" },
          credentialStatus: { kind: "scalar", type: "string" },
        },
      },
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: triggerRowOutputs,
      },
      form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      createForm: { source: "type", parameterMode: "fixed", params: { ...definitionFormParams, defaultAppId: "keyword" }, result: "panelFormDescription" },
      memberOptions: { source: "type", parameterMode: "fixed", params: { keyword: "keyword", page: "page" }, result: "panelOptionList" },
      memberResolve: { source: "type", parameterMode: "fixed", params: { values: "optionValues" }, requiredParams: ["values"], result: "panelOptionList" },
      runs: { source: "object", parameterMode: "fixed", params: { cursor: "cursor" }, result: "scheduledTaskRunPage" },
      run: {
        source: "object", parameterMode: "fixed", params: { runId: "scheduledRunId" },
        requiredParams: ["runId"], result: "scheduledTaskRun",
      },
      runRecords: { source: "object", parameterMode: "fixed", params: { cursor: "cursor" }, result: "panelRecordQuery" },
      runRecord: {
        source: "object", parameterMode: "fixed", params: { runId: "scheduledRunId" }, result: "panelRecord",
        outputs: {
          status: { kind: "scalar", type: "string" },
          resultPath: { kind: "scalar", type: "string" },
          isRunning: { kind: "scalar", type: "boolean" },
        },
      },
    },
    operations: [`${TRIGGER}.save`, CREATE_TRIGGER, SET_TRIGGER_ENABLED, SET_TRIGGER_STATUS, DELETE_TRIGGER, RUN_NOW],
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
    operations: [CREATE_EXTERNAL_MCP_SERVICE, `${EXTERNAL_MCP_SERVICE}.save`, CHECK_EXTERNAL_MCP_SERVICE, DELETE_EXTERNAL_MCP_SERVICE],
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
      instances: {
        ...customerQuery, params: { className: "className", ...customerQueryParams }, requiredParams: ["className"],
        outputs: { detailPath: ontologyInstanceDetailPath },
      },
      instanceRecord: {
        source: "type", parameterMode: "fixed", params: { object: "graphNode" },
        requiredParams: ["object"], result: "panelRecord",
        outputs: { typeLabel: { kind: "scalar", type: "string" }, detailPath: ontologyInstanceDetailPath },
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
      instanceGraphClasses: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
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
      inlineForm: modelReads.form,
      productGraph: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecord" },
      record: {
        ...modelReads.record,
        outputs: {
          modelingPath: modelingPathOutput,
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
      inlineForm: modelReads.form,
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
    reads: {
      ...modelReads, list: modelListByClass, count: countRead,
      record: { ...modelReads.record, outputs: { modelingPath: modelingPathOutput } },
    },
    operations: [`${RELATIONSHIP}.save`, DELETE_RELATIONSHIP],
  },
  [METRIC_VIEW]: {
    ...describeType("metricView", "capability"),
    reads: {
      count: countRead,
      list: {
        source: "type", parameterMode: "fixed",
        params: {
          search: "keyword",
          status: "metricViewStatus",
          origin: "metricViewOrigin",
        },
        result: "panelRecordQuery",
      },
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
      list: {
        source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList",
        outputs: {
          openPath: { kind: "scalar", type: "string" },
          favorited: { kind: "scalar", type: "boolean" },
        },
      },
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          name: { kind: "scalar", type: "string" },
          groupCount: { kind: "scalar", type: "number" },
          cardCount: { kind: "scalar", type: "number" },
          openPath: { kind: "scalar", type: "string" },
          favorited: { kind: "scalar", type: "boolean" },
        },
      },
      cards: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: DASHBOARD_CARD,
        outputs: {
          name: { kind: "scalar", type: "string" },
          kind: { kind: "scalar", type: "string" },
          metricId: { kind: "scalar", type: "string" },
          openPath: { kind: "scalar", type: "string" },
          favorited: { kind: "scalar", type: "boolean" },
        },
      },
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
      count: countRead,
      list: {
        source: "type", parameterMode: "fixed",
        params: { search: "keyword", operation: "functionOperation" },
        result: "panelRecordQuery",
      },
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
      record: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord", outputs: actionTrialOutputs },
      trialSummary: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord", outputs: actionTrialOutputs },
      form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      createForm: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      definition: { source: "object", parameterMode: "fixed", params: {}, result: "actionDefinition" },
      explanation: { source: "object", parameterMode: "fixed", params: {}, result: "actionExplanation" },
      derivedSummary: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecord" },
      derivedEffects: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      derivedParameters: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      derivedConditions: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      annotatedExplanation: { source: "object", parameterMode: "fixed", params: {}, result: "annotatedCode" },
      sandboxCapability: {
        source: "type", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          sandboxStatus: { kind: "scalar", type: "string" },
          sandboxSupported: { kind: "scalar", type: "boolean" },
          sandboxCanCreateAndDrop: { kind: "scalar", type: "boolean" },
          sandboxReason: { kind: "scalar", type: "string" },
          sandboxProbeNote: { kind: "scalar", type: "string" },
        },
      },
    },
    operations: [`${ACTION}.save`, SET_ACTION_STATUS, TRIAL_ACTION, DELETE_ACTION, CHECK_ACTION_SANDBOX_PERMISSION],
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
  [SKILL]: {
    ...describeType("skill", "capability"),
    childCollections: ["files"],
    reads: {
      count: countRead,
      // `options` and `resolve` pick skills for an agent; `query` is the library catalogue, read-only provider packages included.
      options: {
        ...referenceReads.options, params: { agentTarget: "agentSkillTarget" }, requiredParams: ["agentTarget"],
      },
      resolve: {
        ...referenceReads.resolve, params: { agentTarget: "agentSkillTarget", values: "optionValues" },
        requiredParams: ["agentTarget", "values"],
      },
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
      count: countRead,
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
      count: countRead,
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
      READ_MEMBER_ACCESS_CONTEXT, INSPECT_MEMBER_ACCESS, GRANT_MEMBER_ACCESS,
    ],
  },
  [ROLE]: {
    ...describeType("role", "governance"),
    reads: {
      count: countRead,
      ...referenceReads,
      options: { source: "type", parameterMode: "fixed", params: { keyword: "keyword", page: "page" }, result: "panelOptionList" },
      ...governancePageQuery,
      ...modelReads,
      // What this role brings to whoever holds it: the permission policies it uses, and the workflow steps it owns.
      contributionPolicies: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: PERMISSION_POLICY },
      contributionWorkflowSteps: { source: "object", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: WORKFLOW },
    },
    operations: [`${ROLE}.save`, DELETE_ROLE],
  },
  [PERMISSION_POLICY]: {
    ...describeType("permissionPolicy", "governance"),
    reads: {
      count: countRead,
      ...referenceReads,
      ...governancePageQuery,
      ...modelReads,
    },
    operations: [
      `${PERMISSION_POLICY}.save`, DELETE_PERMISSION_POLICY,
      REFRESH_POLICY_API_CATALOG, PREVIEW_POLICY_ENTRY_GRANT, GRANT_POLICY_ENTRIES,
      LIST_PENDING_POLICY_GRANTS, RESOLVE_PENDING_POLICY_GRANT, INSPECT_POLICY_ACCESS,
    ],
  },
  [ORG_UNIT]: {
    ...describeType("orgUnit", "fact"),
    reads: {
      count: countRead,
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
      query: {
        ...catalogueQuery,
        params: {
          ...catalogueQuery.params,
          componentId: "productProjectionComponent",
          objectType: "productProjectionObjectType",
        },
        result: "panelRecordQuery",
      },
      componentOptions: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: SDK_COMPONENT },
      objectTypeOptions: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList", rowType: ONTOLOGY_TYPE },
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
      referenceGraph: { ...catalogueRecord, result: "panelRecord" },
      grants: { ...catalogueRecord, result: "productObjectAccess" },
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
      referenceGraph: { ...catalogueRecord, result: "panelRecord" },
      grants: { ...catalogueRecord, result: "productObjectAccess" },
      grantRows: { ...catalogueRecord, result: "panelRecordList" },
      members: { ...catalogueRecord, result: "productPanelMembers" },
      memberRows: { ...catalogueRecord, result: "panelRecordList" },
      sourceFiles: { ...catalogueRecord, result: "panelRecordList" },
      sourceFile: {
        source: "object", parameterMode: "fixed", params: { path: "skillFilePath" },
        requiredParams: ["path"], result: "panelRecord",
      },
      homePanel: {
        source: "type", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          isCustomHome: { kind: "scalar", type: "boolean" },
          panelId: { kind: "scalar", type: "string" },
          unavailable: { kind: "scalar", type: "boolean" },
        },
      },
    },
    operations: [...productCatalogueOperations(PRODUCT_PANEL, "productPanels"), SET_HOME_PANEL, RESET_HOME_PANEL],
  },
  [APPLICATION]: {
    ...describeType("application", "product"),
    reads: {
      count: countRead,
      query: {
        source: "type", parameterMode: "fixed",
        params: { search: "keyword", scope: "applicationScope", sort: "applicationSort", cursor: "cursor", size: "size" },
        result: "panelRecordQuery",
      },
      available: {
        source: "type", parameterMode: "fixed",
        params: { category: "applicationGalleryCategory", search: "keyword", favoritesOnly: "favoritesOnly" },
        result: "panelRecordQuery",
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
          openPath: { kind: "scalar", type: "string" },
        },
      },
      entries: { ...catalogueRecord, result: "applicationEntries" },
      entryRows: { ...catalogueRecord, result: "panelRecordList" },
      usedPanels: { ...catalogueRecord, result: "panelRecordList", rowType: PRODUCT_PANEL },
      referenceGraph: { ...catalogueRecord, result: "panelRecord" },
      form: {
        ...modelReads.form,
        params: { ...definitionFormParams, section: "applicationFormSection", entryId: "applicationEntryId" },
        requiredParams: ["section"],
      },
      createForm: modelReads.createForm,
      builderProjects: {
        source: "type",
        parameterMode: "fixed",
        params: { search: "keyword" },
        result: "panelRecordList",
      },
      builderProject: {
        source: "object",
        parameterMode: "fixed",
        params: {},
        result: "panelRecord",
        outputs: {
          appId: { kind: "scalar", type: "string" },
          name: { kind: "scalar", type: "string" },
          icon: { kind: "scalar", type: "string" },
          published: { kind: "scalar", type: "boolean" },
          workspaceId: { kind: "scalar", type: "string" },
          busy: { kind: "scalar", type: "boolean" },
          materialized: { kind: "scalar", type: "boolean" },
          sourceKind: { kind: "scalar", type: "string" },
          headCommit: { kind: "scalar", type: "string" },
          shortHeadCommit: { kind: "scalar", type: "string" },
          openPath: { kind: "scalar", type: "string" },
          managePath: { kind: "scalar", type: "string" },
          hasDrift: { kind: "scalar", type: "boolean" },
          driftCount: { kind: "scalar", type: "number" },
          hasConflicts: { kind: "scalar", type: "boolean" },
          conflictCount: { kind: "scalar", type: "number" },
          buildTestStatus: { kind: "scalar", type: "string" },
          buildTestSampleName: { kind: "scalar", type: "string" },
          buildTestExpiresAt: { kind: "scalar", type: "string" },
          buildTestCanRestart: { kind: "scalar", type: "boolean" },
          canEditEntries: { kind: "scalar", type: "boolean" },
          currentReleaseId: { kind: "scalar", type: "string" },
          activeRunId: { kind: "scalar", type: "string" },
          driftItemsJson: { kind: "scalar", type: "string" },
          conflictFilesJson: { kind: "scalar", type: "string" },
          previewEntriesJson: { kind: "scalar", type: "string" },
        },
      },
      builderSessions: {
        source: "object",
        parameterMode: "fixed",
        params: { cursor: "cursor", size: "size", limit: "limit" },
        result: "panelRecordQuery",
        rowType: AGENT_SESSION,
      },
      sourceFiles: {
        source: "object",
        parameterMode: "fixed",
        params: { commit: "workspaceCommit" },
        result: "panelRecordList",
      },
      sourceFile: {
        source: "object",
        parameterMode: "fixed",
        params: { path: "workspacePath", commit: "workspaceCommit" },
        requiredParams: ["path"],
        result: "panelRecord",
      },
      sourceCommits: {
        source: "object",
        parameterMode: "fixed",
        params: { cursor: "cursor", size: "size", offset: "offset", limit: "limit" },
        result: "panelRecordQuery",
      },
      sourceDiff: {
        source: "object",
        parameterMode: "fixed",
        params: { target: "workspaceDiffTarget" },
        result: "panelRecord",
      },
      sourceReleases: {
        source: "object",
        parameterMode: "fixed",
        params: {},
        result: "panelRecordList",
      },
      builderCreateForm: {
        source: "type",
        parameterMode: "fixed",
        params: definitionFormParams,
        result: "panelFormDescription",
      },
      builderMetaForm: {
        source: "object",
        parameterMode: "fixed",
        params: definitionFormParams,
        result: "panelFormDescription",
      },
      builderPublishForm: {
        source: "object",
        parameterMode: "fixed",
        params: { ...definitionFormParams, defaultCommit: "workspaceCommit" },
        result: "panelFormDescription",
      },
    },
    operations: [
      `${APPLICATION}.save`, "applications.delete", "applications.addEntry", "applications.updateEntry",
      "applications.deleteEntry",
      APPLICATION_CREATE_DRAFT, APPLICATION_UPDATE_BUILDER_META, APPLICATION_DELETE_DRAFT,
      APPLICATION_RESTORE_SOURCE_COMMIT, APPLICATION_SYNC_BUILDER_SOURCE,
      APPLICATION_PUBLISH_BUILDER_SOURCE, APPLICATION_ROLLBACK_BUILDER_RELEASE,
      APPLICATION_RESTART_BUILD_TEST,
      RENEW_TRIGGER_CREDENTIAL,
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
      grants: { ...catalogueRecord, result: "agentObjectAccess" },
      grantRows: { ...catalogueRecord, result: "panelRecordList" },
      form: { source: "object", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
      createForm: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
    },
    operations: [`${AGENT_DEFINITION}.save`, DELETE_AGENT, "agents.grant", "agents.revoke", "agents.share"],
  },
  [ONTOLOGY_TYPE]: {
    ...describeType("ontologyType"),
    reads: {
      count: countRead,
      counts: { source: "type", parameterMode: "fixed", params: {}, result: "panelGraphCounts" },
      countRows: { source: "type", parameterMode: "fixed", params: {}, result: "panelRecordList" },
      start: { source: "type", parameterMode: "fixed", params: {}, result: "panelGraphStart" },
      neighbors: {
        source: "type", parameterMode: "fixed", params: {
          node: "graphNode", relationKinds: "relationKinds", layers: "layers", targetClass: "className",
          direction: "neighborDirection", limit: "neighborsLimit", offset: "nonNegativeInt",
        },
        requiredParams: ["node"], result: "panelGraphNeighbors",
      },
      ...metadataList,
      graphNodes: metadataList.list,
      instanceGraphClasses: metadataList.list,
      instanceSearch: {
        source: "type", parameterMode: "fixed",
        params: { search: "keyword", className: "className", page: "page" }, result: "panelRecordQuery",
      },
      instances: {
        source: "type", parameterMode: "fixed",
        params: { className: "className", search: "keyword", page: "page", size: "size" },
        requiredParams: ["className"], result: "panelRecordQuery",
        outputs: { detailPath: ontologyInstanceDetailPath },
      },
      instanceRecord: {
        source: "type", parameterMode: "fixed", params: { object: "graphNode" },
        requiredParams: ["object"], result: "panelRecord",
        outputs: { typeLabel: { kind: "scalar", type: "string" }, detailPath: ontologyInstanceDetailPath },
      },
      record: {
        source: "object", parameterMode: "fixed", params: {}, result: "panelRecord",
        outputs: {
          directoryPath: { kind: "scalar", type: "string" },
          directoryName: { kind: "scalar", type: "string" },
        },
      },
      properties: ontologyTypeDetailList,
      typeRelations: ontologyTypeRelationList,
      reads: ontologyTypeDetailList,
      operations: ontologyTypeDetailList,
    },
  },
  [ONTOLOGY_RELATION_KIND]: {
    ...describeType("ontologyRelationKind"),
    reads: { ...metadataList, count: countRead, graphEdges: metadataList.list, record: modelReads.record },
  },
  [FEEDBACK_RECORD]: {
    ...describeType("feedbackRecord"),
    reads: {
      query: {
        source: "type", parameterMode: "fixed",
        params: { search: "keyword", sourceType: "feedbackSourceType", rating: "feedbackRating", page: "page", size: "size" },
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
          existingModelIds: { kind: "scalar", type: "string" },
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
  [DSL_QUERY]: {
    ...describeType("dslQuery"),
    reads: {
      form: { source: "type", parameterMode: "fixed", params: definitionFormParams, result: "panelFormDescription" },
    },
    operations: [EXECUTE_DSL_QUERY],
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
          sandboxStatus: { kind: "scalar", type: "string" },
          sandboxSupported: { kind: "scalar", type: "boolean" },
          sandboxCanCreateAndDrop: { kind: "scalar", type: "boolean" },
          sandboxReason: { kind: "scalar", type: "string" },
          sandboxProbeNote: { kind: "scalar", type: "string" },
        },
      },
      form: modelReads.form,
      routingForm: modelReads.form,
    },
    operations: [`${DATA_ADAPTER_CONFIG}.save`, SAVE_DATA_ADAPTER_ROUTING, TEST_DATA_ADAPTER_CONNECTION, CHECK_DATA_ADAPTER_SANDBOX_PERMISSION],
  },
  [FAVORITE]: {
    ...describeType("favorite"),
    reads: {
      list: {
        source: "type",
        parameterMode: "fixed",
        params: { targetGroup: "favoriteTargetGroup" },
        result: "panelRecordList",
        outputs: {
          openPath: { kind: "scalar", type: "string" },
          favorited: { kind: "scalar", type: "boolean" },
          canMoveUp: { kind: "scalar", type: "boolean" },
          canMoveDown: { kind: "scalar", type: "boolean" },
          unavailable: { kind: "scalar", type: "boolean" },
        },
      },
      status: {
        source: "type",
        parameterMode: "fixed",
        params: { object: "graphNode", objectType: "keyword", primaryKey: "keyword" },
        result: "panelRecord",
        outputs: {
          favorited: { kind: "scalar", type: "boolean" },
          className: { kind: "scalar", type: "string" },
          primaryKey: { kind: "scalar", type: "string" },
          title: { kind: "scalar", type: "string" },
        },
      },
      dashboardCardsStatus: {
        source: "type",
        parameterMode: "fixed",
        params: {},
        result: "panelRecord",
        outputs: {
          missingCount: { kind: "scalar", type: "number" },
          metricCount: { kind: "scalar", type: "number" },
          chartCount: { kind: "scalar", type: "number" },
        },
      },
    },
    operations: [ADD_FAVORITE, REMOVE_FAVORITE, MOVE_FAVORITE],
  },
  [RECENT_VISIT]: {
    ...describeType("recentVisit"),
    reads: {
      list: {
        source: "type",
        parameterMode: "fixed",
        params: { limit: "size" },
        result: "panelRecordList",
        outputs: {
          openPath: { kind: "scalar", type: "string" },
        },
      },
    },
  },
  [AGENT_SESSION]: {
    ...describeType("agentSession"),
    reads: {
      list: {
        source: "type",
        parameterMode: "fixed",
        params: { search: "keyword", limit: "size", agentKind: "agentKind", agentId: "agentId" },
        result: "panelRecordList",
        outputs: {
          openPath: { kind: "scalar", type: "string" },
          favorited: { kind: "scalar", type: "boolean" },
        },
      },
      record: {
        source: "object",
        parameterMode: "fixed",
        params: {},
        result: "panelRecord",
        outputs: {
          openPath: { kind: "scalar", type: "string" },
          favorited: { kind: "scalar", type: "boolean" },
        },
      },
    },
    operations: [RENAME_AGENT_SESSION, DELETE_AGENT_SESSION],
  },
};

/** Form save IDs other than the default `${typeId}.save`. */
const platformNamedFormSaves: ReadonlySet<string> = new Set([
  APPLICATION_CREATE_DRAFT,
  APPLICATION_UPDATE_BUILDER_META,
  APPLICATION_PUBLISH_BUILDER_SOURCE,
  CREATE_TRIGGER,
  ADD_MODEL_ENTRY,
  CREATE_EXTERNAL_MCP_SERVICE,
  SAVE_OBJECT_DETAIL_PANEL,
  SAVE_DATA_ADAPTER_ROUTING,
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
    source: "type", parameterMode: "fixed", params: { node: "graphNode", relationKinds: "relationKinds", limit: "neighborsLimit", offset: "nonNegativeInt" },
    requiredParams: ["node"], result: "panelRelationNeighbors",
  },
};
export function platformHasChildCollection(parentType: string, collection: string): boolean {
  return platformObjectTypes[parentType]?.childCollections?.includes(collection) ?? false;
}

const identifier = z.string().min(1);

/** The engineering purpose a relation kind is filtered by; the panel shows one section per group. */
export const platformRelationGroups = ["structure", "dependency", "assembly", "authorization", "organization"] as const;
export type PlatformRelationGroup = typeof platformRelationGroups[number];

export const platformRelationKindDeclarationSchema = z.object({
  id: identifier,
  from: identifier,
  to: z.union([identifier, z.array(identifier)]),
  labelKey: identifier,
  label: z.string().min(1).optional(),
  derived: z.boolean(),
  owner: identifier,
  group: z.enum(platformRelationGroups),
  /** Present as `false` when the type graph draws one sentence (`platformOntology.relationNotes.<id>`) instead of this kind's target edges. */
  typeEdges: z.literal(false).optional(),
}).strict();
export type PlatformRelationKindDeclaration = z.infer<typeof platformRelationKindDeclarationSchema>;

const relation = (
  id: string, from: string, to: PlatformRelationKindDeclaration["to"], owner: string,
  group: PlatformRelationGroup, derived = false, typeEdges?: false,
): PlatformRelationKindDeclaration => ({
  id, from, to, labelKey: `platformOntology.relations.${id}`, derived, owner, group, ...(typeEdges === false && { typeEdges }),
});

const layeredTypes = Object.keys(platformObjectTypes).filter(id => platformObjectTypes[id].layer);

/** The declared topology and the owner each instance lookup must ask. */
export const platformRelationKinds: readonly PlatformRelationKindDeclaration[] = [
  relation("object-type.has-attribute", OBJECT_TYPE, ATTRIBUTE, "java-ontology", "structure"),
  relation("relationship.from-object-type", RELATIONSHIP, OBJECT_TYPE, "java-ontology", "structure"),
  relation("relationship.to-object-type", RELATIONSHIP, OBJECT_TYPE, "java-ontology", "structure"),
  relation("metric-view.uses-function", METRIC_VIEW, FUNCTION, "java-metric", "dependency"),
  relation("action.uses-function", ACTION, FUNCTION, "java-action", "dependency"),
  relation("function.reads-object-type", FUNCTION, OBJECT_TYPE, "java-function", "dependency"),
  relation("action.targets-object-type", ACTION, OBJECT_TYPE, "java-action", "dependency"),
  relation("definition.based-on-object-type", DEFINITION, OBJECT_TYPE, "node-business-definitions", "dependency"),
  relation("workflow.step-references-action", WORKFLOW, ACTION, "java-workflow", "dependency"),
  relation("trigger.targets-workflow", TRIGGER, WORKFLOW, "java-trigger", "dependency"),
  relation("trigger.targets-action", TRIGGER, ACTION, "java-trigger", "dependency"),
  relation("user.holds-role", USER, ROLE, "java-identity", "organization"),
  relation("org-unit.has-child", ORG_UNIT, ORG_UNIT, "java-organization", "organization"),
  relation("org-unit.has-position", ORG_UNIT, ORG_POSITION, "java-organization", "organization"),
  relation("user.member-of-org-unit", USER, ORG_UNIT, "java-organization", "organization"),
  relation("user.holds-org-position", USER, ORG_POSITION, "java-organization", "organization"),
  relation("org-grant.applies-to-org-unit", ORG_GRANT, ORG_UNIT, "java-organization", "organization"),
  relation("org-grant.applies-to-org-position", ORG_GRANT, ORG_POSITION, "java-organization", "organization"),
  relation("org-grant.grants-role", ORG_GRANT, ROLE, "java-organization", "organization"),
  relation("role.uses-permission-policy", ROLE, PERMISSION_POLICY, "java-permission-policy", "authorization"),
  relation("permission-policy.governs-object-type", PERMISSION_POLICY, OBJECT_TYPE, "java-permission-policy", "authorization"),
  relation("permission-policy.can-enter-application", PERMISSION_POLICY, APPLICATION, "java-authorization", "authorization"),
  relation("permission-policy.can-execute-action", PERMISSION_POLICY, ACTION, "java-authorization", "authorization"),
  relation("permission-policy.can-use-object", PERMISSION_POLICY,
    [PRODUCT_PANEL, PRODUCT_PROJECTION, SDK_COMPONENT, AGENT_DEFINITION, METRIC_VIEW, FUNCTION, WORKFLOW, TRIGGER],
    "java-authorization", "authorization"),
  relation("role.owns-workflow-step", ROLE, WORKFLOW, "java-workflow", "authorization", true),
  relation("projection.uses-component", PRODUCT_PROJECTION, SDK_COMPONENT, "node-product-panels", "assembly"),
  relation("projection.binds-target", PRODUCT_PROJECTION, layeredTypes, "node-product-panels", "assembly", false, false),
  relation("panel.contains-projection", PRODUCT_PANEL, PRODUCT_PROJECTION, "node-product-panels", "assembly"),
  relation("panel.contains-panel", PRODUCT_PANEL, PRODUCT_PANEL, "node-product-panels", "assembly"),
  relation("panel.provides-skill", PRODUCT_PANEL, SKILL, "node-product-panels", "assembly", true),
  relation("application.uses-panel", APPLICATION, PRODUCT_PANEL, "java-application-catalog", "assembly"),
  relation("agent.uses-skill", AGENT_DEFINITION, SKILL, "node-assistant", "dependency"),
  relation("agent.executes-as-user", AGENT_DEFINITION, USER, "node-assistant", "dependency"),
];
