import { isDomainComponentId } from "@ontomato/contracts/product-record-id";
import { appsSdkComponentDatum } from "@ontomato/contracts/apps-sdk";
import { z } from "zod";
import { BUILD_TEST_HEADER } from "@ontomato/contracts/build-tests";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import {
  AGENT_DEFINITION, BUSINESS_KNOWLEDGE, FEEDBACK_RECORD, MODEL_OPTION, SCHEDULED_TASK, SKILL, USER,
} from "@ontomato/contracts/panel-client-requests";
import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { matchesDirectPanelValue, panelObjectRefSchema } from "@ontomato/contracts/panel-manifest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { authoredReadParameterSource, directReadDeclaration, panelReadParameterId, panelReadParameterSchemas, readParameterUsesStateField, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import {
  AGENT_SESSION, AUDIT_LOG, AUTOTEST_CASE_ARTIFACT, AUTOTEST_CASE_SET, AUTOTEST_RUN, DATA_ADAPTER_CONFIG, DSL_QUERY, EXTERNAL_MCP_SERVICE, FAVORITE, GENERAL_SETTINGS,
  MODEL_CONNECTION, MODEL_ENTRY, MODEL_USAGE, OPS_KNOWLEDGE, PUBLISHED_MCP_SERVICE, RECENT_VISIT, TURN_EVIDENCE,
  ACTION, APPLICATION, ATTRIBUTE, DASHBOARD, DASHBOARD_CARD, FUNCTION, METRIC_VIEW, OBJECT_TYPE,
  ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE, ORG_GRANT, ORG_MEMBERSHIP, ORG_POSITION, ORG_UNIT, PERMISSION_POLICY, PRODUCT_PANEL,
  PRODUCT_PROJECTION, RELATIONSHIP, ROLE, SDK_COMPONENT, TRIGGER, WORKFLOW,
  type PlatformReadDeclaration,
} from "@ontomato/contracts/platform-object-types";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { assertPermission } from "../../identity/installed";
import { tApp } from "../../i18n";
import { createLogger } from "../../logging/logger";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendUnavailableError } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import { searchProductGrantPrincipals, type ProductOwner } from "../product-governance/grants";
import { registeredProductGraph } from "../product-assets/ontology";
import { listProducts } from "../product-assets/store";

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
import { createInstanceGraphReadAdapter } from "../ontology-model/instance-graph-reads";
import { createObjectDetailReadAdapter } from "./object-detail-reads";
import { createAgentSessionReadAdapter } from "./agent-session-panel";
import { createFavoriteReadAdapter } from "./favorite-panel";
import { createRecentVisitReadAdapter } from "./recent-visit-panel";
import { createCustomerOntologyReadAdapter } from "../ontology-model/customer-reads";
import { createBusinessKnowledgeReadAdapter } from "../business-knowledge/panel-reads";
import {
  createAutotestCaseArtifactReadAdapter,
  createAutotestRunReadAdapter,
  createDslQueryReadAdapter,
  createOpsKnowledgeReadAdapter,
  createTurnEvidenceReadAdapter,
} from "../ops-diagnosis/panel-reads";
import { createAutotestCaseSetReadAdapter } from "../ops-diagnosis/case-sets-panel";
import { createOntologyModelReadAdapter } from "../ontology-model/model-reads";
import { createScheduledTaskReadAdapter } from "../scheduling/panel-reads";
import { createGovernanceReadAdapters } from "../governance/panel-reads";
import { loadPolicyWorkbenchCatalog } from "../governance/policy-catalog";
import type { SkillResolveRequest } from "../skills/panel-reads";
import { createApplicationReadAdapter } from "./application-catalogue";
import { createProductPanelReadAdapter, createProductProjectionReadAdapter } from "./catalog-reads";
import { requireChartReadRegistration } from "./chart-sources";
import {
  countSdkComponents,
  listSdkComponents,
  readProjectionComponent,
  readSdkComponent,
  readSdkComponentConfigRows,
  readSdkComponentDataRows,
  readSdkComponentInputRows,
  readSdkComponentOperationRows,
  readSdkComponentOutputRows,
  readSdkComponentRecord,
} from "./component-catalogue";
import { resolvePinnedInputs } from "./input-wiring";
import { PanelReadBatchCache, registeredPanelRootId, requireRegisteredPanelRoot, resolvePanelMemberPath } from "./member-path";

const logger = createLogger("panel-data-reads");

import { unwrapReadDirective } from "./read-directive";

type ReadInputs = ProductPanelReadRequest["inputs"];
type ReadMember = ProductPanel["manifest"]["members"][string];
type ReadSelection = { kind: "platform" | "customer"; typeId: string; method: string; primaryKey?: string };
type ReadAdapter = (selection: ReadSelection, params: Record<string, unknown>, projection: ProductProjection) => Promise<unknown> | unknown;

function formParams(params: Record<string, unknown>) {
  const values = panelReadParameterSchemas.panelFormValues.optional().parse(params.values);
  requireFormFieldNames(values, "values");
  return {
    values,
    changedField: panelReadParameterSchemas.changedField.optional().parse(params.changedField) ?? null,
  };
}

const readParams = panelReadParameterSchemas;
function customerQueryParams(params: Record<string, unknown>) {
  return {
    search: readParams.keyword.optional().parse(params.search),
    page: readParams.page.optional().parse(params.page),
    size: readParams.size.optional().parse(params.size),
    filters: readParams.recordFilters.optional().parse(params.filters),
    sort: readParams.recordSort.optional().parse(params.sort),
  };
}

