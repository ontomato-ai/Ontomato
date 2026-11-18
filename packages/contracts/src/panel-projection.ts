import { z } from "zod";
import { bindingKey } from "./panel-client-requests";
import { ontologyParameterTypeSchema, panelOperationId, type OntologyParameterType, type PanelManifest, type PanelOperation, type PanelStateOperation } from "./panel-manifest";
import type { ProductProjectionInput } from "./product-panels";

/** Operation metadata declared by a component of the SDK. */
export const componentOperationSchema = z.object({
  client: z.string(),
  name: z.string(),
  label: z.string(),
  kind: z.enum(["form.save", "action"]),
  inputSchema: z.record(ontologyParameterTypeSchema),
});
export type ComponentOperation = Readonly<z.infer<typeof componentOperationSchema>>;
interface ComponentOperationMetadata {
  readonly operations?: readonly ComponentOperation[];
}
type Projection = Pick<ProductProjectionInput, "name" | "binding" | "inputs">;

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

/*
 * A projection record's ports (overall design 3.1, 3.2): what it binds comes from the record, what it takes from the
 * record, and the operations it publishes from this SDK version's catalogue entry for its component.
 *
 * A record bound to a `PlatformOperation` publishes that operation, which is how "run now" is a button: the binding names
 * the operation, its label comes from the catalogue when a component declares it, and its handler is the reference the
 * binding is. Nothing here is written by a panel.
 */
export function projectionPorts(projection: Projection, meta: ComponentOperationMetadata): ProjectionPorts {
  const binding = bindingKey(projection.binding);
  if (projection.binding.kind === "PlatformOperation")
    return { binding, inputs: projection.inputs, operations: [boundOperation(projection, meta)] };
  // A component that saves through the owner of the type it binds names `@binding`; every other operation names its own
  // client. Either way the reference is one this version registered.
  const client = (name: string) => (name === "@binding" ? projection.binding.id : name);
  const declared: ProjectionOperation[] = (meta.operations ?? []).map((operation) => ({
    name: operation.name,
    label: operation.label,
    kind: operation.kind,
    inputSchema: operation.inputSchema,
    handlerRef: `${client(operation.client)}.${operation.name}`,
  }));
  return { binding, inputs: projection.inputs, operations: declared };
}

/** The one operation a record bound to a platform operation publishes: the operation the record names. */
function boundOperation(projection: Projection, meta: ComponentOperationMetadata): ProjectionOperation {
  const ref = projection.binding.id;
  const declared = meta.operations?.find(
    (operation) => `${operation.client}.${operation.name}` === ref,
  );
  return {
    name: ref.split(".").pop()!,
    // A component that declares the operation names it; otherwise the projection's own name is what a reader sees on the
    // button, because that is the word its author gave it.
    label: declared?.label ?? projection.name,
    kind: declared?.kind ?? "action",
    inputSchema: declared?.inputSchema ?? {},
    handlerRef: ref,
  };
}

/** The operations a registered projection publishes, described for the header and an agent. */
export function projectionOperations(
  manifest: PanelManifest,
  registration: { slot: string; ports: ProjectionPorts },
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
  registration: { slot: string; ports: ProjectionPorts },
  inputs: Readonly<Record<string, { state: string }>>,
): PanelOperation["target"] {
  const [state] = Object.entries(inputs).find(([input]) => registration.ports.inputs[input]?.kind === "object") ?? [];
  return state ? { source: "state", state: inputs[state]!.state } : { source: "draft", slot: registration.slot };
}

/** The wire description is shared by the SDK's header and the generated skill. */
export function panelStateOperation(operation: PanelStateOperation): PanelOperation {
  return { id: operation.id, label: operation.label, kind: operation.kind, inputSchema: {},
    handlerRef: `panel.state.${operation.id}` };
}
