import { isDomainComponentId } from "@ontomato/contracts/product-record-id";
import { appsSdkComponentDatum } from "@ontomato/contracts/apps-sdk";
import { z } from "zod";
import { AGENT_EXECUTION_HEADER } from "@ontomato/contracts/agent-runtime-business-callbacks";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import { matchesDirectPanelValue, panelObjectRefSchema } from "@ontomato/contracts/panel-manifest";
import { panelReadResultSchemas } from "@ontomato/contracts/panel-operations";
import { authoredReadParameterSource, directReadDeclaration, panelReadParameterId, panelReadParameterSchemas, readParameterUsesStateField, type DirectProjectionData } from "@ontomato/contracts/panel-projection";
import { DASHBOARD_CARD, type PlatformReadDeclaration } from "@ontomato/contracts/platform-object-types";
import type { ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { tApp } from "../../i18n";
import { createLogger } from "../../logging/logger";
import { isQueryRuntimeGrant } from "../../utils/assistant-credentials";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendUnavailableError } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";
import type { ObjectDefinition } from "../product-governance/authorization";
import { isProductAssetGraphRead, prepareProductAssetGraphRead } from "./asset-graph-read";
import { preparePanelMetricQuery } from "../dashboard/panel-chart-read-plan";
import type { McpRequestLocation } from "../mcp/catalog";
import { readProjectionComponent } from "./component-catalogue";
import { resolvePinnedInputs } from "./input-wiring";
import type { ScopedActionDescriptions } from "./direct-operations";
import { PanelReadBatchCache, registeredPanelRootId, requireRegisteredPanelRoot, resolvePanelMemberPath, type PanelUseCollector } from "./member-path";
import { unwrapReadDirective } from "./read-directive";
import type { PanelOperationActor } from "./server-operations";
import { readSelectedPanelOwner, type PanelReadSelection } from "./panel-owner-reads";
import { currentDefinition } from "./access";
import { prepareCustomerDataRead } from "./customer-data-read-plan";
import { isFavoriteObjectRead, prepareScopedFavoriteObjectRead } from "./favorite-panel";
import { readViaJava, stableJson, type JavaPanelRead } from "./java-panel-reads";

const logger = createLogger("panel-data-reads");

type ReadInputs = ProductPanelReadRequest["inputs"];
type ReadMember = ProductPanel["manifest"]["members"][string];

export function panelReadUseCollector(domainId: string, defer?: true) {
  const uses = new Map<string, ObjectDefinition>();
  const collect: PanelUseCollector = (kind, row) => {
    // Only records from the owner's builtin tables have a null domain for panels and projections.
    if (kind === "component" || row.domainId !== null) {
      const definition = currentDefinition(kind, row, domainId);
      uses.set(JSON.stringify(definition.target), definition);
    }
    return defer;
  };
  return { uses, collect };
}

export async function resolveReadMember(
  owner: ProductOwner, viewer: AssistantCredentials, request: ProductPanelReadRequest, batchCache?: PanelReadBatchCache,
  collectUse?: PanelUseCollector,
) {
  const { source, memberPath } = request;
  if (source.kind === "candidate") {
    const { resolvePanelCandidateMember } = await import("../workspaces/panel-candidate");
    const { panel, member, projection } = await resolvePanelCandidateMember(owner, viewer, source.workspace, memberPath);
    return { member, projection, panel, inputs: request.inputs, viewer, javaPath: undefined };
  }
  if (source.kind === "app-candidate") {
    const { resolveApplicationPreviewMember } = await import("../app-builder/preview-service");
    const { panel, member, projection } = await resolveApplicationPreviewMember(
      owner, viewer, source.app.id, { ref: source.app.ref, entryId: source.app.entryId }, memberPath,
    );
    return { member, projection, panel, inputs: request.inputs, viewer, javaPath: undefined };
  }

  const { uses, collect } = panelReadUseCollector(owner.domainId);
  const useCollector = collectUse ?? collect;
  const { panel, entry, registration } = await requireRegisteredPanelRoot(owner, viewer, source, { batchCache, collectUse: useCollector });
  const placement = await resolvePanelMemberPath(owner, viewer, panel, memberPath, entry, undefined, batchCache, undefined, useCollector);
  if (placement.kind !== "projection")
    throw new HttpError(403, "The member path does not select a projection", "PANEL_MEMBER_FORBIDDEN");
  const inputs = { ...request.inputs };
  const pinned = resolvePinnedInputs(entry, placement.trail, placement.member, source.kind === "frame");
  for (const [name, value] of pinned) {
    if (value === undefined) delete inputs[name];
    else inputs[name] = value as ReadInputs[string];
  }
  const javaPath = { source, registration, uses: [...uses.values()] } satisfies JavaPanelRead;
  return { ...placement, inputs, viewer, javaPath };
}

