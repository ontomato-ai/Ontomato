import { z } from "zod";
import { ACTION } from "@ontomato/contracts/platform-object-types";
import { panelWriteOperationSnapshotSchema } from "@ontomato/contracts/panel-agent";
import {
  matchesObjectType, panelObjectRefSchema, panelOperationId, panelOperationUnavailableSchema,
  panelPortAccepts, panelStateInputType, type PanelMember, type PanelMemberPath,
} from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import {
  declaredCustomerFormSaveName, formatOperationTargetTypes, operationAcceptsTargetType,
  projectionOperationTargetMatches,
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
import { readViaJava, type JavaPanelRead, type JavaPanelReadResult } from "./java-panel-reads";
import { resolvePanelMemberPath, type ResolvedPanelPathStep } from "./member-path";
import {
  bindingRefusal, placedObject, planAvailability, readDirect, readDirectInputSchema, resolvePinnedBoundParams, rowParamBinding,
  rowTargetBinding, type AvailabilityCall,
} from "./operation-availability";
import { allowsOperationDraft, boundProjectionOperations, isCreateFormRead, type BoundProjectionOperation } from "./operation-bindings";
import { operationHost } from "./operation-host";
import { readyPayload, type RegisteredDataReadItem } from "./registered-data-read";
import {
  describeServerOperation, type PanelOperationActor, type PanelOperationFactsContext, type PanelOperationTarget,
  type PanelRecordTarget, type PanelServerOperation, type PanelWriteServerOperation,
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

function requirePinnedObject(fixed: PlacedOperationTarget | undefined, supplied: PanelOperationTarget | null | undefined) {
  if (fixed?.kind === "object" && supplied?.kind === "object" &&
    (fixed.objectType !== supplied.objectType || fixed.primaryKey !== supplied.primaryKey))
    throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
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
    describe: (inputSchema?: PanelOwnerOperationDescriptor["inputSchema"]) =>
      describeServerOperation(admitted.handler, actor.credentials.locale, placement.slot, admitted.descriptor, inputSchema),
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

export function factsContext({ owner, credentials }: PanelOperationActor): PanelOperationFactsContext {
  return { owner, credentials, locale: credentials.locale };
}

/** Describe a member's operations outside a formal page: their facts are read directly, in one batch. */
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
  const context = factsContext(actor);
  const described: { name: string; descriptor?: PanelOwnerOperationDescriptor; admitted?: Admitted }[] = [];
  for (const bound of bounds) {
    if (actions && bound.binding.operation.kind === "Action") {
      const descriptor = actions.get(bound.name);
      if (descriptor) described.push({ name: bound.name, descriptor });
      continue;
    }
    let result: Awaited<ReturnType<typeof admitBoundOperation>>;
    try {
      result = await admitBoundOperation(actor, placement, bound, selection, pinnedInputs);
    } catch (error) {
      if (!skipDescriptionAdmission(error)) throw error;
      continue;
    }
    if (result) described.push({ name: bound.name, admitted: await planDescription(context, result.handler, availabilityCalls(bound, result, inputs, pinnedInputs), result.describe) });
  }
  const results = await readDirect(context, described.map(({ admitted }) => ({ reads: admitted?.reads ?? [] })));
  return Object.fromEntries(await Promise.all(described.map(async ({ name, descriptor, admitted }, index) =>
    [name, descriptor ?? await admitted!.present(results[index]!)] as const)));
}

type Admitted = Awaited<ReturnType<typeof planDescription>>;

/** An operation's description with the facts it needs: its availability for the calls and its input form. */
export async function planDescription(
  context: PanelOperationFactsContext, handler: PanelServerOperation, calls: readonly AvailabilityCall[] | undefined,
  describe: (inputSchema?: PanelOwnerOperationDescriptor["inputSchema"]) =>
    PanelOwnerOperationDescriptor | Promise<PanelOwnerOperationDescriptor>,
) {
  const availability = calls && await planAvailability(handler.availability!, context,
    { from: "targets", targets: calls.map(({ target }) => target) });
  const form = handler.inputForm;
  const count = availability?.reads.length ?? 0;
  return {
    reads: [...availability?.reads ?? [], ...form?.reads ?? []] as readonly RegisteredDataReadItem[],
    async present(results: readonly JavaPanelReadResult[]): Promise<PanelOwnerOperationDescriptor> {
      const descriptor = await describe(form?.schema(results.slice(count), context.locale));
      const refusal = availability && bindingRefusal(await availability.refuse(results.slice(0, count), calls!));
      return refusal ? { ...descriptor, unavailable: panelOperationUnavailableSchema.parse(refusal) } : descriptor;
    },
  };
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

type OperationAdmission = Pick<NonNullable<Awaited<ReturnType<typeof admitBoundOperation>>>, "effect" | "handler" | "selected">;

/**
 * The targets a binding asks availability for in a description: the fixed or selected record (none for a targetless
 * operation), or each record of a list input. A binding that takes its target or parameters from a row is decided
 * per row instead.
 */
function availabilityCalls(
  bound: BoundProjectionOperation,
  { effect, handler, selected }: OperationAdmission,
  inputs: Record<string, unknown>,
  pinnedInputs: ReadonlyMap<string, unknown>,
): AvailabilityCall[] | undefined {
  const { binding } = bound;
  if (!handler.availability || rowTargetBinding(binding) || rowParamBinding(binding)) return;
  const known = new Map([...Object.entries(inputs), ...pinnedInputs]);
  if (selected?.kind === "object" || (selected === null && binding.target === undefined))
    return [{ target: selected, params: resolvePinnedBoundParams(binding, known, selected) }];
  const { target } = binding;
  if (effect === "read" || !target || !("input" in target)) return;
  const list = pinnedInputs.has(target.input) ? pinnedInputs.get(target.input) : inputs[target.input];
  if (!Array.isArray(list) || !list.length) return;
  return list.map(item => {
    const object = placedObject(panelObjectRefSchema.parse(item));
    return { target: object, params: resolvePinnedBoundParams(binding, known, object) };
  });
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
  calls: AvailabilityCall[] | undefined;
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
      calls: availabilityCalls(bound, admitted, inputs, pinnedInputs),
    }] : [];
  });
}

