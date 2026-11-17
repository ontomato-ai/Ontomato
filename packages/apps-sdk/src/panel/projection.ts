import {
  panelOperationId,
  type OntologyParameterType,
  type PanelManifest,
  type PanelOperation,
} from "@ontomato/contracts/panel-manifest";
import type { PanelFieldValue } from "./state";

/*
 * What a projection offers the panel it is placed in, and therefore what the panel contains (overall design 3.2, 3.4,
 * "projection registration"). A projection's component and its SDK client say which operations it publishes and what
 * they take; the panel does not say that again. Declaring the projection in a slot is enough for the SDK to describe its
 * operations and to reach them, so nothing is scanned out of the HTML and no renderer is guessed from a name.
 */

/** An operation a projection publishes: its own name, what it takes, and the SDK client operation it is. */
export interface ProjectionOperation {
  /** The operation's name within this projection, such as `runNow` or `update`. */
  name: string;
  label: string;
  kind: PanelOperation["kind"];
  /** Its own business inputs, by name; these are not the panel's state. */
  inputSchema: Readonly<Record<string, OntologyParameterType>>;
  /** The SDK client operation this is, such as `schedules.runNow`; a registered handler, never a URL. */
  handlerRef: string;
}

/** The endpoints a projection publishes: what it binds, what it accepts and what it can do. */
export interface ProjectionPorts {
  /** The ontology element it binds, as `Kind:id`: `Action:<id>`, `PlatformObjectType:platform:ScheduledTask`. */
  binding: string;
  /** The parameters it accepts, by name; a slot's inputs fill these. */
  inputs: Readonly<Record<string, OntologyParameterType>>;
  operations: readonly ProjectionOperation[];
}

/**
 * One projection registered in one panel instance: the slot it fills, what its component publishes, and how to run one
 * of its operations here.
 */
export interface PanelProjectionRegistration {
  slot: string;
  projectionId: string;
  ports: ProjectionPorts;
  /** Runs one operation in this frame; the projection's own client makes the request with the person's credential. */
  invoke(handlerRef: string, input?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/** The operations a registered projection publishes, described for the panel and the agent. */
export function projectionOperations(
  manifest: PanelManifest,
  registration: Pick<PanelProjectionRegistration, "slot" | "ports">,
): PanelOperation[] {
  const slot = manifest.slots[registration.slot];
  if (!slot) throw new Error(`The panel declares no slot '${registration.slot}'`);
  const target = projectionTarget(registration, slot.inputs);
  return registration.ports.operations.map((operation) => ({
    id: panelOperationId(registration.slot, operation.name),
    label: operation.label,
    kind: operation.kind,
    inputSchema: { ...operation.inputSchema },
    target,
    slot: registration.slot,
    handlerRef: operation.handlerRef,
  }));
}

/**
 * The object a projection's operations act on: the state field its first object-typed input is filled from, so the
 * reader's current selection is the target. A form that creates an object fills no object-typed input from the panel's
 * state, so its operations address the draft's own target.
 */
function projectionTarget(
  registration: Pick<PanelProjectionRegistration, "slot" | "ports">,
  inputs: Readonly<Record<string, { state: string }>>,
): PanelOperation["target"] {
  const [state] = Object.entries(inputs).find(([input]) => registration.ports.inputs[input]?.kind === "object") ?? [];
  return state ? { source: "state", state: inputs[state]!.state } : { source: "draft", slot: registration.slot };
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
export function slotInputValues(
  manifest: PanelManifest,
  slot: string,
  values: Readonly<Record<string, PanelFieldValue>>,
): Record<string, PanelFieldValue> {
  const declaration = manifest.slots[slot];
  if (!declaration) throw new Error(`The panel declares no slot '${slot}'`);
  return Object.fromEntries(
    Object.entries(declaration.inputs).map(([input, ref]) => [input, values[ref.state] ?? null]),
  );
}
