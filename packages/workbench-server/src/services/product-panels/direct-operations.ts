import type { PanelRowOperationsMap } from "@ontomato/contracts/panel-host";
import { panelWriteOperationSnapshotSchema } from "@ontomato/contracts/panel-agent";
import {
  matchesObjectType, panelObjectRefSchema, panelOperationId, panelOperationUnavailableSchema,
  panelPortAccepts, panelStateInputType, type PanelMember, type PanelMemberPath,
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
import { resolvePinnedInputs } from "./input-wiring";
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
  const offered = "state" in wire ? panelStateInputType(wire, panel.manifest.state[wire.state].type) : undefined;
  if ((port?.kind !== "object" && port?.kind !== "object-union" && port?.kind !== "list") ||
    ("state" in wire && (offered === undefined || !panelPortAccepts(port, offered)))) {
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
  if (binding.operation.kind === "Action") {
    if (selected?.kind === "object") {
      const { objectType, primaryKey } = selected;
      const resolved = await resolveObjectAction(operationHost(actor), { actionId: binding.operation.id, object: { objectType, primaryKey } });
      const handler: PanelWriteServerOperation = objectActionOperation(resolved);
      return {
        effect: "write" as const,
        handler,
        describe: () => ({ ...describeObjectAction(resolved), target: descriptor }),
        action: { actionId: resolved.actionId, codeHash: resolved.codeHash, object: resolved.object! },
        fixedTarget: selected,
        selected,
      };
    }
    if (binding.target !== undefined) return undefined;
    const resolved = await resolveObjectAction(operationHost(actor), { actionId: binding.operation.id });
    const handler: PanelWriteServerOperation = objectActionOperation(resolved);
    const createFormTypes = Object.values(projection.data).flatMap(datum =>
      datum.read === "createForm" && "type" in datum.source ? [datum.source.type.id] : []);
    const affects = [...new Set([...resolved.affects, ...createFormTypes])];
    return {
      effect: "write" as const,
      handler,
      describe: () => ({ ...describeObjectAction(resolved), target: descriptor }),
      action: {
        actionId: resolved.actionId,
        codeHash: resolved.codeHash,
        ...(affects.length > 0 && { affects }),
      },
      fixedTarget: null,
      selected: null,
    };
  }
  if (!owner) throw new HttpError(422, `Operation '${binding.operation.id}' has no server owner client`, "OPERATION_UNAVAILABLE");
  const { handler } = owner;
  const host = operationHost(actor);
  if (handler.effect === "read") {
    if (handler.target.source === "draft") {
      const draftSlot = placement.member.readOperationInputs?.[bound.name]?.draft?.slot;
      if (!draftSlot || !Object.hasOwn(placement.panel.manifest.members, draftSlot)) {
        throw new HttpError(422, `Member '${slot}', operation '${bound.name}' must declare a form member in readOperationInputs.${bound.name}.draft.slot`, "PANEL_OPERATION_DRAFT_UNBOUND");
      }
      return {
        effect: "read" as const, handler, fixedTarget: undefined, selected: undefined,
        describe: () => describeServerOperation(handler, host, slot, { source: "draft", slot: draftSlot }),
      };
    }
    if (handler.target.source === "input" && selected?.kind !== "object") return undefined;
    return {
      effect: "read" as const, handler, fixedTarget: fixed, selected,
      describe: () => describeServerOperation(handler, host, slot, descriptor),
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
    describe: () => describeServerOperation(handler, host, slot,
      draft ? { source: "draft", slot: writeDraftSlot ?? slot } : descriptor),
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
    const described = await result.describe();
    const unavailableReason = await resolveAdmittedOperationUnavailable(actor, bound, result, inputs, pinnedInputs);
    const descriptor = unavailableReason === undefined ? described
      : { ...described, unavailable: panelOperationUnavailableSchema.parse(unavailableReason) };
    descriptions.push([bound.name, descriptor]);
  }
  return Object.fromEntries(descriptions);
}

/** Resolve availability for a single target or a list-input batch target (unavailable only when every item is unavailable). */
async function resolveAdmittedOperationUnavailable(
  actor: PanelOperationActor,
  bound: BoundProjectionOperation,
  result: NonNullable<Awaited<ReturnType<typeof admitBoundOperation>>>,
  inputs: Readonly<Record<string, unknown>>,
  pinnedInputs: ReadonlyMap<string, unknown>,
): Promise<PanelOwnerOperationDescriptor["unavailable"]> {
  const isRowTarget = bound.binding.target !== undefined && ("row" in bound.binding.target || "rowField" in bound.binding.target);
  if (isRowTarget || result.effect !== "write") return undefined;
  if (result.selected?.kind === "object") {
    return result.handler.unavailable?.(operationHost(actor), result.selected);
  }
  const targetInput = bound.binding.target && "input" in bound.binding.target ? bound.binding.target.input : undefined;
  if (targetInput === undefined || (!result.handler.unavailableBatch && !result.handler.unavailable)) {
    return undefined;
  }
  const rawInput = pinnedInputs.has(targetInput) ? pinnedInputs.get(targetInput) : inputs[targetInput];
  if (!Array.isArray(rawInput) || rawInput.length === 0) return undefined;

  const targets = rawInput.map((item, index) => ({
    target: placedObject(panelObjectRefSchema.parse(item)),
    rowKey: String(index),
  }));
  const reasons = await resolveBatchUnavailableReasons(operationHost(actor), result.handler, targets);
  let unavailableCount = 0;
  for (const { rowKey } of targets) {
    if (reasons.get(rowKey) !== undefined) unavailableCount++;
  }
  // Mixed selections stay available because executeBatch processes items independently and reports per-item outcomes.
  return unavailableCount === targets.length ? reasons.get(targets[0]!.rowKey) : undefined;
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

export async function resolveBatchUnavailableReasons(
  host: ReturnType<typeof operationHost>,
  handler: PanelWriteServerOperation,
  targets: readonly { rowKey: string; target: PanelRecordTarget }[],
): Promise<ReadonlyMap<string, PanelOwnerOperationDescriptor["unavailable"]>> {
  if (targets.length === 0) return new Map();
  if (handler.unavailableBatch) {
    return handler.unavailableBatch(host, targets);
  }
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

    const reasonsByRowKey = await resolveBatchUnavailableReasons(host, handler, validTargets);
    for (const { rowKey, target } of rowEntries) {
      if (target === undefined) continue;
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
  const admitted = await admitBoundOperation({ owner, credentials }, placement, bound, () => target, pinnedInputs);
  if (!admitted) throw new HttpError(400, `Select an eligible target for operation '${id}'`, "PANEL_SELECTION_REQUIRED");
  const { describe, action, ...current } = admitted;
  const descriptor = await describe();
  if (current.effect === "read") return { ...current, descriptor, boundParams };
  const operation = panelWriteOperationSnapshotSchema.parse({
    ...descriptor, ...placement.nested, id, slot, ...(action && { action }),
  });
  return {
    ...current,
    descriptor,
    operation,
    acceptsDraftSecretFields: current.handler.kind === "form.save" ||
      placement.member.operationDrafts?.[name] !== undefined ||
      Object.values(placement.projection.data).some(datum => datum.read === "form" || datum.read === "createForm"),
    boundParams,
    ...(bound.binding.params ? { bindingParams: bound.binding.params } : {}),
    use,
    projection: { id: placement.projection.id, binding: current.handler.binding },
  };
}
