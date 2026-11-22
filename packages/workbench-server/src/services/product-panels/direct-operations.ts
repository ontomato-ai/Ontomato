import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelWriteOperationSnapshotSchema } from "@ontomato/contracts/panel-agent";
import {
  matchesDirectPanelValue, matchesObjectType, panelObjectRefSchema, panelOperationId, panelOperationUnavailableSchema,
  panelPortAccepts, type PanelMember, type PanelMemberItemKey, type PanelMemberPath, type PanelOperationRowContext,
} from "@ontomato/contracts/panel-manifest";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import {
  directReadDeclaration, matchPanelRecordItemKey, objectListDatumName, panelReadParameterId, panelRecordObjectRef,
  projectionOperationTargetMatches, type DirectProjectionData, type PanelRecord, type PanelRecordQuery,
  type ProjectionOperationBinding,
} from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyObjectsResponse } from "@ontomato/contracts/platform-ontology-data";
import type { ApplicationPanelUse, ProductPanel, ProductProjection } from "@ontomato/contracts/product-panels";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendUnavailableError } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { describeObjectAction, objectActionOperation, resolveObjectAction } from "../action/object-actions";
import type { ProductOwner } from "../product-governance/grants";
import { readCurrentPanelRecord, requireDirectPanelMember } from "./current";
import { executeProjectionDataRead } from "./data-reads";
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
  rowContext?: PanelOperationRowContext;
  framePanel?: ProductPanel;
  framePanelId?: string;
  isFrameRoot?: boolean;
  hostReadActor?: { owner: ProductOwner; credentials: AssistantCredentials; callerUserName?: string };
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

function listAttachmentOf(member: PanelMember) {
  return member.listColumn ?? member.listRowDetail;
}

function assertListColumnHasNoData(member: PanelMember, projection: ProductProjection) {
  if (member.listColumn !== undefined && Object.keys(projection.data).length > 0) {
    throw new HttpError(422, "listColumn members cannot declare independent data reads", "LIST_COLUMN_DATA_FORBIDDEN");
  }
}

function isRowInputWiring(wire: NonNullable<PanelMember["inputs"]>[string] | undefined): boolean {
  return wire !== undefined && ("item" in wire || "itemField" in wire);
}

function operationDependsOnRowInput(member: PanelMember, binding: ProjectionOperationBinding): boolean {
  if (binding.target && "input" in binding.target && isRowInputWiring(member.inputs?.[binding.target.input])) {
    return true;
  }
  for (const paramBinding of Object.values(binding.params ?? {})) {
    if ("input" in paramBinding && isRowInputWiring(member.inputs?.[paramBinding.input])) {
      return true;
    }
  }
  return false;
}

function resolveStaticBoundParams(member: PanelMember, binding: ProjectionOperationBinding): Record<string, unknown> {
  const boundParams: Record<string, unknown> = {};
  for (const [paramKey, paramBinding] of Object.entries(binding.params ?? {})) {
    if ("literal" in paramBinding) {
      boundParams[paramKey] = paramBinding.literal;
      continue;
    }
    const wire = member.inputs?.[paramBinding.input];
    if (!wire) {
      throw new HttpError(
        422,
        `Operation parameter '${paramKey}' references unbound input '${paramBinding.input}'`,
        "PANEL_OPERATION_PARAM_UNBOUND",
      );
    }
    if ("literal" in wire) {
      boundParams[paramKey] = wire.literal;
    }
  }
  return boundParams;
}

function resolveRowBoundParams(
  member: PanelMember,
  binding: ProjectionOperationBinding,
  resolvedInputs: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const boundParams: Record<string, unknown> = {};
  for (const [paramKey, paramBinding] of Object.entries(binding.params ?? {})) {
    if ("literal" in paramBinding) {
      boundParams[paramKey] = paramBinding.literal;
      continue;
    }
    if (!Object.hasOwn(member.inputs ?? {}, paramBinding.input)) {
      throw new HttpError(
        422,
        `Operation parameter '${paramKey}' references unbound input '${paramBinding.input}'`,
        "PANEL_OPERATION_PARAM_UNBOUND",
      );
    }
    if (!Object.hasOwn(resolvedInputs, paramBinding.input) || resolvedInputs[paramBinding.input] === undefined) {
      throw new HttpError(
        422,
        `Operation parameter '${paramKey}' could not resolve input '${paramBinding.input}'`,
        "ROW_OPERATION_INPUT_INVALID",
      );
    }
    boundParams[paramKey] = resolvedInputs[paramBinding.input];
  }
  return boundParams;
}

