import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { formFieldErrorSchema, formOptionSchema } from "./form-fields";
import { bindingKey } from "./panel-client-requests";
import { ontologyParameterTypeSchema, panelFormTargetSchema, panelOperationId, type OntologyParameterType, type PanelManifest, type PanelOperation, type PanelStateOperation } from "./panel-manifest";
import type { ProductProjectionInput } from "./product-panels";

/** Nested JSON in the owner's value shape. Field pointers address this object, including values filled by projections. */
export const panelFormValuesSchema = runtimeJsonObjectSchema;
export type PanelFormValues = z.infer<typeof panelFormValuesSchema>;

const fieldPath = formFieldErrorSchema.shape.field;
const objectType = z.string().min(1);
const controlSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"), multiline: z.boolean().optional(),
    placeholder: z.string().nullish(), maxLength: z.number().int().positive().optional(),
  }).strict(),
  z.object({ kind: z.literal("select"), options: z.array(formOptionSchema) }).strict(),
  z.object({ kind: z.literal("switch") }).strict(),
  z.object({ kind: z.literal("markdown") }).strict(),
  z.object({ kind: z.literal("avatar") }).strict(),
  z.object({
    /** A separate projection supplies the choices as well as any associated metadata, such as graph edges. */
    kind: z.literal("reference"), objectType, multiple: z.boolean(),
    relatedObjectTypes: z.array(objectType).optional(),
  }).strict(),
  z.object({ kind: z.literal("hidden") }).strict(),
]);

export const panelFormFieldSchema = z.object({
  path: fieldPath,
  label: z.string().min(1),
  control: controlSchema,
  /** JSON Schema for this value, derived from the owner's save schema for consumers such as the panel skill. */
  valueSchema: runtimeJsonObjectSchema,
  required: z.boolean(),
  help: z.string().nullish(),
  defaultValue: runtimeJsonValueSchema.optional(),
  readOnly: z.boolean(),
  readOnlyReason: z.string().min(1).optional(),
  refreshOnChange: z.boolean().optional(),
}).strict();
export type PanelFormField = z.infer<typeof panelFormFieldSchema>;

/** The client's native owner request. The form's binding supplies the body mapping to that owner's existing schema. */
const formSaveRequestSchema = z.object({
  method: z.enum(["POST", "PUT"]),
  path: z.string().startsWith("/"),
  /** Derived from the native request schema, including any owner-required wrapper or revision. */
  bodySchema: runtimeJsonObjectSchema,
  /** The operation name used by the existing page-draft envelope for this target. */
  draftOperation: z.string().min(1),
}).strict();

/** Values and description returned together by the owner for the current target and caller. */
export const panelFormDescriptionSchema = z.object({
  fields: z.array(panelFormFieldSchema),
  values: panelFormValuesSchema,
  /** Present only when the owner's save requires the revision returned with these values. */
  revision: z.number().int().positive().safe().optional(),
  save: formSaveRequestSchema,
}).strict();
export type PanelFormDescription = z.infer<typeof panelFormDescriptionSchema>;

/** Omit values on open; supply values with a field pointer on refresh, or with null to check an incoming draft. */
export const panelFormRequestSchema = z.object({
  target: panelFormTargetSchema,
  values: panelFormValuesSchema.optional(),
  changedField: fieldPath.nullable(),
}).strict();
export type PanelFormRequest = z.infer<typeof panelFormRequestSchema>;

/** Input to the form.save operation; the resource adapter sends the native owner request. */
export const panelFormSaveInputSchema = panelFormDescriptionSchema.pick({ values: true, revision: true });
export type PanelFormSaveInput = z.infer<typeof panelFormSaveInputSchema>;

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
type ProjectionBindings = Pick<ProductProjectionInput, "binding" | "graph">;
type Projection = ProjectionBindings & Pick<ProductProjectionInput, "name" | "inputs">;

/** Both admission and skill reads use the entire set of resources this projection declares. */
export function projectionBindingKeys(projection: ProjectionBindings): readonly string[] {
  const primary = bindingKey(projection.binding);
  return projection.graph ? [primary, bindingKey(projection.graph.edges.binding)] : [primary];
}

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
  /** The values it emits, by name; a slot can bind each output to its own panel state field. */
  outputs?: Readonly<Record<string, OntologyParameterType>>;
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
  const outputs = projection.graph && {
    selectedNode: { kind: "object", objectType: projection.binding.id } as const,
    selectedEdge: { kind: "object", objectType: projection.graph.edges.binding.id } as const,
  };
  return { binding, inputs: projection.inputs, operations: declared, ...(outputs && { outputs }) };
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
    target: operation.kind === "form.save" ? { source: "draft", slot: registration.slot } : target,
    slot: registration.slot,
    handlerRef: operation.handlerRef,
  }));
}

/**
 * The object a projection's operations act on: the state field its first object-typed input is filled from, so the
 * reader's current selection is the target. A form save always uses the form's target, which can change between an
 * existing object and a create draft independently of that slot's inputs.
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
