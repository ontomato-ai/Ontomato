import { z } from "zod";
import { panelAddress } from "@ontomato/contracts/panel-host";
import { runtimeJsonObjectSchema, type RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { FormFieldError } from "@ontomato/contracts/form-fields";
import {
  panelFieldToneSchema,
  panelFormDescriptionSchema,
  panelReadParameterSchemas,
  type recordFiltersSchema,
  type recordSortSchema,
  type PanelFieldTone,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormValues,
  type PanelRecord,
  type PanelRecordQuery,
  type PanelRelationNeighbors,
} from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyNode } from "@ontomato/contracts/platform-ontology";
import { config } from "../../config/application";
import { tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/service-authentication";

/** One class attribute from the Java model catalog (GET /ontology/model/attributes). */
const attributeOptionSchema = z.object({
  value: z.union([z.string(), z.number()]),
  label: z.string().min(1),
  description: z.string().nullish(),
  tone: panelFieldToneSchema.optional(),
});
const classAttributesSchema = z.array(z.object({
  className: z.string(),
  name: z.string(),
  showName: z.string(),
  type: z.string(),
  attrDesc: z.string(),
  enable: z.boolean(),
  businessKey: z.boolean(),
  primaryKey: z.boolean(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  options: z.array(attributeOptionSchema).optional(),
  enum: z.array(z.string()).optional(),
}));
type ClassAttribute = z.infer<typeof classAttributesSchema>[number];

/** POST /data/getWholeClassDataByPage: the class's rows with the real total, or the owner's refusal. */
const classPageSchema = z.union([
  z.object({ success: z.literal(true), data: z.array(z.record(z.unknown())), total_count: z.number(), readable_fields: z.array(z.string()) }),
  z.object({ success: z.literal(false), code: z.literal("NO_VISIBLE_FIELDS"), message: z.string() }),
]);

/** POST /data/queryInfoByNode: the object's attribute values, or the owner's reason. */
const objectRecordSchema = z.union([
  z.object({ success: z.literal(true), data: z.object({ data: z.record(z.unknown()) }) }),
  z.object({
    success: z.literal(false),
    code: z.enum(["DATA_PERMISSION_DENIED", "OBJECT_NOT_FOUND", "QUERY_FAILED"]),
    message: z.string(),
  }),
]);

export interface CustomerOntologyNodeRef {
  className: string;
  primaryKey: string;
}

export interface CustomerOntologyQueryParams {
  search?: string;
  page?: { number: number; size: number };
  size?: number;
  filters?: z.infer<typeof recordFiltersSchema>;
  sort?: z.infer<typeof recordSortSchema>;
}

export interface CustomerOntologyFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

/**
 * The customer-ontology reads a projection can name: a class's rows, one object and standard edit/create forms
 * (an ObjectType source).
 * Changes to an object go through actions.
 */
export interface CustomerOntologyReadAdapter {
  query(typeId: string, params: CustomerOntologyQueryParams): Promise<PanelRecordQuery>;
  record(typeId: string, primaryKey: string): Promise<PanelRecord>;
  form(typeId: string, primaryKey: string, params?: CustomerOntologyFormParams): Promise<PanelFormDescription>;
  createForm(typeId: string, params?: CustomerOntologyFormParams): Promise<PanelFormDescription>;
}

const NEIGHBORS_LIMIT_DEFAULT = 50;

/** Row values cross the owner boundary as display text: null is empty, objects and arrays become JSON text. */
function displayText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** The class's primary-key attribute name; every stored class carries exactly one. */
function primaryKeyName(attributes: readonly ClassAttribute[]): string {
  return attributes.find(attribute => attribute.primaryKey)!.name;
}

/** The label joins the enabled business-key values in attribute order, falling back to the primary key. */
function recordLabel(attributes: readonly ClassAttribute[], primaryKey: string, row: Record<string, unknown>): string {
  const values = attributes.filter(attribute => attribute.enable && attribute.businessKey)
    .map(attribute => displayText(row[attribute.name]));
  return values.some(value => value !== "") ? values.join(" / ") : primaryKey;
}

/**
 * The declared option an attribute value matches, if the attribute declares option values. The owner decides which
 * option a value is, by the attribute's own type: text compares strings and a number compares numbers, never their text
 * forms — `1.50` and `1.5` are the same number but not the same text.
 */
function attributeOption(attribute: ClassAttribute | undefined, raw: unknown) {
  if (!attribute?.options || attribute.options.length === 0 || raw == null) return undefined;
  const type = normalizedAttributeType(attribute.type);
  if (INTEGER_TYPES.has(type) || NUMBER_TYPES.has(type)) {
    const number = typeof raw === "number"
      ? raw
      : (typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN);
    if (!Number.isFinite(number)) return undefined;
    return attribute.options.find(option => typeof option.value === "number" && option.value === number);
  }
  if (typeof raw !== "string") return undefined;
  return attribute.options.find(option => option.value === raw);
}

/** Map one owner row to the panel record shape; only the columns the row carries become fields. */
function panelRecord(className: string, attributes: readonly ClassAttribute[], row: Record<string, unknown>): PanelRecord {
  const primaryKey = displayText(row[primaryKeyName(attributes)]);
  const fields: Record<string, string> = {};
  const fieldLabels: Record<string, string> = {};
  const tones: Record<string, PanelFieldTone> = {};
  const valueLabels: Record<string, string> = {};
  for (const [name, value] of Object.entries(row)) {
    const attribute = attributes.find(item => item.name === name);
    fields[name] = displayText(value);
    fieldLabels[name] = attribute?.showName ?? name;
    const option = attributeOption(attribute, value);
    if (option?.tone) tones[name] = option.tone;
    // The value stays as stored; its declared display name rides beside it.
    if (option) valueLabels[name] = option.label;
  }
  return {
    className,
    primaryKey,
    label: recordLabel(attributes, primaryKey, row),
    fields,
    fieldLabels,
    ...(Object.keys(tones).length > 0 ? { tones } : {}),
    ...(Object.keys(valueLabels).length > 0 ? { valueLabels } : {}),
  };
}

/** The owner's reason for an unreadable object, by its code: a permission refusal answers forbidden, a missing object keeps its reason. */
function objectFailure(code: "DATA_PERMISSION_DENIED" | "OBJECT_NOT_FOUND" | "QUERY_FAILED", message: string): HttpError {
  if (code === "DATA_PERMISSION_DENIED") return new HttpError(403, message, "CUSTOMER_DATA_PERMISSION");
  if (code === "OBJECT_NOT_FOUND") return new HttpError(404, message, "OBJECT_NOT_FOUND");
  return new HttpError(502, message, "CUSTOMER_OBJECT_READ_FAILED");
}

function escapeJsonPointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

const INTEGER_TYPES = new Set(["int", "integer", "bigint", "long", "smallint", "tinyint"]);
const NUMBER_TYPES = new Set(["float", "double", "decimal", "numeric", "number"]);
const BOOLEAN_TYPES = new Set(["boolean", "bool"]);
const JSON_TYPES = new Set(["json", "jsonb", "object"]);
const ARRAY_TYPES = new Set(["array", "string[]", "list"]);

function normalizedAttributeType(type: string): string {
  return type.trim().toLowerCase();
}

/** Whether the attribute's choices come from declared option values (with display names and tones) rather than a plain enum. */
function hasDeclaredOptions(attribute: ClassAttribute): boolean {
  return Boolean(attribute.options && attribute.options.length > 0);
}

function attributeSelectOptions(attribute: ClassAttribute): {
  value: string | number;
  label: string;
  description: string | null;
  disabled: boolean;
  disabledReason: string | null;
  tone?: PanelFieldTone;
}[] | null {
  if (attribute.options && attribute.options.length > 0) {
    return attribute.options.map(option => ({
      value: option.value,
      label: option.label,
      description: option.description ?? null,
      disabled: false,
      disabledReason: null,
      ...(option.tone ? { tone: option.tone } : {}),
    }));
  }
  if (attribute.enum && attribute.enum.length > 0) {
    return attribute.enum.map(item => ({
      value: item,
      label: item,
      description: null,
      disabled: false,
      disabledReason: null,
    }));
  }
  return null;
}

function buildAttributeFormField(attribute: ClassAttribute, mode: "edit" | "create"): PanelFormField {
  const path = `/${escapeJsonPointer(attribute.name)}`;
  const label = attribute.showName.trim() || attribute.name;
  const help = attribute.attrDesc.trim() || undefined;
  const required = attribute.primaryKey || Boolean(attribute.required);
  const readOnly = (mode === "edit" && attribute.primaryKey) || Boolean(attribute.readOnly);
  const type = normalizedAttributeType(attribute.type);
  const options = attributeSelectOptions(attribute);

  let control: PanelFormField["control"];
  let valueSchema: Record<string, RuntimeJsonValue>;

  if (options && hasDeclaredOptions(attribute)) {
    // Declared option values are a convenience: a value outside them is still accepted and saved as given.
    control = { kind: "select", options, allowCreate: true };
    const choiceType = INTEGER_TYPES.has(type) || NUMBER_TYPES.has(type) ? "number" : "string";
    valueSchema = { title: label, type: required ? choiceType : [choiceType, "null"] };
  } else if (options) {
    control = { kind: "select", options };
    const optionValues = options.map(option => option.value);
    valueSchema = { title: label, enum: required ? optionValues : [...optionValues, null] };
  } else if (INTEGER_TYPES.has(type)) {
    control = { kind: "number" };
    valueSchema = { title: label, type: required ? "integer" : ["integer", "null"] };
  } else if (NUMBER_TYPES.has(type)) {
    control = { kind: "number" };
    valueSchema = { title: label, type: required ? "number" : ["number", "null"] };
  } else if (BOOLEAN_TYPES.has(type)) {
    control = { kind: "switch" };
    valueSchema = { title: label, type: "boolean" };
  } else if (type === "text") {
    control = { kind: "text", multiline: true, rows: 3 };
    valueSchema = { title: label, type: required ? "string" : ["string", "null"] };
  } else if (type === "datetime" || type === "timestamp") {
    control = { kind: "text", placeholder: "YYYY-MM-DD HH:mm:ss" };
    valueSchema = { title: label, type: required ? "string" : ["string", "null"], format: "date-time" };
  } else if (type === "date") {
    control = { kind: "text", placeholder: "YYYY-MM-DD" };
    valueSchema = { title: label, type: required ? "string" : ["string", "null"], format: "date" };
  } else if (type === "time") {
    control = { kind: "time" };
    valueSchema = { title: label, type: required ? "string" : ["string", "null"] };
  } else if (JSON_TYPES.has(type)) {
    control = { kind: "code", language: "json" };
    valueSchema = { title: label, type: ["object", "array", "null"] };
  } else if (ARRAY_TYPES.has(type)) {
    control = { kind: "string-array" };
    valueSchema = { title: label, type: "array", items: { type: "string" } };
  } else {
    control = { kind: "text" };
    valueSchema = { title: label, type: required ? "string" : ["string", "null"] };
  }

  return {
    path,
    label,
    valueSchema,
    required,
    ...(help ? { help } : {}),
    readOnly,
    control,
  };
}

function emptyAttributeValue(attribute: ClassAttribute): RuntimeJsonValue {
  const type = normalizedAttributeType(attribute.type);
  if (attributeSelectOptions(attribute)) return null;
  if (INTEGER_TYPES.has(type) || NUMBER_TYPES.has(type) || type === "time" || JSON_TYPES.has(type)) return null;
  if (BOOLEAN_TYPES.has(type)) return false;
  if (ARRAY_TYPES.has(type)) return [];
  return "";
}

function normalizeAttributeValue(attribute: ClassAttribute, raw: unknown): RuntimeJsonValue {
  if (raw === undefined || raw === null) return emptyAttributeValue(attribute);
  const type = normalizedAttributeType(attribute.type);
  const options = attributeSelectOptions(attribute);
  if (options && hasDeclaredOptions(attribute)) {
    const numeric = INTEGER_TYPES.has(type) || NUMBER_TYPES.has(type);
    if (numeric && typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (numeric && typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number(raw);
      // A value that does not parse stays as typed, so validation reports it instead of silently emptying the field.
      if (Number.isFinite(parsed)) return parsed;
    }
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
    return displayText(raw);
  }
  if (options) {
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
    return displayText(raw);
  }
  if (INTEGER_TYPES.has(type) || NUMBER_TYPES.has(type)) {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  }
  if (BOOLEAN_TYPES.has(type)) {
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    if (typeof raw === "string") return raw.trim().toLowerCase() === "true" || raw.trim() === "1";
    return false;
  }
  if (ARRAY_TYPES.has(type)) {
    if (Array.isArray(raw)) return raw.map(item => displayText(item));
    return [displayText(raw)];
  }
  if (JSON_TYPES.has(type)) {
    if (typeof raw === "string") {
      try {
        return JSON.parse(raw) as RuntimeJsonValue;
      } catch {
        return raw;
      }
    }
    return raw as RuntimeJsonValue;
  }
  return displayText(raw);
}

function validateAttributeValue(
  attribute: ClassAttribute,
  field: PanelFormField,
  value: RuntimeJsonValue | undefined,
  checkRequired: boolean,
): FormFieldError | null {
  const isEmpty = value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  if (checkRequired && field.required && !field.readOnly && isEmpty) {
    return { field: field.path, code: "required", message: `${field.label} is required` };
  }
  if (value === undefined || value === null) return null;
  const type = normalizedAttributeType(attribute.type);
  const options = attributeSelectOptions(attribute);
  if (options && !hasDeclaredOptions(attribute)) {
    if (!options.some(option => option.value === value)) {
      return { field: field.path, code: "invalid_option", message: `${field.label} must match one of the declared options` };
    }
    return null;
  }
  if (INTEGER_TYPES.has(type)) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { field: field.path, code: "invalid_number", message: `${field.label} must be an integer` };
    }
    return null;
  }
  if (NUMBER_TYPES.has(type)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { field: field.path, code: "invalid_number", message: `${field.label} must be a number` };
    }
    return null;
  }
  if (BOOLEAN_TYPES.has(type)) {
    if (typeof value !== "boolean") {
      return { field: field.path, code: "invalid_format", message: `${field.label} must be a boolean` };
    }
    return null;
  }
  if (ARRAY_TYPES.has(type)) {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
      return { field: field.path, code: "invalid_array", message: `${field.label} must be a list of strings` };
    }
    return null;
  }
  if (JSON_TYPES.has(type)) return null;
  if (typeof value !== "string") {
    return { field: field.path, code: type === "time" ? "invalid_time" : "invalid_format", message: `${field.label} must be a string` };
  }
  return null;
}

