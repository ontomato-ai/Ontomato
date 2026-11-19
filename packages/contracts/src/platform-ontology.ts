import { z } from "zod";
import { panelObjectRefSchema } from "./panel-manifest";
import { platformOntologyLayers, platformRelationKindDeclarationSchema } from "./platform-object-types";

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
  layer: platformOntologyLayerSchema,
  detail: z.string().optional(),
});
export type PlatformOntologyNode = z.infer<typeof platformOntologyNodeSchema>;

export const platformOntologyEdgeSchema = z.object({
  id: z.string().min(1),
  relationKind,
  from: platformOntologyNodeRefSchema,
  to: platformOntologyNodeRefSchema,
  direction: z.enum(["outgoing", "incoming"]),
  derived: z.boolean(),
}).strict();
export type PlatformOntologyEdge = z.infer<typeof platformOntologyEdgeSchema>;

export const platformOntologyRelationStatusSchema = z.object({
  relationKind,
  status: platformOntologyStatusSchema,
  edgeCount: recordCount,
  reason: z.string().optional(),
}).strict();
export type PlatformOntologyRelationStatus = z.infer<typeof platformOntologyRelationStatusSchema>;

/** Schema, counts and start take no endpoint-specific query parameters. */
export const platformOntologyReadQuerySchema = z.object({}).strict();
export type PlatformOntologyReadQuery = z.infer<typeof platformOntologyReadQuerySchema>;

export const platformOntologyTypeSchema = z.object({
  id: typeId,
  layer: platformOntologyLayerSchema,
  labelKey: z.string().min(1),
}).strict();
export type PlatformOntologyType = z.infer<typeof platformOntologyTypeSchema>;

export const platformOntologySchemaResponseSchema = z.object({
  layers: z.array(platformOntologyLayerSchema).readonly(),
  objectTypes: z.array(platformOntologyTypeSchema).readonly(),
  relationKinds: z.array(platformRelationKindDeclarationSchema).readonly(),
}).strict();
export type PlatformOntologySchemaResponse = z.infer<typeof platformOntologySchemaResponseSchema>;

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
}).strict();
export type PlatformOntologyNeighborsRequest = z.infer<typeof platformOntologyNeighborsRequestSchema>;

export const platformOntologyNeighborsResponseSchema = z.object({
  node: platformOntologyNodeSchema,
  neighbors: z.array(platformOntologyNodeSchema),
  edges: z.array(platformOntologyEdgeSchema),
  relations: z.array(platformOntologyRelationStatusSchema),
}).strict();
export type PlatformOntologyNeighborsResponse = z.infer<typeof platformOntologyNeighborsResponseSchema>;

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
