import { z } from "zod";
import { ACTION } from "@ontomato/contracts/platform-object-types";
import type { PanelRowOperationsMap } from "@ontomato/contracts/panel-host";
import { panelWriteOperationSnapshotSchema } from "@ontomato/contracts/panel-agent";
import {
  matchesObjectType, panelObjectRefSchema, panelOperationId, panelOperationUnavailableSchema,
  panelPortAccepts, panelStateInputType, type PanelMember, type PanelMemberPath,
} from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import {
  declaredCustomerFormSaveName, formatOperationTargetTypes, operationAcceptsTargetType, panelRecordObjectRef,
  panelRowOperationKey, projectionOperationTargetMatches, type PanelRecord, type ProjectionOperationBinding,
} from "@ontomato/contracts/panel-projection";
import type { ApplicationPanelUse, ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import {
  describeObjectAction, objectActionDeclaration, objectActionOperation, resolveObjectAction,
  storedObjectActionSchema, type ObjectActionSelection,
} from "../action/object-actions";
import type { ProductOwner } from "../product-governance/service-authentication";
import { requireDirectPanelMember } from "./current";
import { resolvePinnedInputs } from "./input-wiring";
import { readViaJava, type JavaPanelRead } from "./java-panel-reads";
import { resolvePanelMemberPath, type ResolvedPanelPathStep } from "./member-path";
import { allowsOperationDraft, boundProjectionOperations, isCreateFormRead, type BoundProjectionOperation } from "./operation-bindings";
import { operationHost } from "./operation-host";
import {
  describeServerOperation, type PanelOperationActor, type PanelOperationTarget, type PanelRecordTarget, type PanelServerOperation,
  type PanelWriteServerOperation,
} from "./server-operations";

export type PlacedOperationTarget = PanelOperationTarget | { kind: "list"; objects?: PanelRecordTarget[] } | null;
type Selection = (port?: string) => PanelOperationTarget | null | undefined;
interface Placement {
  panel: Pick<ProductPanel, "manifest"> & { id?: string };
  projection: ProductProjection;
  member: PanelMember;
  slot: string;
  nested?: { memberPath: PanelMemberPath; publisherPanelId: string };
}

export interface DeclaredDirectOperationOptions {
  mode?: "describe" | "prepare" | "dispatch" | "read";
  framePanelId?: string;
  isFrameRoot?: boolean;
}

function unavailable(id: string): never {
  throw new HttpError(422, `The panel member does not declare operation '${id}'`, "OPERATION_UNAVAILABLE");
}

function placedObject({ className, primaryKey }: ReturnType<typeof panelObjectRefSchema.parse>): PanelRecordTarget {
  return { kind: "object", objectType: className, primaryKey };
}

function requirePinnedObject(fixed: PlacedOperationTarget | undefined, supplied: PanelOperationTarget | null | undefined) {
  if (fixed?.kind === "object" && supplied?.kind === "object" &&
    (fixed.objectType !== supplied.objectType || fixed.primaryKey !== supplied.primaryKey))
    throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
}

export function resolvePinnedBoundParams(
  binding: ProjectionOperationBinding,
  pinnedInputs: ReadonlyMap<string, unknown>,
  target?: PanelOperationTarget | null,
  row?: PanelRecord,
): Record<string, unknown> {
  const boundParams: Record<string, unknown> = {};
  for (const [paramKey, paramBinding] of Object.entries(binding.params ?? {})) {
    if ("literal" in paramBinding) {
      boundParams[paramKey] = paramBinding.literal;
      continue;
    }
    if ("input" in paramBinding && pinnedInputs.has(paramBinding.input)) {
      boundParams[paramKey] = pinnedInputs.get(paramBinding.input);
      continue;
    }
    if (row && "row" in paramBinding) {
      boundParams[paramKey] = row[paramBinding.row];
      continue;
    }
    if (row && "rowField" in paramBinding) {
      boundParams[paramKey] = row.fields[paramBinding.rowField];
      continue;
    }
    if (
      "row" in paramBinding
      && paramBinding.row === "primaryKey"
      && binding.target
      && "row" in binding.target
      && target?.kind === "object"
    ) {
      boundParams[paramKey] = target.primaryKey;
    }
  }
  return boundParams;
}

function resolveTarget(
  placement: Placement,
  bound: BoundProjectionOperation,
  selection: Selection,
  pinnedInputs: ReadonlyMap<string, unknown>,
  locale?: string,
) {
  const { panel, projection, member, slot } = placement;
  const { binding, owner } = bound;
  const { operation, target } = binding;
  const problem = { operation: operation.id, member: slot };
  if (owner && !projectionOperationTargetMatches(projection, binding, owner.declaration, owner.targetType))
    throw new HttpError(422, `Operation '${bound.name}' has an incompatible target on member '${slot}'`, "PANEL_OPERATION_TARGET_MISMATCH");
  if (target && "literal" in target) {
    const fixed = placedObject(target.literal);
    requirePinnedObject(fixed, selection());
    return { descriptor: { source: "literal" as const, literal: target.literal }, fixed, selected: fixed };
  }
  if (!target) return { descriptor: { source: "none" as const }, fixed: undefined, selected: null };

  if ("row" in target || "rowField" in target) {
    const supplied = selection();
    if (owner && supplied?.kind === "object"
      && !operationAcceptsTargetType(supplied.objectType, owner.targetType, owner.declaration.targetTypes)) {
      throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
    }
    return { descriptor: { source: "row" as const }, fixed: undefined, selected: supplied };
  }

  const { input } = target;
  const wire = member.inputs?.[input];
  const port = projection.inputs[input];
  if (!wire) {
    throw new HttpError(
      422,
      tForLocale(locale, "panels.operation.targetInputUnbound", { ...problem, input }),
      "PANEL_OPERATION_TARGET_UNBOUND",
    );
  }
  const offered = "state" in wire ? panelStateInputType(wire, panel.manifest.state[wire.state].type) : undefined;
  if ((port?.kind !== "object" && port?.kind !== "object-union" && port?.kind !== "list") ||
    ("state" in wire && (offered === undefined || !panelPortAccepts(port, offered)))) {
    const expectedType = owner ? formatOperationTargetTypes(owner.targetType, owner.declaration.targetTypes) : undefined;
    const message = expectedType
      ? tForLocale(locale, "panels.operation.targetInputMismatch", { ...problem, input, objectType: expectedType })
      : `Operation '${bound.name}' has an incompatible object input '${input}' on member '${slot}'`;
    throw new HttpError(422, message, "PANEL_OPERATION_TARGET_MISMATCH");
  }
  const hasPinned = pinnedInputs.has(input);
  const pinnedValue = hasPinned ? pinnedInputs.get(input) : undefined;
  const fixed: PlacedOperationTarget | undefined = port.kind === "list"
    ? {
        kind: "list",
        objects: !hasPinned
          ? undefined
          : pinnedValue == null ? [] : panelObjectRefSchema.array().parse(pinnedValue).map(placedObject),
      }
    : !hasPinned
      ? undefined
      : pinnedValue == null ? null : placedObject(panelObjectRefSchema.parse(pinnedValue));
  const supplied = selection(input);
  requirePinnedObject(fixed, supplied);
  const selected = fixed === undefined ? supplied : fixed;
  if ((port.kind === "object" || port.kind === "object-union") && selected?.kind === "object") {
    const portMatches = (port.kind === "object" && port.objectType === "@any") || matchesObjectType(port, selected.objectType);
    const ownerMatches = !owner || operationAcceptsTargetType(selected.objectType, owner.targetType, owner.declaration.targetTypes);
    if (!portMatches || !ownerMatches)
      throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
  }
  return { descriptor: { source: "input" as const, input }, fixed, selected };
}

async function admitBoundOperation(
  actor: PanelOperationActor,
  placement: Placement,
  bound: BoundProjectionOperation,
  selection: Selection,
  pinnedInputs: ReadonlyMap<string, unknown> = new Map(),
) {
  const { projection } = placement;
  const { binding } = bound;
  if (binding.operation.kind === "Action") {
    const admitted = admitActionBinding(placement, bound, selection, pinnedInputs, actor.credentials.locale);
    if (!admitted) return undefined;
    const { target, selected, action } = admitted;
    const resolved = await resolveObjectAction(operationHost(actor), action);
    const handler: PanelWriteServerOperation = objectActionOperation(resolved);
    if (selected) {
      return {
        effect: "write" as const,
        handler,
        describe: () => ({ ...describeObjectAction(resolved), target }),
        action: { actionId: resolved.actionId, codeHash: resolved.codeHash, object: resolved.object! },
        fixedTarget: selected,
        selected,
      };
    }
    const createFormTypes = Object.values(projection.data).flatMap(datum =>
      isCreateFormRead(datum.source, datum.read) && "type" in datum.source ? [datum.source.type.id] : []);
    const affects = [...new Set([...resolved.affects, ...createFormTypes])];
    return {
      effect: "write" as const,
      handler,
      describe: () => ({ ...describeObjectAction(resolved), target }),
      action: {
        actionId: resolved.actionId,
        codeHash: resolved.codeHash,
        ...(affects.length > 0 && { affects }),
      },
      fixedTarget: null,
      selected: null,
    };
  }
  const admitted = admitPlatformOperation(placement, bound, selection, pinnedInputs, actor.credentials.locale);
  if (admitted) return {
    ...admitted,
    describe: () => describeServerOperation(admitted.handler, operationHost(actor), placement.slot, admitted.descriptor),
  };
}

function admitActionBinding(
  placement: Placement, bound: BoundProjectionOperation, selection: Selection,
  pinnedInputs: ReadonlyMap<string, unknown>, locale?: string,
) {
  const { descriptor, selected } = resolveTarget(placement, bound, selection, pinnedInputs, locale);
  if (selected?.kind === "object") {
    const { objectType, primaryKey } = selected;
    return { target: descriptor, selected, action: { actionId: bound.binding.operation.id, object: { objectType, primaryKey } } };
  }
  if (!bound.binding.target) return { target: descriptor, selected: null, action: { actionId: bound.binding.operation.id } };
}

function skipDescriptionAdmission(error: unknown) {
  return error instanceof HttpError && error.code !== "PANEL_OPERATION_DRAFT_UNBOUND";
}

function admitPlatformOperation(
  placement: Placement,
  bound: BoundProjectionOperation,
  selection: Selection,
  pinnedInputs: ReadonlyMap<string, unknown>,
  locale?: string,
) {
  const { slot, projection } = placement;
  const { binding, owner } = bound;
  const { descriptor, fixed, selected } = resolveTarget(placement, bound, selection, pinnedInputs, locale);
  if (!owner) throw new HttpError(422, `Operation '${binding.operation.id}' has no server owner client`, "OPERATION_UNAVAILABLE");
  const { handler } = owner;
  if (handler.effect === "read") {
    if (handler.target.source === "draft") {
      const draftSlot = placement.member.readOperationInputs?.[bound.name]?.draft?.slot;
      if (!draftSlot || !Object.hasOwn(placement.panel.manifest.members, draftSlot)) {
        throw new HttpError(422, `Member '${slot}', operation '${bound.name}' must declare a form member in readOperationInputs.${bound.name}.draft.slot`, "PANEL_OPERATION_DRAFT_UNBOUND");
      }
      return {
        effect: "read" as const, handler, fixedTarget: undefined, selected: undefined,
        descriptor: { source: "draft" as const, slot: draftSlot },
      };
    }
    if (handler.target.source === "input" && descriptor.source !== "row" && selected?.kind !== "object") return undefined;
    return {
      effect: "read" as const, handler, fixedTarget: fixed, selected,
      descriptor,
    };
  }
  const writeDraftSlot = placement.member.operationDrafts?.[bound.name]?.slot;
  if (writeDraftSlot && !Object.hasOwn(placement.panel.manifest.members, writeDraftSlot)) {
    throw new HttpError(422, `Member '${slot}', operation '${bound.name}' references undeclared form member '${writeDraftSlot}'`, "PANEL_OPERATION_DRAFT_UNBOUND");
  }
  const draft = handler.kind === "form.save" && selected?.kind !== "object";
  if (draft && !allowsOperationDraft(projection, handler) && !(handler.create === true && writeDraftSlot)) return undefined;
  return {
    effect: "write" as const,
    handler,
    descriptor: draft ? { source: "draft" as const, slot: writeDraftSlot ?? slot } : descriptor,
    selected,
    fixedTarget: draft ? { kind: "draft" as const } : fixed,
  };
}

export interface ScopedActionDescriptions {
  path: JavaPanelRead;
  retrievalScopeId: string;
}

const actionDescriptionFields = storedObjectActionSchema.pick({ id: true, name: true, target: true, function: true });
const actionDescriptionResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), payload: storedObjectActionSchema }),
  z.object({ status: z.literal("forbidden"), code: z.string().nullish(), error: z.string(), payload: actionDescriptionFields.optional() }),
  z.object({ status: z.literal("error"), code: z.string().nullish(), error: z.string() }),
]);

