import { z } from "zod";
import { panelObjectRefSchema } from "./panel-manifest";
import { platformOntologyLayers } from "./platform-object-types";

// Graph data and query shapes do not depend on the read result registry.
const typeId = z.string().min(1).max(120);
const relationKind = z.string().min(1).max(120);
const recordCount = z.number().int().nonnegative();
const page = z.number().int().min(1);
const pageSize = z.number().int().min(1).max(200);

export const platformOntologyLayerSchema = z.enum(platformOntologyLayers);
export type PlatformOntologyLayer = z.infer<typeof platformOntologyLayerSchema>;

export const platformOntologyStatusSchema = z.enum(["ok", "refused", "failed", "unavailable"]);
export type PlatformOntologyStatus = z.infer<typeof platformOntologyStatusSchema>;

export const platformOntologyNodeRefSchema = panelObjectRefSchema;
export type PlatformOntologyNodeRef = z.infer<typeof platformOntologyNodeRefSchema>;

export const platformOntologyNodeSchema = platformOntologyNodeRefSchema.extend({
  label: z.string(),
  typeLabel: z.string().optional(),
  layer: platformOntologyLayerSchema,
  detail: z.string().optional(),
});
export type PlatformOntologyNode = z.infer<typeof platformOntologyNodeSchema>;

export const platformOntologyEdgeBindingSchema = z.object({
  reads: z.array(z.string().min(1)).nonempty().optional(),
  operations: z.array(z.string().min(1)).nonempty().optional(),
  viaInput: z.boolean().optional(),
}).strict();
export type PlatformOntologyEdgeBinding = z.infer<typeof platformOntologyEdgeBindingSchema>;

export const platformOntologyEdgeSchema = z.object({
  id: z.string().min(1),
  relationKind,
  label: z.string().optional(),
  from: platformOntologyNodeRefSchema,
  to: platformOntologyNodeRefSchema,
  direction: z.enum(["outgoing", "incoming"]),
  derived: z.boolean(),
  binding: platformOntologyEdgeBindingSchema.optional(),
}).strict();
export type PlatformOntologyEdge = z.infer<typeof platformOntologyEdgeSchema>;

export const platformOntologyRelationStatusSchema = z.object({
  relationKind,
  label: z.string().optional(),
  status: platformOntologyStatusSchema,
  edgeCount: recordCount,
  reason: z.string().optional(),
}).strict();
export type PlatformOntologyRelationStatus = z.infer<typeof platformOntologyRelationStatusSchema>;

/** Schema, counts and start take no endpoint-specific query parameters. */
export const platformOntologyReadQuerySchema = z.object({}).strict();
export type PlatformOntologyReadQuery = z.infer<typeof platformOntologyReadQuerySchema>;

export const platformOntologyTypeCountSchema = z.object({
  type: typeId,
  layer: platformOntologyLayerSchema,
  status: platformOntologyStatusSchema,
  count: recordCount.optional(),
  reason: z.string().optional(),
}).strict();
export type PlatformOntologyTypeCount = z.infer<typeof platformOntologyTypeCountSchema>;

export const platformOntologyCountsResponseSchema = z.object({
  counts: z.array(platformOntologyTypeCountSchema),
}).strict();
export type PlatformOntologyCountsResponse = z.infer<typeof platformOntologyCountsResponseSchema>;

export const platformOntologyStartResponseSchema = z.object({
  node: platformOntologyNodeSchema.nullable(),
}).strict();
export type PlatformOntologyStartResponse = z.infer<typeof platformOntologyStartResponseSchema>;

export const platformOntologyNeighborsRequestSchema = z.object({
  node: platformOntologyNodeRefSchema.extend({
    className: typeId,
    primaryKey: platformOntologyNodeRefSchema.shape.primaryKey.max(500),
  }),
  relationKinds: z.array(relationKind).max(100).readonly().optional(),
  layers: z.array(platformOntologyLayerSchema).max(4).readonly().optional(),
  targetClass: panelObjectRefSchema.shape.className.optional(),
  direction: z.enum(["incoming", "outgoing", "both"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: recordCount.optional(),
}).strict();
export type PlatformOntologyNeighborsRequest = z.infer<typeof platformOntologyNeighborsRequestSchema>;

export const platformOntologyNeighborsResponseSchema = z.object({
  node: platformOntologyNodeSchema,
  neighbors: z.array(platformOntologyNodeSchema),
  edges: z.array(platformOntologyEdgeSchema),
  relations: z.array(platformOntologyRelationStatusSchema.extend({ truncated: z.boolean().optional() })),
  nextOffset: recordCount.nullable().optional(),
  total: recordCount.nullable().optional(),
  version: z.string().optional(),
}).strict();
export type PlatformOntologyNeighborsResponse = z.infer<typeof platformOntologyNeighborsResponseSchema>;

export const panelGraphOverviewSchema = z.object({
  status: z.enum(["READY", "GENERATING", "NOT_GENERATED"]),
  version: z.string().optional(),
  generatedAt: z.string().optional(),
  sampleToken: z.string().optional(),
  complete: z.boolean().optional(),
  failures: z.array(z.string()).optional(),
  nodeCount: recordCount.optional(),
  edgeCount: recordCount.nullable().optional(),
  componentCount: recordCount.optional(),
  isolatedNodeCount: recordCount.optional(),
  largestComponentSize: recordCount.optional(),
  relationTypes: z.array(relationKind).optional(),
  groups: z.array(z.object({ id: typeId, label: z.string(), totalCount: recordCount, sampleCount: recordCount }).strict()),
  nodes: z.array(platformOntologyNodeSchema.partial({ layer: true })),
  edges: z.array(platformOntologyEdgeSchema).optional(),
  edgesTruncated: z.boolean().optional(),
  relations: z.array(platformOntologyRelationStatusSchema).optional(),
}).strict();
export type PanelGraphOverview = z.infer<typeof panelGraphOverviewSchema>;

export const panelGraphConnectionsSchema = z.object({
  edges: z.array(platformOntologyEdgeSchema),
  truncated: z.boolean(),
  version: z.string(),
  relations: z.array(platformOntologyRelationStatusSchema).optional(),
}).strict();
export type PanelGraphConnections = z.infer<typeof panelGraphConnectionsSchema>;

export const platformOntologyObjectsRequestSchema = z.object({
  type: typeId,
  keyword: z.string().max(200).optional(),
  page: page.optional(),
  pageSize: pageSize.optional(),
}).strict();
export type PlatformOntologyObjectsRequest = z.infer<typeof platformOntologyObjectsRequestSchema>;

export const platformOntologyObjectItemSchema = z.object({
  node: platformOntologyNodeRefSchema,
  label: z.string(),
  detail: z.string().optional(),
}).strict();
export type PlatformOntologyObjectItem = z.infer<typeof platformOntologyObjectItemSchema>;

export const platformOntologyObjectsResponseSchema = z.object({
  type: typeId,
  layer: platformOntologyLayerSchema,
  status: platformOntologyStatusSchema,
  reason: z.string().optional(),
  items: z.array(platformOntologyObjectItemSchema),
  total: recordCount,
  page,
  pageSize,
}).strict();
export type PlatformOntologyObjectsResponse = z.infer<typeof platformOntologyObjectsResponseSchema>;
