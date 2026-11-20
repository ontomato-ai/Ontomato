import { z } from "zod";
import { applicationMetadataSchema } from "./application-metadata";
import { productCurrentIdParamsSchema } from "./product-record-id";
import { applicationPanelUsesManagementSchema, applicationPanelUsesResponseSchema } from "./product-panels";

const summary = applicationMetadataSchema.pick({ names: true, descriptions: true, icon: true }).extend({
  id: productCurrentIdParamsSchema.shape.id,
  source: z.enum(["builtin", "domain"]),
  canMaintain: z.boolean(),
  canEditEntries: z.boolean(),
  canGrant: z.boolean(),
  entryCount: z.number().int().nonnegative(),
});

export const applicationCatalogueQueryResultSchema = z.object({
  rows: z.array(summary),
  nextCursor: z.string().optional(),
}).strict();

export const applicationCatalogueRecordSchema = summary
  .merge(applicationPanelUsesResponseSchema.pick({ entry: true, panelUses: true }))
  .merge(applicationPanelUsesManagementSchema.pick({
    entryAccess: true, framePanelId: true, theme: true, delivery: true,
  }).partial())
  .extend({ groups: applicationMetadataSchema.shape.groups })
  .strict();