async function readScopedActionDescriptions(
  actor: PanelOperationActor, descriptions: ActionDescription[], { path, retrievalScopeId }: ScopedActionDescriptions,
) {
  const entries = new Map<string, PanelOwnerOperationDescriptor>();
  if (!descriptions.length) return entries;
  const actions = descriptions.map(({ action: { actionId, object } }) => ({
    primaryKey: actionId,
    ...(object && { object: { className: object.objectType, primaryKey: object.primaryKey } }),
  }));
  const { results: [result] } = await readViaJava(actor.owner, [{
    ...path, call: { type: ACTION, name: "executionDefinitions", parameters: { actions } },
  }], actor.credentials, retrievalScopeId);
  if (result.status === "forbidden") throw new HttpError(403, result.error, result.code ?? undefined);
  if (result.status === "error") throw new HttpError(422, result.error, result.code ?? undefined);
  if (result.status === "empty") throw new HttpError(502, "The action description owner returned no result");
  const definitions = z.array(actionDescriptionResult).length(descriptions.length).parse(result.payload);
  for (const [index, definition] of definitions.entries()) {
    if (definition.status === "error") continue;
    const stored = definition.payload;
    if (!stored || (definition.status === "forbidden" && definition.code !== "ACTION_TARGET_OUT_OF_SCOPE")) continue;
    const { name, target, action } = descriptions[index];
    if (stored.id !== action.actionId || (action.object ? stored.target?.className !== action.object.objectType : stored.target !== null))
      throw new HttpError(502, "The execution definition does not match the admitted action and target", "PANEL_READ_OWNER_RESPONSE_INVALID");
    entries.set(name, {
      ...describeObjectAction({ name: stored.name, declaration: objectActionDeclaration(stored) }),
      target,
      ...(definition.status === "forbidden" && { unavailable: panelOperationUnavailableSchema.parse({ reason: definition.error }) }),
    });
  }
  return entries;
}

