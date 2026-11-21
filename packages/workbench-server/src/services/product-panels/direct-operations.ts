import { panelWriteOperationSnapshotSchema } from "@ontomato/contracts/panel-agent";
import { panelObjectRefSchema, panelOperationId, panelOperationUnavailableSchema, panelPortAccepts, type PanelMember, type PanelMemberPath } from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { projectionOperationTargetMatches } from "@ontomato/contracts/panel-projection";
import type { ApplicationPanelUse, ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { describeObjectAction, objectActionOperation, resolveObjectAction } from "../action/object-actions";
import type { ProductOwner } from "../product-governance/grants";
import { requireDirectPanelMember } from "./current";
import { resolvePanelMemberPath } from "./member-path";
import { allowsOperationDraft, boundProjectionOperations, type BoundProjectionOperation } from "./operation-bindings";
import { operationHost } from "./operation-host";
import { describeServerOperation, type PanelOperationActor, type PanelOperationTarget, type PanelRecordTarget, type PanelWriteServerOperation } from "./server-operations";

export type PlacedOperationTarget = PanelOperationTarget | { kind: "list"; objects?: PanelRecordTarget[] } | null;
type Selection = (port?: string) => PanelOperationTarget | null | undefined;
interface Placement {
  panel: Pick<ProductPanel, "manifest">;
  projection: ProductProjection;
  member: PanelMember;
  slot: string;
  nested?: { memberPath: PanelMemberPath; publisherPanelId: string };
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

function resolveTarget(placement: Placement, bound: BoundProjectionOperation, selection: Selection, locale?: string) {
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

  const { input } = target;
  const wire = member.inputs?.[input];
  const port = projection.inputs[input];
  if (!wire) throw new HttpError(422, tForLocale(locale, "panels.operation.targetInputUnbound", { ...problem, input }), "PANEL_OPERATION_TARGET_UNBOUND");
  if ((port?.kind !== "object" && port?.kind !== "list") ||
    ("state" in wire && !panelPortAccepts(port, panel.manifest.state[wire.state].type))) {
    const message = owner?.targetType
      ? tForLocale(locale, "panels.operation.targetInputMismatch", { ...problem, input, objectType: owner.targetType })
      : `Operation '${bound.name}' has an incompatible object input '${input}' on member '${slot}'`;
    throw new HttpError(422, message, "PANEL_OPERATION_TARGET_MISMATCH");
  }
  const literal = "literal" in wire ? wire.literal : undefined;
  const fixed: PlacedOperationTarget | undefined = port.kind === "list"
    ? { kind: "list", objects: literal === undefined ? undefined : literal === null ? [] : panelObjectRefSchema.array().parse(literal).map(placedObject) }
    : literal == null ? literal : placedObject(panelObjectRefSchema.parse(literal));
  const supplied = selection(input);
  requirePinnedObject(fixed, supplied);
  const selected = fixed === undefined ? supplied : fixed;
  if (port.kind === "object" && selected?.kind === "object" && selected.objectType !== port.objectType)
    throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
  return { descriptor: { source: "input" as const, input }, fixed, selected };
}

async function admitBoundOperation(actor: PanelOperationActor, placement: Placement, bound: BoundProjectionOperation, selection: Selection) {
  const { slot, projection } = placement;
  const { binding, owner } = bound;
  const { descriptor, fixed, selected } = resolveTarget(placement, bound, selection, actor.credentials.locale);
  const id = panelOperationId(placement.nested?.memberPath.map(segment => segment.member) ?? slot, bound.name);
  if (binding.operation.kind === "Action") {
    if (selected?.kind !== "object") return undefined;
    const { objectType, primaryKey } = selected;
    const resolved = await resolveObjectAction(operationHost(actor), { actionId: binding.operation.id, object: { objectType, primaryKey } });
    const handler: PanelWriteServerOperation = objectActionOperation(resolved);
    const described = { ...describeObjectAction(resolved), target: descriptor };
    const operation = panelWriteOperationSnapshotSchema.parse({
      ...described, ...placement.nested, id, slot,
      action: { actionId: resolved.actionId, codeHash: resolved.codeHash, object: resolved.object },
    });
    return { effect: "write" as const, handler, operation, descriptor: described, fixedTarget: selected, selected };
  }
  if (!owner) return unavailable(id);
  const { handler } = owner;
  const locale = actor.credentials.locale;
  if (handler.effect === "read") {
    if (handler.target.source === "draft") {
      const draftSlot = placement.member.readOperationInputs?.[bound.name]?.draft?.slot;
      if (!draftSlot || !Object.hasOwn(placement.panel.manifest.members, draftSlot))
        throw new HttpError(422, `Member '${slot}', operation '${bound.name}' must declare a form member in readOperationInputs.${bound.name}.draft.slot`, "PANEL_OPERATION_DRAFT_UNBOUND");
      return { effect: "read" as const, handler, descriptor: describeServerOperation(handler, locale, slot, { source: "draft", slot: draftSlot }), fixedTarget: undefined };
    }
    if (handler.target.source === "input" && selected?.kind !== "object") return undefined;
    return { effect: "read" as const, handler, descriptor: describeServerOperation(handler, locale, slot, descriptor), fixedTarget: fixed };
  }
  const draft = handler.kind === "form.save" && selected?.kind !== "object";
  if (draft && !allowsOperationDraft(projection, handler)) return undefined;
  const described = describeServerOperation(handler, locale, slot, draft ? { source: "draft", slot } : descriptor);
  const operation = panelWriteOperationSnapshotSchema.parse({ ...described, ...placement.nested, id, slot });
  return { effect: "write" as const, handler, operation, descriptor: described, selected,
    fixedTarget: draft ? { kind: "draft" as const } : fixed };
}

export async function readAdmittedProjectionOperations(actor: PanelOperationActor, placement: Placement,
  inputs: Record<string, unknown>,
): Promise<Record<string, PanelOwnerOperationDescriptor>> {
  const descriptions: [string, PanelOwnerOperationDescriptor][] = [];
  for (const bound of boundProjectionOperations(placement.projection)) {
    let result: Awaited<ReturnType<typeof admitBoundOperation>>;
    try {
      result = await admitBoundOperation(actor, placement, bound, input => {
        const value = input === undefined ? undefined : inputs[input];
        if (value == null || Array.isArray(value)) return undefined;
        return placedObject(panelObjectRefSchema.parse(value));
      });
    } catch (error) {
      if (!(error instanceof HttpError) || error.code === "PANEL_OPERATION_DRAFT_UNBOUND") throw error;
      continue;
    }
    if (!result) continue;
    const unavailable = result.effect === "write" && result.selected?.kind === "object"
      ? await result.handler.unavailable?.(operationHost(actor), result.selected) : undefined;
    const descriptor = unavailable === undefined ? result.descriptor
      : { ...result.descriptor, unavailable: panelOperationUnavailableSchema.parse(unavailable) };
    descriptions.push([bound.name, descriptor]);
  }
  return Object.fromEntries(descriptions);
}

export async function declaredDirectOperation(
  owner: ProductOwner, credentials: AssistantCredentials, use: ApplicationPanelUse, panel: ProductPanel, id: string,
  target?: PanelOperationTarget | null, memberPath?: PanelMemberPath,
) {
  const separator = id.lastIndexOf(".");
  if (separator < 1) return unavailable(id);
  const name = id.slice(separator + 1);
  const slot = memberPath?.at(-1)?.member ?? id.slice(0, separator);
  if (id !== panelOperationId(memberPath?.map(segment => segment.member) ?? slot, name)) return unavailable(id);
  let placement: Placement;
  if (memberPath) {
    const resolved = await resolvePanelMemberPath(owner, credentials, panel, memberPath, use);
    if (resolved.kind !== "projection") return unavailable(id);
    placement = { ...resolved, slot, nested: { memberPath, publisherPanelId: resolved.panel.id } };
  } else {
    placement = { ...await requireDirectPanelMember(owner, credentials, panel, slot), panel, slot };
  }
  const bound = boundProjectionOperations(placement.projection).find(entry => entry.name === name);
  if (!bound) return unavailable(id);
  const current = await admitBoundOperation({ owner, credentials }, placement, bound, () => target);
  if (!current) throw new HttpError(400, `Select an eligible target for operation '${id}'`, "PANEL_SELECTION_REQUIRED");
  if (current.effect === "read") return current;
  return { ...current, use, projection: { id: placement.projection.id, binding: current.handler.binding } };
}
