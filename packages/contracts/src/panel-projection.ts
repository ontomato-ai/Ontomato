import {
  applicationCatalogueScopeSchema, applicationFormSectionSchema, productCatalogQuerySchema, productPanelCatalogQuerySchema,
} from "./product-catalog-query";
import { z } from "zod";
import { runtimeIdSchema, runtimeJsonObjectSchema, runtimeJsonValueSchema } from "./agent-runtime-values";
import { formFieldErrorSchema, formValuesSchema, panelFormOptionSchema } from "./form-fields";
import { bindingKey } from "./panel-client-requests";
import { directPanelPortTypeSchema, panelFormTargetSchema, panelMessageKeySchema, panelObjectRefSchema, panelOperationId, panelPortAccepts, type DirectPanelPortType, type PanelManifest, type PanelMember, type PanelOperation, type PanelStateOperation, type PanelStateRef } from "./panel-manifest";
import { ontologyElementRefSchema, type OntologyElementRef } from "./ontology-element-ref";
import { panelConversationEntrySchema } from "./panel-conversation-entry";
import {
  platformOntologyNeighborsRequestSchema, platformOntologyNeighborsResponseSchema,
  platformOntologyObjectsRequestSchema, platformOntologyRelationStatusSchema,
} from "./platform-ontology-data";
import type { PanelOperationDeclaration, PanelOwnerOperationDescriptor } from "./panel-operations";
import { customerOntologyReads, customerRelationReads, platformObjectTypes, type PanelReadParameterId, type PlatformReadDeclaration } from "./platform-object-types";

/** Nested JSON in the owner's value shape. Field pointers address this object, including values filled by projections. */
export const panelFormValuesSchema = runtimeJsonObjectSchema;
export type PanelFormValues = z.infer<typeof panelFormValuesSchema>;