export async function readAdmittedProjectionOperations(
  actor: PanelOperationActor,
  placement: Placement,
  inputs: Record<string, unknown>,
  actionScope?: ScopedActionDescriptions,
): Promise<Record<string, PanelOwnerOperationDescriptor>> {
  const pinnedInputs = literalOperationInputs(placement);
  const selection = operationReadSelection(inputs);
  const bounds = boundProjectionOperations(placement.projection);
  const actions = actionScope && await readScopedActionDescriptions(actor, bounds.flatMap(bound =>
    bound.binding.operation.kind === "Action"
      ? prepareActionDescription(placement, bound, selection, pinnedInputs, actor.credentials.locale)
      : []), actionScope);
  const descriptions: [string, PanelOwnerOperationDescriptor][] = [];
  for (const bound of bounds) {
    if (actions && bound.binding.operation.kind === "Action") {
      const descriptor = actions.get(bound.name);
      if (descriptor) descriptions.push([bound.name, descriptor]);
      continue;
    }
    let result: Awaited<ReturnType<typeof admitBoundOperation>>;
    try {
      result = await admitBoundOperation(actor, placement, bound, selection, pinnedInputs);
    } catch (error) {
      if (!skipDescriptionAdmission(error)) throw error;
      continue;
    }
    if (!result) continue;
    const described = await result.describe();
    const unavailableReason = await resolveAdmittedOperationUnavailable(actor, bound, result, inputs, pinnedInputs);
    const descriptor = unavailableReason === undefined ? described
      : { ...described, unavailable: panelOperationUnavailableSchema.parse(unavailableReason) };
    descriptions.push([bound.name, descriptor]);
  }
  return Object.fromEntries(descriptions);
}

