import { z } from "zod";
import { runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { formFieldErrorSchema, formValuesSchema, panelFormOptionSchema } from "./form-fields";
import { bindingKey } from "./panel-client-requests";
import { directPanelPortTypeSchema, ontologyParameterTypeSchema, panelFormTargetSchema, panelMessageKeySchema, panelObjectRefSchema, panelOperationId, type DirectPanelPortType, type OntologyParameterType, type PanelManifest, type PanelOperation, type PanelStateOperation } from "./panel-manifest";
import { ontologyElementRefSchema, type OntologyElementRef } from "./ontology-element-ref";
import { panelConversationEntrySchema } from "./panel-conversation-entry";
import {
  platformOntologyNeighborsRequestSchema, platformOntologyNeighborsResponseSchema,
  platformOntologyObjectsRequestSchema, platformOntologyRelationStatusSchema,
} from "./platform-ontology";
import { EXECUTE_OBJECT_ACTION, customerOntologyReads, customerRelationReads, objectActionReads, platformObjectTypes, type PanelReadParameterId, type PlatformReadDeclaration } from "./platform-object-types";

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
const typeSource = ontologyElementRefSchema.extend({
  kind: ontologyElementRefSchema.shape.kind.extract(["PlatformObjectType", "ObjectType", "Relationship"]),
});
const operationSource = ontologyElementRefSchema.extend({
  kind: ontologyElementRefSchema.shape.kind.extract(["PlatformOperation", "Action"]),
});
export const directProjectionDataSchema = z.object({
  source: z.union([
    z.object({ type: typeSource }).strict(),
    z.object({ object: z.union([z.object({ literal: panelObjectRefSchema }).strict(), inputRef]) }).strict(),
    z.object({ operation: operationSource }).strict(),
  ]),
  read: readKey,
  params: z.record(readKey, directProjectionParamSchema),
}).strict();
export type DirectProjectionData = z.infer<typeof directProjectionDataSchema>;

export const directProjectionPortsSchema = z.object({
  componentId: z.enum([
    "@ontomato/sdk:ObjectList", "@ontomato/sdk:ObjectSummary", "@ontomato/sdk:ObjectForm", "@ontomato/sdk:OperationButton",
    "@ontomato/sdk:ReferencePicker", "@ontomato/sdk:ObjectGraph", "@ontomato/sdk:OntologyGraph", "@ontomato/sdk:ObjectRelations",
    "@ontomato/sdk:MetricChart", "@ontomato/sdk:ConversationEntry", "@ontomato/sdk:AppMenu",
  ]),
  inputs: z.record(readKey, z.union([directPanelPortTypeSchema, z.object({ kind: z.literal("json") }).strict()])),
  outputs: z.record(readKey, directPanelPortTypeSchema),
  data: z.record(readKey, directProjectionDataSchema),
  config: runtimeJsonObjectSchema,
  conversationEntry: panelConversationEntrySchema.optional(),
}).strict();
export type DirectProjectionPorts = z.infer<typeof directProjectionPortsSchema>;

const positiveInteger = z.number().int().positive();
export const panelReadParameterSchemas = {
  formValues: formValuesSchema,
  panelFormValues: panelFormValuesSchema,
  changedField: fieldPath.nullable(),
  keyword: z.string(),
  page: z.object({ number: positiveInteger, size: positiveInteger }).strict(),
  optionValues: z.array(runtimeJsonValueSchema),
  graphNode: platformOntologyNeighborsRequestSchema.shape.node,
  relationKinds: platformOntologyNeighborsRequestSchema.shape.relationKinds.unwrap(),
  layers: platformOntologyNeighborsRequestSchema.shape.layers.unwrap(),
  ontologyType: platformOntologyObjectsRequestSchema.shape.type,
  neighborsLimit: positiveInteger.max(100),
  ontologyParameter: runtimeJsonValueSchema,
  filter: runtimeJsonObjectSchema,
  sort: runtimeJsonValueSchema,
  cursor: z.string(),
  size: positiveInteger,
  knowledgeCountField: z.literal("status"),
  knowledgeFilter: z.object({ status: z.enum(["all", "pending", "approved"]) }).strict(),
};

type ReadInput = DirectProjectionPorts["inputs"][string];

function readInputMatches(parameter: PanelReadParameterId, input: ReadInput | undefined): boolean {
  switch (parameter) {
    case "changedField":
    case "keyword":
    case "ontologyType":
    case "cursor":
    case "knowledgeCountField":
      return input?.kind === "scalar" && input.type === "string";
    case "size":
    case "neighborsLimit":
      return input?.kind === "scalar" && input.type === "number";
    case "ontologyParameter":
    case "sort":
      return input !== undefined;
    case "graphNode":
      return input?.kind === "object" || input?.kind === "object-union" || input?.kind === "json";
    default:
      return input?.kind === "json";
  }
}

type DirectObjectSource = Extract<DirectProjectionData["source"], { object: unknown }>["object"];

function directObjectSourceType(projection: Pick<DirectProjectionPorts, "inputs">, object: DirectObjectSource): string | undefined {
  if ("literal" in object) return object.literal.className;
  const input = projection.inputs[object.input];
  return input?.kind === "object" ? input.objectType : undefined;
}

function projectionReadReference(projection: DirectProjectionPorts, source: DirectProjectionData["source"]): OntologyElementRef | undefined {
  if ("type" in source) return source.type;
  if ("operation" in source) return source.operation;
  const id = directObjectSourceType(projection, source.object);
  return id === undefined ? undefined : { kind: id.startsWith("platform:") ? "PlatformObjectType" : "ObjectType", id };
}

/** The domain owner validates these identities at registration and resolves them again at use. */
export function projectionReadReferences(projection: DirectProjectionPorts): readonly OntologyElementRef[] {
  const references = new Map<string, OntologyElementRef>();
  for (const { source } of Object.values(projection.data)) {
    const ref = projectionReadReference(projection, source);
    if (ref) references.set(bindingKey(ref), ref);
  }
  return [...references.values()];
}

/** Resolve a structural signature; the authenticated domain catalogue supplies actual element existence. */
export function directReadDeclaration(projection: DirectProjectionPorts, data: DirectProjectionData): PlatformReadDeclaration | undefined {
  const { source, read } = data;
  const ref = projectionReadReference(projection, source);
  if (!ref) return undefined;
  const sourceKind = Object.keys(source)[0];
  let declaration: PlatformReadDeclaration | undefined;
  switch (ref.kind) {
    case "PlatformObjectType":
      if (Object.hasOwn(platformObjectTypes, ref.id)) declaration = platformObjectTypes[ref.id].reads?.[read];
      break;
    case "PlatformOperation":
      declaration = Object.values(platformObjectTypes).find(type => type.operations?.includes(ref.id))?.reads?.[`${ref.id}.${read}`];
      break;
    case "ObjectType":
      declaration = customerOntologyReads[read];
      break;
    case "Relationship":
      declaration = customerRelationReads[read];
      break;
    case "Action":
      declaration = objectActionReads[read];
      break;
  }
  return declaration?.source === sourceKind ? declaration : undefined;
}

/** The named key is known either to the fixed signature or to the resolved owner object. */
export function panelReadParameterId(declaration: PlatformReadDeclaration, name: string): PanelReadParameterId | undefined {
  return declaration.parameterMode === "owner" ? declaration.parameter : declaration.params[name];
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
    for (const param of declaration.parameterMode === "fixed" ? declaration.requiredParams ?? [] : []) {
      if (!Object.hasOwn(params, param)) issue([...path, "params", param], "Required parameter needs a source");
    }
    for (const [param, value] of Object.entries(params)) {
      const parameter = panelReadParameterId(declaration, param);
      if (!parameter) {
        issue([...path, "params", param], "Parameter is not registered for this read");
      } else if ("literal" in value) {
        if (!panelReadParameterSchemas[parameter].safeParse(value.literal).success)
          issue([...path, "params", param, "literal"], "Value does not match the read parameter type");
      } else {
        if (!readInputMatches(parameter, projection.inputs[value.input]))
          issue([...path, "params", param, "input"], "Input does not match the read parameter type");
      }
    }
  }
}

