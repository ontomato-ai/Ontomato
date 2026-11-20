import { type PanelManifest, type PanelOperation, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { ProjectionPorts } from "@ontomato/contracts/panel-projection";
import { stateObject, stateObjects, type PanelFieldValue } from "./state";
import type { PanelWriteInvocation } from "./human-operations";
import type { MemberOperations } from "./member-operations";

export type { ProjectionPorts } from "@ontomato/contracts/panel-projection";

/*
 * What a projection offers the panel it is placed in, and therefore what the panel contains (overall design 3.2, 3.4,
 * "projection registration"): the element it binds, the parameters it takes, and the operations its record names, as
 * their owners admit them now. A panel's declaration names the projection and never its ports, so nothing is scanned out
 * of the HTML and no operation is guessed from a component.
 */

/** One projection registered in one panel instance: the slot it fills and what it offers. */
export interface PanelProjectionRegistration {
  slot: string;
  projectionId: string;
  ports: ProjectionPorts;
  /** The operations its record names, as the owners admit them now, by local name: what the header and an agent list. */
  readonly operations: MemberOperations;
  /** Whether it reads an owner's form, which a draft is offered to. */
  takesDrafts: boolean;
}

/** The values a slot passes its projection now, by the parameter each fills; a field with no value passes null. */
/**
 * What one operation of a projection does now: the object its declaration's target names, with the values the caller
 * supplies. A target that holds no object (nothing selected yet) and a state operation's (which has none) are `null`, and
 * the handler decides whether that is a refusal.
 */
export function operationCall(
  operation: PanelOperation,
  state: Readonly<Record<string, PanelFieldValue>>,
  input: Readonly<Record<string, unknown>> = {},
): PanelOperationCall {
  return { target: operationTarget(operation, state), input };
}

/**
 * What one write of a projection sends now: one call on the object its target names, or, when the target is a list the
 * panel holds (the checked objects), one batch with a call per object, in the list's order. A batch of nothing is no
 * write, and is refused here.
 */
export function operationInvocation(
  operation: PanelOperation,
  state: Readonly<Record<string, PanelFieldValue>>,
  input: Readonly<Record<string, unknown>> = {},
): PanelWriteInvocation {
  const held = operation.target?.source === "state" ? state[operation.target.state] : undefined;
  if (!Array.isArray(held)) return { call: operationCall(operation, state, input) };
  const [first, ...rest] = stateObjects(held).map(({ className, primaryKey }) =>
    ({ target: { kind: "object" as const, objectType: className, primaryKey }, input: { ...input } }));
  if (!first) throw new Error(`Operation '${operation.id}' acts on the checked objects, and none is checked`);
  return { calls: [first, ...rest] };
}

function operationTarget(
  operation: PanelOperation,
  state: Readonly<Record<string, PanelFieldValue>>,
): PanelOperationCall["target"] {
  if (!operation.target || operation.target.source === "none") return null;
  if (operation.target.source === "draft") return { kind: "draft" };
  if (operation.target.source === "literal") {
    const { className, primaryKey } = operation.target.literal;
    return { kind: "object", objectType: className, primaryKey };
  }
  const value = stateObject(state[operation.target.state]);
  return value && { kind: "object", objectType: value.className, primaryKey: value.primaryKey };
}

export function slotInputValues(
  manifest: PanelManifest,
  slot: string,
  values: Readonly<Record<string, PanelFieldValue>>,
): Record<string, PanelFieldValue> {
  const declaration = manifest.members[slot];
  if (!declaration) throw new Error(`The panel declares no member '${slot}'`);
  const inputs = Object.entries(declaration.inputs ?? {}).map(([input, source]) => {
    if ("state" in source) return [input, values[source.state] ?? null] as const;
    if ("literal" in source) return [input, source.literal as PanelFieldValue] as const;
    throw new Error(`Member '${slot}' fills '${input}' from a repeated item, which this SDK release does not place`);
  });
  // An output bound to a state reads that state back as the input of the same name.
  const outputs = Object.entries(declaration.outputs ?? {}).filter(([name]) => !Object.hasOwn(declaration.inputs ?? {}, name))
    .map(([name, { state }]) => [name, values[state] ?? null] as const);
  return Object.fromEntries([...inputs, ...outputs]);
}
