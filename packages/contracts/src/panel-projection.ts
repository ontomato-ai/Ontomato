import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { formFieldErrorSchema, formValuesSchema, panelFormOptionSchema } from "./form-fields";
import { bindingKey } from "./panel-client-requests";
import { ontologyParameterTypeSchema, panelFormTargetSchema, panelMessageKeySchema, panelObjectRefSchema, panelOperationId, singleOntologyParameterTypeSchema, type OntologyParameterType, type PanelManifest, type PanelOperation, type PanelStateOperation } from "./panel-manifest";
import { platformObjectTypes, type PlatformObjectTypeDeclaration, type PlatformReadDeclaration } from "./platform-object-types";
import type { ProductProjectionInput } from "./product-panels";

/** Nested JSON in the owner's value shape. Field pointers address this object, including values filled by projections. */
export const panelFormValuesSchema = runtimeJsonObjectSchema;
export type PanelFormValues = z.infer<typeof panelFormValuesSchema>;

/** Columns in an ObjectList projection's display. Omit labelKey for a field named by its owner. */
export const panelObjectListColumnSchema = z.object({
  key: z.string().min(1),
  labelKey: panelMessageKeySchema.optional(),
  kind: z.enum(["text", "tag", "tags", "reference"]).optional(),
  subtitleKey: z.string().min(1).optional(),
  emptyKey: panelMessageKeySchema.optional(),
}).strict();
export type PanelObjectListColumn = z.infer<typeof panelObjectListColumnSchema>;

const fieldPath = formFieldErrorSchema.shape.field;
const objectType = z.string().min(1);

export { formTimeValueSchema as panelFormTimeValueSchema } from "./form-fields";

const readKey = z.string().min(1).max(200).refine(value => !["__proto__", "constructor", "prototype"].includes(value), "Reserved key");
const inputRef = z.object({ input: readKey }).strict();
export const directProjectionParamSchema = z.union([z.object({ literal: runtimeJsonValueSchema }).strict(), inputRef]);
export const directProjectionDataSchema = z.object({
  source: z.union([
    z.object({ type: readKey }).strict(),
    z.object({ object: z.union([z.object({ literal: panelObjectRefSchema }).strict(), inputRef]) }).strict(),
    z.object({ operation: readKey }).strict(),
  ]),
  read: readKey,
  params: z.record(readKey, directProjectionParamSchema),
}).strict();
export type DirectProjectionData = z.infer<typeof directProjectionDataSchema>;

export const directProjectionPortsSchema = z.object({
  componentId: z.enum(["@ontomato/sdk:ObjectList", "@ontomato/sdk:ObjectSummary", "@ontomato/sdk:ObjectForm", "@ontomato/sdk:OperationButton"]),
  inputs: z.record(readKey, z.union([singleOntologyParameterTypeSchema, z.object({ kind: z.literal("json") }).strict()])),
  outputs: z.record(readKey, singleOntologyParameterTypeSchema),
  data: z.record(readKey, directProjectionDataSchema),
  config: runtimeJsonObjectSchema,
}).strict();
export type DirectProjectionPorts = z.infer<typeof directProjectionPortsSchema>;

export const panelReadParameterSchemas = { formValues: formValuesSchema, changedField: fieldPath.nullable() };

type DirectObjectSource = Extract<DirectProjectionData["source"], { object: unknown }>["object"];

function directObjectSourceType(projection: DirectProjectionPorts, object: DirectObjectSource): string | undefined {
  if ("literal" in object) return object.literal.className;
  const input = projection.inputs[object.input];
  return input?.kind === "object" ? input.objectType : undefined;
}

/** Resolve the registered signature for one named projection read. */
export function directReadDeclaration(projection: DirectProjectionPorts, data: DirectProjectionData): PlatformReadDeclaration | undefined {
  const { source, read } = data;
  let owner: PlatformObjectTypeDeclaration | undefined;
  let sourceKind: PlatformReadDeclaration["source"];
  let readName = read;
  if ("type" in source) {
    sourceKind = "type";
    owner = platformObjectTypes[source.type];
  } else if ("object" in source) {
    const type = directObjectSourceType(projection, source.object);
    if (type === undefined) return undefined;
    sourceKind = "object";
    owner = platformObjectTypes[type];
  } else {
    sourceKind = "operation";
    owner = Object.values(platformObjectTypes).find(type => type.operations?.includes(source.operation));
    readName = `${source.operation}.${read}`;
  }
  const declaration = owner?.reads?.[readName];
  return declaration?.source === sourceKind ? declaration : undefined;
}

