import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { ProductPanelReadRequest, ProductPanelReadResponse, ProductPanelReadSource } from "@ontomato/contracts/panel-host";
import type { PanelFormDescription, PanelFormValues, PanelRecord, PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import {
  ACTION, APPLICATION, APPLICATION_DELETE_DRAFT, ATTRIBUTE, AUDIT_LOG, AUTOTEST_RUN, BUSINESS_KNOWLEDGE, DATA_ADAPTER_CONFIG, DSL_QUERY, EXTERNAL_MCP_SERVICE,
  FUNCTION, GENERAL_SETTINGS, METRIC_VIEW, MODEL_OPTION, OBJECT_TYPE, PERMISSION_POLICY, RELATIONSHIP, ROLE, TRIGGER, TURN_EVIDENCE, USER, WORKFLOW,
  type PlatformReadDeclaration,
} from "@ontomato/contracts/platform-object-types";
import { ZodError } from "zod";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { HttpError } from "../../utils/errors";
import { requireFormFieldNames } from "../../utils/form-field-names";
import { createActionPanelReadPresenter } from "../action/panel-reads";
import { createAuditLogPanelReadPresenter } from "../admin/audit-log-panel-reads";
import { createDataAdapterConfigPanelReadPresenter } from "../admin/data-adapters-panel";
import { createGeneralSettingsPanelReadPresenter } from "../admin/general-settings-panel";
import { prepareModelSettingsRead } from "../admin/model-settings-panel";
import { createModelOptionPanelReadPresenter, prepareExecutionUserRead } from "../assistant/panel-reads";
import { prepareBuilderSourceFacts } from "../app-builder/registered-source-reads";
import { prepareBuilderPanelFacts, prepareBuilderPanelRead } from "../app-builder/application-panel-reads";
import { createBusinessKnowledgePanelReadPresenter } from "../business-knowledge/panel-reads";
import { preparePanelMetricRead } from "../dashboard/panel-chart-read-plan";
import { withPolicyFormEntryUsage } from "../governance/panel-reads";
import { effectiveAccessNeedsWorkbenchCatalog, loadPolicyWorkbenchCatalog } from "../governance/policy-catalog";
import type { McpRequestLocation } from "../mcp/catalog";
import { preparePublishedMcpRead } from "../mcp/panel-reads";
import { createFunctionPanelReadPresenter, createMetricPanelReadPresenter } from "../metric-function/panel-reads";
import { renderModelRead, withModelingPath } from "../ontology-model/model-reads";
import { prepareRegisteredOntologyRead } from "../platform-ontology/registered-reads";
import { prepareRegisteredTriggerRead } from "../scheduling/registered-trigger-reads";
import { presentAutotestRunRowOperations, presentTurnEvidenceRetentionRows } from "../ops-diagnosis/panel-operation-reads";
import { prepareSkillLibraryRead, prepareSkillSelectorRead } from "../skills/registered-library-reads";
import { workflowText } from "../workflow/definition";
import { presentWorkflowLifecycleRows } from "../workflow/panel-operation-reads";
import { createWorkflowPanelReadPresenter, prepareWorkflowPanelRead } from "../workflow/panel-reads";
import { prepareAgentDefinitionRead } from "./agent-definition-directory";
import {
  applicationCatalogueQueryParameters, createApplicationPanelReadPresenter, prepareApplicationGalleryRead, prepareApplicationPanelFormRead,
} from "./application-catalogue";
import { prepareProductCatalogueQuery, prepareProductCatalogueRead } from "./catalog-reads";
import { personalEntry, withPanelReadRegistration } from "./application-use";
import { prepareCustomerDataRead } from "./customer-data-read-plan";
import { presentRowOperationsForRows } from "./direct-operations";
import { effectiveInputs, panelMemberReadRefusal, panelReadUseCollector, prepareProjectionDataRead, projectionDataReadOutcome, resolveReadMember, stableJson } from "./data-reads";
import { prepareGovernanceListRows } from "./governance-list-row-operations";
import { isProductAssetGraphRead, prepareProductAssetGraphRead } from "./asset-graph-read";
import { prepareFavoriteObjectRead, preparePersonalFavoriteRead } from "./favorite-panel";
import { locateViaJava, readViaJava, type JavaPanelLocateRef, type JavaPanelRead, type JavaPanelReadResult } from "./java-panel-reads";
import { memberQueryOperationParams, memberQueryPayloadSchema, presentMemberQueryRowOperations } from "./member-query-presentation";
import { PanelReadBatchCache } from "./member-path";
import type { PanelReadSelection } from "./panel-owner-reads";
import { prepareRecentVisitRead } from "./recent-visit-panel";
import { registeredLocalReads } from "./registered-local-reads";
import { prepareRegisteredOperationRead } from "./registered-operation-reads";
import { operationHost } from "./operation-host";
import { attributeDeleteRowBindings, presentAttributeDeleteRows } from "./registered-attribute-reads";

type RegisteredSource = Extract<ProductPanelReadSource, { kind: "registered" | "frame" }>;
export type RegisteredDataRead = ProductPanelReadRequest & { source: RegisteredSource };

function entryKey({ applicationId, useId, kind }: JavaPanelLocateRef) {
  return JSON.stringify([applicationId, useId, kind ?? "registered"]);
}

function objectTypeFactsCall(typeId: string, method: string): JavaPanelRead["call"] {
  if (typeId !== OBJECT_TYPE) return undefined;
  if (method === "options" || method === "resolve") return { type: OBJECT_TYPE, name: "options", parameters: {} };
  if (method === "detailPanel" || method === "detailPanelForm")
    return { type: OBJECT_TYPE, name: "detailPanel", parameters: {} };
  return undefined;
}

const messageOnlyOwnerCodes = new Map<string, readonly string[]>([
  [`${TRIGGER}.record`, ["TASK_NOT_FOUND"]],
  [`${METRIC_VIEW}.record`, ["METRIC_VIEW_NOT_FOUND"]],
  [`${FUNCTION}.record`, ["FUNCTION_NOT_FOUND"]],
  [`${METRIC_VIEW}.result`, ["ONTOLOGY_QUERY_FAILED", "METRIC_VIEW_NOT_FOUND", "METRIC_VIEW_NOT_EXECUTABLE"]],
]);

function ownerError(message: string, code?: string | null, selection?: PanelReadSelection): ProductPanelReadResponse {
  const messageOnly = code && selection && messageOnlyOwnerCodes.get(`${selection.typeId}.${selection.method}`)?.includes(code);
  return { status: "error", message, ...(code && !messageOnly && { code }) };
}

function refusal(error: unknown, selection?: PanelReadSelection): ProductPanelReadResponse {
  if (!(error instanceof HttpError)) throw error;
  if (error.code === "PANEL_DATA_NAME_UNKNOWN") return panelMemberReadRefusal(error)!;
  return error.status === 403
    ? { status: "forbidden", reason: error.message }
    : ownerError(error.message, error.code, selection);
}

/** Build the execution plan only after the entry owner has authenticated this request and returned its facts. */
export async function prepareRegisteredDataReads(
  credentials: AssistantCredentials, reads: readonly RegisteredDataRead[], { location }: { location?: McpRequestLocation } = {},
) {
  const refs = [...new Map(reads.map(({ source: { applicationId, useId, kind } }) => {
    const ref: JavaPanelLocateRef = { applicationId, useId, ...(kind === "frame" && { kind }) };
    return [entryKey(ref), ref];
  })).values()];
  const { viewer, entries } = await locateViaJava(refs, credentials);
  const registrations = new Map(refs.map((ref, index) => [entryKey(ref), entries[index]]));
  const lookup = (source: JavaPanelLocateRef) => {
    const item = registrations.get(entryKey(source))!;
    if (item.kind === "error") throw new HttpError(item.status, item.error, item.code);
    return item;
  };
  const cache = new PanelReadBatchCache(viewer, credentials, async source => personalEntry(withPanelReadRegistration(lookup(source).entry), viewer));
  const plans = await Promise.all(reads.map(async request => {
    const { source } = request;
    let located: ReturnType<typeof lookup>;
    try { located = lookup(source); }
    catch (error) { return { ok: false as const, result: refusal(error) }; }
    const { entry } = located;
    const { registration } = withPanelReadRegistration(entry);
    const { uses, collect: collectUse } = panelReadUseCollector(viewer.domainId, true);
    const path = () => ({ source, registration, uses: [...uses.values()] });
    try {
      const resolved = await resolveReadMember(viewer, credentials, request, cache, collectUse);
      const placement = { ...resolved, slot: request.memberPath.at(-1)!.member };
      if ("operations" in request) {
        const inputs = effectiveInputs(placement.projection, placement.member, resolved.inputs);
        const { calls, visibilityRead, present } = await prepareRegisteredOperationRead(placement, inputs, viewer, credentials);
        const admittedPath = path();
        const reads: JavaPanelRead[] = calls.map(call => ({ ...admittedPath, call }));
        if (visibilityRead) reads.push({ ...admittedPath, visibleKinds: visibilityRead });
        return { ok: true as const, kind: "operations" as const, reads: reads.length ? reads : [admittedPath], presentOperations: present };
      }
      const prepared = await prepareProjectionDataRead(credentials, placement, request.dataName, resolved.inputs,
        request.runtimeParams, "component" in resolved ? resolved.component : undefined);
      const { selection, params, inputs } = prepared;
      const mcpConfigurationRead = selection.typeId === EXTERNAL_MCP_SERVICE
        && (selection.method === "form" || selection.method === "createForm");
      const modelFormRead = (selection.typeId === OBJECT_TYPE || selection.typeId === ATTRIBUTE || selection.typeId === RELATIONSHIP)
        && (selection.method === "form" || selection.method === "createForm" || selection.method === "inlineForm");
      if ((selection.typeId === GENERAL_SETTINGS && selection.method === "form")
        || (selection.typeId === DATA_ADAPTER_CONFIG && (selection.method === "form" || selection.method === "routingForm"))
        || ((selection.typeId === ROLE || selection.typeId === PERMISSION_POLICY)
          && (selection.method === "form" || selection.method === "createForm"))
        || mcpConfigurationRead || modelFormRead) {
        requireFormFieldNames(params.values, "values");
      }
      const customerRead = prepareCustomerDataRead(selection, params, credentials.locale);
      const skillLibraryRead = prepareSkillLibraryRead(viewer, credentials, selection, params, placement.projection);
      const ownerRead = customerRead ?? prepareExecutionUserRead(selection, params, credentials.locale)
        ?? prepareApplicationPanelFormRead(selection, params, viewer.domainId, credentials.locale)
        ?? await prepareAgentDefinitionRead(viewer, credentials, selection, params)
        ?? prepareApplicationGalleryRead(viewer, credentials, selection, params)
        ?? await prepareProductCatalogueRead(viewer, credentials, selection, params)
        ?? await prepareBuilderPanelRead(viewer, credentials, selection, params)
        ?? preparePublishedMcpRead(selection, credentials.locale, location)
        ?? prepareModelSettingsRead(selection, params, credentials.locale)
        ?? prepareWorkflowPanelRead(selection, params, credentials.locale)
        ?? preparePersonalFavoriteRead(viewer, credentials, selection, params)
        ?? prepareRecentVisitRead(viewer, credentials, selection, params)
        ?? await preparePanelMetricRead(viewer, placement.projection, prepared, credentials.locale)
        ?? (isProductAssetGraphRead(selection) ? await prepareProductAssetGraphRead(viewer, credentials.locale) : undefined)
        ?? skillLibraryRead
        ?? await prepareSkillSelectorRead(viewer, credentials, selection, params);
      const local = registeredLocalReads[selection.typeId]?.[selection.method];
      const factPlan = await prepareRegisteredOntologyRead(selection, viewer, credentials, params)
        ?? prepareRegisteredTriggerRead(selection, params, credentials)
        ?? await prepareBuilderPanelFacts(viewer, credentials, selection, params)
        ?? await prepareBuilderSourceFacts(viewer, credentials, selection, params, placement.projection, inputs)
        ?? await prepareFavoriteObjectRead(viewer, selection, params, credentials.locale)
        ?? await prepareProductCatalogueQuery(viewer, credentials, selection, params);
      const ownerFacts = factPlan && {
        ...factPlan,
        facts: factPlan.facts.map(fact => ({ ...path(), ...fact })),
      };
      const visibleKinds = ownerRead && "visibility" in ownerRead ? ownerRead.visibility : local?.visibility;
      const objectTypeFacts = objectTypeFactsCall(selection.typeId, selection.method);
      const functionQuery = selection.typeId === FUNCTION && selection.method === "query";
      const actionDetails = selection.typeId === ACTION && (selection.method === "definition" || selection.method === "explanation");
      const dslForm = selection.typeId === DSL_QUERY && selection.method === "form";
      const effectiveAccess = (selection.typeId === USER || selection.typeId === ROLE) && selection.method === "effectiveAccess";
      const category = params.category as string | undefined;
      const ownerParams = selection.typeId === APPLICATION && selection.method === "query"
        ? applicationCatalogueQueryParameters(params)
        : functionQuery ? { ...(params.operation !== undefined && { operation: params.operation }) }
        : effectiveAccess ? {
          ...(category && { category }),
          ...(effectiveAccessNeedsWorkbenchCatalog(category) && {
            workbenchCatalog: await loadPolicyWorkbenchCatalog(viewer.domainId, credentials.locale),
          }),
        } : selection.typeId === PERMISSION_POLICY && selection.method === "objectGrantCandidates" ? {
          ...params,
          workbenchCatalog: await loadPolicyWorkbenchCatalog(viewer.domainId, credentials.locale),
        } : selection.typeId === PERMISSION_POLICY && selection.method === "form" ? {
          ...params,
          workbenchCatalog: await cache.read("permission-policy-form-workbench-catalog",
            () => loadPolicyWorkbenchCatalog(viewer.domainId, credentials.locale)),
        } : params;
      const governanceRows = prepareGovernanceListRows(selection, prepared.declaration, placement.projection);
      const deleteBindings = selection.typeId === ATTRIBUTE && selection.method === "list"
        ? attributeDeleteRowBindings(placement.projection) : {};
      const attributeDelete = Object.keys(deleteBindings).length > 0;
      const read: JavaPanelRead = {
        ...path(),
        ...(visibleKinds && { visibleKinds }),
        ...(ownerRead ? (ownerRead.call && { call: ownerRead.call }) : !ownerFacts && (!local || local.readJavaFacts) && {
          call: objectTypeFacts ?? {
            type: selection.typeId, name: functionQuery ? "list" : actionDetails ? "record" : selection.method,
            parameters: runtimeJsonObjectSchema.parse({
              ...(!mcpConfigurationRead && !dslForm && ownerParams),
              ...(selection.primaryKey !== undefined && { primaryKey: selection.primaryKey }),
              ...governanceRows?.parameters,
              ...(attributeDelete && { includeDeleteFacts: true }),
              ...(selection.typeId === USER && selection.method === "query" && memberQueryOperationParams(placement.projection, inputs)),
            }),
          },
        }),
      };
      return { ok: true as const, kind: "data" as const, read, prepared, placement, local, ownerRead, customerRead, ownerFacts,
        attributeDelete: attributeDelete ? deleteBindings : undefined, governanceRows, skillLibraryRead };
    } catch (error) {
      // A path error must not disclose a definition that the reader cannot use.
      const result = error instanceof ZodError || error instanceof URIError
        ? { status: "error" as const, message: error.message, code: "PANEL_READ_INPUT_INVALID" }
        : refusal(error);
      return { ok: false as const, result, read: path() };
    }
  }));
  return { viewer, plans, cache };
}

type PreparedRead = Extract<Awaited<ReturnType<typeof prepareRegisteredDataReads>>["plans"][number], { prepared: unknown }>;
type PresentOwnerResult = (
  plan: PreparedRead, result: Extract<JavaPanelReadResult, { status: "ready" }>, credentials: AssistantCredentials, domainId: string,
) => Promise<ProductPanelReadResponse>;

function presentReadOutcome(declaration: PlatformReadDeclaration, payload: unknown, render?: (value: unknown) => unknown) {
  const { declaration: _declaration, ...answer } = projectionDataReadOutcome(declaration, payload, render);
  return answer;
}

type OwnerReadParams = Parameters<ReturnType<typeof createMetricPanelReadPresenter>["query"]>[1] & {
  primaryKey: string;
  values?: PanelFormValues;
};
type OwnerReadPresenter = (payload: unknown, params: OwnerReadParams) => unknown;
const ownerPresenterFactories = new Map<string, (locale?: string) => Record<string, OwnerReadPresenter>>([
  [ACTION, createActionPanelReadPresenter],
  [APPLICATION, createApplicationPanelReadPresenter],
  [AUDIT_LOG, createAuditLogPanelReadPresenter],
  [BUSINESS_KNOWLEDGE, createBusinessKnowledgePanelReadPresenter],
  [DATA_ADAPTER_CONFIG, createDataAdapterConfigPanelReadPresenter],
  [FUNCTION, createFunctionPanelReadPresenter],
  [GENERAL_SETTINGS, createGeneralSettingsPanelReadPresenter],
  [METRIC_VIEW, createMetricPanelReadPresenter],
  [MODEL_OPTION, createModelOptionPanelReadPresenter],
  [WORKFLOW, createWorkflowPanelReadPresenter],
]);

const presentRegisteredOwnerResult: PresentOwnerResult = async ({ prepared, placement, governanceRows }, { payload }, credentials, domainId) => {
  const { selection: { typeId, method, primaryKey }, declaration, inputs, params } = prepared;
  const { locale } = credentials;
  if (governanceRows) {
    const { value, rowRefusals } = governanceRows.unpack(payload);
    const answer = presentReadOutcome(declaration, value);
    if (answer.status !== "ready") return answer;
    const rowOperations = await governanceRows.present(answer.value, inputs, rowRefusals);
    return { ...answer, ...(rowOperations && { rowOperations }) };
  }
  if (typeId === USER && method === "query") {
    const { query, rowRefusals } = memberQueryPayloadSchema.parse(payload);
    const answer = presentReadOutcome(declaration, query);
    if (answer.status !== "ready") return answer;
    const { rows } = answer.value as PanelRecordQuery;
    const rowOperations = await presentMemberQueryRowOperations(
      placement.projection, inputs, rows, declaration.rowType ?? typeId, rowRefusals,
    );
    return { ...answer, ...(rowOperations && { rowOperations }) };
  }
  if (typeId === OBJECT_TYPE || typeId === ATTRIBUTE || typeId === RELATIONSHIP) {
    return presentReadOutcome(declaration, payload, raw => {
      const value = renderModelRead(typeId, method, raw, params, locale);
      return method === "record" && typeId !== ATTRIBUTE
        ? withModelingPath(value as PanelRecord, typeId === OBJECT_TYPE ? "object" : "relation", primaryKey!)
        : value;
    });
  }
  if (typeId === PERMISSION_POLICY && method === "form") {
    const answer = presentReadOutcome(declaration, payload);
    if (answer.status !== "ready") return answer;
    const value = await withPolicyFormEntryUsage(answer.value as PanelFormDescription, credentials, domainId, primaryKey!);
    return { ...answer, value };
  }
  const presenters = ownerPresenterFactories.get(typeId)?.(locale);
  if (presenters && Object.hasOwn(presenters, method)) {
    const render = presenters[method];
    return presentReadOutcome(declaration, payload, raw => render(raw, { ...params, primaryKey: primaryKey! }));
  }
  return presentReadOutcome(declaration, payload);
};

/** Resolve all items from the second Java response without starting a new downstream read for a refused item. */
export async function runPreparedDataReads(
  credentials: AssistantCredentials, prepared: Awaited<ReturnType<typeof prepareRegisteredDataReads>>,
  present = presentRegisteredOwnerResult,
): Promise<ProductPanelReadResponse[]> {
  const { viewer, plans, cache } = prepared;
  const reads = plans.flatMap<JavaPanelRead>(plan => {
    if (plan.kind === "operations") return plan.reads;
    if (!plan.read) return [];
    if (plan.kind !== "data") return [plan.read];
    return [plan.read, ...(plan.ownerFacts?.facts ?? [])];
  });
  const uniqueReads: JavaPanelRead[] = [];
  const sharedFacts = new Map<string, number>();
  const indexes = reads.map(read => {
    const call = read.call;
    if (call?.type !== OBJECT_TYPE || (call.name !== "options" && call.name !== "detailPanel"))
      return uniqueReads.push(read) - 1;
    // The fact is only shareable when its full entry and USE admission are the same.
    const key = stableJson(read);
    const previous = sharedFacts.get(key);
    if (previous !== undefined) return previous;
    const index = uniqueReads.push(read) - 1;
    sharedFacts.set(key, index);
    return index;
  });
  const batch = uniqueReads.length ? await readViaJava(viewer, uniqueReads, credentials) : undefined;
  const results = indexes.map(index => batch!.results[index]);
  let index = 0;
  return Promise.all(plans.map(async (plan): Promise<ProductPanelReadResponse> => {
    if (plan.kind === "operations") {
      const start = index;
      index += plan.reads.length;
      try {
        return await plan.presentOperations(results.slice(start, index));
      } catch (error) {
        return refusal(error);
      }
    }
    if (!plan.ok && !plan.read) return plan.result;
    const result = results[index++];
    const facts = plan.kind === "data" && plan.ownerFacts
      ? results.slice(index, index + plan.ownerFacts.facts.length) : undefined;
    index += facts?.length ?? 0;
    if (result.status === "empty") return { status: "empty" };
    if (result.status === "forbidden") return { status: "forbidden", reason: result.error };
    if (result.status === "error") {
      if (plan.ok && plan.kind === "data" && plan.customerRead && result.code === "OBJECT_TYPE_NOT_FOUND")
        return { status: "error", message: result.error };
      const isMissingWorkflow = result.code === "WORKFLOW_NOT_FOUND"
        && plan.ok && plan.kind === "data" && plan.prepared.selection.typeId === WORKFLOW;
      const message = isMissingWorkflow ? workflowText(credentials.locale)("notFound") : result.error;
      return ownerError(message, result.code, plan.ok && plan.kind === "data" ? plan.prepared.selection : undefined);
    }
    if (!plan.ok) return plan.result;
    try {
      if (plan.ownerFacts)
        return presentReadOutcome(plan.prepared.declaration, await plan.ownerFacts.present(batch!.viewer, facts!));
      if (plan.ownerRead) {
        const answer = presentReadOutcome(plan.prepared.declaration, await plan.ownerRead.present(result.payload, result.visibility));
        const { typeId, method } = plan.prepared.selection;
        if (answer.status === "ready" && typeId === APPLICATION && method === "builderProjects") {
          const { projection } = plan.placement;
          const operations = Object.fromEntries(Object.entries(projection.operations ?? {}).filter(([, { operation, target }]) =>
            operation.kind === "PlatformOperation" && target && "row" in target
            && (operation.id === APPLICATION_DELETE_DRAFT || operation.id === "applications.delete")));
          const host = operationHost({ owner: viewer, credentials });
          const rowOperations = await presentRowOperationsForRows(
            { ...projection, operations }, plan.prepared.inputs, answer.value as PanelRecord[], APPLICATION,
            (handler, _binding, targets) => handler.effect === "write" ? handler.unavailableBatch!(host, targets) : new Map(),
          );
          return { ...answer, ...(rowOperations && { rowOperations }) };
        }
        if (answer.status === "ready" && plan.skillLibraryRead?.rowOperations) {
          const rowOperations = await plan.skillLibraryRead.rowOperations(result.payload, plan.prepared.inputs, (answer.value as PanelRecordQuery).rows);
          return { ...answer, ...(rowOperations && { rowOperations }) };
        }
        if (answer.status === "ready" && typeId === WORKFLOW && (method === "list" || method === "query")) {
          const rows = method === "list" ? answer.value as PanelRecord[] : (answer.value as PanelRecordQuery).rows;
          const rowOperations = await presentWorkflowLifecycleRows(plan.placement.projection, plan.prepared.inputs, rows, credentials.locale);
          return { ...answer, ...(rowOperations && { rowOperations }) };
        }
        return answer;
      }
      if (!plan.local) {
        const answer = await present(plan, result, credentials, viewer.domainId);
        if (answer.status === "ready" && plan.attributeDelete) {
          const rowOperations = await presentAttributeDeleteRows(
            { ...plan.placement.projection, operations: plan.attributeDelete }, result.payload,
            answer.value as PanelRecord[], credentials.locale,
          );
          return { ...answer, ...(rowOperations && { rowOperations }) };
        }
        return answer;
      }
      const { typeId, method, primaryKey } = plan.prepared.selection;
      const { params } = plan.prepared;
      const local = plan.local;
      const read = () => local.read(viewer, result.visibility, result.payload, credentials, primaryKey, params);
      const payload = typeId === OBJECT_TYPE
        ? await cache.read(stableJson([typeId, method, primaryKey ?? null, params, result]), read)
        : await read();
      const answer = presentReadOutcome(plan.prepared.declaration, payload);
      if (answer.status === "ready" && typeId === TURN_EVIDENCE && method === "list") {
        const rowOperations = await presentTurnEvidenceRetentionRows(
          plan.placement.projection, plan.prepared.inputs, answer.value as PanelRecord[], credentials.locale,
        );
        return { ...answer, ...(rowOperations && { rowOperations }) };
      }
      if (answer.status === "ready" && typeId === AUTOTEST_RUN && method === "list") {
        const rowOperations = await presentAutotestRunRowOperations(
          plan.placement.projection, plan.prepared.inputs, answer.value as PanelRecord[], credentials.locale,
        );
        return { ...answer, ...(rowOperations && { rowOperations }) };
      }
      return answer;
    } catch (error) {
      if (error instanceof ZodError)
        return { status: "error", message: error.message, code: "PANEL_READ_OWNER_RESPONSE_INVALID" };
      if (plan.local && error instanceof SyntaxError) return panelMemberReadRefusal(error)!;
      if (plan.customerRead && error instanceof HttpError) return panelMemberReadRefusal(error)!;
      if (error instanceof HttpError && (
        plan.local || plan.ownerRead || plan.ownerFacts || error.code === "PANEL_READ_OWNER_RESPONSE_INVALID" || error.code === "PANEL_OPERATION_READ_UNAVAILABLE"
        || error.code === "INVALID_CURSOR"
      )) return refusal(error, plan.prepared.selection);
      throw error;
    }
  }));
}
