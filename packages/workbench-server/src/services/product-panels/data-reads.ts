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
  AUDIT_LOG, BUILDER_AGENT, DIAGNOSIS_MODEL, GENERAL_SETTINGS, PUBLISHED_MCP_SERVICE,
  ACTION, APPLICATION, ATTRIBUTE, DASHBOARD_CARD, FUNCTION, MCP_SERVICE_OPTION, METRIC_VIEW, OBJECT_TYPE,
  ONTOLOGY_TYPE, PRODUCT_PANEL, PRODUCT_PROJECTION, RELATIONSHIP, SDK_COMPONENT, type PlatformReadDeclaration,
} from "@ontomato/contracts/platform-object-types";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { assertPermission } from "../../identity/installed";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendUnavailableError } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import type { ProductOwner } from "../product-governance/grants";

import { createAuditLogPanelReads } from "../admin/audit-log-panel-reads";
import { createGeneralSettingsReads } from "../admin/general-settings-panel";
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
import type { SkillResolveRequest } from "../skills/panel-reads";
import { createApplicationReadAdapter } from "./application-catalogue";
import { createProductPanelReadAdapter, createProductProjectionReadAdapter } from "./catalog-reads";
import { requireChartReadRegistration } from "./chart-sources";
import { listSdkComponents, readProjectionComponent, readSdkComponent } from "./component-catalogue";
import { requireRegisteredPanelRoot, resolvePanelMemberPath } from "./member-path";

type ReadInputs = ProductPanelReadRequest["inputs"];
type ReadMember = ProductPanel["manifest"]["members"][string];
type ReadSelection = { kind: "platform" | "customer"; typeId: string; method: string; primaryKey?: string };
type ReadAdapter = (selection: ReadSelection, params: Record<string, unknown>, projection: ProductProjection) => Promise<unknown> | unknown;

function customerReads(owner: ProductOwner, viewer: AssistantCredentials, callerUserName?: string): Record<string, ReadAdapter> {
  const customer = createCustomerOntologyReadAdapter(owner, viewer, callerUserName);
  return {
    query: (selection, params) => customer.query(selection.typeId, {
      search: panelReadParameterSchemas.keyword.optional().parse(params.search),
      page: panelReadParameterSchemas.page.optional().parse(params.page),
    }),
    record: selection => customer.record(selection.typeId, selection.primaryKey!),
    neighbors: (selection, params) => customer.neighbors(selection.typeId, {
      node: panelReadParameterSchemas.graphNode.parse(params.node),
      relationKinds: panelReadParameterSchemas.relationKinds.optional().parse(params.relationKinds),
      limit: panelReadParameterSchemas.neighborsLimit.optional().parse(params.limit),
    }),
  };
}

