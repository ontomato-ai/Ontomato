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
import { authoredReadParameterSource, directReadDeclaration, panelReadParameterId, panelReadParameterSchemas, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import {
  AUDIT_LOG, BUILDER_AGENT, DIAGNOSIS_MODEL, GENERAL_SETTINGS, MODEL_CONNECTION, MODEL_ENTRY, MODEL_USAGE, PUBLISHED_MCP_SERVICE,
  ACTION, APPLICATION, ATTRIBUTE, DASHBOARD_CARD, FUNCTION, MCP_SERVICE_OPTION, METRIC_VIEW, OBJECT_TYPE,
  ONTOLOGY_RELATION_KIND, ONTOLOGY_TYPE, ORG_GRANT, ORG_MEMBERSHIP, ORG_POSITION, ORG_UNIT, PERMISSION_POLICY, PRODUCT_PANEL,
  PRODUCT_PROJECTION, RELATIONSHIP, ROLE, SDK_COMPONENT, TRIGGER, WORKFLOW,
  type PlatformReadDeclaration,
} from "@ontomato/contracts/platform-object-types";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { assertPermission } from "../../identity/installed";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendUnavailableError } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import { searchProductGrantPrincipals, type ProductOwner } from "../product-governance/grants";

import { createAuditLogPanelReads } from "../admin/audit-log-panel-reads";
import { createGeneralSettingsReads } from "../admin/general-settings-panel";
import {
  createModelConnectionReads, createModelEntryReads, createModelUsageReads,
} from "../admin/model-settings-panel";
import { createBuilderModelReads } from "../app-builder/panel-model";
import { createDiagnosisModelReads } from "../ops-diagnosis/panel-model";
import { readPublishedMcpService, readPublishedMcpServices } from "../mcp/panel-reads";
import type { McpRequestLocation } from "../mcp/catalog";
import { createDashboardCardReadAdapter } from "../dashboard/chart-sources";
import { createFunctionReadAdapter, createMetricReadAdapter } from "../metric-function/panel-reads";
import { createCustomerOntologyReadAdapter } from "../ontology-model/customer-reads";
import { createBusinessKnowledgeReadAdapter } from "../business-knowledge/panel-reads";
import { createOntologyModelReadAdapter } from "../ontology-model/model-reads";
import { createScheduledTaskReadAdapter } from "../scheduling/panel-reads";
import { createGovernanceReadAdapters } from "../governance/panel-reads";
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
import { requireRegisteredPanelRoot, resolvePanelMemberPath } from "./member-path";

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

function customerReads(owner: ProductOwner, viewer: AssistantCredentials, callerUserName?: string): Record<string, ReadAdapter> {
  const customer = createCustomerOntologyReadAdapter(owner, viewer, callerUserName);
  return {
    query: (selection, params) => customer.query(selection.typeId, {
      search: panelReadParameterSchemas.keyword.optional().parse(params.search),
      page: panelReadParameterSchemas.page.optional().parse(params.page),
    }),
    record: selection => customer.record(selection.typeId, selection.primaryKey!),
    form: (selection, params) => customer.form(selection.typeId, selection.primaryKey!, formParams(params)),
    createForm: (selection, params) => customer.createForm(selection.typeId, formParams(params)),
    neighbors: (selection, params) => customer.neighbors(selection.typeId, {
      node: panelReadParameterSchemas.graphNode.parse(params.node),
      relationKinds: panelReadParameterSchemas.relationKinds.optional().parse(params.relationKinds),
      limit: panelReadParameterSchemas.neighborsLimit.optional().parse(params.limit),
    }),
  };
}