function hostDatumFallbackClassName(projection: ProductProjection, source: DirectProjectionData["source"]): string | undefined {
  if ("type" in source) return source.type.id;
  if ("literal" in source.object) return source.object.literal.className;
  const port = projection.inputs[source.object.input];
  return port?.kind === "object" ? port.objectType : undefined;
}

function resolveRowFieldValue(
  row: PanelRecord,
  fieldKey: string,
  port: ProductProjection["inputs"][string] | undefined,
  inputName: string,
): unknown {
  if (!Object.hasOwn(row.fields, fieldKey)) {
    throw new HttpError(422, `Row '${row.primaryKey}' is missing field '${fieldKey}' for input '${inputName}'`, "ROW_OPERATION_INPUT_INVALID");
  }
  const raw = row.fields[fieldKey];
  if (!port) return raw;
  if (port.kind === "json") {
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw) && "kind" in raw && raw.kind === "json") {
      return raw.value;
    }
    return raw;
  }
  if (port.kind === "object" || port.kind === "object-union") {
    const candidate = typeof raw === "object" && raw !== null && !Array.isArray(raw) && "kind" in raw
      ? raw.kind === "reference"
        ? { className: raw.className, primaryKey: raw.primaryKey }
        : raw.kind === "json" ? raw.value : raw
      : raw;
    if (!matchesDirectPanelValue(port, candidate)) {
      throw new HttpError(422, `Row field '${fieldKey}' does not match input '${inputName}'`, "ROW_OPERATION_INPUT_INVALID");
    }
    return candidate;
  }
  const candidate = typeof raw === "object" && raw !== null && !Array.isArray(raw) && "kind" in raw && raw.kind === "json"
    ? raw.value : raw;
  if (!matchesDirectPanelValue(port, candidate)) {
    throw new HttpError(422, `Row field '${fieldKey}' does not match input '${inputName}'`, "ROW_OPERATION_INPUT_INVALID");
  }
  return candidate;
}

function resolveRowMemberInputs(
  projection: ProductProjection,
  member: PanelMember,
  placementState: Readonly<Record<string, unknown>>,
  row: PanelRecord,
  hostFallbackClassName: string | undefined,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [inputName, wire] of Object.entries(member.inputs ?? {})) {
    const port = projection.inputs[inputName];
    if ("literal" in wire) {
      resolved[inputName] = wire.literal;
    } else if ("state" in wire) {
      if (Object.hasOwn(placementState, wire.state)) {
        resolved[inputName] = placementState[wire.state];
      }
    } else if ("item" in wire) {
      if (wire.item === true) {
        let ref: ReturnType<typeof panelRecordObjectRef>;
        try {
          ref = panelRecordObjectRef(row, hostFallbackClassName);
        } catch (error) {
          throw new HttpError(
            422,
            error instanceof Error ? error.message : `Row '${row.primaryKey}' has no object type for input '${inputName}'`,
            "ROW_OPERATION_INPUT_INVALID",
          );
        }
        if (port && port.kind !== "json" && !matchesDirectPanelValue(port, ref)) {
          throw new HttpError(422, `Row object '${ref.className}:${ref.primaryKey}' does not match input '${inputName}'`, "ROW_OPERATION_INPUT_INVALID");
        }
        resolved[inputName] = ref;
      } else {
        const scalar = wire.item === "primaryKey" ? row.primaryKey : row.label;
        if (port && port.kind !== "json" && !matchesDirectPanelValue(port, scalar)) {
          throw new HttpError(422, `Row ${wire.item} does not match input '${inputName}'`, "ROW_OPERATION_INPUT_INVALID");
        }
        resolved[inputName] = scalar;
      }
    } else {
      resolved[inputName] = resolveRowFieldValue(row, wire.itemField, port, inputName);
    }
  }
  return resolved;
}