function buildCustomerFormDescription(
  typeId: string,
  attributes: readonly ClassAttribute[],
  mode: "edit" | "create",
  rawRow?: Readonly<Record<string, unknown>>,
  params?: CustomerOntologyFormParams,
): PanelFormDescription {
  const enabledAttributes = attributes.filter(attribute => attribute.enable);
  const fields = enabledAttributes.map(attribute => buildAttributeFormField(attribute, mode));
  const baseValues: PanelFormValues = {};
  for (const attribute of enabledAttributes) {
    baseValues[attribute.name] = rawRow === undefined
      ? emptyAttributeValue(attribute)
      : normalizeAttributeValue(attribute, rawRow[attribute.name]);
  }

  const submitted = params?.values;
  const values: PanelFormValues = { ...baseValues };
  const errors: FormFieldError[] = [];
  if (submitted !== undefined) {
    const checkRequired = (params?.changedField ?? null) === null;
    for (let index = 0; index < enabledAttributes.length; index++) {
      const attribute = enabledAttributes[index]!;
      const field = fields[index]!;
      if (!field.readOnly && Object.hasOwn(submitted, attribute.name)) {
        // A value typed into a declared-options field keeps the attribute's own type, like the stored value.
        values[attribute.name] = hasDeclaredOptions(attribute)
          ? normalizeAttributeValue(attribute, submitted[attribute.name])
          : submitted[attribute.name]!;
      }
      const error = validateAttributeValue(attribute, field, values[attribute.name], checkRequired);
      if (error) errors.push(error);
    }
  }

  const requiredNames = enabledAttributes
    .filter((_attribute, index) => fields[index]!.required)
    .map(attribute => attribute.name);
  const bodySchema: Record<string, RuntimeJsonValue> = {
    type: "object",
    properties: Object.fromEntries(enabledAttributes.map((attribute, index) => [attribute.name, fields[index]!.valueSchema])),
    ...(requiredNames.length > 0 && { required: requiredNames }),
  };

  return panelFormDescriptionSchema.parse({
    fields,
    values,
    errors,
    save: {
      method: mode === "edit" ? "PUT" : "POST",
      path: `/ontology/objects/${encodeURIComponent(typeId)}`,
      bodySchema,
    },
  });
}