function customerReads(owner: ProductOwner, viewer: AssistantCredentials, callerUserName?: string): Record<string, ReadAdapter> {
  const customer = createCustomerOntologyReadAdapter(owner, viewer, callerUserName);
  return {
    query: (selection, params) => customer.query(selection.typeId, customerQueryParams(params)),
    record: selection => customer.record(selection.typeId, selection.primaryKey!),
    form: (selection, params) => customer.form(selection.typeId, selection.primaryKey!, formParams(params)),
    createForm: (selection, params) => customer.createForm(selection.typeId, formParams(params)),
    neighbors: (selection, params) => customer.neighbors(selection.typeId, {
      node: panelReadParameterSchemas.graphNode.parse(params.node),
      relationKinds: panelReadParameterSchemas.relationKinds.optional().parse(params.relationKinds),
      limit: panelReadParameterSchemas.neighborsLimit.optional().parse(params.limit),
      offset: panelReadParameterSchemas.nonNegativeInt.optional().parse(params.offset),
    }),
  };
}

function readAdapters(owner: ProductOwner, viewer: AssistantCredentials, callerUserName?: string, location?: McpRequestLocation): Record<string, Record<string, ReadAdapter>> {
  const schedules = createScheduledTaskReadAdapter(viewer);
  const governance = createGovernanceReadAdapters(viewer, {
    loadPolicyCatalog: () => loadPolicyWorkbenchCatalog(owner.domainId, viewer.locale),
  });
  const ontology = async () => {
    const { createPlatformOntologyReadAdapter } = await import("../platform-ontology/panel-reads");
    return createPlatformOntologyReadAdapter(owner, viewer, callerUserName);
  };
  const knowledge = createBusinessKnowledgeReadAdapter(viewer);
  const model = createOntologyModelReadAdapter(owner, viewer, callerUserName);
  const customer = createCustomerOntologyReadAdapter(owner, viewer, callerUserName);
  const graph = createInstanceGraphReadAdapter(viewer);
  const objectDetail = createObjectDetailReadAdapter(owner, viewer);
  const favorites = createFavoriteReadAdapter(owner, viewer);
  const recentVisits = createRecentVisitReadAdapter(owner, viewer);
  const agentSessions = createAgentSessionReadAdapter(owner, viewer);
  const actions = async () => {
    const { createActionReadAdapter } = await import("../action/panel-reads");
    return createActionReadAdapter(owner, viewer, callerUserName);
  };
  const triggers = async () => {
    const { createTriggerReadAdapter } = await import("../trigger/panel-reads");
    return createTriggerReadAdapter(owner, viewer, callerUserName);
  };
  const workflows = async () => {
    const { createWorkflowReadAdapter } = await import("../workflow/panel-reads");
    return createWorkflowReadAdapter(owner, viewer, callerUserName);
  };
  const metrics = createMetricReadAdapter(owner, viewer, callerUserName);
  const functions = createFunctionReadAdapter(owner, viewer, callerUserName);
  const dashboards = createDashboardReadAdapter(owner, viewer);
  const cards = createDashboardCardReadAdapter(owner, viewer);
  const cardOwnerReads = createDashboardCardOwnerReadAdapter(owner, viewer);
  const modelReads: Record<string, ReadAdapter> = {
    count: selection => model.count(selection.typeId),
    list: (selection, params) => model.list(selection.typeId, {
      className: panelReadParameterSchemas.className.optional().parse(params.className),
    }),
    record: selection => model.record(selection.typeId, selection.primaryKey!),
    form: (selection, params) => model.form(selection.typeId, selection.primaryKey!, formParams(params)),
    createForm: (selection, params) => model.createForm(selection.typeId, formParams(params)),
  };
  const projectionCatalogue = createProductProjectionReadAdapter(owner, viewer);
  const panelCatalogue = createProductPanelReadAdapter(owner, viewer);
  const applications = createApplicationReadAdapter(owner, viewer);
  const appBuilder = createApplicationBuilderReadAdapter(owner, viewer);
  const catalogueReads = (adapter: typeof projectionCatalogue | typeof panelCatalogue): Record<string, ReadAdapter> => ({
    query: (_selection, params) => adapter.query(params),
    record: selection => adapter.record(selection.primaryKey!),
    form: (selection, params) => adapter.form(selection.primaryKey!, formParams(params)),
    createForm: (_selection, params) => adapter.createForm(formParams(params)),
    usedBy: selection => adapter.usedBy(selection.primaryKey!),
    grants: selection => adapter.grants(selection.primaryKey!),
  });
  const definitions = async () => {
    const { createAgentDefinitionDirectory } = await import("./agent-definition-directory");
    return createAgentDefinitionDirectory(owner, viewer);
  };
  const options = async () => {
    const { createAgentOptionReadAdapters } = await import("../assistant/panel-reads");
    return createAgentOptionReadAdapters(viewer);
  };
  const skillLibrary = async () => {
    const { createSkillReadAdapter } = await import("../skills/panel-reads");
    return createSkillReadAdapter(owner, viewer, callerUserName);
  };
  const skills = async () => {
    await assertPermission(viewer, ["analysis-agent"]);
    return skillLibrary();
  };
  const feedback = async () => {
    const { createFeedbackReadAdapter } = await import("../admin/feedback-panel-reads");
    return createFeedbackReadAdapter(owner, viewer);
  };
  const audit = createAuditLogPanelReads(viewer);
  const general = createGeneralSettingsReads({ owner, credentials: viewer });
  const dataAdapters = createDataAdapterConfigReads({ owner, credentials: viewer });
  const modelConnections = createModelConnectionReads({ owner, credentials: viewer });
  const modelEntries = createModelEntryReads({ owner, credentials: viewer });
  const modelUsage = createModelUsageReads({ owner, credentials: viewer });
  const opsKnowledge = createOpsKnowledgeReadAdapter(owner, viewer);
  const turnEvidence = createTurnEvidenceReadAdapter(owner, viewer);
  const autotestCaseSet = createAutotestCaseSetReadAdapter(owner, viewer);
  const autotestRun = createAutotestRunReadAdapter(owner, viewer);
  const autotestCaseArtifact = createAutotestCaseArtifactReadAdapter(owner, viewer);
  const dslQuery = createDslQueryReadAdapter(owner, viewer);
  const externalMcp = createExternalMcpReads(owner, viewer);
  return {
    [PUBLISHED_MCP_SERVICE]: {
      list: () => readPublishedMcpServices(owner, viewer, location),
      record: selection => readPublishedMcpService(owner, viewer, selection.primaryKey!, location),
      tools: selection => readPublishedMcpServiceTools(owner, viewer, selection.primaryKey!, location),
    },
    [EXTERNAL_MCP_SERVICE]: {
      options: () => externalMcp.options(),
      resolve: (_selection, params) => externalMcp.resolve(panelReadParameterSchemas.optionValues.parse(params.values)),
      list: () => externalMcp.list(),
      record: selection => externalMcp.record(selection.primaryKey!),
      form: (selection, params) => externalMcp.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => externalMcp.createForm(formParams(params)),
      tools: selection => externalMcp.tools(selection.primaryKey!),
    },
    [AUDIT_LOG]: {
      query: (_selection, params) => audit.query(params),
      record: selection => audit.record(selection.primaryKey!),
    },
    [GENERAL_SETTINGS]: {
      list: () => general.list(),
      record: selection => general.record(selection.primaryKey!),
      form: (selection, params) => general.form(selection.primaryKey!, formParams(params)),
    },
    [DATA_ADAPTER_CONFIG]: {
      record: selection => dataAdapters.record(selection.primaryKey!),
      form: (selection, params) => dataAdapters.form(selection.primaryKey!, formParams(params)),
      routingForm: (selection, params) => dataAdapters.routingForm(selection.primaryKey!, formParams(params)),
    },
    [MODEL_CONNECTION]: {
      list: () => modelConnections.list(),
      record: selection => modelConnections.record(selection.primaryKey!),
      form: (selection, params) => modelConnections.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => modelConnections.createForm(formParams(params)),
      createModelForm: (selection, params) => modelConnections.createModelForm(selection.primaryKey!, formParams(params)),
      models: selection => modelConnections.models(selection.primaryKey!),
      usages: selection => modelConnections.usages(selection.primaryKey!),
    },
    [MODEL_ENTRY]: {
      record: selection => modelEntries.record(selection.primaryKey!),
      form: (selection, params) => modelEntries.form(selection.primaryKey!, formParams(params)),
    },
    [MODEL_USAGE]: {
      form: (selection, params) => modelUsage.form(selection.primaryKey!, formParams(params)),
      vectorRebuild: selection => modelUsage.vectorRebuild(selection.primaryKey!),
    },
    [OPS_KNOWLEDGE]: {
      files: () => opsKnowledge.files(),
      record: (_selection, params) => opsKnowledge.record(panelReadParameterSchemas.opsFilePath.parse(params.path)),
    },
    [TURN_EVIDENCE]: {
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
    },
    [AUTOTEST_CASE_SET]: {
      list: (_selection, params) => autotestCaseSet.list({
        search: panelReadParameterSchemas.keyword.optional().parse(params.search),
      }),
      record: selection => autotestCaseSet.record(selection.primaryKey!),
      form: (selection, params) => autotestCaseSet.form(selection.primaryKey!, {
        ...formParams(params),
        editMode: panelReadParameterSchemas.autotestCaseEditMode.optional().parse(params.editMode),
      }),
    },
    [AUTOTEST_RUN]: {
      list: () => autotestRun.list(),
      record: selection => autotestRun.record(selection.primaryKey!),
      results: (selection, params) => autotestRun.results(selection.primaryKey!, {
        verdict: panelReadParameterSchemas.autotestVerdict.optional().parse(params.verdict),
      }),
    },
    [AUTOTEST_CASE_ARTIFACT]: {
      record: selection => autotestCaseArtifact.record(selection.primaryKey!),
      evidenceRuns: selection => autotestCaseArtifact.evidenceRuns(selection.primaryKey!),
      evidenceGaps: selection => autotestCaseArtifact.evidenceGaps(selection.primaryKey!),
      files: selection => autotestCaseArtifact.files(selection.primaryKey!),
      file: (selection, params) => autotestCaseArtifact.file(
        selection.primaryKey!,
        panelReadParameterSchemas.opsFilePath.parse(params.path),
      ),
    },
    [DSL_QUERY]: {
      form: (_selection, params) => dslQuery.form(formParams(params)),
    },
    [ACTION]: {
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
    },
    [TRIGGER]: {
      count: async () => (await triggers()).count(),
      armedCount: async () => (await triggers()).armedCount(),
      list: async () => (await triggers()).list(),
      query: async (_selection, params) => (await triggers()).query(params),
      record: async selection => (await triggers()).record(selection.primaryKey!),
      form: async (selection, params) => (await triggers()).form(selection.primaryKey!, formParams(params)),
      createForm: async (_selection, params) => (await triggers()).createForm(formParams(params)),
    },
    [WORKFLOW]: {
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
    },
    [METRIC_VIEW]: {
      count: () => metrics.count(),
      list: (_selection, params) => metrics.list(params),
      query: (_selection, params) => metrics.query(params),
      record: selection => metrics.record(selection.primaryKey!),
      form: (selection, params) => metrics.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => metrics.createForm(formParams(params)),
      result: (selection, params) => metrics.result(selection.primaryKey!, runtimeJsonObjectSchema.parse(params)),
    },
    [FUNCTION]: {
      list: (_selection, params) => functions.list(params),
      query: (_selection, params) => functions.query(params),
      record: selection => functions.record(selection.primaryKey!),
      form: (selection, params) => functions.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => functions.createForm(formParams(params)),
    },
    [DASHBOARD]: {
      list: () => dashboards.list(),
      record: selection => dashboards.record(selection.primaryKey!),
      cards: selection => dashboards.cards(selection.primaryKey!),
    },
    [DASHBOARD_CARD]: {
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
    },
    [AGENT_DEFINITION]: {
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
    },
    [MODEL_OPTION]: {
      options: async () => (await options()).models.options(),
      resolve: async (_selection, params) => (await options()).models.resolve(params.values as readonly unknown[]),
    },
    [SDK_COMPONENT]: {
      count: () => countSdkComponents(owner, viewer),
      catalogue: (_selection, params) => listSdkComponents(owner, viewer, panelReadParameterSchemas.keyword.optional().parse(params.search)),
      definition: selection => readSdkComponent(owner, selection.primaryKey!, viewer),
      record: selection => readSdkComponentRecord(owner, selection.primaryKey!, viewer),
      dataRows: selection => readSdkComponentDataRows(owner, selection.primaryKey!, viewer),
      configRows: selection => readSdkComponentConfigRows(owner, selection.primaryKey!, viewer),
      inputRows: selection => readSdkComponentInputRows(owner, selection.primaryKey!, viewer),
      outputRows: selection => readSdkComponentOutputRows(owner, selection.primaryKey!, viewer),
      operationRows: selection => readSdkComponentOperationRows(owner, selection.primaryKey!, viewer),
    },
    [USER]: {
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
      effectiveOrgShares: selection => governance.users.effectiveOrgShares(selection.primaryKey!),
      effectiveApiPermissions: selection => governance.users.effectiveApiPermissions(selection.primaryKey!),
      effectiveSubjectDataPermissions: selection => governance.users.effectiveDataPermissions(selection.primaryKey!, "subject"),
      effectiveManagedDataPermissions: selection => governance.users.effectiveDataPermissions(selection.primaryKey!, "managed"),
      effectiveDataPermissions: selection => governance.users.effectiveDataPermissions(selection.primaryKey!, "effective"),
      lookupAccount: (_selection, params) => governance.users.lookupAccount(
        panelReadParameterSchemas.keyword.optional().parse(params.keyword) ?? "",
      ),
    },
    [ROLE]: {
      options: async (_selection, params) => {
        const keyword = panelReadParameterSchemas.keyword.optional().parse(params.keyword);
        const page = panelReadParameterSchemas.page.optional().parse(params.page);
        const { options: items } = await searchProductGrantPrincipals("role", keyword, page?.size ?? 100, viewer);
        return { options: items.map(({ id, name }) => ({ primaryKey: id, value: id, label: name })) };
      },
      resolve: async (_selection, params) => {
        const values = panelReadParameterSchemas.optionValues.parse(params.values);
        const { options: items } = await searchProductGrantPrincipals("role", undefined, 100, viewer);
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
    },
    [PERMISSION_POLICY]: {
      options: () => governance.policies.options(),
      resolve: (_selection, params) => governance.policies.resolve(panelReadParameterSchemas.optionValues.parse(params.values)),
      query: (_selection, params) => governance.policies.query(params),
      record: selection => governance.policies.record(selection.primaryKey!),
      form: (selection, params) => governance.policies.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => governance.policies.createForm(formParams(params)),
    },
    [ORG_UNIT]: {
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
    },
    [ORG_MEMBERSHIP]: {
      record: selection => governance.orgMemberships.record(selection.primaryKey!),
    },
    [ORG_POSITION]: {
      record: selection => governance.orgPositions.record(selection.primaryKey!),
      form: (selection, params) => governance.orgPositions.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => governance.orgPositions.createForm({
        ...formParams(params), orgId: panelReadParameterSchemas.keyword.parse(params.orgId),
      }),
    },
    [ORG_GRANT]: {
      record: selection => governance.orgGrants.record(selection.primaryKey!),
      form: (selection, params) => governance.orgGrants.form(selection.primaryKey!, formParams(params)),
    },
    [SKILL]: {
      async options() {
        return (await skills()).options();
      },
      async resolve(_selection, params) {
        return (await skills()).resolve({ values: params.values as SkillResolveRequest["values"] });
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
    },
    [OBJECT_TYPE]: {
      ...modelReads,
      instances: (_selection, params) => customer.query(readParams.className.parse(params.className), customerQueryParams(params)),
      instanceRecord: (_selection, params) => {
        const { className, primaryKey } = readParams.graphNode.parse(params.object);
        return customer.record(className, primaryKey);
      },
      instanceNeighbors: (_selection, params) => graph.neighbors(readParams.graphNode.parse(params.node), {
        relationKinds: readParams.relationKinds.optional().parse(params.relationKinds),
        targetClass: readParams.className.optional().parse(params.targetClass),
        direction: readParams.neighborDirection.optional().parse(params.direction),
        limit: readParams.neighborsLimit.optional().parse(params.limit),
        offset: readParams.nonNegativeInt.optional().parse(params.offset),
      }),
      instanceGraphOverview: () => graph.overview(),
      instanceGraphConnections: (_selection, params) => graph.connections(
        readParams.keyword.parse(params.version), readParams.keyword.optional().parse(params.sampleToken),
      ),
      instanceGraphStatistics: () => graph.statistics(),
      instanceGraphClasses: () => graph.classes(),
      instanceGraphSearch: (_selection, params) => graph.search(
        readParams.keyword.optional().parse(params.search), readParams.className.optional().parse(params.className),
        readParams.keyword.optional().parse(params.version),
      ),
      detailPanel: selection => objectDetail.record(selection.primaryKey!),
      detailPanelForm: (selection, params) => objectDetail.form(selection.primaryKey!, formParams(params).values),
      inlineForm: (selection, params) => model.inlineForm(selection.typeId, selection.primaryKey!, formParams(params)),
      productGraph: async () => {
        const graph = await registeredProductGraph(owner, await listProducts(owner), viewer);
        return {
          className: OBJECT_TYPE,
          primaryKey: "product-graph",
          label: "Product graph",
          fields: {
            graph: { kind: "json" as const, value: graph },
          },
        };
      },
      options: () => model.objectTypeOptions(),
      resolve: (_selection, params) => model.resolveObjectTypes(panelReadParameterSchemas.optionValues.parse(params.values)),
    },
    [FAVORITE]: {
      list: (_selection, params) => favorites.list({
        targetGroup: readParams.favoriteTargetGroup.optional().parse(params.targetGroup),
      }),
      status: (_selection, params) => favorites.status({
        object: readParams.graphNode.optional().parse(params.object),
        objectType: readParams.keyword.optional().parse(params.objectType),
        primaryKey: readParams.keyword.optional().parse(params.primaryKey),
      }),
      dashboardCardsStatus: () => favorites.dashboardCardsStatus(),
    },
    [RECENT_VISIT]: {
      list: (_selection, params) => recentVisits.list({
        limit: readParams.size.optional().parse(params.limit),
      }),
    },
    [AGENT_SESSION]: {
      list: (_selection, params) => agentSessions.list({
        search: readParams.keyword.optional().parse(params.search),
        limit: readParams.size.optional().parse(params.limit),
        agentKind: readParams.agentKind.optional().parse(params.agentKind),
        agentId: readParams.agentId.optional().parse(params.agentId),
      }),
      record: selection => agentSessions.record(selection.primaryKey!),
    },
    [ATTRIBUTE]: {
      ...modelReads,
      inlineForm: (selection, params) => model.inlineForm(selection.typeId, selection.primaryKey!, formParams(params)),
    },
    [RELATIONSHIP]: modelReads,
    [PRODUCT_PROJECTION]: {
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
    },
    [PRODUCT_PANEL]: {
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
    },
    [APPLICATION]: {
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
      grants: selection => applications.grants(selection.primaryKey!),
      grantRows: selection => applications.grantRows(selection.primaryKey!),
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
    },
    [ONTOLOGY_TYPE]: {
      schema: async () => (await ontology()).schema(),
      counts: async () => (await ontology()).counts(),
      countRows: async () => (await ontology()).countRows(),
      start: async () => (await ontology()).start(),
      neighbors: async (_selection, params) => (await ontology()).neighbors(params),
      objects: async (_selection, params) => (await ontology()).objects(params),
      list: async () => (await ontology()).list(),
      record: async selection => (await ontology()).record(selection.primaryKey!),
      properties: async (_selection, params) => (await ontology()).properties(params.type as string),
      typeRelations: async (_selection, params) => (await ontology()).typeRelations(params.type as string),
      reads: async (_selection, params) => (await ontology()).reads(params.type as string),
      operations: async (_selection, params) => (await ontology()).operations(params.type as string),
    },
    [ONTOLOGY_RELATION_KIND]: {
      list: async () => (await ontology()).relationKinds(),
    },
    [SCHEDULED_TASK]: {
      list: () => schedules.list(),
      catalogue: (_selection, params) => schedules.list({
        application: panelReadParameterSchemas.keyword.optional().parse(params.scope),
        search: panelReadParameterSchemas.keyword.optional().parse(params.search),
      }),
      counts: (_selection, params) => schedules.counts(panelReadParameterSchemas.keyword.optional().parse(params.by)),
      status: () => schedules.status(),
      record: selection => schedules.record(selection.primaryKey!),
      runs: (selection, params) => schedules.runs(selection.primaryKey!, panelReadParameterSchemas.cursor.optional().parse(params.cursor)),
      run: (selection, params) => schedules.run(selection.primaryKey!, panelReadParameterSchemas.scheduledRunId.parse(params.runId)),
      runRecords: (selection, params) => schedules.runRecords(selection.primaryKey!, panelReadParameterSchemas.cursor.optional().parse(params.cursor)),
      runRecord: (selection, params) => schedules.runRecord(selection.primaryKey!, panelReadParameterSchemas.scheduledRunId.parse(params.runId)),
      latestRunRecord: (selection, params) => schedules.latestRunRecord(
        selection.primaryKey!,
        panelReadParameterSchemas.scheduledRunId.optional().parse(params.runId),
      ),
      form: (selection, params) => schedules.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => schedules.createForm({
        ...formParams(params), defaultAppId: panelReadParameterSchemas.keyword.optional().parse(params.defaultAppId),
      }),
    },
    [BUSINESS_KNOWLEDGE]: {
      query: (_selection, params) => knowledge.query(params),
      counts: (_selection, params) => knowledge.counts(params),
      record: (selection, params) => knowledge.record(selection.primaryKey!, params),
      form: (selection, params) => knowledge.form(selection.primaryKey!, params),
      createForm: (_selection, params) => knowledge.form(undefined, params),
    },
    [FEEDBACK_RECORD]: {
      query: async (_selection, params) => (await feedback()).query(params),
      counts: async (_selection, params) => (await feedback()).counts(params),
      record: async selection => (await feedback()).record(selection.primaryKey!),
    },
  };
}

async function resolveReadMember(
  owner: ProductOwner, viewer: AssistantCredentials, request: ProductPanelReadRequest, batchCache?: PanelReadBatchCache,
) {
  const { source, memberPath } = request;
  if (source.kind === "candidate") {
    const { resolvePanelCandidateMember } = await import("../workspaces/panel-candidate");
    const { panel, member, projection, previewContext } = await resolvePanelCandidateMember(owner, viewer, source.workspace, memberPath);
    const headers = { ...viewer.headers, [BUILD_TEST_HEADER]: JSON.stringify({
      kind: "build-test", contextId: previewContext.test?.contextId ?? null,
    }) };
    return { member, projection, panel, inputs: request.inputs, viewer: { ...viewer, headers } };
  }
  if (source.kind === "app-candidate") {
    const { resolveApplicationPreviewMember } = await import("../app-builder/preview-service");
    const { panel, member, projection, previewContext } = await resolveApplicationPreviewMember(
      owner, viewer, source.app.id, { ref: source.app.ref, entryId: source.app.entryId }, memberPath,
    );
    const headers = { ...viewer.headers, [BUILD_TEST_HEADER]: JSON.stringify({
      kind: "build-test", contextId: previewContext.test?.contextId ?? null,
    }) };
    return { member, projection, panel, inputs: request.inputs, viewer: { ...viewer, headers } };
  }

  const { panel, entry } = await requireRegisteredPanelRoot(owner, viewer, source, { batchCache });
  const placement = await resolvePanelMemberPath(owner, viewer, panel, memberPath, entry, undefined, batchCache);
  if (placement.kind !== "projection")
    throw new HttpError(403, "The member path does not select a projection", "PANEL_MEMBER_FORBIDDEN");
  const fieldInputs = Object.entries(placement.member.inputs ?? {}).filter(([, ref]) => "field" in ref);
  if (fieldInputs.length) {
    const inputs = { ...request.inputs };
    const pinned = resolvePinnedInputs(entry, placement.trail, placement.member, source.kind === "frame");
    for (const [name] of fieldInputs) {
      if (!pinned.has(name)) continue;
      const value = pinned.get(name) as string | undefined;
      if (value === undefined) delete inputs[name];
      else inputs[name] = value;
    }
    return { ...placement, inputs, viewer };
  }
  return { ...placement, inputs: request.inputs, viewer };
}

function effectiveInputs(
  projection: ProductProjection, member: ReadMember, submitted: ReadInputs,
): ReadInputs {
  const values = { ...submitted };
  for (const [name, ref] of Object.entries(member.inputs ?? {})) {
    if ("literal" in ref) values[name] = ref.literal;
  }
  for (const [name, value] of Object.entries(values)) {
    if (!Object.hasOwn(projection.inputs, name)) {
      const implicit = Object.values(projection.data).some(datum => {
        const source = authoredReadParameterSource(datum.params, name, member);
        return source && ("state" in source || "output" in source) && panelReadParameterId(directReadDeclaration(projection, datum)!, name);
      });
      if (!implicit) throw new HttpError(400, `Unknown projection input: ${name}`, "PANEL_INPUT_UNKNOWN");
      continue;
    }
    const type = projection.inputs[name];
    if (type.kind !== "json" && !matchesDirectPanelValue(type, value))
      throw new HttpError(400, `Invalid projection input: ${name}`, "PANEL_INPUT_TYPE_MISMATCH");
  }
  return values;
}

const extendedApplicationScopeSchema = z.enum(["visible", "maintainable", "mine", "shared"]);
function parseReadParameter(parameter: keyof typeof panelReadParameterSchemas, value: unknown): unknown {
  if (parameter === "applicationScope") return extendedApplicationScopeSchema.parse(value);
  return panelReadParameterSchemas[parameter].parse(value);
}

async function readParameters(
  projection: ProductProjection, member: ReadMember, dataName: string, data: DirectProjectionData,
  declaration: PlatformReadDeclaration, inputs: ReadInputs, runtimeParams: ProductPanelReadRequest["runtimeParams"],
  viewer: AssistantCredentials,
) {
  const resolved = new Map<string, unknown>();
  const runtime = Object.entries(runtimeParams ?? {});
  if (runtime.length || isDomainComponentId(projection.componentId)) {
    const component = await readProjectionComponent(projection.componentId, undefined, { domainId: projection.domainId, credentials: viewer });
    if (!component && isDomainComponentId(projection.componentId))
      throw new HttpError(404, "Domain component is unavailable", "PANEL_COMPONENT_UNAVAILABLE");
    const names = appsSdkComponentDatum(component?.data, dataName)?.runtimeParams ?? [];
    for (const [name, value] of runtime) {
      const parameter = panelReadParameterId(declaration, name);
      if (!parameter || !names.includes(name))
        throw new HttpError(400, `Runtime parameter '${name}' is not declared for data '${dataName}'`, "PANEL_RUNTIME_PARAMETER_UNKNOWN");
      if (value == null) continue;
      const parsed = parseReadParameter(parameter, value);
      if (!authoredReadParameterSource(data.params, name, member)) resolved.set(name, parsed);
    }
  }
  const selectionInput = "object" in data.source && "input" in data.source.object ? data.source.object.input : undefined;
  const authored = new Set([...Object.keys(data.params), ...Object.keys(member.inputs ?? {}), ...Object.keys(member.outputs ?? {})]);
  for (const name of authored) {
    // An input port consumed by `data.source.object` (such as `target` wired to panel state) selects the target
    // object for `readSelection`, and declared projection ports unmapped in `data.params` are not implicit owner
    // parameters.
    if (
      !Object.hasOwn(data.params, name)
      && (name === selectionInput
        || (declaration.parameterMode === "owner"
          && (Object.hasOwn(projection.inputs, name) || Object.hasOwn(projection.outputs, name))))
    ) {
      continue;
    }
    const source = authoredReadParameterSource(data.params, name, member);
    const parameter = panelReadParameterId(declaration, name);
    if (!source || !parameter) continue;
    const value = "literal" in source ? source.literal : inputs["input" in source ? source.input : name];
    if (value != null) resolved.set(name, parseReadParameter(parameter, value));
    else if (readParameterUsesStateField(source, member))
      throw new HttpError(400, `Missing read parameter: ${name}`, "PANEL_INPUT_REQUIRED");
  }
  return Object.fromEntries(resolved);
}

function readSelection({ source, read }: DirectProjectionData, inputs: ReadInputs): ReadSelection {
  if ("type" in source) return {
    kind: source.type.kind === "PlatformObjectType" ? "platform" : "customer", typeId: source.type.id, method: read,
  };
  const value = "literal" in source.object ? source.object.literal : inputs[source.object.input];
  if (value == null) throw new HttpError(400, "Select an object before reading its data", "PANEL_SELECTION_REQUIRED");
  const { className, primaryKey } = panelObjectRefSchema.parse(value);
  return { kind: className.startsWith("platform:") ? "platform" : "customer", typeId: className, method: read, primaryKey };
}

export type ProjectionDataReadOutcome =
  | (Extract<ProductPanelReadResponse, { status: "ready" }> & { declaration: PlatformReadDeclaration })
  | { status: "empty"; declaration: PlatformReadDeclaration };

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

export async function executeProjectionDataRead(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  { member, projection, slot }: { member: ReadMember; projection: ProductProjection; slot: string },
  dataName: string,
  submittedInputs: ReadInputs,
  runtimeParams?: ProductPanelReadRequest["runtimeParams"],
  callerUserName?: string,
  location?: McpRequestLocation,
  batchCache?: PanelReadBatchCache,
  readScopeKey?: string,
): Promise<ProjectionDataReadOutcome> {
  const inputs = effectiveInputs(projection, member, submittedInputs);
  if (!Object.hasOwn(projection.data, dataName)) {
    throw new HttpError(
      400,
      `Member ${JSON.stringify(slot)} does not declare dataName ${JSON.stringify(dataName)}. Declared data names: ${JSON.stringify(Object.keys(projection.data))}.`,
      "PANEL_DATA_NAME_UNKNOWN",
    );
  }
  const data = projection.data[dataName];
  const declaration = directReadDeclaration(projection, data);
  if (!declaration) {
    throw new HttpError(422, `Read '${data.read}' is not registered for datum '${dataName}'`, "PANEL_READ_UNAVAILABLE");
  }
  const params = await readParameters(projection, member, dataName, data, declaration, inputs, runtimeParams, viewer);
  if (declaration.parameterMode === "fixed") {
    for (const name of declaration.requiredParams ?? [])
      if (!Object.hasOwn(params, name)) throw new HttpError(400, `Missing read parameter: ${name}`, "PANEL_INPUT_REQUIRED");
  }
  const selection = readSelection(data, inputs);
  const read = selection.kind === "customer"
    ? customerReads(owner, viewer, callerUserName)[selection.method]
    : readAdapters(owner, viewer, callerUserName, location)[selection.typeId]?.[selection.method];
  if (!read) throw new HttpError(422, "The owner read is unavailable", "PANEL_READ_UNAVAILABLE");
  const invoke = () => Promise.resolve(read(selection, params, projection));
  const result = await (batchCache && readScopeKey !== undefined
    ? batchCache.read(
        JSON.stringify([
          readScopeKey,
          selection.kind,
          selection.typeId,
          selection.method,
          selection.primaryKey ?? null,
          selection.typeId === DASHBOARD_CARD ? projection.id : null,
          stableJson(params),
        ]),
        invoke,
      )
    : invoke());
  const { value: payload, directive } = unwrapReadDirective(result);
  const rereadAfterMs = directive?.rereadAfterMs;
  if (declaration.result === "panelRecordList") {
    const value = panelReadResultSchemas.panelRecordList.parse(payload);
    return value.length || rereadAfterMs !== undefined
      ? { status: "ready", value, declaration, ...directive }
      : { status: "empty", declaration };
  }
  if (declaration.result === "metricOutput") {
    const value = panelReadResultSchemas.metricOutput.parse(payload);
    if (!value.rows.length && !value.truncation && rereadAfterMs === undefined) return { status: "empty", declaration };
    return { status: "ready", value, declaration, ...directive };
  }
  return {
    status: "ready",
    value: panelReadResultSchemas[declaration.result].parse(payload) as Extract<ProductPanelReadResponse, { status: "ready" }>["value"],
    declaration,
    ...directive,
  };
}

export async function readProductPanelData(
  owner: ProductOwner, viewer: AssistantCredentials, request: ProductPanelReadRequest, callerUserName?: string, location?: McpRequestLocation,
  batchCache?: PanelReadBatchCache,
): Promise<ProductPanelReadResponse> {
  try {
    const { member, projection, panel, inputs: submittedInputs, viewer: readViewer } = await resolveReadMember(owner, viewer, request, batchCache);
    const slot = request.memberPath.at(-1)!.member;
    if ("operations" in request) {
      const inputs = effectiveInputs(projection, member, submittedInputs);
      const { readAdmittedProjectionOperations } = await import("./direct-operations");
      const value = await readAdmittedProjectionOperations({ owner, credentials: readViewer },
        { panel, projection, member, slot }, inputs);
      return { status: "ready", value: runtimeJsonObjectSchema.parse(value) };
    }
    const readScopeKey = request.source.kind === "candidate"
      ? JSON.stringify(["candidate", request.source.workspace.id, request.source.workspace.ref, readViewer.headers?.[BUILD_TEST_HEADER] ?? null])
      : request.source.kind === "app-candidate"
        ? JSON.stringify(["app-candidate", request.source.app.id, request.source.app.ref, request.source.app.entryId ?? null, readViewer.headers?.[BUILD_TEST_HEADER] ?? null])
        : "registered";
    const outcome = await executeProjectionDataRead(
      owner, readViewer, { member, projection, slot }, request.dataName, submittedInputs, request.runtimeParams, callerUserName, location,
      batchCache, readScopeKey,
    );
    if (outcome.status === "empty") return { status: "empty" };
    let rowOperations;
    if (
      projection.operations && Object.keys(projection.operations).length > 0
      && (outcome.declaration.result === "panelRecordList"
        || outcome.declaration.result === "panelRecordQuery"
        || outcome.declaration.result === "panelOntologyObjects")
    ) {
      const datum = projection.data[request.dataName];
      const inputs = effectiveInputs(projection, member, submittedInputs);
      // Prefer the read declaration's explicit cross-type `rowType` so server rowOperations keys and
      // row targets align with ObjectList's `directReadRowType` fallback for records without `row.className`.
      const fallbackClassName = outcome.declaration.rowType
        ?? (datum
          ? ("type" in datum.source
              ? datum.source.type.id
              : ("literal" in datum.source.object
                  ? datum.source.object.literal.className
                  : (projection.inputs[datum.source.object.input]?.kind === "object"
                      ? (projection.inputs[datum.source.object.input] as { kind: "object"; objectType: string }).objectType
                      : undefined)))
          : undefined);
      const rows = outcome.declaration.result === "panelRecordList"
        ? (outcome.value as import("@ontomato/contracts/panel-projection").PanelRecord[])
        : outcome.declaration.result === "panelRecordQuery"
          ? ((outcome.value as import("@ontomato/contracts/panel-projection").PanelRecordQuery).rows)
          : ((outcome.value as import("@ontomato/contracts/platform-ontology-data").PlatformOntologyObjectsResponse).items.map(item => ({
              primaryKey: item.node.primaryKey,
              className: item.node.className,
              label: item.label,
              fields: {},
            })));
      const { describeRowOperationsForRows } = await import("./direct-operations");
      rowOperations = await describeRowOperationsForRows(
        { owner, credentials: readViewer },
        { panel, projection, member, slot },
        inputs,
        rows,
        fallbackClassName,
      );
    }
    const { rereadAfterMs } = outcome;
    return {
      status: "ready",
      value: outcome.value,
      ...(rereadAfterMs !== undefined && { rereadAfterMs }),
      ...(rowOperations && { rowOperations }),
    };
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) {
      return { status: "forbidden", reason: error.message || tApp("foundation.error.unauthorized") };
    }
    if (error instanceof HttpError && error.status === 401) {
      return { status: "error", message: tApp("foundation.error.unauthorized"), code: "UNAUTHENTICATED" };
    }
    if (error instanceof HttpError && (error.code === "GRAPH_VERSION_CHANGED"
      || error.code === "NO_VISIBLE_FIELDS" || error.code === "NO_READABLE_OBJECT_KEY")) {
      return { status: "error", message: error.message, code: error.code };
    }
    if (error instanceof HttpError || error instanceof BackendUnavailableError || error instanceof z.ZodError || error instanceof SyntaxError)
      return { status: "error", message: error.message };
    if (batchCache) {
      logger.error("Panel batch item failed", error instanceof Error ? error : undefined);
      return { status: "error", message: "Service unavailable" };
    }
    throw error;
  }
}

export async function readProductPanelDataBatch(
  owner: ProductOwner, credentials: AssistantCredentials, requests: readonly ProductPanelReadRequest[],
  { previewHeader, callerUserName, location }: { previewHeader?: string; callerUserName?: string; location?: McpRequestLocation } = {},
): Promise<ProductPanelReadResponse[]> {
  const registeredViewer = previewHeader === undefined ? credentials
    : { ...credentials, headers: { ...credentials.headers, [BUILD_TEST_HEADER]: previewHeader } };
  const batchCache = new PanelReadBatchCache(owner, registeredViewer);
  const registered = requests.flatMap(({ source, memberPath }) =>
    source.kind === "candidate" || source.kind === "app-candidate" ? [] : [{ source, memberPath }],
  );

  const entries = await Promise.allSettled(registered.map(async request =>
    registeredPanelRootId(request.source, await batchCache.entry(request.source))));
  await batchCache.prefetch(entries.flatMap(entry =>
    entry.status === "fulfilled" && entry.value !== undefined ? [{ kind: "panel", id: entry.value }] : []));

  const members = await Promise.allSettled(registered.map(async ({ source, memberPath }) => {
    const { panel } = await requireRegisteredPanelRoot(owner, registeredViewer, source, { batchCache });
    const first = memberPath[0];
    if (first.selection || first.member.startsWith("$state.")) return;
    const target = panel.manifest.members[first.member]?.target;
    if (!target) return;
    if ("projectionId" in target) return { kind: "projection" as const, id: target.projectionId };
    if ("panelId" in target) return { kind: "panel" as const, id: target.panelId };
  }));
  await batchCache.prefetch(members.flatMap(member =>
    member.status === "fulfilled" && member.value ? [member.value] : []));

  return Promise.all(requests.map(request => readProductPanelData(
    owner,
    request.source.kind === "candidate" || request.source.kind === "app-candidate" ? credentials : registeredViewer,
    request, callerUserName, location, batchCache,
  )));
}