export function effectiveInputs(
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
  viewer: AssistantCredentials, resolvedComponent?: Awaited<ReturnType<typeof readProjectionComponent>>,
) {
  const resolved = new Map<string, unknown>();
  const runtime = Object.entries(runtimeParams ?? {});
  if (runtime.length || isDomainComponentId(projection.componentId)) {
    const component = resolvedComponent ?? await readProjectionComponent(projection.componentId, undefined, { domainId: projection.domainId, credentials: viewer });
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

function readSelection({ source, read }: DirectProjectionData, inputs: ReadInputs): PanelReadSelection {
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

type ReadPlacement = { member: ReadMember; projection: ProductProjection; slot: string };

export async function prepareProjectionDataRead(
  viewer: AssistantCredentials,
  { member, projection, slot }: ReadPlacement,
  dataName: string,
  submittedInputs: ReadInputs,
  runtimeParams?: ProductPanelReadRequest["runtimeParams"],
  resolvedComponent?: Awaited<ReturnType<typeof readProjectionComponent>>,
) {
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
  const params = await readParameters(projection, member, dataName, data, declaration, inputs, runtimeParams, viewer, resolvedComponent);
  if (declaration.parameterMode === "fixed") {
    for (const name of declaration.requiredParams ?? [])
      if (!Object.hasOwn(params, name)) throw new HttpError(400, `Missing read parameter: ${name}`, "PANEL_INPUT_REQUIRED");
  }
  return { declaration, inputs, params, selection: readSelection(data, inputs) };
}

async function executeProjectionDataRead(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  placement: ReadPlacement,
  dataName: string,
  submittedInputs: ReadInputs,
  runtimeParams?: ProductPanelReadRequest["runtimeParams"],
  callerUserName?: string,
  location?: McpRequestLocation,
  batchCache?: PanelReadBatchCache,
  readScopeKey?: string,
  javaPath?: JavaPanelRead,
): Promise<{ outcome: ProjectionDataReadOutcome; inputs: ReadInputs }> {
  const { projection } = placement;
  const { declaration, params, selection, inputs } = await prepareProjectionDataRead(viewer, placement, dataName, submittedInputs, runtimeParams);
  const invoke = () => readResolvedPanelOwner({ owner, viewer, callerUserName, location, batchCache }, selection, params, projection, javaPath);
  // These Java reads include admission of this placement.
  const needsOwnerAdmission = isProductAssetGraphRead(selection) || selection.kind === "customer" && selection.method === "neighbors";
  const result = await (batchCache && readScopeKey !== undefined && !needsOwnerAdmission
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
  return { outcome: await projectionDataReadOutcome(declaration, result), inputs };
}

export async function readResolvedPanelOwner(
  reader: Parameters<typeof readSelectedPanelOwner>[0], selection: PanelReadSelection, params: Record<string, unknown>,
  projection: ProductProjection, path?: JavaPanelRead, retrievalScopeId?: string,
) {
  const { owner, viewer } = reader;
  const isRelationship = selection.kind === "customer" && selection.method === "neighbors";
  const isGraph = isProductAssetGraphRead(selection);
  if (!isGraph && !isRelationship && retrievalScopeId === undefined)
    return readSelectedPanelOwner(reader, selection, params, projection);

  const modelRead = !isGraph && retrievalScopeId !== undefined
    ? (await import("./scoped-model-reads")).prepareScopedModelRead(selection, params, projection, viewer.locale)
    : undefined;
  const ownerRead = isGraph ? undefined : modelRead ?? prepareCustomerDataRead(selection, params, viewer.locale);
  const scopedFavorites = retrievalScopeId !== undefined && isFavoriteObjectRead(selection, params);
  const metric = !isGraph && !ownerRead && !scopedFavorites
    ? await preparePanelMetricQuery(owner, projection, { selection, params }, viewer.locale) : undefined;
  if (!isGraph && !ownerRead && !scopedFavorites && !metric) return readSelectedPanelOwner(reader, selection, params, projection);
  const headers = new Headers(viewer.headers);
  const readLabel = isGraph ? "The product graph read" : metric ? "The metric read"
    : modelRead ? "The model read" : "The customer read";
  // Only the callback's stored caller reference may carry scope to the owner.
  if (isQueryRuntimeGrant(viewer.token) || (retrievalScopeId === undefined
      && (headers.has(AGENT_EXECUTION_HEADER) || headers.has("X-Ontomato-Retrieval-Caller-Id"))))
    throw new HttpError(403, readLabel + " requires the caller's execution scope");
  if (!path) throw new HttpError(422, readLabel + " requires a registered panel placement");
  const { call, present } = ownerRead ?? metric ?? (isGraph
    ? await prepareProductAssetGraphRead(owner, viewer.locale) : await prepareScopedFavoriteObjectRead(owner, viewer.locale));
  const { results: [result] } = await readViaJava(owner, [{ ...path, call }], viewer, retrievalScopeId);
  if (result.status === "empty") return null;
  if (result.status === "forbidden") throw new HttpError(403, result.error);
  if (result.status === "error")
    throw new HttpError(metric && result.code === "UNAUTHENTICATED" ? 401 : 422,
      result.error, metric ? result.code ?? undefined : undefined);
  return present(result.payload);
}

export async function projectionDataReadOutcome(
  declaration: PlatformReadDeclaration, result: unknown, render: (value: unknown) => unknown | Promise<unknown> = value => value,
): Promise<ProjectionDataReadOutcome> {
  const { value, directive } = unwrapReadDirective(result);
  const payload = await render(value);
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

type PanelReadPlacement = ReadPlacement & { panel: Pick<ProductPanel, "manifest"> & { id?: string } };

export async function readPanelMemberOperationDescriptions(
  actor: PanelOperationActor, placement: PanelReadPlacement, submittedInputs: ReadInputs, actionScope?: ScopedActionDescriptions,
): Promise<ProductPanelReadResponse> {
  const inputs = effectiveInputs(placement.projection, placement.member, submittedInputs);
  const { readAdmittedProjectionOperations } = await import("./direct-operations");
  const headers = new Headers(actor.credentials.headers);
  const scoped = headers.has(AGENT_EXECUTION_HEADER) || isQueryRuntimeGrant(actor.credentials.token)
    ? undefined : actionScope;
  const value = await readAdmittedProjectionOperations(actor, placement, inputs, scoped);
  return { status: "ready", value: runtimeJsonObjectSchema.parse(value) };
}

export async function presentPanelMemberRead(
  actor: PanelOperationActor, placement: PanelReadPlacement, dataName: string, inputs: ReadInputs,
  outcome: ProjectionDataReadOutcome,
): Promise<ProductPanelReadResponse> {
  const { projection } = placement;
  if (outcome.status === "empty") return { status: "empty" };
  let rowOperations = outcome.rowOperations;
  if (
    projection.operations && Object.keys(projection.operations).length > 0
    && (outcome.declaration.result === "panelRecordList"
      || outcome.declaration.result === "panelRecordQuery")
  ) {
    const datum = projection.data[dataName];
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
      : (outcome.value as import("@ontomato/contracts/panel-projection").PanelRecordQuery).rows;
    const { describeRowOperationsForRows } = await import("./direct-operations");
    const described = new Set(Object.values(rowOperations ?? {}).flatMap(row => Object.keys(row)));
    const operations = Object.fromEntries(Object.entries(projection.operations).filter(([name]) => !described.has(name)));
    if (Object.keys(operations).length) {
      const additional = await describeRowOperationsForRows(actor, { ...placement, projection: { ...projection, operations } },
        inputs, rows, fallbackClassName);
      if (additional) {
        rowOperations = { ...rowOperations };
        for (const [key, operations] of Object.entries(additional)) {
          rowOperations[key] = { ...rowOperations[key], ...operations };
        }
      }
    }
  }
  const { rereadAfterMs } = outcome;
  return {
    status: "ready",
    value: outcome.value,
    ...(rereadAfterMs !== undefined && { rereadAfterMs }),
    ...(rowOperations && { rowOperations }),
  };
}

export function panelMemberReadRefusal(error: unknown): ProductPanelReadResponse | undefined {
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
}

export async function readScopedPanelData(
  owner: ProductOwner, viewer: AssistantCredentials, request: ProductPanelReadRequest, callerUserName?: string, location?: McpRequestLocation,
  batchCache?: PanelReadBatchCache,
): Promise<ProductPanelReadResponse> {
  try {
    const { member, projection, panel, inputs: submittedInputs, viewer: readViewer, javaPath } = await resolveReadMember(owner, viewer, request, batchCache);
    const placement = { panel, projection, member, slot: request.memberPath.at(-1)!.member };
    const actor = { owner, credentials: readViewer };
    if ("operations" in request)
      return await readPanelMemberOperationDescriptions(actor, placement, submittedInputs);
    const readScopeKey = request.source.kind === "candidate"
      ? JSON.stringify(["candidate", request.source.workspace.id, request.source.workspace.ref])
      : request.source.kind === "app-candidate"
        ? JSON.stringify(["app-candidate", request.source.app.id, request.source.app.ref, request.source.app.entryId ?? null])
        : "registered";
    const { outcome, inputs } = await executeProjectionDataRead(
      owner, readViewer, placement, request.dataName, submittedInputs, request.runtimeParams, callerUserName, location,
      batchCache, readScopeKey, javaPath,
    );
    return await presentPanelMemberRead(actor, placement, request.dataName, inputs, outcome);
  } catch (error) {
    const refusal = panelMemberReadRefusal(error);
    if (refusal) return refusal;
    if (batchCache) {
      logger.error("Panel batch item failed", error instanceof Error ? error : undefined);
      return { status: "error", message: "Service unavailable" };
    }
    throw error;
  }
}

export async function readScopedPanelDataBatch(
  owner: ProductOwner, credentials: AssistantCredentials, requests: readonly ProductPanelReadRequest[],
  { callerUserName, location }: { callerUserName?: string; location?: McpRequestLocation } = {},
): Promise<ProductPanelReadResponse[]> {
  const batchCache = new PanelReadBatchCache(owner, credentials);
  const registered = requests.flatMap(({ source, memberPath }) =>
    source.kind === "candidate" || source.kind === "app-candidate" ? [] : [{ source, memberPath }],
  );

  const entries = await Promise.allSettled(registered.map(async request =>
    registeredPanelRootId(request.source, await batchCache.entry(request.source))));
  await batchCache.prefetch(entries.flatMap(entry =>
    entry.status === "fulfilled" && entry.value !== undefined ? [{ kind: "panel", id: entry.value }] : []));

  const members = await Promise.allSettled(registered.map(async ({ source, memberPath }) => {
    const { panel } = await requireRegisteredPanelRoot(owner, credentials, source, { batchCache });
    const first = memberPath[0];
    if (first.selection || first.member.startsWith("$state.")) return;
    const target = panel.manifest.members[first.member]?.target;
    if (!target) return;
    if ("projectionId" in target) return { kind: "projection" as const, id: target.projectionId };
    if ("panelId" in target) return { kind: "panel" as const, id: target.panelId };
  }));
  await batchCache.prefetch(members.flatMap(member =>
    member.status === "fulfilled" && member.value ? [member.value] : []));

  return Promise.all(requests.map(request => readScopedPanelData(
    owner,
    credentials,
    request, callerUserName, location, batchCache,
  )));
}