type NeighborDirection = { direction: "outgoing" | "incoming"; targetClass: string };

type NeighborQueryResult =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; status: "refused" | "failed"; reason: string };

/** One relation's executed plan for the assembly. */
interface NeighborRelationRead {
  relationKind: string;
  label?: string;
  directions: (NeighborDirection & { result: NeighborQueryResult })[];
  unknownReason?: string;
}

function assembleCustomerNeighbors(
  anchor: CustomerOntologyNodeRef & { label: string },
  limit: number,
  offset: number,
  read: NeighborRelationRead,
  attributesOf: (className: string) => readonly ClassAttribute[],
  typeLabels: ReadonlyMap<string, string>,
): PanelRelationNeighbors {
  const severity = { ok: 0, refused: 1, failed: 2 } as const;
  const anchorRef = { className: anchor.className, primaryKey: anchor.primaryKey };
  const anchorTypeLabel = typeLabels.get(anchor.className);
  const edges: PanelRelationNeighbors["edges"] = [];
  const neighbors = new Map<string, PlatformOntologyNode>();
  let status: "ok" | "refused" | "failed" = read.unknownReason ? "failed" : "ok";
  let reason = read.unknownReason;
  let truncated = false;
  // A self-relation is one ordered edge stream: outgoing first, then incoming.
  // With just one direction the DSL already applied the offset.
  let skip = read.directions.length > 1 ? offset : 0;
  const directionOrder = { outgoing: 0, incoming: 1 };
  const directions = [...read.directions].sort((a, b) => directionOrder[a.direction] - directionOrder[b.direction]);

  for (const { direction, targetClass, result } of directions) {
    if (!result.ok) {
      if (severity[result.status] > severity[status]) {
        status = result.status;
        reason = result.reason;
      }
      continue;
    }
    const take = limit - edges.length;
    truncated = truncated || result.rows.length > skip + take;
    const page = result.rows.slice(skip, skip + take);
    skip = Math.max(0, skip - result.rows.length);
    const attributes = attributesOf(targetClass);
    const targetPrimaryKey = primaryKeyName(attributes);
    for (const row of page) {
      const neighborPrimaryKey = displayText(row[targetPrimaryKey]);
      const neighbor = { className: targetClass, primaryKey: neighborPrimaryKey };
      edges.push({
        id: `${read.relationKind}:${direction}:${anchor.primaryKey}:${neighborPrimaryKey}`,
        relationKind: read.relationKind,
        ...(read.label && { label: read.label }),
        from: direction === "outgoing" ? anchorRef : neighbor,
        to: direction === "outgoing" ? neighbor : anchorRef,
        direction,
        derived: false,
      });
      const neighborKey = `${targetClass}:${neighborPrimaryKey}`;
      if (!neighbors.has(neighborKey)) {
        const typeLabel = typeLabels.get(targetClass);
        neighbors.set(neighborKey, {
          ...neighbor,
          label: recordLabel(attributes, neighborPrimaryKey, row),
          ...(typeLabel && { typeLabel }),
          layer: "fact",
        });
      }
    }
  }

  return {
    node: { ...anchorRef, label: anchor.label, ...(anchorTypeLabel && { typeLabel: anchorTypeLabel }), layer: "fact" },
    neighbors: [...neighbors.values()],
    edges,
    relations: [{
      relationKind: read.relationKind,
      ...(read.label && { label: read.label }),
      status,
      edgeCount: edges.length,
      ...(reason ? { reason } : {}),
      truncated,
    }],
    nextOffset: status === "ok" && truncated ? offset + edges.length : null,
    total: status === "ok" && !truncated && (offset === 0 || edges.length > 0) ? offset + edges.length : null,
  };
}

