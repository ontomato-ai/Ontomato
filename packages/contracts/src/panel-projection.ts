import {
  applicationCatalogueScopeSchema,
  applicationCatalogueSortSchema,
  applicationFormSectionSchema,
  productCatalogQuerySchema,
  productPanelCatalogQuerySchema,
  productProjectionComponentFilterSchema,
  productProjectionObjectTypeFilterSchema,
} from "./product-catalog-query";
import { z } from "zod";
import { workspaceCommitSchema, workspacePathSchema } from "./workspaces";
import { componentIdSchema } from "./product-record-id";
import { agentSkillTargetSchema } from "./skills";
import { runtimeIdSchema, runtimeJsonObjectSchema, runtimeJsonValueSchema, type RuntimeJsonValue } from "./agent-runtime-values";
import { findPanelFormOption, formFieldErrorSchema, formValuesSchema, panelFormOptionSchema, panelFormOptionValueSchema } from "./form-fields";
import { bindingKey } from "./panel-client-requests";
import { directPanelPortTypeSchema, matchesObjectType, objectUnionTypes, panelFormTargetSchema, panelMessageKeySchema, panelObjectIdentitySchema, panelObjectRefSchema, panelOperationId, panelPortAccepts, type DirectPanelPortType, type PanelManifest, type PanelMember, type PanelMemberInput, type PanelMemberItemKey, type PanelObjectRef, type PanelOperation, type PanelStateOperation } from "./panel-manifest";
import { ontologyElementRefSchema, type OntologyElementRef } from "./ontology-element-ref";
import { pageComposerAgentTargetSchema, panelConversationEntrySchema } from "./panel-conversation-entry";
import {
  platformOntologyNeighborsRequestSchema, platformOntologyNeighborsResponseSchema,
  platformOntologyObjectsRequestSchema, platformOntologyRelationStatusSchema,
} from "./platform-ontology-data";
import type { PanelOperationDeclaration, PanelOwnerOperationDescriptor } from "./panel-operations";
import { customerOntologyReads, customerRelationReads, isPlatformFormSaveOperation, platformObjectTypes, type PanelReadParameterId, type PlatformReadDeclaration } from "./platform-object-types";

/** Nested JSON in the owner's value shape. Field pointers address this object, including values filled by projections. */
export const panelFormValuesSchema = runtimeJsonObjectSchema;
export type PanelFormValues = z.infer<typeof panelFormValuesSchema>;

const columnWidthSchema = z.union([z.number().positive(), z.string().min(1)]).optional();

/**
 * Pure presentation mapping for one exact scalar value (string, number string, or `"true"`/`"false"`): maps the raw
 * value to a localized display label and/or platform icon name. Semantic tone travels on the value itself or
 * `record.tones`, never in `valueMap`. Never computes new values or evaluates range/threshold expressions.
 */
export const panelDisplayValueMapEntrySchema = z.object({
  label: z.string().min(1).optional().describe("Fallback display label when the exact raw value matches."),
  labelKey: panelMessageKeySchema.optional().describe("Panel message key or platform i18n key for the display label."),
  labels: z.record(z.string().min(1), z.string().min(1)).optional().describe("Locale-keyed display labels."),
  icon: z.string().min(1).optional().describe("Platform icon name resolved through the platform icon registry."),
}).strict();
export type PanelDisplayValueMapEntry = z.infer<typeof panelDisplayValueMapEntrySchema>;

/** Map from exact scalar string key to pure presentation overrides (`label`/`labelKey`/`labels`, `icon`). */
export const panelDisplayValueMapSchema = z.record(z.string(), panelDisplayValueMapEntrySchema);
export type PanelDisplayValueMap = z.infer<typeof panelDisplayValueMapSchema>;

/** Columns in an ObjectList projection's display. Omit labelKey for a field named by its owner. */
export const panelObjectListColumnSchema = z.object({
  key: z.string().min(1),
  labelKey: panelMessageKeySchema.optional(),
  kind: z.enum(["text", "tag", "tags", "reference", "time"]).optional().describe(
    "A time column displays the owner's ISO time string in the reader's language and local time zone, with the full time in its title. Sorting and filtering use the original string.",
  ),
  timeFormat: z.enum(["relative", "datetime", "date"]).optional().describe(
    "How a time column formats its timestamp: 'relative' (default) shows relative time for recent dates, 'datetime' shows full local date and time, and 'date' shows local date.",
  ),
  subtitleKey: z.string().min(1).optional().describe(
    "Optional field key drawn as a muted second line beneath the column's primary value in table cells.",
  ),
  subtitleEmptyKey: z.string().min(1).optional().describe(
    "Panel message key shown when the subtitle field is empty. Without it, an empty subtitle is omitted.",
  ),
  iconKey: z.string().min(1).optional(),
  emptyKey: panelMessageKeySchema.optional(),
  valueMap: panelDisplayValueMapSchema.optional().describe(
    "Optional exact raw-value to display label/icon mapping for cells in this column (pure presentation; semantic tone comes from the value or row.tones, not valueMap).",
  ),
  listSeparator: z.string().optional().describe(
    "Optional separator inserted between inline array items in this column (defaults to ', '; pass '' for inline sentence fragments).",
  ),
  listStyle: z.enum(["inline", "tags"]).optional().describe(
    "How array-valued cells in this column render: 'inline' joins items inline with listSeparator; 'tags' renders each item as a tag chip.",
  ),
  wrap: z.boolean().optional().describe("Allow text in this column to wrap onto multiple lines. Defaults to false."),
  width: columnWidthSchema.describe("Optional fixed column width in pixels (number) or CSS length string (for example '160px' or '20%')."),
  minWidth: columnWidthSchema.describe("Optional minimum column width in pixels (number) or CSS length string."),
  minContainerWidth: z.number().int().positive().optional().describe(
    "Minimum list container width in pixels required to display this column. Automatically hides the column when the container is narrower than this threshold and restores it when wider.",
  ),
  align: z.enum(["left", "center", "right"]).optional().describe("Optional text alignment for header and cells in this column."),
  headerTooltipKey: panelMessageKeySchema.optional().describe(
    "Optional panel message key shown in a tooltip beside the table column header.",
  ),
  tagEffect: z.enum(["light", "plain"]).optional().describe(
    "Visual fill style for tag pills in this column ('light' filled by default, or 'plain' outlined).",
  ),
  resultFrom: z.object({
    operation: z.string().min(1),
    field: z.string().min(1).optional(),
  }).strict().optional().describe(
    "Derive this cell's displayed value from this row's latest platform-recorded result of the named row operation. Optional `field` picks a key from an object result; tone comes from the value itself (or `danger` on error).",
  ),
}).strict();
export type PanelObjectListColumn = z.infer<typeof panelObjectListColumnSchema>;

/** Per-row visibility or disabled condition evaluated against a row record's fields. */
export const panelObjectListRowActionConditionSchema = z.object({
  field: z.string().min(1),
  equals: runtimeJsonValueSchema.optional(),
  notEquals: runtimeJsonValueSchema.optional(),
  in: z.array(runtimeJsonValueSchema).min(1).optional(),
  notIn: z.array(runtimeJsonValueSchema).min(1).optional(),
  truthy: z.boolean().optional(),
}).strict();
export type PanelObjectListRowActionCondition = z.infer<typeof panelObjectListRowActionConditionSchema>;