/** A half-open UTF-16 range in the displayed text supplied by the owner. */
export const panelTextHighlightRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
}).strict().refine(range => range.end > range.start, {
  path: ["end"], message: "A highlight must cover at least one character",
});
export type PanelTextHighlightRange = z.infer<typeof panelTextHighlightRangeSchema>;

export const panelRecordSchema = z.object({
  primaryKey: panelObjectRefSchema.shape.primaryKey,
  label: z.string(),
  subtitle: z.string().optional(),
  fields: z.record(z.string()),
  /** Field names supplied by the owner in the reader's locale, keyed by the names in fields. */
  fieldLabels: z.record(z.string()).optional(),
  /** Display field keys (including label and subtitle). Omit this property when nothing matched. */
  highlights: z.record(z.array(panelTextHighlightRangeSchema).nonempty())
    .refine(fields => Object.keys(fields).length > 0, "Omit highlights when there are no matches").optional(),
}).strict();
export type PanelRecord = z.infer<typeof panelRecordSchema>;
export const panelRecordListSchema = z.array(panelRecordSchema);
export const panelRecordQuerySchema = z.object({
  rows: panelRecordListSchema,
  nextCursor: z.string().optional(),
  total: z.number().int().nonnegative().optional(),
}).strict();
export type PanelRecordQuery = z.infer<typeof panelRecordQuerySchema>;
export const panelGroupCountsSchema = z.record(z.number().int().nonnegative());
export const panelRelationNeighborsSchema = platformOntologyNeighborsResponseSchema.extend({
  relations: z.array(platformOntologyRelationStatusSchema.extend({ truncated: z.boolean() })),
});
export type PanelRelationNeighbors = z.infer<typeof panelRelationNeighborsSchema>;