export function customerQueryParams(params: Record<string, unknown>): CustomerOntologyQueryParams {
  const read = panelReadParameterSchemas;
  return {
    search: read.keyword.optional().parse(params.search),
    page: read.page.optional().parse(params.page),
    size: read.size.optional().parse(params.size),
    filters: read.recordFilters.optional().parse(params.filters),
    sort: read.recordSort.optional().parse(params.sort),
  };
}

function objectDetailPath(className: string, primaryKey: string) {
  return panelAddress("/browser/views", { selected: { className, primaryKey } });
}

export function withInstanceDetailPaths(className: string, page: PanelRecordQuery): PanelRecordQuery {
  return {
    ...page,
    rows: page.rows.map(row => ({ ...row, outputs: { detailPath: objectDetailPath(className, row.primaryKey) } })),
  };
}

export function withInstanceDetail(record: PanelRecord, className: string, primaryKey: string, typeLabel: string): PanelRecord {
  return { ...record, outputs: { typeLabel, detailPath: objectDetailPath(className, primaryKey) } };
}

export function customerClassPageRequest(typeId: string, { search, page, size, filters, sort }: CustomerOntologyQueryParams) {
  return {
    classname: typeId,
    pagenum: page?.number ?? 1,
    pagecount: size ?? page?.size ?? 20,
    ...(search !== undefined && { search }),
    ...(filters !== undefined && { filters }),
    ...(sort !== undefined && { sort }),
  };
}