function readAdapters(owner: ProductOwner, viewer: AssistantCredentials, callerUserName?: string, location?: McpRequestLocation): Record<string, Record<string, ReadAdapter>> {
  const schedules = createScheduledTaskReadAdapter(viewer);
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
  const metrics = createMetricReadAdapter(owner, viewer, callerUserName);
  const functions = createFunctionReadAdapter(owner, viewer, callerUserName);
  const cards = createDashboardCardReadAdapter(owner, viewer);
  const formParams = (params: Record<string, unknown>) => {
    const values = panelReadParameterSchemas.panelFormValues.optional().parse(params.values);
    requireFormFieldNames(values, "values");
    return {
      values,
      changedField: panelReadParameterSchemas.changedField.optional().parse(params.changedField) ?? null,
    };
  };
  const modelReads: Record<string, ReadAdapter> = {
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
      list: async () => (await actions()).list(),
      record: async selection => (await actions()).record(selection.primaryKey!),
      form: async (selection, params) => (await actions()).form(selection.primaryKey!, formParams(params)),
      createForm: async (_selection, params) => (await actions()).createForm(formParams(params)),
      definition: async selection => (await actions()).definition(selection.primaryKey!),
      explanation: async selection => (await actions()).explanation(selection.primaryKey!),
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
      catalogue: (_selection, params) => listSdkComponents(owner, viewer.locale, panelReadParameterSchemas.keyword.optional().parse(params.search)),
      definition: selection => readSdkComponent(owner, selection.primaryKey!, viewer.locale),
    },
    [USER]: {
      options: async (_selection, params) => (await options()).users.options({
        keyword: panelReadParameterSchemas.keyword.optional().parse(params.keyword),
        page: panelReadParameterSchemas.page.optional().parse(params.page),
      }),
      resolve: async (_selection, params) => (await options()).users.resolve(params.values as readonly unknown[]),
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
    [OBJECT_TYPE]: modelReads,
    [ATTRIBUTE]: modelReads,
    [RELATIONSHIP]: modelReads,
    [PRODUCT_PROJECTION]: catalogueReads(projectionCatalogue),
    [PRODUCT_PANEL]: {
      ...catalogueReads(panelCatalogue),
      members: selection => panelCatalogue.members(selection.primaryKey!),
    },
    [APPLICATION]: {
      query: (_selection, params) => applications.query(params),
      record: selection => applications.record(selection.primaryKey!),
      entries: selection => applications.entries(selection.primaryKey!),
      grants: selection => applications.grants(selection.primaryKey!),
      form: (selection, params) => applications.form(selection.primaryKey!, {
        ...formParams(params), section: panelReadParameterSchemas.applicationFormSection.parse(params.section),
      }),
      createForm: (_selection, params) => applications.createForm(formParams(params)),
    },
    [ONTOLOGY_TYPE]: {
      schema: async () => (await ontology()).schema(),
      counts: async () => (await ontology()).counts(),
      start: async () => (await ontology()).start(),
      neighbors: async (_selection, params) => (await ontology()).neighbors(params),
      objects: async (_selection, params) => (await ontology()).objects(params),
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
        return source && "state" in source && panelReadParameterId(directReadDeclaration(projection, datum)!, name);
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

export async function readProductPanelData(
  owner: ProductOwner, viewer: AssistantCredentials, request: ProductPanelReadRequest, callerUserName?: string, location?: McpRequestLocation,
): Promise<ProductPanelReadResponse> {
  try {
    const { member, projection, panel, viewer: readViewer } = await resolveReadMember(owner, viewer, request);
    const inputs = effectiveInputs(projection, member, request.inputs);
    if ("operations" in request) {
      const { readAdmittedProjectionOperations } = await import("./direct-operations");
      const value = await readAdmittedProjectionOperations({ owner, credentials: readViewer },
        { panel, projection, member, slot: request.memberPath.at(-1)!.member }, inputs);
      return { status: "ready", value };
    }
    if (!Object.hasOwn(projection.data, request.dataName)) return {
      status: "error",
      message: `Member ${JSON.stringify(request.memberPath.at(-1)!.member)} does not declare dataName ${JSON.stringify(request.dataName)}. Declared data names: ${JSON.stringify(Object.keys(projection.data))}.`,
    };
    const data = projection.data[request.dataName];
    const declaration = directReadDeclaration(projection, data)!;
    const params = await readParameters(projection, member, request.dataName, data, declaration, inputs, request.runtimeParams);
    if (declaration.parameterMode === "fixed") {
      for (const name of declaration.requiredParams ?? [])
        if (!Object.hasOwn(params, name)) throw new HttpError(400, `Missing read parameter: ${name}`, "PANEL_INPUT_REQUIRED");
    }
    const selection = readSelection(data, inputs);
    const read = selection.kind === "customer"
      ? customerReads(owner, readViewer, callerUserName)[selection.method]
      : readAdapters(owner, readViewer, callerUserName, location)[selection.typeId]?.[selection.method];
    if (!read) throw new HttpError(422, "The owner read is unavailable", "PANEL_READ_UNAVAILABLE");
    const result = await read(selection, params, projection);
    if (declaration.result === "panelRecordList") {
      const value = panelReadResultSchemas.panelRecordList.parse(result);
      return value.length ? { status: "ready", value } : { status: "empty" };
    }
    if (declaration.result === "metricOutput") {
      const value = panelReadResultSchemas.metricOutput.parse(result);
      return value.rows.length || value.truncation ? { status: "ready", value } : { status: "empty" };
    }
    return { status: "ready", value: panelReadResultSchemas[declaration.result].parse(result) };
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return { status: "forbidden" };
    if (error instanceof HttpError || error instanceof BackendUnavailableError || error instanceof z.ZodError || error instanceof SyntaxError)
      return { status: "error", message: error.message };
    throw error;
  }
}
