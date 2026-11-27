import { EXECUTION_CONTEXT_HEADER } from "@ontomato/contracts/execution-context";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import {
  AGENT_DEFINITION, BUSINESS_KNOWLEDGE, FEEDBACK_RECORD, MODEL_OPTION, SKILL, USER,
} from "@ontomato/contracts/panel-client-requests";
import { panelReadParameterSchemas } from "@ontomato/contracts/panel-projection";
import {
  AGENT_SESSION, AUDIT_LOG, AUTOTEST_CASE_ARTIFACT, AUTOTEST_CASE_SET, AUTOTEST_RUN, DATA_ADAPTER_CONFIG, DSL_QUERY,
  EXTERNAL_MCP_SERVICE, FAVORITE, GENERAL_SETTINGS, MODEL_CONNECTION, MODEL_ENTRY, MODEL_USAGE, OPS_KNOWLEDGE,
  PUBLISHED_MCP_SERVICE, RECENT_VISIT, TURN_EVIDENCE, ACTION, APPLICATION, ATTRIBUTE, DASHBOARD, DASHBOARD_CARD,
  FUNCTION, METRIC_VIEW, OBJECT_TYPE, ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE, ORG_GRANT, ORG_MEMBERSHIP, ORG_POSITION,
  ORG_UNIT, PERMISSION_POLICY, PRODUCT_PANEL, PRODUCT_PROJECTION, RELATIONSHIP, ROLE, SDK_COMPONENT, TRIGGER, WORKFLOW,
} from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import { readPrincipalDirectory } from "../identity/principal-directory";
import type { ProductOwner } from "../product-governance/service-authentication";
import { createAuditLogPanelReads } from "../admin/audit-log-panel-reads";
import { createDataAdapterConfigReads } from "../admin/data-adapters-panel";
import { createGeneralSettingsReads } from "../admin/general-settings-panel";
import {
  createModelConnectionReads, createModelEntryReads, createModelUsageReads,
} from "../admin/model-settings-panel";
import { createExternalMcpReads } from "../mcp/external-mcp-panel";
import { readPublishedMcpService, readPublishedMcpServices, readPublishedMcpServiceTools } from "../mcp/panel-reads";
import type { McpRequestLocation } from "../mcp/catalog";
import { createApplicationBuilderReadAdapter } from "../app-builder/application-panel-reads";
import { createDashboardCardReadAdapter } from "../dashboard/chart-sources";
import { createDashboardCardOwnerReadAdapter, createDashboardReadAdapter } from "../dashboard/panel-reads";
import { createFunctionReadAdapter, createMetricReadAdapter } from "../metric-function/panel-reads";
import { createInstanceGraphReadAdapter, instanceNeighborsParams } from "../ontology-model/instance-graph-reads";
import { createObjectDetailReadAdapter } from "./object-detail-reads";
import { createAgentSessionReadAdapter } from "./agent-session-panel";
import { createFavoriteReadAdapter } from "./favorite-panel";
import { createRecentVisitReadAdapter } from "./recent-visit-panel";
import {
  createCustomerOntologyReadAdapter, customerQueryParams, withInstanceDetail, withInstanceDetailPaths,
} from "../ontology-model/customer-reads";
import { createBusinessKnowledgeReadAdapter } from "../business-knowledge/panel-reads";
import {
  createAutotestCaseArtifactReadAdapter,
  createAutotestRunReadAdapter,
  createDslQueryReadAdapter,
  createOpsKnowledgeReadAdapter,
  createTurnEvidenceReadAdapter,
} from "../ops-diagnosis/panel-reads";
import { createAutotestCaseSetReadAdapter } from "../ops-diagnosis/case-sets-panel";
import { createOntologyModelReadAdapter, withModelingPath } from "../ontology-model/model-reads";
import { createScheduledTaskReadAdapter, triggerCatalogueParams } from "../scheduling/panel-reads";
import { createGovernanceReadAdapters } from "../governance/panel-reads";
import { loadPolicyWorkbenchCatalog } from "../governance/policy-catalog";
import type { SkillResolveRequest } from "../skills/panel-reads";
import { createApplicationReadAdapter } from "./application-catalogue";
import { createProductPanelReadAdapter, createProductProjectionReadAdapter } from "./catalog-reads";
import { requireChartReadRegistration } from "./chart-sources";
import {
  countSdkComponents, listSdkComponents, readSdkComponent, readSdkComponentConfigRows, readSdkComponentDataRows,
  readSdkComponentInputRows, readSdkComponentOperationRows, readSdkComponentOutputRows, readSdkComponentRecord,
} from "./component-catalogue";
import type { PanelReadBatchCache } from "./member-path";

export type PanelReadSelection = { kind: "platform" | "customer"; typeId: string; method: string; primaryKey?: string };
type ReadAdapter = (selection: PanelReadSelection, params: Record<string, unknown>, projection: ProductProjection) => Promise<unknown> | unknown;

interface PanelOwnerReader {
  owner: ProductOwner;
  viewer: AssistantCredentials;
  callerUserName?: string;
  location?: McpRequestLocation;
  batchCache?: PanelReadBatchCache;
}

export function formParams(params: Record<string, unknown>) {
  const values = panelReadParameterSchemas.panelFormValues.optional().parse(params.values);
  requireFormFieldNames(values, "values");
  return {
    values,
    changedField: panelReadParameterSchemas.changedField.optional().parse(params.changedField) ?? null,
  };
}

const readParams = panelReadParameterSchemas;