export const panelOptionSchema = z.object({
  primaryKey: panelObjectRefSchema.shape.primaryKey,
  value: runtimeJsonValueSchema,
  label: z.string(),
  description: z.string().optional(),
  unavailable: z.object({ reason: z.string().min(1) }).strict().optional(),
}).strict();
export type PanelOption = z.infer<typeof panelOptionSchema>;

export const panelOptionListSchema = z.object({
  options: z.array(panelOptionSchema),
  total: z.number().int().nonnegative().optional(),
}).strict();
export type PanelOptionList = z.infer<typeof panelOptionListSchema>;

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
  /** Owner validation is part of a successful form read, alongside the current values. */
  errors: z.array(formFieldErrorSchema),
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
/** Frame admission and skill documentation use the same declared resource identities. */
export function projectionBindingKeys(projection: DirectProjectionPorts): readonly string[] {
  return projectionReadReferences(projection).map(bindingKey);
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
  inputs: Readonly<Record<string, DirectPanelPortType>>;
  /** The values it emits, by name; a slot can bind each output to its own panel state field. */
  outputs?: Readonly<Record<string, DirectPanelPortType>>;
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
export function projectionPorts(projection: DirectProjectionPorts, meta: ComponentOperationMetadata): ProjectionPorts {
  const references = projectionReadReferences(projection);
  const handlerRefs = new Set<string>();
  for (const ref of references) {
    if (ref.kind === "PlatformOperation") handlerRefs.add(ref.id);
    if (ref.kind === "Action") handlerRefs.add(EXECUTE_OBJECT_ACTION);
    if (ref.kind === "PlatformObjectType")
      for (const operation of platformObjectTypes[ref.id]?.operations ?? []) handlerRefs.add(operation);
  }
  const operations = (meta.operations ?? []).flatMap(({ client, name, label, kind, inputSchema }) => {
    const handlerRef = `${client}.${name}`;
    return handlerRefs.has(handlerRef) ? [{ name, label, kind, inputSchema, handlerRef }] : [];
  });
  return {
    binding: references.map(bindingKey).join(", "),
    inputs: Object.fromEntries(Object.entries(projection.inputs).filter((entry): entry is [string, DirectPanelPortType] => entry[1].kind !== "json")),
    outputs: projection.outputs,
    operations,
  };
}

/** The operations a registered projection publishes, described for the header and an agent. */
export function projectionOperations(
  manifest: PanelManifest,
  registration: { slot: string; ports: ProjectionPorts },
): PanelOperation[] {
  const slot = manifest.members[registration.slot];
  if (!slot) throw new Error(`The panel declares no slot '${registration.slot}'`);
  return registration.ports.operations.map((operation) => ({
    id: panelOperationId(registration.slot, operation.name),
    label: operation.label,
    kind: operation.kind,
    inputSchema: { ...operation.inputSchema },
    target: operation.kind === "form.save" ? { source: "draft", slot: registration.slot } : undefined,
    slot: registration.slot,
    handlerRef: operation.handlerRef,
  }));
}

/** The wire description is shared by the SDK's header and the generated skill. */
export function panelStateOperation(operation: PanelStateOperation, resolveLabel: (key: string) => string): PanelOperation {
  return { id: operation.id, label: resolveLabel(operation.labelKey), kind: operation.kind, inputSchema: {},
    handlerRef: `panel.state.${operation.id}` };
}
