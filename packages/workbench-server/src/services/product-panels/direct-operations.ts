import type { PanelRowOperationsMap } from "@ontomato/contracts/panel-host";
import { panelWriteOperationSnapshotSchema } from "@ontomato/contracts/panel-agent";
import {
  matchesObjectType, panelObjectRefSchema, panelOperationId, panelOperationUnavailableSchema,
  panelPortAccepts, type PanelMember, type PanelMemberPath,
} from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import {
  panelRecordObjectRef, panelRowOperationKey, projectionOperationTargetMatches,
  type PanelRecord, type ProjectionOperationBinding,
} from "@ontomato/contracts/panel-projection";
import type { ApplicationPanelUse, ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { describeObjectAction, objectActionOperation, resolveObjectAction } from "../action/object-actions";
import type { ProductOwner } from "../product-governance/grants";
import { requireDirectPanelMember } from "./current";
import { resolvePanelMemberPath, type ResolvedPanelPathStep } from "./member-path";
import { allowsOperationDraft, boundProjectionOperations, type BoundProjectionOperation } from "./operation-bindings";
import { operationHost } from "./operation-host";
import {
  describeServerOperation, type PanelOperationActor, type PanelOperationTarget, type PanelRecordTarget,
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

/**
 * Compute server-pinned projection inputs derived strictly from server-verified sources:
 * 1. Application entry literal `use.inputs` on the content panel root (never client-controlled)
 * 2. Parent member literal/propagated inputs along any nested `memberPath` trail
 * 3. Leaf member literal inputs
 *
 * Any target or operation parameter bound to one of these pinned inputs is injected by the server and
 * cannot be overridden by client requests.
 */
function resolvePinnedInputs(
  use: ApplicationPanelUse,
  trail: readonly ResolvedPanelPathStep[],
  leafMember: PanelMember,
  isFrameRoot: boolean,
): Map<string, unknown> {
  let pinnedState = new Map<string, unknown>();
  if (!isFrameRoot) {
    for (const [stateName, ref] of Object.entries(use.inputs ?? {})) {
      if ("literal" in ref) pinnedState.set(stateName, ref.literal);
    }
  }
  for (const step of trail) {
    const nextPinned = new Map<string, unknown>();
    if ("target" in step.member && "fromPlatform" in step.member.target) {
      for (const [stateName, ref] of Object.entries(use.inputs ?? {})) {
        if ("literal" in ref) nextPinned.set(stateName, ref.literal);
      }
    } else {
      for (const [childState, wire] of Object.entries(step.member.inputs ?? {})) {
        if ("literal" in wire) nextPinned.set(childState, wire.literal);
        else if ("state" in wire && pinnedState.has(wire.state)) nextPinned.set(childState, pinnedState.get(wire.state));
      }
    }
    pinnedState = nextPinned;
  }
  const pinnedInputs = new Map<string, unknown>();
  for (const [inputName, wire] of Object.entries(leafMember.inputs ?? {})) {
    if ("literal" in wire) pinnedInputs.set(inputName, wire.literal);
    else if ("state" in wire && pinnedState.has(wire.state)) pinnedInputs.set(inputName, pinnedState.get(wire.state));
  }
  return pinnedInputs;
}

function resolvePinnedBoundParams(
  binding: ProjectionOperationBinding,
  pinnedInputs: ReadonlyMap<string, unknown>,
  target?: PanelOperationTarget | null,
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
  if (!target) return { descriptor: { source: "none" as const }, fixed: undefined, selected: undefined };

  if ("row" in target || "rowField" in target) {
    const supplied = selection();
    if (owner?.targetType && supplied?.kind === "object" && supplied.objectType !== owner.targetType) {
      throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
    }
    const descriptorInput = owner?.declaration.target.source === "input" ? owner.declaration.target.input : "target";
    return { descriptor: { source: "input" as const, input: descriptorInput }, fixed: undefined, selected: supplied };
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
  if ((port?.kind !== "object" && port?.kind !== "object-union" && port?.kind !== "list") ||
    ("state" in wire && !panelPortAccepts(port, panel.manifest.state[wire.state].type))) {
    const message = owner?.targetType
      ? tForLocale(locale, "panels.operation.targetInputMismatch", { ...problem, input, objectType: owner.targetType })
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
  if ((port.kind === "object" || port.kind === "object-union") && selected?.kind === "object" && !matchesObjectType(port, selected.objectType))
    throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
  return { descriptor: { source: "input" as const, input }, fixed, selected };
}

async function admitBoundOperation(
  actor: PanelOperationActor,
  placement: Placement,
  bound: BoundProjectionOperation,
  selection: Selection,
  pinnedInputs: ReadonlyMap<string, unknown> = new Map(),
) {
  const { slot, projection } = placement;
  const { binding, owner } = bound;
  const { descriptor, fixed, selected } = resolveTarget(placement, bound, selection, pinnedInputs, actor.credentials.locale);
  const id = panelOperationId(placement.nested?.memberPath.map(segment => segment.member) ?? slot, bound.name);
  if (binding.operation.kind === "Action") {
    if (selected?.kind === "object") {
      const { objectType, primaryKey } = selected;
      const resolved = await resolveObjectAction(operationHost(actor), { actionId: binding.operation.id, object: { objectType, primaryKey } });
      const handler: PanelWriteServerOperation = objectActionOperation(resolved);
      const described = { ...describeObjectAction(resolved), target: descriptor };
      const operation = panelWriteOperationSnapshotSchema.parse({
        ...described,
        ...placement.nested,
        id,
        slot,
        action: { actionId: resolved.actionId, codeHash: resolved.codeHash, object: resolved.object! },
      });
      return { effect: "write" as const, handler, operation, descriptor: described, fixedTarget: selected, selected };
    }
    if (binding.target !== undefined) return undefined;
    const resolved = await resolveObjectAction(operationHost(actor), { actionId: binding.operation.id });
    const handler: PanelWriteServerOperation = objectActionOperation(resolved);
    const described = { ...describeObjectAction(resolved), target: descriptor };
    const createFormTypes = Object.values(projection.data).flatMap(datum =>
      datum.read === "createForm" && "type" in datum.source ? [datum.source.type.id] : []);
    const affects = [...new Set([...resolved.affects, ...createFormTypes])];
    const operation = panelWriteOperationSnapshotSchema.parse({
      ...described,
      ...placement.nested,
      id,
      slot,
      action: {
        actionId: resolved.actionId,
        codeHash: resolved.codeHash,
        ...(affects.length > 0 && { affects }),
      },
    });
    return { effect: "write" as const, handler, operation, descriptor: described, fixedTarget: null, selected: null };
  }
  if (!owner) throw new HttpError(422, `Operation '${binding.operation.id}' has no server owner client`, "OPERATION_UNAVAILABLE");
  const { handler } = owner;
  if (handler.effect === "read") {
    if (handler.target.source === "draft") {
      const draftSlot = placement.member.readOperationInputs?.[bound.name]?.draft?.slot;
      if (!draftSlot || !Object.hasOwn(placement.panel.manifest.members, draftSlot)) {
        throw new HttpError(422, `Member '${slot}', operation '${bound.name}' must declare a form member in readOperationInputs.${bound.name}.draft.slot`, "PANEL_OPERATION_DRAFT_UNBOUND");
      }
      const described = describeServerOperation(handler, actor.credentials.locale, slot, { source: "draft", slot: draftSlot });
      return { effect: "read" as const, handler, descriptor: described, fixedTarget: undefined, selected: undefined };
    }
    if (handler.target.source === "input" && selected?.kind !== "object") return undefined;
    const described = describeServerOperation(handler, actor.credentials.locale, slot, descriptor);
    return { effect: "read" as const, handler, descriptor: described, fixedTarget: fixed, selected };
  }
  const writeDraftSlot = placement.member.operationDrafts?.[bound.name]?.slot;
  if (writeDraftSlot && !Object.hasOwn(placement.panel.manifest.members, writeDraftSlot)) {
    throw new HttpError(422, `Member '${slot}', operation '${bound.name}' references undeclared form member '${writeDraftSlot}'`, "PANEL_OPERATION_DRAFT_UNBOUND");
  }
  const draft = handler.kind === "form.save" && selected?.kind !== "object";
  if (draft && !allowsOperationDraft(projection, handler) && !(handler.create && writeDraftSlot)) return undefined;
  const described = describeServerOperation(handler, actor.credentials.locale, slot,
    draft ? { source: "draft", slot: writeDraftSlot ?? slot } : descriptor);
  const operation = panelWriteOperationSnapshotSchema.parse({ ...described, ...placement.nested, id, slot });
  return {
    effect: "write" as const,
    handler,
    operation,
    descriptor: described,
    selected,
    fixedTarget: draft ? { kind: "draft" as const } : fixed,
  };
}

export async function readAdmittedProjectionOperations(
  actor: PanelOperationActor,
  placement: Placement,
  inputs: Record<string, unknown>,
): Promise<Record<string, PanelOwnerOperationDescriptor>> {
  const pinnedInputs = new Map<string, unknown>();
  for (const [inputName, wire] of Object.entries(placement.member.inputs ?? {})) {
    if ("literal" in wire) pinnedInputs.set(inputName, wire.literal);
  }
  const descriptions: [string, PanelOwnerOperationDescriptor][] = [];
  for (const bound of boundProjectionOperations(placement.projection)) {
    let result: Awaited<ReturnType<typeof admitBoundOperation>>;
    try {
      result = await admitBoundOperation(actor, placement, bound, input => {
        const value = input === undefined ? undefined : inputs[input];
        if (value == null || Array.isArray(value)) return undefined;
        return placedObject(panelObjectRefSchema.parse(value));
      }, pinnedInputs);
    } catch (error) {
      if (!(error instanceof HttpError) || error.code === "PANEL_OPERATION_DRAFT_UNBOUND") throw error;
      continue;
    }
    if (!result) continue;
    const isRowTarget = bound.binding.target !== undefined && ("row" in bound.binding.target || "rowField" in bound.binding.target);
    const unavailableReason = !isRowTarget && result.effect === "write" && result.selected?.kind === "object"
      ? await result.handler.unavailable?.(operationHost(actor), result.selected)
      : undefined;
    const descriptor = unavailableReason === undefined ? result.descriptor
      : { ...result.descriptor, unavailable: panelOperationUnavailableSchema.parse(unavailableReason) };
    descriptions.push([bound.name, descriptor]);
  }
  return Object.fromEntries(descriptions);
}

function rowTargetForBinding(
  binding: ProjectionOperationBinding,
  row: PanelRecord,
  fallbackClassName: string | undefined,
  inputs: Readonly<Record<string, unknown>>,
): PanelRecordTarget | null | undefined {
  const { target } = binding;
  if (!target) return null;
  if ("literal" in target) return placedObject(target.literal);
  if ("input" in target) {
    const value = inputs[target.input];
    const parsed = panelObjectRefSchema.safeParse(value);
    return parsed.success ? placedObject(parsed.data) : undefined;
  }
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
  const boundOps = boundProjectionOperations(placement.projection);
  if (!boundOps.length || !rows.length) return undefined;
  const host = operationHost(actor);
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

    const rowEntries = rows.map((row, index) => ({
      rowKey: rowKeys[index]!,
      target: rowTargetForBinding(bound.binding, row, fallbackClassName, inputs),
    }));

    if (!handler.unavailable && !handler.unavailableBatch) {
      for (const { rowKey, target } of rowEntries) {
        if (target === undefined) continue;
        (result[rowKey] ??= {})[bound.name] = { available: true };
      }
      continue;
    }

    const validTargets = rowEntries.filter((entry): entry is { rowKey: string; target: PanelRecordTarget } =>
      entry.target !== undefined && entry.target !== null);

    if (handler.unavailableBatch && validTargets.length > 0) {
      const batchReasons = await handler.unavailableBatch(host, validTargets);
      for (const { rowKey, target } of rowEntries) {
        if (target === undefined) continue;
        const reason = target === null ? undefined : batchReasons.get(rowKey);
        (result[rowKey] ??= {})[bound.name] = reason
          ? { available: false, unavailable: panelOperationUnavailableSchema.parse(reason) }
          : { available: true };
      }
      continue;
    }

    // Deduplicate identical targets (e.g. outer parent target shared across all 50 rows -> 1 check instead of 50).
    const uniqueTargets = new Map<string, PanelRecordTarget>();
    for (const { target } of validTargets) {
      uniqueTargets.set(`${target.objectType}\u0000${target.primaryKey}`, target);
    }
    const reasonsByTarget = new Map<string, PanelOwnerOperationDescriptor["unavailable"]>();
    await runWithConcurrency([...uniqueTargets.entries()], ROW_AVAILABILITY_CONCURRENCY, async ([targetKey, target]) => {
      const reason = await handler.unavailable?.(host, target);
      if (reason !== undefined) reasonsByTarget.set(targetKey, reason);
    });

    for (const { rowKey, target } of rowEntries) {
      if (target === undefined) continue;
      const reason = target === null ? undefined : reasonsByTarget.get(`${target.objectType}\u0000${target.primaryKey}`);
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
  use: ApplicationPanelUse,
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
  const current = await admitBoundOperation({ owner, credentials }, placement, bound, () => target, pinnedInputs);
  if (!current) throw new HttpError(400, `Select an eligible target for operation '${id}'`, "PANEL_SELECTION_REQUIRED");
  if (current.effect === "read") return { ...current, boundParams };
  return {
    ...current,
    boundParams,
    use,
    projection: { id: placement.projection.id, binding: current.handler.binding },
  };
}