const rowActionWhenSchema = z.union([
  panelObjectListRowActionConditionSchema,
  z.array(panelObjectListRowActionConditionSchema).min(1),
]).optional();

/** Five-level semantic tone for row actions in ObjectList and GroupedGrid. */
export const panelRowActionToneSchema = z.enum(["default", "primary", "success", "warning", "danger"]);
export type PanelRowActionTone = z.infer<typeof panelRowActionToneSchema>;

const rowActionBaseFields = {
  labelKey: panelMessageKeySchema.optional(),
  label: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
  iconOnly: z.boolean().optional(),
  active: z.boolean().optional(),
  tone: panelRowActionToneSchema.optional(),
  when: rowActionWhenSchema,
  disabledWhen: rowActionWhenSchema,
};

export const panelObjectListRowActionItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("operation"),
    operation: z.string().min(1),
    hideWhenUnavailable: z.boolean().optional(),
    ...rowActionBaseFields,
  }).strict(),
  z.object({
    kind: z.literal("local"),
    id: z.string().min(1),
    to: z.string().min(1).optional(),
    ...rowActionBaseFields,
  }).strict(),
  z.object({
    kind: z.literal("conversation"),
    id: z.string().min(1),
    target: pageComposerAgentTargetSchema.optional(),
    prefill: z.string().optional(),
    prefillKey: panelMessageKeySchema.optional(),
    submit: z.boolean().optional(),
    newSession: z.boolean().optional(),
    ...rowActionBaseFields,
  }).strict(),
]).superRefine((item, ctx) => {
  if (item.kind === "conversation" && item.prefill !== undefined && item.prefillKey !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Write the opening sentence out or name its message key, not both",
      path: ["prefillKey"],
    });
  }
});
export type PanelObjectListRowActionItem = z.infer<typeof panelObjectListRowActionItemSchema>;

/** Built-in action column configuration for ObjectList. */
export const panelObjectListRowActionsSchema = z.object({
  labelKey: panelMessageKeySchema.optional(),
  label: z.string().min(1).optional(),
  width: columnWidthSchema,
  minWidth: columnWidthSchema,
  align: z.enum(["left", "center", "right"]).optional(),
  maxVisible: z.number().int().min(0).optional(),
  fixed: z.union([z.literal("right"), z.literal(false)]).optional(),
  placement: z.enum(["footer", "header"]).optional(),
  items: z.array(panelObjectListRowActionItemSchema),
}).strict();
export type PanelObjectListRowActions = z.infer<typeof panelObjectListRowActionsSchema>;

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

export const directProjectionInputTypeSchema = directPanelPortTypeSchema;

export const projectionOperationTargetSchema = z.union([
  inputRef,
  z.object({ literal: panelObjectRefSchema }).strict(),
  z.object({ row: z.literal(true) }).strict(),
  z.object({ rowField: readKey }).strict(),
]);
const projectionOperationFormFieldsSchema = z.record(z.string().min(1), fieldPath)
  .refine(fields => Object.keys(fields).length > 0, "Expected at least one form field mapping");
export const projectionOperationParamSchema = z.union([
  z.object({ literal: runtimeJsonValueSchema }).strict(),
  inputRef,
  z.object({ row: z.enum(["primaryKey", "label"]) }).strict(),
  z.object({ rowField: readKey }).strict(),
  z.object({ formField: fieldPath }).strict(),
  z.object({ formFields: projectionOperationFormFieldsSchema }).strict(),
]);
export type ProjectionOperationParam = z.infer<typeof projectionOperationParamSchema>;

export const panelLocalOperationNameSchema = readKey.refine(name => !name.includes("."), "Operation names cannot contain a dot");
export const projectionOperationBindingSchema = z.object({
  operation: operationRef,
  target: projectionOperationTargetSchema.optional(),
  /** Author-bound operation input parameters resolved from projection inputs, form fields, row values, or fixed literals. */
  params: z.record(readKey, projectionOperationParamSchema).optional(),
}).strict();
export type ProjectionOperationBinding = z.infer<typeof projectionOperationBindingSchema>;

/** Whether a projection declares a platform `form.save` operation, regardless of the current viewer's permissions. */
export function hasDeclaredPlatformFormSave(
  operations: Readonly<Record<string, ProjectionOperationBinding>> | undefined,
): boolean {
  return Object.values(operations ?? {}).some(
    binding => binding.operation.kind === "PlatformOperation" && isPlatformFormSaveOperation(binding.operation.id),
  );
}

/** Choose the declared customer form save before checking which operations the owner admits. */
export function declaredCustomerFormSaveName(
  operations: Readonly<Record<string, ProjectionOperationBinding>> | undefined,
  creating: boolean,
): string | undefined {
  if (hasDeclaredPlatformFormSave(operations)) return undefined;
  const actions = Object.entries(operations ?? {}).filter(([, binding]) => binding.operation.kind === "Action");
  const matchesTarget = (binding: ProjectionOperationBinding) => creating === (binding.target === undefined);
  if (actions.length === 1) return actions.find(([, binding]) => matchesTarget(binding))?.[0];
  const names = creating ? ["create", "save"] : ["save"];
  return names.find(expected => actions.some(([name, binding]) => name === expected && matchesTarget(binding)));
}

/** Whether a projection operation binding references row-level data (`{ row }` or `{ rowField }`). */
export function projectionOperationIsRowScoped(binding: Pick<ProjectionOperationBinding, "target" | "params">): boolean {
  if (binding.target && ("row" in binding.target || "rowField" in binding.target)) return true;
  return Object.values(binding.params ?? {}).some(param => "row" in param || "rowField" in param);
}

export const directProjectionPortsSchema = z.object({
  componentId: componentIdSchema,
  inputs: z.record(readKey, directProjectionInputTypeSchema),
  outputs: z.record(readKey, directPanelPortTypeSchema),
  data: z.record(readKey, directProjectionDataSchema).default({}),
  operations: z.record(panelLocalOperationNameSchema, projectionOperationBindingSchema).optional(),
  config: runtimeJsonObjectSchema,
  conversationEntry: panelConversationEntrySchema.optional(),
}).strict();
export type DirectProjectionPorts = z.infer<typeof directProjectionPortsSchema>;

/** Only a source-card registration adds a metric identity to the projection record. */
type ProjectionReadFacts = DirectProjectionPorts & { metricId?: string };

const positiveInteger = z.number().int().positive();
const recordFilterSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["eq", "ne", "contains", "gt", "lt", "gte", "lte", "null", "notnull"]),
  value: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
}).strict().superRefine(({ operator, value }, context) => {
  const nullCheck = operator === "null" || operator === "notnull";
  if (nullCheck ? value !== undefined : value === undefined || (operator === "contains" && typeof value !== "string")) {
    context.addIssue({
      code: "custom", path: ["value"],
      message: nullCheck ? "Null filters do not take a value" : operator === "contains" ? "Contains requires text" : "Filter value is required",
    });
  }
});
export const recordFiltersSchema = z.array(recordFilterSchema);
export const recordSortSchema = z.object({ field: z.string().min(1), order: z.enum(["asc", "desc"]) }).strict();

