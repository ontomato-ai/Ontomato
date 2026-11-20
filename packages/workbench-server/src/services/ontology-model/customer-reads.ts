import { z } from "zod";
import type { PanelRecord } from "@ontomato/contracts/panel-projection";
import {
  platformOntologyNeighborsResponseSchema,
  platformOntologyRelationStatusSchema,
  type PlatformOntologyNode,
} from "@ontomato/contracts/platform-ontology";
import { config } from "../../config/application";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { BackendUnavailableError, backendGet, backendPost, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";

/** One class attribute from the Java model catalog (GET /ontology/model/attributes). */
const classAttributesSchema = z.array(z.object({
  className: z.string(),
  name: z.string(),
  showName: z.string(),
  type: z.string(),
  attrDesc: z.string(),
  enable: z.boolean(),
  businessKey: z.boolean(),
  primaryKey: z.boolean(),
}));
type ClassAttribute = z.infer<typeof classAttributesSchema>[number];

/** One relationship touching a class (GET /ontology/model/relationships). */
const classRelationshipsSchema = z.array(z.object({
  relationship: z.string(),
  fromclass: z.string(),
  toclass: z.string(),
  desc: z.string(),
  fromField: z.string(),
  toField: z.string(),
}));
type ClassRelationship = z.infer<typeof classRelationshipsSchema>[number];

/** POST /data/getWholeClassDataByPage: the class's rows with the real total, or the owner's refusal. */
const classPageSchema = z.union([
  z.object({ success: z.literal(true), data: z.array(z.record(z.unknown())), total_count: z.number() }),
  z.object({ success: z.literal(false), message: z.string() }),
]);

/** POST /data/queryInfoByNode: the object's attribute values, or the owner's reason. */
const objectRecordSchema = z.union([
  z.object({ success: z.literal(true), data: z.object({ data: z.record(z.unknown()) }) }),
  z.object({ success: z.literal(false), message: z.string() }),
]);

/** POST /dsl/executeV1: the owner's answer rows, or the execution error it reports. */
const dslAnswerSchema = z.union([
  z.object({ error: z.string() }),
  z.object({ data: z.array(z.object({ answer: z.array(z.record(z.unknown())) })).min(1) }),
]);

/**
 * A neighbors result keeps M3's platformOntologyNeighborsResponseSchema shape and adds each relation's `truncated`,
 * so the one row over the limit reports "more behind this relation" without being returned. A's final schema for this
 * read lands as a rename or reshape of exactly this.
 */
export const customerNeighborsSchema = platformOntologyNeighborsResponseSchema.extend({
  relations: z.array(platformOntologyRelationStatusSchema.extend({ truncated: z.boolean() })),
});
export type CustomerOntologyNeighbors = z.infer<typeof customerNeighborsSchema>;

export interface CustomerOntologyNodeRef {
  className: string;
  primaryKey: string;
}

export interface CustomerOntologyQueryParams {
  search?: string;
  page?: number;
  size?: number;
}

export interface CustomerOntologyNeighborsParams {
  relationKinds?: string[];
  limit?: number;
}

/** The customer-ontology reads a projection can name: a class's rows, one object, or an object's neighbors. */
export interface CustomerOntologyReadAdapter {
  query(typeId: string, params: CustomerOntologyQueryParams): Promise<{ items: PanelRecord[]; total: number }>;
  record(typeId: string, primaryKey: string): Promise<PanelRecord>;
  neighbors(
    node: CustomerOntologyNodeRef,
    params: CustomerOntologyNeighborsParams,
  ): Promise<CustomerOntologyNeighbors>;
}

const NEIGHBORS_LIMIT_DEFAULT = 50;
const NEIGHBORS_LIMIT_MAX = 100;

// Java reports a missing object and a data-permission refusal identically except for the message text
// (DataServiceImpl.queryInfoByNode), and the shipped language pack is English-only, so these are the texts it returns.
const OBJECT_NOT_FOUND_TEXT = "Object not found";
const DATA_PERMISSION_TEXT = "You do not have data permission";

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
function panelRecord(attributes: readonly ClassAttribute[], row: Record<string, unknown>): PanelRecord {
  const primaryKey = displayText(row[primaryKeyName(attributes)]);
  const fields: Record<string, string> = {};
  const fieldLabels: Record<string, string> = {};
  for (const [name, value] of Object.entries(row)) {
    fields[name] = displayText(value);
    fieldLabels[name] = attributes.find(attribute => attribute.name === name)?.showName ?? name;
  }
  return { primaryKey, label: recordLabel(attributes, primaryKey, row), fields, fieldLabels };
}

/** The owner's reason for an unreadable object: a permission refusal answers forbidden, a missing object keeps its reason. */
function objectFailure(message: string): HttpError {
  if (message === DATA_PERMISSION_TEXT) return new HttpError(403, message, "CUSTOMER_DATA_PERMISSION");
  if (message === OBJECT_NOT_FOUND_TEXT) return new HttpError(404, message, "OBJECT_NOT_FOUND");
  return new HttpError(502, message, "CUSTOMER_OBJECT_READ_FAILED");
}

type NeighborDirection = { direction: "outgoing" | "incoming"; targetClass: string };

type NeighborQueryResult =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; status: "refused" | "failed"; reason: string };