function customerClassPage(typeId: string, attributes: readonly ClassAttribute[], payload: unknown): PanelRecordQuery {
  const answer = classPageSchema.parse(payload);
  if (!answer.success) throw new HttpError(422, answer.message, answer.code);
  if (answer.data.length && !answer.readable_fields.includes(primaryKeyName(attributes)))
    throw new HttpError(422, "The object's primary key is unreadable", "NO_READABLE_OBJECT_KEY");
  const readable = new Set(answer.readable_fields);
  const fieldLabels = Object.fromEntries(attributes
    .filter(attribute => attribute.enable && readable.has(attribute.name) && !ARRAY_TYPES.has(attribute.type.toLowerCase()))
    .map(attribute => [attribute.name, attribute.showName]));
  const rows = answer.data.map(row => ({ ...panelRecord(typeId, attributes, row), fieldLabels }));
  return { rows, fieldLabels, total: answer.total_count };
}

export function customerObjectRecordCall(className: string, primaryKey: string) {
  return { type: "customer:ObjectType", name: "record", parameters: { className, primaryKey } };
}

function decodeCustomerObjectRow(primaryKey: string, attributes: readonly ClassAttribute[], payload: unknown) {
  const answer = objectRecordSchema.parse(payload);
  if (!answer.success) return { ok: false as const, error: objectFailure(answer.code, answer.message) };
  // Java omits a primary-key column named "id"; the requested value is authoritative.
  return { ok: true as const, row: { ...answer.data.data, [primaryKeyName(attributes)]: primaryKey } };
}

