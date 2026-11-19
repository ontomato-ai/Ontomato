import { type PanelManifest, type PanelOperation, type PanelOperationCall } from "@ontomato/contracts/panel-manifest";
import type { ProjectionPorts } from "@ontomato/contracts/panel-projection";
import type { PanelFieldValue } from "./state";

export type { ProjectionOperation, ProjectionPorts } from "@ontomato/contracts/panel-projection";

/*
 * What a projection offers the panel it is placed in, and therefore what the panel contains (overall design 3.2, 3.4,
 * "projection registration"): the element it binds, the parameters it takes, the operations it publishes and the handler
 * reference each one is. All of it comes from the projection's record and this SDK version's catalogue; a panel's
 * declaration names the projection and never its ports, so nothing is scanned out of the HTML and no renderer is guessed
 * from a name.
 */

/** One projection registered in one panel instance: the slot it fills and what its component publishes. */
export interface PanelProjectionRegistration {
  slot: string;
  projectionId: string;
  ports: ProjectionPorts;
}

/**
 * What a panel contains, as its declaration alone says (overall design 3.3): every slot's projection, in declaration
 * order. The graph reads this instead of the HTML, which is why a slot that is not drawn yet is still here.
 */
export function panelContains(manifest: PanelManifest) {
  return Object.entries(manifest.slots).map(([slot, declaration]) => ({
    slot,
    projectionId: declaration.projectionId,
    inputs: Object.fromEntries(Object.entries(declaration.inputs).map(([input, ref]) => [input, ref.state])),
  }));
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

function operationTarget(
  operation: PanelOperation,
  state: Readonly<Record<string, PanelFieldValue>>,
): PanelOperationCall["target"] {
  if (!operation.target) return null;
  if (operation.target.source === "draft") return { kind: "draft" };
  const value = state[operation.target.state];
  if (!value || typeof value !== "object") return null;
  return { kind: "object", objectType: value.className, primaryKey: value.primaryKey };
}

export function slotInputValues(
  manifest: PanelManifest,
  slot: string,
  values: Readonly<Record<string, PanelFieldValue>>,
): Record<string, PanelFieldValue> {
  const declaration = manifest.slots[slot];
  if (!declaration) throw new Error(`The panel declares no slot '${slot}'`);
  return Object.fromEntries(Object.entries(declaration.inputs).map(([input, ref]) => [input, values[ref.state] ?? null]));
}
