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
import { locateViaJava, readViaJava, stableJson, type JavaPanelLocateRef, type JavaPanelRead, type JavaPanelReadResult } from "./java-panel-reads";
import { memberQueryOperationParams, memberQueryPayloadSchema, presentMemberQueryRowOperations } from "./member-query-presentation";
import { PanelReadBatchCache } from "./member-path";
import { operationHost } from "./operation-host";
import { attributeDeleteRowBindings, presentAttributeDeleteRows } from "./registered-attribute-reads";
import { registeredDataReadKey, type RegisteredDataReadContext, type RegisteredDataReadRegistration } from "./registered-data-read";
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

function ownerError(message: string, code: string | null | undefined, registration?: RegisteredDataReadRegistration): ProductPanelReadResponse {
  const messageOnly = code && registration?.messageOnlyCodes?.includes(code);
  return { status: "error", message, ...(code && !messageOnly && { code }) };
}

function refusal(error: unknown, registration?: RegisteredDataReadRegistration): ProductPanelReadResponse {
  if (!(error instanceof HttpError)) throw error;
  if (error.code === "PANEL_DATA_NAME_UNKNOWN") return panelMemberReadRefusal(error)!;
  return error.status === 403
    ? { status: "forbidden", reason: error.message }
    : ownerError(error.message, error.code, registration);
}

function javaCall(call: { type: string; name: string; parameters: Record<string, unknown> }): NonNullable<JavaPanelRead["call"]> {
  return { ...call, parameters: runtimeJsonObjectSchema.parse(call.parameters) };
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
      await registration?.validate?.(readContext);
      const ownerRead = await registration?.prepare?.(readContext);
      const factPlan = await registration?.facts?.(readContext);
      const local = registration?.local;
      const ownerFacts = factPlan && {
        ...factPlan,
        facts: factPlan.facts.map(fact => ({ ...path(), ...fact })),
      };
      const visibleKinds = ownerRead && "visibility" in ownerRead ? ownerRead.visibility : local?.visibility;
      const governanceRows = prepareGovernanceListRows(selection, prepared.declaration, placement.projection);
      const deleteBindings = selection.typeId === ATTRIBUTE && selection.method === "list"
        ? attributeDeleteRowBindings(placement.projection) : {};
      const attributeDelete = Object.keys(deleteBindings).length > 0;
      const defaultCall = (): NonNullable<JavaPanelRead["call"]> => javaCall({
        type: selection.typeId,
        name: selection.method,
        parameters: {
          ...params,
          ...(selection.primaryKey !== undefined && { primaryKey: selection.primaryKey }),
          ...governanceRows?.parameters,
          ...(attributeDelete && { includeDeleteFacts: true }),
          ...(selection.typeId === USER && selection.method === "query" && memberQueryOperationParams(placement.projection, inputs)),
        },
      });
      const registeredCall = ownerRead?.call !== undefined ? javaCall(ownerRead.call) : undefined;
      const defaultRegisteredCall = async () => javaCall(registration?.javaCall ? await registration.javaCall(readContext) : defaultCall());
      const call = ownerRead ? registeredCall
        : !ownerFacts && (!local || local.readJavaFacts) ? await defaultRegisteredCall() : undefined;
      const read: JavaPanelRead = {
        ...path(),
        ...(visibleKinds && { visibleKinds }),
        ...(call && { call }),
      };
      return { ok: true as const, kind: "data" as const, read, prepared, placement, local, ownerRead, ownerFacts,
        registration, readContext, attributeDelete: attributeDelete ? deleteBindings : undefined, governanceRows };
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

async function presentReadOutcome(
  declaration: PlatformReadDeclaration, payload: unknown, render?: (value: unknown) => unknown | Promise<unknown>,
) {
  const { declaration: _declaration, ...answer } = await projectionDataReadOutcome(declaration, payload, render);
  return answer;
}

const presentRegisteredOwnerResult: PresentOwnerResult = async ({ prepared, placement, governanceRows, registration, readContext }, { payload }, _credentials) => {
  const { selection: { typeId, method }, declaration, inputs } = prepared;
  if (governanceRows) {
    const { value, rowRefusals } = governanceRows.unpack(payload);
    const answer = await presentReadOutcome(declaration, value);
    if (answer.status !== "ready") return answer;
    const rowOperations = await governanceRows.present(answer.value, inputs, rowRefusals);
    return { ...answer, ...(rowOperations && { rowOperations }) };
  }
  if (typeId === USER && method === "query") {
    const { query, rowRefusals } = memberQueryPayloadSchema.parse(payload);
    const answer = await presentReadOutcome(declaration, query);
    if (answer.status !== "ready") return answer;
    const { rows } = answer.value as PanelRecordQuery;
    const rowOperations = await presentMemberQueryRowOperations(
      placement.projection, inputs, rows, declaration.rowType ?? typeId, rowRefusals,
    );
    return { ...answer, ...(rowOperations && { rowOperations }) };
  }
  return presentReadOutcome(declaration, payload,
    registration?.present && (raw => registration.present!(raw, readContext)));
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
    if (!plan.ok && !plan.read) return plan.result;
    const result = results[index++];
    const facts = plan.kind === "data" && plan.ownerFacts
      ? results.slice(index, index + plan.ownerFacts.facts.length) : undefined;
    index += facts?.length ?? 0;
    if (result.status === "empty") return { status: "empty" };
    if (result.status === "forbidden") return { status: "forbidden", reason: result.error };
    if (result.status === "error") {
      const registration = plan.ok && plan.kind === "data" ? plan.registration : undefined;
      const context = plan.ok && plan.kind === "data" ? plan.readContext : undefined;
      const message = registration && context ? registration.errorMessage?.(result, context) : undefined;
      return ownerError(message ?? result.error, result.code, registration);
    }
    if (!plan.ok) return plan.result;
    try {
      if (plan.ownerFacts)
        return presentReadOutcome(plan.prepared.declaration, await plan.ownerFacts.present(batch!.viewer, facts!));
      if (plan.ownerRead) {
        const answer = await presentReadOutcome(plan.prepared.declaration, await plan.ownerRead.present(result.payload, result.visibility));
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
        if (answer.status === "ready" && plan.ownerRead.rowOperations) {
          const rowOperations = await plan.ownerRead.rowOperations(result.payload, plan.prepared.inputs, (answer.value as PanelRecordQuery).rows);
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
      const read = async () => local.read(viewer, result.visibility, result.payload, credentials, primaryKey, params);
      const payload = local.cache
        ? await cache.read(stableJson([typeId, method, primaryKey ?? null, params, result]), read)
        : await read();
      const answer = await presentReadOutcome(plan.prepared.declaration, payload);
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
      if (plan.registration?.memberReadRefusal && error instanceof HttpError) return panelMemberReadRefusal(error)!;
      if (error instanceof HttpError && (
        plan.local || plan.ownerRead || plan.ownerFacts || error.code === "PANEL_READ_OWNER_RESPONSE_INVALID" || error.code === "PANEL_OPERATION_READ_UNAVAILABLE"
        || error.code === "INVALID_CURSOR"
      )) return refusal(error, plan.registration);
      throw error;
    }
  }));
}