function literalOperationInputs(placement: Placement) {
  return new Map(Object.entries(placement.member.inputs ?? {}).flatMap(([name, wire]) =>
    "literal" in wire ? [[name, wire.literal] as const] : []));
}

function operationReadSelection(inputs: Record<string, unknown>): Selection {
  return input => {
    const value = input === undefined ? undefined : inputs[input];
    if (value == null || Array.isArray(value)) return undefined;
    return placedObject(panelObjectRefSchema.parse(value));
  };
}

type OperationAdmission = NonNullable<Awaited<ReturnType<typeof admitBoundOperation>>>;
type AvailabilityTarget =
  | { kind: "single"; target: PanelRecordTarget | null }
  | { kind: "input"; target: PanelRecordTarget | null; input: Readonly<Record<string, unknown>> }
  | { kind: "batch"; targets: readonly { target: PanelRecordTarget; rowKey: string }[] };

function operationAvailabilityTarget(
  bound: BoundProjectionOperation,
  { effect, handler, selected }: Pick<OperationAdmission, "effect" | "handler" | "selected">,
  inputs: Record<string, unknown>,
  pinnedInputs: ReadonlyMap<string, unknown>,
): AvailabilityTarget | undefined {
  const { target } = bound.binding;
  if (target && ("row" in target || "rowField" in target)) return;
  if (selected?.kind === "object" || (selected === null && target === undefined)) {
    if (effect === "write" && "unavailableForInput" in handler && handler.unavailableForInput) {
      const known = new Map([...Object.entries(inputs), ...pinnedInputs]);
      return { kind: "input", target: selected, input: resolvePinnedBoundParams(bound.binding, known, selected) };
    }
    if (handler.unavailable) return { kind: "single", target: selected };
    return;
  }
  if (effect === "read" || !target || !("input" in target) ||
    (!handler.unavailable && !("unavailableBatch" in handler && handler.unavailableBatch))) return;
  const list = pinnedInputs.has(target.input) ? pinnedInputs.get(target.input) : inputs[target.input];
  if (Array.isArray(list) && list.length) return {
    kind: "batch", targets: list.map((item, index) => ({
      target: placedObject(panelObjectRefSchema.parse(item)), rowKey: String(index),
    })),
  };
}

