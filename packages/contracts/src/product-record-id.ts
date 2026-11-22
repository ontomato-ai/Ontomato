import { z } from "zod";

export const BUILTIN_PRODUCT_ID_PREFIX = "builtin-product-";

export const DOMAIN_COMPONENT_PREFIX = "domain-component:";

export function isDomainComponentId(id: string): boolean {
  return id.startsWith(DOMAIN_COMPONENT_PREFIX);
}

export const componentIdSchema = z.string().regex(
  /^(?:@[^@\s/:]+\/)?[^@\s/:]+:[^@\s/:]+$/u, "Expected a package-qualified component name",
);

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
).refine(id => !isDomainComponentId(id), `IDs beginning with ${DOMAIN_COMPONENT_PREFIX} are reserved for domain components`);

export const productCurrentIdParamsSchema = z.object({ id: productIdSchema }).strict();
export const domainProductIdParamsSchema = productCurrentIdParamsSchema.extend({ id: domainProductIdSchema });