/** Columns in an ObjectList projection's display. Omit labelKey for a field named by its owner. */
export const panelObjectListColumnSchema = z.object({
  key: z.string().min(1),
  labelKey: panelMessageKeySchema.optional(),
  kind: z.enum(["text", "tag", "tags", "reference", "time"]).optional().describe(
    "A time column displays the owner's ISO time string in the reader's language and local time zone, with the full time in its title. Sorting and filtering use the original string.",
  ),
  subtitleKey: z.string().min(1).optional(),
  emptyKey: panelMessageKeySchema.optional(),
  wrap: z.boolean().optional().describe("Allow text in this column to wrap onto multiple lines. Defaults to false."),
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
const operationRef = ontologyElementRefSchema.extend({
  kind: ontologyElementRefSchema.shape.kind.extract(["PlatformOperation", "Action"]),
});
export const directProjectionDataSchema = z.object({
  source: z.union([
    z.object({ type: typeSource }).strict(),
    z.object({ object: z.union([z.object({ literal: panelObjectRefSchema }).strict(), inputRef]) }).strict(),
  ]),
  read: readKey,
  params: z.record(readKey, directProjectionParamSchema),
}).strict();
export type DirectProjectionData = z.infer<typeof directProjectionDataSchema>;

export const directProjectionInputTypeSchema = z.union([
  directPanelPortTypeSchema,
  z.object({ kind: z.literal("json") }).strict(),
]);

export const projectionOperationTargetSchema = z.union([
  inputRef,
  z.object({ literal: panelObjectRefSchema }).strict(),
]);
export const panelLocalOperationNameSchema = readKey.refine(name => !name.includes("."), "Operation names cannot contain a dot");
export const projectionOperationBindingSchema = z.object({
  operation: operationRef,
  target: projectionOperationTargetSchema.optional(),
}).strict();
export type ProjectionOperationBinding = z.infer<typeof projectionOperationBindingSchema>;

export const directProjectionPortsSchema = z.object({
  componentId: z.string().regex(/^(?:@[^@\s/:]+\/)?[^@\s/:]+:[^@\s/:]+$/u, "Expected a package-qualified component name"),
  inputs: z.record(readKey, directProjectionInputTypeSchema),
  outputs: z.record(readKey, directPanelPortTypeSchema),
  data: z.record(readKey, directProjectionDataSchema),
  operations: z.record(panelLocalOperationNameSchema, projectionOperationBindingSchema).optional(),
  config: runtimeJsonObjectSchema,
  conversationEntry: panelConversationEntrySchema.optional(),
}).strict();
export type DirectProjectionPorts = z.infer<typeof directProjectionPortsSchema>;

/** Only a source-card registration adds a metric identity to the projection record. */
type ProjectionReadFacts = DirectProjectionPorts & { metricId?: string };

const positiveInteger = z.number().int().positive();
export const panelReadParameterSchemas = {
  productScope: productCatalogQuerySchema.shape.scope.removeDefault(),
  productSort: productCatalogQuerySchema.shape.sort.removeDefault(),
  productTemplate: productPanelCatalogQuerySchema.shape.template.unwrap(),
  applicationScope: applicationCatalogueScopeSchema,
  applicationFormSection: applicationFormSectionSchema.exclude(["create"]),
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
  className: panelObjectRefSchema.shape.className,
  neighborsLimit: positiveInteger.max(100),
  ontologyParameter: runtimeJsonValueSchema,
  sort: runtimeJsonValueSchema,
  cursor: z.string(),
  scheduledRunId: runtimeIdSchema,
  size: positiveInteger,
  knowledgeCountField: z.literal("status"),
  knowledgeStatus: z.enum(["all", "pending", "approved"]),
  feedbackCountField: z.enum(["sourceType", "rating"]),
  feedbackSourceType: z.enum(["all", "qa", "analysis_task"]),
  feedbackRating: z.enum(["all", "like", "dislike"]),
  skillFilePath: z.string().min(1),
};

type ReadInput = DirectProjectionPorts["inputs"][string];

export function directProjectionInputAccepts(target: ReadInput, source: DirectPanelPortType): boolean {
  return target.kind === "json" ? source.kind !== "node-positions" : panelPortAccepts(target, source);
}

export function panelReadInputMatches(parameter: PanelReadParameterId, input: ReadInput | undefined): boolean {
  if (input?.kind === "node-positions") return false;
  switch (parameter) {
    case "changedField":
    case "keyword":
    case "ontologyType":
    case "className":
    case "cursor":
    case "scheduledRunId":
    case "knowledgeCountField":
    case "knowledgeStatus":
    case "feedbackCountField":
    case "feedbackSourceType":
    case "feedbackRating":
    case "skillFilePath":
    case "productScope":
    case "productSort":
    case "applicationScope":
    case "applicationFormSection":
      return input?.kind === "scalar" && input.type === "string";
    case "productTemplate":
      return input?.kind === "scalar" && input.type === "boolean";
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

export function directObjectSourceType(projection: Pick<DirectProjectionPorts, "inputs">, object: DirectObjectSource): string | undefined {
  if ("literal" in object) return object.literal.className;
  const input = projection.inputs[object.input];
  return input?.kind === "object" ? input.objectType : undefined;
}

function projectionReadReference(projection: DirectProjectionPorts, source: DirectProjectionData["source"]): OntologyElementRef | undefined {
  if ("type" in source) return source.type;
  const id = directObjectSourceType(projection, source.object);
  return id === undefined ? undefined : { kind: id.startsWith("platform:") ? "PlatformObjectType" : "ObjectType", id };
}

/** The domain owner validates these identities at registration and resolves them again at use. */
export function projectionReadReferences(projection: ProjectionReadFacts): readonly OntologyElementRef[] {
  const references = new Map<string, OntologyElementRef>();
  for (const { source } of Object.values(projection.data)) {
    const ref = projectionReadReference(projection, source);
    if (ref) references.set(bindingKey(ref), ref);
  }
  for (const { operation } of Object.values(projection.operations ?? {})) references.set(bindingKey(operation), operation);
  if (projection.metricId !== undefined) {
    const metric = { kind: "MetricView", id: projection.metricId } as const;
    references.set(bindingKey(metric), metric);
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
    case "ObjectType":
      declaration = customerOntologyReads[read];
      break;
    case "Relationship":
      declaration = customerRelationReads[read];
      break;
  }
  return declaration?.source === sourceKind ? declaration : undefined;
}

/** The named key is known either to the fixed signature or to the resolved owner object. */
export function panelReadParameterId(declaration: PlatformReadDeclaration, name: string): PanelReadParameterId | undefined {
  return declaration.parameterMode === "owner" ? declaration.parameter : declaration.params[name];
}

/**
 * A read parameter without a projection mapping is an input with the same name and the type in the read signature.
 * A member's state binding supplies that input before any component runtime parameter can.
 */
export function authoredReadParameterSource(
  params: DirectProjectionData["params"],
  name: string,
  member?: Pick<PanelMember, "inputs" | "outputs">,
): DirectProjectionData["params"][string] | PanelStateRef | undefined {
  if (Object.hasOwn(params, name)) return params[name];
  const input = member?.inputs?.[name];
  return input && "state" in input ? input : member?.outputs?.[name];
}

/** Registration checks the projection, its placement and the active catalogue for a required parameter's source. */
export function missingRequiredReadParameters(
  declaration: PlatformReadDeclaration,
  params: DirectProjectionData["params"],
  runtimeParams: readonly string[] = [],
  member?: Pick<PanelMember, "inputs" | "outputs">,
): string[] {
  if (declaration.parameterMode !== "fixed") return [];
  return (declaration.requiredParams ?? []).filter(name =>
    !authoredReadParameterSource(params, name, member) && !runtimeParams.includes(name));
}

/** Match a declared read to its owner and check its authored parameter bindings. */
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
      const parameter = panelReadParameterId(declaration, param);
      if (!parameter) {
        issue([...path, "params", param], "Parameter is not registered for this read");
      } else if ("literal" in value) {
        if (!panelReadParameterSchemas[parameter].safeParse(value.literal).success)
          issue([...path, "params", param, "literal"], "Value does not match the read parameter type");
      } else {
        if (!panelReadInputMatches(parameter, projection.inputs[value.input]))
          issue([...path, "params", param, "input"], "Input does not match the read parameter type");
      }
    }
  }
  for (const [name, { target }] of Object.entries(projection.operations ?? {})) {
    if (!target || !("input" in target)) continue;
    const port = projection.inputs[target.input];
    if (port?.kind !== "object" && port?.kind !== "list")
      issue(["operations", name, "target", "input"], "The operation needs a declared object or list input");
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

/** How a field shown as a status tag reads at a glance. */
export const panelFieldToneSchema = z.enum(["default", "info", "success", "warning", "danger"]);
export type PanelFieldTone = z.infer<typeof panelFieldToneSchema>;

export const panelRecordSchema = z.object({
  primaryKey: panelObjectRefSchema.shape.primaryKey,
  label: z.string(),
  subtitle: z.string().optional(),
  fields: z.record(z.string()),
  /** Field names supplied by the owner in the reader's locale, keyed by the names in fields. */
  fieldLabels: z.record(z.string()).optional(),
  /** The tone of a field that shows as a status tag, by field name. */
  tones: z.record(panelFieldToneSchema).optional(),
  /** A field's values as separate tags, by field name. */
  tags: z.record(z.array(z.string())).optional(),
  /** Display field keys (including label and subtitle). Omit this property when nothing matched. */
  highlights: z.record(z.array(panelTextHighlightRangeSchema).min(1))
    .refine(fields => Object.keys(fields).length > 0, "Omit highlights when there are no matches").optional(),
}).strict();
export type PanelRecord = z.infer<typeof panelRecordSchema>;
export const panelRecordListSchema = z.array(panelRecordSchema);

/** Plain-text notices localized by the read owner and displayed alongside the available results. */
const panelReadDiagnostics = z.array(z.string()).optional();
export const panelRecordQuerySchema = z.object({
  rows: panelRecordListSchema,
  nextCursor: z.string().optional(),
  total: z.number().int().nonnegative().optional(),
  diagnostics: panelReadDiagnostics,
}).strict();
export type PanelRecordQuery = z.infer<typeof panelRecordQuerySchema>;
/** Group order and display labels come from the owner. */
export const panelGroupCountsSchema = z.array(z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
}).strict());
export type PanelGroupCounts = z.infer<typeof panelGroupCountsSchema>;
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
  diagnostics: panelReadDiagnostics,
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
  /** Each locale edits a string keyed by locale code in the owner's JSON object. */
  z.object({
    kind: z.literal("localized-text"),
    primaryLocale: z.string().min(1),
    locales: z.array(z.object({ code: z.string().min(1), label: z.string().min(1) }).strict()),
    /** Languages that must have a text; omitted, none must. */
    requiredLocales: z.array(z.string().min(1)).optional(),
    multiline: z.boolean().optional(),
    maxLength: positiveInteger.optional(),
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
  /** The owner keeps the icon's string key, including keys written by older releases. */
  z.object({ kind: z.literal("application-icon") }).strict(),
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
  advanced: z.literal(true).optional().describe(
    "Group this field with the advanced fields at the end of its form, object, or array row. The group starts collapsed and opens when it contains a field error.",
  ),
  section: z.string().min(1).optional().describe(
    "The key of the form section, among the form's sections, this top-level field is drawn in.",
  ),
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

export const panelFormFieldSchema = fieldShape.extend({ control: controlSchema }).superRefine(({ control }, ctx) => {
  if (control.kind !== "select" || !control.options.some(option => typeof option.value === "object")) return;
  if (control.allowCreate)
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["control", "allowCreate"],
      message: "An object-valued select only accepts its declared options",
    });
  if (control.options.some(option => typeof option.value !== "object"))
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["control", "options"],
      message: "All options of an object-valued select must be objects",
    });
});

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
/** A part of an owner's form, drawn under its title and hint with the fields that name it, in the order given. */
export const panelFormSectionSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  hint: z.string().min(1).optional(),
}).strict();
export type PanelFormSection = z.infer<typeof panelFormSectionSchema>;