type ActionDescription = {
  kind: "action";
  name: string;
  target: PanelOwnerOperationDescriptor["target"];
  action: ObjectActionSelection;
};

type OperationDescription = ActionDescription | {
  kind: "platform";
  name: string;
  target: PanelOwnerOperationDescriptor["target"];
  handler: PanelServerOperation;
  availability: AvailabilityTarget | undefined;
};

function prepareActionDescription(
  placement: Placement, bound: BoundProjectionOperation, selection: Selection,
  pinnedInputs: ReadonlyMap<string, unknown>, locale?: string,
): ActionDescription[] {
  try {
    const action = admitActionBinding(placement, bound, selection, pinnedInputs, locale);
    return action ? [{ kind: "action", name: bound.name, target: action.target, action: action.action }] : [];
  } catch (error) {
    if (!skipDescriptionAdmission(error)) throw error;
    return [];
  }
}

/** Expose the same binding and availability requirements to the registered read planner. */
export function prepareOperationDescriptions(placement: Placement, inputs: Record<string, unknown>, locale?: string) {
  const pinnedInputs = literalOperationInputs(placement);
  const selection = operationReadSelection(inputs);
  return boundProjectionOperations(placement.projection).flatMap<OperationDescription>(bound => {
    if (bound.binding.operation.kind === "Action")
      return prepareActionDescription(placement, bound, selection, pinnedInputs, locale);
    let admitted;
    try {
      admitted = admitPlatformOperation(placement, bound, selection, pinnedInputs, locale);
    } catch (error) {
      if (!skipDescriptionAdmission(error)) throw error;
      return [];
    }
    return admitted ? [{
      kind: "platform", name: bound.name,
      handler: admitted.handler,
      target: admitted.descriptor,
      availability: operationAvailabilityTarget(bound, admitted, inputs, pinnedInputs),
    }] : [];
  });
}

