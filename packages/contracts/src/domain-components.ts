import { z } from "zod";
import { componentDeclarationSchema } from "./component-declaration";
import { DOMAIN_COMPONENT_PREFIX, isDomainComponentId, productCurrentIdParamsSchema } from "./product-record-id";

export const DOMAIN_COMPONENTS_PATH = "/api/domain-components";

export const domainComponentIdSchema = componentDeclarationSchema.shape.componentId
  .max(200).refine(isDomainComponentId, `Expected a component ID beginning with ${DOMAIN_COMPONENT_PREFIX}`);
export const domainComponentParamsSchema = z.object({ id: domainComponentIdSchema }).strict();

const id = productCurrentIdParamsSchema.shape.id;
const revision = z.number().int().positive();
export const domainComponentSourceSchema = z.object({
  template: z.string().refine(value => value.trim().length > 0, "A Vue template is required"),
  module: z.string().optional(),
}).strict();

const declaration = componentDeclarationSchema.extend({ componentId: domainComponentIdSchema });
export const domainComponentInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  visibility: z.enum(["private", "domain"]),
  declaration,
  source: domainComponentSourceSchema,
}).strict();
export type DomainComponentInput = z.infer<typeof domainComponentInputSchema>;

export const registerDomainComponentRequestSchema = domainComponentInputSchema.extend({
  declaration: declaration.extend({ componentId: domainComponentIdSchema.optional() }),
});
export const updateDomainComponentRequestSchema = domainComponentInputSchema.extend({ revision });
export const domainComponentRevisionQuerySchema = z.object({ revision: z.coerce.number().int().positive() }).strict();

const currentFields = { domainId: id, revision, editable: z.boolean() };
export const domainComponentSummarySchema = domainComponentInputSchema.omit({ source: true }).extend(currentFields);
export const domainComponentRecordSchema = domainComponentInputSchema.extend({
  ...currentFields,
  ownerId: id,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const domainComponentResponseSchema = z.object({ component: domainComponentRecordSchema }).strict();
export const domainComponentListResponseSchema = z.object({ components: z.array(domainComponentSummarySchema) }).strict();

export const domainComponentUseSchema = z.object({ id }).strict();
export const domainComponentUsedBySchema = z.object({
  projections: z.array(domainComponentUseSchema),
  panels: z.array(domainComponentUseSchema),
  hiddenProjectionCount: z.number().int().nonnegative(),
  hiddenPanelCount: z.number().int().nonnegative(),
}).strict();

export const domainComponentRuntimeSchema = z.object({
  domainId: id,
  componentId: domainComponentIdSchema,
  revision,
  source: domainComponentSourceSchema,
}).strict();
export type DomainComponentRuntime = z.infer<typeof domainComponentRuntimeSchema>;