function customerObjectRow(primaryKey: string, attributes: readonly ClassAttribute[], payload: unknown) {
  const result = decodeCustomerObjectRow(primaryKey, attributes, payload);
  if (!result.ok) throw result.error;
  return result.row;
}

const customerReadFacts = z.object({ attributes: classAttributesSchema, answer: z.unknown() });
const customerCreateFormFacts = customerReadFacts.pick({ attributes: true });

const directionFacts = z.object({ direction: z.enum(["outgoing", "incoming"]), targetClass: z.string() })
  .and(z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), rows: z.array(z.record(z.unknown())) }),
    z.object({ status: z.literal("refused"), reason: z.string() }),
    z.object({ status: z.literal("failed") }),
  ]));
const customerNeighborFacts = z.object({
  anchor: customerReadFacts,
  label: z.string().nullish(),
  typeLabels: z.record(z.string()),
  targetAttributes: z.record(classAttributesSchema),
  directions: z.array(directionFacts),
});

export function prepareCustomerNeighborsRead(relationshipId: string, params: Record<string, unknown>, locale?: string) {
  const read = panelReadParameterSchemas;
  const node = read.graphNode.parse(params.node);
  const relationKinds = read.relationKinds.optional().parse(params.relationKinds);
  if (relationKinds?.some(kind => kind !== relationshipId))
    throw new HttpError(400, "relationKinds can only name the source relationship");
  const limit = read.neighborsLimit.optional().parse(params.limit) ?? NEIGHBORS_LIMIT_DEFAULT;
  const offset = read.nonNegativeInt.optional().parse(params.offset) ?? 0;
  return {
    call: { type: "customer:Relationship", name: "neighbors", parameters: runtimeJsonObjectSchema.parse({ relationshipId, node, limit, offset }) },
    present(payload: unknown) {
      const { anchor, directions, label, targetAttributes, typeLabels } = customerNeighborFacts.parse(payload);
      const record = presentCustomerObjectRecord(node.className, node.primaryKey, anchor);
      const reads = directions.map(({ direction, targetClass, ...fact }): NeighborRelationRead["directions"][number] => ({
        direction, targetClass,
        result: fact.status === "ok" ? { ok: true, rows: fact.rows }
          : { ok: false, status: fact.status, reason: fact.status === "refused" ? fact.reason
            : tForLocale(locale, "panels.objectDetail.relationReadFailed") },
      }));
      return assembleCustomerNeighbors(
        { ...node, label: record.label }, limit, offset,
        { relationKind: relationshipId, label: label ?? undefined, directions: reads,
          unknownReason: label == null ? "Relationship does not exist or does not touch this class" : undefined },
        className => className === node.className ? anchor.attributes : targetAttributes[className],
        new Map(Object.entries(typeLabels)),
      );
    },
  };
}