/** One relation's plan: the directions it offers the anchor, or a declared kind that never matched the class's model. */
type NeighborRelationPlan =
  | { relationKind: string; directions: NeighborDirection[] }
  | { relationKind: string; unknownReason: string };

/** One relation's executed plan for the assembly. */
interface NeighborRelationRead {
  relationKind: string;
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

/** Select the relations to read: the class's whole catalog, or the declared kinds, with the unmatched ones kept for their failure. */
function planRelations(
  catalog: readonly ClassRelationship[],
  declared: readonly string[] | undefined,
  anchorClass: string,
): NeighborRelationPlan[] {
  if (declared === undefined)
    return catalog.map(relation => ({ relationKind: relation.relationship, directions: relationDirections(relation, anchorClass) }));
  const byName = new Map(catalog.map(relation => [relation.relationship, relation]));
  return [...new Set(declared)].map(name => {
    const relation = byName.get(name);
    return relation
      ? { relationKind: name, directions: relationDirections(relation, anchorClass) }
      : { relationKind: name, unknownReason: "Relationship does not exist or does not touch this class" };
  });
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
): CustomerOntologyNeighbors {
  const severity = { ok: 0, refused: 1, failed: 2 } as const;
  const anchorRef = { className: anchor.className, primaryKey: anchor.primaryKey };
  const edges: CustomerOntologyNeighbors["edges"] = [];
  const relations: CustomerOntologyNeighbors["relations"] = [];
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
          from: direction === "outgoing" ? anchorRef : neighbor,
          to: direction === "outgoing" ? neighbor : anchorRef,
          direction,
          derived: false,
        });
        const neighborKey = `${targetClass}:${neighborPrimaryKey}`;
        if (!neighbors.has(neighborKey)) {
          neighbors.set(neighborKey, {
            className: targetClass,
            primaryKey: neighborPrimaryKey,
            label: recordLabel(attributes, neighborPrimaryKey, row),
            layer: "fact",
          });
        }
      }
    }

    relations.push({ relationKind: read.relationKind, status, edgeCount: seenEdges.size, ...(reason ? { reason } : {}), truncated });
  }

  return {
    node: { ...anchorRef, label: anchor.label, layer: "fact" },
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

  /** One object's attribute values; the attributes are read once per call and shared with the caller. */
  async function readObject(typeId: string, primaryKey: string, attributes: readonly ClassAttribute[]): Promise<PanelRecord> {
    const response = await backendPost(
      "customer-object-record",
      `${baseUrl}/data/queryInfoByNode`,
      { class: typeId, id: `${typeId}:${primaryKey}` },
      options,
    );
    const answer = objectRecordSchema.parse(JSON.parse(response.text));
    if (!answer.success) throw objectFailure(answer.message);
    // Java drops a primary-key column literally named "id" from the answer, so the requested key is the authoritative value.
    const row = { ...answer.data.data, [primaryKeyName(attributes)]: primaryKey };
    return panelRecord(attributes, row);
  }

  /** One relation-direction query: a refusal names the viewer's permission; anything else the owner's or the transport's failure. */
  async function readNeighborEdges(dsl: Record<string, unknown>): Promise<NeighborQueryResult> {
    try {
      const response = await backendPost("customer-neighbor-edges", `${baseUrl}/dsl/executeV1`, dsl, options);
      const answer = dslAnswerSchema.parse(JSON.parse(response.text));
      return "error" in answer
        ? { ok: false, status: "failed", reason: answer.error }
        : { ok: true, rows: answer.data[0].answer };
    } catch (error) {
      if (error instanceof HttpError && (error.status === 401 || error.status === 403))
        return { ok: false, status: "refused", reason: error.message };
      if (error instanceof HttpError || error instanceof BackendUnavailableError
        || error instanceof z.ZodError || error instanceof SyntaxError)
        return { ok: false, status: "failed", reason: error.message };
      throw error;
    }
  }

  return {
    async query(typeId, { search, page, size }) {
      const attributes = await classAttributes(typeId);
      const response = await backendPost(
        "customer-class-page",
        `${baseUrl}/data/getWholeClassDataByPage`,
        { classname: typeId, pagenum: page ?? 1, pagecount: size ?? 20, search },
        options,
      );
      const answer = classPageSchema.parse(JSON.parse(response.text));
      // The owner's only refusal on this endpoint is the viewer's data permission.
      if (!answer.success) throw new HttpError(403, answer.message, "CUSTOMER_DATA_PERMISSION");
      return { items: answer.data.map(row => panelRecord(attributes, row)), total: answer.total_count };
    },

    async record(typeId, primaryKey) {
      return readObject(typeId, primaryKey, await classAttributes(typeId));
    },

    async neighbors(node, params) {
      const limit = Math.min(params.limit ?? NEIGHBORS_LIMIT_DEFAULT, NEIGHBORS_LIMIT_MAX);
      const anchorAttributes = await classAttributes(node.className);
      const [anchorRecord, catalog] = await Promise.all([
        readObject(node.className, node.primaryKey, anchorAttributes),
        classRelationships(node.className),
      ]);
      const plans = planRelations(catalog, params.relationKinds, node.className);

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
        return { relationKind: plan.relationKind, directions };
      }));

      return assembleCustomerNeighbors(
        { ...node, label: anchorRecord.label },
        limit,
        reads,
        className => attributesByClass.get(className)!,
      );
    },
  };
}