export const panelFormDescriptionSchema = z.object({
  fields: z.array(panelFormFieldSchema),
  /** The form's sections in order; a form without them is one list of fields. */
  sections: z.array(panelFormSectionSchema).optional(),
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

/** An owner's only valid object or object-list port. Used by both author preflight and the server. */
export function panelOperationTargetPort(port: ReadInput | undefined, objectType: string, batch: boolean) {
  if (port?.kind === "object" && port.objectType === objectType) return port;
  if (port?.kind === "list" && batch && port.items.kind === "object" && port.items.objectType === objectType) return port;
}

/** Match a projection target to the selected owner declaration from the type table. */
export function projectionOperationTargetMatches(
  projection: Pick<DirectProjectionPorts, "inputs">,
  binding: ProjectionOperationBinding,
  declaration: Pick<PanelOperationDeclaration, "target" | "batch">,
  objectType?: string,
): boolean {
  const { target } = binding;
  if (declaration.target.source === "none") return target === undefined;
  if (!target) return declaration.target.source === "draft";
  if (objectType === undefined) return false;
  if ("literal" in target) return target.literal.className === objectType;
  return panelOperationTargetPort(projection.inputs[target.input], objectType, declaration.batch) !== undefined;
}

export interface ProjectionPorts {
  binding: string;
  inputs: Readonly<Record<string, DirectPanelPortType>>;
  outputs?: Readonly<Record<string, DirectPanelPortType>>;
}

/** Both the old frame boundary and the authoring tools need the referenced ontology identities. */
export function projectionBindingKeys(projection: ProjectionReadFacts): readonly string[] {
  return projectionReadReferences(projection).map(bindingKey);
}

export function projectionPorts(projection: ProjectionReadFacts): ProjectionPorts {
  return {
    binding: projectionBindingKeys(projection).join(", "),
    inputs: Object.fromEntries(Object.entries(projection.inputs).filter((entry): entry is [string, DirectPanelPortType] => entry[1].kind !== "json")),
    outputs: projection.outputs,
  };
}

/** Show the already admitted owner operation under the name of this member's binding. */
export function projectionOperation(
  manifest: PanelManifest,
  member: string,
  name: string,
  descriptor: PanelOwnerOperationDescriptor,
): PanelOperation {
  const { kind, label, handlerRef, inputSchema, target, unavailable } = descriptor;
  let placed: PanelOperation["target"];
  if (kind === "form.save") placed = { source: "draft", slot: member };
  else if (target.source === "literal" || target.source === "none") placed = target;
  else if (target.source === "input") {
    const binding = manifest.members[member]?.inputs?.[target.input];
    if (binding && "state" in binding) placed = { source: "state", state: binding.state };
    else if (binding && "literal" in binding) placed = { source: "literal", literal: panelObjectRefSchema.parse(binding.literal) };
  }
  return {
    id: panelOperationId(member, name), kind, label, handlerRef, inputSchema, target: placed, slot: member,
    ...(unavailable !== undefined && { unavailable }),
  };
}

/** The wire description is shared by the SDK's header and the generated skill. */
export function panelStateOperation(operation: PanelStateOperation, resolveLabel: (key: string) => string): PanelOperation {
  return { id: operation.id, label: resolveLabel(operation.labelKey), kind: operation.kind, inputSchema: {},
    handlerRef: `panel.state.${operation.id}` };
}