function requireEditFormPrimaryKey(typeId: string, attributes: readonly ClassAttribute[]) {
  if (!attributes.some(attribute => attribute.primaryKey))
    throw new HttpError(404, `Object type '${typeId}' has no primary key attribute`, "OBJECT_NOT_FOUND");
}

function customerCreateForm(typeId: string, attributes: readonly ClassAttribute[], params?: CustomerOntologyFormParams) {
  if (attributes.length === 0)
    throw new HttpError(404, `Object type '${typeId}' has no attributes`, "OBJECT_NOT_FOUND");
  return buildCustomerFormDescription(typeId, attributes, "create", undefined, params);
}

export function presentCustomerClassPage(typeId: string, payload: unknown): PanelRecordQuery {
  const { attributes, answer } = customerReadFacts.parse(payload);
  return customerClassPage(typeId, attributes, answer);
}

export function customerObjectRecordResult(typeId: string, primaryKey: string, payload: unknown) {
  const { attributes, answer } = customerReadFacts.parse(payload);
  const result = decodeCustomerObjectRow(primaryKey, attributes, answer);
  return result.ok ? { ok: true as const, record: panelRecord(typeId, attributes, result.row) } : result;
}

export function presentCustomerObjectRecord(typeId: string, primaryKey: string, payload: unknown): PanelRecord {
  const result = customerObjectRecordResult(typeId, primaryKey, payload);
  if (!result.ok) throw result.error;
  return result.record;
}