function readAdapters(owner: ProductOwner, viewer: AssistantCredentials, callerUserName?: string, location?: McpRequestLocation): Record<string, Record<string, ReadAdapter>> {
  const schedules = createScheduledTaskReadAdapter(viewer);
  const governance = createGovernanceReadAdapters(viewer);
  const ontology = async () => {
    const { createPlatformOntologyReadAdapter } = await import("../platform-ontology/panel-reads");
    return createPlatformOntologyReadAdapter(owner, viewer, callerUserName);
  };
  const knowledge = createBusinessKnowledgeReadAdapter(viewer);
  const model = createOntologyModelReadAdapter(owner, viewer, callerUserName);
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
  const cards = createDashboardCardReadAdapter(owner, viewer);
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
  const catalogueReads = (adapter: typeof projectionCatalogue | typeof panelCatalogue): Record<string, ReadAdapter> => ({
    query: (_selection, params) => adapter.query(params),
    record: selection => adapter.record(selection.primaryKey!),
    form: (selection, params) => adapter.form(selection.primaryKey!, formParams(params)),
    createForm: (_selection, params) => adapter.createForm(formParams(params)),
    usedBy: selection => adapter.usedBy(selection.primaryKey!),
    grants: selection => adapter.grants(selection.primaryKey!),
  });
  const definitions = async () => {
    const { createAgentDefinitionReadAdapter } = await import("../assistant/panel-reads");
    return createAgentDefinitionReadAdapter(owner, viewer);
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
    const { agentDefinitionPermissions } = await import("../assistant/definitions");
    await assertPermission(viewer, agentDefinitionPermissions);
    return skillLibrary();
  };
  const feedback = async () => {
    const { createFeedbackReadAdapter } = await import("../admin/feedback-panel-reads");
    return createFeedbackReadAdapter(owner, viewer);
  };
  const audit = createAuditLogPanelReads(viewer);
  const general = createGeneralSettingsReads({ owner, credentials: viewer });
  const modelConnections = createModelConnectionReads({ owner, credentials: viewer });
  const modelEntries = createModelEntryReads({ owner, credentials: viewer });
  const modelUsage = createModelUsageReads({ owner, credentials: viewer });
  const diagnosis = createDiagnosisModelReads(owner.domainId, viewer);
  const builder = createBuilderModelReads(owner, viewer);
  return {
    [PUBLISHED_MCP_SERVICE]: {
      list: () => readPublishedMcpServices(viewer, location),
      record: selection => readPublishedMcpService(viewer, selection.primaryKey!, location),
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
      agentUsages: selection => modelUsage.agentUsages(selection.primaryKey!),
    },
    [DIAGNOSIS_MODEL]: {
      list: () => diagnosis.list(),
      record: selection => diagnosis.record(selection.primaryKey!),
      form: (selection, params) => diagnosis.form(selection.primaryKey!, formParams(params)),
    },
    [BUILDER_AGENT]: {
      list: () => builder.list(),
      record: selection => builder.record(selection.primaryKey!),
      form: (selection, params) => builder.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => builder.createForm(formParams(params)),
    },
    [ACTION]: {
      count: async () => (await actions()).count(),
      list: async () => (await actions()).list(),
      record: async selection => (await actions()).record(selection.primaryKey!),
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
      list: async () => (await triggers()).list(),
      query: async (_selection, params) => (await triggers()).query(params),
      record: async selection => (await triggers()).record(selection.primaryKey!),
      form: async (selection, params) => (await triggers()).form(selection.primaryKey!, formParams(params)),
      createForm: async (_selection, params) => (await triggers()).createForm(formParams(params)),
    },
    [WORKFLOW]: {
      count: async () => (await workflows()).count(),
      list: async () => (await workflows()).list(),
    },
    [METRIC_VIEW]: {
      query: (_selection, params) => metrics.query(params),
      record: selection => metrics.record(selection.primaryKey!),
      form: (selection, params) => metrics.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => metrics.createForm(formParams(params)),
      result: (selection, params) => metrics.result(selection.primaryKey!, runtimeJsonObjectSchema.parse(params)),
    },
    [FUNCTION]: {
      query: (_selection, params) => functions.query(params),
      record: selection => functions.record(selection.primaryKey!),
      form: (selection, params) => functions.form(selection.primaryKey!, formParams(params)),
      createForm: (_selection, params) => functions.createForm(formParams(params)),
    },
    [DASHBOARD_CARD]: {
      chartTemplate: ({ primaryKey }, _params, projection) => cards.chartTemplate(
        primaryKey!, requireChartReadRegistration(projection, primaryKey!),
      ),
      result: ({ primaryKey }, params, projection) => cards.result(
        primaryKey!, requireChartReadRegistration(projection, primaryKey!), runtimeJsonObjectSchema.parse(params),
      ),
    },
    [AGENT_DEFINITION]: {
      count: async () => (await definitions()).count(),
      list: async () => (await definitions()).list(),
      record: async selection => (await definitions()).record(selection.primaryKey!),
      form: async (selection, params) => (await definitions()).form(selection.primaryKey!, formParams(params)),
      createForm: async (_selection, params) => (await definitions()).createForm(formParams(params)),
    },
    [MODEL_OPTION]: {
      options: async () => (await options()).models.options(),
      resolve: async (_selection, params) => (await options()).models.resolve(params.values as readonly unknown[]),
    },
    [MCP_SERVICE_OPTION]: {
      async options() {
        const { createMcpServiceOptionReadAdapter } = await import("../assistant/panel-reads");
        return createMcpServiceOptionReadAdapter(owner, viewer).options();
      },
      async resolve(_selection, params) {
        const { createMcpServiceOptionReadAdapter } = await import("../assistant/panel-reads");
        return createMcpServiceOptionReadAdapter(owner, viewer).resolve(panelReadParameterSchemas.optionValues.parse(params.values));
      },
    },
    [SDK_COMPONENT]: {
      count: () => countSdkComponents(owner),
      catalogue: (_selection, params) => listSdkComponents(owner, viewer.locale, panelReadParameterSchemas.keyword.optional().parse(params.search)),
      definition: selection => readSdkComponent(owner, selection.primaryKey!, viewer.locale),
      record: selection => readSdkComponentRecord(owner, selection.primaryKey!, viewer.locale),
      dataRows: selection => readSdkComponentDataRows(owner, selection.primaryKey!, viewer.locale),
      configRows: selection => readSdkComponentConfigRows(owner, selection.primaryKey!, viewer.locale),
      inputRows: selection => readSdkComponentInputRows(owner, selection.primaryKey!, viewer.locale),
      outputRows: selection => readSdkComponentOutputRows(owner, selection.primaryKey!, viewer.locale),
      operationRows: selection => readSdkComponentOperationRows(owner, selection.primaryKey!, viewer.locale),
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
      effectivePermissions: selection => governance.users.effectivePermissions(selection.primaryKey!),
      lookupAccount: (_selection, params) => governance.users.lookupAccount(panelReadParameterSchemas.keyword.parse(params.keyword)),
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
      menuPermissions: selection => governance.policies.menuPermissions(selection.primaryKey!),
      apiPermissions: (selection, params) => governance.policies.apiPermissions(
        selection.primaryKey!, panelReadParameterSchemas.keyword.optional().parse(params.search),
      ),
      dataPermissions: selection => governance.policies.dataPermissions(selection.primaryKey!),
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
      options: () => model.objectTypeOptions(),
      resolve: (_selection, params) => model.resolveObjectTypes(panelReadParameterSchemas.optionValues.parse(params.values)),
    },
    [ATTRIBUTE]: modelReads,
    [RELATIONSHIP]: modelReads,
    [PRODUCT_PROJECTION]: {
      ...catalogueReads(projectionCatalogue),
      usedByRows: selection => projectionCatalogue.usedByRows(selection.primaryKey!),
      grantRows: selection => projectionCatalogue.grantRows(selection.primaryKey!),
      dataRows: selection => projectionCatalogue.dataRows(selection.primaryKey!),
      configRows: selection => projectionCatalogue.configRows(selection.primaryKey!),
      inputRows: selection => projectionCatalogue.inputRows(selection.primaryKey!),
      outputRows: selection => projectionCatalogue.outputRows(selection.primaryKey!),
      operationRows: selection => projectionCatalogue.operationRows(selection.primaryKey!),
    },
    [PRODUCT_PANEL]: {
      ...catalogueReads(panelCatalogue),
      unavailable: () => panelCatalogue.unavailable(),
      usedByRows: selection => panelCatalogue.usedByRows(selection.primaryKey!),
      grantRows: selection => panelCatalogue.grantRows(selection.primaryKey!),
      members: selection => panelCatalogue.members(selection.primaryKey!),
      memberRows: selection => panelCatalogue.memberRows(selection.primaryKey!),
      sourceFiles: selection => panelCatalogue.sourceFiles(selection.primaryKey!),
      sourceFile: (selection, params) => panelCatalogue.sourceFile(
        selection.primaryKey!,
        panelReadParameterSchemas.skillFilePath.parse(params.path),
      ),
    },
    [APPLICATION]: {
      query: (_selection, params) => applications.query(params),
      record: selection => applications.record(selection.primaryKey!),
      entries: selection => applications.entries(selection.primaryKey!),
      entryRows: selection => applications.entryRows(selection.primaryKey!),
      usedPanels: selection => applications.usedPanels(selection.primaryKey!),
      grants: selection => applications.grants(selection.primaryKey!),
      grantRows: selection => applications.grantRows(selection.primaryKey!),
      form: (selection, params) => applications.form(selection.primaryKey!, {
        ...formParams(params),
        section: panelReadParameterSchemas.applicationFormSection.parse(params.section),
        entryId: panelReadParameterSchemas.applicationEntryId.optional().parse(params.entryId),
      }),
      createForm: (_selection, params) => applications.createForm(formParams(params)),
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
      record: selection => schedules.record(selection.primaryKey!),
      runs: (selection, params) => schedules.runs(selection.primaryKey!, panelReadParameterSchemas.cursor.optional().parse(params.cursor)),
      run: (selection, params) => schedules.run(selection.primaryKey!, panelReadParameterSchemas.scheduledRunId.parse(params.runId)),
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

async function resolveReadMember(owner: ProductOwner, viewer: AssistantCredentials, request: ProductPanelReadRequest) {
  const { source, memberPath } = request;
  if (source.kind === "candidate") {
    const { resolvePanelCandidateMember } = await import("../workspaces/panel-candidate");
    const { panel, member, projection, previewContext } = await resolvePanelCandidateMember(owner, viewer, source.workspace, memberPath);
    const headers = { ...viewer.headers, [BUILD_TEST_HEADER]: JSON.stringify({
      kind: "build-test", contextId: previewContext.test?.contextId ?? null,
    }) };
    return { member, projection, panel, viewer: { ...viewer, headers } };
  }

  const { panel, entry } = await requireRegisteredPanelRoot(owner, viewer, source);
  const placement = await resolvePanelMemberPath(owner, viewer, panel, memberPath, entry);
  if (placement.kind !== "projection")
    throw new HttpError(403, "The member path does not select a projection", "PANEL_MEMBER_FORBIDDEN");
  return { ...placement, viewer };
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

async function readParameters(
  projection: ProductProjection, member: ReadMember, dataName: string, data: DirectProjectionData,
  declaration: PlatformReadDeclaration, inputs: ReadInputs, runtimeParams: ProductPanelReadRequest["runtimeParams"],
) {
  const resolved = new Map<string, unknown>();
  const runtime = Object.entries(runtimeParams ?? {});
  if (runtime.length) {
    const component = await readProjectionComponent(projection.componentId, undefined, projection.domainId);
    const names = appsSdkComponentDatum(component?.data, dataName)?.runtimeParams ?? [];
    for (const [name, value] of runtime) {
      const parameter = panelReadParameterId(declaration, name);
      if (!parameter || !names.includes(name))
        throw new HttpError(400, `Runtime parameter '${name}' is not declared for data '${dataName}'`, "PANEL_RUNTIME_PARAMETER_UNKNOWN");
      if (value == null) continue;
      const parsed = panelReadParameterSchemas[parameter].parse(value);
      if (!authoredReadParameterSource(data.params, name, member)) resolved.set(name, parsed);
    }
  }
  const authored = new Set([...Object.keys(data.params), ...Object.keys(member.inputs ?? {}), ...Object.keys(member.outputs ?? {})]);
  for (const name of authored) {
    const source = authoredReadParameterSource(data.params, name, member);
    const parameter = panelReadParameterId(declaration, name);
    if (!source || !parameter) continue;
    const value = "literal" in source ? source.literal : inputs["input" in source ? source.input : name];
    if (value != null) resolved.set(name, panelReadParameterSchemas[parameter].parse(value));
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
  | { status: "ready"; value: Extract<ProductPanelReadResponse, { status: "ready" }>["value"]; declaration: PlatformReadDeclaration }
  | { status: "empty"; declaration: PlatformReadDeclaration };

export async function executeProjectionDataRead(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  { member, projection, slot }: { member: ReadMember; projection: ProductProjection; slot: string },
  dataName: string,
  submittedInputs: ReadInputs,
  runtimeParams?: ProductPanelReadRequest["runtimeParams"],
  callerUserName?: string,
  location?: McpRequestLocation,
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
  const params = await readParameters(projection, member, dataName, data, declaration, inputs, runtimeParams);
  if (declaration.parameterMode === "fixed") {
    for (const name of declaration.requiredParams ?? [])
      if (!Object.hasOwn(params, name)) throw new HttpError(400, `Missing read parameter: ${name}`, "PANEL_INPUT_REQUIRED");
  }
  const selection = readSelection(data, inputs);
  const read = selection.kind === "customer"
    ? customerReads(owner, viewer, callerUserName)[selection.method]
    : readAdapters(owner, viewer, callerUserName, location)[selection.typeId]?.[selection.method];
  if (!read) throw new HttpError(422, "The owner read is unavailable", "PANEL_READ_UNAVAILABLE");
  const result = await read(selection, params, projection);
  if (declaration.result === "panelRecordList") {
    const value = panelReadResultSchemas.panelRecordList.parse(result);
    return value.length ? { status: "ready", value, declaration } : { status: "empty", declaration };
  }
  if (declaration.result === "metricOutput") {
    const value = panelReadResultSchemas.metricOutput.parse(result);
    return value.rows.length || value.truncation ? { status: "ready", value, declaration } : { status: "empty", declaration };
  }
  return {
    status: "ready",
    value: panelReadResultSchemas[declaration.result].parse(result) as Extract<ProductPanelReadResponse, { status: "ready" }>["value"],
    declaration,
  };
}

export async function readProductPanelData(
  owner: ProductOwner, viewer: AssistantCredentials, request: ProductPanelReadRequest, callerUserName?: string, location?: McpRequestLocation,
): Promise<ProductPanelReadResponse> {
  try {
    const { member, projection, panel, viewer: readViewer } = await resolveReadMember(owner, viewer, request);
    const slot = request.memberPath.at(-1)!.member;
    if ("operations" in request) {
      const inputs = effectiveInputs(projection, member, request.inputs);
      const { readAdmittedProjectionOperations } = await import("./direct-operations");
      const value = await readAdmittedProjectionOperations({ owner, credentials: readViewer },
        { panel, projection, member, slot }, inputs);
      return { status: "ready", value: runtimeJsonObjectSchema.parse(value) };
    }
    const outcome = await executeProjectionDataRead(
      owner, readViewer, { member, projection, slot }, request.dataName, request.inputs, request.runtimeParams, callerUserName, location,
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
      const inputs = effectiveInputs(projection, member, request.inputs);
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
    return { status: "ready", value: outcome.value, ...(rowOperations && { rowOperations }) };
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return { status: "forbidden" };
    if (error instanceof HttpError || error instanceof BackendUnavailableError || error instanceof z.ZodError || error instanceof SyntaxError)
      return { status: "error", message: error.message };
    throw error;
  }
}
