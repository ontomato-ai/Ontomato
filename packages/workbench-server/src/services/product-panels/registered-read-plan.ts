import type { ProductPanelReadRequest, ProductPanelReadResponse, ProductPanelReadSource } from "@ontomato/contracts/panel-host";
import type { PanelRecord, PanelRecordQuery } from "@ontomato/contracts/panel-projection";
import type { PlatformReadDeclaration } from "@ontomato/contracts/platform-object-types";
import { ZodError } from "zod";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import { createLogger } from "../../logging/logger";
import { personalEntry, withPanelReadRegistration } from "./application-use";
import {
  effectiveInputs, panelMemberReadRefusal, panelReadUseCollector, prepareProjectionDataRead, projectionDataReadOutcome, resolveReadMember,
  rowFallbackClassName,
} from "./data-reads";
import { locateViaJava, readViaJava, type JavaDirectPanelRead, type JavaPanelLocateRef, type JavaPanelRead } from "./java-panel-reads";
import { PanelReadBatchCache } from "./member-path";
import { planRowOperations } from "./operation-availability";
import { boundProjectionOperations } from "./operation-bindings";
import {
  defaultRegisteredJavaCall, javaReadItem, readyPayload, RegisteredDataReadFailure, registeredDataReadKey,
  type PanelReadSelection, type RegisteredDataReadContext, type RegisteredDataReadPlan,
} from "./registered-data-read";
import { registeredDataReads } from "./registered-data-reads";
import { prepareRegisteredOperationRead } from "./registered-operation-reads";

type RegisteredSource = Extract<ProductPanelReadSource, { kind: "registered" | "frame" }>;
const logger = createLogger("registered-read-plan");
export type RegisteredDataRead = ProductPanelReadRequest & { source: RegisteredSource };
type RegisteredReadLocation = { protocol: string; headers: Record<string, unknown> };
type PanelReadPath = JavaPanelRead | JavaDirectPanelRead;

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

function preparationFailure(error: unknown, directResolution = false): ProductPanelReadResponse {
  if (error instanceof ZodError || error instanceof URIError)
    return { status: "error", message: error.message, code: "PANEL_READ_INPUT_INVALID" };
  if (error instanceof HttpError) return refusal(error);
  if (directResolution) {
    logger.error("Candidate panel batch item failed", error instanceof Error ? error : undefined);
    return { status: "error", message: "Service unavailable" };
  }
  return refusal(error);
}

function defaultDataReadPlan(context: RegisteredDataReadContext): RegisteredDataReadPlan {
  return {
    reads: [{ call: defaultRegisteredJavaCall(context) }],
    present: results => readyPayload(results[0]).payload,
  };
}

