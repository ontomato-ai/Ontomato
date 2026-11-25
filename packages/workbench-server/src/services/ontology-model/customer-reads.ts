import { z } from "zod";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import type { FormFieldError } from "@ontomato/contracts/form-fields";
import {
  panelFormDescriptionSchema,
  type recordFiltersSchema,
  type recordSortSchema,
  type PanelFormDescription,
  type PanelFormField,
  type PanelFormValues,
  type PanelRecord,
  type PanelRecordQuery,
  type PanelRelationNeighbors,
} from "@ontomato/contracts/panel-projection";
import type { PlatformOntologyNode } from "@ontomato/contracts/platform-ontology";
import { config } from "../../config/application";
import { tApp } from "../../i18n";
import { createLogger } from "../../logging/logger";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendUnavailableError, backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";

const logger = createLogger("ontology:customer-reads");

/** One class attribute from the Java model catalog (GET /ontology/model/attributes). */
const attributeOptionSchema = z.object({
  value: z.union([z.string(), z.number()]),
  label: z.string().min(1),
  description: z.string().nullish(),
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

/** One relationship touching a class (GET /ontology/model/relationships). */
const classRelationshipsSchema = z.array(z.object({
  relationship: z.string(),
  fromclass: z.string(),
  toclass: z.string(),
  fromShowName: z.string().optional(),
  toShowName: z.string().optional(),
  desc: z.string(),
  fromField: z.string(),
  toField: z.string(),
}));
type ClassRelationship = z.infer<typeof classRelationshipsSchema>[number];

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

/** POST /dsl/executeV1: the owner's answer rows, or the execution error it reports. */
const dslAnswerSchema = z.union([
  z.object({ error: z.string() }),
  z.object({ data: z.array(z.object({ answer: z.array(z.record(z.unknown())) })).min(1) }),
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

export interface CustomerOntologyNeighborsParams {
  node: CustomerOntologyNodeRef;
  relationKinds?: readonly string[];
  limit?: number;
}

export interface CustomerOntologyFormParams {
  values?: PanelFormValues;
  changedField?: string | null;
}

/**
 * The customer-ontology reads a projection can name: a class's rows, one object and standard edit/create forms
 * (an ObjectType source), and an object's neighbors along one relationship (a Relationship source).
 * Changes to an object go through actions.
 */
export interface CustomerOntologyReadAdapter {
  query(typeId: string, params: CustomerOntologyQueryParams): Promise<PanelRecordQuery>;
  record(typeId: string, primaryKey: string): Promise<PanelRecord>;
  form(typeId: string, primaryKey: string, params?: CustomerOntologyFormParams): Promise<PanelFormDescription>;
  createForm(typeId: string, params?: CustomerOntologyFormParams): Promise<PanelFormDescription>;
  neighbors(relationshipId: string, params: CustomerOntologyNeighborsParams): Promise<PanelRelationNeighbors>;
}

const NEIGHBORS_LIMIT_DEFAULT = 50;
const NEIGHBORS_LIMIT_MAX = 100;

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

/** Map one owner row to the panel record shape; only the columns the row carries become fields. */
function panelRecord(className: string, attributes: readonly ClassAttribute[], row: Record<string, unknown>): PanelRecord {
  const primaryKey = displayText(row[primaryKeyName(attributes)]);
  const fields: Record<string, string> = {};
  const fieldLabels: Record<string, string> = {};
  for (const [name, value] of Object.entries(row)) {
    fields[name] = displayText(value);
    fieldLabels[name] = attributes.find(attribute => attribute.name === name)?.showName ?? name;
  }
  return { className, primaryKey, label: recordLabel(attributes, primaryKey, row), fields, fieldLabels };
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

function attributeSelectOptions(attribute: ClassAttribute): { value: string | number; label: string; description: string | null; disabled: boolean; disabledReason: string | null }[] | null {
  if (attribute.options && attribute.options.length > 0) {
    return attribute.options.map(option => ({
      value: option.value,
      label: option.label,
      description: option.description ?? null,
      disabled: false,
      disabledReason: null,
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

  if (options) {
    control = { kind: "select", options };
    const optionValues = options.map(option => option.value);
    valueSchema = {
      title: label,
      enum: required ? optionValues : [...optionValues, null],
    };
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
  if (options) {
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
        values[attribute.name] = submitted[attribute.name]!;
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

/** One relation's plan: the directions it offers the anchor, or a declared kind that never matched the class's model. */
type NeighborRelationPlan =
  | { relationKind: string; label: string; directions: NeighborDirection[] }
  | { relationKind: string; unknownReason: string };

/** One relation's executed plan for the assembly. */
interface NeighborRelationRead {
  relationKind: string;
  label?: string;
  directions: (NeighborDirection & { result: NeighborQueryResult })[];
  unknownReason?: string;
}

/** Both directions a relation offers the anchor; a self-loop reads once per side. */
function relationDirections(relation: ClassRelationship, anchorClass: string): NeighborDirection[] {
  const directions: NeighborDirection[] = [];
  if (relation.fromclass === anchorClass) directions.push({ direction: "outgoing", targetClass: relation.toclass });
  if (relation.toclass === anchorClass) directions.push({ direction: "incoming", targetClass: relation.fromclass });
  return directions;
}

/** The source relationship's plan for the anchor's class, or its failure when the class's model has no such relationship. */
function planRelation(catalog: readonly ClassRelationship[], relationshipId: string, anchorClass: string): NeighborRelationPlan {
  const relation = catalog.find(item => item.relationship === relationshipId);
  return relation
    ? { relationKind: relationshipId, label: relation.desc || relation.relationship, directions: relationDirections(relation, anchorClass) }
    : { relationKind: relationshipId, unknownReason: "Relationship does not exist or does not touch this class" };
}

/**
 * The per-relation DSL, following the object detail page's loadViewLinks: anchor and target at idx 0/1, the
 * relationship's own from/to, rows sorted by the target's primary key, and one row over the limit to detect truncation.
 */
function neighborsDsl(
  anchor: CustomerOntologyNodeRef,
  anchorPrimaryKeyName: string,
  relationKind: string,
  { direction, targetClass }: NeighborDirection,
  targetAttributes: readonly ClassAttribute[],
  limit: number,
): Record<string, unknown> {
  const targetPrimaryKey = primaryKeyName(targetAttributes);
  const fields = [...new Set([
    targetPrimaryKey,
    ...targetAttributes.filter(attribute => attribute.enable && attribute.businessKey).map(attribute => attribute.name),
  ])].map(name => ({ variable: "target", field: name, as: name }));
  return {
    problem: "",
    answer: { steps: [{
      graph: {
        pattern_logic: "and",
        patterns: [{
          objects: [
            {
              idx: 0,
              variable: "source",
              class: anchor.className,
              conditions: { properties: { field: anchorPrimaryKeyName, operator: "=", value: anchor.primaryKey } },
            },
            { idx: 1, variable: "target", class: targetClass },
          ],
          relationship: [{ from: direction === "outgoing" ? 0 : 1, to: direction === "outgoing" ? 1 : 0, type: [relationKind] }],
        }],
      },
      output: {
        to_user: true,
        fields,
        sort: { fields: [{ variable: "target", field: targetPrimaryKey, order: "asc" }] },
        limit: { count: limit + 1, offset: 0 },
      },
    }] },
  };
}

/**
 * Assembles the neighbors response from the anchor record and each relation's direction results. This is the one
 * place that knows the result's field names, so A's final schema rename or reshape lands here only.
 */
function assembleCustomerNeighbors(
  anchor: CustomerOntologyNodeRef & { label: string },
  limit: number,
  reads: readonly NeighborRelationRead[],
  attributesOf: (className: string) => readonly ClassAttribute[],
  typeLabels: ReadonlyMap<string, string>,
): PanelRelationNeighbors {
  const severity = { ok: 0, refused: 1, failed: 2 } as const;
  const anchorRef = { className: anchor.className, primaryKey: anchor.primaryKey };
  const anchorTypeLabel = typeLabels.get(anchor.className);
  const edges: PanelRelationNeighbors["edges"] = [];
  const relations: PanelRelationNeighbors["relations"] = [];
  const neighbors = new Map<string, PlatformOntologyNode>();

  for (const read of reads) {
    let status: "ok" | "refused" | "failed" = "ok";
    let reason: string | undefined = read.unknownReason;
    let truncated = false;
    const seenEdges = new Set<string>();
    if (read.unknownReason) status = "failed";

    for (const { direction, targetClass, result } of read.directions) {
      if (!result.ok) {
        // The loudest honest status names the relation; a self-loop's two sides can disagree.
        if (severity[result.status] > severity[status]) {
          status = result.status;
          reason = result.reason;
        }
        continue;
      }
      truncated = truncated || result.rows.length > limit;
      const attributes = attributesOf(targetClass);
      const targetPrimaryKey = primaryKeyName(attributes);
      for (const row of result.rows.slice(0, limit)) {
        const neighborPrimaryKey = displayText(row[targetPrimaryKey]);
        const id = `${read.relationKind}:${direction}:${anchor.primaryKey}:${neighborPrimaryKey}`;
        if (seenEdges.has(id)) continue;
        seenEdges.add(id);
        const neighbor = { className: targetClass, primaryKey: neighborPrimaryKey };
        // from and to follow the relationship's own direction; direction is relative to the anchor.
        edges.push({
          id,
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
            className: targetClass,
            primaryKey: neighborPrimaryKey,
            label: recordLabel(attributes, neighborPrimaryKey, row),
            ...(typeLabel && { typeLabel }),
            layer: "fact",
          });
        }
      }
    }

    relations.push({
      relationKind: read.relationKind,
      ...(read.label && { label: read.label }),
      status,
      edgeCount: seenEdges.size,
      ...(reason ? { reason } : {}),
      truncated,
    });
  }

  return {
    node: { ...anchorRef, label: anchor.label, ...(anchorTypeLabel && { typeLabel: anchorTypeLabel }), layer: "fact" },
    neighbors: [...neighbors.values()],
    edges,
    relations,
  };
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

  async function classRelationships(typeId: string): Promise<ClassRelationship[]> {
    const response = await backendGet(
      "customer-class-relationships",
      `${baseUrl}/ontology/model/relationships?className=${encodeURIComponent(typeId)}`,
      options,
    );
    return classRelationshipsSchema.parse(JSON.parse(response.text));
  }

  /** One object's raw attribute row from the owner; enforces viewer data permissions and preserves primary key. */
  async function readRawObject(typeId: string, primaryKey: string, attributes: readonly ClassAttribute[]): Promise<Record<string, unknown>> {
    const response = await backendPost(
      "customer-object-record",
      `${baseUrl}/data/queryInfoByNode`,
      { class: typeId, id: `${typeId}:${primaryKey}` },
      options,
    );
    const answer = objectRecordSchema.parse(JSON.parse(response.text));
    if (!answer.success) throw objectFailure(answer.code, answer.message);
    // Java drops a primary-key column literally named "id" from the answer, so the requested key is the authoritative value.
    return { ...answer.data.data, [primaryKeyName(attributes)]: primaryKey };
  }

  /** One object's attribute values; the attributes are read once per call and shared with the caller. */
  async function readObject(typeId: string, primaryKey: string, attributes: readonly ClassAttribute[]): Promise<PanelRecord> {
    return panelRecord(typeId, attributes, await readRawObject(typeId, primaryKey, attributes));
  }

  /** One relation-direction query: a refusal names the viewer's permission; anything else the owner's or the transport's failure. */
  async function readNeighborEdges(dsl: Record<string, unknown>): Promise<NeighborQueryResult> {
    try {
      const response = await backendPost("customer-neighbor-edges", `${baseUrl}/dsl/executeV1`, dsl, options);
      const answer = dslAnswerSchema.parse(JSON.parse(response.text));
      if ("error" in answer) {
        logger.warn(`Relationship read failed: ${answer.error}`);
        return { ok: false, status: "failed", reason: tApp("panels.objectDetail.relationReadFailed") };
      }
      return { ok: true, rows: answer.data[0].answer };
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403))
        return { ok: false, status: "refused", reason: error.message };
      if (error instanceof HttpError || error instanceof BackendUnavailableError
        || error instanceof z.ZodError || error instanceof SyntaxError) {
        logger.warn("Relationship read failed", error);
        return { ok: false, status: "failed", reason: tApp("panels.objectDetail.relationReadFailed") };
      }
      throw error;
    }
  }

  return {
    async query(typeId, { search, page, size, filters, sort }) {
      const attributes = await classAttributes(typeId);
      const pageSize = size ?? page?.size ?? 20;
      const response = await backendPost(
        "customer-class-page",
        `${baseUrl}/data/getWholeClassDataByPage`,
        { classname: typeId, pagenum: page?.number ?? 1, pagecount: pageSize, search, filters, sort },
        options,
      );
      const answer = classPageSchema.parse(JSON.parse(response.text));
      if (!answer.success) throw new HttpError(422, answer.message, answer.code);
      if (answer.data.length && !answer.readable_fields.includes(primaryKeyName(attributes)))
        throw new HttpError(422, "The object's primary key is unreadable", "NO_READABLE_OBJECT_KEY");
      const readable = new Set(answer.readable_fields);
      const fieldLabels = Object.fromEntries(attributes
        .filter(attribute => attribute.enable && readable.has(attribute.name) && !ARRAY_TYPES.has(attribute.type.toLowerCase()))
        .map(attribute => [attribute.name, attribute.showName]));
      const rows = answer.data.map(row => {
        const record = panelRecord(typeId, attributes, row);
        return { ...record, fieldLabels };
      });
      return { rows, fieldLabels, total: answer.total_count };
    },

    async record(typeId, primaryKey) {
      return readObject(typeId, primaryKey, await classAttributes(typeId));
    },

    async form(typeId, primaryKey, params) {
      const attributes = await classAttributes(typeId);
      if (!attributes.some(attribute => attribute.primaryKey)) {
        throw new HttpError(404, `Object type '${typeId}' has no primary key attribute`, "OBJECT_NOT_FOUND");
      }
      const row = await readRawObject(typeId, primaryKey, attributes);
      return buildCustomerFormDescription(typeId, attributes, "edit", row, params);
    },

    async createForm(typeId, params) {
      const attributes = await classAttributes(typeId);
      if (attributes.length === 0) {
        throw new HttpError(404, `Object type '${typeId}' has no attributes`, "OBJECT_NOT_FOUND");
      }
      return buildCustomerFormDescription(typeId, attributes, "create", undefined, params);
    },

    async neighbors(relationshipId, { node, relationKinds, limit: requested }) {
      // The source names its relationship; a parameter cannot point the read at another one.
      if (relationKinds?.some(kind => kind !== relationshipId))
        throw new HttpError(400, "relationKinds can only name the source relationship", "PANEL_INPUT_TYPE_MISMATCH");
      const limit = Math.min(requested ?? NEIGHBORS_LIMIT_DEFAULT, NEIGHBORS_LIMIT_MAX);
      const anchorAttributes = await classAttributes(node.className);
      const [anchorRecord, catalog] = await Promise.all([
        readObject(node.className, node.primaryKey, anchorAttributes),
        classRelationships(node.className),
      ]);
      const plans = [planRelation(catalog, relationshipId, node.className)];
      const typeLabels = new Map<string, string>();
      for (const relation of catalog) {
        if (relation.fromShowName) typeLabels.set(relation.fromclass, relation.fromShowName);
        if (relation.toShowName) typeLabels.set(relation.toclass, relation.toShowName);
      }

      // The attributes each class needs are read once per call and reused; a self-loop's target is the anchor's own class.
      const attributesByClass = new Map<string, ClassAttribute[]>([[node.className, anchorAttributes]]);
      await Promise.all(
        [...new Set(plans.flatMap(plan => ("directions" in plan ? plan.directions : []).map(({ targetClass }) => targetClass)))]
          .filter(targetClass => !attributesByClass.has(targetClass))
          .map(async targetClass => { attributesByClass.set(targetClass, await classAttributes(targetClass)); }),
      );

      const reads: NeighborRelationRead[] = await Promise.all(plans.map(async plan => {
        if (!("directions" in plan))
          return { relationKind: plan.relationKind, directions: [], unknownReason: plan.unknownReason };
        const directions = await Promise.all(plan.directions.map(async direction => ({
          ...direction,
          result: await readNeighborEdges(neighborsDsl(
            node, primaryKeyName(anchorAttributes), plan.relationKind, direction,
            attributesByClass.get(direction.targetClass)!, limit,
          )),
        })));
        return { relationKind: plan.relationKind, label: plan.label, directions };
      }));

      return assembleCustomerNeighbors(
        { ...node, label: anchorRecord.label },
        limit,
        reads,
        className => attributesByClass.get(className)!,
        typeLabels,
      );
    },
  };
}
