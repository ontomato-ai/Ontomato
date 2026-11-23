import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import {
  isHostMountedPanelMember,
  matchesDirectPanelValue,
  type PanelManifest,
  type PanelMember,
  type PanelMemberItemKey,
  type PanelOperationRowContext,
} from "@ontomato/contracts/panel-manifest";
import {
  panelRecordObjectRef,
  type PanelRecord,
} from "@ontomato/contracts/panel-projection";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import type { MemberInputs } from "./direct";
import type { PanelInstance, PublisherPath } from "./instance";
import type { PanelFieldValue } from "./state";

/**
 * Whether a panel member is mounted per row by a host `ObjectList` (`listColumn` or `listRowDetail`).
 * Uses the contract's `isHostMountedPanelMember` helper while keeping `formField` members on their existing path.
 */
export function isListAttachedPanelMember(
  member: Pick<PanelMember, "formField" | "listColumn" | "listRowDetail"> | undefined,
): boolean {
  return Boolean(member && isHostMountedPanelMember(member) && member.formField === undefined);
}

/** Column key -> member key map for every `listColumn` member attached to `hostSlot`. */
export function listColumnMembersFor(manifest: PanelManifest, hostSlot: string): ReadonlyMap<string, string> {
  const columns = new Map<string, string>();
  for (const [memberKey, member] of Object.entries(manifest.members)) {
    if (member.listColumn?.slot === hostSlot) {
      columns.set(member.listColumn.column, memberKey);
    }
  }
  return columns;
}

/** Member key of the `listRowDetail` member attached to `hostSlot`, or null when none is declared. */
export function listRowDetailMemberFor(manifest: PanelManifest, hostSlot: string): string | null {
  for (const [memberKey, member] of Object.entries(manifest.members)) {
    if (member.listRowDetail?.slot === hostSlot) return memberKey;
  }
  return null;
}

function cloneJsonValue<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item)) as T;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneJsonValue(v)])) as T;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Unwrap a single field value from `row.fields[fieldKey]` using the same rules as the server's
 * `resolveRowFieldValue`, returning `undefined` when the field is absent or incompatible with the port.
 */
export function resolveRowFieldValue(
  row: Pick<PanelRecord, "fields">,
  fieldKey: string,
  port: DirectProjection["inputs"][string] | undefined,
): RuntimeJsonValue | undefined {
  if (!Object.hasOwn(row.fields, fieldKey)) return undefined;
  const raw = row.fields[fieldKey];
  if (!port) return cloneJsonValue(raw) as RuntimeJsonValue;
  if (port.kind === "json") {
    if (isRecordObject(raw) && raw.kind === "json" && "value" in raw) {
      return cloneJsonValue(raw.value) as RuntimeJsonValue;
    }
    return cloneJsonValue(raw) as RuntimeJsonValue;
  }
  if (port.kind === "object" || port.kind === "object-union") {
    const candidate = isRecordObject(raw) && "kind" in raw
      ? raw.kind === "reference"
        ? { className: raw.className, primaryKey: raw.primaryKey }
        : raw.kind === "json" && "value" in raw ? raw.value : raw
      : raw;
    if (!matchesDirectPanelValue(port, candidate)) return undefined;
    return cloneJsonValue(candidate) as RuntimeJsonValue;
  }
  const candidate = isRecordObject(raw) && raw.kind === "json" && "value" in raw ? raw.value : raw;
  if (!matchesDirectPanelValue(port, candidate)) return undefined;
  return cloneJsonValue(candidate) as RuntimeJsonValue;
}

/**
 * Resolve ONLY the inputs explicitly declared in `member.inputs` for one row of a host `ObjectList`.
 * Mirrors the server's `resolveRowMemberInputs`: never exposes the full row object, undeclared fields,
 * or undeclared panel state to the mounted row component.
 */