const skippedActionRefusals = new Set([
  "ACTION_NOT_FOUND", "ACTION_NOT_EXECUTABLE", "ACTION_NOT_OBJECT_ACTION", "ACTION_TARGET_REQUIRED",
  "ACTION_TARGET_MISMATCH", "ACTION_NOT_GRANTED", "ACTION_TARGET_OUT_OF_SCOPE", "ACTION_PRECONDITION_FAILED",
]);

/**
 * An object action's description within a formal page's second read: its execution definition, or nothing when the
 * owner refuses the action itself. Placement denials have their own codes and refuse the read; a code-less denial
 * here comes from the owner's form data-scope check.
 */
export function actionDescriptionRead({ actionId, object }: ObjectActionSelection) {
  return {
    read: { call: { type: ACTION, name: "executionDefinition", parameters: {
      primaryKey: actionId,
      ...(object && { object: { className: object.objectType, primaryKey: object.primaryKey } }),
    } } } satisfies RegisteredDataReadItem,
    present(result: JavaPanelReadResult) {
      if (result.status === "empty"
          || result.status !== "ready" && (result.code ? skippedActionRefusals.has(result.code) : result.status === "forbidden"))
        return undefined;
      const action = storedObjectActionSchema.parse(readyPayload(result).payload);
      if (action.id !== actionId || (object ? action.target?.className !== object.objectType : action.target !== null))
        throw new HttpError(502, "The execution definition does not match the admitted action and target", "PANEL_READ_OWNER_RESPONSE_INVALID");
      return describeObjectAction({ name: action.name, declaration: objectActionDeclaration(action) });
    },
  };
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
  const form = current.handler.inputForm;
  const descriptor = await describe(form && await readDirectInputSchema(form, factsContext({ owner, credentials })));
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
