import { z } from "zod";
import { applicationMetadataSchema } from "./application-metadata";
import { panelFormRequestSchema } from "./panel-projection";
import { applicationFormSectionSchema } from "./product-catalog-query";
import { productCurrentIdParamsSchema } from "./product-record-id";
import {
  applicationPanelUsesManagementSchema, applicationPanelUsesResponseSchema, registerApplicationPanelUsesRequestSchema,
} from "./product-panels";

const summary = applicationMetadataSchema.pick({ names: true, descriptions: true, icon: true }).extend({
  id: productCurrentIdParamsSchema.shape.id,
  source: z.enum(["builtin", "domain"]),
  canMaintain: z.boolean(),
  canEditEntries: z.boolean(),
  canGrant: z.boolean(),
  entryCount: z.number().int().nonnegative(),
  allowStandalone: z.boolean().optional(),
  updatedAt: z.string().optional(),
  ownerName: z.string().optional(),
});

export const applicationCatalogueQueryResultSchema = z.object({
  rows: z.array(summary),
  total: z.number().int().nonnegative().optional(),
  nextCursor: z.string().optional(),
}).strict();

const panelUseEntry = applicationPanelUsesResponseSchema.shape.entry.shape;
const applicationCatalogueEntrySchema = z.object({
  path: panelUseEntry.path,
  renderer: panelUseEntry.renderer.optional(),
  home: panelUseEntry.home,
}).strict();

export const applicationCatalogueEntriesSchema = applicationPanelUsesResponseSchema.extend({
  entry: applicationCatalogueEntrySchema,
  groups: applicationMetadataSchema.shape.groups.optional(),
}).merge(applicationPanelUsesManagementSchema.pick({ framePanelId: true, theme: true }).partial());

export const applicationCatalogueRecordSchema = summary
  .merge(applicationCatalogueEntriesSchema.pick({ entry: true, panelUses: true }))
  .merge(applicationPanelUsesManagementSchema.pick({
    entryAccess: true, framePanelId: true, theme: true, delivery: true,
  }).partial())
  .extend({ groups: applicationMetadataSchema.shape.groups })
  .strict();

export const applicationCatalogueFormRequestSchema = panelFormRequestSchema.extend({
  section: applicationFormSectionSchema,
  entryId: z.string().min(1).optional(),
});
export type ApplicationCatalogueFormRequest = z.infer<typeof applicationCatalogueFormRequestSchema>;

export const applicationIdentityUpdateSchema = applicationMetadataSchema.pick({ names: true, descriptions: true, icon: true }).extend({
  allowStandalone: z.boolean().optional(),
});
export const applicationCatalogueCreateSchema = registerApplicationPanelUsesRequestSchema.required({
  declaration: true, entryAccess: true,
});
export const applicationEntriesUpdateSchema = registerApplicationPanelUsesRequestSchema.omit({
  declaration: true, entryAccess: true, allowStandalone: true,
});