export const panelReadParameterSchemas = {
  productScope: productCatalogQuerySchema.shape.scope.removeDefault(),
  productSort: productCatalogQuerySchema.shape.sort.removeDefault(),
  productTemplate: productPanelCatalogQuerySchema.shape.template.unwrap(),
  productProjectionComponent: productProjectionComponentFilterSchema,
  productProjectionObjectType: productProjectionObjectTypeFilterSchema,
  applicationScope: applicationCatalogueScopeSchema,
  applicationSort: applicationCatalogueSortSchema,
  applicationGalleryCategory: z.enum(["all", "business", "agents", "build", "admin"]),
  favoriteTargetGroup: z.enum(["all", "apps", "applications", "agents", "dashboards", "dashboardCards", "sessions", "objects"]),
  favoritesOnly: z.boolean(),
  applicationFormSection: applicationFormSectionSchema.exclude(["create"]),
  applicationEntryId: z.string().min(1),
  formValues: formValuesSchema,
  panelFormValues: panelFormValuesSchema,
  changedField: fieldPath.nullable(),
  keyword: z.string(),
  agentKind: z.string().trim().min(1),
  agentId: z.string().uuid(),
  agentSkillTarget: agentSkillTargetSchema,
  offset: z.number().int().nonnegative(),
  limit: positiveInteger.max(100),
  workspaceCommit: workspaceCommitSchema,
  workspacePath: workspacePathSchema,
  workspaceDiffTarget: z.union([z.enum(["latest", "working"]), workspaceCommitSchema]),
  page: z.object({ number: positiveInteger, size: positiveInteger }).strict(),
  optionValues: z.array(runtimeJsonValueSchema),
  graphNode: platformOntologyNeighborsRequestSchema.shape.node,
  relationKinds: platformOntologyNeighborsRequestSchema.shape.relationKinds.unwrap(),
  layers: platformOntologyNeighborsRequestSchema.shape.layers.unwrap(),
  ontologyType: platformOntologyObjectsRequestSchema.shape.type,
  className: panelObjectRefSchema.shape.className,
  neighborsLimit: platformOntologyNeighborsRequestSchema.shape.limit.unwrap(),
  neighborDirection: platformOntologyNeighborsRequestSchema.shape.direction.unwrap(),
  nonNegativeInt: platformOntologyNeighborsRequestSchema.shape.offset.unwrap(),
  recordFilters: recordFiltersSchema,
  recordSort: recordSortSchema,
  ontologyParameter: runtimeJsonValueSchema,
  sort: runtimeJsonValueSchema,
  cursor: z.string(),
  scheduledRunId: runtimeIdSchema,
  triggerRef: panelObjectRefSchema.extend({ className: z.literal("platform:Trigger") }),
  size: positiveInteger,
  auditLogBusiness: z.enum(["BKNOWLEDGE", "BTERM", "BEXAMPLE", "SCHEMA", "ANALYSIS"]),
  auditLogOperation: z.enum(["ADD", "UPD", "DEL"]),
  knowledgeCountField: z.literal("status"),
  knowledgeStatus: z.enum(["all", "pending", "approved"]),
  feedbackCountField: z.enum(["sourceType", "rating"]),
  feedbackSourceType: z.enum(["all", "qa", "analysis_task"]),
  feedbackRating: z.enum(["all", "like", "dislike"]),
  skillFilePath: z.string().min(1),
  opsFilePath: z.string().min(1),
  autotestCaseEditMode: z.enum(["form", "json"]),
  autotestVerdict: z.enum(["all", "correct", "wrong", "abnormal"]),
  functionOperation: z.enum(["OPERATION_READ", "OPERATION_WRITE", "OPERATION_PRODUCT"]),
  metricViewStatus: z.enum(["PENDING_REVIEW", "PUBLISHED", "UNUSED"]),
  metricViewOrigin: z.enum(["USER", "SYSTEM"]),
};

type ReadInput = DirectProjectionPorts["inputs"][string];

export function directProjectionInputAccepts(target: ReadInput, source: DirectPanelPortType): boolean {
  return target.kind === "json" ? true : panelPortAccepts(target, source);
}

