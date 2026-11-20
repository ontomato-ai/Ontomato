import { z } from "zod";
import { runtimeKeySchema } from "./agent-runtime-values";
import { panelOperationDeclarationSchema, panelReadResultIdSchema } from "./panel-operations";
import { panelReadParameterSchemas } from "./panel-projection";
import { platformOntologyLayers, type PanelReadParameterId } from "./platform-object-types";

const readParameterIdSchema = z.custom<PanelReadParameterId>(
  value => typeof value === "string" && Object.hasOwn(panelReadParameterSchemas, value),
  "Expected a registered panel read parameter ID",
);
function typeReadDeclarationSchema<ResultId extends string>(result: z.ZodType<ResultId>) {
  const readDeclaration = { source: z.enum(["type", "object"]), result };
  return z.discriminatedUnion("parameterMode", [
    z.object({
      ...readDeclaration,
      parameterMode: z.literal("fixed"),
      params: z.record(runtimeKeySchema, readParameterIdSchema),
      requiredParams: z.array(runtimeKeySchema).optional(),
    }).strict(),
    z.object({
      ...readDeclaration,
      parameterMode: z.literal("owner"),
      parameter: readParameterIdSchema,
    }).strict(),
  ]);
}

export const platformTypeReadDeclarationSchema = typeReadDeclarationSchema(z.lazy(() => panelReadResultIdSchema));
// The graph response is itself a registered read result. Keep its read IDs as strings in the wire type.
export type PlatformTypeReadDeclaration = z.infer<ReturnType<typeof typeReadDeclarationSchema<string>>>;

export const platformTypeTableEntrySchema = z.object({
  labelKey: runtimeKeySchema.optional(),
  layer: z.enum(platformOntologyLayers).optional(),
  reads: z.record(runtimeKeySchema, platformTypeReadDeclarationSchema).optional(),
  operations: z.array(z.lazy(() => panelOperationDeclarationSchema)).optional(),
  childCollections: z.array(runtimeKeySchema).optional(),
}).strict();
export type PlatformTypeTableEntry = z.infer<typeof platformTypeTableEntrySchema>;

/** The authenticated author catalogue, keyed by the owner type's ID. */
export const platformTypeTableResponseSchema = z.object({
  objectTypes: z.record(runtimeKeySchema, platformTypeTableEntrySchema),
}).strict();
export type PlatformTypeTableResponse = z.infer<typeof platformTypeTableResponseSchema>;