function resolveFrameStateValues(
  framePanel: Pick<ProductPanel, "manifest"> | undefined,
  rowContext: PanelOperationRowContext | undefined,
): Record<string, unknown> {
  const rawFrameState = rowContext?.frameState;
  if (!framePanel) {
    return rawFrameState ? { ...rawFrameState } : {};
  }
  for (const key of Object.keys(rawFrameState ?? {})) {
    if (!Object.hasOwn(framePanel.manifest.state, key)) {
      throw new HttpError(400, `Unknown rowContext.frameState.${key}`, "PANEL_STATE_INVALID");
    }
  }
  const resolved: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(framePanel.manifest.state)) {
    if (rawFrameState && Object.hasOwn(rawFrameState, key)) {
      const value = rawFrameState[key];
      if (!matchesDirectPanelValue(field.type, value)) {
        throw new HttpError(400, `Invalid rowContext.frameState.${key}`, "PANEL_STATE_INVALID");
      }
      resolved[key] = value;
    } else if (field.default !== undefined) {
      resolved[key] = field.default;
    }
  }
  return resolved;
}

function resolveEntryControlledInputs(
  entry: ApplicationPanelUse,
  targetPanel: Pick<ProductPanel, "manifest">,
  frameStateValues: Readonly<Record<string, unknown>>,
): { controlled: Set<string>; values: Record<string, unknown> } {
  const controlled = new Set<string>(Object.keys(entry.inputs ?? {}));
  const values: Record<string, unknown> = {};
  for (const [name, ref] of Object.entries(entry.inputs ?? {})) {
    const field = targetPanel.manifest.state[name];
    if ("literal" in ref) {
      values[name] = ref.literal;
      continue;
    }
    if (Object.hasOwn(frameStateValues, ref.frameState)) {
      const value = frameStateValues[ref.frameState];
      if (field && !matchesDirectPanelValue(field.type, value)) {
        throw new HttpError(400, `Invalid rowContext.frameState.${ref.frameState}`, "PANEL_STATE_INVALID");
      }
      values[name] = value;
    }
  }
  return { controlled, values };
}

