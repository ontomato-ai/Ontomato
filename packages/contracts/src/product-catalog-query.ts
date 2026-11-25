import { z } from "zod";

export const productCatalogCursorSchema = z.string().min(1);

/** Query both current product collections. Cursors are opaque to callers. */
export const productCatalogQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  scope: z.enum(["all", "mine", "shared"]).default("all"),
  sort: z.enum(["updated", "name"]).default("updated"),
  cursor: productCatalogCursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type ProductCatalogQuery = z.infer<typeof productCatalogQuerySchema>;

export const productPanelCatalogQuerySchema = productCatalogQuerySchema.extend({ template: z.boolean().optional() });
export type ProductPanelCatalogQuery = z.infer<typeof productPanelCatalogQuerySchema>;

export const productProjectionComponentFilterSchema = z.string().trim().min(1).max(200);
export const productProjectionObjectTypeFilterSchema = z.string().trim().min(1).max(200);

const optionalProjectionFilter = (schema: z.ZodType<string>) =>
  z.preprocess(
    value => (value === null || (typeof value === "string" && value.trim() === "") ? undefined : value),
    schema.optional(),
  );

/** Projection catalog query extending the shared catalog query with existing-fact filters (component and bound object type). */
export const productProjectionCatalogQuerySchema = productCatalogQuerySchema.extend({
  componentId: optionalProjectionFilter(productProjectionComponentFilterSchema),
  objectType: optionalProjectionFilter(productProjectionObjectTypeFilterSchema),
}).strict();
export type ProductProjectionCatalogQuery = z.infer<typeof productProjectionCatalogQuerySchema>;

export const applicationCatalogueScopeSchema = z.enum(["visible", "maintainable"]);
export const applicationCatalogueSortSchema = z.enum(["id", "name", "updated"]);
export const applicationFormSectionSchema = z.enum(["identity", "entries", "entry", "create"]);
