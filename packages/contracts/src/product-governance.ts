import { z } from "zod";
import { productCurrentIdParamsSchema } from "./product-record-id";

export const RETRIEVAL_AGENT_ID = "dd3b91b9-9214-4aa6-9937-fb07fd37b232";

export const productGrantVerbSchema = z.enum(["use", "view", "edit"]);
export type ProductGrantVerb = z.infer<typeof productGrantVerbSchema>;

const productGrantRecordSchema = z.object({
  principalKind: z.enum(["principal", "role", "domain"]),
  principalId: z.string(),
  principalName: z.string().min(1).optional(),
  verb: productGrantVerbSchema,
});
export type ProductGrantRecord = z.infer<typeof productGrantRecordSchema>;

export const productGrantPrincipalOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
}).strict();
export const productGrantPrincipalsResponseSchema = z.object({
  options: z.array(productGrantPrincipalOptionSchema),
}).strict();

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

export const setProductGrantsRequestSchema = changeProductGrantRequestSchema.omit({ verb: true, remove: true }).extend({
  id: productCurrentIdParamsSchema.shape.id,
  verbs: z.array(productGrantVerbSchema),
});
export type SetProductGrantsRequest = z.infer<typeof setProductGrantsRequestSchema>;

export const domainProductGrantsRequestSchema = productGrantRecordSchema.pick({
  principalKind: true,
  principalId: true,
}).partial().strict();
export type DomainProductGrantsRequest = z.infer<typeof domainProductGrantsRequestSchema>;

export const domainProductGrantEntrySchema = productGrantRecordSchema.extend({
  resourceId: productCurrentIdParamsSchema.shape.id,
});
export type DomainProductGrantEntry = z.infer<typeof domainProductGrantEntrySchema>;

export const domainProductGrantsResponseSchema = z.object({
  grants: z.array(domainProductGrantEntrySchema),
});
export type DomainProductGrantsResponse = z.infer<typeof domainProductGrantsResponseSchema>;

export const changeProductDomainGrantRequestSchema = z.object({ shared: z.boolean() }).strict();
export const productGrantChangeResponseSchema = z.object({ success: z.literal(true) }).strict();
export const changeProductPanelDomainGrantResponseSchema = productGrantChangeResponseSchema.extend({
  skippedProjectionIds: z.array(productCurrentIdParamsSchema.shape.id),
});