async function resolvePlacementState(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  root: ProductPanel,
  trail: readonly ResolvedPanelPathStep[],
  placementPanel: Pick<ProductPanel, "manifest">,
  use: ApplicationPanelUse,
  rowContext: PanelOperationRowContext | undefined,
  options: Pick<DeclaredDirectOperationOptions, "framePanel" | "framePanelId" | "isFrameRoot">,
): Promise<Record<string, unknown>> {
  let framePanel: Pick<ProductPanel, "manifest"> | undefined = options.isFrameRoot ? root : options.framePanel;
  if (!framePanel && options.framePanelId !== undefined) {
    const needsFrameDefaults = Object.values(use.inputs ?? {}).some(
      ref => "frameState" in ref && !Object.hasOwn(rowContext?.frameState ?? {}, ref.frameState),
    );
    if (needsFrameDefaults) {
      framePanel = await readCurrentPanelRecord(owner, credentials, options.framePanelId);
    }
  }
  const frameStateValues = resolveFrameStateValues(framePanel, rowContext);

  let currentControlled: Set<string>;
  let currentState: Record<string, unknown>;
  if (options.isFrameRoot) {
    currentControlled = new Set<string>();
    currentState = { ...frameStateValues };
  } else {
    ({ controlled: currentControlled, values: currentState } = resolveEntryControlledInputs(use, root, frameStateValues));
  }

  for (const { parentPanel, childPanel, member, selection } of trail) {
    for (const [key, field] of Object.entries(parentPanel.manifest.state)) {
      if (!Object.hasOwn(currentState, key) && field.default !== undefined) {
        currentState[key] = field.default;
      }
    }
    if ("fromState" in member.target && selection && "stateValue" in selection) {
      const stateKey = member.target.fromState;
      if (currentControlled.has(stateKey)) {
        if (Object.hasOwn(currentState, stateKey) && !isDeepStrictEqual(currentState[stateKey], selection.stateValue)) {
          throw new HttpError(403, "Nested member selection does not match controlled state", "PANEL_MEMBER_FORBIDDEN");
        }
      } else {
        currentState[stateKey] = selection.stateValue;
      }
    }
    if ("fromPlatform" in member.target) {
      ({ controlled: currentControlled, values: currentState } = resolveEntryControlledInputs(use, childPanel, currentState));
    } else {
      const nextControlled = new Set<string>(Object.keys(member.inputs ?? {}));
      const nextState: Record<string, unknown> = {};
      for (const [childKey, wire] of Object.entries(member.inputs ?? {})) {
        if ("literal" in wire) {
          nextState[childKey] = wire.literal;
        } else if ("state" in wire && Object.hasOwn(currentState, wire.state)) {
          nextState[childKey] = currentState[wire.state];
        }
      }
      currentControlled = nextControlled;
      currentState = nextState;
    }
  }

  for (const key of Object.keys(rowContext?.state ?? {})) {
    if (!Object.hasOwn(placementPanel.manifest.state, key)) {
      throw new HttpError(400, `Unknown rowContext.state.${key}`, "PANEL_STATE_INVALID");
    }
  }

  const finalState: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(placementPanel.manifest.state)) {
    if (currentControlled.has(key)) {
      // Controlled inputs (entry.inputs / parent panel wiring) always take precedence; rowContext.state must never override them.
      if (Object.hasOwn(currentState, key)) {
        finalState[key] = currentState[key];
      } else if (field.default !== undefined) {
        finalState[key] = field.default;
      }
    } else if (rowContext?.state && Object.hasOwn(rowContext.state, key)) {
      const value = rowContext.state[key];
      if (!matchesDirectPanelValue(field.type, value)) {
        throw new HttpError(400, `Invalid rowContext.state.${key}`, "PANEL_STATE_INVALID");
      }
      finalState[key] = value;
    } else if (field.default !== undefined) {
      finalState[key] = field.default;
    }
  }
  return finalState;
}

function buildHostListInputs(
  hostProjection: ProductProjection,
  hostMember: PanelMember,
  hostDatum: DirectProjectionData,
  placementState: Readonly<Record<string, unknown>>,
): Record<string, RuntimeJsonValue> {
  const inputs: Record<string, RuntimeJsonValue> = {};
  for (const [name, wire] of Object.entries(hostMember.inputs ?? {})) {
    if ("literal" in wire) {
      inputs[name] = wire.literal;
    } else if ("state" in wire && Object.hasOwn(placementState, wire.state)) {
      inputs[name] = placementState[wire.state] as RuntimeJsonValue;
    }
  }
  const declaration = directReadDeclaration(hostProjection, hostDatum);
  if (declaration) {
    for (const [name, ref] of Object.entries(hostMember.outputs ?? {})) {
      if (Object.hasOwn(inputs, name) || Object.hasOwn(hostDatum.params, name)) continue;
      if (panelReadParameterId(declaration, name) && Object.hasOwn(placementState, ref.state)) {
        inputs[name] = placementState[ref.state] as RuntimeJsonValue;
      }
    }
  }
  return inputs;
}

