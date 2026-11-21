import { z } from "zod";

export const BUILTIN_PRODUCT_ID_PREFIX = "builtin-product-";

const productIdSchema = z.string().min(1).max(200);

export function isBuiltinProductId(id: string): boolean {
  return id.startsWith(BUILTIN_PRODUCT_ID_PREFIX);
}

export const builtinProductIdSchema = productIdSchema.refine(
  id => isBuiltinProductId(id) && id.length > BUILTIN_PRODUCT_ID_PREFIX.length,
  `Expected a platform product ID with prefix ${BUILTIN_PRODUCT_ID_PREFIX}`,
);
export const domainProductIdSchema = productIdSchema.refine(
  id => !isBuiltinProductId(id),
  `IDs beginning with ${BUILTIN_PRODUCT_ID_PREFIX} are reserved for platform products`,
);

export const productCurrentIdParamsSchema = z.object({ id: productIdSchema }).strict();
export const domainProductIdParamsSchema = productCurrentIdParamsSchema.extend({ id: domainProductIdSchema });