export function panelReadInputMatches(parameter: PanelReadParameterId, input: ReadInput | undefined): boolean {
  switch (parameter) {
    case "changedField":
    case "keyword":
    case "agentKind":
    case "agentId":
    case "agentSkillTarget":
    case "workspaceCommit":
    case "workspacePath":
    case "workspaceDiffTarget":
    case "ontologyType":
    case "className":
    case "neighborDirection":
    case "cursor":
    case "scheduledRunId":
    case "auditLogBusiness":
    case "auditLogOperation":
    case "knowledgeCountField":
    case "knowledgeStatus":
    case "feedbackCountField":
    case "feedbackSourceType":
    case "feedbackRating":
    case "skillFilePath":
    case "opsFilePath":
    case "autotestCaseEditMode":
    case "autotestVerdict":
    case "functionOperation":
    case "metricViewStatus":
    case "metricViewOrigin":
    case "productScope":
    case "productSort":
    case "productProjectionComponent":
    case "productProjectionObjectType":
    case "applicationScope":
    case "applicationSort":
    case "applicationGalleryCategory":
    case "favoriteTargetGroup":
    case "applicationFormSection":
    case "applicationEntryId":
      return input?.kind === "scalar" && input.type === "string";
    case "productTemplate":
    case "favoritesOnly":
      return input?.kind === "scalar" && input.type === "boolean";
    case "size":
    case "offset":
    case "limit":
    case "neighborsLimit":
    case "nonNegativeInt":
      return input?.kind === "scalar" && input.type === "number";
    case "ontologyParameter":
    case "sort":
      return input !== undefined;
    case "triggerRef":
      return input?.kind === "object" && input.objectType === "platform:Trigger";
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

export function projectionReadReference(projection: DirectProjectionPorts, source: DirectProjectionData["source"]): OntologyElementRef | undefined {
  if ("type" in source) return source.type;
  const id = directObjectSourceType(projection, source.object);
  return id === undefined ? undefined : { kind: id.startsWith("platform:") ? "PlatformObjectType" : "ObjectType", id };
}

/** The domain owner validates these identities at registration and resolves them again at use. */
export function projectionReadReferences(projection: ProjectionReadFacts): readonly OntologyElementRef[] {
  const references = new Map<string, OntologyElementRef>();
  for (const { source } of Object.values(projection.data ?? {})) {
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

/**
 * Resolve the object type of each row returned by a collection read: prefers the read declaration's explicit `rowType`
 * (for cross-type child collections such as `platform:Application.usedPanels` -> `platform:ProductPanel`), falling back
 * to the read's owner object type.
 */
export function directReadRowType(projection: DirectProjectionPorts, data: DirectProjectionData): string | undefined {
  const declaration = directReadDeclaration(projection, data);
  if (declaration?.rowType) return declaration.rowType;
  return projectionReadReference(projection, data.source)?.id;
}

/** The named key is known either to the fixed signature or to the resolved owner object. */
export function panelReadParameterId(declaration: PlatformReadDeclaration, name: string): PanelReadParameterId | undefined {
  return declaration.parameterMode === "owner" ? declaration.parameter : declaration.params[name];
}

/**
 * A read parameter without a projection mapping is an input with the same name and the type in the read signature.
 * A member's state or output binding supplies that input before any component runtime parameter can.
 */
export function authoredReadParameterSource(
  params: DirectProjectionData["params"],
  name: string,
  member?: Pick<PanelMember, "inputs" | "outputs">,
): DirectProjectionData["params"][string] | Exclude<PanelMemberInput, { literal: unknown }> | undefined {
  if (Object.hasOwn(params, name)) return params[name];
  const input = member?.inputs?.[name];
  return input && !("literal" in input) ? input : member?.outputs?.[name];
}

/** A read bound to an identity field waits for the object supplying that field. */
export function readParameterUsesStateField(
  source: ReturnType<typeof authoredReadParameterSource>,
  member: Pick<PanelMember, "inputs">,
): boolean {
  const binding = source && "input" in source ? member.inputs?.[source.input] : source;
  return binding !== undefined && "field" in binding;
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
  for (const [name, data] of Object.entries(projection.data ?? {})) {
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
  for (const [name, { target, params }] of Object.entries(projection.operations ?? {})) {
    if (target && "input" in target) {
      const port = projection.inputs[target.input];
      if (port?.kind !== "object" && port?.kind !== "object-union" && port?.kind !== "list")
        issue(["operations", name, "target", "input"], "The operation needs a declared object, object-union or list input");
    }
    for (const [param, source] of Object.entries(params ?? {})) {
      if ("input" in source && !Object.hasOwn(projection.inputs, source.input)) {
        issue(
          ["operations", name, "params", param, "input"],
          `Operation parameter '${param}' references undeclared input '${source.input}'`,
        );
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

/** How a field shown as a status tag reads at a glance. */
export const panelFieldToneSchema = z.enum(["default", "info", "success", "warning", "danger"]);
export type PanelFieldTone = z.infer<typeof panelFieldToneSchema>;

/** Scalar field values carried directly in a generic panel record. */
export const panelRecordFieldScalarSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
]);
export type PanelRecordFieldScalar = z.infer<typeof panelRecordFieldScalarSchema>;

/** Localized display text keyed by BCP 47 locale tag (for example `zh-CN`, `en`). */
export const panelRecordLocalizedFieldValueSchema = z.object({
  kind: z.literal("localized"),
  values: z.record(z.string().min(1), z.string()),
}).strict();
export type PanelRecordLocalizedFieldValue = z.infer<typeof panelRecordLocalizedFieldValueSchema>;

/** Clickable reference to another ontology object carried directly as a record field value. */
export const panelRecordReferenceFieldValueSchema = z.object({
  kind: z.literal("reference"),
  className: panelObjectRefSchema.shape.className,
  primaryKey: panelObjectRefSchema.shape.primaryKey,
  label: z.string(),
}).strict();
export type PanelRecordReferenceFieldValue = z.infer<typeof panelRecordReferenceFieldValueSchema>;

/** Clickable reference to a parent-scoped child object carried directly as a record field value or inline array item. */
export const panelRecordChildReferenceFieldValueSchema = z.object({
  kind: z.literal("child-reference"),
  parent: panelObjectIdentitySchema,
  collection: z.string().min(1).max(200),
  primaryKey: panelObjectRefSchema.shape.primaryKey,
  label: z.string(),
}).strict();
export type PanelRecordChildReferenceFieldValue = z.infer<typeof panelRecordChildReferenceFieldValueSchema>;

/** Structured JSON payload carried by a record field (for example nested tool lists or schemas). */
export const panelRecordJsonFieldValueSchema = z.object({
  kind: z.literal("json"),
  value: runtimeJsonValueSchema,
}).strict();
export type PanelRecordJsonFieldValue = z.infer<typeof panelRecordJsonFieldValueSchema>;

/** Tagged display value carrying its own semantic tone (and optional platform icon), usable as a field value or array item. */
export const panelRecordTagFieldValueSchema = z.object({
  kind: z.literal("tag"),
  label: z.string(),
  tone: panelFieldToneSchema.optional(),
  icon: z.string().min(1).optional(),
}).strict();
export type PanelRecordTagFieldValue = z.infer<typeof panelRecordTagFieldValueSchema>;

/** Allowed element types inside an array-valued record field. */
export const panelRecordFieldArrayItemSchema = z.union([
  panelRecordFieldScalarSchema,
  panelRecordReferenceFieldValueSchema,
  panelRecordChildReferenceFieldValueSchema,
  panelRecordTagFieldValueSchema,
]);
export type PanelRecordFieldArrayItem = z.infer<typeof panelRecordFieldArrayItemSchema>;

/**
 * Strongly typed value of one field in `PanelRecord.fields`.
 * Empty values must omit the field key rather than storing `null` or `undefined`.
 */
export const panelRecordFieldValueSchema = z.union([
  panelRecordFieldScalarSchema,
  panelRecordLocalizedFieldValueSchema,
  panelRecordReferenceFieldValueSchema,
  panelRecordChildReferenceFieldValueSchema,
  panelRecordJsonFieldValueSchema,
  panelRecordTagFieldValueSchema,
  z.array(panelRecordFieldArrayItemSchema),
]);
export type PanelRecordFieldValue = z.infer<typeof panelRecordFieldValueSchema>;

export const panelRecordSchema = z.object({
  primaryKey: panelObjectRefSchema.shape.primaryKey,
  /** Optional real object type when a query returns heterogeneous or dynamically selected records. */
  className: panelObjectRefSchema.shape.className.optional(),
  label: z.string(),
  subtitle: z.string().optional(),
  fields: z.record(panelRecordFieldValueSchema),
  /** Field names supplied by the owner in the reader's locale, keyed by the names in fields. */
  fieldLabels: z.record(z.string()).optional(),
  /** The tone of a field that shows as a status tag, by field name. */
  tones: z.record(panelFieldToneSchema).optional(),
  /** A field's values as separate tags, by field name. */
  tags: z.record(z.array(z.string())).optional(),
  /**
   * The display text an owner gives a field's value, by field name (`{"status": "Approved"}`), shaped like `tones`:
   * one value per field in a record. Presentation only — filtering, sorting, forms and the operations that read the
   * record all use the value in `fields`.
   */
  valueLabels: z.record(z.string().min(1)).optional(),
  /** Display field keys (including label and subtitle). Omit this property when nothing matched. */
  highlights: z.record(z.array(panelTextHighlightRangeSchema).min(1))
    .refine(fields => Object.keys(fields).length > 0, "Omit highlights when there are no matches").optional(),
  /**
   * Owner-declared scalar read-only outputs for this record (for example permission conclusions or navigation paths).
   * The runtime publishes only keys explicitly declared in the read's `outputs` contract.
   */
  outputs: z.record(panelRecordFieldScalarSchema.nullable()).optional(),
}).strict();
export type PanelRecord = z.infer<typeof panelRecordSchema>;
export const panelRecordListSchema = z.array(panelRecordSchema);

/**
 * Resolve a record's real ontology object reference (`className` + `primaryKey`), preferring the record's own
 * `className` for heterogeneous lists and falling back to the query/member's known object type.
 */
export function panelRecordObjectRef(
  record: Pick<PanelRecord, "primaryKey" | "className">,
  fallbackClassName?: string,
): PanelObjectRef {
  const className = record.className ?? fallbackClassName;
  if (!className) {
    throw new Error(`Record '${record.primaryKey}' has no className and no fallbackClassName was provided`);
  }
  return panelObjectRefSchema.parse({ className, primaryKey: record.primaryKey });
}

export interface PanelRecordItemKeyOptions {
  /** Set true for heterogeneous lists so the itemKey carries `{ className, primaryKey }`; false forces scalar `primaryKey`. */
  readonly heterogeneous?: boolean;
  /** Fallback object type used when constructing `{ className, primaryKey }` for a record without `className`. */
  readonly fallbackClassName?: string;
}

/**
 * Canonical row key for batch row-operation availability maps (`rowOperations`), shared by server list reads and
 * `ObjectList.vue`: uses `${className}:${primaryKey}` when a className is known, else `primaryKey`.
 */
export function panelRowOperationKey(
  record: Pick<PanelRecord, "primaryKey" | "className">,
  fallbackClassName?: string,
): string {
  const className = record.className ?? fallbackClassName;
  return className ? `${className}:${record.primaryKey}` : record.primaryKey;
}

/**
 * Construct the canonical `itemKey` for a list row:
 * - Homogeneous list (`heterogeneous: false`, or omitted when `record.className` is absent): `record.primaryKey`.
 * - Heterogeneous list (`heterogeneous: true`, or omitted when `record.className` is present): `{ className, primaryKey }`.
 */
export function panelRecordItemKey(
  record: Pick<PanelRecord, "primaryKey" | "className">,
  options: PanelRecordItemKeyOptions = {},
): PanelMemberItemKey {
  const useObjectRef = options.heterogeneous ?? (record.className !== undefined);
  if (useObjectRef) {
    return panelRecordObjectRef(record, options.fallbackClassName);
  }
  return panelObjectRefSchema.shape.primaryKey.parse(record.primaryKey);
}

/**
 * Match a list record against a canonical row `itemKey` (`string` primaryKey or `{ className, primaryKey }`).
 * Returns `false` (never throws) when an object-ref `itemKey` cannot resolve a `className` on the record.
 */
export function matchPanelRecordItemKey(
  record: Pick<PanelRecord, "primaryKey" | "className">,
  itemKey: PanelMemberItemKey,
  fallbackClassName?: string,
): boolean {
  if (typeof itemKey === "string") {
    return record.primaryKey === itemKey;
  }
  const className = record.className ?? fallbackClassName;
  if (!className) return false;
  return className === itemKey.className && record.primaryKey === itemKey.primaryKey;
}

function localeFallbackChain(locale: string | undefined): string[] {
  if (!locale) return [];
  const normalized = locale.trim();
  if (!normalized) return [];
  const parts = normalized.split("-").filter(Boolean);
  const candidates: string[] = [];
  for (let len = parts.length; len >= 1; len -= 1) {
    candidates.push(parts.slice(0, len).join("-"));
  }
  return candidates;
}

function lookupLocalizedValue(values: Readonly<Record<string, string>>, tag: string): string | undefined {
  if (Object.hasOwn(values, tag)) {
    const exact = values[tag];
    if (exact !== undefined && exact.trim().length > 0) return exact;
  }
  const lower = tag.toLowerCase();
  for (const [key, text] of Object.entries(values)) {
    if (key.toLowerCase() === lower && text.trim().length > 0) return text;
  }
  return undefined;
}

/**
 * Extract plain display/search text from any `PanelRecordFieldValue`:
 * - `localized`: resolves `locale` (for example `zh-CN` -> `zh`) -> `fallbackLocale` -> first non-empty entry in `values`.
 * - `reference` / `child-reference`: returns `label || primaryKey`.
 * - `tag`: returns `label`.
 * - `json`: scalar converts to string (`null` -> `""`), object/array serializes with `JSON.stringify`.
 * - array: joins non-empty element texts with `", "`.
 * - boolean: returns `"true"` / `"false"` for search and plain-text fallback; UI layers such as `ObjectList` and
 *   `ObjectSummary` localize boolean values for the reader's language.
 */
export function panelRecordFieldText(
  value: PanelRecordFieldValue | undefined,
  locale?: string,
  fallbackLocale?: string,
): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map(item => panelRecordFieldText(item, locale, fallbackLocale))
      .filter(part => part.length > 0)
      .join(", ");
  }
  if (value.kind === "reference" || value.kind === "child-reference") return value.label || value.primaryKey;
  if (value.kind === "tag") return value.label;
  if (value.kind === "localized") {
    for (const tag of [...localeFallbackChain(locale), ...localeFallbackChain(fallbackLocale)]) {
      const matched = lookupLocalizedValue(value.values, tag);
      if (matched !== undefined) return matched;
    }
    for (const text of Object.values(value.values)) {
      if (text.trim().length > 0) return text;
    }
    return "";
  }
  const payload = value.value;
  if (payload === null) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
  return JSON.stringify(payload);
}

/** Plain-text notices localized by the read owner and displayed alongside the available results. */
const panelReadDiagnostics = z.array(z.string()).optional();
export const panelRecordQuerySchema = z.object({
  rows: panelRecordListSchema,
  /** Readable column labels for the collection, including when no rows match. */
  fieldLabels: z.record(z.string()).optional(),
  hasMore: z.boolean().optional(),
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
    /** Presentation only changes how the string is drawn: a plain input (default) or a multiline Markdown editor that counts characters as the reader writes. */
    presentation: z.enum(["input", "markdown"]).optional(),
    secret: z.boolean().optional(),
    clearable: z.boolean().optional(),
    placeholder: z.string().nullish(), maxLength: z.number().int().positive().optional(),
    rows: positiveInteger.optional(),
    variables: z.array(z.object({
      label: z.string().min(1),
      emptyHint: z.string().min(1).optional(),
      items: z.array(z.object({
        label: z.string().min(1),
        value: z.string().min(1),
        badge: z.string().min(1).optional(),
      }).strict()),
    }).strict()).optional(),
    /** Collapse variable groups behind a toggle bar (collapsed by default). */
    variablesCollapsible: z.boolean().optional(),
    /** Variable picker layout: inline `chips` (default) or three-column `rows` (label | badge | code). */
    variablesPresentation: z.enum(["chips", "rows"]).optional(),
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
    /** Enable local option filtering in dropdown presentation. */
    filterable: z.boolean().optional(),
    /** Allow clearing the current selection directly in dropdown presentation. */
    clearable: z.boolean().optional(),
    /** Collapse selected multiple-choice tags into a summary tag with tooltip. */
    collapseTags: z.boolean().optional(),
    placeholder: z.string().nullish(),
    /** The kind defines the value and selection rules. Presentation only changes how choices are drawn. */
    presentation: z.enum(["dropdown", "radio", "checkbox", "checklist", "tree", "tag"]).optional(),
    /** Named selections of declared options, for multiple selection only. */
    presets: z.array(z.object({
      label: z.string().min(1),
      values: z.array(panelFormOptionValueSchema),
    }).strict()).optional(),
  }).strict(),
  z.object({
    kind: z.literal("choice-matrix"),
    /** Shared tier choices for every row; same shape as select options. */
    options: z.array(panelFormOptionSchema),
    /** Presentation only changes how rows are drawn: `cards` (default) or compact `table` with segmented buttons. */
    presentation: z.enum(["cards", "table"]).optional(),
    /** Optional table header label for the row-name column when `presentation` is `"table"`. */
    rowHeader: z.string().min(1).optional(),
    /** Optional table header label for the choice column when `presentation` is `"table"`. */
    choiceHeader: z.string().min(1).optional(),
    rows: z.array(z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      description: z.string().nullable().optional(),
      badge: z.string().min(1).optional(),
      /** Visually indent this row as a child of the preceding row (e.g. a metric under an attribute). */
      indent: z.boolean().optional(),
      disabled: z.boolean(),
      disabledReason: z.string().min(1).nullable(),
    }).strict().refine(
      (row) => row.disabled === (row.disabledReason !== null),
      "A disabled row must explain why it is unavailable",
    )),
  }).strict(),
  z.object({ kind: z.literal("switch") }).strict(),
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
  z.object({
    kind: z.literal("number"),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    precision: z.number().int().nonnegative().optional(),
    /** Presentation only changes how the numeric value is drawn (`input` default or `stepper`). */
    presentation: z.enum(["input", "stepper"]).optional(),
  }).strict(),
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
  /** Presentation only changes how rows are drawn: bordered `cards` (default), single-row `inline` grid, or compact `table`. */
  presentation: z.enum(["cards", "inline", "table"]).optional(),
  /** Grid column count inside each item card (`1` to `4`). */
  columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  /** Display a 1-based sequence number badge on each card item. */
  numbered: z.boolean().optional(),
  /** Whether Move Up / Move Down controls are offered; defaults to `true` for cards and `false` for inline/table. */
  reorderable: z.boolean().optional(),
  /** When true, the row set is fixed by the owner (no Add, Remove, or Reorder controls). */
  fixedRows: z.boolean().optional(),
  /** Optional owner-localized label for the Add row button. */
  addLabel: z.string().min(1).optional(),
  /** Optional owner-localized empty-state message when no rows are present. */
  emptyText: z.string().min(1).optional(),
}).strict();

const variantKey = z.string().min(1).refine(
  value => !["__proto__", "constructor", "prototype"].includes(value),
  "Reserved key",
);

const objectControl = z.object({
  kind: z.literal("object"),
  /** Initial value when explicitly added. Removing an object writes null. */
  defaultObject: runtimeJsonObjectSchema.optional(),
  /** Relative JSON Pointer to a fixed-option scalar select or hidden discriminator in `fields` choosing the active variant. */
  variantBy: fieldPath.optional(),
  /** Grid column count for this object's child fields (`1` to `4`). */
  columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  /** Visual framing of the nested object group: `plain` (default) or shaded `panel`. */
  presentation: z.enum(["plain", "panel"]).optional(),
}).strict();

const formSubmitOn = z.enum(["manual", "blur", "change"]).optional();

const fieldShape = z.object({
  path: fieldPath,
  label: z.string().min(1),
  /** JSON Schema for this value, derived from the owner's save schema for form consumers. */
  valueSchema: runtimeJsonObjectSchema,
  required: z.boolean(),
  help: z.string().nullish(),
  /** Non-blocking owner warning shown on this field (for example deprecation or side-effect guidance). */
  warning: z.string().min(1).optional(),
  defaultValue: runtimeJsonValueSchema.optional(),
  readOnly: z.boolean(),
  readOnlyReason: z.string().min(1).optional(),
  refreshOnChange: z.boolean().optional(),
  submitOn: formSubmitOn,
  /** In a multi-column grid, span across all columns instead of occupying a single column cell. */
  fullWidth: z.boolean().optional(),
  advanced: z.literal(true).optional().describe(
    "Group this field with the advanced fields at the end of its form, object, or array row. The group starts collapsed and opens when it contains a field error.",
  ),
  section: z.string().min(1).optional().describe(
    "The key of the form section, among the form's sections, this top-level field is drawn in.",
  ),
}).strict();

export type PanelFormObjectControl = z.infer<typeof objectControl> & {
  fields: PanelFormField[];
  /** Additional child fields per option of `variantBy`; options with no extra fields may be omitted or empty. */
  variants?: Record<string, PanelFormField[]>;
};

export type PanelFormField = z.infer<typeof fieldShape> & {
  control:
    | z.infer<(typeof simpleControls)[number]>
    | (z.infer<typeof arrayControl> & { itemFields: PanelFormField[] })
    | PanelFormObjectControl;
};

function fieldPathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

const childFields = z.array(z.lazy((): z.ZodType<PanelFormField> => panelFormFieldSchema));
const variantFieldsMap = z.record(variantKey, childFields);
const controlSchema = z.discriminatedUnion("kind", [
  ...simpleControls,
  // Row paths are relative. Edits, refreshes and errors address the current absolute paths.
  arrayControl.extend({ itemFields: childFields }).strict(),
  // Child paths are relative to the object. An untouched, omitted object stays absent.
  objectControl.extend({
    fields: childFields,
    variants: variantFieldsMap.optional(),
  }).strict(),
]);

export const panelFormFieldSchema = fieldShape.extend({ control: controlSchema }).superRefine(({ control }, ctx) => {
  if (control.kind === "choice-matrix") {
    if (new Set(control.rows.map(row => row.key)).size !== control.rows.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["control", "rows"], message: "Row keys must be unique",
      });
    if (control.options.some(option => typeof option.value === "object")
      || new Set(control.options.map(option => option.value)).size !== control.options.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["control", "options"], message: "Tier values must be unique strings or numbers",
      });
    return;
  }
  if (control.kind === "number") {
    if (control.min !== undefined && control.max !== undefined && control.min > control.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["control", "min"],
        message: "Minimum value must be less than or equal to maximum value",
      });
    }
    return;
  }
  if (control.kind === "select") {
    const { multiple, presentation, presets, collapseTags } = control;
    if ((multiple && (presentation === "radio" || presentation === "tag"))
      || (!multiple && (presentation === "checkbox" || presentation === "checklist" || presentation === "tree")))
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["control", "presentation"],
        message: "Radio and tag require single selection and checkbox, checklist, or tree requires multiple selection",
      });
    if (!multiple && collapseTags)
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["control", "collapseTags"], message: "collapseTags requires multiple selection",
      });
    if (!multiple && presets)
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["control", "presets"], message: "Presets require multiple selection",
      });
    presets?.forEach((preset, presetIndex) => preset.values.forEach((value, valueIndex) => {
      if (!findPanelFormOption(control.options, value))
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["control", "presets", presetIndex, "values", valueIndex],
          message: "Preset values must name declared options",
        });
    }));
    if (!control.options.some(option => typeof option.value === "object")) return;
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
    return;
  }
  if (control.kind !== "object") return;
  const { variantBy, variants } = control;
  // An object a reader fills must say which child fields it has; without any, a form draws a field with nothing in it,
  // which reads as no value rather than as a mistake. A whole JSON document the reader takes as source is a `code`
  // control instead, and rows of the same fields are an `object-array`.
  if (control.fields.length === 0)
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["control", "fields"],
      message: "An object control must declare the child fields a reader fills; use a code control for a whole JSON document",
    });
  if (variantBy === undefined && variants === undefined) return;
  if (variantBy === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["control", "variantBy"],
      message: "Object control with variants must define variantBy",
    });
    return;
  }
  if (variants === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["control", "variants"],
      message: "Object control with variantBy must define variants",
    });
    return;
  }

  const discriminators = control.fields.filter(field => field.path === variantBy);
  const discriminator = discriminators[0];
  if (discriminators.length !== 1 || !discriminator || (discriminator.control.kind !== "select" && discriminator.control.kind !== "hidden")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["control", "variantBy"],
      message: `variantBy '${variantBy}' must point to a unique select or hidden field in fields`,
    });
    return;
  }
  let optionKeys: Set<string> | null = null;
  if (discriminator.control.kind === "select") {
    const select = discriminator.control;
    if (select.multiple) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["control", "variantBy"],
        message: `variantBy '${variantBy}' cannot point to a multi-select field`,
      });
      return;
    }
    if (select.allowCreate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["control", "variantBy"],
        message: `variantBy '${variantBy}' cannot point to an allowCreate select field`,
      });
      return;
    }
    if (select.options.some(option => typeof option.value !== "string" && typeof option.value !== "number")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["control", "variantBy"],
        message: `variantBy '${variantBy}' select options must be scalar values`,
      });
      return;
    }
    optionKeys = new Set<string>();
    for (const option of select.options) {
      const key = String(option.value);
      if (optionKeys.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["control", "variantBy"],
          message: `variantBy '${variantBy}' select options must have unique scalar values`,
        });
        return;
      }
      optionKeys.add(key);
    }
  }

  const commonPaths = control.fields.map(field => field.path);
  for (const [key, variantFields] of Object.entries(variants)) {
    if (optionKeys !== null && !optionKeys.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["control", "variants", key],
        message: `Variant '${key}' does not match any option of '${variantBy}'`,
      });
    }
    const seen: string[] = [];
    for (let index = 0; index < variantFields.length; index++) {
      const childPath = variantFields[index]!.path;
      const commonConflict = commonPaths.find(common => fieldPathsOverlap(common, childPath));
      if (commonConflict !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["control", "variants", key, index, "path"],
          message: `Variant '${key}' field '${childPath}' conflicts with common field '${commonConflict}'`,
        });
      }
      const duplicateConflict = seen.find(previous => fieldPathsOverlap(previous, childPath));
      if (duplicateConflict !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["control", "variants", key, index, "path"],
          message: `Variant '${key}' field '${childPath}' conflicts with '${duplicateConflict}'`,
        });
      }
      seen.push(childPath);
    }
  }
});