export function resolveRowMemberInputs(
  projection: Pick<DirectProjection, "inputs">,
  member: Pick<PanelMember, "inputs">,
  placementState: Readonly<Record<string, PanelFieldValue>>,
  row: Pick<PanelRecord, "primaryKey" | "className" | "label" | "fields">,
  hostFallbackClassName: string | undefined,
): MemberInputs {
  const resolved: Record<string, RuntimeJsonValue> = {};
  for (const [inputName, wire] of Object.entries(member.inputs ?? {})) {
    const port = projection.inputs[inputName];
    if ("literal" in wire) {
      resolved[inputName] = cloneJsonValue(wire.literal);
    } else if ("state" in wire) {
      resolved[inputName] = cloneJsonValue((placementState[wire.state] ?? null) as RuntimeJsonValue);
    } else if ("item" in wire) {
      if (wire.item === true) {
        if (row.className === undefined && !hostFallbackClassName) continue;
        const ref = panelRecordObjectRef(row, hostFallbackClassName);
        if (port && port.kind !== "json" && !matchesDirectPanelValue(port, ref)) continue;
        resolved[inputName] = ref;
      } else {
        const scalar = wire.item === "primaryKey" ? row.primaryKey : row.label;
        if (port && port.kind !== "json" && !matchesDirectPanelValue(port, scalar)) continue;
        resolved[inputName] = scalar;
      }
    } else {
      const value = resolveRowFieldValue(row, wire.itemField, port);
      if (value !== undefined) resolved[inputName] = value;
    }
  }
  return resolved;
}

/**
 * Extract only the projection inputs referenced as operation targets for `operations: true` reads.
 * Keeps row operation admission reads dedupable across rows that share the same outer target (such as
 * a parent Application from panel state) while still reading per-row availability when targeting `{ item: true }`.
 */
export function rowOperationTargetInputs(
  projection: Pick<DirectProjection, "inputs" | "operations">,
  inputs: MemberInputs,
): MemberInputs {
  const targetInputs: Record<string, RuntimeJsonValue> = {};
  for (const binding of Object.values(projection.operations ?? {})) {
    if (binding.target && "input" in binding.target && Object.hasOwn(inputs, binding.target.input)) {
      targetInputs[binding.target.input] = inputs[binding.target.input]!;
    }
  }
  return targetInputs;
}

/** Attach `itemKey` to the final segment of a member path while preserving all ancestor segments. */
export function buildRowMemberPath(basePath: PublisherPath, itemKey: PanelMemberItemKey): PublisherPath {
  const terminal = { ...basePath.at(-1)!, itemKey };
  if (basePath.length === 1) return [terminal];
  const [first, ...middle] = basePath.slice(0, -1);
  return [first!, ...middle, terminal];
}

/**
 * Build the read-only `rowContext` payload sent alongside a row-scoped write intent so the server can
 * replay the host list read and recompute the authoritative row target and bound parameters.
 */
export function buildRowOperationContext(
  instance: Pick<PanelInstance, "manifest" | "state">,
  hostRuntimeParams: Readonly<Record<string, RuntimeJsonValue>>,
  frameState?: Readonly<Record<string, RuntimeJsonValue>>,
): PanelOperationRowContext {
  const stateValues: Record<string, RuntimeJsonValue> = {};
  for (const key of Object.keys(instance.manifest.state)) {
    const value = instance.state.values.value[key];
    if (value !== undefined) {
      stateValues[key] = cloneJsonValue(value as RuntimeJsonValue);
    }
  }
  const context: PanelOperationRowContext = {};
  if (Object.keys(stateValues).length > 0) context.state = stateValues;
  if (frameState && Object.keys(frameState).length > 0) {
    context.frameState = cloneJsonValue(frameState) as Record<string, RuntimeJsonValue>;
  }
  if (Object.keys(hostRuntimeParams).length > 0) {
    context.runtimeParams = cloneJsonValue(hostRuntimeParams) as Record<string, RuntimeJsonValue>;
  }
  return context;
}

/**
 * Ensure a row component cannot override any parameter bound by `projection.operations[name].params`.
 * Returns a plain shallow copy of the allowed caller inputs.
 */
export function assertNoBoundParamOverride(
  projection: Pick<DirectProjection, "operations">,
  operationName: string,
  input?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const binding = projection.operations?.[operationName];
  if (!binding) {
    throw new Error(`Operation '${operationName}' is not declared by this projection`);
  }
  const boundParams = binding.params;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (boundParams && Object.hasOwn(boundParams, key)) {
      throw new Error(`Operation parameter '${key}' is bound by the panel member and cannot be overridden`);
    }
    sanitized[key] = value;
  }
  return sanitized;
}