async function resolveAdmittedOperationUnavailable(
  actor: PanelOperationActor,
  bound: BoundProjectionOperation,
  result: OperationAdmission,
  inputs: Record<string, unknown>,
  pinnedInputs: ReadonlyMap<string, unknown>,
): Promise<PanelOwnerOperationDescriptor["unavailable"]> {
  const target = operationAvailabilityTarget(bound, result, inputs, pinnedInputs);
  if (!target) return;
  const host = operationHost(actor);
  if (target.kind === "single") return result.handler.unavailable!(host, target.target);
  const handler = result.handler as PanelWriteServerOperation;
  if (target.kind === "input") return handler.unavailableForInput!(host, target.target, target.input);
  const reasons = await resolveBatchUnavailableReasons(host, handler, target.targets);
  // Mixed selections stay available because execution reports outcomes for individual items.
  if (target.targets.every(({ rowKey }) => reasons.get(rowKey) !== undefined)) return reasons.get(target.targets[0].rowKey);
}

function rowTargetForBinding(
  binding: ProjectionOperationBinding,
  row: PanelRecord,
  fallbackClassName: string | undefined,
  inputs: Readonly<Record<string, unknown>>,
): PanelRecordTarget | null | undefined {
  const { target } = binding;
  if (!target) return null;
  if ("literal" in target || "input" in target) return fixedRowOperationTarget(target, inputs);
  if ("row" in target) {
    try {
      return placedObject(panelRecordObjectRef(row, fallbackClassName));
    } catch {
      return undefined;
    }
  }
  const raw = row.fields[target.rowField];
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "kind" in raw && raw.kind === "reference") {
    const parsed = panelObjectRefSchema.safeParse({ className: raw.className, primaryKey: raw.primaryKey });
    return parsed.success ? placedObject(parsed.data) : undefined;
  }
  const parsed = panelObjectRefSchema.safeParse(raw);
  return parsed.success ? placedObject(parsed.data) : undefined;
}

export function fixedRowOperationTarget(
  target: Extract<NonNullable<ProjectionOperationBinding["target"]>, { literal: unknown } | { input: string }>,
  inputs: Readonly<Record<string, unknown>>,
) {
  if ("literal" in target) return placedObject(target.literal);
  const parsed = panelObjectRefSchema.safeParse(inputs[target.input]);
  return parsed.success ? placedObject(parsed.data) : undefined;
}

const ROW_AVAILABILITY_CONCURRENCY = 8;

