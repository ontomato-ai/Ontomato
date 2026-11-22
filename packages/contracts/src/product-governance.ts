import { z } from "zod";
import { productCurrentIdParamsSchema } from "./product-record-id";

const productGrantRecordSchema = z.object({
  principalKind: z.enum(["principal", "role", "domain"]),
  principalId: z.string(),
  principalName: z.string().min(1).optional(),
  verb: z.enum(["use", "edit"]),
});
export type ProductGrantRecord = z.infer<typeof productGrantRecordSchema>;

/** The domain use grant is the source of the domain sharing state. */
export const productGrantsResponseSchema = z.object({
  grants: z.array(productGrantRecordSchema),
});

export const productCatalogueGrantsSchema = productGrantsResponseSchema.extend({ shared: z.boolean() }).strict();

/** Set or revoke an individual principal or role grant. */
export const changeProductGrantRequestSchema = productGrantRecordSchema.omit({ principalName: true }).extend({
  principalKind: productGrantRecordSchema.shape.principalKind.exclude(["domain"]),
  principalId: productGrantRecordSchema.shape.principalId.min(1).max(200),
  remove: z.boolean(),
}).strict();
export type ChangeProductGrantRequest = z.infer<typeof changeProductGrantRequestSchema>;

export const changeProductDomainGrantRequestSchema = z.object({ shared: z.boolean() }).strict();
export const productGrantChangeResponseSchema = z.object({ success: z.literal(true) }).strict();
export const changeProductPanelDomainGrantResponseSchema = productGrantChangeResponseSchema.extend({
  skippedProjectionIds: z.array(productCurrentIdParamsSchema.shape.id),
});