export function presentCustomerEditForm(typeId: string, primaryKey: string, payload: unknown, params: CustomerOntologyFormParams) {
  const { attributes, answer } = customerReadFacts.parse(payload);
  requireEditFormPrimaryKey(typeId, attributes);
  return buildCustomerFormDescription(typeId, attributes, "edit", customerObjectRow(primaryKey, attributes, answer), params);
}

export function presentCustomerCreateForm(typeId: string, payload: unknown, params: CustomerOntologyFormParams) {
  return customerCreateForm(typeId, customerCreateFormFacts.parse(payload).attributes, params);
}

/**
 * Reads of the customer ontology for panel projections. Class, attribute and relationship identities come from the
 * Java model catalog of the current domain on every call; Java keeps cutting rows and columns by the viewer's data
 * permission. Calls run with the viewer's credentials and language.
 */
export function createCustomerOntologyReadAdapter(
  owner: ProductOwner,
  viewer: AssistantCredentials,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the mounting convention passes the caller's user name; the Java owner resolves the viewer from the token.
  callerUserName?: string,
): CustomerOntologyReadAdapter {
  const baseUrl = config.dataQuery.baseUrl;
  const options = {
    headers: buildBackendHeaders(viewer.token, undefined, viewer.locale, viewer.apiKey, viewer.headers),
  };

  async function classAttributes(typeId: string): Promise<ClassAttribute[]> {
    const response = await backendGet(
      "customer-class-attributes",
      `${baseUrl}/ontology/model/attributes?className=${encodeURIComponent(typeId)}`,
      options,
    );
    return classAttributesSchema.parse(JSON.parse(response.text));
  }

  /** One object's raw attribute row from the owner; enforces viewer data permissions and preserves primary key. */
  async function readRawObject(typeId: string, primaryKey: string, attributes: readonly ClassAttribute[]): Promise<Record<string, unknown>> {
    const response = await backendPost(
      "customer-object-record",
      `${baseUrl}/data/queryInfoByNode`,
      { class: typeId, id: `${typeId}:${primaryKey}` },
      options,
    );
    return customerObjectRow(primaryKey, attributes, JSON.parse(response.text));
  }

  /** One object's attribute values; the attributes are read once per call and shared with the caller. */
  async function readObject(typeId: string, primaryKey: string, attributes: readonly ClassAttribute[]): Promise<PanelRecord> {
    return panelRecord(typeId, attributes, await readRawObject(typeId, primaryKey, attributes));
  }

  return {
    async query(typeId, params) {
      const attributes = await classAttributes(typeId);
      const response = await backendPost(
        "customer-class-page",
        `${baseUrl}/data/getWholeClassDataByPage`,
        customerClassPageRequest(typeId, params),
        options,
      );
      return customerClassPage(typeId, attributes, JSON.parse(response.text));
    },

    async record(typeId, primaryKey) {
      return readObject(typeId, primaryKey, await classAttributes(typeId));
    },

    async form(typeId, primaryKey, params) {
      const attributes = await classAttributes(typeId);
      requireEditFormPrimaryKey(typeId, attributes);
      const row = await readRawObject(typeId, primaryKey, attributes);
      return buildCustomerFormDescription(typeId, attributes, "edit", row, params);
    },

    async createForm(typeId, params) {
      return customerCreateForm(typeId, await classAttributes(typeId), params);
    },
  };
}
