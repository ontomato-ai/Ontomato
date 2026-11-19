import { z } from "zod";

const productGrantRecordSchema = z.object({
  principalKind: z.enum(["principal", "role", "domain"]),
  principalId: z.string(),
  verb: z.enum(["use", "edit"]),
});
export type ProductGrantRecord = z.infer<typeof productGrantRecordSchema>;

/** The domain use grant is the source of the domain sharing state. */
export const productGrantsResponseSchema = z.object({
  grants: z.array(productGrantRecordSchema),
});

/** Set or revoke an individual principal or role grant. */
export const changeProductGrantRequestSchema = productGrantRecordSchema.extend({
  principalKind: productGrantRecordSchema.shape.principalKind.exclude(["domain"]),
  principalId: productGrantRecordSchema.shape.principalId.min(1).max(200),
  remove: z.boolean(),
}).strict();
export type ChangeProductGrantRequest = z.infer<typeof changeProductGrantRequestSchema>;

export const changeProductDomainGrantRequestSchema = z.object({ shared: z.boolean() }).strict();
export const productGrantChangeResponseSchema = z.object({ success: z.literal(true) }).strict();