/** Build the execution plan only after the entry owner has authenticated this request and returned its facts. */
export async function prepareRegisteredDataReads(
  credentials: AssistantCredentials, reads: readonly ProductPanelReadRequest[],
  { location, owner }: { location?: RegisteredReadLocation; owner?: ProductOwner } = {},
) {
  const refs = [...new Map(reads.flatMap(request => {
    const { source } = request;
    if (source.kind !== "registered" && source.kind !== "frame") return [];
    const ref: JavaPanelLocateRef = { applicationId: source.applicationId, useId: source.useId, ...(source.kind === "frame" && { kind: source.kind }) };
    return [[entryKey(ref), ref] as const];
  })).values()];
  const located = refs.length ? await locateViaJava(refs, credentials) : undefined;
  const viewer = located?.viewer ?? owner!;
  const entries = located?.entries ?? [];
  const registrations = new Map(refs.map((ref, index) => [entryKey(ref), entries[index]]));
  const lookup = (source: JavaPanelLocateRef) => {
    const item = registrations.get(entryKey(source))!;
    if (item.kind === "error") throw new HttpError(item.status, item.error, item.code);
    return item;
  };
  const cache = new PanelReadBatchCache(viewer, credentials, async source => personalEntry(withPanelReadRegistration(lookup(source).entry), viewer));
  const plans = await Promise.all(reads.map(async request => {
    const { source } = request;
    const direct = source.kind === "candidate" || source.kind === "app-candidate";
    let panelRegistration: ReturnType<typeof withPanelReadRegistration>["registration"] | undefined;
    if (!direct) {
      let locatedEntry: ReturnType<typeof lookup>;
      try { locatedEntry = lookup(source); }
      catch (error) { return { ok: false as const, result: refusal(error) }; }
      panelRegistration = withPanelReadRegistration(locatedEntry.entry).registration;
    }
    const { uses, collect: collectUse } = panelReadUseCollector(viewer.domainId, true);
    const path = (): PanelReadPath => {
      if (source.kind === "candidate" || source.kind === "app-candidate") return { source: { kind: "direct" } };
      return { source, registration: panelRegistration!, uses: [...uses.values()] };
    };
    let resolved: Awaited<ReturnType<typeof resolveReadMember>>;
    try {
      resolved = await resolveReadMember(viewer, credentials, request, cache, collectUse);
    } catch (error) {
      return { ok: false as const, result: preparationFailure(error, direct), ...(direct ? {} : { read: path() }) };
    }
    try {
      const placement = { ...resolved, slot: request.memberPath.at(-1)!.member };
      if ("operations" in request) {
        const inputs = effectiveInputs(placement.projection, placement.member, resolved.inputs);
        const { reads, present } = await prepareRegisteredOperationRead(placement, inputs, viewer, credentials);
        const admittedPath = path();
        return {
          ok: true as const, kind: "operations" as const, presentOperations: present, readCount: reads.length,
          // Without facts to read, the placement is still admitted in the batch.
          reads: reads.length ? reads.map(item => ({ ...admittedPath, ...javaReadItem(item) })) : [admittedPath],
        };
      }
      const prepared = await prepareProjectionDataRead(credentials, placement, request.dataName, resolved.inputs,
        request.runtimeParams, "component" in resolved ? resolved.component : undefined);
      const { selection, params, inputs, declaration } = prepared;
      const registration = registrationFor(selection);
      const rows = declaration.result === "panelRecordList" || declaration.result === "panelRecordQuery"
        ? await planRowOperations(boundProjectionOperations(placement.projection), inputs,
          { owner: viewer, credentials, locale: credentials.locale }, registration?.carries ?? [])
        : undefined;
      const readContext: RegisteredDataReadContext = {
        owner: viewer, credentials, selection, params, inputs, rowOperations: rows?.carried ?? [],
        projection: placement.projection, cache, ...(location && { location }),
      };
      const dataPlan = registration ? await registration.plan(readContext) : defaultDataReadPlan(readContext);
      const admittedPath = path();
      const readItems = [...dataPlan.reads, ...rows?.reads ?? []].map(item => ({ ...admittedPath, ...javaReadItem(item) }));
      return {
        ok: true as const, kind: "data" as const, reads: readItems, dataPlan, prepared, readContext,
        rows: rows && { ...rows, rowType: rowFallbackClassName(placement.projection, request.dataName, declaration) },
      };
    } catch (error) {
      // A path error must not disclose a definition that the reader cannot use.
      return { ok: false as const, result: preparationFailure(error), ...(direct ? {} : { read: path() }) };
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
  const reads = plans.flatMap<PanelReadPath>(plan => {
    if (!plan.ok) return plan.read ? [plan.read] : [];
    return plan.reads;
  });
  const batch = reads.length ? await readViaJava(viewer, reads, credentials) : undefined;
  const results = batch?.results ?? [];
  let index = 0;
  return Promise.all(plans.map(async (plan): Promise<ProductPanelReadResponse> => {
    if (!plan.ok) {
      if (plan.read) {
        index += 1;
        try {
          readyPayload(results[index - 1]!);
        } catch (error) {
          if (error instanceof RegisteredDataReadFailure) return error.response;
          throw error;
        }
      }
      return plan.result;
    }
    const readResults = results.slice(index, index += plan.reads.length);
    try {
      if (plan.kind === "operations") {
        if (!plan.readCount) readyPayload(readResults[0]!);
        return await plan.presentOperations(readResults.slice(0, plan.readCount));
      }
      const dataResults = readResults.slice(0, plan.dataPlan.reads.length);
      const payload = await plan.dataPlan.present(dataResults, { ...plan.readContext, ...(batch && { javaViewer: batch.viewer }) });
      const { declaration } = plan.prepared;
      const answer = await presentReadOutcome(declaration, payload);
      if (answer.status !== "ready" || !plan.rows) return answer;
      const rows = declaration.result === "panelRecordList" ? answer.value as PanelRecord[] : (answer.value as PanelRecordQuery).rows;
      const rowOperations = await plan.rows.present(readResults.slice(plan.dataPlan.reads.length), rows, plan.rows.rowType,
        plan.dataPlan.rowFacts?.(dataResults));
      return { ...answer, ...(rowOperations && { rowOperations }) };
    } catch (error) {
      return presentationFailure(error);
    }
  }));
}

/** Read one owner selection through its registration plan, directly or with an already admitted registered path. */
export async function readPanelOwnerData(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  selection: PanelReadSelection,
  params: Record<string, unknown>,
  projection: RegisteredDataReadContext["projection"],
  path?: PanelReadPath,
): Promise<unknown> {
  const cache = new PanelReadBatchCache(owner, credentials);
  const context: RegisteredDataReadContext = {
    owner, credentials, selection, params, inputs: {}, rowOperations: [], projection, cache,
  };
  const registration = registrationFor(selection);
  const plan = registration ? await registration.plan(context) : defaultDataReadPlan(context);
  const admittedPath = path ?? { source: { kind: "direct" as const } };
  const reads = plan.reads.map(item => ({ ...admittedPath, ...javaReadItem(item) }));
  const batch = await readViaJava(owner, reads, credentials);
  return plan.present(batch.results, { ...context, javaViewer: batch.viewer });
}
/** Read one or more panel members through the same admitted owner batch. */
export async function readPanelDataBatch(
  owner: ProductOwner, credentials: AssistantCredentials, reads: readonly ProductPanelReadRequest[],
  location?: RegisteredReadLocation,
): Promise<ProductPanelReadResponse[]> {
  const prepared = await prepareRegisteredDataReads(credentials, reads, { owner, ...(location && { location }) });
  return runPreparedDataReads(credentials, prepared);
}

export async function readPanelData(
  owner: ProductOwner, credentials: AssistantCredentials, request: ProductPanelReadRequest, location?: RegisteredReadLocation,
): Promise<ProductPanelReadResponse> {
  const [response] = await readPanelDataBatch(owner, credentials, [request], location);
  return response!;
}