async function resolveHostListRow(
  owner: ProductOwner,
  credentials: AssistantCredentials,
  placement: Placement,
  hostSlot: string,
  hostMember: PanelMember,
  hostProjection: ProductProjection,
  hostDatumName: "objects" | "rows",
  itemKey: PanelMemberItemKey,
  placementState: Readonly<Record<string, unknown>>,
  rowContext: PanelOperationRowContext | undefined,
  hostReadActor?: DeclaredDirectOperationOptions["hostReadActor"],
): Promise<{ row: PanelRecord; fallbackClassName?: string }> {
  const hostDatum = hostProjection.data[hostDatumName];
  const hostDeclaration = directReadDeclaration(hostProjection, hostDatum);
  if (!hostDeclaration || !["panelRecordList", "panelRecordQuery", "panelOntologyObjects"].includes(hostDeclaration.result)) {
    throw new HttpError(422, `Host member '${hostSlot}' does not declare a list read`, "ROW_OPERATION_HOST_INVALID");
  }
  const hostInputs = buildHostListInputs(hostProjection, hostMember, hostDatum, placementState);
  const reader = hostReadActor ?? { owner, credentials };
  let outcome: Awaited<ReturnType<typeof executeProjectionDataRead>>;
  try {
    outcome = await executeProjectionDataRead(
      reader.owner,
      reader.credentials,
      { member: hostMember, projection: hostProjection, slot: hostSlot },
      hostDatumName,
      hostInputs,
      rowContext?.runtimeParams,
      reader.callerUserName,
    );
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 401 || error.status === 403) {
        throw new HttpError(403, error.message, error.code || "HOST_LIST_FORBIDDEN");
      }
      if (error.status === 400 || error.status === 422) throw error;
      throw new HttpError(422, error.message, "HOST_LIST_UNAVAILABLE");
    }
    if (error instanceof BackendUnavailableError) {
      throw new HttpError(422, error.message, "HOST_LIST_UNAVAILABLE");
    }
    if (error instanceof z.ZodError) {
      throw new HttpError(400, error.issues[0]?.message ?? "Invalid host list read parameters", "INVALID_REQUEST");
    }
    throw error;
  }

  let records: readonly PanelRecord[];
  let fallbackClassName: string | undefined;
  if (outcome.declaration.result === "panelOntologyObjects") {
    const response = outcome.status === "ready" ? (outcome.value as PlatformOntologyObjectsResponse) : undefined;
    if (!response) {
      throw new HttpError(422, "Host list read returned no ontology objects response", "HOST_LIST_UNAVAILABLE");
    }
    if (response.status === "refused") {
      throw new HttpError(403, response.reason ?? "Host list read was refused", "HOST_LIST_FORBIDDEN");
    }
    if (response.status !== "ok") {
      throw new HttpError(422, response.reason ?? `Host list read ${response.status}`, "HOST_LIST_UNAVAILABLE");
    }
    records = response.items.map((item): PanelRecord => ({
      primaryKey: item.node.primaryKey,
      className: item.node.className,
      label: item.label,
      ...(item.detail !== undefined && { subtitle: item.detail }),
      fields: item.detail !== undefined ? { detail: item.detail } : {},
    }));
    fallbackClassName = response.type;
  } else if (outcome.declaration.result === "panelRecordQuery") {
    records = outcome.status === "ready" ? (outcome.value as PanelRecordQuery).rows : [];
    fallbackClassName = hostDatumFallbackClassName(hostProjection, hostDatum.source);
  } else {
    records = outcome.status === "ready" ? (outcome.value as PanelRecord[]) : [];
    fallbackClassName = hostDatumFallbackClassName(hostProjection, hostDatum.source);
  }

  const matched = records.filter(record => matchPanelRecordItemKey(record, itemKey, fallbackClassName));
  if (matched.length === 0) {
    throw new HttpError(404, "Target row was not found in the host list", "ROW_OPERATION_ROW_NOT_FOUND");
  }
  if (matched.length > 1) {
    throw new HttpError(422, "Row itemKey matched multiple rows; supply {className, primaryKey}", "ROW_OPERATION_ROW_AMBIGUOUS");
  }
  return { row: matched[0]!, fallbackClassName };
}

