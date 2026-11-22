import { z } from "zod";
import { appsSdkComponentCatalogEntrySchema } from "./apps-sdk";
import { panelLocalOperationNameSchema } from "./panel-projection";
import { componentIdSchema } from "./product-record-id";

export const componentDeclarationSchema = appsSdkComponentCatalogEntrySchema.omit({ module: true, exportName: true }).extend({
  componentId: componentIdSchema,
  operations: z.array(z.object({
    name: panelLocalOperationNameSchema,
    handlerRef: z.string().trim().min(1),
  }).strict()).optional(),
});

export type ComponentDeclaration = z.infer<typeof componentDeclarationSchema>;
