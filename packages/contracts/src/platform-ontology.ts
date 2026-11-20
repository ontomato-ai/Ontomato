import { z } from "zod";
import { runtimeKeySchema } from "./agent-runtime-values";
import { panelOperationDeclarationSchema } from "./panel-operations";
import { platformOntologyLayerSchema } from "./platform-ontology-data";
import { platformRelationKindDeclarationSchema } from "./platform-object-types";
import { platformTypeDetailDeclarationSchema } from "./platform-type-details";
import { platformTypeReadDeclarationSchema, type PlatformTypeReadDeclaration } from "./platform-type-table";

export * from "./platform-ontology-data";

export const platformOntologyTypeSchema = platformTypeDetailDeclarationSchema
  .pick({ definition: true, properties: true, rules: true })
  .partial()
  .extend({
    id: platformTypeDetailDeclarationSchema.shape.id,
    layer: platformOntologyLayerSchema,
    labelKey: z.string().min(1),
    reads: z.record(runtimeKeySchema, z.lazy((): z.ZodType<PlatformTypeReadDeclaration> => platformTypeReadDeclarationSchema)).optional(),
    operations: z.array(z.lazy(() => panelOperationDeclarationSchema)).optional(),
  }).strict();
export type PlatformOntologyType = z.infer<typeof platformOntologyTypeSchema>;

export const platformOntologySchemaResponseSchema = z.object({
  layers: z.array(platformOntologyLayerSchema),
  objectTypes: z.array(platformOntologyTypeSchema),
  relationKinds: z.array(platformRelationKindDeclarationSchema),
}).strict();
type PlatformOntologySchemaJson = z.infer<typeof platformOntologySchemaResponseSchema>;
/** The owner can return its immutable catalogue. The wire parser returns ordinary JSON arrays. */
export type PlatformOntologySchemaResponse = {
  [K in keyof PlatformOntologySchemaJson]: Readonly<PlatformOntologySchemaJson[K]>;
};