function resolveRowOperationTarget(
  placement: Placement,
  bound: BoundProjectionOperation,
  id: string,
  resolvedInputs: Readonly<Record<string, unknown>>,
  supplied: PanelOperationTarget | null | undefined,
  locale?: string,
): PanelOperationTarget | null {
  const { projection, member, slot } = placement;
  const { binding, owner } = bound;
  const { target } = binding;
  let resolvedTarget: PanelOperationTarget | null;

  if (!target) {
    if (owner?.handler.kind === "form.save" && allowsOperationDraft(projection, owner.handler)) {
      resolvedTarget = supplied?.kind === "draft" ? supplied : { kind: "draft" };
    } else {
      resolvedTarget = null;
    }
  } else if ("literal" in target) {
    resolvedTarget = placedObject(target.literal);
  } else {
    const { input } = target;
    const wire = member.inputs?.[input];
    const port = projection.inputs[input];
    if (!wire) {
      throw new HttpError(
        422,
        tForLocale(locale, "panels.operation.targetInputUnbound", { operation: binding.operation.id, member: slot, input }),
        "PANEL_OPERATION_TARGET_UNBOUND",
      );
    }
    const raw = resolvedInputs[input];
    if (raw === undefined || raw === null) {
      if (owner?.handler.kind === "form.save" && allowsOperationDraft(projection, owner.handler)) {
        resolvedTarget = supplied?.kind === "draft" ? supplied : { kind: "draft" };
      } else {
        throw new HttpError(422, `Row operation '${id}' could not resolve target input '${input}'`, "ROW_OPERATION_TARGET_UNAVAILABLE");
      }
    } else {
      const parsedRef = panelObjectRefSchema.safeParse(raw);
      if (!parsedRef.success) {
        throw new HttpError(422, `Row operation '${id}' target input '${input}' is not a valid object reference`, "ROW_OPERATION_INPUT_INVALID");
      }
      if ((port?.kind === "object" || port?.kind === "object-union") && !matchesObjectType(port, parsedRef.data.className)) {
        throw new HttpError(422, `Row operation '${id}' target type '${parsedRef.data.className}' does not match port '${input}'`, "PANEL_OPERATION_TARGET_MISMATCH");
      }
      resolvedTarget = placedObject(parsedRef.data);
    }
  }

  if (supplied !== undefined && !isDeepStrictEqual(supplied, resolvedTarget)) {
    throw new HttpError(403, "Operation target does not match the resolved row target", "TARGET_ID_MISMATCH");
  }
  return resolvedTarget;
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
  if ((port?.kind !== "object" && port?.kind !== "object-union" && port?.kind !== "list") ||
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
  if ((port.kind === "object" || port.kind === "object-union") && selected?.kind === "object" && !matchesObjectType(port, selected.objectType))
    throw new HttpError(400, "Operation target does not match this panel member", "TARGET_ID_MISMATCH");
  return { descriptor: { source: "input" as const, input }, fixed, selected };
}

async function admitBoundOperation(actor: PanelOperationActor, placement: Placement, bound: BoundProjectionOperation, selection: Selection) {
  assertListColumnHasNoData(placement.member, placement.projection);
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
  assertListColumnHasNoData(placement.member, placement.projection);
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
    const unavailableReason = result.effect === "write" && result.selected?.kind === "object"
      ? await result.handler.unavailable?.(operationHost(actor), result.selected) : undefined;
    const descriptor = unavailableReason === undefined ? result.descriptor
      : { ...result.descriptor, unavailable: panelOperationUnavailableSchema.parse(unavailableReason) };
    descriptions.push([bound.name, descriptor]);
  }
  return Object.fromEntries(descriptions);
}