/** Match a declared read to its owner and verify that every parameter has a supported source. */
export function validateDirectProjection(projection: DirectProjectionPorts, ctx: z.RefinementCtx): void {
  const issue = (path: string[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  for (const [name, data] of Object.entries(projection.data)) {
    const { source, params } = data;
    const path = ["data", name];
    const declaration = directReadDeclaration(projection, data);
    if (!declaration) {
      if ("object" in source && directObjectSourceType(projection, source.object) === undefined) {
        issue([...path, "source", "object"], "The read source needs a declared object input or a literal object reference");
      } else {
        issue([...path, "read"], "Read is not registered for the declared source");
      }
      continue;
    }
    for (const [param, value] of Object.entries(params)) {
      const parameter = declaration.params[param];
      if (!parameter) {
        issue([...path, "params", param], "Parameter is not registered for this read");
      } else if ("literal" in value) {
        if (!panelReadParameterSchemas[parameter].safeParse(value.literal).success)
          issue([...path, "params", param, "literal"], "Value does not match the read parameter type");
      } else {
        const input = projection.inputs[value.input];
        const valid = parameter === "formValues" ? input?.kind === "json" : input?.kind === "scalar" && input.type === "string";
        if (!valid) issue([...path, "params", param, "input"], "Input does not match the read parameter type");
      }
    }
  }
}

export const panelRecordSchema = z.object({
  primaryKey: panelObjectRefSchema.shape.primaryKey,
  label: z.string(),
  subtitle: z.string().optional(),
  fields: z.record(z.string()),
}).strict();
export type PanelRecord = z.infer<typeof panelRecordSchema>;
export const panelRecordListSchema = z.array(panelRecordSchema);

/** The frequency control edits the same value as the scheduled-task control. */
export {
  platformTaskFrequencySchema as panelFormFrequencyValueSchema,
  type PlatformTaskFrequency as PanelFormFrequencyValue,
} from "./platform-schedules";

const simpleControls = [
  z.object({
    kind: z.literal("text"), multiline: z.boolean().optional(),
    placeholder: z.string().nullish(), maxLength: z.number().int().positive().optional(),
  }).strict(),
  z.object({
    kind: z.literal("select"),
    options: z.array(panelFormOptionSchema),
    multiple: z.boolean().optional(),
    /** The owner permits adding a value to the selection. */
    allowCreate: z.boolean().optional(),
  }).strict(),
  z.object({ kind: z.literal("switch") }).strict(),
  z.object({ kind: z.literal("markdown") }).strict(),
  z.object({ kind: z.literal("avatar") }).strict(),
  z.object({
    kind: z.literal("code"),
    /** JSON source edits the owner's JSON value, with a parse error on this field. */
    language: z.enum(["javascript", "json", "markdown", "html", "python", "text"]),
  }).strict(),
  /** Each editable row is one string in the owner's JSON array. */
  z.object({ kind: z.literal("string-array") }).strict(),
  z.object({ kind: z.literal("number") }).strict(),
  /** A local time value in HH:mm, with null and presence determined by the owner's value schema. */
  z.object({ kind: z.literal("time") }).strict(),
  /** The time zone is a separate owner field. */
  z.object({ kind: z.literal("frequency") }).strict(),
  z.object({
    /** A separate projection supplies the choices as well as any associated metadata, such as graph edges. */
    kind: z.literal("reference"), objectType, multiple: z.boolean(),
    relatedObjectTypes: z.array(objectType).optional(),
  }).strict(),
  z.object({ kind: z.literal("hidden") }).strict(),
] as const;

const arrayControl = z.object({
  kind: z.literal("object-array"),
  defaultItem: runtimeJsonObjectSchema.optional(),
  /** An owner-provided stable identity, addressed relative to the row. */
  itemKeyPath: fieldPath.optional(),
}).strict();

const objectControl = z.object({
  kind: z.literal("object"),
  /** Initial value when explicitly added. Removing an object writes null. */
  defaultObject: runtimeJsonObjectSchema.optional(),
}).strict();

const fieldShape = z.object({
  path: fieldPath,
  label: z.string().min(1),
  /** JSON Schema for this value, derived from the owner's save schema for consumers such as the panel skill. */
  valueSchema: runtimeJsonObjectSchema,
  required: z.boolean(),
  help: z.string().nullish(),
  defaultValue: runtimeJsonValueSchema.optional(),
  readOnly: z.boolean(),
  readOnlyReason: z.string().min(1).optional(),
  refreshOnChange: z.boolean().optional(),
}).strict();

export type PanelFormField = z.infer<typeof fieldShape> & {
  control:
    | z.infer<(typeof simpleControls)[number]>
    | (z.infer<typeof arrayControl> & { itemFields: PanelFormField[] })
    | (z.infer<typeof objectControl> & { fields: PanelFormField[] });
};

const childFields = z.array(z.lazy((): z.ZodType<PanelFormField> => panelFormFieldSchema));
const controlSchema = z.discriminatedUnion("kind", [
  ...simpleControls,
  // Row paths are relative. Edits, refreshes and errors address the current absolute paths.
  arrayControl.extend({ itemFields: childFields }),
  // Child paths are relative to the object. An untouched, omitted object stays absent.
  objectControl.extend({ fields: childFields }),
]);

export const panelFormFieldSchema = fieldShape.extend({ control: controlSchema });

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
export const panelFormSaveInputSchema = panelFormDescriptionSchema.pick({ values: true, revision: true }).extend({
  /** JSON Pointers submitted explicitly. Omission leaves the existing save semantics in effect. */
  submittedFields: z.array(fieldPath).optional(),
});
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
  const edgeBinding = projection.graph?.edges.binding;
  const outputs = edgeBinding && {
    selectedNode: projection.graph?.nodeIdentity ?? { kind: "object", objectType: projection.binding.id } as const,
    // Only a platform type binding declares the edge selection's object type.
    ...(edgeBinding.kind === "PlatformObjectType" && {
      selectedEdge: { kind: "object", objectType: edgeBinding.id } as const,
    }),
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
export function panelStateOperation(operation: PanelStateOperation, resolveLabel: (key: string) => string): PanelOperation {
  return { id: operation.id, label: resolveLabel(operation.labelKey), kind: operation.kind, inputSchema: {},
    handlerRef: `panel.state.${operation.id}` };
}
