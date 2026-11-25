import { z } from "zod";

export const productObjectVerbSchema = z.enum(["USE", "EDIT"]);
export const changeProductObjectGrantSchema = z.object({
  policyId: z.string().trim().min(1),
  verb: productObjectVerbSchema,
  remove: z.boolean(),
}).strict();
export type ChangeProductObjectGrant = z.infer<typeof changeProductObjectGrantSchema>;

const productObjectGrantSchema = z.object({
  policyId: z.string(),
  name: z.string(),
  verb: productObjectVerbSchema,
}).strict();

export const productObjectAccessSchema = z.object({
  grants: z.array(productObjectGrantSchema),
  shared: z.boolean(),
}).strict();