export async function declaredDirectOperation(
  owner: ProductOwner, credentials: AssistantCredentials, use: ApplicationPanelUse, panel: ProductPanel, id: string,
  target?: PanelOperationTarget | null, memberPath?: PanelMemberPath, options: DeclaredDirectOperationOptions = {},
) {
  const mode = options.mode ?? "describe";
  const separator = id.lastIndexOf(".");
  if (separator < 1) return unavailable(id);
  const name = id.slice(separator + 1);
  const slot = memberPath?.at(-1)?.member ?? id.slice(0, separator);
  if (id !== panelOperationId(memberPath?.map(segment => segment.member) ?? slot, name)) return unavailable(id);
  let placement: Placement;
  let trail: readonly ResolvedPanelPathStep[] = [];
  if (memberPath) {
    const resolved = await resolvePanelMemberPath(owner, credentials, panel, memberPath, use, undefined, {
      allowTerminalItemKey: true,
    });
    if (resolved.kind !== "projection") return unavailable(id);
    placement = { ...resolved, slot, nested: { memberPath, publisherPanelId: resolved.panel.id } };
    trail = resolved.trail;
  } else {
    placement = { ...await requireDirectPanelMember(owner, credentials, panel, slot), panel, slot };
  }
  assertListColumnHasNoData(placement.member, placement.projection);
  const bound = boundProjectionOperations(placement.projection).find(entry => entry.name === name);
  if (!bound) return unavailable(id);

  const terminalItemKey = memberPath?.at(-1)?.itemKey;
  const attachment = listAttachmentOf(placement.member);
  if (terminalItemKey !== undefined) {
    if (!attachment) {
      throw new HttpError(422, `Member '${slot}' is not a listColumn or listRowDetail member`, "ROW_OPERATION_MEMBER_INVALID");
    }
    const hostSlot = attachment.slot;
    const { member: hostMember, projection: hostProjection } = await requireDirectPanelMember(owner, credentials, placement.panel, hostSlot);
    const hostDatumName = objectListDatumName(hostProjection);
    if (hostDatumName === null) {
      throw new HttpError(422, `Host member '${hostSlot}' does not declare a list datum ('objects' or 'rows')`, "ROW_OPERATION_HOST_INVALID");
    }
    if (mode === "prepare") {
      const placementState = await resolvePlacementState(
        owner, credentials, panel, trail, placement.panel, use, options.rowContext, options,
      );
      const { row, fallbackClassName } = await resolveHostListRow(
        owner, credentials, placement, hostSlot, hostMember, hostProjection, hostDatumName,
        terminalItemKey, placementState, options.rowContext, options.hostReadActor,
      );
      const resolvedInputs = resolveRowMemberInputs(placement.projection, placement.member, placementState, row, fallbackClassName);
      const resolvedTarget = resolveRowOperationTarget(placement, bound, id, resolvedInputs, target, credentials.locale);
      const boundParams = resolveRowBoundParams(placement.member, bound.binding, resolvedInputs);
      const current = await admitBoundOperation({ owner, credentials }, placement, bound, () => resolvedTarget);
      if (!current) throw new HttpError(400, `Select an eligible target for operation '${id}'`, "PANEL_SELECTION_REQUIRED");
      if (current.effect === "read") return { ...current, boundParams };
      return {
        ...current,
        fixedTarget: resolvedTarget,
        resolvedTarget,
        boundParams,
        use,
        projection: { id: placement.projection.id, binding: current.handler.binding },
      };
    }
    // Dispatch or describe: verify the row member and host list binding remain authorized without depending on volatile pagination.
    const boundParams = resolveStaticBoundParams(placement.member, bound.binding);
    const current = await admitBoundOperation({ owner, credentials }, placement, bound, () => target);
    if (!current) throw new HttpError(400, `Select an eligible target for operation '${id}'`, "PANEL_SELECTION_REQUIRED");
    if (current.effect === "read") return { ...current, boundParams };
    return {
      ...current,
      resolvedTarget: undefined as PanelOperationTarget | null | undefined,
      boundParams,
      use,
      projection: { id: placement.projection.id, binding: current.handler.binding },
    };
  }

  if ((mode === "prepare" || mode === "read") && operationDependsOnRowInput(placement.member, bound.binding)) {
    throw new HttpError(422, `Row operation '${id}' requires memberPath with itemKey`, "ROW_OPERATION_ITEM_KEY_REQUIRED");
  }
  const boundParams = resolveStaticBoundParams(placement.member, bound.binding);
  const current = await admitBoundOperation({ owner, credentials }, placement, bound, () => target);
  if (!current) throw new HttpError(400, `Select an eligible target for operation '${id}'`, "PANEL_SELECTION_REQUIRED");
  if (current.effect === "read") return { ...current, boundParams };
  return {
    ...current,
    resolvedTarget: undefined as PanelOperationTarget | null | undefined,
    boundParams,
    use,
    projection: { id: placement.projection.id, binding: current.handler.binding },
  };
}
