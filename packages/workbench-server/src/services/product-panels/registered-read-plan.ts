import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { ProductPanelReadRequest, ProductPanelReadResponse, ProductPanelReadSource } from "@ontomato/contracts/panel-host";
import type { PanelRecord, PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import {
  APPLICATION, APPLICATION_DELETE_DRAFT, ATTRIBUTE, AUTOTEST_RUN, TURN_EVIDENCE, USER, WORKFLOW,
  type PlatformReadDeclaration,
} from "@ontomato/contracts/platform-object-types";
import { ZodError } from "zod";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { HttpError } from "../../utils/errors";
import { presentAutotestRunRowOperations, presentTurnEvidenceRetentionRows } from "../ops-diagnosis/panel-operation-reads";
import { presentWorkflowLifecycleRows } from "../workflow/panel-operation-reads";
import { personalEntry, withPanelReadRegistration } from "./application-use";
import { presentRowOperationsForRows } from "./direct-operations";
import { effectiveInputs, panelMemberReadRefusal, panelReadUseCollector, prepareProjectionDataRead, projectionDataReadOutcome, resolveReadMember } from "./data-reads";
import { prepareGovernanceListRows } from "./governance-list-row-operations";
import { locateViaJava, readViaJava, type JavaPanelLocateRef, type JavaPanelRead } from "./java-panel-reads";
import { memberQueryOperationParams, memberQueryPayloadSchema, presentMemberQueryRowOperations } from "./member-query-presentation";
import { PanelReadBatchCache } from "./member-path";
import { operationHost } from "./operation-host";
import { attributeDeleteRowBindings, presentAttributeDeleteRows } from "./registered-attribute-reads";
import {
  defaultRegisteredJavaCall, readyPayload, RegisteredDataReadFailure, registeredDataReadKey,
  type RegisteredDataReadContext, type RegisteredDataReadPlan,
} from "./registered-data-read";
import { registeredDataReads } from "./registered-data-reads";
import { prepareRegisteredOperationRead } from "./registered-operation-reads";

type RegisteredSource = Extract<ProductPanelReadSource, { kind: "registered" | "frame" }>;
export type RegisteredDataRead = ProductPanelReadRequest & { source: RegisteredSource };
type RegisteredReadLocation = { protocol: string; headers: Record<string, unknown> };

function entryKey({ applicationId, useId, kind }: JavaPanelLocateRef) {
  return JSON.stringify([applicationId, useId, kind ?? "registered"]);
}

const registeredByTypeAndMethod = new Map(registeredDataReads.flatMap(registration =>
  registration.typeId && registration.method ? [[registeredDataReadKey(registration.typeId, registration.method), registration] as const] : []));
const customerRegistration = registeredDataReads.find(registration => registration.kind === "customer");

function registrationFor(selection: { kind: string; typeId: string; method: string }) {
  return selection.kind === "customer"
    ? customerRegistration
    : registeredByTypeAndMethod.get(registeredDataReadKey(selection.typeId, selection.method));
}

function refusal(error: unknown): ProductPanelReadResponse {
  if (!(error instanceof HttpError)) throw error;
  if (error.code === "PANEL_DATA_NAME_UNKNOWN") return panelMemberReadRefusal(error)!;
  return error.status === 403
    ? { status: "forbidden", reason: error.message }
    : { status: "error", message: error.message, ...(error.code && { code: error.code }) };
}

function javaCall(call: { type: string; name: string; parameters: Record<string, unknown> }): NonNullable<JavaPanelRead["call"]> {
  return { ...call, parameters: runtimeJsonObjectSchema.parse(call.parameters) };
}

function defaultDataReadPlan(context: RegisteredDataReadContext): RegisteredDataReadPlan {
  return {
    reads: [{ call: defaultRegisteredJavaCall(context) }],
    present: results => readyPayload(results[0]).payload,
  };
}

/** Build the execution plan only after the entry owner has authenticated this request and returned its facts. */
export async function prepareRegisteredDataReads(
  credentials: AssistantCredentials, reads: readonly RegisteredDataRead[], { location }: { location?: RegisteredReadLocation } = {},
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
    const { registration: panelRegistration } = withPanelReadRegistration(entry);
    const { uses, collect: collectUse } = panelReadUseCollector(viewer.domainId, true);
    const path = () => ({ source, registration: panelRegistration, uses: [...uses.values()] });
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
      const registration = registrationFor(selection);
      const readContext: RegisteredDataReadContext = {
        owner: viewer, credentials, selection, params, inputs,
        projection: placement.projection, cache, ...(location && { location }),
      };
      const governanceRows = prepareGovernanceListRows(selection, prepared.declaration, placement.projection);
      const deleteBindings = selection.typeId === ATTRIBUTE && selection.method === "list"
        ? attributeDeleteRowBindings(placement.projection) : {};
      const attributeDelete = Object.keys(deleteBindings).length > 0;
      const dataPlan = registration ? await registration.plan(readContext) : defaultDataReadPlan(readContext);
      const admittedPath = path();
      const rowOperationParameters = {
        ...governanceRows?.parameters,
        ...(attributeDelete && { includeDeleteFacts: true }),
        ...(selection.typeId === USER && selection.method === "query" && memberQueryOperationParams(placement.projection, inputs)),
      };
      const reads = dataPlan.reads.map((item, itemIndex) => ({
        ...admittedPath,
        ...(item.visibleKinds && { visibleKinds: item.visibleKinds }),
        ...(item.call && {
          call: javaCall(itemIndex === 0 && Object.keys(rowOperationParameters).length > 0
            ? { ...item.call, parameters: { ...item.call.parameters, ...rowOperationParameters } }
            : item.call),
        }),
      }));
      return { ok: true as const, kind: "data" as const, reads, dataPlan, prepared, placement,
        readContext, attributeDelete: attributeDelete ? deleteBindings : undefined, governanceRows };
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

async function presentReadOutcome(declaration: PlatformReadDeclaration, payload: unknown) {
  const { declaration: _declaration, ...answer } = await projectionDataReadOutcome(declaration, payload);
  return answer;
}

function presentationFailure(error: unknown): ProductPanelReadResponse {
  if (error instanceof RegisteredDataReadFailure) return error.response;
  if (error instanceof ZodError)
    return { status: "error", message: error.message, code: "PANEL_READ_OWNER_RESPONSE_INVALID" };
  if (error instanceof SyntaxError) return panelMemberReadRefusal(error)!;
  if (error instanceof HttpError) return refusal(error);
  throw error;
}

/** Resolve all items from the second Java response without starting a new downstream read for a refused item. */
export async function runPreparedDataReads(
  credentials: AssistantCredentials, prepared: Awaited<ReturnType<typeof prepareRegisteredDataReads>>,
): Promise<ProductPanelReadResponse[]> {
  const { viewer, plans } = prepared;
  const reads = plans.flatMap<JavaPanelRead>(plan => {
    if (plan.kind === "operations") return plan.reads;
    if (!plan.ok) return plan.read ? [plan.read] : [];
    return plan.reads;
  });
  const batch = reads.length ? await readViaJava(viewer, reads, credentials) : undefined;
  const results = batch?.results ?? [];
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
    if (!plan.ok) {
      if (plan.read) {
        index += 1;
        try {
          readyPayload(results[index - 1]);
        } catch (error) {
          if (error instanceof RegisteredDataReadFailure) return error.response;
          throw error;
        }
      }
      return plan.result;
    }
    const readResults = results.slice(index, index + plan.reads.length);
    index += plan.reads.length;
    try {
      const payload = await plan.dataPlan.present(readResults, { ...plan.readContext, ...(batch && { javaViewer: batch.viewer }) });
      const { selection: { typeId, method }, declaration, inputs } = plan.prepared;
      let answer: ProductPanelReadResponse;
      if (plan.governanceRows) {
        const { value, rowRefusals } = plan.governanceRows.unpack(payload);
        answer = await presentReadOutcome(declaration, value);
        if (answer.status === "ready") {
          const rowOperations = await plan.governanceRows.present(answer.value, inputs, rowRefusals);
          answer = { ...answer, ...(rowOperations && { rowOperations }) };
        }
      } else if (typeId === USER && method === "query") {
        const { query, rowRefusals } = memberQueryPayloadSchema.parse(payload);
        answer = await presentReadOutcome(declaration, query);
        if (answer.status === "ready") {
          const { rows } = answer.value as PanelRecordQuery;
          const rowOperations = await presentMemberQueryRowOperations(
            plan.placement.projection, inputs, rows, declaration.rowType ?? typeId, rowRefusals,
          );
          answer = { ...answer, ...(rowOperations && { rowOperations }) };
        }
      } else {
        answer = await presentReadOutcome(declaration, payload);
      }
      if (answer.status === "ready" && typeId === APPLICATION && method === "builderProjects") {
        const { projection } = plan.placement;
        const operations = Object.fromEntries(Object.entries(projection.operations ?? {}).filter(([, { operation, target }]) =>
          operation.kind === "PlatformOperation" && target && "row" in target
          && (operation.id === APPLICATION_DELETE_DRAFT || operation.id === "applications.delete")));
        const host = operationHost({ owner: viewer, credentials });
        const rowOperations = await presentRowOperationsForRows(
          { ...projection, operations }, inputs, answer.value as PanelRecord[], APPLICATION,
          (handler, _binding, targets) => handler.effect === "write" ? handler.unavailableBatch!(host, targets) : new Map(),
        );
        return { ...answer, ...(rowOperations && { rowOperations }) };
      }
      if (answer.status === "ready" && plan.dataPlan.rowOperations) {
        const firstPayload = readResults[0]?.status === "ready" ? readResults[0].payload : undefined;
        const rowOperations = await plan.dataPlan.rowOperations(firstPayload, inputs, (answer.value as PanelRecordQuery).rows);
        return { ...answer, ...(rowOperations && { rowOperations }) };
      }
      if (answer.status === "ready" && typeId === WORKFLOW && (method === "list" || method === "query")) {
        const rows = method === "list" ? answer.value as PanelRecord[] : (answer.value as PanelRecordQuery).rows;
        const rowOperations = await presentWorkflowLifecycleRows(plan.placement.projection, inputs, rows, credentials.locale);
        return { ...answer, ...(rowOperations && { rowOperations }) };
      }
      if (answer.status === "ready" && plan.attributeDelete) {
        const rowOperations = await presentAttributeDeleteRows(
          { ...plan.placement.projection, operations: plan.attributeDelete },
          readResults[0]?.status === "ready" ? readResults[0].payload : undefined,
          answer.value as PanelRecord[], credentials.locale,
        );
        return { ...answer, ...(rowOperations && { rowOperations }) };
      }
      if (answer.status === "ready" && typeId === TURN_EVIDENCE && method === "list") {
        const rowOperations = await presentTurnEvidenceRetentionRows(
          plan.placement.projection, inputs, answer.value as PanelRecord[], credentials.locale,
        );
        return { ...answer, ...(rowOperations && { rowOperations }) };
      }
      if (answer.status === "ready" && typeId === AUTOTEST_RUN && method === "list") {
        const rowOperations = await presentAutotestRunRowOperations(
          plan.placement.projection, inputs, answer.value as PanelRecord[], credentials.locale,
        );
        return { ...answer, ...(rowOperations && { rowOperations }) };
      }
      return answer;
    } catch (error) {
      return presentationFailure(error);
    }
  }));
}