function customerReads(owner: ProductOwner, viewer: AssistantCredentials, callerUserName?: string): Record<string, ReadAdapter> {
  const customer = createCustomerOntologyReadAdapter(owner, viewer, callerUserName);
  return {
    query: (selection, params) => customer.query(selection.typeId, customerQueryParams(params)),
    record: selection => customer.record(selection.typeId, selection.primaryKey!),
    form: (selection, params) => customer.form(selection.typeId, selection.primaryKey!, formParams(params)),
    createForm: (selection, params) => customer.createForm(selection.typeId, formParams(params)),
  };
}

function ontologyModelReadMethods(model: ReturnType<typeof createOntologyModelReadAdapter>): Record<string, ReadAdapter> {
  return {
  count: selection => model.count(selection.typeId),
  list: (selection, params) => model.list(selection.typeId, {
    className: panelReadParameterSchemas.className.optional().parse(params.className),
  }),
  record: selection => model.record(selection.typeId, selection.primaryKey!),
  form: (selection, params) => model.form(selection.typeId, selection.primaryKey!, formParams(params)),
  createForm: (selection, params) => model.createForm(selection.typeId, formParams(params)),
};
}

const catalogueReads = (adapter: ReturnType<typeof createProductProjectionReadAdapter> | ReturnType<typeof createProductPanelReadAdapter>): Record<string, ReadAdapter> => ({
  query: (_selection, params) => adapter.query(params),
  record: selection => adapter.record(selection.primaryKey!),
  form: (selection, params) => adapter.form(selection.primaryKey!, formParams(params)),
  createForm: (_selection, params) => adapter.createForm(formParams(params)),
  usedBy: selection => adapter.usedBy(selection.primaryKey!),
  grants: selection => adapter.grants(selection.primaryKey!),
});

function governanceReadMethods(owner: ProductOwner, viewer: AssistantCredentials) {
  return createGovernanceReadAdapters(viewer, {
    loadPolicyCatalog: () => loadPolicyWorkbenchCatalog(owner.domainId, viewer.locale),
  });
}