async function runWithConcurrency<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      await work(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

export async function resolveBatchUnavailableReasons(
  host: ReturnType<typeof operationHost>,
  handler: PanelWriteServerOperation,
  targets: readonly { rowKey: string; target: PanelRecordTarget }[],
): Promise<ReadonlyMap<string, PanelOwnerOperationDescriptor["unavailable"]>> {
  if (targets.length === 0) return new Map();
  if (handler.unavailableBatch) return handler.unavailableBatch(host, targets);
  if (!handler.unavailable) return new Map();
  const unavailable = handler.unavailable.bind(handler);
  // Deduplicate identical targets (e.g. outer parent target shared across all 50 rows -> 1 check instead of 50).
  const uniqueTargets = new Map<string, PanelRecordTarget>();
  for (const { target } of targets) {
    uniqueTargets.set(`${target.objectType}\u0000${target.primaryKey}`, target);
  }
  const reasonsByTarget = new Map<string, PanelOwnerOperationDescriptor["unavailable"]>();
  await runWithConcurrency([...uniqueTargets.entries()], ROW_AVAILABILITY_CONCURRENCY, async ([targetKey, target]) => {
    const reason = await unavailable(host, target);
    if (reason !== undefined) reasonsByTarget.set(targetKey, reason);
  });
  const reasonsByRowKey = new Map<string, PanelOwnerOperationDescriptor["unavailable"]>();
  for (const { rowKey, target } of targets) {
    const reason = reasonsByTarget.get(`${target.objectType}\u0000${target.primaryKey}`);
    if (reason !== undefined) reasonsByRowKey.set(rowKey, reason);
  }
  return reasonsByRowKey;
}

async function resolveRowBatchUnavailableReasons(
  host: ReturnType<typeof operationHost>,
  handler: PanelWriteServerOperation,
  targets: readonly { rowKey: string; target: PanelRecordTarget }[],
): Promise<ReadonlyMap<string, PanelOwnerOperationDescriptor["unavailable"]>> {
  if (targets.length === 0) return new Map();
  if (!handler.unavailableBatch) throw new Error(`Operation '${handler.handlerRef}' does not implement batch row availability`);
  return handler.unavailableBatch(host, targets);
}

/**
 * Compute per-row availability for every declared operation on a list projection in a single batch alongside
 * the list read response, eliminating per-row N+1 client requests.
 */
export async function describeRowOperationsForRows(
  actor: PanelOperationActor,
  placement: Placement,
  inputs: Readonly<Record<string, unknown>>,
  rows: readonly PanelRecord[],
  fallbackClassName?: string,
): Promise<PanelRowOperationsMap | undefined> {
  const host = operationHost(actor);
  return presentRowOperationsForRows(placement.projection, inputs, rows, fallbackClassName, async (handler, binding, targets) => {
    if (!handler.unavailable && !handler.unavailableBatch && !handler.unavailableForInput) return new Map();
    const rowScoped = binding.target !== undefined && ("row" in binding.target || "rowField" in binding.target);
    const rowBoundParams = Object.values(binding.params ?? {}).some(param => "row" in param || "rowField" in param);
    const inspectInput = !rowScoped && !rowBoundParams ? handler.unavailableForInput : undefined;
    const known = new Map(Object.entries(inputs));
    const batchTargets = targets.map(entry => ({
      ...entry,
      input: resolvePinnedBoundParams(binding, known, entry.target, entry.row),
    }));
    if (inspectInput) {
      const reasons = new Map<string, PanelOwnerOperationDescriptor["unavailable"]>();
      await runWithConcurrency(batchTargets, ROW_AVAILABILITY_CONCURRENCY, async ({ rowKey, target, input }) => {
        reasons.set(rowKey, await inspectInput(host, target, input));
      });
      return reasons;
    }
    return rowScoped
      ? resolveRowBatchUnavailableReasons(host, handler, batchTargets)
      : resolveBatchUnavailableReasons(host, handler, batchTargets);
  });
}

type RowOperationTargets = readonly { rowKey: string; row: PanelRecord; target: PanelRecordTarget }[];
type RowOperationReasons = ReadonlyMap<string, PanelOwnerOperationDescriptor["unavailable"]>;

export async function presentRowOperationsForRows(
  projection: ProductProjection,
  inputs: Readonly<Record<string, unknown>>,
  rows: readonly PanelRecord[],
  fallbackClassName: string | undefined,
  readReasons: (handler: PanelWriteServerOperation, binding: ProjectionOperationBinding, targets: RowOperationTargets) =>
    RowOperationReasons | Promise<RowOperationReasons>,
): Promise<PanelRowOperationsMap | undefined> {
  const boundOps = boundProjectionOperations(projection);
  if (!boundOps.length || !rows.length) return undefined;
  const result: Record<string, Record<string, { available: boolean; unavailable?: { reason: string } }>> = {};
  const rowKeys = rows.map(row => panelRowOperationKey(row, fallbackClassName));

  for (const bound of boundOps) {
    if (bound.binding.operation.kind !== "PlatformOperation" || !bound.owner) continue;
    const { handler } = bound.owner;
    if (handler.effect !== "write") {
      for (const rowKey of rowKeys) {
        (result[rowKey] ??= {})[bound.name] = { available: true };
      }
      continue;
    }

    const rowEntries = rows.map((row, index) => {
      const target = rowTargetForBinding(bound.binding, row, fallbackClassName, inputs);
      const compatible = target === undefined || target === null
        || operationAcceptsTargetType(target.objectType, bound.owner!.targetType, bound.owner!.declaration.targetTypes);
      return {
        rowKey: rowKeys[index]!,
        row,
        target,
        compatible,
      };
    });

    const validTargets = rowEntries.filter((entry): entry is RowOperationTargets[number] & { compatible: boolean } =>
      entry.compatible && entry.target !== undefined && entry.target !== null);
    const reasonsByRowKey = validTargets.length ? await readReasons(handler, bound.binding, validTargets) : new Map();
    for (const { rowKey, target, compatible } of rowEntries) {
      if (target === undefined) continue;
      if (!compatible) {
        (result[rowKey] ??= {})[bound.name] = { available: false };
        continue;
      }
      const reason = target === null ? undefined : reasonsByRowKey.get(rowKey);
      (result[rowKey] ??= {})[bound.name] = reason
        ? { available: false, unavailable: panelOperationUnavailableSchema.parse(reason) }
        : { available: true };
    }
  }

  return Object.keys(result).length ? result : undefined;
}

export async function declaredDirectOperation(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  use: ApplicationPanelUse | undefined,
  panel: ProductPanel,
  id: string,
  target?: PanelOperationTarget | null,
  memberPath?: PanelMemberPath,
  options: DeclaredDirectOperationOptions = {},
) {
  const separator = id.lastIndexOf(".");
  if (separator < 1) return unavailable(id);
  const name = id.slice(separator + 1);
  const slot = memberPath?.at(-1)?.member ?? id.slice(0, separator);
  if (id !== panelOperationId(memberPath?.map(segment => segment.member) ?? slot, name)) return unavailable(id);
  let placement: Placement;
  let trail: readonly ResolvedPanelPathStep[] = [];
  if (memberPath) {
    const resolved = await resolvePanelMemberPath(owner, credentials, panel, memberPath, use);
    if (resolved.kind !== "projection") return unavailable(id);
    placement = { ...resolved, slot, nested: { memberPath, publisherPanelId: resolved.panel.id } };
    trail = resolved.trail;
  } else {
    placement = { ...await requireDirectPanelMember(owner, credentials, panel, slot), panel, slot };
  }
  const bound = boundProjectionOperations(placement.projection).find(entry => entry.name === name);
  if (!bound) return unavailable(id);

  const pinnedInputs = resolvePinnedInputs(use, trail, placement.member, options.isFrameRoot === true);
  const boundParams = resolvePinnedBoundParams(bound.binding, pinnedInputs, target);
  const admitted = await admitBoundOperation({ owner, credentials }, placement, bound, () => target, pinnedInputs);
  if (!admitted) throw new HttpError(400, `Select an eligible target for operation '${id}'`, "PANEL_SELECTION_REQUIRED");
  const { describe, action, ...current } = admitted;
  const descriptor = await describe();
  if (current.effect === "read") return { ...current, descriptor, boundParams };
  const operation = panelWriteOperationSnapshotSchema.parse({
    ...descriptor, ...placement.nested, id, slot, ...(action && { action }),
  });
  const creating = descriptor.target.source === "none";
  const formDatum = creating ? "createForm" : "form";
  const isCustomerFormSave = current.handler.kind === "action"
    && placement.projection.data[formDatum]?.read === formDatum
    && declaredCustomerFormSaveName(placement.projection.operations, creating) === name;
  return {
    ...current,
    descriptor,
    operation,
    isFormSave: current.handler.kind === "form.save" || isCustomerFormSave,
    acceptsDraftSecretFields: current.handler.kind === "form.save" ||
      placement.member.operationDrafts?.[name] !== undefined ||
      Object.values(placement.projection.data).some(datum => datum.read === "form" || datum.read === "createForm"),
    boundParams,
    ...(bound.binding.params ? { bindingParams: bound.binding.params } : {}),
    use,
    projection: { id: placement.projection.id, binding: current.handler.binding },
    projectionDefinition: placement.projection,
  };
}