function pointerTokens(path: string): string[] {
  return path.split("/").slice(1).map(token => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function isPlainJsonObject(value: RuntimeJsonValue | undefined): value is PanelFormValues {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPointerValue(node: RuntimeJsonValue | undefined, path: string): RuntimeJsonValue | undefined {
  let current = node;
  for (const token of pointerTokens(path)) {
    if (!isPlainJsonObject(current) || !Object.prototype.propertyIsEnumerable.call(current, token)) return undefined;
    current = current[token];
  }
  return current;
}

function writePointerValue(object: PanelFormValues, path: string, value: RuntimeJsonValue): PanelFormValues {
  const tokens = pointerTokens(path);
  const update = (node: RuntimeJsonValue | undefined, index: number): RuntimeJsonValue => {
    if (index === tokens.length) return value;
    const token = tokens[index]!;
    const current = isPlainJsonObject(node) ? node : {};
    return { ...current, [token]: update(current[token], index + 1) };
  };
  return update(object, 0) as PanelFormValues;
}

function deletePointerValue(
  object: PanelFormValues,
  path: string,
  activePaths: readonly string[],
): PanelFormValues {
  const tokens = pointerTokens(path);
  const remove = (
    node: PanelFormValues,
    index: number,
    prefix: string,
  ): { next: PanelFormValues; removed: boolean } => {
    const token = tokens[index]!;
    if (!Object.prototype.propertyIsEnumerable.call(node, token)) return { next: node, removed: false };
    if (index === tokens.length - 1) {
      const { [token]: _, ...rest } = node;
      return { next: rest, removed: true };
    }
    const child = node[token];
    if (!isPlainJsonObject(child)) return { next: node, removed: false };
    const escaped = token.replaceAll("~", "~0").replaceAll("/", "~1");
    const childPath = `${prefix}/${escaped}`;
    const result = remove(child, index + 1, childPath);
    if (!result.removed) return { next: node, removed: false };
    if (Object.keys(result.next).length === 0 && !activePaths.includes(childPath)) {
      const { [token]: _, ...rest } = node;
      return { next: rest, removed: true };
    }
    return { next: { ...node, [token]: result.next }, removed: true };
  };
  return remove(object, 0, "").next;
}

/** Every declared child field of an object control, including fields from every declared variant. */
export function panelFormObjectAllFields(control: PanelFormObjectControl): readonly PanelFormField[] {
  if (!control.variants) return control.fields;
  const variantFields = Object.values(control.variants).flat();
  return variantFields.length > 0 ? [...control.fields, ...variantFields] : control.fields;
}

/** The active variant key for an object control's current value, or undefined when none matches a declared option. */
export function panelFormObjectActiveVariant(
  control: PanelFormObjectControl,
  value: RuntimeJsonValue | undefined,
): string | undefined {
  if (!control.variantBy || !control.variants || !isPlainJsonObject(value)) return undefined;
  const discriminator = control.fields.find(field => field.path === control.variantBy);
  if (!discriminator) return undefined;
  const current = readPointerValue(value, control.variantBy);
  if (typeof current !== "string" && typeof current !== "number") return undefined;
  if (discriminator.control.kind === "hidden") {
    const key = String(current);
    return Object.hasOwn(control.variants, key) ? key : undefined;
  }
  if (discriminator.control.kind !== "select") return undefined;
  const matched = discriminator.control.options.find(option => option.value === current);
  return matched === undefined ? undefined : String(matched.value);
}

/** The child fields active for an object control's current value: common fields plus the active variant's fields. */
export function panelFormObjectActiveFields(
  control: PanelFormObjectControl,
  value: RuntimeJsonValue | undefined,
): readonly PanelFormField[] {
  const variant = panelFormObjectActiveVariant(control, value);
  if (variant === undefined || !control.variants) return control.fields;
  const extra = control.variants[variant];
  return extra && extra.length > 0 ? [...control.fields, ...extra] : control.fields;
}

function pruneObjectControl(control: PanelFormObjectControl, value: PanelFormValues): PanelFormValues {
  let next = value;
  const activeFields = panelFormObjectActiveFields(control, next);
  if (control.variants) {
    const activeVariant = panelFormObjectActiveVariant(control, next);
    const activePaths = activeFields.map(field => field.path);
    for (const [key, variantFields] of Object.entries(control.variants)) {
      if (key === activeVariant) continue;
      for (const field of variantFields) {
        if (activePaths.some(activePath => fieldPathsOverlap(activePath, field.path))) continue;
        next = deletePointerValue(next, field.path, activePaths);
      }
    }
  }
  return pruneFieldsObject(activeFields, next);
}

function pruneFieldsObject(fields: readonly PanelFormField[], values: PanelFormValues): PanelFormValues {
  let next = values;
  for (const field of fields) {
    const { control } = field;
    if (control.kind !== "object" && control.kind !== "object-array") continue;
    const current = readPointerValue(next, field.path);
    if (control.kind === "object") {
      if (!isPlainJsonObject(current)) continue;
      const pruned = pruneObjectControl(control, current);
      if (pruned !== current) next = writePointerValue(next, field.path, pruned);
    } else if (Array.isArray(current)) {
      let changed = false;
      const prunedRows = current.map(row => {
        if (!isPlainJsonObject(row)) return row;
        const pruned = pruneFieldsObject(control.itemFields, row);
        if (pruned !== row) changed = true;
        return pruned;
      });
      if (changed) next = writePointerValue(next, field.path, prunedRows);
    }
  }
  return next;
}

/**
 * Return a copy of `values` with inactive object-variant field values stripped, recursively across nested objects,
 * active variant subfields, and object-array rows. Local edit drafts keep inactive values; submits send pruned values.
 */
export function pruneInactivePanelFormVariants(
  fields: readonly PanelFormField[],
  values: PanelFormValues,
): PanelFormValues {
  return pruneFieldsObject(fields, values);
}

/** The client's native owner request. The form's binding supplies the body mapping to that owner's existing schema. */
const formSaveRequestSchema = z.object({
  operation: z.string().min(1).optional(),
  method: z.enum(["POST", "PUT"]),
  path: z.string().startsWith("/"),
  /** Derived from the native request schema, including any owner-required wrapper or revision. */
  bodySchema: runtimeJsonObjectSchema,
}).strict();

/** Values and description returned together by the owner for the current target and caller. */
/** A part of an owner's form, drawn under its title and hint with the fields that name it, in the order given. */
export const panelFormSectionSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  hint: z.string().min(1).optional(),
}).strict();
export type PanelFormSection = z.infer<typeof panelFormSectionSchema>;

/** Opaque revision token returned with a form read and echoed back unchanged on save. */
export const panelFormRevisionSchema = z.union([z.number().int().positive().safe(), z.string().min(1)]);
export type PanelFormRevision = z.infer<typeof panelFormRevisionSchema>;

export const panelFormDescriptionSchema = z.object({
  submitOn: formSubmitOn,
  fields: z.array(panelFormFieldSchema),
  /** The form's sections in order; a form without them is one list of fields. */
  sections: z.array(panelFormSectionSchema).optional(),
  values: panelFormValuesSchema,
  /** Owner validation is part of a successful form read, alongside the current values. */
  errors: z.array(formFieldErrorSchema),
  /** Present only when the owner's save requires the revision returned with these values. */
  revision: panelFormRevisionSchema.optional(),
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

/** Target object types an operation accepts when it acts across multiple real ontology types (e.g. platform:Favorite). */
export const panelOperationTargetTypesSchema = z.object({
  platformTypes: z.array(z.string().min(1)).optional(),
  customerObjects: z.boolean().optional(),
}).strict().refine(
  value => (value.platformTypes?.length ?? 0) > 0 || value.customerObjects === true,
  "Target types must allow at least one platform type or customer objects",
);
export type PanelOperationTargetTypes = z.infer<typeof panelOperationTargetTypesSchema>;

/** Single source of truth for whether an operation accepts a concrete ontology object type. */
export function operationAcceptsTargetType(
  objectType: string,
  ownerType: string | undefined,
  targetTypes?: PanelOperationTargetTypes,
): boolean {
  if (!targetTypes) return ownerType !== undefined && objectType === ownerType;
  return objectType.startsWith("platform:")
    ? (targetTypes.platformTypes?.includes(objectType) ?? false)
    : targetTypes.customerObjects === true;
}

/** Human-readable target type description for authoring and runtime diagnostics. */
export function formatOperationTargetTypes(
  ownerType: string | undefined,
  targetTypes?: PanelOperationTargetTypes,
): string | undefined {
  if (!targetTypes) return ownerType;
  const parts: string[] = [...(targetTypes.platformTypes ?? [])];
  if (targetTypes.customerObjects) parts.push("customer objects");
  return parts.join(", ");
}

function portItemMatchesOperation(
  item: Extract<ReadInput, { kind: "object" | "object-union" }>,
  ownerType: string | undefined,
  targetTypes?: PanelOperationTargetTypes,
): boolean {
  if (item.kind === "object") {
    if (item.objectType === "@any") return targetTypes?.customerObjects === true;
    return operationAcceptsTargetType(item.objectType, ownerType, targetTypes);
  }
  return objectUnionTypes(item).some(type => operationAcceptsTargetType(type, ownerType, targetTypes));
}

/** An owner's only valid object, object-union or object-list port. Used by both author preflight and the server. */
export function panelOperationTargetPort(
  port: ReadInput | undefined,
  objectType: string | undefined,
  batch: boolean,
  targetTypes?: PanelOperationTargetTypes,
) {
  if (objectType === undefined && !targetTypes) return undefined;
  if ((port?.kind === "object" || port?.kind === "object-union") && portItemMatchesOperation(port, objectType, targetTypes))
    return port;
  if (port?.kind === "list" && batch && (port.items.kind === "object" || port.items.kind === "object-union")
    && portItemMatchesOperation(port.items, objectType, targetTypes))
    return port;
  return undefined;
}

/** Match a projection target to the selected owner declaration from the type table. */
export function projectionOperationTargetMatches(
  projection: Pick<DirectProjectionPorts, "inputs">,
  binding: ProjectionOperationBinding,
  declaration: Pick<PanelOperationDeclaration, "target" | "batch" | "targetTypes">,
  objectType?: string,
): boolean {
  const { target } = binding;
  if (declaration.target.source === "none") return target === undefined;
  if (!target) return declaration.target.source === "draft";
  if (objectType === undefined && !declaration.targetTypes) return false;
  if ("literal" in target) return operationAcceptsTargetType(target.literal.className, objectType, declaration.targetTypes);
  if ("row" in target || "rowField" in target) return declaration.target.source === "input";
  return panelOperationTargetPort(projection.inputs[target.input], objectType, declaration.batch, declaration.targetTypes) !== undefined;
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
  const draftSlot = manifest.members[member]?.operationDrafts?.[name]?.slot;
  let placed: PanelOperation["target"];
  if (kind === "form.save") placed = { source: "draft", slot: draftSlot ?? member };
  else if (target.source === "input") {
    const binding = manifest.members[member]?.inputs?.[target.input];
    if (binding && "state" in binding) placed = { source: "state", state: binding.state };
    else if (binding && "literal" in binding) placed = { source: "literal", literal: panelObjectRefSchema.parse(binding.literal) };
  } else placed = target;
  if (!placed && draftSlot && descriptor.effect === "write") {
    placed = { source: "draft", slot: draftSlot };
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