/** Select the owner before resolving its dependencies or calling its read interface. */
const platformPanelOwners: Record<string, (reader: PanelOwnerReader) => Record<string, ReadAdapter>> = {
  [PUBLISHED_MCP_SERVICE]: ({ owner, viewer, location }) => ({
    list: () => readPublishedMcpServices(owner, viewer, location),
    record: selection => readPublishedMcpService(owner, viewer, selection.primaryKey!, location),
    tools: selection => readPublishedMcpServiceTools(owner, viewer, selection.primaryKey!, location),
  }),
  [EXTERNAL_MCP_SERVICE]: ({ owner, viewer }) => {
    const externalMcp = createExternalMcpReads(owner, viewer);
    return {
      options: () => externalMcp.options(),
      resolve: (_selection, params) => externalMcp.resolve(panelReadParameterSchemas.optionValues.parse(params.values)),
      list: () => externalMcp.list(),
      record: selection => externalMcp.record(selection.primaryKey!),
      form: (selection, params) => externalMcp.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => externalMcp.createForm(formParams(params)),
      tools: selection => externalMcp.tools(selection.primaryKey!),
    };
  },
  [AUDIT_LOG]: ({ viewer }) => {
    const audit = createAuditLogPanelReads(viewer);
    return {
      query: (_selection, params) => audit.query(params),
      record: selection => audit.record(selection.primaryKey!),
    };
  },
  [GENERAL_SETTINGS]: ({ owner, viewer }) => {
    const general = createGeneralSettingsReads({ owner, credentials: viewer });
    return {
      list: () => general.list(),
      record: selection => general.record(selection.primaryKey!),
      form: (selection, params) => general.form(selection.primaryKey!, formParams(params)),
    };
  },
  [DATA_ADAPTER_CONFIG]: ({ owner, viewer }) => {
    const dataAdapters = createDataAdapterConfigReads({ owner, credentials: viewer });
    return {
      record: selection => dataAdapters.record(selection.primaryKey!),
      form: (selection, params) => dataAdapters.form(selection.primaryKey!, formParams(params)),
      routingForm: (selection, params) => dataAdapters.routingForm(selection.primaryKey!, formParams(params)),
    };
  },
  [MODEL_CONNECTION]: ({ owner, viewer }) => {
    const modelConnections = createModelConnectionReads({ owner, credentials: viewer });
    return {
      list: () => modelConnections.list(),
      record: selection => modelConnections.record(selection.primaryKey!),
      form: (selection, params) => modelConnections.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => modelConnections.createForm(formParams(params)),
      createModelForm: (selection, params) => modelConnections.createModelForm(selection.primaryKey!, formParams(params)),
      models: selection => modelConnections.models(selection.primaryKey!),
      usages: selection => modelConnections.usages(selection.primaryKey!),
    };
  },
  [MODEL_ENTRY]: ({ owner, viewer }) => {
    const modelEntries = createModelEntryReads({ owner, credentials: viewer });
    return {
      record: selection => modelEntries.record(selection.primaryKey!),
      form: (selection, params) => modelEntries.form(selection.primaryKey!, formParams(params)),
    };
  },
  [MODEL_USAGE]: ({ owner, viewer }) => {
    const modelUsage = createModelUsageReads({ owner, credentials: viewer });
    return {
      form: (selection, params) => modelUsage.form(selection.primaryKey!, formParams(params)),
      vectorRebuild: selection => modelUsage.vectorRebuild(selection.primaryKey!),
    };
  },
  [OPS_KNOWLEDGE]: ({ owner, viewer }) => {
    const opsKnowledge = createOpsKnowledgeReadAdapter(owner, viewer);
    return {
      files: () => opsKnowledge.files(),
      record: (_selection, params) => opsKnowledge.record(panelReadParameterSchemas.opsFilePath.parse(params.path)),
    };
  },
  [TURN_EVIDENCE]: ({ owner, viewer }) => {
    const turnEvidence = createTurnEvidenceReadAdapter(owner, viewer);
    return {
      list: (_selection, params) => turnEvidence.list({
        search: panelReadParameterSchemas.keyword.optional().parse(params.search),
      }),
      record: selection => turnEvidence.record(selection.primaryKey!),
      evidenceRuns: selection => turnEvidence.evidenceRuns(selection.primaryKey!),
      evidenceGaps: selection => turnEvidence.evidenceGaps(selection.primaryKey!),
      files: selection => turnEvidence.files(selection.primaryKey!),
      file: (selection, params) => turnEvidence.file(
        selection.primaryKey!,
        panelReadParameterSchemas.opsFilePath.parse(params.path),
      ),
    };
  },
  [AUTOTEST_CASE_SET]: ({ owner, viewer }) => {
    const autotestCaseSet = createAutotestCaseSetReadAdapter(owner, viewer);
    return {
      list: (_selection, params) => autotestCaseSet.list({
        search: panelReadParameterSchemas.keyword.optional().parse(params.search),
      }),
      record: selection => autotestCaseSet.record(selection.primaryKey!),
      form: (selection, params) => autotestCaseSet.form(selection.primaryKey!, {
        ...formParams(params),
        editMode: panelReadParameterSchemas.autotestCaseEditMode.optional().parse(params.editMode),
      }),
    };
  },
  [AUTOTEST_RUN]: ({ owner, viewer }) => {
    const autotestRun = createAutotestRunReadAdapter(owner, viewer);
    return {
      list: () => autotestRun.list(),
      record: selection => autotestRun.record(selection.primaryKey!),
      results: (selection, params) => autotestRun.results(selection.primaryKey!, {
        verdict: panelReadParameterSchemas.autotestVerdict.optional().parse(params.verdict),
      }),
    };
  },
  [AUTOTEST_CASE_ARTIFACT]: ({ owner, viewer }) => {
    const autotestCaseArtifact = createAutotestCaseArtifactReadAdapter(owner, viewer);
    return {
      record: selection => autotestCaseArtifact.record(selection.primaryKey!),
      evidenceRuns: selection => autotestCaseArtifact.evidenceRuns(selection.primaryKey!),
      evidenceGaps: selection => autotestCaseArtifact.evidenceGaps(selection.primaryKey!),
      files: selection => autotestCaseArtifact.files(selection.primaryKey!),
      file: (selection, params) => autotestCaseArtifact.file(
        selection.primaryKey!,
        panelReadParameterSchemas.opsFilePath.parse(params.path),
      ),
    };
  },
  [DSL_QUERY]: ({ owner, viewer }) => {
    const dslQuery = createDslQueryReadAdapter(owner, viewer);
    return {
      form: (_selection, params) => dslQuery.form(formParams(params)),
    };
  },
  [ACTION]: ({ owner, viewer, callerUserName }) => {
    const actions = async () => {
      const { createActionReadAdapter } = await import("../action/panel-reads");
      return createActionReadAdapter(owner, viewer, callerUserName);
    };
    return {
      sandboxCapability: async () => (await actions()).sandboxCapability(),
      count: async () => (await actions()).count(),
      list: async () => (await actions()).list(),
      record: async selection => (await actions()).record(selection.primaryKey!),
      trialSummary: async selection => (await actions()).trialSummary(selection.primaryKey!),
      form: async (selection, params) => (await actions()).form(selection.primaryKey!, formParams(params)),
      createForm: async (_selection, params) => (await actions()).createForm(formParams(params)),
      definition: async selection => (await actions()).definition(selection.primaryKey!),
      explanation: async selection => (await actions()).explanation(selection.primaryKey!),
      derivedSummary: async selection => (await actions()).derivedSummary(selection.primaryKey!),
      derivedEffects: async selection => (await actions()).derivedEffects(selection.primaryKey!),
      derivedParameters: async selection => (await actions()).derivedParameters(selection.primaryKey!),
      derivedConditions: async selection => (await actions()).derivedConditions(selection.primaryKey!),
      annotatedExplanation: async selection => (await actions()).annotatedExplanation(selection.primaryKey!),
    };
  },
  [WORKFLOW]: ({ owner, viewer, callerUserName }) => {
    const workflows = async () => {
      const { createWorkflowReadAdapter } = await import("../workflow/panel-reads");
      return createWorkflowReadAdapter(owner, viewer, callerUserName);
    };
    return {
      count: async () => (await workflows()).count(),
      list: async () => (await workflows()).list(),
      query: async (_selection, params) => (await workflows()).query(params),
      record: async selection => (await workflows()).record(selection.primaryKey!),
      form: async selection => (await workflows()).form(selection.primaryKey!),
      createForm: async (_selection, params) => (await workflows()).createForm(formParams(params)),
      grantCaseScopedSteps: async selection => (await workflows()).grantCaseScopedSteps(selection.primaryKey!),
      grantInForce: async selection => (await workflows()).grantInForce(selection.primaryKey!),
      grantSuperseded: async selection => (await workflows()).grantSuperseded(selection.primaryKey!),
      grantDirect: async selection => (await workflows()).grantDirect(selection.primaryKey!),
    };
  },
  [METRIC_VIEW]: ({ owner, viewer, callerUserName }) => {
    const metrics = createMetricReadAdapter(owner, viewer, callerUserName);
    return {
      count: () => metrics.count(),
      list: (_selection, params) => metrics.list(params),
      query: (_selection, params) => metrics.query(params),
      record: selection => metrics.record(selection.primaryKey!),
      form: (selection, params) => metrics.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => metrics.createForm(formParams(params)),
      result: (selection, params) => metrics.result(selection.primaryKey!, runtimeJsonObjectSchema.parse(params)),
    };
  },
  [FUNCTION]: ({ owner, viewer, callerUserName }) => {
    const functions = createFunctionReadAdapter(owner, viewer, callerUserName);
    return {
      count: () => functions.count(),
      list: (_selection, params) => functions.list(params),
      query: (_selection, params) => functions.query(params),
      record: selection => functions.record(selection.primaryKey!),
      form: (selection, params) => functions.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => functions.createForm(formParams(params)),
    };
  },
  [DASHBOARD]: ({ owner, viewer }) => {
    const dashboards = createDashboardReadAdapter(owner, viewer);
    return {
      list: () => dashboards.list(),
      record: selection => dashboards.record(selection.primaryKey!),
      cards: selection => dashboards.cards(selection.primaryKey!),
    };
  },
  [DASHBOARD_CARD]: ({ owner, viewer }) => {
    const cards = createDashboardCardReadAdapter(owner, viewer);
    const cardOwnerReads = createDashboardCardOwnerReadAdapter(owner, viewer);
    return {
      chartTemplate: ({ primaryKey }, _params, projection) =>
        "metricId" in projection && projection.metricId !== undefined
          ? cards.chartTemplate(primaryKey!, requireChartReadRegistration(projection, primaryKey!))
          : cards.ownedChartTemplate(primaryKey!),
      result: ({ primaryKey }, params, projection) =>
        "metricId" in projection && projection.metricId !== undefined
          ? cards.result(primaryKey!, requireChartReadRegistration(projection, primaryKey!), runtimeJsonObjectSchema.parse(params))
          : cards.ownedResult(primaryKey!, runtimeJsonObjectSchema.parse(params)),
      record: ({ primaryKey }) => cardOwnerReads.record(primaryKey!),
      form: ({ primaryKey }, params) => cardOwnerReads.form(primaryKey!, formParams(params)),
      metricSource: ({ primaryKey }) => cardOwnerReads.metricSource(primaryKey!),
    };
  },
  [AGENT_DEFINITION]: ({ owner, viewer }) => {
    const definitions = async () => {
      const { createAgentDefinitionDirectory } = await import("./agent-definition-directory");
      return createAgentDefinitionDirectory(owner, viewer);
    };
    return {
      count: async () => (await definitions()).count(),
      list: async () => (await definitions()).list(),
      available: async (_selection, params) => (await definitions()).available({
        search: panelReadParameterSchemas.keyword.optional().parse(params.search),
        favoritesOnly: panelReadParameterSchemas.favoritesOnly.optional().parse(params.favoritesOnly),
      }),
      record: async selection => (await definitions()).record(selection.primaryKey!),
      grants: async selection => (await definitions()).grants(selection.primaryKey!),
      grantRows: async selection => (await definitions()).grantRows(selection.primaryKey!),
      form: async (selection, params) => (await definitions()).form(selection.primaryKey!, formParams(params)),
      createForm: async (_selection, params) => (await definitions()).createForm(formParams(params)),
    };
  },
  [MODEL_OPTION]: ({ viewer }) => {
    const options = async () => {
      const { createAgentOptionReadAdapters } = await import("../assistant/panel-reads");
      return createAgentOptionReadAdapters(viewer);
    };
    return {
      options: async () => (await options()).models.options(),
      resolve: async (_selection, params) => (await options()).models.resolve(params.values as readonly unknown[]),
    };
  },
  [SDK_COMPONENT]: ({ owner, viewer }) => ({
    count: () => countSdkComponents(owner, viewer),
    catalogue: (_selection, params) => listSdkComponents(owner, viewer, panelReadParameterSchemas.keyword.optional().parse(params.search)),
    definition: selection => readSdkComponent(owner, selection.primaryKey!, viewer),
    record: selection => readSdkComponentRecord(owner, selection.primaryKey!, viewer),
    dataRows: selection => readSdkComponentDataRows(owner, selection.primaryKey!, viewer),
    configRows: selection => readSdkComponentConfigRows(owner, selection.primaryKey!, viewer),
    inputRows: selection => readSdkComponentInputRows(owner, selection.primaryKey!, viewer),
    outputRows: selection => readSdkComponentOutputRows(owner, selection.primaryKey!, viewer),
    operationRows: selection => readSdkComponentOperationRows(owner, selection.primaryKey!, viewer),
  }),
  [USER]: ({ owner, viewer }) => {
    const governance = governanceReadMethods(owner, viewer);
    const options = async () => {
      const { createAgentOptionReadAdapters } = await import("../assistant/panel-reads");
      return createAgentOptionReadAdapters(viewer);
    };
    return {
      count: () => governance.users.count(),
      options: async (_selection, params) => (await options()).users.options({
        keyword: panelReadParameterSchemas.keyword.optional().parse(params.keyword),
        page: panelReadParameterSchemas.page.optional().parse(params.page),
      }),
      resolve: async (_selection, params) => (await options()).users.resolve(params.values as readonly unknown[]),
      query: (_selection, params) => governance.users.query(params),
      record: selection => governance.users.record(selection.primaryKey!),
      form: (selection, params) => governance.users.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => governance.users.createForm(formParams(params)),
      effectivePermissions: selection => governance.users.effectivePermissions(selection.primaryKey!),
      effectiveAccess: (selection, params) => governance.users.effectiveAccess(
        selection.primaryKey!, panelReadParameterSchemas.keyword.optional().parse(params.category),
      ),
      effectiveAccessCounts: selection => governance.users.effectiveAccessCounts(selection.primaryKey!),
      effectiveOrgShares: selection => governance.users.effectiveOrgShares(selection.primaryKey!),
      effectiveManagementOperations: selection => governance.users.effectiveManagementOperations(selection.primaryKey!),
      effectiveSubjectDataPermissions: selection => governance.users.effectiveDataPermissions(selection.primaryKey!, "subject"),
      effectiveManagedDataPermissions: selection => governance.users.effectiveDataPermissions(selection.primaryKey!, "managed"),
      effectiveDataPermissions: selection => governance.users.effectiveDataPermissions(selection.primaryKey!, "effective"),
      lookupAccount: (_selection, params) => governance.users.lookupAccount(
        panelReadParameterSchemas.keyword.optional().parse(params.keyword) ?? "",
      ),
    };
  },
  [ROLE]: ({ owner, viewer }) => {
    const governance = governanceReadMethods(owner, viewer);
    return {
      count: () => governance.roles.count(),
      options: async (_selection, params) => {
        const keyword = panelReadParameterSchemas.keyword.optional().parse(params.keyword);
        const page = panelReadParameterSchemas.page.optional().parse(params.page);
        const { options: items } = await readPrincipalDirectory(viewer, {
          kind: "role", ...(keyword ? { keyword } : {}), limit: page?.size ?? 100,
        });
        return { options: items.map(({ id, name }) => ({ primaryKey: id, value: id, label: name })) };
      },
      resolve: async (_selection, params) => {
        const values = panelReadParameterSchemas.optionValues.parse(params.values);
        const { options: items } = await readPrincipalDirectory(viewer, { kind: "role", limit: 100 });
        const byId = new Map(items.map(item => [item.id, item.name]));
        return {
          options: values
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .map(id => ({ primaryKey: id, value: id, label: byId.get(id) ?? id })),
        };
      },
      query: (_selection, params) => governance.roles.query(params),
      record: selection => governance.roles.record(selection.primaryKey!),
      form: (selection, params) => governance.roles.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => governance.roles.createForm(formParams(params)),
      members: selection => governance.roles.members(selection.primaryKey!),
      policies: selection => governance.roles.policies(selection.primaryKey!),
      memberCandidates: selection => governance.roles.memberCandidates(selection.primaryKey!),
      policyCandidates: selection => governance.roles.policyCandidates(selection.primaryKey!),
      contributionPolicies: selection => governance.roles.contributionPolicies(selection.primaryKey!),
      contributionWorkflowSteps: selection => governance.roles.contributionWorkflowSteps(selection.primaryKey!),
      effectiveAccess: (selection, params) => governance.roles.effectiveAccess(
        selection.primaryKey!, panelReadParameterSchemas.keyword.optional().parse(params.category),
      ),
      effectiveAccessCounts: selection => governance.roles.effectiveAccessCounts(selection.primaryKey!),
    };
  },
  [PERMISSION_POLICY]: ({ owner, viewer }) => {
    const governance = governanceReadMethods(owner, viewer);
    return {
      count: () => governance.policies.count(),
      options: () => governance.policies.options(),
      resolve: (_selection, params) => governance.policies.resolve(panelReadParameterSchemas.optionValues.parse(params.values)),
      query: (_selection, params) => governance.policies.query(params),
      record: selection => governance.policies.record(selection.primaryKey!),
      form: (selection, params) => governance.policies.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => governance.policies.createForm(formParams(params)),
      objectGrantCandidates: (selection, params) => governance.policies.objectGrantCandidates(selection.primaryKey!, params),
      dataClassCandidates: (selection, params) => governance.policies.dataClassCandidates(selection.primaryKey!, params),
    };
  },
  [ORG_UNIT]: ({ owner, viewer }) => {
    const governance = governanceReadMethods(owner, viewer);
    return {
      count: () => governance.orgUnits.count(),
      list: () => governance.orgUnits.list(),
      options: () => governance.orgUnits.options(),
      resolve: (_selection, params) => governance.orgUnits.resolve(panelReadParameterSchemas.optionValues.parse(params.values)),
      record: selection => governance.orgUnits.record(selection.primaryKey!),
      form: (selection, params) => governance.orgUnits.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => governance.orgUnits.createForm({
        ...formParams(params), parentId: panelReadParameterSchemas.keyword.optional().parse(params.parentId),
      }),
      members: selection => governance.orgUnits.members(selection.primaryKey!),
      memberCandidates: (selection, params) => governance.orgUnits.memberCandidates(
        selection.primaryKey!, panelReadParameterSchemas.keyword.optional().parse(params.keyword),
      ),
      positions: selection => governance.orgUnits.positions(selection.primaryKey!),
      grants: selection => governance.orgUnits.grants(selection.primaryKey!),
      inheritedGrants: selection => governance.orgUnits.inheritedGrants(selection.primaryKey!),
    };
  },
  [ORG_MEMBERSHIP]: ({ owner, viewer }) => {
    const governance = governanceReadMethods(owner, viewer);
    return {
      record: selection => governance.orgMemberships.record(selection.primaryKey!),
    };
  },
  [ORG_POSITION]: ({ owner, viewer }) => {
    const governance = governanceReadMethods(owner, viewer);
    return {
      record: selection => governance.orgPositions.record(selection.primaryKey!),
      form: (selection, params) => governance.orgPositions.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => governance.orgPositions.createForm({
        ...formParams(params), orgId: panelReadParameterSchemas.keyword.parse(params.orgId),
      }),
    };
  },
  [ORG_GRANT]: ({ owner, viewer }) => {
    const governance = governanceReadMethods(owner, viewer);
    return {
      record: selection => governance.orgGrants.record(selection.primaryKey!),
      form: (selection, params) => governance.orgGrants.form(selection.primaryKey!, formParams(params)),
    };
  },
  [SKILL]: ({ owner, viewer, callerUserName }) => {
    const skillLibrary = async () => {
      const { createSkillReadAdapter } = await import("../skills/panel-reads");
      return createSkillReadAdapter(owner, viewer, callerUserName);
    };
    const agentSkills = async (target: unknown) => {
      const { requireAgentSkillSelection } = await import("../assistant/definitions");
      await requireAgentSkillSelection(owner, viewer, readParams.agentSkillTarget.parse(target));
      return skillLibrary();
    };
    return {
      count: async () => (await skillLibrary()).count(),
      async options(_selection, params) {
        return (await agentSkills(params.agentTarget)).options();
      },
      async resolve(_selection, params) {
        return (await agentSkills(params.agentTarget)).resolve({
          values: params.values as SkillResolveRequest["values"],
        });
      },
      async query(_selection, params) {
        return (await skillLibrary()).query(params);
      },
      async record(selection) {
        return (await skillLibrary()).record(selection.primaryKey!);
      },
      async files(selection) {
        return (await skillLibrary()).files(selection.primaryKey!);
      },
      async file(selection, params) {
        return (await skillLibrary()).file(selection.primaryKey!, params);
      },
    };
  },
  [OBJECT_TYPE]: ({ owner, viewer, callerUserName }) => {
    const model = createOntologyModelReadAdapter(owner, viewer, callerUserName);
    const customer = createCustomerOntologyReadAdapter(owner, viewer, callerUserName);
    const graph = createInstanceGraphReadAdapter(viewer);
    const objectDetail = createObjectDetailReadAdapter(owner, viewer);
    const modelReads = ontologyModelReadMethods(model);
    return {
      ...modelReads,
      record: async selection => withModelingPath(
        await model.record(selection.typeId, selection.primaryKey!), "object", selection.primaryKey!,
      ),
      instances: async (_selection, params) => {
        const className = readParams.className.parse(params.className);
        return withInstanceDetailPaths(className, await customer.query(className, customerQueryParams(params)));
      },
      instanceRecord: async (_selection, params) => {
        const { className, primaryKey } = readParams.graphNode.parse(params.object);
        const [record, objectType] = await Promise.all([
          customer.record(className, primaryKey),
          model.record(OBJECT_TYPE, className),
        ]);
        return withInstanceDetail(record, className, primaryKey, objectType.label);
      },
      instanceNeighbors: (_selection, params) => {
        const { node, ...filters } = instanceNeighborsParams(params);
        return graph.neighbors(node, filters);
      },
      instanceGraphOverview: () => graph.overview(),
      instanceGraphConnections: (_selection, params) => graph.connections(params),
      instanceGraphStatistics: () => graph.statistics(),
      instanceGraphClasses: () => graph.classes(),
      instanceGraphSearch: (_selection, params) => graph.search(params),
      detailPanel: selection => objectDetail.record(selection.primaryKey!),
      detailPanelForm: (selection, params) => objectDetail.form(selection.primaryKey!, formParams(params).values),
      inlineForm: (selection, params) => model.inlineForm(selection.typeId, selection.primaryKey!, formParams(params)),
      options: () => model.objectTypeOptions(),
      resolve: (_selection, params) => model.resolveObjectTypes(panelReadParameterSchemas.optionValues.parse(params.values)),
    };
  },
  [FAVORITE]: ({ owner, viewer }) => {
    const favorites = createFavoriteReadAdapter(owner, viewer);
    return {
      list: (_selection, params) => favorites.list({
        targetGroup: readParams.favoriteTargetGroup.optional().parse(params.targetGroup),
      }),
      status: (_selection, params) => favorites.status({
        object: readParams.graphNode.optional().parse(params.object),
        objectType: readParams.keyword.optional().parse(params.objectType),
        primaryKey: readParams.keyword.optional().parse(params.primaryKey),
      }),
      dashboardCardsStatus: () => favorites.dashboardCardsStatus(),
    };
  },
  [RECENT_VISIT]: ({ owner, viewer }) => {
    const recentVisits = createRecentVisitReadAdapter(owner, viewer);
    return {
      list: (_selection, params) => recentVisits.list({
        limit: readParams.size.optional().parse(params.limit),
      }),
    };
  },
  [AGENT_SESSION]: ({ owner, viewer }) => {
    const agentSessions = createAgentSessionReadAdapter(owner, viewer);
    return {
      list: (_selection, params) => agentSessions.list({
        search: readParams.keyword.optional().parse(params.search),
        limit: readParams.size.optional().parse(params.limit),
        agentKind: readParams.agentKind.optional().parse(params.agentKind),
        agentId: readParams.agentId.optional().parse(params.agentId),
      }),
      record: selection => agentSessions.record(selection.primaryKey!),
    };
  },
  [ATTRIBUTE]: ({ owner, viewer, callerUserName }) => {
    const model = createOntologyModelReadAdapter(owner, viewer, callerUserName);
    const modelReads = ontologyModelReadMethods(model);
    return {
      ...modelReads,
      inlineForm: (selection, params) => model.inlineForm(selection.typeId, selection.primaryKey!, formParams(params)),
    };
  },
  [RELATIONSHIP]: ({ owner, viewer, callerUserName }) => {
    const model = createOntologyModelReadAdapter(owner, viewer, callerUserName);
    const modelReads = ontologyModelReadMethods(model);
    return {
      ...modelReads,
      record: async selection => withModelingPath(
        await model.record(selection.typeId, selection.primaryKey!), "relation", selection.primaryKey!,
      ),
    };
  },
  [PRODUCT_PROJECTION]: ({ owner, viewer }) => {
    const projectionCatalogue = createProductProjectionReadAdapter(owner, viewer);
    return {
      ...catalogueReads(projectionCatalogue),
      componentOptions: () => projectionCatalogue.componentOptions(),
      objectTypeOptions: () => projectionCatalogue.objectTypeOptions(),
      usedByRows: selection => projectionCatalogue.usedByRows(selection.primaryKey!),
      referenceGraph: selection => projectionCatalogue.referenceGraph(selection.primaryKey!),
      grantRows: selection => projectionCatalogue.grantRows(selection.primaryKey!),
      dataRows: selection => projectionCatalogue.dataRows(selection.primaryKey!),
      configRows: selection => projectionCatalogue.configRows(selection.primaryKey!),
      inputRows: selection => projectionCatalogue.inputRows(selection.primaryKey!),
      outputRows: selection => projectionCatalogue.outputRows(selection.primaryKey!),
      operationRows: selection => projectionCatalogue.operationRows(selection.primaryKey!),
    };
  },
  [PRODUCT_PANEL]: ({ owner, viewer }) => {
    const panelCatalogue = createProductPanelReadAdapter(owner, viewer);
    return {
      ...catalogueReads(panelCatalogue),
      options: (_selection, params) => panelCatalogue.options(
        readParams.keyword.optional().parse(params.keyword), readParams.page.optional().parse(params.page),
      ),
      unavailable: () => panelCatalogue.unavailable(),
      usedByRows: selection => panelCatalogue.usedByRows(selection.primaryKey!),
      referenceGraph: selection => panelCatalogue.referenceGraph(selection.primaryKey!),
      grantRows: selection => panelCatalogue.grantRows(selection.primaryKey!),
      members: selection => panelCatalogue.members(selection.primaryKey!),
      memberRows: selection => panelCatalogue.memberRows(selection.primaryKey!),
      sourceFiles: selection => panelCatalogue.sourceFiles(selection.primaryKey!),
      sourceFile: (selection, params) => panelCatalogue.sourceFile(
        selection.primaryKey!,
        panelReadParameterSchemas.skillFilePath.parse(params.path),
      ),
      homePanel: () => panelCatalogue.homePanel(),
    };
  },
  [APPLICATION]: ({ owner, viewer }) => {
    const applications = createApplicationReadAdapter(owner, viewer);
    const appBuilder = createApplicationBuilderReadAdapter(owner, viewer);
    return {
      count: () => applications.count(),
      query: (_selection, params) => applications.query(params),
      available: (_selection, params) => applications.available({
        category: panelReadParameterSchemas.applicationGalleryCategory.optional().parse(params.category),
        search: panelReadParameterSchemas.keyword.optional().parse(params.search),
        favoritesOnly: panelReadParameterSchemas.favoritesOnly.optional().parse(params.favoritesOnly),
      }),
      record: selection => applications.record(selection.primaryKey!),
      entries: selection => applications.entries(selection.primaryKey!),
      entryRows: selection => applications.entryRows(selection.primaryKey!),
      usedPanels: selection => applications.usedPanels(selection.primaryKey!),
      referenceGraph: selection => applications.referenceGraph(selection.primaryKey!),
      form: (selection, params) => applications.form(selection.primaryKey!, {
        ...formParams(params),
        section: panelReadParameterSchemas.applicationFormSection.parse(params.section),
        entryId: panelReadParameterSchemas.applicationEntryId.optional().parse(params.entryId),
      }),
      createForm: (_selection, params) => applications.createForm(formParams(params)),
      builderProjects: (_selection, params) => appBuilder.builderProjects(params),
      builderProject: selection => appBuilder.builderProject(selection.primaryKey!),
      builderSessions: (selection, params) => appBuilder.builderSessions(selection.primaryKey!, params),
      sourceFiles: (selection, params) => appBuilder.sourceFiles(selection.primaryKey!, params),
      sourceFile: (selection, params) => appBuilder.sourceFile(selection.primaryKey!, params),
      sourceCommits: (selection, params) => appBuilder.sourceCommits(selection.primaryKey!, params),
      sourceDiff: (selection, params) => appBuilder.sourceDiff(selection.primaryKey!, params),
      sourceReleases: selection => appBuilder.sourceReleases(selection.primaryKey!),
      builderCreateForm: (_selection, params) => appBuilder.builderCreateForm(formParams(params).values),
      builderMetaForm: (selection, params) => appBuilder.builderMetaForm(selection.primaryKey!, formParams(params).values),
      builderPublishForm: (selection, params) => appBuilder.builderPublishForm(
        selection.primaryKey!,
        formParams(params).values,
        panelReadParameterSchemas.workspaceCommit.optional().parse(params.defaultCommit),
      ),
    };
  },
  [ONTOLOGY_TYPE]: ({ owner, viewer, callerUserName }) => {
    const ontology = async () => {
      const { createPlatformOntologyReadAdapter } = await import("../platform-ontology/panel-reads");
      return createPlatformOntologyReadAdapter(owner, viewer, callerUserName);
    };
    return {
      count: async () => (await ontology()).count(),
      counts: async () => (await ontology()).counts(),
      countRows: async () => (await ontology()).countRows(),
      start: async () => (await ontology()).start(),
      neighbors: async (_selection, params) => (await ontology()).neighbors(params),
      list: async () => (await ontology()).list(),
      graphNodes: async () => (await ontology()).graphNodes(),
      instanceGraphClasses: async () => (await ontology()).instanceGraphClasses(),
      instanceSearch: async (_selection, params) => (await ontology()).instanceSearch(params),
      instances: async (_selection, params) => (await ontology()).instances(params),
      instanceRecord: async (_selection, params) => (await ontology()).instanceRecord(params),
      record: async selection => (await ontology()).record(selection.primaryKey!),
      properties: async (_selection, params) => (await ontology()).properties(params.type as string),
      typeRelations: async (_selection, params) => (await ontology()).typeRelations(params.type as string),
      reads: async (_selection, params) => (await ontology()).reads(params.type as string),
      operations: async (_selection, params) => (await ontology()).operations(params.type as string),
    };
  },
  [ONTOLOGY_RELATION_KIND]: ({ owner, viewer, callerUserName }) => {
    const ontology = async () => {
      const { createPlatformOntologyReadAdapter } = await import("../platform-ontology/panel-reads");
      return createPlatformOntologyReadAdapter(owner, viewer, callerUserName);
    };
    return {
      list: async () => (await ontology()).relationKinds(),
      count: async () => (await ontology()).relationCount(),
      graphEdges: async () => (await ontology()).graphEdges(),
      record: async selection => (await ontology()).relationRecord(selection.primaryKey!),
    };
  },
  [TRIGGER]: ({ owner, viewer, batchCache }) => {
    const schedules = createScheduledTaskReadAdapter(owner, viewer, undefined,
      batchCache && (load => batchCache.scheduleApplications(viewer.headers?.[EXECUTION_CONTEXT_HEADER], load)));
    return {
      count: () => schedules.count(),
      list: () => schedules.list(),
      catalogue: (_selection, params) => schedules.list(triggerCatalogueParams(params)),
      counts: (_selection, params) => schedules.counts(panelReadParameterSchemas.keyword.optional().parse(params.by)),
      status: () => schedules.status(),
      record: selection => schedules.record(selection.primaryKey!),
      runs: (selection, params) => schedules.runs(selection.primaryKey!, panelReadParameterSchemas.cursor.optional().parse(params.cursor)),
      run: (selection, params) => schedules.run(selection.primaryKey!, panelReadParameterSchemas.scheduledRunId.parse(params.runId)),
      runRecords: (selection, params) => schedules.runRecords(selection.primaryKey!, panelReadParameterSchemas.cursor.optional().parse(params.cursor)),
      runRecord: (selection, params) => schedules.runRecord(
        selection.primaryKey!,
        panelReadParameterSchemas.scheduledRunId.optional().parse(params.runId),
      ),
      form: (selection, params) => schedules.form(selection.primaryKey!, formParams(params)),
      memberOptions: (_selection, params) => schedules.memberOptions({
        keyword: panelReadParameterSchemas.keyword.optional().parse(params.keyword),
        page: panelReadParameterSchemas.page.optional().parse(params.page),
      }),
      memberResolve: (_selection, params) => schedules.memberResolve(panelReadParameterSchemas.optionValues.parse(params.values)),
      createForm: (_selection, params) => schedules.createForm({
        ...formParams(params), defaultAppId: panelReadParameterSchemas.keyword.optional().parse(params.defaultAppId),
        defaultAgentId: panelReadParameterSchemas.keyword.optional().parse(params.defaultAgentId),
      }),
    };
  },
  [BUSINESS_KNOWLEDGE]: ({ viewer }) => {
    const knowledge = createBusinessKnowledgeReadAdapter(viewer);
    return {
      count: () => knowledge.count(),
      query: (_selection, params) => knowledge.query(params),
      counts: (_selection, params) => knowledge.counts(params),
      record: (selection, params) => knowledge.record(selection.primaryKey!, params),
      form: (selection, params) => knowledge.form(selection.primaryKey!, params),
      createForm: (_selection, params) => knowledge.form(undefined, params),
    };
  },
  [FEEDBACK_RECORD]: ({ owner, viewer }) => {
    const feedback = async () => {
      const { createFeedbackReadAdapter } = await import("../admin/feedback-panel-reads");
      return createFeedbackReadAdapter(owner, viewer);
    };
    return {
      query: async (_selection, params) => (await feedback()).query(params),
      counts: async (_selection, params) => (await feedback()).counts(params),
      record: async selection => (await feedback()).record(selection.primaryKey!),
    };
  },
};

export function readSelectedPanelOwner(
  reader: PanelOwnerReader, selection: PanelReadSelection, params: Record<string, unknown>, projection: ProductProjection,
) {
  const methods = selection.kind === "customer"
    ? customerReads(reader.owner, reader.viewer, reader.callerUserName)
    : platformPanelOwners[selection.typeId]?.(reader);
  const read = methods?.[selection.method];
  if (!read) throw new HttpError(422, "The owner read is unavailable", "PANEL_READ_UNAVAILABLE");
  return Promise.resolve(read(selection, params, projection));
}
