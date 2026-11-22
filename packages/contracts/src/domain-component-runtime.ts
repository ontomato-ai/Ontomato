import { z } from "zod";
import { componentIdSchema, DOMAIN_COMPONENT_PREFIX, isDomainComponentId, productCurrentIdParamsSchema } from "./product-record-id";

export const domainComponentIdSchema = componentIdSchema.max(200)
  .refine(isDomainComponentId, `Expected a component ID beginning with ${DOMAIN_COMPONENT_PREFIX}`);

export const domainComponentSourceSchema = z.object({
  template: z.string().refine(value => value.trim().length > 0, "A Vue template is required"),
  module: z.string().optional(),
}).strict();

export const domainComponentRuntimeSchema = z.object({
  domainId: productCurrentIdParamsSchema.shape.id,
  componentId: domainComponentIdSchema,
  revision: z.number().int().positive(),
  source: domainComponentSourceSchema,
}).strict();
export type DomainComponentRuntime = z.infer<typeof domainComponentRuntimeSchema>;
